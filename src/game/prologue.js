// Playable prologue, offered when a new game is created and told by the first mate (src/ui/mateGuide.js: Begin /
// Skip), skippable at any time (“Skip the prologue” in the mate's panel). Four orders, each cleared by the player's
// action (state.tutorials.goals.step; texts in MATE, src/data/hints.js):
//   'p-sail'   order 1, sails and helm: full sail (controller.sailStep 2, o.sailed) and a quarter turn (accumulated
//              heading o.turned ≥ PROLOGUE.turn rad), in any order; then the target is spawned
//   'p-cam'    order 2, look around: C (a camera mode change asked by the player) or a right-drag orbit / zoom
//              (accumulated o.lookAmt ≥ PROLOGUE.look)
//   'p-fire'   order 3: a crippled pirate sloop (PROLOGUE.target, at anchor, doesn't fire) lies offshore: a broadside
//              that hits it ('cannon:hit' with the player as attacker) → 'p-strike' (same order: fire continues until
//              she strikes her colours, hull < PROLOGUE.strikeAt → combat.strike)
//   'p-board'  order 4: she has struck → boarding with B (up to the player, never automatic); 'boarding:end' ends it.
// Fallbacks: the target sinks ('ship:sinking') or vanishes (despawned far away, removed) → the prologue ends ('sunk' /
// 'lost') instead of staying stuck; boarding lost → 'defeat'. Ending → goals 'visit' and a farewell from the mate
// (this.bye, shown MATE.byeTime s by hints).
// The target carries `_prologue`: the other ships ignore her (src/combat/factions.js isHostile), so nobody else takes
// the player's first prize. It isn't saved: a game reloaded mid-prologue resumes with the ordinary goals.
// API: new Prologue(game, hints) · start() · skip() · poll() (4 times a second, from hints) · target · active · bye
import { PROLOGUE } from '../data/hints.js';

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export class Prologue {
  constructor(game, hints) {
    this.game = game; this.hints = hints; this.target = null; this._hPrev = null; this._cam = null; this.bye = null;
    const ev = game.events, mine = s => !!s && s === this.target && this.active;
    ev.on('cannon:hit', d => { if (d?.target && d.target === this.target && d.attacker === game.player && /^p-(cam|fire)$/.test(this.step())) this.hints._advance('p-strike'); });
    ev.on('ship:struck', ({ ship } = {}) => { if (mine(ship) && this.step() !== 'p-board') this.hints._advance('p-board'); });
    ev.on('ship:sinking', ({ ship } = {}) => { if (mine(ship)) this._finish('sunk'); });
    ev.on('ship:sunk', ({ ship } = {}) => { if (mine(ship)) this._finish('sunk'); });
    // boarded (after striking, or before: the player took the initiative): a prize, unless beaten back
    ev.on('boarding:end', ({ enemy, result } = {}) => { if (mine(enemy)) this._finish(result === 'defeat' ? 'defeat' : 'boarded'); });
    // order 2: C pressed by the player (automatic combat framing doesn't count)
    ev.on('camera:mode', ({ auto } = {}) => { const o = this.hints.goal(); if (!auto && o && this.step() === 'p-cam') o.looked = true; });
  }
  step() { return this.hints.goal()?.step || null; }
  get active() { return /^p-/.test(this.step() || ''); }

  start() {
    this.game.combat?.shipReady?.(PROLOGUE.type, 'pirate');   // the target's model is built in the background meanwhile
    this.bye = null; this._hPrev = null; this.hints._advance('p-sail', { sailed: false, turned: 0 });
  }
  skip() {
    const t = this.target;
    if (t && t.alive && !t.struck && !t.sinking) this.game.removeShip(t);   // no motionless rover left behind offshore
    this.target = null; this.bye = null;
    this.hints._advance('visit', { prologue: 'skipped' });
  }
  _finish(how) {
    const t = this.target, name = t?.name || PROLOGUE.target;
    this.bye = { how, name, t: 0 };
    this.hints._advance('visit', { prologue: how });
    if (how === 'lost' && t && this.game.ships.includes(t)) this.game.removeShip(t);
    this.target = how === 'boarded' || how === 'sunk' || how === 'lost' ? null : t;
  }

  poll() {
    const g = this.game, p = g.player, st = this.step(); if (!p || !/^p-/.test(st || '')) return;
    if (g.mode !== 'sail') return;
    const o = this.hints.goal();
    if (st === 'p-sail') {
      if ((p.controller?.sailStep ?? 0) >= 2) o.sailed = true;
      if (this._hPrev == null) this._hPrev = p.heading;
      o.turned = Math.min(PROLOGUE.turn, (o.turned || 0) + Math.abs(wrap(p.heading - this._hPrev))); this._hPrev = p.heading;
      if (o.sailed && o.turned >= PROLOGUE.turn) { this._spawn(); this._cam = null; this.hints._advance('p-cam', { target: this.target?.name || PROLOGUE.target, looked: false, lookAmt: 0 }); }
    } else if (st === 'p-cam') {
      // right-drag orbit or wheel zoom: accumulated (the rig eases its offsets back to 0 by itself)
      const r = g.cameraRig;
      if (r) {
        const c = this._cam;
        if (c) o.lookAmt = (o.lookAmt || 0) + Math.abs(wrap(r.orbitYaw - c.y)) + Math.abs(r.orbitPitch - c.p) + Math.abs(r.zoom - c.z);
        this._cam = { y: r.orbitYaw, p: r.orbitPitch, z: r.zoom };
        if (o.lookAmt >= PROLOGUE.look) o.looked = true;
      }
      if (o.looked) this.hints._advance('p-fire');
    } else {
      const t = this.target;
      // game reloaded, or the target despawned far away (game.removeShip leaves `alive` set) / removed: no dead end
      if (!t || !t.alive || !g.ships.includes(t)) return t?.sunk ? this._finish('sunk') : this._finish('lost');
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
    t._prologue = true;   // the other ships leave her alone (factions.isHostile)
    this.target = t;
    return t;
  }
}
