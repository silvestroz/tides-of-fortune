// Adaptive resolution. API: new DynRes(game); dynres.frame(nowMs) once per presented frame; dynres.scale (current
// renderer pixel ratio); dynres.cap (tier cap); dynres.enabled. ?dynres=0 disables (fixed pixel ratio = cap at 1.0),
// ?pr=N forces a fixed pixel ratio (also disables the controller).
// Tier caps: 'low' / 'medium' -> min(devicePixelRatio, 1); 'ultra' -> max(1.5, dpr); 'high' -> devicePixelRatio, but it starts at 1.0 and only
// climbs above 1 while the frame time holds. Every ~1 s the 60th percentile of the frame intervals of that second is checked:
//   > 18 ms  -> one step down (min 0.7)            < 13 ms -> one step up (never above the cap)
// With vsync a healthy frame reads ~16.7 ms (never < 13), so a sustained 4 s of < 17.2 ms also allows a step up,
// except to a scale that caused a drop in the last 20 s (no ping-pong at the 60 Hz edge).
// On a change it calls renderer.setPixelRatio + post.resize, so every post-processing target follows.
import { QUALITY } from './constants.js';
const MIN = 0.7, CHECK_MS = 1000;

export class DynRes {
  constructor(game) {
    this.game = game;
    const p = game.params, dpr = window.devicePixelRatio || 1;
    // 'ultra': ceiling max(prCap 1.5, dpr) — supersampling on a 1x screen, reached only while frames hold (the first
    // thing given back when a frame runs long, before any effect would be)
    this.cap = game.quality === 'ultra' ? Math.max(QUALITY.prCap || 1.5, dpr) : game.quality === 'high' ? Math.max(1, dpr) : Math.min(dpr, 1);
    this.ladder = [0.7, 0.8, 0.9, 1];
    for (let s = 1.25; s < this.cap - 0.01; s += 0.25) this.ladder.push(s);
    if (this.cap > 1) this.ladder.push(this.cap);
    this.ladder = this.ladder.filter(s => s <= this.cap + 1e-6);
    const forced = parseFloat(p.get('pr'));
    this.enabled = p.get('dynres') !== '0' && !(forced > 0);
    this.scale = forced > 0 ? forced : Math.min(1, this.cap);
    this.ms = 16.7;            // smoothed frame interval
    this._last = 0; this._check = 0; this._good = 0;
    this._win = [];             // intervals of the current check window (perf 24/10: decisions on a percentile)
    this._blocked = new Map();  // scale -> time until which raising to it is not allowed
  }

  apply() {
    const g = this.game;
    g.renderer.setPixelRatio(this.scale);
    g.renderer.setSize(innerWidth, innerHeight);
    g.post?.resize?.(innerWidth, innerHeight);
  }

  frame(now) {
    if (this._last) {
      const d = Math.min(now - this._last, 100);
      this.ms += (d - this.ms) * 0.08;
      if (this._win.length < 600) this._win.push(d);
    }
    this._last = now;
    if (!this.enabled || document.hidden) { this._win.length = 0; return; }
    if (!this._check) { this._check = now + 2 * CHECK_MS; this._win.length = 0; return; }   // let shaders settle after start
    if (now < this._check) return;
    this._check = now + CHECK_MS;
    // 60th percentile of the frames of the last second, not a smoothed average: a few long frames (shader
    // compiled, port entry, garbage collection) no longer drop the resolution — each step resizes every render
    // target, i.e. one more hitch
    const w = this._win.sort((a, b) => a - b), ms = w.length >= 8 ? w[Math.floor(w.length * 0.6)] : this.ms;
    this._win.length = 0;
    const i = this.ladder.findIndex(s => s >= this.scale - 1e-6);
    const idx = i < 0 ? this.ladder.length - 1 : i;
    if (ms > 18 && idx > 0) {
      this._blocked.set(this.ladder[idx], now + 20000);
      this._set(this.ladder[idx - 1]); this._good = 0;
    } else if (idx < this.ladder.length - 1) {
      this._good = ms < 17.2 ? this._good + 1 : 0;
      const up = this.ladder[idx + 1];
      if (ms < 13 || (this._good >= 4 && !((this._blocked.get(up) || 0) > now))) { this._set(up); this._good = 0; }
    }
  }

  _set(s) {
    if (Math.abs(s - this.scale) < 1e-6 || s < MIN - 1e-6) return;
    this.scale = s;
    this.apply();
  }
}
