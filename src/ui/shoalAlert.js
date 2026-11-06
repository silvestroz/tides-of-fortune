// Shoal warning: sounds the seabed ahead of the player's keel (bow + a look-ahead along the
// course that grows with speed) and shows a HUD alert when the water under the keel gets thin, before grounding.
// Same grounding rule as Ship (terrain > −draft × 0.85). API: new ShoalAlert(game, hudEl), update(real)
import { TOAST_ICONS } from './toasts.js';
const WARN = 4.0, DANGER = 1.5;   // metres of water under the keel

export class ShoalAlert {
  constructor(game, hudEl) {
    this.game = game;
    const el = this.el = document.createElement('div');
    el.className = 'shoal-alert off tof-parch';
    el.innerHTML = `<span class="sa-ico">${TOAST_ICONS.shoal}</span><span><b>Shallows!</b> <span class="sa-txt"></span></span>`;
    hudEl.appendChild(el);
    this.txt = el.querySelector('.sa-txt');
    this._t = 0; this._state = 'off'; this._hold = 0;
  }
  _clearance() {
    const g = this.game, p = g.player, isl = g.islands;
    if (!p || !isl?.getTerrainHeight || g.mode !== 'sail') return Infinity;
    const keel = p.keel ?? -(p.draft || 3) * 0.85;   // shallow-draft hulls use a fixed −0,45 m keel
    const sh = Math.sin(p.heading), ch = Math.cos(p.heading), L = p.length || 30;
    const spd = Math.max(0, p.speed || 0);
    const reach = L * 0.5 + Math.min(160, 20 + spd * 7);
    let best = Infinity;
    for (let i = 0; i <= 8; i++) {
      const d = (i / 8) * reach;
      for (const off of [-0.3, 0, 0.3]) {          // a little to each side of the course
        const x = p.position.x + sh * d + ch * off * (p.beam || 8), z = p.position.z - ch * d + sh * off * (p.beam || 8);
        const t = isl.getTerrainHeight(x, z);
        if (t > 0.5) continue;                       // dry land is the coast, not a shoal (the ship reads that itself)
        best = Math.min(best, keel - t);
      }
    }
    return best;
  }
  update(real) {
    this._t -= real; if (this._t > 0) return; this._t = 0.25;
    const c = this._clearance();
    const st = c < DANGER ? 'danger' : c < WARN ? 'warn' : 'off';
    if (st !== 'off') this._hold = 1.0; else if ((this._hold -= 0.25) > 0) return;
    const dr = `draught ${(this.game.player?.draft || 0).toFixed(1)} m`;   // non-breaking
    const txt = (c <= 0 ? 'The keel touches the bottom' : `${Math.max(0, c).toFixed(1)} m under the keel`) + ` · ${dr}`;
    if (this._txt !== txt && st !== 'off') { this._txt = txt; this.txt.textContent = txt; }
    if (st !== this._state) { this._state = st; this.el.className = `shoal-alert tof-parch ${st}`; }
  }
}
