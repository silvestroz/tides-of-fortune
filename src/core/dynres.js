// Adaptive resolution. API: new DynRes(game); dynres.frame(nowMs) once per presented frame; dynres.scale (current
// renderer pixel ratio); dynres.cap (ceiling); dynres.enabled. ?dynres=0 disables (fixed pixel ratio = min(1, cap)),
// ?pr=N forces a fixed pixel ratio (also disables the controller).
// Ceiling = min(tier cap, pixel budget):
//   tier cap: 'low' / 'medium' -> min(devicePixelRatio, 1); 'ultra' -> max(1.5, dpr); 'high' -> max(1, dpr);
//   pixel budget: QUALITY.maxMpx megapixels rendered (2.2 / 2.8 / 3.7 / 8.3 by tier), so a 4K or wide screen is
//   rendered at a lower ratio and scaled up instead of paying for every pixel. Recomputed when the window resizes.
// It starts at min(1, ceiling). Every ~1 s the 60th percentile of the frame intervals of that second is compared with
// the target interval T = game.pacer.targetMs (display refresh x presented cadence, 16.7 ms at 60 Hz):
//   above the native ratio (scale > 1): > 1.08 T -> one step down
//   at or below it: > max(1.08 T, 18 ms) -> one step down (a fast screen's rate is never chased below native:
//     the frame pacer halves the cadence instead; resolution only defends ~55 fps)
//   < 0.78 T -> one step up; a sustained 4 s under 1.03 T (vsync-bound) also allows a step up, except to a scale
//   that caused a drop in the last 20 s (no ping-pong at the edge). Never above the ceiling.
// No decision while the pacer tries a faster cadence (pacer.probing); a change resets the pacer's tries.
// Upscaling: below the output ratio (outPr = min(dpr, 2) in Standard/Ultra, min(dpr, 1) in Performance), while the
// post chain draws the sea (no renderOverride, ?fsr != 0), the canvas stays at outPr and the post chain renders at
// `scale` then FSR 1 upsamples (post.setRenderSize, src/post/fsrPass.js): sharp edges instead of a browser stretch.
// Otherwise (supersampling, full-screen modes with their own render, FSR off) the canvas itself is sized at `scale`,
// as before. dynres.fsr tells which; dynres.renderSize() = { w, h } actually rendered.
// On a change it calls renderer.setPixelRatio + post.resize, so every post-processing target follows.
import { QUALITY } from './constants.js';
const CHECK_MS = 1000, STEPS = [0.7, 0.8, 0.9, 1, 1.25, 1.5, 1.75, 2];

export class DynRes {
  constructor(game) {
    this.game = game;
    const p = game.params;
    const forced = parseFloat(p.get('pr'));
    this.enabled = p.get('dynres') !== '0' && !(forced > 0);
    this._noFsr = p.get('fsr') === '0';
    this.fsr = false;
    this._size = '';
    this._ceiling();
    this.scale = forced > 0 ? forced : Math.min(1, this.cap);
    this.ms = 16.7;            // smoothed frame interval
    this._last = 0; this._check = 0; this._good = 0;
    this._win = [];             // intervals of the current check window (decisions on a percentile)
    this._blocked = new Map();  // scale -> time until which raising to it is not allowed
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

  _wantFsr() {
    const g = this.game;
    return !this._noFsr && !!g.post?.enabled && !g.renderOverride && this.scale < this.outPr * 0.95;
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
      const d = Math.min(now - this._last, 100);
      this.ms += (d - this.ms) * 0.08;
      if (this._win.length < 600) this._win.push(d);
    }
    this._last = now;
    if (this._wantFsr() !== this.fsr) this.apply();   // a full-screen mode came or went: canvas sizing follows
    if (!this.enabled || document.hidden) { this._win.length = 0; return; }
    if (this._size !== innerWidth + 'x' + innerHeight) {   // resized: new ceiling, scale kept under it
      this._ceiling();
      if (this.scale > this.cap + 1e-6) this._set(this.cap); else this.apply();
    }
    if (!this._check) { this._check = now + 2 * CHECK_MS; this._win.length = 0; return; }   // let shaders settle after start
    if (now < this._check) return;
    this._check = now + CHECK_MS;
    const pacer = this.game.pacer;
    if (pacer?.probing) { this._win.length = 0; return; }
    // 60th percentile of the frames of the last second, not a smoothed average: a few long frames (shader
    // compiled, port entry, garbage collection) do not drop the resolution — each step resizes every render
    // target, i.e. one more hitch
    const w = this._win.sort((a, b) => a - b), ms = w.length >= 8 ? w[Math.floor(w.length * 0.6)] : this.ms;
    this._win.length = 0;
    const T = pacer?.targetMs || 1000 / 60;
    const i = this.ladder.findIndex(s => s >= this.scale - 1e-6);
    const idx = i < 0 ? this.ladder.length - 1 : i;
    const slow = this.scale > 1 + 1e-6 ? T * 1.08 : Math.max(T * 1.08, 18);
    if (ms > slow && idx > 0) {
      this._blocked.set(this.ladder[idx], now + 20000);
      this._set(this.ladder[idx - 1]); this._good = 0;
    } else if (idx < this.ladder.length - 1) {
      this._good = ms < T * 1.03 ? this._good + 1 : 0;
      const up = this.ladder[idx + 1];
      if (ms < T * 0.78 || (this._good >= 4 && !((this._blocked.get(up) || 0) > now))) { this._set(up); this._good = 0; }
    }
  }

  _set(s) {
    if (Math.abs(s - this.scale) < 1e-6) return;
    this.scale = s;
    this.apply();
    this.game.pacer?.resetProbe();
  }
}
