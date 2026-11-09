// Ship entity. Fields other systems rely on:
//   position (Vector3, y = water height), heading (rad), speed (m/s forward), velocity (Vector3)
//   rudder -1..1, sailSetting 0..1 (0 furled, 0.5 battle sails, 1 full sail), roll/pitch (rad)
//   type, spec, faction, name, isPlayer, controller (has update(dt)), model (ShipModel)
//   hull (hp), hullMax, sails 0..1 integrity, crew, crewMax, guns, reload {port, starboard} 0..1 ready
//   length, beam, alive, struck
//   forward(out) helper
// Sailing additions (read-only for other systems unless noted):
//   speed is through-water m/s (shown as knots); velocity is world m/s = speed × pace (game.settings.pace, default 4)
//   ammo            'round'|'chain'|'grape'  (writable; PlayerController / AI set it)
//   windRel         rad, bearing the wind comes FROM relative to the bow (0 nose, +PI/2 starboard, ±PI astern)
//   offWind         rad 0..PI, angle between bow and the wind's source (0 = in irons, PI = dead run)
//   pointOfSail     'in irons'|'close-hauled'|'beam reach'|'broad reach'|'running'
//   luff            0..1 how much the sails are luffing (1 = flogging, in irons)
//   sailEff         0..1 sail actually set (lags sailSetting — crew need time to make/shorten sail)
//   targetSpeed     m/s the ship is accelerating toward;  knots (getter)
//   yawRate         rad/s current rate of turn;  rudderAngle -1..1 smoothed rudder
//   heel            rad, wind + turn heel component of roll (positive = heeled to port)
//   grounded        bool, aground this frame;  scrape 0..1 impact intensity (camera shake), decays
//   desiredHeading  rad|null  (writable) if set, the ship auto-steers toward it (AI convenience)
//   combatSpeedF / combatTurnF  multipliers written by combat.js (dismasting, weather gauge); default 1
//   teleport(x, z, heading?)  instant move with buoyancy reset
//   steerToward(heading, dt)  sets rudder with a damped P-controller; returns remaining heading error
//   (an AI controller far from the camera runs every 2 or 4 frames with the accumulated dt: see _think)
// Events emitted: 'ship:grounded' { ship, impact }, 'ship:collide' { a, b, impact }
// Coordinates: rotation applied as model.group.rotation.set(pitch, -heading, roll, 'YXZ');
//   roll > 0 lifts starboard (heel to port); pitch > 0 lifts the bow.
import * as THREE from 'three';
import { buildShipModel, SHIP_SPECS } from './shipModel.js';
import { SHALLOW_DRAFT } from '../data/shipTypes.js';
import { forwardFromHeading, wrapAngle, HALF_WORLD } from '../core/constants.js';
import { angleOffWind, windRelative, luff, pointOfSail, sailDrive, HANDLING, RIGS, rigPolar, windAffinity } from './physics/sailPhysics.js';

const NOMINAL_WIND = 9;
const SPEED_SCALE = 0.5;    // spec.maxSpeed is art-side 'class' speed; real brig tops ~12-13 kn, cruises 8-11 on a reach
const SINK = 0.55;          // hull sits this far below the averaged surface so the waterline foam reads     // m/s at which spec.maxSpeed is reached on the best point of sail
// Gameplay pace: ships travel PACE× further than their (plausible, displayed) speed. game.settings.pace overrides.
export const DEFAULT_PACE = 4;
export function getPace(game) { const p = +game?.settings?.pace; return p > 0 ? Math.min(8, p) : DEFAULT_PACE; }
// Arcade handling: faster acceleration, sail handling and turning than the 'realistic' base values.
const ACCEL_K = 0.3, SAIL_K = 3, YAW_K = 0.5;
const MAX_SUBSTEP = 1 / 30;
const SHOAL_DMG = 1.2;      // hull hp/s (× √mass × draft/3) while a deep hull drags on a submerged shoal
const TURN_SCALE = 0.72 * 2.0; // ×1.3 so handling keeps up with the gameplay pace     // spec.turn is peak rad/s; real helm authority is a bit lower for weight // physics substep (time compression feeds dt up to 0.2 s)
let _ids = 0;

export class Ship {
  constructor(game, o) {
    this.game = game;
    this.id = ++_ids;
    this.type = o.type || 'brig';
    this.spec = SHIP_SPECS[this.type] || SHIP_SPECS.brig;
    this.handling = HANDLING[this.type] || HANDLING.brig;
    this.faction = o.faction || 'english';
    this.name = o.name || 'Unnamed';
    this.isPlayer = !!o.isPlayer;
    this.position = new THREE.Vector3(o.x || 0, 0, o.z || 0);
    this.heading = o.heading || 0;
    this.speed = o.speed ?? 0; this.velocity = new THREE.Vector3();
    this.rudder = 0; this.sailSetting = o.sailSetting ?? 0.5;
    this.roll = 0; this.pitch = 0;
    this.rig = RIGS[this.type] || 'mixed';
    // shipyard refit multipliers (set by applyUpgrades): speed, turn; gunRange/gunSpread for combat
    this.speedMul = 1; this.turnMul = 1; this.gunRange = 1; this.gunSpread = 1;
    this.hullMax = this.spec.hull; this.hull = this.hullMax;
    this.sails = 1; this.crewMax = this.spec.crewMax; this.crew = o.crew ?? Math.round(this.crewMax * 0.6);
    this.guns = this.spec.guns; this.reload = { port: 1, starboard: 1 };
    this.alive = true; this.struck = false;
    this.controller = null;
    this.ammo = 'round';
    this.desiredHeading = null;

    // sailing state
    this.sailEff = this.sailSetting;
    this.rudderAngle = 0; this.yawRate = 0;
    this.leeway = 0;           // m/s sideways (positive = to starboard)
    this.windRel = 0; this.offWind = Math.PI / 2; this.pointOfSail = 'beam reach'; this.luff = 0;
    this.targetSpeed = 0; this.heel = 0; this.grounded = false; this.scrape = 0;
    // buoyancy springs
    this.heave = 0; this.heaveVel = 0;
    this.bPitch = 0; this.bPitchVel = 0; this.bRoll = 0; this.bRollVel = 0;
    this.gust = Math.random() * 100;
    this._groundCd = 0; this._nearLandT = 0; this._nearLand = true;

    this.model = buildShipModel(this.type, { faction: this.faction, name: this.name, seed: o.seed });
    this.length = this.model.length; this.beam = this.model.beam;
    // gameplay draft from the ship table; shallow-draft hulls (≤ SHALLOW_DRAFT) skim reefs and sand bars
    this.draft = this.spec.navDraft ?? this.model.draft ?? this.spec.draft;
    this.keel = this.draft <= SHALLOW_DRAFT ? -0.45 : -this.draft * 0.85;
    this.weatherSpeedF = 1;   // written by src/world/weatherZones.js (squall / storm-edge boost, storm-eye drag)
    game.scene.add(this.model.group);
    this.position.y = game.ocean?.getHeight?.(this.position.x, this.position.z) ?? 0;
    this.heave = this.position.y; this.position.y -= SINK;
  }

  // Move instantly (spawns, tests, cutscenes): resets buoyancy springs so the ship doesn't bob in from the old height.
  teleport(x, z, heading = this.heading) {
    this.position.x = x; this.position.z = z; this.heading = heading;
    const h = this.game.ocean?.getHeight?.(x, z) ?? 0;
    this.heave = h; this.heaveVel = 0; this.bPitch = this.bPitchVel = this.bRoll = this.bRollVel = 0;
    this.position.y = h - SINK; this.grounded = false; this._nearLandT = 0;
  }

  get knots() { return this.speed * 1.94384; }
  forward(out = new THREE.Vector3()) { return forwardFromHeading(this.heading, out); }
  right(out = new THREE.Vector3()) { return out.set(Math.cos(this.heading), 0, Math.sin(this.heading)); }

  // Damped P-controller: sets this.rudder to swing onto `heading`. Returns heading error (rad).
  steerToward(heading, dt) {
    const err = wrapAngle(heading - this.heading);
    const maxRate = this.spec.turn * TURN_SCALE * this.turnMul * (this.combatTurnF ?? 1) * Math.max(0.2, this._steerage ?? 1);
    // aim for a yaw rate proportional to error, then rudder to reach it (anticipates yaw inertia)
    const wantRate = Math.max(-maxRate, Math.min(maxRate, err * 1.6));
    this.rudder = Math.max(-1, Math.min(1, (wantRate - this.yawRate) / Math.max(0.05, maxRate) * 2.2 + wantRate / maxRate));
    return err;
  }

  update(dt, t) {
    if (!(dt > 0)) { this._applyTransform(dt, t); return; }
    this._think(dt);
    if (this.desiredHeading != null) this.steerToward(this.desiredHeading, dt);
    const n = Math.min(8, Math.ceil(dt / MAX_SUBSTEP));
    const h = dt / n;
    for (let i = 0; i < n; i++) this._step(h, t - dt + h * (i + 1));
    this._sanity();
    this._applyTransform(dt, t);
  }

  _step(dt, t) {
    const g = this.game, hd = this.handling, spec = this.spec;
    const wind = g.wind || { angle: 0, speed: NOMINAL_WIND };
    const alive = this.alive && !this.sinking;

    // --- wind & point of sail ---
    this.offWind = angleOffWind(this.heading, wind.angle);
    this.windRel = windRelative(this.heading, wind.angle);
    this.pointOfSail = pointOfSail(this.offWind);
    this.sailQuality = rigPolar(this.offWind, this.rig);   // 0..1 how well this rig likes the current heading
    this.luff = luff(this.offWind);

    // sail handling lags the order: crew must make/shorten sail (~3–6 s per step on a brig)
    const crewF = Math.min(1, this.crew / Math.max(1, this.crewMax * 0.35));
    const sailRate = SAIL_K * (0.12 + 0.18 * crewF) / Math.sqrt(hd.mass);
    const ds = this.sailSetting - this.sailEff;
    this.sailEff += Math.sign(ds) * Math.min(Math.abs(ds), sailRate * dt);

    // gusts: cheap two-sine wobble
    this.gust += dt;
    const gust = 1 + 0.07 * Math.sin(this.gust * 0.37) + 0.05 * Math.sin(this.gust * 1.13 + 1.7);
    const windF = Math.min(1.1, Math.sqrt(Math.max(0, wind.speed) / NOMINAL_WIND)) * gust * windAffinity(this.type, wind.speed, NOMINAL_WIND);

    const hullF = 1 - 0.35 * (1 - Math.max(0, this.hull) / this.hullMax);
    const rigF = 0.3 + 0.7 * Math.max(0, this.sails);
    const crewSpeedF = 0.7 + 0.3 * crewF;
    const drive = sailDrive(this.sailEff) * rigF * windF;
    let target = spec.maxSpeed * SPEED_SCALE * this.speedMul * (this.combatSpeedF ?? 1) * (this.weatherSpeedF ?? 1) * (this.fortuneSpeedF ?? 1) * (this.loadSpeedF ?? 1) * this.sailQuality * drive * hullF * crewSpeedF;
    // arcade: luffing only bleeds a little speed (no more being driven astern head to wind)
    if (this.luff > 0) target *= 1 - 0.25 * this.luff;
    if (!alive || this.struck) target = Math.min(target, 0.3);
    // aground: only a bow strike stops the ship; with the bow in clear water it can sail itself off
    if (this.grounded && this._groundBow) target = 0;
    this.targetSpeed = target;

    // --- momentum ---
    const steer = this._steerage = Math.min(1, 0.3 + Math.abs(this.speed) / (spec.maxSpeed * SPEED_SCALE * 0.3));
    const tau = ACCEL_K * (this.speed < target ? hd.accelTau : hd.accelTau * (this.luff > 0.5 ? 0.55 : 1.25));
    this.speed += (target - this.speed) * Math.min(1, dt / tau);
    // turning scrubs speed
    this.speed -= Math.abs(this.yawRate) * this.speed * 0.09 * dt;
    // surf / climb waves a little: slope along heading
    const slope = (this._hBow - this._hStern) / (this.length * 0.84) || 0;
    this.speed -= slope * 2.2 * dt;

    // --- rudder & yaw ---
    const rCmd = Math.max(-1, Math.min(1, this.rudder || 0));
    this.rudderAngle += (rCmd - this.rudderAngle) * Math.min(1, dt * 2.8);
    // reversing ships steer backwards
    const dir = this.speed < -0.05 ? -1 : 1;
    const turnF = spec.turn * TURN_SCALE * this.turnMul * (this.combatTurnF ?? 1) * (0.75 + 0.25 * Math.min(1, crewF)) * (0.6 + 0.4 * hullF);
    // weathervaning when nearly stopped: bow drifts away from the wind
    const vane = (1 - steer) * 0.05 * Math.sign(this.windRel) * -1 * (this.offWind < 1.2 ? 1 : 0);
    const wantYaw = this.rudderAngle * turnF * steer * dir + vane;
    this.yawRate += (wantYaw - this.yawRate) * Math.min(1, dt / (hd.yawTau * YAW_K));
    this.heading = wrapAngle(this.heading + this.yawRate * dt);

    // --- leeway: wind slip + skid in turns ---
    const sideWind = Math.sin(this.windRel); // + = wind from starboard -> slip to port (negative)
    const wantLee = -sideWind * wind.speed * hd.leeway * (0.3 + 0.7 * sailDrive(this.sailEff)) * (1 - 0.5 * this.luff)
      - this.yawRate * Math.max(0, this.speed) * 0.35;
    this.leeway += (wantLee - this.leeway) * Math.min(1, dt * 0.8);

    // --- heel: wind pressure to leeward + lean into turns ---
    const press = sailDrive(this.sailEff) * rigF * windF * windF * (1 - this.luff) * Math.abs(sideWind) ** 0.8;
    const heelWind = Math.sign(sideWind) * press * hd.heelMax;
    const heelTurn = -this.yawRate * Math.max(0, this.speed) * 0.036 / Math.sqrt(hd.mass);
    const puff = 1 + 0.18 * Math.sin(this.gust * 0.53 + this.id) + 0.1 * Math.sin(this.gust * 1.71 + 2.3 * this.id);
    const wantHeel = Math.max(-0.35, Math.min(0.35, heelWind * puff + heelTurn));
    // underdamped heel spring: the ship leans, overshoots a little and recovers instead of snapping to an angle
    const hk = this.handling.stiffness * 0.75;
    this.heelVel = (this.heelVel || 0) + (-hk * hk * (this.heel - wantHeel) - 2 * 0.28 * hk * (this.heelVel || 0)) * dt;
    this.heel += this.heelVel * dt;

    // --- integrate position ---
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    // velocity = real world displacement rate (includes gameplay pace); speed stays the plausible through-water speed
    const pace = this._pace = getPace(g);
    this.velocity.set((sh * this.speed + ch * this.leeway) * pace, 0, (-ch * this.speed + sh * this.leeway) * pace);
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    this._buoyancy(dt);
    this._ground(dt);
    this._collide(dt);
    this.scrape = Math.max(0, this.scrape - dt * 1.6);
  }

  _buoyancy(dt) {
    const oc = this.game.ocean;
    const px = this.position.x, pz = this.position.z;
    if (!oc?.getHeight) { this._hBow = this._hStern = 0; return; }
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const lf = this.length * 0.42, bf = this.beam * 0.5;
    // far ships (from camera) use a single sample
    const cam = this.game.camera.position;
    const far = (cam.x - px) ** 2 + (cam.z - pz) ** 2 > 1800 * 1800;
    let hc, hb, hs, hp, hst;
    hc = oc.getHeight(px, pz);
    if (far) { hb = hs = hp = hst = hc; }
    else {
      hb = oc.getHeight(px + sh * lf, pz - ch * lf);
      hs = oc.getHeight(px - sh * lf, pz + ch * lf);
      hp = oc.getHeight(px - ch * bf, pz - sh * bf);
      hst = oc.getHeight(px + ch * bf, pz + sh * bf);
    }
    this._hBow = hb; this._hStern = hs;
    const k = this.handling.stiffness, zeta = 0.3;
    const wantHeave = (hc * 2 + hb + hs + hp + hst) / 6;
    // pitch: big ships don't fully follow short waves -> bow slices into crests
    const wantPitch = Math.atan2(hb - hs, lf * 2) * 1.0;
    const wantRoll = Math.atan2(hst - hp, bf * 2) * 0.9;
    const spring = (x, v, target, kk) => -kk * kk * (x - target) - 2 * zeta * kk * v;
    this.heaveVel += spring(this.heave, this.heaveVel, wantHeave, k * 1.3) * dt;
    this.heave += this.heaveVel * dt;
    this.bPitchVel += spring(this.bPitch, this.bPitchVel, wantPitch, k) * dt;
    this.bPitch += this.bPitchVel * dt;
    this.bRollVel += spring(this.bRoll, this.bRollVel, wantRoll, k * 0.85) * dt;
    this.bRoll += this.bRollVel * dt;
    // bow lifts slightly with speed (squat at stern)
    const squat = Math.max(0, this.speed) / (this.spec.maxSpeed * SPEED_SCALE) * 0.012;
    this.position.y = this.heave - SINK;
    this.pitch = this.bPitch + squat;
    this.roll = this.bRoll + this.heel;
  }

  _ground(dt) {
    const isl = this.game.islands;
    if (!isl?.getTerrainHeight) return;
    // cull: only test when an island is within reach (re-evaluated every second)
    this._nearLandT -= dt;
    if (this._nearLandT <= 0) {
      this._nearLandT = 1;
      this._nearLand = false;
      const list = isl.list || [];
      if (!list.length) this._nearLand = true;
      for (const i of list) {
        if (Math.hypot(this.position.x - i.x, this.position.z - i.z) < (i.radius || 500) * 1.5 + 200) { this._nearLand = true; break; }
      }
    }
    this._groundCd = Math.max(0, this._groundCd - dt);
    if (!this._nearLand) { this.grounded = false; return; }
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const lf = this.length * 0.46;
    const bx = this.position.x + sh * lf, bz = this.position.z - ch * lf;
    const sx = this.position.x - sh * lf, sz = this.position.z + ch * lf;
    const keel = this.keel;
    const tb = isl.getTerrainHeight(bx, bz), tc = isl.getTerrainHeight(this.position.x, this.position.z), ts = isl.getTerrainHeight(sx, sz);
    const hit = Math.max(tb, tc, ts) > keel;
    if (!hit) { this.grounded = false; this._groundBow = false; return; }
    this._groundBow = tb > keel;
    // push out along terrain gradient at the deepest-penetrating point
    let hx = bx, hz = bz, ht = tb;
    if (tc > ht) { hx = this.position.x; hz = this.position.z; ht = tc; }
    if (ts > ht) { hx = sx; hz = sz; ht = ts; }
    const e = 3;
    const gx = isl.getTerrainHeight(hx + e, hz) - isl.getTerrainHeight(hx - e, hz);
    const gz = isl.getTerrainHeight(hx, hz + e) - isl.getTerrainHeight(hx, hz - e);
    let gl = Math.hypot(gx, gz), ux, uz;
    if (gl > 0.02) { ux = -gx / gl; uz = -gz / gl; }               // downhill = toward deeper water
    else if (hx !== this.position.x || hz !== this.position.z) {   // flat shoal: back away from the touching end
      const dx = this.position.x - hx, dz = this.position.z - hz, l = Math.hypot(dx, dz) || 1; ux = dx / l; uz = dz / l;
    } else { ux = -sh; uz = ch; }                                  // amidships on a flat: back astern
    const pen = Math.min(4, (ht - keel) * 0.5 + 0.3);
    // arcade: shove the hull firmly back into deep water (~20–30 m/s) so it never stays stuck
    const push = Math.max(3.5, pen * 2.5) * dt * 7;
    this.position.x += ux * push;
    this.position.z += uz * push;
    const impact = Math.abs(this.speed);
    if (!this.grounded && impact > 1.2 && this._groundCd <= 0) {
      const dmg = impact * impact * 0.35 * Math.sqrt(this.handling.mass);
      this.hull = Math.max(1, this.hull - dmg);
      this.scrape = Math.min(1, 0.25 + impact / 8);
      this._groundCd = 1.5;
      this.game.events?.emit('ship:grounded', { ship: this, impact });
      if (this.isPlayer) this.game.events?.emit('notify', { text: 'We have run aground!', kind: 'bad' });
    }
    this.scrape = Math.max(this.scrape, Math.min(0.5, Math.abs(this.speed) * 0.08));
    // a deep hull dragged over a submerged shoal (reef, sand bar) keeps tearing its planking
    if (ht < -0.2 && this.draft > SHALLOW_DRAFT) {
      const rate = (SHOAL_DMG + Math.abs(this.speed) * 0.5) * Math.sqrt(this.handling.mass) * Math.min(2, this.draft / 3) * (this.shoalDmgF ?? 1);   // navigator
      this.hull = Math.max(1, this.hull - rate * dt);
      if (this.isPlayer && (this._reefMsgT || 0) < this.game.time) {
        this._reefMsgT = this.game.time + 6;
        this.game.events?.emit('notify', { text: 'The hull scrapes the reef!', kind: 'bad' });
      }
    }
    if (this._groundBow) this.speed *= Math.max(0, 1 - dt * 3.5);
    this.grounded = true;
  }

  _collide(dt) {
    const ships = this.game.ships;
    if (!ships || ships.length < 2) return;
    const ax = this.position.x, az = this.position.z;
    const sha = Math.sin(this.heading), cha = Math.cos(this.heading);
    for (const o of ships) {
      if (o === this || o.id < this.id || o.sunk) continue;   // each pair once
      const dx = o.position.x - ax, dz = o.position.z - az;
      const rr = (this.length + o.length) * 0.5;
      if (dx * dx + dz * dz > rr * rr) continue;
      // three circles per hull (bow, mid, stern)
      const shb = Math.sin(o.heading), chb = Math.cos(o.heading);
      const ra = this.beam * 0.55, rb = o.beam * 0.55, sum = ra + rb;
      let px = 0, pz = 0, cnt = 0;
      for (let i = -1; i <= 1; i++) {
        const ox = ax + sha * this.length * 0.33 * i, oz = az - cha * this.length * 0.33 * i;
        for (let j = -1; j <= 1; j++) {
          const qx = o.position.x + shb * o.length * 0.33 * j, qz = o.position.z - chb * o.length * 0.33 * j;
          const ex = qx - ox, ez = qz - oz, d2 = ex * ex + ez * ez;
          if (d2 < sum * sum) { const d = Math.sqrt(d2) || 0.01; const p = sum - d; px += ex / d * p; pz += ez / d * p; cnt++; }
        }
      }
      if (!cnt) continue;
      const ma = this.handling.mass, mb = o.handling.mass, wa = mb / (ma + mb), wb = ma / (ma + mb);
      const k = Math.min(1, dt * 8) / cnt;
      this.position.x -= px * wa * k; this.position.z -= pz * wa * k;
      o.position.x += px * wb * k; o.position.z += pz * wb * k;
      // closing speed along the push normal
      const pl = Math.hypot(px, pz) || 1, nx = px / pl, nz = pz / pl;
      const closing = ((this.velocity.x - o.velocity.x) * nx + (this.velocity.z - o.velocity.z) * nz) / (this._pace || 1);
      if (closing > 0.5) {
        this.speed *= 1 - Math.min(0.5, dt * 2 * wa); o.speed *= 1 - Math.min(0.5, dt * 2 * wb);
        if (!this._bumpCd || this.game.time > this._bumpCd) {
          this._bumpCd = this.game.time + 1.2;
          const impact = closing;
          if (impact > 2) { this.hull = Math.max(1, this.hull - impact * wa * 1.5); o.hull = Math.max(1, o.hull - impact * wb * 1.5); }
          this.scrape = Math.max(this.scrape, Math.min(1, impact / 6)); o.scrape = Math.max(o.scrape, Math.min(1, impact / 6));
          this.game.events?.emit('ship:collide', { a: this, b: o, impact });
        }
      }
    }
  }

  _sanity() {
    const p = this.position;
    if (!Number.isFinite(p.x + p.y + p.z + this.heading + this.speed + this.roll + this.pitch)) {
      console.warn('[ship] non-finite state reset', this.name);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) p.set(0, 0, 0);
      p.y = 0; this.heading = Number.isFinite(this.heading) ? this.heading : 0;
      this.speed = 0; this.yawRate = 0; this.leeway = 0; this.heel = 0;
      this.heave = 0; this.heaveVel = 0; this.bPitch = this.bPitchVel = this.bRoll = this.bRollVel = 0; this.roll = this.pitch = 0;
    }
    const lim = HALF_WORLD - 50;
    p.x = Math.max(-lim, Math.min(lim, p.x)); p.z = Math.max(-lim, Math.min(lim, p.z));
  }

  // the controller (player or AI) decides; physics and steering toward desiredHeading still run every frame.
  // Far AI ships think less often, with the time gone by: every 2 frames beyond 900 m of the camera, every 4 beyond
  // 2 500 m (staggered by id) — never a ship that has the player as its target, nor one being chased by the player.
  _think(dt) {
    const c = this.controller;
    if (!c) return;
    let every = 1;
    if (!this.isPlayer) {
      const cam = this.game.camera?.position, ai = this.ai;
      const d = cam ? Math.hypot(this.position.x - cam.x, this.position.z - cam.z) : 0;
      const engaged = ai?.target?.isPlayer || this.game.player?.controller?.target === this || this.lastAttacker?.isPlayer;
      every = engaged || d < 900 ? 1 : d < 2500 ? 2 : 4;
    }
    this._thinkDt = (this._thinkDt || 0) + dt;
    this._thinkN = (this._thinkN ?? this.id) + 1;
    if (this._thinkN % every) return;
    c.update(this._thinkDt);
    this._thinkDt = 0;
  }

  _applyTransform(dt, t) {
    const m = this.model.group;
    m.position.copy(this.position);
    m.rotation.set(this.pitch, -this.heading, this.roll, 'YXZ');
    this.model.update(dt, t, {
      sailSetting: this.sailEff, windRel: this.windRel, speed: this.speed, heel: this.heel,
      luff: this.luff, rudder: this.rudderAngle,
      damage: { hull: 1 - this.hull / this.hullMax, sails: 1 - this.sails },
    });
  }

  dispose() { this.game.scene.remove(this.model.group); this.model.dispose(); }
}
