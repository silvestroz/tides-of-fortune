// Perf overlay, toggled with F3 (e.code). Shows smoothed fps, frame ms, draw calls, triangles, programs, pixel ratio
// and quality tier. Hidden by default; when hidden the per-frame hook returns immediately (no DOM, no info reads).
// API: new PerfOverlay(game, parent); overlay.frame(nowMs) after rendering; overlay.visible.
// renderer.info is read after the frame; info.autoReset stays on, so the numbers are the last render() call's
// unless the overlay switches autoReset off while shown (it does, and resets per frame itself).
export class PerfOverlay {
  constructor(game, parent = document.body) {
    this.game = game;
    this.parent = parent;
    this.visible = false;
    this.el = null;
    this._ms = 16.7; this._last = 0; this._next = 0;
    addEventListener('keydown', e => {
      if (e.code !== 'F3' || e.repeat) return;
      e.preventDefault();
      this.toggle();
    });
  }

  toggle(v = !this.visible) {
    this.visible = v;
    const info = this.game.renderer.info;
    if (v && !this.el) {
      const el = this.el = document.createElement('div');
      el.className = 'tof-perf';
      el.style.cssText = 'position:absolute;top:4.2em;left:1em;z-index:50;pointer-events:none;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;' +
        'color:#f3e6c4;background:rgba(20,14,6,0.62);padding:4px 7px;border-radius:3px;white-space:pre;';
      this.parent.appendChild(el);
    }
    if (this.el) this.el.style.display = v ? 'block' : 'none';
    info.autoReset = !v;      // while shown: sum every render() of the frame (passes, wakes, shadows)
    if (v) { info.reset(); this._last = 0; }
  }

  // call once per presented frame, after all rendering
  frame(now) {
    if (!this.visible) return;
    const g = this.game, info = g.renderer.info;
    if (this._last) this._ms += (Math.min(now - this._last, 250) - this._ms) * 0.08;
    this._last = now;
    if (now >= this._next) {
      this._next = now + 250;
      const r = info.render, tris = r.triangles;
      const t = tris >= 1e6 ? (tris / 1e6).toFixed(2) + ' M' : (tris / 1e3).toFixed(1) + ' k';
      const dr = g.dynres;
      this.el.textContent =
        `${(1000 / this._ms).toFixed(0).padStart(3)} fps  ${this._ms.toFixed(1)} ms\n` +
        `calls ${r.calls}  tris ${t}\n` +
        `programs ${info.programs?.length ?? 0}\n` +
        `px ratio ${g.renderer.getPixelRatio().toFixed(2)}${dr ? (dr.enabled ? ` (dyn, cap ${dr.cap.toFixed(2)})` : ' (fixed)') : ''}  ${g.quality || ''}`;
    }
    info.reset();
  }
}
