// Adaptive resolution. API: new DynRes(game); dynres.frame(nowMs) once per presented frame; dynres.scale (current
// renderer pixel ratio); dynres.cap (ceiling); dynres.enabled. ?dynres=0 disables (fixed pixel ratio = min(1, cap)),
// ?pr=N forces a fixed pixel ratio (also disables the controller).
// Ceiling = min(tier cap, pixel budget):
//   tier cap: 'low' / 'medium' -> min(devicePixelRatio, 1); 'ultra' -> max(1.5, dpr); 'high' -> max(1, dpr);
//   pixel budget: QUALITY.maxMpx megapixels rendered (2.2 / 2.8 / 3.7 / 8.3 by tier), so a 4K or wide screen is
//   rendered at a lower ratio and scaled up instead of paying for every pixel. Recomputed when the window resizes.
// It starts at the scale that last held on this machine: once a scale has stayed 10 s at sea (no full-screen mode),
// it is kept in localStorage 'tof.dynres' per quality tier with the window's size, and the next session starts from
// it if its window is within a quarter of that size (in pixels), on the nearest step at or under it. With nothing
// kept it starts at min(1, ceiling); the climb rules below take a strong machine up to its ceiling either way.
// Nothing is read or kept for automated browsers (navigator.webdriver), ?dynres=0 and ?pr=N.
// Every ~1 s the 60th percentile of the frame intervals of that second is compared with
// the target interval T = game.pacer.targetMs (display refresh x presented cadence, 16.7 ms at 60 Hz):
//   above the native ratio (scale > 1): > 1.08 T -> one step down
//   at or below it: > max(1.08 T, 18 ms) -> one step down (resolution only defends ~55 fps)
// Fast screens (pacer.hz >= 75, ?chase=0 turns this off): resolution gives way before the cadence does. Down to a
// floor below native (0.8 with settings.fps 'auto', the bottom of the ladder with 'max'), a late screen rate costs
// one step: > 1.08 T on the 76th percentile, so that it reacts just before the pacer's own test (a quarter of the
// frames late). While a step is left above that floor, pacer.hold keeps the pacer from dividing the cadence; at
// the floor the pacer divides as before and the scale climbs back. When the pacer tries a faster cadence
// (pacer.probing), the scale goes to that floor first: the try measures the best case, then the scale climbs again.
// Intervals over 250 ms (window covered or throttled, breakpoint) are not frames: they empty the window.
//   < 0.78 T -> one step up; a sustained 4 s under 1.03 T (vsync-bound) also allows a step up, except to a scale
//   that caused a drop in the last 20 s (doubled at each new drop it causes, up to 5 min; forgotten on a resize).
//   Never above the ceiling.
// No decision while the pacer tries a faster cadence (pacer.probing); a change resets the pacer's tries.
// Upscaling: below the output ratio (outPr = min(dpr, 2) in Standard/Ultra, min(dpr, 1) in Performance), while the
// post chain draws the sea (no renderOverride, ?fsr != 0), the canvas stays at outPr and the post chain renders at
// `scale` then FSR 1 upsamples (post.setRenderSize, src/post/fsrPass.js): sharp edges instead of a browser stretch.
// Otherwise (supersampling, full-screen modes with their own render, FSR off) the canvas itself is sized at `scale`,
// as before. dynres.fsr tells which; dynres.renderSize() = { w, h } actually rendered.
// On a change it calls renderer.setPixelRatio + post.resize, so every post-processing target follows.
import { QUALITY } from './constants.js';
const CHECK_MS = 1000, STEPS = [0.7, 0.8, 0.9, 1, 1.25, 1.5, 1.75, 2];
const FAST_HZ = 75, FAST_FLOOR = 0.8, STALL_MS = 250;
const STORE_KEY = 'tof.dynres', STABLE_MS = 10000, SIZE_NEAR = 1.25;

export class DynRes {
  constructor(game) {
    this.game = game;
    const p = game.params;
    const forced = parseFloat(p.get('pr'));
    this.enabled = p.get('dynres') !== '0' && !(forced > 0);
    this._noFsr = p.get('fsr') === '0';
    this._noChase = p.get('chase') === '0';
    this._probeDrop = false; this._probeFrom = 0;
    this.fsr = false;
    this._size = '';
    this._ceiling();
    this._remembers = this.enabled && !globalThis.navigator?.webdriver;
    this._kept = this._recall();    // scale in storage for this tier and window size (0: none)
    this.scale = forced > 0 ? forced : this._kept || Math.min(1, this.cap);
    this._heldAt = 0; this._heldScale = this.scale;   // since when the scale has not moved
    this.ms = 16.7;            // smoothed frame interval
    this._last = 0; this._check = 0; this._good = 0;
    this._win = [];             // intervals of the current check window (decisions on a percentile)
    this._blocked = new Map();  // scale -> time until which raising to it is not allowed
    this._fails = new Map();    // scale -> drops it caused since the last resize
  }

  // ceiling and ladder for the current window size
  _ceiling() {
    const g = this.game, dpr = window.devicePixelRatio || 1;
    this._size = innerWidth + 'x' + innerHeight;
    const tier = g.quality === 'ultra' ? Math.max(QUALITY.prCap || 1.5, dpr) : g.quality === 'high' ? Math.max(1, dpr) : Math.min(dpr, 1);
    const budget = Math.sqrt((QUALITY.maxMpx || 3.7) * 1e6 / Math.max(1, innerWidth * innerHeight));
    this.cap = Math.round(Math.min(tier, budget) * 100) / 100;
    this.outPr = Math.min(dpr, g.quality === 'high' || g.quality === 'ultra' ? 2 : 1);
    this.ladder = STEPS.filter(s => s < this.cap - 0.01);
    if (this.cap < STEPS[0]) this.ladder = [Math.round(this.cap * 0.8 * 100) / 100];   // huge screen on a small budget
    this.ladder.push(this.cap);
  }

  // every tier's kept scale: { <tier>: { px, scale } }
  _stored() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; }
  }

  // the kept scale for this tier if the window is about the size it was measured on, on this window's ladder
  _recall() {
    if (!this._remembers) return 0;
    const e = this._stored()[this.game.quality], px = innerWidth * innerHeight;
    if (!e || !(e.scale > 0) || !(e.px > 0) || px > e.px * SIZE_NEAR || px < e.px / SIZE_NEAR) return 0;
    return this.ladder.filter(s => s <= e.scale + 1e-6).pop() ?? this.ladder[0];
  }

  // called once per decision: keeps a scale that has held STABLE_MS while the sea was drawn
  _remember(now) {
    if (this.game.renderOverride || this.scale !== this._heldScale || !this._heldAt) { this._heldScale = this.scale; this._heldAt = now; return; }
    if (!this._remembers || this.scale === this._kept || now - this._heldAt < STABLE_MS) return;
    this._kept = this.scale;
    const all = this._stored();
    all[this.game.quality] = { px: innerWidth * innerHeight, scale: this.scale };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(all)); } catch { /* storage blocked or full */ }
  }

  _wantFsr() {
    const g = this.game;
    return !this._noFsr && !!g.post?.enabled && !g.renderOverride && this.scale < this.outPr * 0.95;
  }

  // lowest scale a fast screen's rate is defended down to (1 = never below native: 60 Hz screens, 'Power saver')
  _chaseFloor() {
    const pc = this.game.pacer;
    if (this._noChase || !this.enabled || !pc || pc.hz < FAST_HZ || pc.mode === '60') return 1;
    const want = pc.mode === 'max' ? 0 : FAST_FLOOR;
    return Math.min(1, this.ladder.find(s => s >= want - 1e-6) ?? 1);
  }

  renderSize() {
    return { w: Math.round(innerWidth * this.scale), h: Math.round(innerHeight * this.scale) };
  }

  apply() {
    const g = this.game, fsr = this.fsr = this._wantFsr();
    g.renderer.setPixelRatio(fsr ? this.outPr : this.scale);
    g.renderer.setSize(innerWidth, innerHeight);
    if (g.post?.setRenderSize) { const r = this.renderSize(); g.post.setRenderSize(fsr ? r.w : null, r.h); }
    else g.post?.resize?.(innerWidth, innerHeight);
  }

  frame(now) {
    if (this._last) {
      const raw = now - this._last;
      if (raw > STALL_MS) { this._win.length = 0; this._good = 0; if (this._check) this._check = now + CHECK_MS; }   // not a frame
      else {
        const d = Math.min(raw, 100);
        this.ms += (d - this.ms) * 0.08;
        if (this._win.length < 600) this._win.push(d);
      }
    }
    this._last = now;
    const pacer = this.game.pacer, floor = this._chaseFloor();
    if (pacer) pacer.hold = floor < 1 && !document.hidden && this.scale > floor + 1e-6;
    if (this._wantFsr() !== this.fsr) this.apply();   // a full-screen mode came or went: canvas sizing follows
    if (!this.enabled || document.hidden) { this._win.length = 0; return; }
    if (this._size !== innerWidth + 'x' + innerHeight) {   // resized: new ceiling, scale kept under it
      this._ceiling(); this._fails.clear();
      if (this.scale > this.cap + 1e-6) this._set(this.cap); else this.apply();
    }
    if (!this._check) { this._check = now + 2 * CHECK_MS; this._win.length = 0; return; }   // let shaders settle after start
    if (pacer?.probing) {   // a try at a faster cadence: measured at the floor scale, no other decision meanwhile
      if (!this._probeDrop && floor < 1 && this.scale > floor + 1e-6) { this._probeFrom = this.scale; this.scale = floor; this.apply(); }
      this._probeDrop = true; this._win.length = 0; this._good = 0; this._check = now + CHECK_MS;
      return;
    }
    this._probeDrop = false;
    if (now < this._check) return;
    this._check = now + CHECK_MS;
    // 60th percentile of the frames of the last second, not a smoothed average: a few long frames (shader
    // compiled, port entry, garbage collection) do not drop the resolution — each step resizes every render
    // target, i.e. one more hitch
    const chasing = floor < 1 && this.scale > floor + 1e-6 && this.scale <= 1 + 1e-6;
    const w = this._win.sort((a, b) => a - b), ms = w.length >= 8 ? w[Math.floor(w.length * (chasing ? 0.76 : 0.6))] : this.ms;
    this._win.length = 0;
    const T = pacer?.targetMs || 1000 / 60;
    const i = this.ladder.findIndex(s => s >= this.scale - 1e-6);
    const idx = i < 0 ? this.ladder.length - 1 : i;
    const slow = this.scale > 1 + 1e-6 || chasing ? T * 1.08 : Math.max(T * 1.08, 18);
    if (ms > slow && idx > 0) {
      // a scale that keeps failing is retried less and less often (20 s, 40 s … 5 min): each retry is a second of late frames
      const n = this._fails.get(this.ladder[idx]) || 0;
      this._fails.set(this.ladder[idx], n + 1);
      this._blocked.set(this.ladder[idx], now + 20000 * 2 ** Math.min(n, 4));
      this._set(this.ladder[idx - 1]); this._good = 0;
    } else if (idx < this.ladder.length - 1) {
      this._good = ms < T * 1.03 ? this._good + 1 : 0;
      const up = this.ladder[idx + 1];
      if (ms < T * 0.78 || (this._good >= 4 && !((this._blocked.get(up) || 0) > now))) { this._set(up); this._good = 0; }
    }
    this._remember(now);
  }

  _set(s) {
    if (Math.abs(s - this.scale) < 1e-6) return;
    // climbing back to the scale a try started from is not news for the pacer (its tries would never end)
    const back = this._probeFrom && s > this.scale && s <= this._probeFrom + 1e-6;
    if (!back || s >= this._probeFrom - 1e-6) this._probeFrom = 0;
    this.scale = s;
    this.apply();
    if (!back) this.game.pacer?.resetProbe();
  }
}
