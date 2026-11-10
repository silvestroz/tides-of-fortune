// Feedback of the land battle: positional, layered sounds of the fight and the officers' orders in speech bubbles.
// Built when a battle starts (after the HUD), disposed with it (DOM only; sounds from src/audio/town.js).
//   const fx = new LandFeedback(game, hudEl)
//   fx.event(e, sim, view)          a sim event: 'volley' (ragged musketry + “Fire!”), 'melee' (steel, scuffle, a cry),
//                                   'rout' (enemy: horn and drum, “They break!”; yours: “Hold the line!”), 'rally', 'end'
//   fx.order(units, target, sim, view)   the player's order shouted by the company's officer
//   fx.frame(dt, sim, view)         bubbles follow their companies; a horn and drum roll when your men take the square
//   fx.dispose()
// Listener: the point the camera looks at; pan by the side of the screen, gain by distance and zoom.
import { TownSounds } from '../../audio/town.js';
import { Bubbles } from '../sneak/feedback.js';

const ORDERS = {
  fire: { player: ['Give them a volley!', 'Fire!', 'Make ready… fire!'], enemy: ['Present… fire!', 'Fire at will!'] },
  melee: { player: ['At them, lads!', 'Cut them down!'], enemy: ['Hold fast!', 'Bayonets!'] },
  routMine: ['Hold the line, damn you!', 'Stand your ground!'],
  routThem: ['They break! After them!', 'They’re running!'],
  routEnemy: ['Fall back! Fall back!', 'Run for it!'],
  rally: ['Rally! Form on me!'],
  charge: ['Charge!', 'At them!'], march: ['Forward, march!', 'Move, lads!'], hold: ['Hold the square!'],
};
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class LandFeedback {
  constructor(game, hud) {
    this.game = game;
    this.el = document.createElement('div'); this.el.className = 'lb-fx'; hud.prepend(this.el);
    this.bubbles = new Bubbles(this.el);
    this.sounds = new TownSounds(game.audio);
    this._t = 0; this._cd = new Map(); this._volT = 0; this._melT = 0; this._hornT = -99; this._held = false;
  }

  _sp(view, x, z) {
    const c = view.cam, d = Math.hypot(x - c.x, z - c.z), p = view.project(x, z, 1);
    const zoom = clamp(220 / Math.max(60, c.dist), 0.45, 1.4);
    return { gain: clamp(1 / (1 + Math.max(0, d - 30) / 90), 0, 1) * zoom, pan: p.behind ? 0 : clamp((p.x / innerWidth) * 2 - 1, -0.9, 0.9) };
  }
  // an officer's shout above a company (at most one per company every few seconds)
  _shout(sim, view, u, lines, { cd = 6, force = false } = {}) {
    if (!u || !sim.alive(u) || (u.side === 'enemy' && !sim.visible(u, 'player'))) return;
    const last = this._cd.get(u.id) ?? -99;
    if (!force && this._t - last < cd) return;
    this._cd.set(u.id, this._t);
    const text = pick(lines);
    this.bubbles.say('u' + u.id, text, () => ({ x: u.x, z: u.z, y: 11 }), { kind: `lb-order ${u.side}`, life: 2.2 });
    this.sounds.voice(text, this._sp(view, u.x, u.z), { pitch: u.side === 'enemy' ? 0.82 : 0.95, urgent: true });
  }
  _near(sim, side, x, z) {
    let best = null, bd = Infinity;
    for (const u of sim.units) { if (u.side !== side || !sim.alive(u)) continue; const d = Math.hypot(u.x - x, u.z - z); if (d < bd) { bd = d; best = u; } }
    return best;
  }

  event(e, sim, view) {
    const S = this.sounds, u = e.unit;
    if (e.type === 'volley') {
      if (this._t - this._volT > 0.12) { this._volT = this._t; S.volley(this._sp(view, u.x, u.z), Math.ceil(u.n / 2)); }
      if (Math.random() < 0.5) this._shout(sim, view, u, ORDERS.fire[u.side] || ORDERS.fire.enemy, { cd: 9 });
    } else if (e.type === 'melee') {
      if (this._t - this._melT > 0.45) { this._melT = this._t; S.melee(this._sp(view, e.x, e.z)); }
      this._shout(sim, view, this._near(sim, 'player', e.x, e.z), ORDERS.melee.player, { cd: 7 });
      if (Math.random() < 0.4) this._shout(sim, view, this._near(sim, 'enemy', e.x, e.z), ORDERS.melee.enemy, { cd: 9 });
    } else if (e.type === 'rout') {
      if (u.side === 'enemy') {
        if (this._t - this._hornT > 4) { this._hornT = this._t; S.horn('rout'); }
        this._shout(sim, view, u, ORDERS.routEnemy, { force: true });
        this._shout(sim, view, this._near(sim, 'player', u.x, u.z), ORDERS.routThem, { cd: 4 });
      } else this._shout(sim, view, sim.units.find(q => q.side === 'player' && q.kind === 'officiers' && sim.alive(q)) || u, ORDERS.routMine, { force: true });
    } else if (e.type === 'rally') this._shout(sim, view, u, ORDERS.rally, { force: true });
    else if (e.type === 'end' && e.result?.winner === 'player') { S.horn('hold'); }
  }

  order(units, target, sim, view) {
    const u = units.find(q => sim.alive(q)); if (!u) return;
    this._shout(sim, view, u, target ? ORDERS.charge : ORDERS.march, { force: true });
  }

  frame(dt, sim, view) {
    if (!sim || !view) return;
    this._t += dt;
    // your men take the square: a horn call and a drum roll (again if it is lost and retaken)
    const held = view.squareState === 'held';
    if (held && !this._held && this._t - this._hornT > 8) {
      this._hornT = this._t;
      this.sounds.horn('hold');
      const m = sim.map.town, u = this._near(sim, 'player', m.x, m.z);
      this._shout(sim, view, u, ORDERS.hold, { force: true });
    }
    this._held = held;
    this.bubbles.update(dt, (x, z, y) => view.project(x, z, y));
  }

  get barks() { return this.bubbles.count; }

  dispose() { this.sounds.dispose(); this.bubbles.dispose(); this.el.remove(); this._cd.clear(); }
}
