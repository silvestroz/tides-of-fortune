// FramePacer: turns requestAnimationFrame timestamps into an even simulation step and, on fast screens, presents
// only every n-th refresh when the game cannot keep up with the display (an even 72 fps on a 144 Hz screen reads
// smoother than frames alternating between one and two refreshes).
// API:
//   const pacer = new FramePacer({ mode, calibrate })   mode: 'auto' | 'max' | '60' (settings.fps)
//   pacer.tick(ts) -> dt (s) to simulate and render this refresh, or -1 to skip it (nothing drawn, the previous
//                     image stays on screen). ts = the rAF timestamp (ms) given to renderer.setAnimationLoop.
//   pacer.refreshMs  measured display refresh period (ms) ; pacer.hz (rounded)
//   pacer.div        refreshes per presented frame (1 = every refresh)
//   pacer.targetMs   refreshMs * div: the frame interval the dynamic resolution aims for
//   pacer.mode       settable at any time
//   pacer.probing    true while 'auto' tries a faster cadence (the dynamic resolution waits)
//   pacer.hold       set by the dynamic resolution while it can still lower the scale for a fast screen: 'auto'
//                    does not divide the cadence meanwhile (resolution first, cadence second)
//   pacer.resetProbe()  allow the tries again (called by DynRes when the resolution changes)
// Steps:
//   - refresh period: among the last 240 rAF intervals (skipped refreshes included), the shortest cluster holding
//     at least 3 % of them; its median. Missed frames only add longer clusters, so they do not lengthen it. When
//     every frame is late, the cluster found is a whole multiple of the period measured before: that period is
//     kept. So that the true period is known even on a machine that is late from its first image, the first
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
const WIN = 240, EVAL_MS = 2000, PROBE_EVERY_MS = 45000, PROBE_MS = 2000, MIN_FPS = 48, CALIBRATE = 24;

export class FramePacer {
  constructor({ mode = 'auto', calibrate = true } = {}) {
    this.mode = mode;
    this._cal = calibrate ? CALIBRATE : 0;   // refreshes left of the opening measure
    this.refreshMs = 1000 / 60; this.hz = 60;
    this.div = 1;
    this.hold = false; this._held = false;
    this._raw = []; this._rawI = 0;     // ring of raw rAF intervals
    this._bestMs = 0;                   // display period last measured from frames that were on time
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
    if (d > 0 && d < 50) { if (this._raw.length < WIN) this._raw.push(d); else this._raw[this._rawI = (this._rawI + 1) % WIN] = d; }
    if (this._cal > 0) {   // opening measure: nothing is drawn, so the callbacks come at the display's own rate
      if (--this._cal === 0) { this._measure(); this._lastShown = ts; this._evalAt = ts + EVAL_MS; this._probeAt = ts + PROBE_EVERY_MS; }
      return -1;
    }
    if (this._raw.length >= 30 && (this._raw.length < WIN || this._rawI % 30 === 0)) this._measure();
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

  _measure() {
    const s = this._raw.slice().sort((a, b) => a - b), need = Math.max(6, Math.ceil(s.length * 0.03));
    // smallest interval shared by enough samples: its cluster's median is the period (a lone short interval,
    // two callbacks in one refresh, does not count; missed refreshes only add longer clusters)
    for (let i = 0; i < s.length; i++) {
      if (!(s[i] > 3)) continue;
      let j = i; while (j < s.length && s[j] < s[i] * 1.2) j++;
      if (j - i < need) continue;
      const m0 = s[(i + j) >> 1], c = s.filter(v => Math.abs(v - m0) < m0 * 0.1);   // re-centred on its median
      const ms = c[c.length >> 1], k = this._bestMs ? ms / this._bestMs : 1, n = Math.round(k);
      // a whole multiple (2 to 4) of a period already measured: every frame is late, the display is not slower.
      // Keeping the true period lets 'auto' and the dynamic resolution act on it (a window moved to a display at
      // exactly half the rate reads the same and ends at the same cadence: one image every two refreshes).
      if (n >= 2 && n <= 4 && Math.abs(k - n) < 0.06 * n) return;
      this._bestMs = ms;
      this.refreshMs = ms; this.hz = Math.round(1000 / ms);
      return;
    }
  }

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
