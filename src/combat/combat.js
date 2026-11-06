// Naval combat: broadsides and cannonballs, hits and damage, striking colours, sinking, survivors, AI traffic.
// API:
//   combat.fireBroadside(ship, 'port'|'starboard', ammo='round'|'chain'|'grape')
//   combat.spawnInitialTraffic()   populate the sea with AI ships (merchants, navy, pirates)
//   combat.update(dt, t)           projectiles, hit detection; the AI ship controllers live in src/ships/ai.js
// Emits events documented in core/events.js. Uses game.fx for visual effects.
//
// Extended API:
//   fireBroadside(...) -> bool     false if that side is still reloading / ship can't fire. Guns ripple bow→stern,
//                                  auto-elevated to the range of the nearest enemy on that side (else ~70% max range).
//   getBroadsideRange(ship, ammo)  -> metres (max effective range for that ammo)
//   aimTarget(ship, side)          -> Ship|null the ship the guns would auto-range on
//   reloadTime(ship)               -> seconds for a full reload (8–12 s, slower when short-handed)
//   isHostile(a, b)                faction / grudge / reputation check (src/combat/factions.js)
//   strike(ship)                   ship strikes its colours (emits 'ship:struck')
//   toggleRepair(ship, on?) / stopRepair(ship, why)  emergency repairs R: heave to (sails furled), work only below
//                                  REPAIR.maxSpeed (ship.repairWait meanwhile); making sail / firing stops it ('ship:repair')
//   startSinking(ship, {explode})  begin the sinking sequence (emits 'ship:sinking' now, 'ship:sunk' at the end)
//   spawnAI(opts)                  spawn a ship with an AI controller. opts = spawnShip opts + { role }
//   setTrafficTarget(n)            desired AI population (default 16); 0 disables top-up
//   noMagazine                     bool: disable random magazine explosions (scripted scenes)
//   AMMO                           { round|chain|grape: { speed, maxElev, spread, pellets, ... } }
//   stats                          { shots, hits, splashes, sunk, struck, rescued }
//   survivors                      floating survivors from sunk ships { n, x[], z[], men[], age[] } (~40 s);
//                                  the player picks them up within ~25 m (+crew up to crewMax, 'crew:rescued' { count })
// Ship refit multipliers read here: ship.gunRange (max range, via muzzle velocity), ship.gunSpread (aim scatter).
// Extra events:
//   'cannon:shot'   { ship, side, position, ammo }        every individual gun (audio)
//   'ship:sinking'  { ship }                               sinking sequence started
//   'combat:board'  { attacker, defender }                 player sailed into a struck/weakened enemy
//   'reputation:change' { faction, value, delta, reason }  (factions.js)
// Combat fields added to Ship instances (read-only for others): fires[] (fx handles), grudges/hostileTo (Set),
//   sinking (bool), sinkT, sunk, listing (rad), lastAttacker, ai (controller if AI), role.
// Ship pose: combat wraps each ship's _applyTransform (per instance, not the class) to add listing / sinking motion.
import * as THREE from 'three';
import { FACTIONS } from '../core/constants.js';
import { isHostile, relation, onPlayerAttack, onPlayerSink, getReputation, HOSTILE_REP } from './factions.js';
import { AIController } from '../ships/ai.js';
import { SHIP_SPECS } from '../ships/shipModel.js';
import { pickTrafficType, classOf } from '../data/shipTypes.js';
import { ZONE_TIERS } from '../data/seaZones.js';   // sea tiers
import { theShip, ofShip } from '../core/i18n.js';
import { BallTrails } from '../fx/ballTrails.js';

export const AMMO = {
  round: { speed: 125, maxElev: 0.15, spread: 0.018, pellets: 1, hull: 5.2, sails: 0.006, crew: 0.35, size: 1 },
  chain: { speed: 82, maxElev: 0.17, rangeK: 0.65, spread: 0.03, pellets: 1, hull: 1.0, sails: 0.045, crew: 0.3, size: 0.8 },
  grape: { speed: 68, maxElev: 0.13, rangeK: 0.65, spread: 0.065, pellets: 4, hull: 0.25, sails: 0.003, crew: 1.15, size: 0.35 },
};
const G = 9.8;
// tunables: men per gun for full rate of fire, minimum rate when short-handed, escape distance from a fleeing foe
export const MEN_PER_GUN = 1.0, MIN_FIRE_RATE = 0.4, ESCAPE_DIST = 900;
const MAX_BALLS = 600;
const MAX_QUEUE = 256;
const BOARD_COOLDOWN = 6;
const MAX_SURV = 96, SURV_LIFE = 40, SURV_PICKUP = 25;

// ---- combat balance ----
// Weather gauge: a ship upwind of its current foe (projection of foe→ship on the upwind axis > minUp × distance,
// foe within `range`) aims truer, reloads faster and answers the helm better.
export const WEATHER_GAUGE = { range: 900, minUp: 0.25, spread: 0.8, reload: 0.9, turn: 1.12 };
// Dismasting (spars fall at sail damage 0.8 / 0.9 / 0.97, shipModel.setDamage): loss 0.35 / 0.6 / 1 cuts speed and
// turn rate by up to these fractions, on top of the torn-canvas speed loss (ship.js rigF).
export const MAST_LOSS = { speed: 0.45, turn: 0.35 };
// Emergency repairs (R): the ship heaves to (toggleRepair furls the sails) and the work only goes on while she makes
// less than maxSpeed m/s (1 knot); making sail or firing a broadside interrupts it. No test of the distance to enemies:
// lying to under their guns is the captain's risk. Per-second fraction restored with a full crew (scaled 0.25..1.15 by
// men aboard), capped at sea; guns are served by fewer hands meanwhile (reload time × reloadMul).
export const REPAIR = { hullRate: 0.020, sailRate: 0.024, hullCap: 0.75, sailCap: 0.8, reloadMul: 1.8, maxSpeed: 0.514 };
// Difficulty (game.state.difficulty, captain sheet): only AI fire aimed at the player is affected.
//   dmgToPlayer multiplies damage the player's ship takes from AI guns; aiSpread multiplies AI aim scatter at the player.
export const DIFFICULTY = {
  apprentice: { dmgToPlayer: 0.75, aiSpread: 1.35 },
  mate:       { dmgToPlayer: 0.88, aiSpread: 1.15 },   // normal: eased after playtest feedback ("fights are quite hard")
  captain:    { dmgToPlayer: 1.0, aiSpread: 1.0 },
  admiral:    { dmgToPlayer: 1.12, aiSpread: 0.9 },
};
export const PIRATE_GUN_POWER = 1.08;   // pirate gun crews (before the difficulty factor on the player)
export const difficultyOf = game => DIFFICULTY[game?.state?.difficulty] || DIFFICULTY.mate;

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _r = new THREE.Vector3();
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

// range for launch elevation `el` from height h with speed v (flat sea)
function rangeAt(v, el, h) {
  const vx = v * Math.cos(el), vy = v * Math.sin(el);
  const t = (vy + Math.sqrt(vy * vy + 2 * G * h)) / G;
  return vx * t;
}

export class CombatSystem {
  constructor(game) {
    this.game = game;
    this.stats = { shots: 0, hits: 0, splashes: 0, sunk: 0, struck: 0, boards: 0, rescued: 0 };
    this.trafficTarget = 16;
    this._trafficT = 5;
    this._boardCd = new WeakMap();

    // elevation lookup per ammo (range -> elevation), launch height ~2.5 m
    this.elevLUT = {};
    for (const k in AMMO) {
      const a = AMMO[k], n = 64, lut = new Float32Array(n + 1);
      if (a.rangeK) {   // chain / grape: lift max elevation so their reach is rangeK x round shot
        const want = rangeAt(AMMO.round.speed, AMMO.round.maxElev, 2.5) * a.rangeK;
        let lo = 0, hi = 0.7;
        for (let it = 0; it < 30; it++) { const mid = (lo + hi) / 2; if (rangeAt(a.speed, mid, 2.5) < want) lo = mid; else hi = mid; }
        if (rangeAt(a.speed, hi, 2.5) >= want * 0.99) a.maxElev = hi;
      }
      a.maxRange = rangeAt(a.speed, a.maxElev, 2.5);
      for (let i = 0; i <= n; i++) {
        const R = (i / n) * a.maxRange;
        let lo = -0.05, hi = a.maxElev;
        for (let it = 0; it < 24; it++) { const mid = (lo + hi) / 2; if (rangeAt(a.speed, mid, 2.5) < R) lo = mid; else hi = mid; }
        lut[i] = (lo + hi) / 2;
      }
      this.elevLUT[k] = lut;
    }

    // ---- projectiles (SoA) ----
    this.b = {
      n: 0, x: new Float32Array(MAX_BALLS), y: new Float32Array(MAX_BALLS), z: new Float32Array(MAX_BALLS),
      vx: new Float32Array(MAX_BALLS), vy: new Float32Array(MAX_BALLS), vz: new Float32Array(MAX_BALLS),
      age: new Float32Array(MAX_BALLS), ammo: new Uint8Array(MAX_BALLS), dmg: new Float32Array(MAX_BALLS),
      trail: new Float32Array(MAX_BALLS), spin: new Float32Array(MAX_BALLS), tr: new Int16Array(MAX_BALLS).fill(-1),
      owner: new Array(MAX_BALLS).fill(null),
    };
    this._ammoIdx = ['round', 'chain', 'grape'];
    const ballGeo = new THREE.SphereGeometry(0.2, 8, 6);
    const ballMat = new THREE.MeshStandardMaterial({ color: 0x1d1b19, roughness: 0.45, metalness: 0.6 });
    this.ballMesh = new THREE.InstancedMesh(ballGeo, ballMat, MAX_BALLS);
    this.ballMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ballMesh.count = 0; this.ballMesh.frustumCulled = false;
    game.scene.add(this.ballMesh);
    this.trails = new BallTrails(game.scene, { max: Math.min(256, MAX_BALLS) });
    this._simT = 0;

    // ---- pending gun shots (rippling volley) ----
    this.q = { n: 0, t: new Float32Array(MAX_QUEUE), port: new Int16Array(MAX_QUEUE), elev: new Float32Array(MAX_QUEUE), yaw: new Float32Array(MAX_QUEUE),
      side: new Int8Array(MAX_QUEUE), ammo: new Uint8Array(MAX_QUEUE), ship: new Array(MAX_QUEUE).fill(null) };


    game.events.on('ship:collide', e => this._onCollide(e));
    // R: entering a port ends emergency repairs (the shipyard takes over), silently
    for (const ev of ['port:enter', 'village:enter']) game.events.on(ev, () => { const p = game.player; if (p?.repairing) { p.repairing = false; p.repairWait = false; } });

    // ---- survivors in the water (men clinging to casks/spars) ----
    this.survivors = { n: 0, x: new Float32Array(MAX_SURV), z: new Float32Array(MAX_SURV), men: new Uint8Array(MAX_SURV),
      age: new Float32Array(MAX_SURV), ph: new Float32Array(MAX_SURV), kind: new Uint8Array(MAX_SURV) };
    const svGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 8); svGeo.rotateZ(Math.PI / 2);
    this.survMesh = new THREE.InstancedMesh(svGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.85 }), MAX_SURV);
    this.survMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.survMesh.count = 0; this.survMesh.frustumCulled = false;
    const hdGeo = new THREE.SphereGeometry(0.28, 8, 6);
    this.survHeads = new THREE.InstancedMesh(hdGeo, new THREE.MeshStandardMaterial({ color: 0xc89a74, roughness: 0.7 }), MAX_SURV * 3);
    this.survHeads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.survHeads.count = 0; this.survHeads.frustumCulled = false;
    game.scene.add(this.survMesh, this.survHeads);
  }

  // survivors jump clear of a foundering ship: a few floating points carrying 1–3 men each
  spawnSurvivors(ship) {
    const S = this.survivors;
    const men = Math.min(14, Math.max(2, Math.round((ship.crew || 0) * 0.35)));
    const pts = Math.min(6, Math.max(2, Math.ceil(men / 2.5)));
    let left = men;
    for (let k = 0; k < pts && S.n < MAX_SURV; k++) {
      const i = S.n++, a = Math.random() * Math.PI * 2, r = ship.beam * 0.8 + Math.random() * ship.length * 0.5;
      S.x[i] = ship.position.x + Math.cos(a) * r; S.z[i] = ship.position.z + Math.sin(a) * r;
      const m = k === pts - 1 ? left : Math.max(1, Math.round(men / pts));
      S.men[i] = Math.max(1, Math.min(left, m)); left -= S.men[i];
      S.age[i] = 0; S.ph[i] = Math.random() * 6.28; S.kind[i] = 0;
      if (left <= 0) break;
    }
  }

  _killSurv(i) {
    const S = this.survivors, last = --S.n;
    if (i !== last) { S.x[i] = S.x[last]; S.z[i] = S.z[last]; S.men[i] = S.men[last]; S.age[i] = S.age[last]; S.ph[i] = S.ph[last]; }
  }

  _updateSurvivors(dt, t) {
    const S = this.survivors, p = this.game.player, ocean = this.game.ocean, w = this.game.wind;
    const wx = Math.sin(w?.angle || 0) * 0.15, wz = -Math.cos(w?.angle || 0) * 0.15;
    let got = 0;
    for (let i = 0; i < S.n; i++) {
      S.age[i] += dt; S.x[i] += wx * dt; S.z[i] += wz * dt;
      if (p && p.alive && !p.sinking && !p.struck && Math.hypot(S.x[i] - p.position.x, S.z[i] - p.position.z) < SURV_PICKUP + p.length * 0.3) {
        got += S.men[i]; this._killSurv(i); i--; continue;
      }
      if (S.age[i] > SURV_LIFE) { this._killSurv(i); i--; }
    }
    if (got && p) {
      const room = Math.max(0, p.crewMax - p.crew), n = Math.min(room, got);
      if (n > 0) {
        p.crew += n; this.stats.rescued += n;
        if (this.game.state) this.game.state.crew = p.crew;
        this.game.events.emit('notify', { text: `${n} sailor${n > 1 ? 's' : ''} picked up`, kind: 'good' });
      } else this.game.events.emit('notify', { text: 'No room left aboard for the castaways', kind: 'info' });
      this.game.events.emit('crew:rescued', { count: n });
    }
    // render
    const M = this.survMesh, H = this.survHeads;
    let k = 0;
    for (let i = 0; i < S.n; i++) {
      const fade = Math.min(1, (SURV_LIFE - S.age[i]) / 3);
      const y = (ocean?.getHeight ? ocean.getHeight(S.x[i], S.z[i]) : 0) + 0.1 * Math.sin(t * 2.2 + S.ph[i]);
      _e.set(0.12 * Math.sin(t * 1.7 + S.ph[i]), S.ph[i], 0.1 * Math.cos(t * 1.3 + S.ph[i]));
      _q.setFromEuler(_e); _s.setScalar(fade);
      _m4.compose(_v.set(S.x[i], y - 0.15 * fade - (1 - fade) * 0.6, S.z[i]), _q, _s); M.setMatrixAt(k, _m4);
      for (let m = 0; m < Math.min(3, S.men[i]); m++) {
        const ox = (m - 1) * 0.7, bob = 0.06 * Math.sin(t * 3 + S.ph[i] + m);
        _v2.set(ox, 0, 0.55).applyQuaternion(_q);
        _m4.compose(_v.set(S.x[i] + _v2.x, y + 0.12 + bob - (1 - fade) * 0.6, S.z[i] + _v2.z), _q, _s);
        H.setMatrixAt(k * 3 + m, _m4);
      }
      k++;
    }
    M.count = k; H.count = k * 3;
    // heads: pad unused per-point slots with zero scale
    _m4.makeScale(0, 0, 0);
    for (let i = 0; i < S.n; i++) for (let m = Math.min(3, S.men[i]); m < 3; m++) H.setMatrixAt(i * 3 + m, _m4);
    if (k) { M.instanceMatrix.needsUpdate = true; H.instanceMatrix.needsUpdate = true; }
  }

  // ------------------------------------------------------------------ queries
  getBroadsideRange(ship, ammo = ship?.ammo || 'round') { return (AMMO[ammo] || AMMO.round).maxRange * (ship?.gunRange || 1); }
  _rangeK(ship) { return Math.max(0.3, ship?.gunRange || 1); }
  isHostile(a, b) { return isHostile(this.game, a, b); }

  // rate-of-fire factor 0.4..1 from men per gun (below MEN_PER_GUN the guns are served more slowly)
  fireRate(ship) {
    const need = Math.max(1, ship.guns || 0) * MEN_PER_GUN;
    return Math.max(MIN_FIRE_RATE, Math.min(1, (ship.crew || 0) / need));
  }

  reloadTime(ship) {
    const crewF = Math.min(1, ship.crew / Math.max(1, ship.crewMax * 0.7));
    const civil = ship.isPlayer ? 1 : ship.role === 'merchant' ? 1.3 : ship.role === 'pirate' ? 0.85 : 1;  // merchant hands are no gun crews; pirates drill hard
    // weather gauge: faster; emergency repairs: hands pulled off the guns
    const tac = (ship.windGauge > 0 ? WEATHER_GAUGE.reload : 1) * (ship.repairing ? REPAIR.reloadMul : 1);
    const rate = ship.fireRate = this.fireRate(ship) / tac;
    return (12 - 4 * crewF) * civil / rate * (ship.isPlayer ? (this.game.fortune?.fx.reloadMul ?? 1) : 1);   // gunner
  }

  _ports(ship, side) {
    const ports = ship.model?.cannonPorts?.[side];
    if (!ports || !ports.length) return null;
    if (!ports._sorted) {           // bow (-z) to stern
      ports.sort((a, b) => a.position.z - b.position.z);
      ports._sorted = true;
    }
    return ports;
  }

  sideNormal(ship, side, out) {
    const s = side === 'starboard' ? 1 : -1;
    return out.set(Math.cos(ship.heading) * s, 0, Math.sin(ship.heading) * s);
  }

  aimTarget(ship, side, ammo = ship.ammo || 'round') {
    if (ship.ai?.target && ship.ai.target.alive && this._onSide(ship, side, ship.ai.target, ammo, 0.75)) return ship.ai.target;
    const maxR = this.getBroadsideRange(ship, ammo) * 1.15;
    let best = null, bs = Infinity;

    for (const o of this.game.ships) {
      if (o === ship || !o.alive || o.sinking) continue;
      if (!ship.isPlayer && !this.isHostile(ship, o)) continue;
      if (ship.isPlayer && o.faction === ship.faction && !o.grudges?.has(ship)) continue;
      const dx = o.position.x - ship.position.x, dz = o.position.z - ship.position.z;
      const d = Math.hypot(dx, dz);
      if (d > maxR) continue;
      const off = this._sideOff(ship, side, dx, dz);
      if (off > 0.75) continue;
      const score = d * (1 + off * 2);
      if (score < bs) { bs = score; best = o; }
    }
    return best;
  }
  _sideOff(ship, side, dx, dz) {
    this.sideNormal(ship, side, _v3);
    const d = Math.hypot(dx, dz) || 1;
    return Math.acos(Math.max(-1, Math.min(1, (dx * _v3.x + dz * _v3.z) / d)));
  }
  _onSide(ship, side, o, ammo, maxOff) {
    const dx = o.position.x - ship.position.x, dz = o.position.z - ship.position.z;
    return Math.hypot(dx, dz) < this.getBroadsideRange(ship, ammo) * 1.15 && this._sideOff(ship, side, dx, dz) < maxOff;
  }

  elevationFor(ammo, range) {
    const a = AMMO[ammo], lut = this.elevLUT[ammo];
    const f = Math.max(0, Math.min(1, range / a.maxRange)) * (lut.length - 1);
    const i = Math.min(lut.length - 2, f | 0), k = f - i;
    return lut[i] * (1 - k) + lut[i + 1] * k;
  }

  _autoElev(ship, side, ammo) {
    const a = AMMO[ammo];
    const tgt = this.aimTarget(ship, side, ammo);
    let range = a.maxRange * 0.72;
    if (tgt) {
      const dx = tgt.position.x - ship.position.x, dz = tgt.position.z - ship.position.z;
      let d = Math.hypot(dx, dz);
      // lead: where will it be when the ball arrives (along line of fire)
      const tof = d / a.speed;
      const ex = tgt.velocity.x - ship.velocity.x, ez = tgt.velocity.z - ship.velocity.z;
      d += (ex * dx + ez * dz) / (d || 1) * tof;
      range = Math.max(10, d - tgt.beam * 0.15);
    }
    // muzzle velocity scales with sqrt(gunRange), so the elevation for range R equals the base one for R / gunRange
    return this.elevationFor(ammo, range / this._rangeK(ship));
  }

  // effective gun elevation incl. the ship's roll (heel toward a side lowers its guns)
  // gun captains fire on the roll, so only part of the heel reaches the shot (the weather gauge still matters:
  // the leeward ship's raised guns tend to fire high into the rigging)
  _rollElev(ship, side) { return (side === 'starboard' ? 1 : -1) * (ship.roll || 0) * 0.12; }

  _portWorld(ship, port, out) {
    port.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(port.matrixWorld);
  }

  // ------------------------------------------------------------------ firing
  fireBroadside(ship, side, ammo = ship.ammo || 'round') {
    if (!ship || !ship.alive || ship.sinking || ship.struck) return false;
    if (side !== 'port' && side !== 'starboard') return false;
    if (!AMMO[ammo]) ammo = 'round';
    if ((ship.reload?.[side] ?? 1) < 0.999) return false;
    if (ship.discreetUntil) ship.discreetUntil = 0;   // the escape boat gives itself away with its first broadside
    const ports = this._ports(ship, side);
    if (!ports) return false;
    this._initShip(ship);
    // crew to man the guns: ~2 men per gun minimum
    // jettisoned guns (hold, I key): ship.guns below the type's complement → fewer pieces per side
    const perSide = ship.spec?.guns && ship.guns < ship.spec.guns ? Math.ceil(Math.max(0, ship.guns) / 2) : ports.length;
    if (perSide < 1) return false;
    const manned = Math.max(1, Math.min(ports.length, perSide, Math.floor(ship.crew / 2)));
    if (ship.crew < 2) return false;
    ship.reload[side] = 0;
    if (ship.repairing) this.stopRepair(ship, 'fire');   // R: no repairs while fighting (all hands to the guns)
    const elev = this._autoElev(ship, side, ammo);
    // gun traverse: train the broadside up to ±0.2 rad toward the target
    let yaw = 0;
    const tgt = this.aimTarget(ship, side, ammo);
    if (tgt) {
      this.sideNormal(ship, side, _r);
      const dx = tgt.position.x - ship.position.x, dz = tgt.position.z - ship.position.z;
      yaw = Math.max(-0.2, Math.min(0.2, Math.atan2(_r.x * dz - _r.z * dx, _r.x * dx + _r.z * dz)));
    }
    const ai = this._ammoIdx.indexOf(ammo);
    const stride = ports.length / manned;
    const stagger = 0.075 + 0.6 / ports.length;  // big ships ripple a bit faster per gun
    for (let k = 0; k < manned; k++) {
      if (this.q.n >= MAX_QUEUE) break;
      const i = this.q.n++;
      this.q.t[i] = k * stagger + Math.random() * 0.05;
      this.q.port[i] = Math.min(ports.length - 1, Math.floor(k * stride));
      this.q.elev[i] = elev; this.q.yaw[i] = yaw; this.q.side[i] = side === 'starboard' ? 1 : -1; this.q.ammo[i] = ai; this.q.ship[i] = ship;
    }
    this.game.events.emit('cannon:fire', { ship, side, count: manned, ammo });
    return true;
  }

  _fireGun(ship, sideSign, portIdx, elev, ammoIdx, train = 0) {
    if (!ship.alive || ship.sunk) return;
    const side = sideSign > 0 ? 'starboard' : 'port';
    const ports = this._ports(ship, side); if (!ports) return;
    const ammo = this._ammoIdx[ammoIdx], a = AMMO[ammo];
    const pos = this._portWorld(ship, ports[portIdx], _v);
    this.sideNormal(ship, side, _r);
    if (train) { const c = Math.cos(train), sn = Math.sin(train), x = _r.x; _r.x = x * c - _r.z * sn; _r.z = _r.z * c + x * sn; }
    const el = elev + this._rollElev(ship, side);
    const fx = this.game.fx;
    // muzzle effects
    _v2.copy(_r); _v2.y = Math.sin(el) * 0.5; _v2.normalize();
    fx?.cannonShot?.(_v3.copy(pos).addScaledVector(_r, 0.6), _v2, ship.velocity);
    this.game.events.emit('cannon:shot', { ship, side, position: pos, ammo });
    // recoil heel (starboard guns heel the ship to port = positive roll)
    if (ship.bRollVel !== undefined) ship.bRollVel += sideSign * 0.012 * Math.sqrt(40 / Math.max(10, ship.length));
    // projectiles
    for (let p = 0; p < a.pellets; p++) {
      if (this.b.n >= MAX_BALLS) break;
      const spread = a.spread * (ship.gunSpread || 1) * (ship.windGauge > 0 ? WEATHER_GAUGE.spread : 1)
        * (!ship.isPlayer && ship.ai?.target === this.game.player ? difficultyOf(this.game).aiSpread : 1);
      const yaw = (Math.random() * 2 - 1) * spread, pe = el + (Math.random() * 2 - 1) * spread * 0.5;
      const ch = Math.cos(yaw), sh = Math.sin(yaw);
      const dx = _r.x * ch - _r.z * sh, dz = _r.z * ch + _r.x * sh;
      const sp = a.speed * Math.sqrt(this._rangeK(ship)) * (1 + (Math.random() * 2 - 1) * 0.025);
      const B = this.b, i = B.n++;
      B.x[i] = pos.x + _r.x * 0.8; B.y[i] = pos.y; B.z[i] = pos.z + _r.z * 0.8;
      B.vx[i] = dx * sp * Math.cos(pe) + ship.velocity.x; B.vy[i] = sp * Math.sin(pe); B.vz[i] = dz * sp * Math.cos(pe) + ship.velocity.z;
      B.age[i] = 0; B.ammo[i] = ammoIdx; B.dmg[i] = 1 / a.pellets; B.owner[i] = ship; B.trail[i] = Math.random() * 0.03; B.spin[i] = Math.random() * 6;
      B.tr[i] = this.trails.start(ammoIdx); this.trails.push(B.tr[i], B.x[i], B.y[i], B.z[i], this._simT);
    }
    this.stats.shots++;
  }

  // ------------------------------------------------------------------ per-ship combat state
  _initShip(ship) {
    if (ship._combat) return;
    ship._combat = true;
    ship.fires = ship.fires || [];
    ship.grudges = ship.grudges || new Set();
    ship.hostileTo = ship.grudges;      // PlayerController.isEnemy reads hostileTo.has(player)
    ship.listing = 0; ship._listSide = 1; ship.sinkT = 0; ship._sinkY = 0; ship._sinkPitch = 0; ship._sinkRoll = 0;
    ship._fireDmg = 0;
    const orig = ship._applyTransform;
    if (typeof orig === 'function') {
      ship._applyTransform = (dt, t) => { orig.call(ship, dt, t); this._pose(ship); };
    }
  }

  _pose(ship) {
    const g = ship.model.group;
    if (ship.listing) g.rotation.z += ship.listing;
    if (ship.sinking) {
      g.position.y -= ship._sinkY;
      g.rotation.x += ship._sinkPitch;
      g.rotation.z += ship._sinkRoll;
    }
  }

  // local frame helpers: lx = starboard, lf = toward bow
  _toLocal(ship, x, z, out) {
    const dx = x - ship.position.x, dz = z - ship.position.z;
    const ch = Math.cos(ship.heading), sh = Math.sin(ship.heading);
    out.x = dx * ch + dz * sh;   // right
    out.z = dx * sh - dz * ch;   // forward
    return out;
  }

  // deck height above the waterline (model-local). Uses model.deckHeight if the ship art exposes it, otherwise
  // measures it once by raycasting down onto the model at a few points off the centreline (cached per ship).
  _deckY(ship) {
    if (ship._deckY != null) return ship._deckY;
    let y = ship.model?.deckHeight;
    if (y == null) {
      const g = ship.model.group, rc = this._rc || (this._rc = new THREE.Raycaster());
      g.updateWorldMatrix(true, true);
      const lim = (ship.spec.draft || 3) + 4.5;
      const hits = [];
      for (const [fx, fz] of [[0.22, 0.12], [-0.22, -0.18], [0.18, -0.3]]) {
        _v.set(ship.beam * fx, 40, ship.length * fz).applyMatrix4(g.matrixWorld);
        rc.set(_v, _v2.set(0, -1, 0)); rc.far = 80;
        const best = rc.intersectObject(g, true).map(h => h.point.y - ship.position.y).filter(h => h < lim && h > 0.3);
        if (best.length) hits.push(Math.max(...best));
      }
      const ports = ship.model?.cannonPorts?.port;
      y = hits.length ? hits.sort((a, b) => a - b)[hits.length >> 1] : (ports?.[0] ? ports[0].position.y + 1.6 : ship.spec.draft * 0.7 + 1.2);
    }
    return (ship._deckY = y);
  }

  // returns 0 miss, 1 hull, 2 rigging
  _hitTest(ship, x, y, z) {
    const L = ship.length, hb = ship.beam * 0.5;
    this._toLocal(ship, x, z, _s);
    const lf = _s.z, lx = _s.x;
    if (Math.abs(lf) > L * 0.5) return 0;
    const ly = y - (ship.position.y - (ship._sinkY || 0));
    const deck = this._deckY(ship);
    // hull: beam tapers toward bow (more) and stern; sides tumblehome at waterline
    const u = lf / (L * 0.5);
    const taper = u > 0 ? 1 - u * u * 0.85 : 1 - u * u * 0.4;
    if (ly > -ship.spec.draft * 0.6 && ly < deck + (u < -0.6 ? 2.2 : 0.4) && Math.abs(lx) < hb * taper) return 1;
    // rigging/sails: tall slab above the deck
    if (ly >= deck && ly < deck + L * 0.75 && Math.abs(lf) < L * 0.38 && Math.abs(lx) < hb * 1.5) return 2;
    return 0;
  }

  _applyHit(target, attacker, ammo, part, x, y, z, vx, vz, frac) {
    const a = AMMO[ammo], fx = this.game.fx;
    this._initShip(target);
    let dmgHull = 0, dmgSails = 0, dmgCrew = 0;
    // shipyard cannon refit (ports.js upgrade 'guns' sets attacker.gunPower = 1 + 0.15/level)
    const r = (0.75 + Math.random() * 0.5) * (attacker?.gunPower || 1)
      * (target.isPlayer && attacker && !attacker.isPlayer ? difficultyOf(this.game).dmgToPlayer : 1);
    if (part === 1) {
      dmgHull = a.hull * r * frac; dmgCrew = a.crew * r * frac * (1 + Math.random()); dmgSails = a.sails * 0.3 * frac;
    } else {
      dmgSails = a.sails * r * frac * (ammo === 'chain' ? 1.4 : 1); dmgCrew = a.crew * 0.5 * r * frac; dmgHull = a.hull * 0.05 * frac;
    }
    // grape kills crew mostly on deck; chance-round the fractional crew loss
    if (target.isPlayer) dmgCrew *= this.game.fortune?.fx.crewLossMul ?? 1;   // surgeon
    const crewLoss = Math.floor(dmgCrew) + (Math.random() < dmgCrew % 1 ? 1 : 0);
    target.hull = Math.max(0, target.hull - dmgHull);
    target.sails = Math.max(0, target.sails - dmgSails);
    target.crew = Math.max(0, target.crew - crewLoss);
    target.lastAttacker = attacker; target.lastHitT = this.game.time;   // sea tiers: retaliation (ai.js _provoked)
    if (attacker) target.grudges.add(attacker);
    if (attacker?.isPlayer) onPlayerAttack(this.game, target);
    this.stats.hits++;

    _v.set(x, y, z);
    const hl = Math.hypot(vx, vz) || 1;
    _v2.set(-vx / hl, 0.25, -vz / hl).normalize();
    if (part === 1) {
      fx?.splinters?.(_v, _v2, ammo === 'grape' ? 0.35 : ammo === 'chain' ? 0.6 : 1.1);
      if (ammo !== 'grape') fx?.shotHole?.(target, _v, _v2);
      // hull damage listing toward the battered side
      this._toLocal(target, x, z, _s);
      target._listSide = _s.x > 0 ? 1 : -1;
      // a hit may start a fire on a damaged ship
      const hf = target.hull / target.hullMax;
      if (ammo === 'round' && hf < 0.65 && target.fires.length < 3 && Math.random() < 0.10 + (0.65 - hf) * 0.35) this.igniteAt(target, x, y, z, 0.6 + Math.random() * 0.4);
      // magazine
      if (ammo === 'round' && hf < 0.45 && !target.sinking && !this.noMagazine && Math.random() < 0.012 * frac) {
        fx?.explosion?.(_v.set(target.position.x, target.position.y + 3, target.position.z), 1.3);
        target.hull = 0;
        this.game.events.emit('notify', { text: `The powder magazine ${ofShip(target)} explodes!`, kind: target.isPlayer ? 'bad' : 'good' });
        this.startSinking(target, { explode: true });
      }
    } else {
      // torn canvas fluttering + small splinters from spars
      if (ammo === 'chain' || Math.random() < 0.3) fx?.splinters?.(_v, _v2, 0.25);
    }
    this.game.events.emit('cannon:hit', { target, attacker, point: _v.clone(), damage: dmgHull + dmgSails * 100 + crewLoss, part: part === 1 ? (ammo === 'grape' ? 'crew' : 'hull') : 'sails' });
    if (target.hull <= 0 && !target.sinking) {
      if (attacker?.isPlayer) onPlayerSink(this.game, target);
      this.startSinking(target);
    }
  }

  igniteAt(ship, x, y, z, intensity = 1) {
    const fx = this.game.fx; if (!fx?.fire) return null;
    this._initShip(ship);
    const g = ship.model.group;
    g.updateWorldMatrix(true, false);
    const anchor = new THREE.Object3D();
    const deck = this._deckY(ship);           // may use the shared temps: compute first
    const lp = anchor.position.set(x, y, z); g.worldToLocal(lp);
    lp.x = Math.max(-ship.beam * 0.35, Math.min(ship.beam * 0.35, lp.x * 0.6));
    lp.y = deck + 0.2;
    lp.z = Math.max(-ship.length * 0.4, Math.min(ship.length * 0.4, lp.z));
    g.add(anchor);
    const h = fx.fire(anchor, intensity);
    h.anchor = anchor;
    ship.fires.push(h);
    return h;
  }

  _extinguish(ship, h) {
    h.stop(); h.anchor?.parent?.remove(h.anchor);
    const i = ship.fires.indexOf(h); if (i >= 0) ship.fires.splice(i, 1);
  }

  strike(ship) {
    if (ship.struck || ship.sinking || !ship.alive) return;
    this._initShip(ship);
    ship.struck = true;
    ship.sailSetting = 0;
    ship.desiredHeading = null; ship.rudder = 0;
    ship.model?.strikeFlag?.();       // ensign comes down
    this.stats.struck++;
    // a short "strikes her colours" moment: guns fall silent, a last puff of smoke drifts off her deck
    ship.reload.port = ship.reload.starboard = 0;
    this.game.fx?.smoke?.(_v.set(ship.position.x, ship.position.y + 4, ship.position.z), _v2.set(0, 1, 0), 0.6);
    this.game.events.emit('ship:struck', { ship });
    const by = ship.lastAttacker?.isPlayer ? ' to you' : '';
    this.game.events.emit('notify', { text: `${theShip(ship, true)} strikes her colours${by}!`, kind: ship.isPlayer ? 'bad' : 'good' });
  }

  startSinking(ship, { explode = false } = {}) {
    if (ship.sinking || ship.sunk) return;
    this._initShip(ship);
    ship.sinking = true; ship.sinkT = 0; ship.hull = 0;
    ship.sailSetting = 0; ship.desiredHeading = null;
    ship._sinkStyle = Math.random() < 0.5 ? 1 : -1;   // bow-up or stern-up
    ship._sinkExplode = explode;
    ship._sinkDur = 26 + ship.length * 0.2;
    const fx = this.game.fx;
    // the ship catches fire properly while foundering
    if (ship.fires.length < 2) this.igniteAt(ship, ship.position.x, ship.position.y + 3, ship.position.z, 1);
    fx?.wreckage?.(ship.position, 0.6, ship.length * 0.4);
    ship.model?.strikeFlag?.();
    if (!ship.isPlayer) this.spawnSurvivors(ship);
    this.game.events.emit('ship:sinking', { ship });
  }

  _updateSinking(ship, dt) {
    ship.sinkT += dt;
    const T = ship._sinkDur, t = ship.sinkT / T, fx = this.game.fx;
    const L = ship.length, D = ship.spec.draft;
    // phase 1 (0..0.25): list hard, settle; phase 2 (0.25..0.7): one end rises; phase 3 (0.7..1): slides under
    const p1 = Math.min(1, t / 0.25), p2 = Math.max(0, Math.min(1, (t - 0.2) / 0.5)), p3 = Math.max(0, (t - 0.68) / 0.32);
    const ease = x => x * x * (3 - 2 * x);
    ship._sinkRoll = ship._listSide * (0.22 * ease(p1) + 0.18 * ease(p2));
    ship._sinkPitch = ship._sinkStyle * 0.6 * ease(p2);
    // settle slowly so the canted hull stays visible, then slide under
    ship._sinkY = D * 0.25 * ease(p1) + D * 0.45 * ease(p2) + (L * 0.7) * p3 * p3;
    ship.sails = Math.max(0, ship.sails - dt * 0.06);     // canvas tears and burns away while she founders
    ship.model.forceDamage?.({ hull: 1, sails: Math.max(0.6, 1 - ship.sails) });
    ship.speed *= 1 - Math.min(1, dt * 0.4);
    ship.listing = 0;
    // fires die as she goes under
    if (p3 > 0.3) for (let i = ship.fires.length - 1; i >= 0; i--) this._extinguish(ship, ship.fires[i]);
    for (const h of ship.fires) h.intensity = Math.min(1.3, h.intensity + dt * 0.05);
    // bubbles & foam boil, wreckage shed
    if (fx) {
      ship._bubT = (ship._bubT || 0) - dt;
      if (ship._bubT <= 0) {
        ship._bubT = 0.12;
        fx.bubbles?.(ship.position, ship.beam * (0.8 + p2), 1 + p3 * 2);
        _v.set(ship.position.x + (Math.random() - 0.5) * L * 0.6, ship.position.y, ship.position.z + (Math.random() - 0.5) * L * 0.6);
        if (Math.random() < 0.4) fx.foamRing?.(_v, ship.beam * (1 + p2), 4);
        this.game.ocean?.addFoam?.(ship.position.x, ship.position.z, L * 0.45, 0.6);
      }
      if (Math.random() < dt * (0.4 + p2)) fx.wreckage?.(ship.position, 0.15, L * 0.5);
      if (ship._sinkExplode && ship.sinkT < 1.5 && Math.random() < dt * 3) fx.explosion?.(_v.set(ship.position.x + (Math.random() - 0.5) * L * 0.5, ship.position.y + 3, ship.position.z + (Math.random() - 0.5) * L * 0.5), 0.6);
    }
    if (t >= 1) {
      fx?.wreckage?.(ship.position, 1.2, L * 0.6);
      fx?.foamRing?.(ship.position, L * 0.6, 6);
      for (let i = ship.fires.length - 1; i >= 0; i--) this._extinguish(ship, ship.fires[i]);
      ship.sunk = true; ship.alive = false; ship.sinking = false;
      this.stats.sunk++;
      this.game.events.emit('ship:sunk', { ship });
      if (ship.isPlayer) { ship.model.group.visible = false; }
      else this.game.removeShip(ship);
    }
  }

  _updateShipState(ship, dt) {
    this._initShip(ship);
    // reload
    if (!ship.sinking) { this._weatherGauge(ship, dt); this._rigState(ship); this._repair(ship, dt); }
    ship.combatTurnF = (ship._mastTurnF ?? 1) * (ship.windGauge > 0 ? WEATHER_GAUGE.turn : 1);
    ship.combatSpeedF = ship._mastSpeedF ?? 1;
    const rt = this.reloadTime(ship);
    for (const side of ['port', 'starboard']) ship.reload[side] = Math.min(1, ship.reload[side] + dt / rt);
    if (ship.sinking) { this._updateSinking(ship, dt); return; }
    // listing from hull damage (beyond 50%)
    const hd = 1 - ship.hull / ship.hullMax;
    const wantList = ship._listSide * Math.max(0, hd - 0.5) * 0.24;
    ship.listing += (wantList - ship.listing) * Math.min(1, dt * 0.3);
    // fires: burn hull, crew fight them
    for (let i = ship.fires.length - 1; i >= 0; i--) {
      const h = ship.fires[i];
      ship.hull = Math.max(0, ship.hull - dt * 0.35 * h.intensity);
      const fight = (ship.crew / ship.crewMax) * 0.035 * (ship.struck ? 0.3 : 1);
      const hf = ship.hull / ship.hullMax;
      h.intensity += dt * ((hf < 0.3 ? 0.03 : 0.012) - fight);
      h.intensity = Math.min(1.4, h.intensity);
      if (h.intensity < 0.08) this._extinguish(ship, h);
    }
    if (ship.hull <= 0) {
      if (ship.lastAttacker?.isPlayer) onPlayerSink(this.game, ship);
      this.startSinking(ship);
    }
  }

  // ------------------------------------------------------------------ tactics: weather gauge, masts, repairs
  // current foe: the player's nearest enemy within range; an AI's engaged/fleeing target
  _foeOf(ship) {
    if (ship.isPlayer) return ship.controller?.nearestEnemy?.(WEATHER_GAUGE.range) || null;
    const t = ship.ai?.target;
    return t && t.alive && !t.sunk && (ship.ai.state === 'engage' || ship.ai.state === 'flee') ? t : null;
  }
  // ship.windGauge: +1 we hold the wind on ship.gaugeFoe, -1 the foe holds it, 0 neither / no foe (re-evaluated 2×/s)
  _weatherGauge(ship, dt) {
    ship._wgT = (ship._wgT || 0) - dt;
    if (ship._wgT > 0) return;
    ship._wgT = 0.5;
    const foe = this._foeOf(ship), prev = ship.windGauge || 0;
    let g = 0;
    if (foe && !ship.struck) {
      const dx = ship.position.x - foe.position.x, dz = ship.position.z - foe.position.z, d = Math.hypot(dx, dz) || 1;
      if (d < WEATHER_GAUGE.range) {
        const a = this.game.wind?.angle || 0, up = (dx * -Math.sin(a) + dz * Math.cos(a)) / d;   // upwind unit = (-sin, cos)
        const m = WEATHER_GAUGE.minUp, keep = 0.05;   // hysteresis: a held gauge is kept down to minUp - keep
        g = up > m - (prev > 0 ? keep : 0) ? 1 : up < -(m - (prev < 0 ? keep : 0)) ? -1 : 0;
      }
    }
    ship.windGauge = g; ship.gaugeFoe = g ? foe : null;
    if (ship.isPlayer && g !== prev && g !== 0 && this.game.time > (ship._wgNoteT || 0)) {
      ship._wgNoteT = this.game.time + 12;
      this.game.events.emit('notify', g > 0
        ? { text: 'We hold the weather gauge! Truer fire, quicker reloading', kind: 'good' }
        : { text: `${theShip(foe, true)} has taken the weather gauge from us`, kind: 'bad' });
    }
  }
  // dismasting from rigging damage: speed / turn penalty + one notification per stage for the player and their foe
  _rigState(ship) {
    const d = 1 - Math.max(0, Math.min(1, ship.sails));
    const loss = d >= 0.97 ? 1 : d >= 0.9 ? 0.6 : d >= 0.8 ? 0.35 : 0, prev = ship.mastLoss || 0;
    if (loss !== prev) {
      ship.mastLoss = loss;
      const pl = this.game.player;
      if (loss > prev && ship.isPlayer) {
        this.game.events.emit('notify', { text: loss >= 1 ? 'Dismasted! The ship is crawling' : loss >= 0.6 ? 'The topmasts are torn away!' : 'A mast goes by the board! We are losing speed', kind: 'bad' });
      } else if (loss > prev && pl && (ship.lastAttacker === pl || ship.ai?.target === pl)) {
        this.game.events.emit('notify', { text: loss >= 1 ? `${theShip(ship, true)} is dismasted!` : `${theShip(ship, true)} loses a mast!`, kind: 'good' });
      } else if (loss < prev && ship.isPlayer && loss === 0) {
        this.game.events.emit('notify', { text: 'Jury rig set up', kind: 'good' });
      }
    }
    ship._mastSpeedF = 1 - MAST_LOSS.speed * loss;
    ship._mastTurnF = 1 - MAST_LOSS.turn * loss;
  }
  // emergency repairs (R): toggle. On = heave to: the sails are furled (through the player's controller, so its sail
  // step, the HUD and 'player:sail' stay in sync) and the work starts once the ship is below REPAIR.maxSpeed
  // (ship.repairWait = true until then). Slow, crew-dependent, capped at sea, guns reload slower meanwhile.
  // Off: stopRepair(ship, why) — why 'order' (R), 'sail' (making sail), 'fire' (a broadside fired).
  toggleRepair(ship, on = !ship?.repairing) {
    if (!ship || !ship.alive || ship.sinking || ship.struck) return false;
    if (!on) return this.stopRepair(ship, 'order');
    if (ship.repairing) return true;
    if (ship.hull >= ship.hullMax * this._repairFx(ship).cap - 0.5 && ship.sails >= REPAIR.sailCap - 0.002 && !ship.fires?.length) {
      if (ship.isPlayer) this.game.events.emit('notify', { text: 'Nothing to repair at sea: the rest will be done at the shipyard', kind: 'info' });
      return false;
    }
    ship.repairing = true; ship._repWorked = false;
    if (ship.controller?.setSailStep) ship.controller.setSailStep(0, { quiet: true }); else ship.sailSetting = 0;
    ship.repairWait = Math.abs(ship.speed) > REPAIR.maxSpeed;
    if (ship.isPlayer) this.game.events.emit('notify', ship.repairWait
      ? { text: 'Emergency repairs: furling sail, work will begin once we have stopped', kind: 'info', key: 'repair' }
      : { text: 'Emergency repairs! The men leave the guns', kind: 'info', key: 'repair' });
    this.game.events.emit('ship:repair', { ship, on: true });
    return true;
  }
  stopRepair(ship, why = 'order') {
    if (!ship?.repairing) return false;
    ship.repairing = false; ship.repairWait = false;
    if (ship.isPlayer) this.game.events.emit('notify', {
      text: why === 'fire' ? 'Repairs interrupted, all hands to the guns!'
        : why === 'sail' ? 'Repairs interrupted: making sail'
        : 'Repairs suspended, every man to his post',
      kind: why === 'fire' ? 'bad' : 'info', key: 'repair' });
    this.game.events.emit('ship:repair', { ship, on: false, why });
    return true;
  }
  // carpenter / sailmaker (game.fortune.fx) on the player's ship
  _repairFx(ship) { const f = ship.isPlayer ? this.game.fortune?.fx : null; return { cap: f?.repairCap ?? REPAIR.hullCap, hull: f?.repairHull ?? 1, sails: f?.repairSail ?? 1 }; }
  repairEfficiency(ship) { return 0.25 + 0.75 * Math.min(1.2, (ship.crew || 0) / Math.max(1, ship.crewMax)); }
  _repair(ship, dt) {
    if (!ship.repairing) return;
    if (ship.struck || !ship.alive) { ship.repairing = false; ship.repairWait = false; return; }
    if (ship.sailSetting > 0.001) { this.stopRepair(ship, 'sail'); return; }   // canvas set again by any path
    // hove to: no work while she still carries way (> 1 knot)
    ship.repairWait = Math.abs(ship.speed) > REPAIR.maxSpeed;
    if (ship.repairWait) return;
    if (!ship._repWorked) {
      ship._repWorked = true;
      if (ship.isPlayer) this.game.events.emit('notify', { text: 'Hove to: carpenters and sailmakers at work', kind: 'info', key: 'repair' });
    }
    const eff = this.repairEfficiency(ship);
    const rf = this._repairFx(ship), hCap = ship.hullMax * rf.cap;
    if (ship.hull < hCap) ship.hull = Math.min(hCap, ship.hull + ship.hullMax * REPAIR.hullRate * rf.hull * eff * dt);
    if (ship.sails < REPAIR.sailCap) ship.sails = Math.min(REPAIR.sailCap, ship.sails + REPAIR.sailRate * rf.sails * eff * dt);
    for (const h of ship.fires || []) h.intensity -= dt * 0.03 * eff;   // bucket chains (extinguished by _updateShipState)
    if (ship.hull >= hCap - 0.01 && ship.sails >= REPAIR.sailCap - 0.001 && !ship.fires?.some(h => h.intensity > 0.1)) {
      ship.repairing = false; ship.repairWait = false;
      if (ship.isPlayer) this.game.events.emit('notify', { text: 'Makeshift repairs done. The rest will wait for the shipyard', kind: 'good', key: 'repair' });
      this.game.events.emit('ship:repair', { ship, on: false });
    }
  }

  // ------------------------------------------------------------------ update
  update(dt, t) {
    const game = this.game;
    if (!(dt > 0)) { this._renderBalls(); return; }
    // keep game.state.atWar in sync for the player controller / HUD
    const pl = game.player;
    if (pl && game.state) {
      const w = game.state.atWar || (game.state.atWar = {});
      for (const f in FACTIONS) w[f] = f !== pl.faction && (relation(pl.faction, f) < 0 || getReputation(game, f) <= HOSTILE_REP);
    }
    for (let i = game.ships.length - 1; i >= 0; i--) {
      const s = game.ships[i];
      if (!s.sunk) this._updateShipState(s, dt);
    }
    this._updateQueue(dt);
    this._updateBalls(dt, t);
    this._checkBoarding();
    this._checkEscapes();
    this._updateSurvivors(dt, t);
    this._updateTraffic(dt);
    this._renderBalls();
  }

  // a foe that was fleeing the player within gun reach and opens past ESCAPE_DIST is gone: end of the fight
  _checkEscapes() {
    const pl = this.game.player;
    if (!pl || !pl.alive) return;
    for (const s of this.game.ships) {
      const ai = s.ai;
      if (s === pl || !ai || s.struck || s.sinking || !s.alive) continue;
      if (ai.state !== 'flee' || ai.target !== pl) { s._fleeNear = false; continue; }
      const d = Math.hypot(s.position.x - pl.position.x, s.position.z - pl.position.z);
      if (d < ESCAPE_DIST * 0.85) s._fleeNear = true;
      else if (d > ESCAPE_DIST && s._fleeNear) {
        s._fleeNear = false;
        ai.state = 'cruise'; ai.target = null; ai._chaseT = 0;
        if (this.boardHint?.ship === s) this.boardHint = null;
        this.game.events.emit('ship:escaped', { ship: s });
        this.game.events.emit('notify', { text: `${theShip(s, true)} has escaped`, kind: 'info' });
      }
    }
  }

  _updateQueue(dt) {
    const Q = this.q;
    for (let i = 0; i < Q.n; i++) {
      Q.t[i] -= dt;
      if (Q.t[i] > 0) continue;
      const ship = Q.ship[i];
      if (ship && ship.alive && !ship.sinking) this._fireGun(ship, Q.side[i], Q.port[i], Q.elev[i], Q.ammo[i], Q.yaw[i]);
      const last = --Q.n;
      if (i !== last) {
        Q.t[i] = Q.t[last]; Q.port[i] = Q.port[last]; Q.elev[i] = Q.elev[last]; Q.yaw[i] = Q.yaw[last]; Q.side[i] = Q.side[last]; Q.ammo[i] = Q.ammo[last]; Q.ship[i] = Q.ship[last];
      }
      Q.ship[last] = null;
      i--;
    }
  }

  _killBall(i) {
    const B = this.b, last = --B.n;
    this.trails.release(B.tr[i]);
    if (i !== last) {
      B.x[i] = B.x[last]; B.y[i] = B.y[last]; B.z[i] = B.z[last]; B.vx[i] = B.vx[last]; B.vy[i] = B.vy[last]; B.vz[i] = B.vz[last];
      B.age[i] = B.age[last]; B.ammo[i] = B.ammo[last]; B.dmg[i] = B.dmg[last]; B.owner[i] = B.owner[last]; B.trail[i] = B.trail[last]; B.spin[i] = B.spin[last]; B.tr[i] = B.tr[last];
    }
    B.owner[last] = null; B.tr[last] = -1;
  }

  _updateBalls(dt, t) {
    const B = this.b, ships = this.game.ships, ocean = this.game.ocean, fx = this.game.fx;
    this._simT += dt;
    this._updateBallsInner(dt, B, ships, ocean, fx);
    if (this.game.sky?.sunColor) this.trails.setLight(this.game.sky.sunColor);
    this.trails.update(this._simT);
  }
  _updateBallsInner(dt, B, ships, ocean, fx) {
    for (let i = 0; i < B.n; i++) {
      const x0 = B.x[i], y0 = B.y[i], z0 = B.z[i];
      B.vy[i] -= G * dt;
      const x1 = x0 + B.vx[i] * dt, y1 = y0 + B.vy[i] * dt, z1 = z0 + B.vz[i] * dt;
      B.age[i] += dt;
      const ammo = this._ammoIdx[B.ammo[i]];
      // ship hits: swept test, sampled every ~1.2 m, only ships whose bounding circle the segment approaches
      let hitShip = null, hitPart = 0, hx = 0, hy = 0, hz = 0;
      const segLen = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
      const steps = Math.max(1, Math.ceil(segLen / 1.2));
      for (const s of ships) {
        if (s === B.owner[i] && B.age[i] < 1.0) continue;
        if (s.sunk || (s.sinking && s.sinkT > s._sinkDur * 0.7)) continue;
        const rr = s.length * 0.5 + segLen + 2;
        const cx = (x0 + x1) * 0.5 - s.position.x, cz = (z0 + z1) * 0.5 - s.position.z;
        if (cx * cx + cz * cz > rr * rr) continue;
        for (let k = 1; k <= steps; k++) {
          const f = k / steps, px = x0 + (x1 - x0) * f, py = y0 + (y1 - y0) * f, pz = z0 + (z1 - z0) * f;
          const part = this._hitTest(s, px, py, pz);
          if (part) { hitShip = s; hitPart = part; hx = px; hy = py; hz = pz; break; }
        }
        if (hitShip) break;
      }
      if (hitShip) {
        this._applyHit(hitShip, B.owner[i], ammo, hitPart, hx, hy, hz, B.vx[i], B.vz[i], B.dmg[i]);
        // round shot through the rigging carries on (with less energy)
        if (hitPart === 2 && ammo === 'round') { B.x[i] = hx + B.vx[i] * 0.03; B.y[i] = hy; B.z[i] = hz + B.vz[i] * 0.03; B.vx[i] *= 0.85; B.vz[i] *= 0.85; B.owner[i] = hitShip; B.age[i] = 0.5; continue; }
        this._killBall(i); i--; continue;
      }
      const wy = ocean?.getHeight ? ocean.getHeight(x1, z1) : 0;
      if (y1 < wy) {
        // skipping round shot: shallow, fast impacts ricochet once
        const vh = Math.hypot(B.vx[i], B.vz[i]);
        const shallow = ammo === 'round' && B.vy[i] > -vh * 0.12 && vh > 70 && B.spin[i] < 3.5;
        _v.set(x1, wy, z1);
        if (!this.game.islands?.isLand?.(x1, z1)) { fx?.splash?.(_v, shallow ? 0.55 : AMMO[ammo].size); this.game.ocean?.addFoam?.(x1, z1, shallow ? 2 : 3 * AMMO[ammo].size, 0.6); }
        this.stats.splashes++;
        this.game.events.emit('cannon:splash', { point: _v.clone() });
        if (shallow) { B.spin[i] = 9; B.y[i] = wy + 0.05; B.x[i] = x1; B.z[i] = z1; B.vy[i] = -B.vy[i] * 0.4; B.vx[i] *= 0.7; B.vz[i] *= 0.7; continue; }
        this._killBall(i); i--; continue;
      }
      B.x[i] = x1; B.y[i] = y1; B.z[i] = z1;
      // continuous ribbon trail (replaces the per-step tracer sprites / smoke puffs that read as beads)
      this.trails.push(B.tr[i], x1, y1, z1, this._simT);
      if (B.age[i] > 12) { this._killBall(i); i--; }
    }
  }

  _renderBalls() {
    const B = this.b, M = this.ballMesh;
    for (let i = 0; i < B.n; i++) {
      const chain = B.ammo[i] === 1, grape = B.ammo[i] === 2;
      if (chain) { _e.set(0, B.age[i] * 18, 0); _q.setFromEuler(_e); _s.set(3.2, 0.9, 0.9); }
      else { _q.identity(); const k = grape ? 1.0 : 2.3; _s.set(k, k, k); }   // balls read as dark projectiles
      _m4.compose(_v.set(B.x[i], B.y[i], B.z[i]), _q, _s);
      M.setMatrixAt(i, _m4);
    }
    M.count = B.n;
    if (B.n) M.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ boarding
  // Boarding is manual: the player presses B (requestBoard) when a weakened hostile is within reach.
  // boardHint = { ship, dist, inReach } for the nearest boardable ship within 450 m (HUD shows “Board her!”).
  _onCollide() {}
  _canBoard(p, o) {
    if (!o.alive || o.sinking || o.sunk || o._plundered) return false;
    const weak = o.struck || o.hull / o.hullMax < 0.35 || o.crew < o.crewMax * 0.3 || o.crew < p.crew * 0.5;
    const hostile = o.struck || this.isHostile(p, o) || p.controller?.isEnemy?.(o);
    return weak && hostile;
  }
  _boardReach(p, o) { return (p.length + o.length) * 0.5 + 25; }
  _checkBoarding() {
    const p = this.game.player;
    this.boardHint = null;
    if (!p || !p.alive || p.sinking || p.struck) return;
    let best = null, bd = 450;
    for (const o of this.game.ships) {
      if (o === p || !this._canBoard(p, o)) continue;
      const d = Math.hypot(o.position.x - p.position.x, o.position.z - p.position.z);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) this.boardHint = { ship: best, dist: bd, inReach: bd < this._boardReach(p, best) };
  }
  requestBoard() {
    const p = this.game.player, h = this.boardHint;
    if (!p || !h) { this.game.events.emit('notify', { text: 'No enemy weak enough to board', kind: 'bad' }); return false; }
    if (!h.inReach) { this.game.events.emit('notify', { text: `Close in to board ${theShip(h.ship)} (${Math.round(h.dist)} m)`, kind: 'info' }); return false; }
    this._tryBoard(p, h.ship);
    return true;
  }
  _tryBoard(p, o) {
    if (!this._canBoard(p, o)) return;   // a prize already boarded and set adrift can't be boarded again
    const cd = this._boardCd.get(o) || 0;
    if (this.game.time < cd) return;
    this._boardCd.set(o, this.game.time + BOARD_COOLDOWN);
    this.stats.boards++;
    this.game.events.emit('combat:board', { attacker: p, defender: o });
  }

  // ------------------------------------------------------------------ AI / traffic
  spawnAI(opts) {
    const s = this.game.spawnShip(opts);
    s.role = opts.role || 'merchant';
    s.ai = s.controller = new AIController(this.game, s, s.role);
    if (s.role === 'pirate' && s.gunPower == null) s.gunPower = PIRATE_GUN_POWER;   // hard-bitten gun crews (see DIFFICULTY)
    this._initShip(s);
    s.speed = opts.speed ?? s.spec.maxSpeed * 0.45;
    s.sailEff = s.sailSetting;
    return s;
  }

  setTrafficTarget(n) { this.trafficTarget = n; }

  // sea tiers: role shares by sea tier (ZONE_TIERS[t].roles; tier II = 48 / 34 / 18 %, the former draw).
  // Hunters come from infamy (src/game/living.js).
  _randomRole(rnd, tier = 2) {
    const R = ZONE_TIERS[tier]?.roles || ZONE_TIERS[2].roles, r = rnd();
    return r < R.merchant ? 'merchant' : r < R.merchant + R.pirate ? 'pirate' : 'patrol';
  }

  _spawnRandom(nearPlayer) {
    const game = this.game, isl = game.islands, rnd = Math.random;
    const ports = isl?.ports || [];
    const nations = ['english', 'spanish', 'french', 'dutch'];
    let anchor = null;
    if (ports.length) {
      // prefer ports near the player when topping up
      let pool = ports;
      if (nearPlayer && game.player) {
        const p = game.player.position;
        pool = ports.filter(pt => { const d = Math.hypot(pt.harborPoint.x - p.x, pt.harborPoint.z - p.z); return d > 900 && d < 3200; });
        if (!pool.length) pool = ports;
      }
      anchor = pool[Math.floor(rnd() * pool.length)];
    }
    // find open water near the anchor (or around the player)
    let x = 0, z = 0, ok = false;
    for (let tries = 0; tries < 24 && !ok; tries++) {
      const a = rnd() * Math.PI * 2;
      if (nearPlayer && game.player) {
        const d = 1600 + rnd() * 1200;
        x = game.player.position.x + Math.cos(a) * d; z = game.player.position.z + Math.sin(a) * d;
      } else if (anchor) {
        const d = 250 + rnd() * 1300;
        x = anchor.harborPoint.x + Math.cos(a) * d; z = anchor.harborPoint.z + Math.sin(a) * d;
      } else { x = (rnd() - 0.5) * 6000; z = (rnd() - 0.5) * 6000; }
      ok = Math.abs(x) < 7700 && Math.abs(z) < 7700 && !(isl?.isLand?.(x, z, 60));
      if (ok) for (const s of game.ships) if (Math.hypot(s.position.x - x, s.position.z - z) < 150) { ok = false; break; }
    }
    if (!ok) return null;
    // sea tiers (src/data/seaZones.js): the tier at the spawn point, or the player's if lower (a reinforcement
    // spawned for the player never comes from rougher waters than the player's own); role and type capped
    const zs = game.seaZones;
    let tier = zs ? zs.tierAt(x, z) : 2;
    if (zs && nearPlayer && game.player) tier = Math.min(tier, zs.tierAt(game.player.position.x, game.player.position.z));
    const role = this._randomRole(rnd, tier);
    let faction;
    if (role === 'pirate') faction = 'pirate';
    else if (anchor?.faction && nations.includes(anchor.faction) && rnd() < 0.7) faction = anchor.faction;
    else faction = nations[Math.floor(rnd() * nations.length)];
    // weighted pick among the 27 types by role and nation (src/data/shipTypes.js roles / nat)
    const type = pickTrafficType(role, faction, rnd, zs ? zs.cap(tier, role) : undefined);
    const names = NAMES[faction] || NAMES.english;
    const name = names[Math.floor(rnd() * names.length)];
    const spec = SHIP_SPECS[type];
    const crew = Math.round(spec.crewMax * (ROLE_CREW[role] ?? 0.6) * (0.85 + rnd() * 0.3));
    const heading = rnd() * Math.PI * 2;
    // convoys: some merchants sail under escort; now and then a Spanish treasure galleon with two
    if (role === 'merchant') {
      const r = rnd();
      if (faction === 'spanish' && r < CONVOY.treasure && tier >= 2) return this.spawnConvoy({ faction, x, z, heading, treasure: true, tier }).charge;
      if (r < CONVOY.escorted) return this.spawnConvoy({ faction, x, z, heading, type, name, crew, tier }).charge;
    }
    return this.spawnAI({ type, faction, role, x, z, heading, sailSetting: role === 'merchant' ? 0.8 : 0.6, name, crew });
  }

  // spawnConvoy({ faction, x, z, heading, treasure?, type?, name?, crew?, guards? }) -> { charge, guards[] }
  // A merchant (or treasure galleon, ship.treasure = true) with 1–2 escorts of its nation (AIController.guardOf).
  // Sea tiers: `tier` (default: the spawn point's) caps the escorts (ZONE_TIERS[t].cap.escort) and the great
  // galleon (tier III); in guarded waters, the escorts only defend their charge (ai.defendOnly).
  spawnConvoy({ faction = 'spanish', x, z, heading = 0, treasure = false, type, name, crew, guards, tier } = {}) {
    tier ??= this.game.seaZones?.tierAt(x, z) ?? 2;
    const escCap = ZONE_TIERS[tier]?.cap.escort ?? 5;
    type = treasure ? (Math.random() < 0.3 && tier >= 3 ? 'greatgalleon' : 'galleon') : type || 'merchantman';
    { const mCap = ZONE_TIERS[tier]?.cap.merchant ?? 5; if (classOf(type) > mCap) type = classOf('nao') <= mCap ? 'nao' : 'merchantman'; }   // announced convoy in guarded waters: no galleon
    const spec = SHIP_SPECS[type] || SHIP_SPECS.merchantman;
    const charge = this.spawnAI({ type, faction, role: 'merchant', x, z, heading, sailSetting: 0.65,
      name: name || (treasure ? TREASURE_NAMES[Math.floor(Math.random() * TREASURE_NAMES.length)] : (NAMES[faction] || NAMES.english)[0]),
      crew: crew ?? Math.round(spec.crewMax * (treasure ? 0.75 : 0.5)) });
    charge.treasure = treasure; charge.guards = [];
    const n = guards ?? (treasure ? 2 : 1);
    const slots = [{ x: 110, z: -70 }, { x: -110, z: -70 }, { x: 0, z: -160 }];
    const sh = Math.sin(heading), ch = Math.cos(heading);
    for (let k = 0; k < n; k++) {
      const o = slots[k % slots.length];
      const gx = x + ch * o.x + sh * o.z, gz = z + sh * o.x - ch * o.z;
      if (this.game.islands?.isLand?.(gx, gz, 40)) continue;
      let gt = treasure && k === 0 ? 'frigate' : Math.random() < 0.5 ? 'brig' : 'frigate';
      if (classOf(gt) > escCap) gt = classOf('corvette') <= escCap ? 'corvette' : 'brig';
      const gs = SHIP_SPECS[gt];
      const gd = this.spawnAI({ type: gt, faction, role: 'patrol', x: gx, z: gz, heading, sailSetting: 0.65,
        name: (NAMES[faction] || NAMES.english)[(k + 3) % (NAMES[faction] || NAMES.english).length], crew: Math.round(gs.crewMax * 0.75) });
      gd.ai.guardOf = charge; gd.ai.guardSlot = { ...o }; gd.escorting = charge;
      gd.ai.defendOnly = true;   // guarded waters only (ai._scan re-checks the tier on every pass)
      charge.guards.push(gd);
    }
    return { charge, guards: charge.guards };
  }

  spawnInitialTraffic(count = this.trafficTarget) {
    let n = 0;
    for (let i = 0; i < count * 2 && n < count; i++) if (this._spawnRandom(false)) n++;
    return n;
  }

  _updateTraffic(dt) {
    this._trafficT -= dt;
    if (this._trafficT > 0) return;
    this._trafficT = 8;
    const game = this.game, p = game.player;
    if (!p || this.trafficTarget <= 0) return;
    let ai = 0;
    for (let i = game.ships.length - 1; i >= 0; i--) {
      const s = game.ships[i];
      if (!s.ai) continue;
      const d = Math.hypot(s.position.x - p.position.x, s.position.z - p.position.z);
      // despawn far, idle, non-engaged ships
      if (d > 4200 && !s.sinking && !(s.ai.target === p) && !(s.ai.guardOf && s.ai.guardOf.alive && !s.ai.guardOf.sunk)) {
        this._despawn(s); continue;
      }
      ai++;
    }
    if (ai < this.trafficTarget) this._spawnRandom(true);
  }

  _despawn(s) {
    if (s.guards) for (const gd of s.guards) if (gd.ai?.guardOf === s) gd.ai.guardOf = null;   // escorts go their way
    for (let i = s.fires?.length - 1; i >= 0; i--) this._extinguish(s, s.fires[i]);
    this.game.removeShip(s);
  }
}

const ROLE_CREW = { merchant: 0.45, patrol: 0.7, pirate: 0.9, hunter: 0.8 };
// share of merchants spawned under escort; of Spanish merchants, the share that are escorted treasure galleons
const CONVOY = { escorted: 0.3, treasure: 0.1 };
const TREASURE_NAMES = ['Nuestra Señora del Rosario', 'San José', 'Santísima Trinidad', 'Nuestra Señora de Atocha'];
const NAMES = {
  english: ['Resolute', 'Gull', 'Kestrel', 'Prudence', 'Swiftsure', 'Lark', 'Defiance', 'Bonaventure', 'Hart', 'Speedwell'],
  spanish: ['San Telmo', 'Santa Clara', 'Nuestra Señora', 'San Felipe', 'Esperanza', 'Santa Rosa', 'San Mateo', 'Concepción'],
  french:  ['Le Faucon', 'La Belle', 'Le Hardi', 'La Sirène', 'Le Vigilant', "L'Aigle", 'La Fortune'],
  dutch:   ['Zeemeeuw', 'De Hoop', 'Wapen van Hoorn', 'Eendracht', 'Zwaluw', 'Gouden Leeuw'],
  pirate:  ['Black Tern', 'Widow\'s Due', 'Gallows Bird', 'Red Hand', 'Sea Wolf', 'Crow\'s Bargain', 'Night Heron'],
};
