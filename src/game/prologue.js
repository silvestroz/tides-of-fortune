// Playable prologue, offered when a new game is created (the hints' “Prologue” card: Commencer / Passer) and
// skippable at any time (“skip” button of the goal line).
// Steps (state.tutorials.goals.step, shown by the goal line of src/ui/hints.js):
//   'p-sail'   leave the roads: full sail (controller.sailStep 2)
//   'p-helm'   put the helm over: turn a quarter turn (accumulated heading PROLOGUE.turn rad)
//   'p-fire'   a crippled pirate sloop (PROLOGUE.target, at anchor, doesn't fire) lies offshore: a broadside that
//              hits it ('cannon:hit' with the player as attacker)
//   'p-strike' fire continues until she strikes her colours (hull < PROLOGUE.strikeAt → combat.strike):
//              first prize; boarding (B) is up to the player; then the ordinary goals ('visit').
// The target ship isn't saved: a game reloaded mid-prologue resumes with the ordinary goals.
// API: new Prologue(game, hints) · start() · skip() · poll() (4 times a second, from hints) · target · active
import { PROLOGUE } from '../data/hints.js';

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export class Prologue {
  constructor(game, hints) {
    this.game = game; this.hints = hints; this.target = null; this._hPrev = null;
    const ev = game.events;
    ev.on('cannon:hit', d => { if (d?.target && d.target === this.target && d.attacker === game.player && this.step() === 'p-fire') this.hints._advance('p-strike'); });
    ev.on('ship:struck', ({ ship } = {}) => { if (ship && ship === this.target && this.active) this._finish('struck'); });
    ev.on('ship:sunk', ({ ship } = {}) => { if (ship && ship === this.target && this.active) this._finish('sunk'); });
    // boarded before striking (the player took the initiative): also a prize
    ev.on('boarding:end', ({ enemy, result } = {}) => { if (enemy && enemy === this.target && this.active && result !== 'defeat') this._finish('boarded'); });
  }
  step() { return this.hints.goal()?.step || null; }
  get active() { return /^p-/.test(this.step() || ''); }

  start() { this.hints._advance('p-sail'); this.hints.trigger('sail'); }
  skip() {
    const t = this.target;
    if (t && t.alive && !t.struck && !t.sinking) this.game.removeShip(t);   // no motionless rover left behind offshore
    this.target = null;
    this.hints._advance('visit', { prologue: 'skipped' });
  }
  _finish(how) {
    const name = this.target?.name || PROLOGUE.target;
    this.hints._advance('visit', { prologue: how });
    this.game.events.emit('notify', { text: (how === 'sunk' ? PROLOGUE.doneSunk : how === 'boarded' ? PROLOGUE.doneBoarded : PROLOGUE.done)(name), kind: 'good', topic: 'rank' });
    this.target = how === 'struck' ? this.target : null;
  }

  poll() {
    const g = this.game, p = g.player, st = this.step(); if (!p || !/^p-/.test(st || '')) return;
    if (g.mode !== 'sail') return;
    if (st === 'p-sail') {
      if ((p.controller?.sailStep ?? 0) >= 2) { this.hints._advance('p-helm', { turned: 0 }); this._hPrev = p.heading; }
    } else if (st === 'p-helm') {
      const o = this.hints.goal();
      if (this._hPrev == null) this._hPrev = p.heading;
      o.turned = (o.turned || 0) + Math.abs(wrap(p.heading - this._hPrev)); this._hPrev = p.heading;
      if (o.turned >= PROLOGUE.turn) { this._spawn(); this.hints._advance('p-fire', { target: this.target?.name || PROLOGUE.target }); this.hints.trigger('guns'); }
    } else if (st === 'p-fire' || st === 'p-strike') {
      const t = this.target;
      if (!t || !t.alive) { this._spawn(); return; }   // game reloaded, target lost: a new rover
      if (st === 'p-strike' && !t.struck && t.hull / (t.hullMax || 1) < PROLOGUE.strikeAt) g.combat?.strike?.(t);
    }
  }

  // a pirate sloop at anchor, in open water ahead of the player (relief sounding), which neither manoeuvres nor fires
  _spawn() {
    const g = this.game, p = g.player, isl = g.islands, c = g.combat; if (!p || !c?.spawnAI) return null;
    const deep = (x, z) => !isl?.getTerrainHeight || [[0, 0], [60, 0], [-60, 0], [0, 60], [0, -60]].every(([dx, dz]) => isl.getTerrainHeight(x + dx, z + dz) < -7);
    let pos = null;
    for (const d of PROLOGUE.dist) {
      if (pos) break;
      for (const da of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4, Math.PI]) {
        const a = p.heading + da, x = p.position.x + Math.sin(a) * d, z = p.position.z - Math.cos(a) * d;
        if (deep(x, z)) { pos = { x, z, a }; break; }
      }
    }
    if (!pos) pos = { x: p.position.x + Math.sin(p.heading) * 600, z: p.position.z - Math.cos(p.heading) * 600, a: p.heading };
    const t = c.spawnAI({ type: PROLOGUE.type, faction: 'pirate', role: 'merchant', x: pos.x, z: pos.z, heading: pos.a + Math.PI / 2, sailSetting: 0, name: PROLOGUE.target });
    t.controller = { update() {} };   // at anchor: no manoeuvre, no fire (the AI is no longer updated)
    t.speed = 0; t.sailSetting = 0; t.hostile = true;
    // enough men not to be boardable before striking (combat._canBoard: fewer than half of ours)
    t.hull = t.hullMax * PROLOGUE.hull; t.crew = Math.max(Math.round(t.crewMax * PROLOGUE.crew), Math.ceil((p.crew || 0) * 0.5) + 2);
    t._captain = { name: PROLOGUE.captain, faction: 'pirate', difficulty: PROLOGUE.duel };   // boarding: easy duel
    t._prologue = true;
    this.target = t;
    g.events.emit('notify', { text: PROLOGUE.sighted(t.name), kind: 'info', topic: 'combat' });
    return t;
  }
}
