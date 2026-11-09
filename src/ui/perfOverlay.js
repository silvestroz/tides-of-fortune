// Perf overlay, toggled with F3 (e.code). Shows smoothed fps, frame ms, draw calls, triangles, programs, screen
// refresh rate and presented cadence (game.pacer), pixel ratio and its ceiling (game.dynres), rendered size, quality
// tier and GPU name. Shift+F3 copies the same text plus browser and screen details and the state of the player's ship
// (mode, controller, sails, speed and its factors, aground, repairs) to the clipboard, so a player can paste it in a
// bug report. Hidden by default; when hidden the per-frame hook returns immediately (no DOM, no info reads).
// API: new PerfOverlay(game, parent); overlay.frame(nowMs) after rendering; overlay.visible; overlay.report() -> text.
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
      if (e.shiftKey) { this.copy(); return; }
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

  copy() {
    const text = this.report();
    const done = ok => this.game.events.emit('notify', { text: ok ? 'Performance details copied: paste them in your message.' : 'Could not copy the performance details.', kind: ok ? 'info' : 'bad', topic: 'info' });
    try { navigator.clipboard.writeText(text).then(() => done(true), () => done(false)); } catch { done(false); }
  }

  report() {
    const g = this.game, dr = g.dynres, pc = g.pacer, r = g.renderer, info = this._info || r.info.render;
    const rs = dr ? dr.renderSize() : null, w = rs ? rs.w : Math.round(innerWidth * r.getPixelRatio()), h = rs ? rs.h : Math.round(innerHeight * r.getPixelRatio());
    return [
      `Tides of Fortune — ${g.quality || '?'} quality, frame rate ${g.settings?.fps || 'auto'}`,
      `fps ${(1000 / this._ms).toFixed(0)} (${this._ms.toFixed(1)} ms)` + (pc ? `, screen ${pc.hz} Hz, every ${pc.div > 1 ? pc.div + ' refreshes' : 'refresh'}` : ''),
      `rendered ${w}×${h} for ${innerWidth}×${innerHeight} css px, dpr ${window.devicePixelRatio || 1}, scale ${(dr?.scale ?? r.getPixelRatio()).toFixed(2)}${dr ? (dr.enabled ? ` (dynamic, cap ${dr.cap.toFixed(2)})` : ' (fixed)') : ''}${dr?.fsr ? `, FSR to ${Math.round(innerWidth * dr.outPr)}×${Math.round(innerHeight * dr.outPr)}` : ''}`,
      `calls ${info.calls}, triangles ${info.triangles}, programs ${r.info.programs?.length ?? 0}`,
      `screen ${screen.width}×${screen.height}, GPU ${this._gpu()}`,
      this._shipState(),
      `browser ${navigator.userAgent}`,
    ].join('\n');
  }

  // the player's ship and the modes that can hold it still: to diagnose a ship that does not answer from a pasted report
  _shipState() {
    const g = this.game, p = g.player;
    if (!p) return `mode ${g.mode}, no ship`;
    const f = v => (v ?? 1).toFixed(2);
    return `mode ${g.mode}${g.frozen ? ' frozen' : ''}, time ×${g.timeScale}, boarding ${!!g.boarding?.active}, duel ${!!g.duel?.active}, ` +
      `controller ${p.controller?.constructor?.name || 'none'}, sail ${f(p.sailSetting)}, speed ${p.speed.toFixed(2)} / ${(p.targetSpeed ?? 0).toFixed(2)} m/s, ` +
      `hull ${Math.round(p.hull / p.hullMax * 100)} %, sails ${Math.round((p.sails ?? 1) * 100)} %, crew ${Math.round(p.crew)}, ` +
      `factors combat ${f(p.combatSpeedF)} load ${f(p.loadSpeedF)} weather ${f(p.weatherSpeedF)}, ` +
      `${p.grounded ? (p._groundBow ? 'aground (bow)' : 'aground') : 'afloat'}${p.repairing ? ', repairing' : ''}${p.struck ? ', struck' : ''}, ` +
      `at ${Math.round(p.position.x)}, ${Math.round(p.position.z)}`;
  }

  _gpu() {
    if (this._gpuName == null) {
      try { const gl = this.game.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); this._gpuName = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); } catch { this._gpuName = '?'; }
    }
    return this._gpuName;
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
      this._info = { calls: r.calls, triangles: tris };   // for report(): renderer.info is reset after each frame
      const t = tris >= 1e6 ? (tris / 1e6).toFixed(2) + ' M' : (tris / 1e3).toFixed(1) + ' k';
      const dr = g.dynres, pc = g.pacer, pr = dr ? dr.scale : g.renderer.getPixelRatio();
      this.el.textContent =
        `${(1000 / this._ms).toFixed(0).padStart(3)} fps  ${this._ms.toFixed(1)} ms\n` +
        (pc ? `screen ${pc.hz} Hz  ${pc.div > 1 ? '1 image / ' + pc.div : 'every refresh'}  ${g.settings?.fps || 'auto'}\n` : '') +
        `calls ${r.calls}  tris ${t}\n` +
        `programs ${info.programs?.length ?? 0}\n` +
        `scale ${pr.toFixed(2)}${dr ? (dr.enabled ? ` (dyn, cap ${dr.cap.toFixed(2)})` : ' (fixed)') : ''}${dr?.fsr ? ' FSR' : ''}  ${g.quality || ''}\n` +
        `${Math.round(innerWidth * pr)}×${Math.round(innerHeight * pr)}  ${this._gpu().replace(/^ANGLE \((.*)\)$/, '$1').slice(0, 48)}\n` +
        `Shift+F3: copy`;
    }
    info.reset();
  }
}
