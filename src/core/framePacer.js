// FramePacer: turns requestAnimationFrame timestamps into an even simulation step and, on fast screens, presents
// only every n-th refresh when the game cannot keep up with the display (an even 72 fps on a 144 Hz screen reads
// smoother than frames alternating between one and two refreshes).
// API:
//   const pacer = new FramePacer({ mode, calibrate })   mode: 'auto' | 'max' | '60' (settings.fps)
//   pacer.tick(ts) -> dt (s) to simulate and render this refresh, or -1 to skip it (nothing drawn, the previous
//                     image stays on screen). ts = the rAF timestamp (ms) given to renderer.setAnimationLoop.
//   pacer.refreshMs  display refresh period (ms) ; pacer.hz (the usual rate it stands for, else rounded)
//   pacer.div        refreshes per presented frame (1 = every refresh)
//   pacer.targetMs   refreshMs * div: the frame interval the dynamic resolution aims for
//   pacer.mode       settable at any time
//   pacer.probing    true while 'auto' tries a faster cadence (the dynamic resolution waits)
//   pacer.hold       set by the dynamic resolution while it can still lower the scale for a fast screen: 'auto'
//                    does not divide the cadence meanwhile (resolution first, cadence second)
//   pacer.resetProbe()  allow the tries again (called by DynRes when the resolution changes)
// Steps:
//   - refresh period: read every 250 ms from the rAF intervals of the last 2 s (skipped refreshes included).
//     rAF timestamps are not exact: on some panels (120 Hz laptops) an on-time interval lands anywhere within
//     15 % of the period, and a busy main thread delays one callback and shortens the next. Both spread the
//     intervals evenly around the true period, so a centre is read and never an edge:
//       1. the shortest group of intervals (within 20 % of each other) holding at least 5 % of them marks the
//          period; missed frames only add groups at whole multiples of it, further up;
//       2. the reading is the mean of every interval within 40 % of that mark, re-centred until it settles: early
//          and late timestamps cancel out, a long-then-short pair counts for two periods, the multiples stay out;
//       3. within 3 % of a usual display rate (60, 72, 75, 90, 100, 120, 144, 165, 180, 240 Hz) it is that rate
//          and its exact period; any other rate (50, 85 Hz…) keeps the period read, followed slowly afterwards;
//       4. once a rate is known, another one replaces it only when four readings in a row (1 s) agree on it
//          within 1.5 %: a burst of odd intervals, or a window half-way between two displays, changes nothing.
//     When every frame is late, the group found is a whole multiple of the period known: that period is kept.
//     So that the true period is known even on a machine that is late from its first image, the first
//     24 refreshes after the loop starts are not drawn (0.2 to 0.4 s under the loading screen): callbacks with no
//     work come at the display's own rate. `calibrate: false` skips that (automated tools).
//     Under 75 Hz the cadence is never divided.
//   - dt: the raw interval rounded to a whole number of refreshes when within 25 % of one (rAF and vsync jitter
//     would otherwise move the waves unevenly from one image to the next); the rounding error is carried and
//     paid back 5 % per frame, so simulated time never drifts from real time.
//   - 'auto': every 2 s, if more than a quarter of the presented frames came late (> 1.5 refreshes apart at
//     div 1), div goes up by one (never below 48 fps: past that the dynamic resolution does the work); every 45 s it tries
//     one step faster for 2 s and keeps it if the frames hold (3 failed tries in a row: stops trying until
//     resetProbe(), called when the resolution scale changes).
//   - '60': div = max(1, floor((hz + 5) / 60)) (144 Hz: 72 fps, 240 Hz: 60 fps) ; 'max': div = 1.
const EVAL_MS = 2000, PROBE_EVERY_MS = 45000, PROBE_MS = 2000, MIN_FPS = 48, CALIBRATE = 24;
const RING = 512, WIN_MS = 2000, MEASURE_MS = 250, MIN_SHARE = 0.05, CONFIRM = 4, AGREE = 0.015;
const USUAL_HZ = [60, 72, 75, 90, 100, 120, 144, 165, 180, 240], SNAP = 0.03;

export class FramePacer {
  constructor({ mode = 'auto', calibrate = true } = {}) {
    this.mode = mode;
    this._cal = calibrate ? CALIBRATE : 0;   // refreshes left of the opening measure
    this.refreshMs = 1000 / 60; this.hz = 60;
    this.div = 1;
    this.hold = false; this._held = false;
    this._raw = new Float64Array(RING); this._at = new Float64Array(RING); this._n = 0;   // ring of raw rAF intervals and their timestamps
    this._known = false;                // a period has been read (until then refreshMs is the 60 Hz default)
    this._cand = 0; this._candN = 0;    // another period being confirmed, readings in a row that agreed on it
    this._measureAt = 0;
    this._last = 0;                     // previous rAF timestamp
    this._lastShown = 0;                // timestamp of the last presented frame
    this._carry = 0;                    // rounding error of dt (ms), paid back later
    this._evalAt = 0; this._late = 0; this._shown = 0;
    this._probeAt = 0; this._probe = null; this._fails = 0;
  }

  get targetMs() { return this.refreshMs * this.div; }
  get probing() { return !!this._probe; }

  resetProbe() { this._fails = 0; }

  tick(ts) {
    if (!this._last) { this._last = this._lastShown = ts; this._evalAt = ts + EVAL_MS; this._probeAt = ts + PROBE_EVERY_MS; return 1 / 60; }
    const d = ts - this._last;
    this._last = ts;
    if (d > 0 && d < 50) { const i = this._n++ % RING; this._raw[i] = d; this._at[i] = ts; }
    if (this._cal > 0) {   // opening measure: nothing is drawn, so the callbacks come at the display's own rate
      if (--this._cal === 0) { this._measure(ts); this._lastShown = ts; this._evalAt = ts + EVAL_MS; this._probeAt = ts + PROBE_EVERY_MS; }
      return -1;
    }
    if (ts >= this._measureAt) this._measure(ts);
    if (this.hold) this._held = true;
    this._chooseDiv(ts);

    const P = this.refreshMs, since = ts - this._lastShown;
    if (this.div > 1 && since < (this.div - 0.5) * P) return -1;   // not yet: keep the previous image
    this._lastShown = ts;
    if (since > 250) { this._carry = 0; return Math.min(since, 50) / 1000; }   // tab hidden, breakpoint: no catch-up
    // statistics for 'auto'
    this._shown++;
    if (since > (this.div + 0.5) * P) this._late++;
    // even step: a whole number of refreshes when close to one
    const n = Math.round(since / P);
    let ms = since;
    if (n >= 1 && Math.abs(since - n * P) < 0.25 * P) {
      ms = n * P;
      this._carry += since - ms;
      const pay = this._carry * 0.05;   // paid back a little every frame: no visible step
      ms += pay; this._carry -= pay;
    }
    return ms / 1000;
  }

  // centre of the shortest well-filled group of intervals of the last WIN_MS (ms), 0 when there are too few
  _period(ts) {
    const s = [];
    for (let i = Math.min(this._n, RING) - 1; i >= 0; i--) if (this._at[i] > ts - WIN_MS) s.push(this._raw[i]);
    if (s.length < 12) return 0;
    s.sort((a, b) => a - b);
    const need = Math.max(6, Math.ceil(s.length * MIN_SHARE));
    for (let i = 0; i < s.length; i++) {
      if (!(s[i] > 3)) continue;   // two callbacks in one refresh
      let j = i; while (j < s.length && s[j] < s[i] * 1.2) j++;
      if (j - i < need) continue;
      let m = s[(i + j) >> 1];
      for (let pass = 0; pass < 6; pass++) {
        let sum = 0, n = 0;
        for (const v of s) if (v > m * 0.6 && v < m * 1.4) { sum += v; n++; }
        m = sum / n;
      }
      return m;
    }
    return 0;
  }

  _measure(ts) {
    this._measureAt = ts + MEASURE_MS;
    const ms = this._period(ts);
    if (!ms) return;
    const k = ms / this.refreshMs, n = Math.round(k);
    if (this._known) {
      if (Math.abs(k - 1) < SNAP) {   // the display known: an odd rate follows its reading, a usual one stays exact
        this._cand = 0;
        if (!USUAL_HZ.includes(this.hz)) this._set(this.refreshMs + (ms - this.refreshMs) * 0.1);
        return;
      }
      // a whole multiple (2 to 4) of the period known: every frame is late, the display is not slower.
      // Keeping the true period lets 'auto' and the dynamic resolution act on it (a window moved to a display at
      // exactly half the rate reads the same and ends at the same cadence: one image every two refreshes).
      if (n >= 2 && n <= 4 && Math.abs(k - n) < 0.06 * n) { this._cand = 0; return; }
      if (Math.abs(ms - this._cand) < AGREE * this._cand) this._candN++; else this._candN = 1;
      this._cand = ms;
      if (this._candN < CONFIRM) return;
    }
    this._known = true; this._cand = 0;
    const near = USUAL_HZ.reduce((a, h) => (Math.abs(1000 / h - ms) < Math.abs(1000 / a - ms) ? h : a));
    if (Math.abs(ms * near / 1000 - 1) < SNAP) this._set(1000 / near, near); else this._set(ms);
  }

  // hz of an odd rate: the rounded reading, kept while the reading stays within 0.75 Hz of it (no flicker at x.5)
  _set(ms, hz = Math.abs(1000 / ms - this.hz) < 0.75 ? this.hz : Math.round(1000 / ms)) { this.refreshMs = ms; this.hz = hz; }

  _maxDiv() { return Math.max(1, Math.floor(this.hz / MIN_FPS)); }

  _chooseDiv(ts) {
    if (this.mode === 'max' || this.hz < 75) { this.div = 1; this._probe = null; return; }
    if (this.mode === '60') { this.div = Math.max(1, Math.floor((this.hz + 5) / 60)); this._probe = null; return; }
    if (ts < this._evalAt) return;
    this._evalAt = ts + EVAL_MS;
    const lateShare = this._shown ? this._late / this._shown : 0;
    this._late = this._shown = 0;
    if (this._probe) {   // end of a try one step faster
      const keep = lateShare <= 0.25;
      if (keep) this._fails = 0; else { this.div = this._probe.from; this._fails++; }
      this._probe = null;
      this._probeAt = ts + PROBE_EVERY_MS;
      return;
    }
    // resolution first: late frames counted while the dynamic resolution still had a step to give do not count
    const held = this._held; this._held = false;
    if (lateShare > 0.25 && this.div < this._maxDiv() && !held) { this.div++; this._probeAt = ts + PROBE_EVERY_MS; return; }
    if (this.div > 1 && this._fails < 3 && ts >= this._probeAt) { this._probe = { from: this.div }; this.div--; }
  }
}
