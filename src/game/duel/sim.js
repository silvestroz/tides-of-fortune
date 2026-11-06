// Pure (no THREE, no DOM) sword-duel simulation. Deterministic given the RNG; runs headless in node
// (tools/test-duel.mjs) and drives the 3D DuelScene.
//
// The duel is fought along one line (the deck between two masts). The player fights from the low end (faces +x),
// the opponent from the high end (faces -x). Each fighter has a back limit (mast / quarterdeck rail): blocked blows,
// hits and the brawl of the crews push fighters back; a fighter driven past his limit is beaten ("pressed to the
// rail") just as surely as one who runs out of wounds.
//
// API:
//   const sim = new DuelSim({ rand, difficulty 0..1, crewPlayer, crewEnemy, length (m) })
//   sim.player / sim.enemy   Fighter { x, hp, maxHp, state, height, t, dur, momentum, face (+1|-1), limit }
//                                    | { dodge:'back'|'side'|'jump'|'duck' } | { taunt:true } | null.
//                                    Parry is held: send it every frame while held.
//   new DuelSim({ ..., weaponPlayer, weaponEnemy: 'rapier'|'cutlass'|'longsword', aiPace, aiRead })  (WEAPONS, DUEL_DIFFICULTY)
//   Fighter.stamina 0..STAMINA.max (swings, dodges and blocked blows spend it; an emptied guard breaks)
//   sim.step(dt)      advances; returns array of events [{ type, a, b, height, perfect? }]
//                     types: windup, strike, hit, parry, clash, whiff, evade, guardbreak, dodge, tired, feint, taunt,
//                     tauntDone {stun}, step, down, end
//   sim.over, sim.result { winner:'player'|'enemy', reason:'wounds'|'pressed'|'yield' }
//   sim.ai            AIController for the enemy (sim.step calls it unless sim.aiEnabled = false)
//   sim.pressure(f)   0..1 how close f is to his back limit (1 = at the limit)
import { SHIP_TYPES } from '../../data/shipTypes.js';
export const HEIGHTS = ['high', 'mid', 'low'];

export const TIMING = {
  windup: 0.30,       // player's wind-up; AI uses longer, telegraphed wind-ups on easy
  active: 0.11,       // blade travelling: contact resolves at the START of the strike phase
  recover: 0.30,
  whiffRecover: 0.42,
  parryRaise: 0.07,   // time to bring the guard to a new line
  perfect: 0.20,      // a parry raised within this long before contact is a perfect parry (riposte window)
  hitStun: 0.48,
  parriedStun: 0.50,
  perfectStun: 0.95,
  clashStun: 0.32,
  stepTime: 0.30,
  stepDist: 0.72,
  tauntTime: 1.0,
  range: 2.45,        // max distance a slash connects (+ weapon reach)
  minGap: 1.35,       // fighters never get closer than this
  // defence
  dodgeTime: 0.40,    // esquive (back / side): whole move
  dodgeIF: [0.03, 0.30], // invulnerable between these times of the move
  dodgeBack: 1.05,    // ground given by a back dodge (m)
  evadeTime: 0.46,    // jump (over a low cut) / duck (under a high cut)
  evadeIF: [0.05, 0.36],
  riposteWindow: 0.9, // after a perfect parry: the next wind-up within this is ...
  riposteWindup: 0.5, // ... this much faster
  guardBreakStun: 0.75, // a guard with no stamina left breaks
  tauntRange: 3.6,    // a taunt only rattles an opponent within this distance
  tauntStun: 0.85,    // stun of a successful taunt
};

// Weapons (chosen before the duel). Multipliers on wind-up / recovery, wound weight, push, stamina drained from a
// guard that blocks it, stamina cost of a swing, reach (m added to TIMING.range).
export const WEAPONS = {
  rapier:    { id: 'rapier',    name: 'Rapier',          windup: 0.78, recover: 0.8,  dmg: 1.0, push: 0.7,  guard: 0.7, stamina: 0.8,  reach: 0.15 },
  cutlass:   { id: 'cutlass',   name: 'Cutlass', windup: 1.0,  recover: 1.0,  dmg: 1.0, push: 1.0,  guard: 1.0, stamina: 1.0,  reach: 0 },
  longsword: { id: 'longsword', name: 'Longsword',      windup: 1.32, recover: 1.22, dmg: 1.6, push: 1.4,  guard: 1.7, stamina: 1.35, reach: 0.25 },
};
// Stamina: 0..max. Spent by swings, dodges and blocked blows; regenerates when idle (slower behind a guard).
// Swinging tired = slow wind-up; a guard emptied by a blocked blow breaks (stagger).
export const STAMINA = { max: 100, regen: 24, regenGuard: 11, delay: 0.45, attack: 12, dodge: 22, evade: 16, blocked: 13, perfectGain: 10, tiredWindup: 1.35 };
// Duel difficulty from game.state.difficulty: pace > 1 slows the AI's wind-ups and reactions, read shifts its chance
// to read the player's line. (Normal = 'mate'.)
export const DUEL_DIFFICULTY = {
  apprentice: { pace: 1.25, read: -0.15 },
  mate:       { pace: 1.12, read: -0.08 },   // normal: eased after playtest feedback ("fights are quite hard")
  captain:    { pace: 1.0,  read: 0 },
  admiral:    { pace: 0.92, read: 0.05 },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Fighter {
  constructor(id, face, x, limit, maxHp, weapon = 'cutlass') {
    this.id = id; this.face = face; this.x = x; this.limit = limit;
    this.hp = this.maxHp = maxHp;
    this.state = 'idle'; this.height = 'mid'; this.t = 0; this.dur = 0;
    this.momentum = 0;        // set by a finished taunt: next attack is faster and wounds twice
    this.intent = null;
    this.parryAge = 9;        // seconds the current parry line has been held
    this.stepDir = 0; this.stepFrom = x; this.stepTo = x;
    this.windupMul = 1;       // > 1 = slower, telegraphed wind-up (AI tells)
    this.stamina = STAMINA.max; this.staminaT = 9;   // time since stamina was last spent
    this.dodgeKind = null;    // 'back' | 'side' | 'jump' | 'duck' while state === 'dodge'
    this.riposteT = 0;        // > 0 after a perfect parry: faster wind-up
    this.setWeapon(weapon);
    this.stats = { attacks: 0, hits: 0, parries: 0, perfects: 0, taunts: 0, taken: 0, dodges: 0, stuns: 0, guardBreaks: 0 };
    this.lastHitT = -9;       // sim time of the last wound taken (for hit flashes)
    this.lastEvent = null;
  }
  setWeapon(id) { this.weapon = WEAPONS[id] || WEAPONS.cutlass; }
  get busy() { return !(this.state === 'idle' || this.state === 'parry'); }
  get invulnerable() {
    if (this.state !== 'dodge') return false;
    const w = this.dodgeKind === 'jump' || this.dodgeKind === 'duck' ? TIMING.evadeIF : TIMING.dodgeIF;
    return this.t >= w[0] && this.t <= w[1];
  }
  _spend(n) { this.stamina = Math.max(0, this.stamina - n); this.staminaT = 0; }
}

// crew-ratio weighting (tunable): ratio bounds, exponent on recoil and on wounds
export const CREW_RATIO_MIN = 0.6, CREW_RATIO_MAX = 1.6, CREW_PUSH_EXP = 0.8, CREW_DMG_EXP = 0.5;

export class DuelSim {
  constructor({ rand = Math.random, difficulty = 0.5, crewPlayer = 50, crewEnemy = 50, length = 9, playerHp, enemyHp,
    weaponPlayer = 'cutlass', weaponEnemy = 'cutlass', aiPace = 1, aiRead = 0 } = {}) {
    this.rand = rand;
    this.time = 0;
    this.length = length;
    const half = length / 2;
    // crew edge: -0.6..0.6, + favours the player. Better-manned side starts with more ground, more wounds to give
    // and the brawl behind them slowly presses the other captain back.
    this.edge = clamp((crewPlayer - crewEnemy) / Math.max(1, crewPlayer + crewEnemy), -0.6, 0.6);
    // crew ratio (player / enemy), bounded: scales the recoil and the wounds each captain deals and takes
    this.crewPlayer = crewPlayer; this.crewEnemy = crewEnemy;
    this.crewRatio = clamp(crewPlayer / Math.max(1, crewEnemy), CREW_RATIO_MIN, CREW_RATIO_MAX);
    const hpP = playerHp ?? clamp(Math.round(5 + this.edge * 3), 3, 7);
    const hpE = enemyHp ?? clamp(Math.round(4 + difficulty * 2 - this.edge * 3), 3, 7);
    const off = this.edge * 0.9;
    this.player = new Fighter('player', +1, -1.15 + off, -half, hpP, weaponPlayer);
    this.enemy = new Fighter('enemy', -1, 1.15 + off, half, hpE, weaponEnemy);
    this.player.opp = this.enemy; this.enemy.opp = this.player;
    this.over = false; this.result = null;
    this.difficulty = difficulty;
    this.ai = new AIController(this, this.enemy, difficulty, { pace: aiPace, read: aiRead });
    this.aiEnabled = true;
    this.events = [];
    this.crewPush = 0.05;     // m/s drift applied to the weaker side's captain by the general melee
  }

  pressure(f) {
    // 0 at start-ish, 1 at the limit
    const room = Math.abs(f.limit - f.x);
    return clamp(1 - room / (this.length * 0.5), 0, 1);
  }

  _enter(f, state, dur, height) {
    f.state = state; f.t = 0; f.dur = dur;
    if (height) f.height = height;
  }

  _push(f, dist) {
    // push fighter f backwards by dist (along his back direction)
    f.x -= f.face * dist;
    if (f.state === 'step' || f.state === 'dodge') { f.stepFrom -= f.face * dist; f.stepTo -= f.face * dist; }
  }

  _emit(e) { this.events.push(e); }

  _accept(f) {
    const it = f.intent;
    if (f.state === 'parry' && !(it && it.parry)) { f.state = 'idle'; f.t = 0; }
    if (!it) return;
    const w = f.weapon;
    if (it.attack) {
      const cost = STAMINA.attack * w.stamina;
      const tired = f.stamina < cost;
      const fast = (f.momentum > 0 ? 0.6 : 1) * (f.riposteT > 0 ? TIMING.riposteWindup : 1);
      this._enter(f, 'windup', TIMING.windup * f.windupMul * w.windup * fast * (tired ? STAMINA.tiredWindup : 1), it.attack);
      f._spend(Math.min(f.stamina, cost));
      f.riposte = f.riposteT > 0; f.riposteT = 0;
      f.stats.attacks++;
      this._emit({ type: 'windup', a: f, b: f.opp, height: it.attack, dur: f.dur, riposte: f.riposte });
      f.intent = null;
    } else if (it.parry) {
      if (f.state !== 'parry' || f.height !== it.parry) {
        f.parryAge = 0;
        f.state = 'parry'; f.t = 0; f.dur = 0; f.height = it.parry;
      }
    } else if (it.dodge) {
      const kind = it.dodge, evade = kind === 'jump' || kind === 'duck';
      const cost = evade ? STAMINA.evade : STAMINA.dodge;
      f.intent = null;
      if (f.stamina < cost * 0.5) { this._emit({ type: 'tired', a: f }); return; }
      f._spend(Math.min(f.stamina, cost));
      this._enter(f, 'dodge', evade ? TIMING.evadeTime : TIMING.dodgeTime);
      f.dodgeKind = kind; f.stepFrom = f.x; f.stepTo = f.x; f.stepDir = 0;
      if (kind === 'back') {
        let to = f.x - f.face * TIMING.dodgeBack;
        to = f.face > 0 ? Math.max(to, f.limit + 0.12) : Math.min(to, f.limit - 0.12);   // never dodge over the rail
        f.stepTo = to; f.stepDir = -1;
      }
      this._emit({ type: 'dodge', a: f, kind });
    } else if (it.step) {
      const dir = it.step;   // +1 toward the opponent, -1 back
      let to = f.x + f.face * dir * TIMING.stepDist;
      if (dir > 0) {
        const maxTo = f.opp.x - f.face * TIMING.minGap;
        to = f.face > 0 ? Math.min(to, maxTo) : Math.max(to, maxTo);
      }
      if (Math.abs(to - f.x) > 0.05) {
        this._enter(f, 'step', TIMING.stepTime); f.stepDir = dir; f.stepFrom = f.x; f.stepTo = to;
        this._emit({ type: 'step', a: f, dir });
      }
      f.intent = null;
    } else if (it.taunt) {
      this._enter(f, 'taunt', TIMING.tauntTime);
      f.stats.taunts++;
      this._emit({ type: 'taunt', a: f });
      f.intent = null;
    }
  }

  _resolveStrike(a) {
    const b = a.opp, aw = a.weapon;
    const dist = Math.abs(a.x - b.x);
    const h = a.height;
    a.lastAttackH = h;   // the AI's guard heuristic
    if (dist > TIMING.range + aw.reach || b.state === 'down') {
      this._enter(a, 'recover', TIMING.whiffRecover * aw.recover);
      this._emit({ type: 'whiff', a, b, height: h });
      return;
    }
    // dodges: back / side steps are safe from any line during their window; a jump clears only a low cut,
    // ducking only a high one (the wrong evasion is caught by the blade)
    if (b.invulnerable && (b.dodgeKind === 'back' || b.dodgeKind === 'side' || (b.dodgeKind === 'jump' && h === 'low') || (b.dodgeKind === 'duck' && h === 'high'))) {
      this._enter(a, 'recover', TIMING.whiffRecover * aw.recover * 1.15);   // overreached: an opening
      b.stats.dodges++;
      this._emit({ type: 'evade', a, b, height: h, kind: b.dodgeKind });
      return;
    }
    if (b.state === 'parry' && b.height === h && b.parryAge >= TIMING.parryRaise * 0.5) {
      // AI captains below 'hard' only land a share of their timely parries as perfect ones (b.perfectChance)
      const perfect = b.parryAge < TIMING.perfect && b.parryAge >= TIMING.parryRaise * 0.5 && !(b.perfectChance < 1 && this.rand() >= b.perfectChance);
      b.stats.parries++;
      a.momentum = 0;
      if (perfect) {
        b.stats.perfects++;
        this._enter(a, 'stagger', TIMING.perfectStun);
        this._push(a, 0.42);
        b.riposteT = TIMING.riposteWindow;
        b.stamina = Math.min(STAMINA.max, b.stamina + STAMINA.perfectGain);
        this._emit({ type: 'parry', a, b, height: h, perfect: true });
        return;
      }
      b._spend(STAMINA.blocked * aw.guard);
      if (b.stamina <= 0) {
        // guard broken: the blow is stopped but the defender reels
        b.stats.guardBreaks++;
        this._enter(a, 'recover', TIMING.recover * aw.recover);
        this._enter(b, 'stagger', TIMING.guardBreakStun);
        this._push(b, 0.38 * aw.push);
        this._emit({ type: 'guardbreak', a, b, height: h });
        return;
      }
      this._enter(a, 'stagger', TIMING.parriedStun);
      this._push(b, 0.22 * aw.push);   // a blocked blow still drives you back: the pressure game
      this._push(a, 0.08);
      this._emit({ type: 'parry', a, b, height: h, perfect: false });
      return;
    }
    if (b.state === 'strike' && b.height === h && b.t < TIMING.active) {
      this._enter(a, 'recover', TIMING.clashStun); this._enter(b, 'recover', TIMING.clashStun);
      this._push(a, 0.25); this._push(b, 0.25);
      this._emit({ type: 'clash', a, b, height: h });
      return;
    }
    // a wound
    // wound weight from the crew ratio and the weapon: fractional part carried over so it averages out
    const k = Math.pow(b === this.player ? 1 / this.crewRatio : this.crewRatio, CREW_DMG_EXP) * aw.dmg;
    a._dmgCarry = (a._dmgCarry || 0) + (a.momentum > 0 ? 2 : 1) * k;
    const dmg = Math.max(1, Math.floor(a._dmgCarry + 1e-6));
    a._dmgCarry = Math.max(0, a._dmgCarry - dmg);
    a.momentum = 0;
    a.stats.hits++; b.stats.taken++;
    const wrongGuard = b.state === 'parry' ? b.height : null;   // guarding, but on the wrong line
    b.hp = Math.max(0, b.hp - dmg);
    b.lastHitT = this.time;
    this._push(b, 0.62 * aw.push * Math.pow(b === this.player ? 1 / this.crewRatio : this.crewRatio, CREW_PUSH_EXP));
    this._emit({ type: 'hit', a, b, height: h, dmg, wrongGuard, evadeFail: b.state === 'dodge' ? b.dodgeKind : null });
    if (b.hp <= 0) this._finish(a, b, 'wounds');
    else this._enter(b, 'hit', TIMING.hitStun);
  }

  _finish(winner, loser, reason) {
    if (this.over) return;
    this.over = true;
    this._enter(loser, 'down', 99);
    this._enter(winner, 'victory', 99);
    this.result = { winner: winner.id, reason, time: this.time };
    this._emit({ type: 'down', a: loser, reason });
    this._emit({ type: 'end', winner: winner.id, reason });
  }

  _taunted(f) {
    // a finished taunt: momentum, and a chance to rattle an opponent within reach who is not busy attacking
    f.momentum = 1;
    const o = f.opp, dist = Math.abs(o.x - f.x);
    let stun = false;
    if (dist < TIMING.tauntRange && (o.state === 'idle' || o.state === 'parry' || o.state === 'step')) {
      const chance = clamp(0.5 + 0.3 * (f.hp / f.maxHp - o.hp / o.maxHp) - (o.id === 'enemy' ? this.difficulty * 0.2 : 0.1), 0.15, 0.85);
      if (this.rand() < chance) {
        stun = true; f.stats.stuns++;
        this._enter(o, 'stagger', TIMING.tauntStun); o.dazed = true;
      }
    }
    this._emit({ type: 'tauntDone', a: f, b: o, stun });
  }

  step(dt) {
    this.events = [];
    if (dt <= 0) return this.events;
    this.time += dt;
    if (!this.over && this.aiEnabled) this.ai.update(dt);
    for (const f of [this.player, this.enemy]) {
      f.t += dt;
      if (f.state === 'parry') f.parryAge += dt;
      if (f.riposteT > 0) f.riposteT = Math.max(0, f.riposteT - dt);
      // stamina regeneration (none while attacking / dodging / reeling)
      f.staminaT += dt;
      if (f.staminaT > STAMINA.delay && f.stamina < STAMINA.max) {
        const r = f.state === 'idle' || f.state === 'step' ? STAMINA.regen : f.state === 'parry' ? STAMINA.regenGuard : 0;
        f.stamina = Math.min(STAMINA.max, f.stamina + r * dt);
      }
      if (this.over) continue;
      switch (f.state) {
        case 'windup':
          if (f.feint && f.t >= f.dur - f.feint.at) { f.height = f.feint.to; f.feint = null; this._emit({ type: 'feint', a: f, b: f.opp, height: f.height }); }
          if (f.t >= f.dur) { this._enter(f, 'strike', TIMING.active); this._emit({ type: 'strike', a: f, b: f.opp, height: f.height }); this._resolveStrike(f); }
          break;
        case 'strike': if (f.t >= f.dur) this._enter(f, 'recover', TIMING.recover * f.weapon.recover); break;
        case 'recover': case 'hit': case 'stagger':
          if (f.t >= f.dur) { f.state = 'idle'; f.t = 0; f.dazed = false; }
          break;
        case 'step': {
          const k = Math.min(1, f.t / f.dur);
          const e = k * k * (3 - 2 * k);
          f.x = f.stepFrom + (f.stepTo - f.stepFrom) * e;
          if (k >= 1) { f.state = 'idle'; f.t = 0; }
          break;
        }
        case 'dodge': {
          const k = Math.min(1, f.t / (f.dur * 0.7));
          f.x = f.stepFrom + (f.stepTo - f.stepFrom) * (1 - (1 - k) * (1 - k));
          if (f.t >= f.dur) { f.state = 'idle'; f.t = 0; f.dodgeKind = null; }
          break;
        }
        case 'taunt':
          if (f.t >= f.dur) { f.state = 'idle'; f.t = 0; this._taunted(f); }
          break;
      }
      if (!f.busy && !this.over) this._accept(f);
    }
    if (this.over) return this.events;
    // the general melee: the weaker crew yields the deck slowly
    if (Math.abs(this.edge) > 0.02) {
      const loser = this.edge > 0 ? this.enemy : this.player;
      if (loser.state !== 'step' && loser.state !== 'dodge') this._push(loser, this.crewPush * Math.abs(this.edge) * dt);
    }
    // keep the gap
    const p = this.player, e = this.enemy;
    if (e.x - p.x < TIMING.minGap) {
      const over = TIMING.minGap - (e.x - p.x);
      // the one moving forward is blocked; otherwise share
      if (p.state === 'step' && p.stepDir > 0) p.x -= over;
      else if (e.state === 'step' && e.stepDir > 0) e.x += over;
      else { p.x -= over / 2; e.x += over / 2; }
    }
    // pressed past the back limit = beaten
    if (p.x < p.limit) this._finish(e, p, 'pressed');
    else if (e.x > e.limit) this._finish(p, e, 'pressed');
    return this.events;
  }

  yieldDuel(who = 'player') {
    const f = who === 'player' ? this.player : this.enemy;
    this._finish(f.opp, f, 'yield');
  }
}

// ------------------------------------------------------------------ AI
// difficulty 0..1. Tells: wind-ups are slower on easy (windupMul up to 1.7) and the AI reads the player's
// wind-up height with a probability that grows with difficulty, after a reaction delay.
// pace (DUEL_DIFFICULTY, > 1 = slower wind-ups and reactions) and read (added to the read chance) come from the
// game's difficulty setting.
export class AIController {
  constructor(sim, me, difficulty = 0.5, { pace = 1, read = 0 } = {}) {
    this.sim = sim; this.me = me; this.d = clamp(difficulty, 0, 1);
    this.pace = pace;
    me.windupMul = (1.7 - this.d * 0.65) * pace;
    this.reaction = (0.36 - this.d * 0.24) * pace;
    // below hard (d < 0.85): human-like jitter on the read and a capped perfect-parry rate, so a player who reads
    // the tells can win; hard captains (d >= 0.85) keep the original razor timing and always-perfect parries
    this.hard = this.d >= 0.85;
    this.jitter = this.hard ? 0 : 0.1 * (1 - this.d);
    me.perfectChance = this.hard ? 1 : 0.15 + this.d * 0.4;
    this.read = clamp(0.3 + this.d * 0.62 + read, 0.1, 0.95);
    this.aggr = (0.55 + this.d * 0.9) / pace;     // attack drive when idle in range
    this.think = 0; this.watchT = 0; this.guess = null; this.lastOppState = null;
    this.prefer = HEIGHTS[Math.floor(sim.rand() * 3)];
    this.feintChance = Math.max(0, this.d - 0.3) * 0.75 / (pace * pace);   // switch lines late in the wind-up
  }
  _attack(h) {
    const me = this.me;
    me.intent = { attack: h };
    me.feint = null;
    if (this.sim.rand() < this.feintChance) {
      const to = HEIGHTS.filter(x => x !== h)[Math.floor(this.sim.rand() * 2)];
      me.feint = { to, at: 0.1 + this.sim.rand() * 0.06 };
    }
  }
  update(dt) {
    const s = this.sim, me = this.me, op = me.opp, r = s.rand;
    if (me.busy) { me.intent = null; return; }
    // react to the opponent's wind-up
    if (op.state === 'windup') {
      if (this.lastOppState !== 'windup') { this.watchT = -this.jitter * r(); this.guess = null; }
      this.watchT += dt;
      if (this.watchT >= this.reaction) {
        if (!this.guess) {
          if (r() < this.read) this.guess = op.height;
          else this.guess = r() < 0.25 ? 'step' : HEIGHTS[Math.floor(r() * 3)];
        }
        // evasive guess: a back dodge if there is breath for it, else a plain step back
        if (this.guess === 'step') { me.intent = me.stamina >= STAMINA.dodge ? { dodge: 'back' } : { step: -1 }; this.guess = 'done'; }
        else if (this.guess === 'done') me.intent = null;
        else me.intent = { parry: this.guess };
      } else if (me.state === 'parry') me.intent = { parry: me.height };
      else me.intent = null;
      this.lastOppState = op.state;
      return;
    }
    this.lastOppState = op.state;
    this.think -= dt;
    if (this.think > 0) { if (me.state === 'parry') me.intent = { parry: me.height }; return; }
    this.think = 0.08 + r() * 0.12;
    const dist = Math.abs(me.x - op.x);
    const pressure = s.pressure(me);
    const winded = me.stamina < STAMINA.attack * me.weapon.stamina * 1.5;
    // punish an opening (stagger / taunt / recovery)
    const open = op.state === 'stagger' || op.state === 'taunt' || op.state === 'hit' || op.state === 'recover';
    if (dist > TIMING.range + me.weapon.reach - 0.1) {
      me.intent = { step: +1 };
      return;
    }
    if (open && r() < 0.35 + this.d * 0.6) { this._attack(this._pickHeight(op)); return; }
    if (pressure > 0.65 && r() < 0.5) { me.intent = { step: +1 }; return; }
    const rate = this.aggr * 0.2 * (winded ? 0.3 : 1);
    if (r() < rate) { this._attack(this._pickHeight(op)); return; }
    if (op.state === 'idle' && dist > 2.0 && me.hp > op.hp && r() < 0.02) { me.intent = { taunt: true }; return; }
    // otherwise keep a guard up (mid by default, the line the opponent last used)
    me.intent = r() < 0.55 + this.d * 0.3 ? { parry: op.lastAttackH || 'mid' } : null;
  }
  _pickHeight(op) {
    // avoid the line the opponent is guarding
    const r = this.sim.rand;
    let opts = HEIGHTS.filter(h => !(op.state === 'parry' && op.height === h));
    if (r() < 0.4) return this.prefer;
    return opts[Math.floor(r() * opts.length)] || 'mid';
  }
}

// ------------------------------------------------------------------ outcome (pure)
// Spoils of a won boarding: deterministic-ish from ship type + rand.
export const SHIP_GOLD = { sloop: [150, 500], schooner: [250, 700], brig: [400, 1100], merchantman: [800, 2600], frigate: [700, 1800], galleon: [1500, 4500] };
const SHIP_VOL = { sloop: 12, schooner: 18, brig: 26, merchantman: 60, frigate: 30, galleon: 70 };
for (const [id, t] of Object.entries(SHIP_TYPES)) { SHIP_GOLD[id] ||= t.gold; SHIP_VOL[id] ||= t.vol; }
export function boardingSpoils(type, rand = Math.random, { crewEnemy = 40, crewPlayer = 60, role = 'merchant' } = {}) {
  const [a, b] = SHIP_GOLD[type] || SHIP_GOLD.brig;
  const gold = Math.round(a + (b - a) * rand());
  const goods = ['sugar', 'tobacco', 'rum', 'cotton', 'cloth', 'spice', 'cocoa', 'coffee', 'indigo', 'hides', 'silver'];
  const cargo = {};
  const n = role === 'merchant' ? 3 : 1 + Math.floor(rand() * 2);
  const vol = SHIP_VOL[type] || 20;
  for (let i = 0; i < n; i++) {
    const g = goods[Math.floor(rand() * goods.length)];
    cargo[g] = (cargo[g] || 0) + Math.max(2, Math.round(vol * (0.3 + rand() * 0.7) / (g === 'silver' ? 6 : 1)));
  }
  // every ship feeds its own crew, so unlike the trade goods above (a random 1–3 picks) a prize always has some
  // provisions aboard — a few days' worth, scaled by crew size (31/10, retour joueur : butin en vivres trop rare)
  cargo.food = (cargo.food || 0) + Math.max(3, Math.round(crewEnemy * (0.2 + rand() * 0.35)));
  const prisoners = rand() < 0.35 ? 1 + Math.floor(rand() * 6) : 0;     // our own captured sailors below decks
  const recruits = Math.max(0, Math.round(crewEnemy * (0.15 + rand() * 0.3)));
  return { gold, cargo, prisoners, recruits };
}
export function defeatPenalty(gold, rand = Math.random) {
  return { goldLost: Math.round(gold * (0.4 + rand() * 0.2)), crewLostFrac: 0.3 + rand() * 0.2 };
}
