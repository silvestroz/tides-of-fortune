// AI ship controllers. A controller is assigned to ship.controller (and ship.ai) and is ticked by Ship.update.
//   new AIController(game, ship, role)   role: 'merchant' | 'patrol' | 'pirate' | 'hunter'
//   controller.update(dt)                drives ship.desiredHeading (-> ship.steerToward -> rudder), ship.sailSetting,
//                                         ship.ammo and calls game.combat.fireBroadside
//   controller.state                     'cruise' | 'engage' | 'flee' | 'struck' | 'sinking'
//   controller.target                    Ship being engaged / fled from (or null)
//   controller.waypoint                  {x, z} cruise destination (merchants: a port harborPoint)
//   controller.setTarget(ship)           force an engagement (e.g. scripted scenes)
//   controller.hold                      bool: if true the AI does not steer (scripted shots); still fires if fireAtWill
//   controller.fireAtWill                bool (default true)
//   controller.defendOnly                bool: escort in guarded waters (combat.spawnConvoy): defends its charge, looks
//                                         for no other prey (unless it bears a grudge)
//   Sea tiers (src/data/seaZones.js, game.seaZones.forbids): an aggressor neither takes on nor chases a target in a
//   zone closed to it (too heavy for the tier, or a Top 10 captain in guarded waters), unless that target has just
//   hit it (BORDER.provoked); its cruising points avoid those zones.
//   PERSONA[role]                        role personality (courage, strike/flee thresholds, preferred range, tactics)
//   controller.morale                    0..~1.2 current fighting will (hull, crew ratio vs foe, sails, courage)
//   controller.fearless                  bool: never flees/strikes (test bots)
//   controller.guardOf                   Ship this AI escorts (convoys, combat.spawnConvoy): keeps station on its
//                                        quarter and engages whoever attacks it; the charge lists them in ship.guards.
//                                        A guarded merchant fights alongside its escort instead of fleeing (until hurt).
// Personalities: merchants run at first sight and strike when caught; warships (patrol/hunter) fight for the
//   weather gauge (windward of the foe), keep round-shot range and switch to chain on a fleeing target;
//   pirates close fast, use grape inside ~110 m and threaten to grapple a weakened player (only a threat: the
//   player alone decides boarding with B).
// Behaviour summary:
//   merchants sail port-to-port (islands.ports[].harborPoint), avoid land with look-ahead probes (islands.isLand),
//   run from hostiles and strike quickly when caught. Patrols attack enemies of their nation and pirates.
//   Pirates/hunters chase weaker prey. In combat ships pick the beam heading that brings a loaded broadside to bear,
//   prefer crossing the enemy's bow/stern (raking), keep a stand-off range suited to their ammo, never steer
//   into irons (tack at ~50° off the wind instead), flee when badly hurt and strike when the odds are hopeless.
import { wrapAngle, headingFromVector } from '../core/constants.js';
import { theShip } from '../core/i18n.js';
import { WEATHER } from '../world/weatherZones.js';
import { BORDER, fightStrength } from '../data/seaZones.js';

const NO_GO = 0.85;            // rad off the wind (~49°) — closest sensible course
const SCAN_RANGE = { merchant: 650, patrol: 1000, pirate: 1100, hunter: 1500 };
// a fleeing merchant only calms down beyond SCAN_RANGE × MERCHANT_CLEAR, then avoids its pursuer for MERCHANT_WARY_S s
const MERCHANT_CLEAR = 2.2, MERCHANT_WARY_S = 60;
const PROBES = [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.5, -1.5, 2.0, -2.0, 2.6, -2.6, Math.PI];

export const PERSONA = {
  merchant: { courage: 0.15, strikeAt: 0.8, fleeHull: 1, fleeCrew: 1, fleeOdds: 99, rangeK: 0.3 },
  patrol:   { courage: 0.75, strikeAt: 0.5, fleeHull: 0.25, fleeCrew: 0.25, fleeOdds: 0.3, rangeK: 0.3, windward: true },
  hunter:   { courage: 0.85, strikeAt: 0.45, fleeHull: 0.2, fleeCrew: 0.2, fleeOdds: 0.25, rangeK: 0.33, windward: true },
  pirate:   { courage: 1.0, strikeAt: 0.45, fleeHull: 0.3, fleeCrew: 0.2, fleeOdds: 0.3, minStrikeHull: 0.3, rangeK: 0.25, closer: true },
};

const strength = fightStrength;   // src/data/seaZones.js (same formula as the HUD's threat pill)

export class AIController {
  constructor(game, ship, role = 'merchant') {
    this.game = game; this.ship = ship; this.role = role;
    this.state = 'cruise';
    this.target = null;
    this.waypoint = null;
    this.hold = false;
    this.fireAtWill = true;
    this._scanT = Math.random() * 1.5;
    this._steerT = 0;
    this._avoid = 0;          // current avoidance offset (rad) for hysteresis
    this._side = null;        // preferred engagement side
    this._sideT = 0;
    this._tackDir = Math.random() < 0.5 ? 1 : -1;
    this._wanderT = 0;
    this._home = { x: ship.position.x, z: ship.position.z };
    this.persona = PERSONA[role] || PERSONA.patrol;
    this.morale = 1;
    this.fearless = false;
    this._grappleWarned = null;
    this.guardOf = null;      // convoy escort duty (see header)
    this.guardSlot = { x: 0, z: 0 };   // station in the charge's frame: x = starboard, z = ahead (m)
  }

  // ---- convoys: an escorted merchant (living escort within 900 m) fights with it; escorts defend their charge
  _guarded() {
    const s = this.ship;
    return !!s.guards?.some(g => g.alive && !g.sunk && !g.sinking && !g.struck && Math.hypot(g.position.x - s.position.x, g.position.z - s.position.z) < 900);
  }
  // who is attacking our charge (its engaged/fled target, or the last ship that fired on it)
  _chargeFoe(c) {
    const ok = t => t && t !== this.ship && t.alive && !t.sunk && !t.sinking && !t.struck
      && Math.hypot(t.position.x - c.position.x, t.position.z - c.position.z) < 1300;
    const a = c.ai && (c.ai.state === 'flee' || c.ai.state === 'engage') ? c.ai.target : null;
    if (ok(a)) return a;
    const l = c.lastAttacker;
    return ok(l) && c.grudges?.has(l) ? l : null;
  }

  // fighting will: high = keeps fighting. Hull, crew ratio vs the foe, rigging, fires and the role's courage.
  _will(t) {
    const s = this.ship;
    const hf = s.hull / s.hullMax, cr = s.crew / Math.max(1, t?.crew ?? s.crew);
    return hf * 0.55 + Math.min(1.2, cr) * 0.35 * (0.4 + 0.6 * hf) + s.sails * 0.1 + this.persona.courage * 0.3 - (s.fires?.length || 0) * 0.04
      - (s.crew < s.crewMax * 0.15 ? 0.2 : 0);
  }

  setTarget(t) { this.target = t; this.state = t ? 'engage' : 'cruise'; }
  // sea tiers: this ship has just been hit by o (retaliation allowed even in a zone closed to it)
  _provoked(o) { const s = this.ship; return s.lastAttacker === o && this.game.time - (s.lastHitT ?? -1e9) < BORDER.provoked; }

  update(dt) {
    const s = this.ship, g = this.game, combat = g.combat;
    if (!s.alive || s.sunk) return;
    if (s.sinking) { this.state = 'sinking'; s.desiredHeading = null; s.rudder = 0; s.sailSetting = 0; return; }
    if (s.struck) { this.state = 'struck'; s.desiredHeading = null; s.rudder = 0; s.sailSetting = 0; return; }

    // --- perception ---
    this._scanT -= dt;
    if (this._scanT <= 0) { this._scanT = 1.2 + Math.random() * 0.6; this._scan(); }
    const t = this.target;
    if (t && (!t.alive || t.sunk || t.sinking || t.struck)) { this.target = null; this.state = 'cruise'; }

    // --- morale ---
    if (this.target) {
      this.morale = this._will(this.target);
      if (this.fearless) this.state = 'engage';
      else if (this.state !== 'flee') {
        const P = this.persona, hf = s.hull / s.hullMax, cf = s.crew / s.crewMax;
        const odds = strength(s) / strength(this.target);
        const flee = this.role === 'merchant' ? !this._guarded() || hf < 0.45 || cf < 0.3       // escorted: fights alongside
          : hf < P.fleeHull || cf < P.fleeCrew || (odds < P.fleeOdds && !this.guardOf);           // escorts stand by their charge
        if (flee) this.state = 'flee';
        else this.state = 'engage';
      }
      if (!this.fearless) this._maybeStrike(dt);
    } else this.morale = Math.min(1, this.morale + dt * 0.01);
    if (s.struck) return;

    // --- behaviour ---
    let want;
    if (this.state === 'engage' && this.target) want = this._engage(dt);
    else if (this.state === 'flee' && this.target) want = this._flee();
    else want = this._cruise(dt);
    // a merchant that just escaped does not turn back into its pursuer (no flee / cruise ping-pong)
    if (this.state === 'cruise' && this._wary) want = this._steerClearOf(want, dt);

    if (!this.hold) {
      want = this._avoidStorms(want);
      want = this._avoidIrons(want);
      want = this._avoidLand(want);
      want = this._avoidShips(want);
      s.desiredHeading = want;
    }

    // --- guns: fire any loaded side that bears on an enemy ---
    if (this.fireAtWill) this._gunnery(combat);
  }

  // ------------------------------------------------------------- perception
  _scan() {
    const s = this.ship, g = this.game, combat = g.combat;
    const R = SCAN_RANGE[this.role] || 900;
    let best = null, bestScore = Infinity, threat = null, threatD = Infinity;
    const myStr = strength(s);
    // escort duty: the charge's attacker comes first, whatever the odds
    const c = this.guardOf;
    if (c && (!c.alive || c.sunk || c.sinking)) this.guardOf = null;
    else if (c && !this.fearless && this.state !== 'flee') {
      const foe = this._chargeFoe(c);
      if (foe) { if (this.target !== foe) { this.target = foe; s.grudges?.add(foe); } this.state = 'engage'; return; }
    }
    // sea tiers: the target has moved into a zone closed to this ship → it gives up and resumes its cruise
    const zs = g.seaZones, t0 = this.target;
    // (a fleeing ship keeps fleeing: only a pursuer gives up, and only the pursuer announces it)
    if (t0 && zs && !this.fearless && this.state !== 'flee' && zs.forbids(s, t0.position.x, t0.position.z, t0) && !this._provoked(t0)) {
      const chased = this.state === 'engage';
      this.target = null; this.state = 'cruise'; this._pickWaypoint();
      if (chased && t0.isPlayer && this._brokeOff !== t0) {
        this._brokeOff = t0;
        const t = zs.tierAt(t0.position.x, t0.position.z);
        g.events.emit('notify', { text: `${theShip(s, true)} gives up following you ${t === 1 ? 'into the guarded waters' : 'onto the trade routes'}.`, kind: 'good', key: 'zone-break' });
      }
      return;
    }
    for (const o of g.ships) {
      if (o === s || !o.alive || o.sinking || o.sunk) continue;
      if (!combat.isHostile(s, o)) continue;
      if (this.defendOnly && !s.grudges?.has(o) && zs?.tierAt(s.position.x, s.position.z) === 1) continue;   // escort in guarded waters
      if (zs && zs.forbids(s, o.position.x, o.position.z, o) && !this._provoked(o)) continue;
      const d = Math.hypot(o.position.x - s.position.x, o.position.z - s.position.z);
      if (d > R) continue;
      if (o.struck) continue;
      // the captain's escape boat (boarding.js ESCAPE_SHIP) slips by unnoticed beyond discreetR until it fires
      if (o.discreetUntil > g.time && d > (o.discreetR || 0) && !s.grudges?.has(o)) continue;
      const os = strength(o);
      if (d < threatD && os > myStr * 0.6) { threat = o; threatD = d; }
      let score = d;
      if (this.role === 'pirate' || this.role === 'hunter') {
        const dare = this.role === 'hunter' ? 1.3 : d < 600 ? 1.6 : 1.15;   // pirates jump anything close that isn't far stronger
        if (os > myStr * dare && !s.grudges?.has(o)) continue; // only weaker prey unless provoked
        score = d * (0.5 + os / myStr);
        if (o.type === 'merchantman') score *= 0.6;
      }
      if (s.grudges?.has(o)) score *= 0.5;
      if (o.isPlayer) score *= 0.8;
      if (score < bestScore) { bestScore = score; best = o; }
    }
    if (this.role === 'merchant') {
      // escorted: an escort's foe is ours too (convoys engage together)
      if (!threat && !best && s.guards) for (const gd of s.guards) {
        const f = gd.alive && gd.ai?.state === 'engage' ? gd.ai.target : null;
        if (f && f.alive && !f.struck && !f.sinking && Math.hypot(f.position.x - s.position.x, f.position.z - s.position.z) < R * 1.4) { best = f; s.grudges?.add(f); break; }
      }
      if (threat || best) {
        const t0 = this.target; this.target = threat || best;
        if (this.state !== 'flee' || t0 !== this.target) this.state = this._guarded() ? 'engage' : 'flee';
      }
      else if (this.target && Math.hypot(this.target.position.x - s.position.x, this.target.position.z - s.position.z) > R * (this.state === 'flee' ? MERCHANT_CLEAR : 1.4)) {
        if (this.state === 'flee') this._wary = { ship: this.target, t: MERCHANT_WARY_S };
        this.target = null; this.state = 'cruise';
      }
      return;
    }
    if (this.fearless && this.target) return;
    if (this.state === 'flee' && this.target) {
      const d = Math.hypot(this.target.position.x - s.position.x, this.target.position.z - s.position.z);
      if (d > R * 1.5) { this.target = null; this.state = 'cruise'; }
      return;
    }
    if (best && (!this.target || bestScore < 0.7 * Math.hypot(this.target.position.x - s.position.x, this.target.position.z - s.position.z))) {
      this.target = best; this.state = 'engage';
    }
    if (this.target) {
      const d = Math.hypot(this.target.position.x - s.position.x, this.target.position.z - s.position.z);
      if (d > R * 1.6) { this.target = null; this.state = 'cruise'; }
    }
  }

  _maybeStrike(dt = 1 / 30) {
    const s = this.ship, t = this.target, combat = this.game.combat;
    if (!t || s.isPlayer) return;
    const d = Math.hypot(t.position.x - s.position.x, t.position.z - s.position.z);
    if (d > 380) return;                                     // nobody close enough to strike to
    const caught = d < 140 || (d < 300 && t.speed >= s.speed * 0.9);
    const will = this.morale, P = this.persona;
    if (P.minStrikeHull && s.hull / s.hullMax > P.minStrikeHull) return;   // pirates fight on until badly holed
    // a long chase wears the crew down: merchants lose heart quickest
    if (this.state === 'flee' && d < 350) this._chaseT = (this._chaseT || 0) + dt * (this.role === 'merchant' ? 1 : 0.4);
    const tired = Math.min(0.25, (this._chaseT || 0) / 300);
    // fleeing and caught: strike below the role's threshold; still fighting: only when the will is broken
    if ((this.state === 'flee' && caught && will < P.strikeAt + tired) || will < P.strikeAt * 0.7) combat.strike(s);
  }

  // ------------------------------------------------------------- behaviours
  _bearing(o) { const s = this.ship; return headingFromVector(o.position.x - s.position.x, o.position.z - s.position.z); }

  _preferredRange(ammo) {
    const R = this.game.combat.getBroadsideRange(this.ship, ammo);
    const k = this.persona.rangeK;
    return ammo === 'round' ? Math.min(200, R * k) : ammo === 'chain' ? Math.min(110, R * 0.55) : Math.min(55, R * 0.5);
  }

  _targetFleeing() {
    const s = this.ship, t = this.target;
    if (t.ai?.state === 'flee') return true;
    const dx = t.position.x - s.position.x, dz = t.position.z - s.position.z, d = Math.hypot(dx, dz) || 1;
    return (t.velocity.x * dx + t.velocity.z * dz) / d > t.speed * 0.6 && t.speed > s.speed * 0.85;
  }

  _chooseAmmo(d) {
    const s = this.ship, t = this.target, c = this.game.combat;
    const tC = t.crew;
    if (this.role === 'pirate') {
      if (d < c.getBroadsideRange(s, 'grape') * 0.9 && tC > 6 && (d < 70 || this._grappleWanted())) return 'grape';   // sweep the decks before grappling
      if (this._targetFleeing() && t.speed > s.speed && t.sails > 0.4 && d < 200) return 'chain';
      return 'round';                      // round shot at range while closing
    }
    if (this.persona.windward && t.sails > 0.35 && this._targetFleeing() && d < c.getBroadsideRange(s, 'chain') * 0.85) return 'chain';
    if (d < 70 && tC > 10) return 'grape';
    return 'round';
  }

  // unit vector pointing to where the wind comes from
  _upwind() { const a = this.game.wind.angle; return { x: -Math.sin(a), z: Math.cos(a) }; }

  _grappleWanted() {
    const s = this.ship, t = this.target;
    return this.role === 'pirate' && (t.hull / t.hullMax < 0.45 || s.crew > t.crew * 1.4 || t.sails < 0.4);
  }

  _engage(dt) {
    const s = this.ship, t = this.target, combat = this.game.combat;
    const d = Math.hypot(t.position.x - s.position.x, t.position.z - s.position.z);
    s.ammo = this._chooseAmmo(d);
    // pirates want to fight at grape range whatever is loaded now
    const pref = this.persona.closer ? this._preferredRange('grape') * 1.4 : this._preferredRange(s.ammo);
    const maxR = combat.getBroadsideRange(s, s.ammo);
    const fleeing = this._targetFleeing();
    const brg = this._bearing(t);
    const P = this.persona;
    s.sailSetting = d > pref * 1.4 || P.closer ? 1 : 0.6;

    // pirates: grapple threat — run alongside a weakened foe (the player still decides boarding with B)
    if (this._grappleWanted() && d < 220) {
      if (t.isPlayer && this._grappleWarned !== t && d < 160) {
        this._grappleWarned = t;
        this.game.events.emit('notify', { text: `${theShip(s, true)} closes in to board us!`, kind: 'bad' });
      }
      const lead = Math.min(6, d / 25);
      const lx = t.position.x + t.velocity.x * lead, lz = t.position.z + t.velocity.z * lead;
      if (d > 45) return headingFromVector(lx - s.position.x, lz - s.position.z);
      s.sailSetting = t.speed > s.speed ? 1 : 0.5;
      // alongside: run parallel, guns bearing
      const left = wrapAngle(brg - t.heading) > 0;
      return wrapAngle(t.heading + (left ? -0.15 : 0.15));
    }

    // a fleeing foe out of reach: straight stern chase (cripple her rigging with chain once in range)
    if (fleeing && d > maxR * 0.6) {
      s.sailSetting = 1;
      const lead = Math.min(30, d / 15);
      return headingFromVector(t.position.x + t.velocity.x * lead - s.position.x, t.position.z + t.velocity.z * lead - s.position.z);
    }
    // warships far off: work up to windward of the foe (the weather gauge) at fighting range
    if (P.windward && d > maxR * 0.55) {
      const u = this._upwind();
      const gx = t.position.x + u.x * pref * 1.2 + t.velocity.x * 8, gz = t.position.z + u.z * pref * 1.2 + t.velocity.z * 8;
      const upNow = ((s.position.x - t.position.x) * u.x + (s.position.z - t.position.z) * u.z) / (d || 1);
      if (upNow < 0.3 && d > maxR * 0.8) return headingFromVector(gx - s.position.x, gz - s.position.z);
    }

    // far: close the distance, leading the target
    if (d > maxR * 0.8) {
      // approach on an oblique course (never bows-on), so a broadside can be brought round quickly
      const lead = Math.min(40, d / 12);
      const lx = t.position.x + t.velocity.x * lead, lz = t.position.z + t.velocity.z * lead;
      const direct = headingFromVector(lx - s.position.x, lz - s.position.z);
      const side = this._side === 'starboard' ? -1 : 1;
      return wrapAngle(direct + side * 0.6);
    }
    // in range: choose the beam heading. Candidates = bearing ± 90° adjusted to open/close the range.
    const err = (d - pref) / pref;             // + too far, - too close
    const adjMax = P.closer && err > 0 ? 1.1 : 0.6;   // pirates bore in hard
    let adj = Math.abs(err) < 0.25 ? 0 : Math.max(-0.6, Math.min(adjMax, err * 0.8));
    // a loaded broadside within effective range: swing fully beam-on to deliver it, then resume closing
    if ((s.reload.port > 0.97 || s.reload.starboard > 0.97) && d < Math.min(maxR * 0.5, pref * 1.35)) adj = 0;
    let best = null, bs = -Infinity;
    for (const sign of [1, -1]) {
      // sign +1: target on our port side (heading = brg + 90°)
      const h = wrapAngle(brg + sign * (Math.PI / 2 - adj));
      const side = sign > 0 ? 'port' : 'starboard';
      let score = 0;
      score += s.reload[side] * 2;                                     // loaded side first
      score += this._polarOK(h) ? 1 : -3;                               // don't head into irons
      score -= Math.abs(wrapAngle(h - s.heading)) * 0.9;                // less manoeuvring
      // crossing the T: our heading perpendicular to theirs AND we are near their bow/stern line -> rake
      const rel = Math.abs(Math.sin(wrapAngle(h - t.heading)));
      const tb = Math.abs(Math.cos(wrapAngle(brg + Math.PI - t.heading)));   // 1 when we sit on their bow/stern axis
      score += rel * tb * 1.5;
      if (this._side === side) score += 0.6;                           // hysteresis
      if (P.windward) { const u = this._upwind(); score += (Math.sin(h) * u.x - Math.cos(h) * u.z) * 0.5; }   // hold the gauge
      if (score > bs) { bs = score; best = { h, side }; }
    }
    this._sideT -= dt;
    if (this._sideT <= 0 || !this._side) { this._side = best.side; this._sideT = 4; }
    return best.h;
  }

  _flee() {
    const s = this.ship, t = this.target;
    s.sailSetting = 1;
    s.ammo = 'chain';
    const away = wrapAngle(this._bearing(t) + Math.PI);
    // best point of sail near "away": broad reach
    const wind = this.game.wind;
    const downwind = wind.angle;
    const opts = [away, wrapAngle(away + 0.5), wrapAngle(away - 0.5), wrapAngle(downwind + 0.6), wrapAngle(downwind - 0.6)];
    let best = away, bs = -Infinity;
    for (const h of opts) {
      const awayDot = Math.cos(wrapAngle(h - away));
      const off = Math.abs(wrapAngle(h - (wind.angle + Math.PI)));
      const sp = off < NO_GO ? 0 : off > 2.0 ? 1 : 0.6 + 0.4 * (off - NO_GO) / (2.0 - NO_GO);
      const score = awayDot * 1.5 + sp;
      if (score > bs) { bs = score; best = h; }
    }
    return best;
  }

  _cruise(dt) {
    const s = this.ship;
    s.sailSetting = this.role === 'merchant' ? 0.85 : 0.7;
    if (this.guardOf) {   // convoy escort: keep station on the charge's quarter
      const c = this.guardOf, sh = Math.sin(c.heading), ch = Math.cos(c.heading), o = this.guardSlot;
      const x = c.position.x + ch * o.x + sh * o.z, z = c.position.z + sh * o.x - ch * o.z;
      const d = Math.hypot(x - s.position.x, z - s.position.z), cs = c.sailSetting || 0.7;
      s.sailSetting = d > 160 ? 1 : d > 50 ? Math.min(1, cs + 0.2) : cs * 0.85;
      return d < 35 ? c.heading : headingFromVector(x - s.position.x, z - s.position.z);
    }
    if (s.guards?.length && this.role === 'merchant') s.sailSetting = 0.65;   // convoy pace: let the escort keep up
    if (s.escortOf && this.waypoint) {   // escort mission (career.js): keep station on the player, waypoint refreshed by Career
      s.sailSetting = this._escortSail ?? 0.85;
      return headingFromVector(this.waypoint.x - s.position.x, this.waypoint.z - s.position.z);
    }
    if (!this.waypoint || Math.hypot(this.waypoint.x - s.position.x, this.waypoint.z - s.position.z) < 180) this._pickWaypoint();
    const w = this.waypoint;
    return headingFromVector(w.x - s.position.x, w.z - s.position.z);
  }

  _pickWaypoint() {
    const s = this.ship, ports = this.game.islands?.ports || [];
    if (this.role === 'merchant' && ports.length > 1) {
      // a port 1–6 km away, preferring friendly ones
      const cands = ports.filter(p => {
        const d = Math.hypot(p.harborPoint.x - s.position.x, p.harborPoint.z - s.position.z);
        return d > 600 && d < 6500;
      });
      const pool = cands.length ? cands : ports;
      const friendly = pool.filter(p => p.faction === s.faction);
      const pick = (friendly.length && Math.random() < 0.6 ? friendly : pool);
      const p = pick[Math.floor(Math.random() * pick.length)];
      this.waypoint = { x: p.harborPoint.x, z: p.harborPoint.z, port: p };
      return;
    }
    // patrols/pirates: wander around home / between nearby ports (sea tiers: outside the zones closed to them)
    const zs = this.game.seaZones, prev = this.waypoint;
    for (let k = 0; k < BORDER.waypointTries; k++) {
      const a = Math.random() * Math.PI * 2, r = 600 + Math.random() * 1400;
      let cx = this._home.x, cz = this._home.z;
      if (ports.length && Math.random() < 0.5) {
        const p = ports[Math.floor(Math.random() * ports.length)];
        // never centred on a port whose waters are closed to it (starting ports, for big ships)
        if (Math.hypot(p.harborPoint.x - cx, p.harborPoint.z - cz) < 4000 && !zs?.forbids(s, p.harborPoint.x, p.harborPoint.z)) { cx = p.harborPoint.x; cz = p.harborPoint.z; }
      }
      const w = { x: Math.max(-7600, Math.min(7600, cx + Math.cos(a) * r)), z: Math.max(-7600, Math.min(7600, cz + Math.sin(a) * r)) };
      if (!zs?.forbids(s, w.x, w.z)) { this.waypoint = w; return; }
    }
    // every try falls in closed waters: keep the previous point if allowed, otherwise head home
    this.waypoint = prev && !zs?.forbids(s, prev.x, prev.z) ? prev : { x: this._home.x, z: this._home.z };
  }

  // ------------------------------------------------------------- constraints
  _offWind(h) { return Math.abs(wrapAngle(h - (this.game.wind.angle + Math.PI))); }
  _polarOK(h) { return this._offWind(h) >= NO_GO; }

  _avoidIrons(h) {
    if (this._polarOK(h)) return h;
    // beat to windward: choose tack closest to current heading (keep tack with hysteresis)
    const from = this.game.wind.angle + Math.PI;
    const a = wrapAngle(from + NO_GO + 0.05), b = wrapAngle(from - NO_GO - 0.05);
    const da = Math.abs(wrapAngle(a - this.ship.heading)), db = Math.abs(wrapAngle(b - this.ship.heading));
    if (Math.abs(da - db) > 0.5) this._tackDir = da < db ? 1 : -1;
    return this._tackDir > 0 ? a : b;
  }

  // after an escape: keep at least ~75° off the bearing of the ship it fled from for MERCHANT_WARY_S seconds
  _steerClearOf(want, dt) {
    const w = this._wary; w.t -= dt;
    if (w.t <= 0 || !w.ship?.alive || w.ship.sinking || w.ship.sunk) { this._wary = null; return want; }
    const brg = this._bearing(w.ship), d = wrapAngle(want - brg);
    return Math.abs(d) >= 1.3 ? want : wrapAngle(brg + (d >= 0 ? 1.3 : -1.3));
  }

  // skirt the eye wall of storm cells (game.weatherZones) instead of sailing into it; get out if already inside
  _avoidStorms(h) {
    const zones = this.game.weatherZones?.zones; if (!zones?.length) return h;
    const s = this.ship, px = s.position.x, pz = s.position.z, look = Math.max(450, (s.speed || 0) * 45);
    for (const zn of zones) {
      if (zn.kind !== 'storm') continue;
      const dx = zn.x - px, dz = zn.z - pz, d = Math.hypot(dx, dz), safe = zn.r * WEATHER.stormEyeR * 1.35;
      if (d > look + safe) continue;
      const brg = headingFromVector(dx, dz);
      if (d < safe) return wrapAngle(brg + Math.PI);
      const off = wrapAngle(h - brg);
      if (Math.abs(off) > Math.PI / 2 || d * Math.sin(Math.abs(off)) >= safe) continue;
      const clear = Math.asin(Math.min(1, safe / d)) + 0.08;
      return wrapAngle(brg + (off >= 0 ? clear : -clear));
    }
    return h;
  }

  _avoidLand(h) {
    const isl = this.game.islands, s = this.ship;
    if (!isl?.isLand) return h;
    const look = Math.max(140, s.speed * 22 + s.length * 2);
    const blocked = hh => {
      const sx = Math.sin(hh), sz = -Math.cos(hh);
      for (let k = 1; k <= 4; k++) {
        const d = look * k / 4;
        if (isl.isLand(s.position.x + sx * d, s.position.z + sz * d, 25)) return true;
      }
      return false;
    };
    // keep the previous avoidance offset if it is still clear (prevents dithering)
    if (this._avoid && !blocked(wrapAngle(h + this._avoid)) && this._polarOK(wrapAngle(h + this._avoid))) {
      if (!blocked(h)) this._avoid *= 0.9; if (Math.abs(this._avoid) < 0.05) this._avoid = 0;
      return wrapAngle(h + this._avoid);
    }
    for (const o of PROBES) {
      const hh = wrapAngle(h + o);
      if (!blocked(hh) && (o === 0 || this._polarOK(hh))) { this._avoid = o; return hh; }
    }
    return wrapAngle(h + Math.PI);
  }

  _avoidShips(h) {
    // simple separation from non-target ships on a collision course (keeps convoys from piling up)
    const s = this.ship;
    let push = 0;
    for (const o of this.game.ships) {
      if (o === s || o === this.target || o.sunk) continue;
      const dx = o.position.x - s.position.x, dz = o.position.z - s.position.z;
      const d = Math.hypot(dx, dz), R = (s.length + o.length) * 1.4;
      if (d > R) continue;
      const rel = wrapAngle(headingFromVector(dx, dz) - s.heading);
      if (Math.abs(rel) < 1.2) push += (rel > 0 ? -1 : 1) * (1 - d / R) * 0.8;
    }
    return wrapAngle(h + Math.max(-0.9, Math.min(0.9, push)));
  }

  // ------------------------------------------------------------- gunnery
  _gunnery(combat) {
    const s = this.ship;
    if (s.crew < 4) return;
    for (const side of ['port', 'starboard']) {
      if (s.reload[side] < 1) continue;
      const tgt = combat.aimTarget(s, side, s.ammo);
      if (!tgt || tgt.struck) continue;
      if (!combat.isHostile(s, tgt)) continue;
      const dx = tgt.position.x - s.position.x, dz = tgt.position.z - s.position.z;
      const d = Math.hypot(dx, dz);
      const maxR = combat.getBroadsideRange(s, s.ammo);
      if (d > maxR * 0.92) continue;
      // tolerance: the target's half-length subtended plus a little
      const off = combat._sideOff(s, side, dx, dz);
      const tol = Math.atan2(tgt.length * 0.5, d) + 0.22;   // guns traverse ~±0.2 rad
      if (off > tol) continue;
      // don't fire through friends
      if (this._friendInLine(dx, dz, d)) continue;
      combat.fireBroadside(s, side, s.ammo);
    }
  }

  _friendInLine(dx, dz, d) {
    const s = this.ship, g = this.game;
    const ux = dx / d, uz = dz / d;
    for (const o of g.ships) {
      if (o === s || o === this.target || !o.alive || g.combat.isHostile(s, o)) continue;
      const ox = o.position.x - s.position.x, oz = o.position.z - s.position.z;
      const along = ox * ux + oz * uz;
      if (along < 0 || along > d) continue;
      if (Math.abs(ox * uz - oz * ux) < o.length * 0.6) return true;
    }
    return false;
  }
}
