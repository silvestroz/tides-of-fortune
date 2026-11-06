// Camera rig: chase, broadside and tactical views, automatic combat framing, showcase shots and paths.
// API: follow(ship), target (Vector3 the camera looks at — sky uses it to centre shadows),
//      setShot({ position:[x,y,z], lookAt:[x,y,z], fov? }) for showcase scenes, update(dt).
// Extended API:
//   mode                 'chase' | 'broadside' | 'tactical' | 'shot' | 'path'
//   setMode(m), cycleMode()   cycles chase → broadside → tactical (C key via PlayerController)
//   aimSide              'port' | 'starboard' (broadside mode; follows the last broadside fired, or mouse orbit side)
//   orbitYaw, orbitPitch, zoom   user offsets (right-drag orbit, wheel zoom)
//   shake(amount)        add a camera-shake impulse (0..1). Auto: ship.scrape, the followed ship's broadsides.
//   setShotPath(keys, { duration, loop, relativeTo: ship, ease, onDone })
//        keys: [{ position:[x,y,z], lookAt:[x,y,z], fov?, roll? }, ...] sampled with a centripetal Catmull-Rom spline
//        over `duration` seconds (real time). If relativeTo is a ship, keys are in that ship's local frame
//        (x = starboard, y = up, z = astern; i.e. -z is toward the bow) so the move tracks a sailing ship.
//   chaseShot({ yaw, pitch, dist, lookAhead })  convenience for showcase compositions: chase mode with fixed orbit
//   lateUpdate(dt)       called by Game.step after ships move (keeps the camera locked to the rendered ship pose)
//   frameShips(list|null) tactical view fits these ships' bounding sphere (smooth zoom); autoTactical (bool, default true)
//   engaged              bool — the player exchanges fire / is attacked (8 s hold); read by HUD, audio, autosave
//   Combat: the tactical view switches on by itself in combat unless `settings.combatCam === 'manual'`
//     (Options “Combat camera”); C leaves it for the chase view (recentred on the ship) until the engagement
//     ends, C brings it back. 'camera:mode' { mode, auto } (auto = automatic switch).
//   cinematic            bool — when true the chase cam uses slower, wider "documentary" smoothing
// Camera never dips below ocean.getHeight + clearance. Uses real (unscaled) time for smoothing so time compression doesn't jerk it.
import * as THREE from 'three';
import { wrapAngle } from '../core/constants.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const MODES = ['chase', 'broadside', 'tactical'];
const ENGAGE_HOLD = 8;      // s without a shot before the tactical view eases back to chase
const TACT_MAX_DIST = 3.4;  // tactical recoil cap, in units of (player length × 10) — see _late()

// critically damped spring step (Game Programming Gems 4 "SmoothDamp"), scalar
function damp(cur, target, velObj, key, smoothTime, dt) {
  const omega = 2 / Math.max(1e-4, smoothTime), x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const v = velObj[key] || 0;
  const temp = (v + omega * change) * dt;
  velObj[key] = (v - omega * temp) * exp;
  return target + (change + temp) * exp;
}
function dampAngle(cur, target, velObj, key, smoothTime, dt) {
  return damp(cur, cur + wrapAngle(target - cur), velObj, key, smoothTime, dt);
}
function dampVec(cur, target, vel, smoothTime, dt) {
  cur.x = damp(cur.x, target.x, vel, 'x', smoothTime, dt);
  cur.y = damp(cur.y, target.y, vel, 'y', smoothTime, dt);
  cur.z = damp(cur.z, target.z, vel, 'z', smoothTime, dt);
}
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export class CameraRig {
  constructor(game) {
    this.game = game;
    this.target = new THREE.Vector3();
    this.ship = null; this.fixed = null;
    this.mode = 'chase'; this.prevMode = 'chase';
    this.aimSide = 'starboard';
    this.orbitYaw = 0; this.orbitPitch = 0; this.zoom = 1;
    this._zoomS = 1; this._orbitYawS = 0; this._orbitPitchS = 0;
    this.cinematic = false;
    this.autoTactical = true;   // switch chase→tactical on engagement (shots fired/taken, active attacker)
    this.frameList = null;
    this.baseFov = 52;
    // smoothed state
    this.camPos = new THREE.Vector3(0, 30, 80);
    this.look = new THREE.Vector3();
    this._pv = { x: 0, y: 0, z: 0 }; this._lv = { x: 0, y: 0, z: 0 };
    this._s = { yaw: 0, yawV: 0, heave: 0, heaveV: 0, fov: 52, fovV: 0, roll: 0, rollV: 0, lead: 0, leadV: 0, blend: 1 };
    this.camYaw = 0;
    this._shake = 0; this._shakeT = 0;
    this._snap = true;
    this._idleOrbitT = 0;
    this.path = null;
    // legacy compat: dist/height/yaw used by earlier code
    this.dist = 70; this.height = 26;
    game.events?.on('cannon:fire', ({ ship, side }) => {
      if (ship && ship === this.ship) { this.shake(0.35); if (this.mode === 'broadside' && side && !this._userSide) this.aimSide = side; }
      else if (ship && this.ship && ship.position.distanceToSquared(this.ship.position) < 250 * 250) this.shake(0.1);
    });
    game.events?.on('cannon:hit', ({ target }) => { if (target && target === this.ship) this.shake(0.6); });
  }

  // ---------- public API ----------
  follow(ship) {
    this.ship = ship; this.fixed = null; this.path = null;
    if (this.mode === 'shot' || this.mode === 'path') this.mode = this.prevMode || 'chase';
    this._snap = true;
  }
  setShot({ position, lookAt, fov }) {
    this.fixed = true; this.path = null; this.mode = 'shot';
    const cam = this.game.camera;
    cam.position.set(...position); this.target.set(...lookAt); cam.up.set(0, 1, 0); cam.lookAt(this.target);
    if (fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }
  setShotPath(keys, { duration = 8, loop = false, relativeTo = null, ease = true, onDone = null } = {}) {
    if (!keys || keys.length < 2) { if (keys?.length === 1) this.setShot(keys[0]); return; }
    if (this.mode !== 'shot' && this.mode !== 'path') this.prevMode = this.mode;
    this.fixed = null; this.mode = 'path';
    this.path = { keys, duration, loop, relativeTo, ease, onDone, t: 0 };
  }
  chaseShot({ yaw = 0, pitch = 0, dist = 1, lookAhead = true } = {}) {
    this.fixed = null; this.path = null; this.mode = 'chase';
    this.orbitYaw = this._orbitYawS = yaw; this.orbitPitch = this._orbitPitchS = pitch; this.zoom = this._zoomS = dist;
    this._noLookAhead = !lookAhead; this._holdOrbit = true; this._snap = true;
  }
  setMode(m, { auto = false } = {}) {
    if (!MODES.includes(m)) return;
    this.fixed = null; this.path = null;
    if (m !== this.mode) { this._s.blend = 0; this.mode = m; }
    if (m === 'broadside') { this._userSide = false; this.aimSide = this._defaultAimSide(); }
    this.game.events?.emit('camera:mode', { mode: m, auto });
  }
  cycleMode() {
    // in combat, C toggles combat view (tactical) ↔ view recentred behind the ship (chase), as the HUD's C pill says;
    // leaving the combat view suspends it until the engagement ends (no automatic switch back).
    // Out of combat: chase → broadside → overview.
    if (this._engaged) {
      this._autoSwitched = false;
      if (this.mode === 'tactical') { this._userCancel = true; this.setMode('chase'); }
      else { this._userCancel = false; this.setMode('tactical'); }
      return;
    }
    this._autoSwitched = false;
    const i = MODES.indexOf(this.mode);
    this.setMode(MODES[(i + 1) % MODES.length]);
  }
  shake(a) { this._shake = Math.min(1.2, this._shake + a); }

  // ---------- update ----------
  update(dt) {
    // input in update (before ships move); positioning in lateUpdate
    const g = this.game, inp = g.input;
    const realDt = g.timeScale ? dt / g.timeScale : dt;
    const m = inp?.mouse;
    if (m) {
      if ((m.buttons & 2) && (m.dx || m.dy)) {
        this.orbitYaw = wrapAngle(this.orbitYaw - m.dx * 0.0055);
        this.orbitPitch = Math.max(-0.35, Math.min(0.9, this.orbitPitch + m.dy * 0.0035));
        this._idleOrbitT = 0; this._holdOrbit = false;
        if (this.mode === 'broadside') {
          // dragging across the bow/stern flips the aimed side
          if (Math.abs(this.orbitYaw) > 0.9) { this.aimSide = this.aimSide === 'port' ? 'starboard' : 'port'; this.orbitYaw = 0; this._userSide = true; }
        }
      }
      if (m.wheel) this.zoom = Math.max(0.35, Math.min(3.2, this.zoom * Math.pow(1.12, m.wheel)));
    }
    // orbit drifts back behind the ship after a few seconds of no input (chase only)
    if (!(m && (m.buttons & 2))) this._idleOrbitT += realDt;
    if (this.mode === 'chase' && !this._holdOrbit && this._idleOrbitT > 4 && realDt > 0) {
      const k = Math.min(1, realDt * 0.35);
      this.orbitYaw += (0 - this.orbitYaw) * k; this.orbitPitch += (0 - this.orbitPitch) * k;
    }
    this._autoMode(realDt);
    if (!this._lateHooked) this._late(dt);   // fallback if Game.step has no lateUpdate hook
  }

  lateUpdate(dt) { this._lateHooked = true; this._late(dt); }

  _late(dt) {
    const g = this.game;
    const realDt = g.timeScale ? dt / g.timeScale : dt;
    if (this.mode === 'path' && this.path) { this._updatePath(realDt); return; }
    if (this.fixed || !this.ship) return;
    if (realDt <= 0 && !this._snap) return;   // frozen: keep the composed frame stable
    const dts = this._snap ? 1 : Math.min(realDt, 0.1);
    const s = this.ship, cam = g.camera, st = this._s, oc = g.ocean;

    this._zoomS += (this.zoom - this._zoomS) * Math.min(1, dts * 6);
    this._orbitYawS = dampAngle(this._orbitYawS, this.orbitYaw, st, 'oyV', 0.12, dts);
    this._orbitPitchS += (this.orbitPitch - this._orbitPitchS) * Math.min(1, dts * 10);
    st.blend = Math.min(1, st.blend + dts * 1.2);

    const L = s.length || 30;
    const spd = Math.max(0, s.speed), spdN = Math.min(1.2, spd / ((s.spec?.maxSpeed || 12) * 0.5));
    // smoothed heave reference: camera rides the swell gently, not every wave
    st.heave = damp(st.heave, s.position.y, st, 'heaveV', 0.7, dts);

    const desiredPos = _a, desiredLook = _b;
    let fov = this.baseFov, rollTarget = 0, posSmooth = 0.35, lookSmooth = 0.18;

    if (this.mode === 'tactical') {
      // Alone: high 3/4 view (pitch ~52°), ship fills ~40% of frame height.
      // Engagement (frameShips list, or the nearest foe within 700 m): low, close "battle" framing — the camera looks
      // across the line between the ships (biased toward the player's stern so steering still reads), pitch ~27°,
      // distance fitted so the group spans the frame width and the hulls+rigs stand at ~25–35% of frame height.
      const group = this._frameGroup(s);
      let cx = 0, cz = 0;
      for (const o of group) { cx += o.position.x; cz += o.position.z; }
      cx /= group.length; cz /= group.length;
      const vfov = group.length > 1 ? 40 : 38, hv = THREE.MathUtils.degToRad(vfov) / 2;
      const tv = Math.tan(hv), th = tv * Math.max(1, cam.aspect || 1.7);
      let yawT = s.heading, fit, pitch0 = 0.9, lookY = L * 0.35;
      if (group.length > 1) {
        // weight the player (followed ship) a little so it never slips out of frame
        if (s.isPlayer) { cx = cx * 0.8 + s.position.x * 0.2; cz = cz * 0.8 + s.position.z * 0.2; }
        const o = group[1];
        const ax = o.position.x - s.position.x, az = o.position.z - s.position.z;
        const axisYaw = Math.atan2(ax, -az);          // bearing player -> foe
        // two perpendicular viewing yaws; keep the one closest to looking along the player's heading
        const p1 = axisYaw + Math.PI / 2, p2 = axisYaw - Math.PI / 2;
        const perp = Math.abs(wrapAngle(p1 - s.heading)) < Math.abs(wrapAngle(p2 - s.heading)) ? p1 : p2;
        yawT = s.heading + wrapAngle(perp - s.heading) * 0.72;
        // extent of the group across the view direction (screen x) and along it (depth)
        const vx = Math.sin(yawT), vz = -Math.cos(yawT), rx = Math.cos(yawT), rz = Math.sin(yawT);
        // per ship: a ship nearer the camera (positive `toward`) needs that much more distance to stay in frame
        let dW = 0, hMax = 0;
        for (const q of group) {
          const dx = q.position.x - cx, dz = q.position.z - cz, ql = q.length || 30;
          const lat = Math.abs(dx * rx + dz * rz) + ql * 0.6, toward = -(dx * vx + dz * vz);
          dW = Math.max(dW, lat * 1.15 / th + Math.max(0, toward) * 1.2, (Math.abs(toward) + ql) / tv * 0.9);
          hMax = Math.max(hMax, ql * 1.05);            // waterline to truck ~ one hull length
        }
        const dH = hMax / 0.32 / (2 * tv);              // tallest rig at ~32% of frame height
        fit = Math.max(dW, dH, L * 3.2);
        const cap = Math.max(L * 3.2, TACT_MAX_DIST * 100);
        if (fit > cap) {
          // recoil capped: slide the framing centre toward the player so it never leaves the frame
          const k = Math.min(1, (fit - cap) / fit * 1.6);
          cx += (s.position.x - cx) * k; cz += (s.position.z - cz) * k; fit = cap;
        }
        pitch0 = 0.47; lookY = L * 0.18;
      } else fit = L * 4.3;
      if (this._snap) { st.yaw = yawT; st.tdist = fit; st.tpitch = pitch0; st.yawV = st.tdistV = st.tpitchV = 0; }
      st.yaw = dampAngle(st.yaw, yawT, st, 'yawV', group.length > 1 ? 2.2 : 4.0, dts);
      const yaw = st.yaw + this._orbitYawS;
      st.tdist = damp(st.tdist ?? fit, fit, st, 'tdistV', 0.9, dts);        // smooth zoom
      st.tpitch = damp(st.tpitch ?? pitch0, pitch0, st, 'tpitchV', 1.0, dts);
      const d = st.tdist * this._zoomS;
      desiredLook.set(cx, st.heave + lookY, cz);
      const pitch = THREE.MathUtils.clamp(st.tpitch + this._orbitPitchS * 0.5, 0.3, 1.0);   // never zenithal
      desiredPos.set(cx - Math.sin(yaw) * Math.cos(pitch) * d, st.heave + Math.sin(pitch) * d, cz + Math.cos(yaw) * Math.cos(pitch) * d);
      posSmooth = 0.6; lookSmooth = 0.45; fov = vfov;
    } else if (this.mode === 'broadside') {
      // gunner's view: from the quarterdeck rail on the aimed side, looking out abeam and slightly forward,
      // the ship's side running down the frame edge so you read the broadside and the target together
      const sideSign = this.aimSide === 'port' ? -1 : 1;
      st.yaw = dampAngle(st.yaw, s.heading, st, 'yawV', 0.35, dts);
      const fx = Math.sin(st.yaw), fz = -Math.cos(st.yaw);
      const rx = Math.cos(st.yaw) * sideSign, rz = Math.sin(st.yaw) * sideSign;   // unit toward aimed side
      const z = this._zoomS, B = s.beam || 8;
      // high over the opposite rail, roughly amidships: the aimed rail runs across the bottom of the frame
      // and the gun line points into open water (sails stay behind/below the camera, never occluding)
      const astern = L * (0.2 + 0.25 * z), out = -B * (1.4 + 0.8 * z), up = L * (0.85 + 0.25 * z) + this._orbitPitchS * L;
      desiredPos.set(s.position.x - fx * astern + rx * out, st.heave + up, s.position.z - fz * astern + rz * out);
      // bias the aim toward a ship on that side (within ±70° of abeam) so the target stays framed
      let ahead = this._orbitYawS * -sideSign * 160, reach = 150;
      const tgt = this._nearestOther(900) || this._nearestOther(600, true);
      if (tgt) {
        const dx = tgt.position.x - s.position.x, dz = tgt.position.z - s.position.z;
        const along = dx * fx + dz * fz, across = dx * rx + dz * rz;
        if (across > 0 && Math.abs(Math.atan2(along, across)) < 1.2) { const k = Math.min(1, 150 / Math.max(1, across)); ahead += along * k * 0.8; reach = Math.min(260, Math.max(110, across)); }
      }
      desiredLook.set(s.position.x + rx * reach + fx * ahead, st.heave - 3, s.position.z + rz * reach + fz * ahead);
      // roll with the deck a little: you feel the ship heel under your guns
      rollTarget = -s.roll * 0.3;
      posSmooth = 0.12; lookSmooth = 0.3; fov = 50;
    } else {
      // ---- chase ----
      const cin = this.cinematic ? 1.8 : 1;
      // yaw lags heading; while turning the camera swings slightly to the outside so you see where you're going
      const yawT = s.heading - (s.yawRate || 0) * 1.1;
      st.yaw = dampAngle(st.yaw, yawT, st, 'yawV', 0.9 * cin, dts);
      const yaw = st.yaw + this._orbitYawS;
      const z = this._zoomS;
      const dist = (L * 2.8 + 28 + spdN * L * 0.35) * z;
      const pitch = 0.24 + this._orbitPitchS + (z - 1) * 0.06;
      const bx = Math.sin(yaw), bz = -Math.cos(yaw);
      // look-ahead in direction of motion (velocity, includes leeway)
      const leadT = this._noLookAhead ? 0 : Math.min(L * 0.9, spd * 3.5);
      st.lead = damp(st.lead, leadT, st, 'leadV', 1.2, dts);
      const vl = Math.hypot(s.velocity.x, s.velocity.z);
      const vx = vl > 0.3 ? s.velocity.x / vl : Math.sin(s.heading), vz = vl > 0.3 ? s.velocity.z / vl : -Math.cos(s.heading);
      desiredLook.set(s.position.x + vx * st.lead, st.heave + L * 0.42, s.position.z + vz * st.lead);
      desiredPos.set(desiredLook.x - bx * Math.cos(pitch) * dist, st.heave + L * 0.12 + Math.sin(pitch) * dist, desiredLook.z - bz * Math.cos(pitch) * dist);
      // speed FOV breathing + gentle roll from turning and a share of the ship's roll
      fov = this.baseFov + spdN * 6 * (this.cinematic ? 0.5 : 1);
      rollTarget = -(s.yawRate || 0) * 0.22 + (s.roll || 0) * 0.12 * Math.cos(this._orbitYawS);
      posSmooth = 0.32 * cin; lookSmooth = 0.16 * cin;
    }

    // blend between modes: soften smoothing while blending in
    const bl = st.blend; posSmooth = posSmooth + (1 - bl) * 0.6; lookSmooth = lookSmooth + (1 - bl) * 0.4;
    if (this._snap) {
      this.camPos.copy(desiredPos); this.look.copy(desiredLook);
      this._pv.x = this._pv.y = this._pv.z = this._lv.x = this._lv.y = this._lv.z = 0;
      st.fov = fov; st.roll = rollTarget; this._snap = false;
    } else {
      dampVec(this.camPos, desiredPos, this._pv, posSmooth, dts);
      dampVec(this.look, desiredLook, this._lv, lookSmooth, dts);
      st.fov = damp(st.fov, fov, st, 'fovV', 0.8, dts);
      st.roll = damp(st.roll, rollTarget, st, 'rollV', 0.5, dts);
    }

    // never clip the water: sample under camera and slightly in front (near-plane footprint)
    const p = cam.position.copy(this.camPos);
    if (oc?.getHeight) {
      const fwdx = this.look.x - p.x, fwdz = this.look.z - p.z, fl = Math.hypot(fwdx, fwdz) || 1;
      const h0 = oc.getHeight(p.x, p.z), h1 = oc.getHeight(p.x + fwdx / fl * 3, p.z + fwdz / fl * 3);
      const minY = Math.max(h0, h1) + 2.2;
      if (p.y < minY) { p.y = minY; this.camPos.y = Math.max(this.camPos.y, minY); }
    }

    // shake (scrape on rocks, broadsides, hits)
    this._shake = Math.max(this._shake, s.scrape ? s.scrape * 0.8 : 0);
    let sx = 0, sy = 0, sr = 0;
    if (this._shake > 0.001 && realDt > 0) {
      this._shakeT += realDt;
      const a = this._shake * this._shake, t = this._shakeT;
      sx = (Math.sin(t * 37.1) + Math.sin(t * 23.7 + 1.3)) * 0.35 * a;
      sy = (Math.sin(t * 41.3 + 2.1) + Math.sin(t * 29.1)) * 0.3 * a;
      sr = Math.sin(t * 31.7 + 0.7) * 0.012 * a;
      this._shake = Math.max(0, this._shake - realDt * 1.8);
    }
    p.x += sx; p.y += sy;
    // handheld sway: slow, layered, never still (~0.2 Hz, ~0.3°), stronger in chase
    if (realDt > 0) this._swayT = (this._swayT || 0) + realDt;
    const tw = this._swayT || 0, swA = this.mode === 'chase' ? 1 : 0.5;
    p.y += Math.sin(tw * 1.21) * 0.35 * swA;
    sr += (Math.sin(tw * 1.26 + 0.4) * 0.004 + Math.sin(tw * 0.53) * 0.003) * swA;

    this.target.copy(this.look);
    this.target.x += Math.sin(tw * 0.9 + 1.1) * 0.25 * swA; this.target.y += Math.sin(tw * 1.37) * 0.2 * swA;
    cam.up.set(0, 1, 0);
    cam.lookAt(this.target);
    if (st.roll + sr) cam.rotateZ(st.roll + sr);
    if (Math.abs(cam.fov - st.fov) > 0.01) { cam.fov = st.fov; cam.updateProjectionMatrix(); }
  }

  // ---------- internals ----------
  _defaultAimSide() {
    const s = this.ship; if (!s) return 'starboard';
    const foe = this._nearestOther(1500) || this._nearestOther(600, true);
    if (foe) {
      const b = Math.atan2(foe.position.x - s.position.x, -(foe.position.z - s.position.z));
      return wrapAngle(b - s.heading) < 0 ? 'port' : 'starboard';
    }
    return this.aimSide;
  }
  // Ships the tactical camera frames together with `s`: explicit frameShips() list, else nearest foe within 700 m.
  _frameGroup(s) {
    if (this.frameList) { const l = this.frameList.filter(o => o && o.alive !== false && !o.sunk); if (!l.includes(s)) l.unshift(s); return l; }
    const foe = this._currentFoe();
    return foe ? [s, foe] : [s];
  }
  // frameShips([a, b, ...]) — tactical view auto-frames these ships (null = automatic). Also usable without a player:
  // rig.frameShips([a, b]) follows a[0] and switches to tactical.
  frameShips(list) {
    this.frameList = list && list.length ? list : null;
    if (this.frameList) { if (!this.ship || !this.frameList.includes(this.ship)) this.follow(this.frameList[0]); this.setMode('tactical'); this._snap = true; }
  }
  // Engagement-driven tactical view. Enters only when: the player fired, the player was hit, or a hostile actively
  // attacks (targets the player AND fired recently, or is inside gun range and closing). Leaves softly after
  // ENGAGE_HOLD s without any shot from/at the player. C cancels it for the current engagement (or forces it).
  _autoMode(realDt) {
    if (!this.ship || this.fixed || this.path) return;
    this._clock = (this._clock || 0) + realDt;
    const now = this._clock, me = this.ship;
    if (!this._engHook && this.game.events) {
      this._engHook = true; this._lastShot = -1e9;
      this.game.events.on('cannon:fire', ({ ship } = {}) => {
        if (!ship || !this.ship) return;
        ship._camFireT = this._clock || 0;
        if (ship === this.ship) this._lastShot = this._clock || 0;
        else if (this._isAttacker(ship) && ship.position.distanceTo(this.ship.position) < 900) { this._lastShot = this._clock || 0; this._foe = ship; }
      });
      this.game.events.on('cannon:hit', ({ target, attacker } = {}) => {
        if (!this.ship) return;
        if (target === this.ship) { this._lastShot = this._clock || 0; if (attacker && attacker !== this.ship) this._foe = attacker; }
        else if (attacker === this.ship && target) { this._lastShot = this._clock || 0; this._foe = target; }
      });
    }
    // hostile actively attacking: targets the player and (fired < 8 s ago, or within gun range and closing)
    const attacking = this._nearestOther(520, false, o => {
      if (!this._isAttacker(o)) return false;
      if (o._camFireT != null && now - o._camFireT < ENGAGE_HOLD) return true;
      const dx = me.position.x - o.position.x, dz = me.position.z - o.position.z;
      return (o.velocity.x - me.velocity.x) * dx + (o.velocity.z - me.velocity.z) * dz > 0;   // closing
    });
    const engaged = (now - this._lastShot < ENGAGE_HOLD) || !!attacking;
    this.engaged = engaged;
    if (engaged !== this._engaged) {
      this._engaged = engaged;
      if (!engaged) this._userCancel = false;
    }
    // player setting “Combat camera: manual”: never switch by itself (C stays free); an automatic tactical
    // view in progress hands control back as soon as the setting changes
    const manual = this.game.settings?.combatCam === 'manual';
    if (manual && this._autoSwitched && this.mode === 'tactical' && !this.frameList) { this._autoSwitched = false; this.setMode('chase'); }
    if (!this.autoTactical || manual) return;
    if (engaged && !this._userCancel && this.mode === 'chase') { this.setMode('tactical', { auto: true }); this._autoSwitched = true; }
    else if (!engaged && this._autoSwitched && this.mode === 'tactical' && !this.frameList) { this.setMode('chase'); this._autoSwitched = false; }
  }
  _isAttacker(o) {
    const me = this.ship;
    return !!me && o !== me && o.alive !== false && !o.sunk && !o.struck && o.ai?.target === me
      && (o.hostileTo?.has?.(me) || o.grudges?.has?.(me) || o.ai?.state === 'engage' || me.controller?.isEnemy?.(o));
  }
  // current foe for framing: last ship exchanging fire with us if still close, else nearest engaged hostile
  _currentFoe() {
    const me = this.ship, f = this._foe;
    if (f && f.alive !== false && !f.sunk && f.position.distanceTo(me.position) < 800) {
      const alt = this._nearestOther(800, false, o => this._isAttacker(o) && o !== f);
      // switch to a much closer attacker in a melee
      if (alt && alt.position.distanceTo(me.position) < f.position.distanceTo(me.position) * 0.6) this._foe = alt;
      return this._foe;
    }
    this._foe = null;
    return this._nearestOther(700, false, o => this._isAttacker(o) || (o._camFireT != null && this._clock - o._camFireT < ENGAGE_HOLD))
      || (this._engaged ? this._nearestOther(500) : null);
  }

  _nearestOther(maxD, any = false, filter = null) {
    const s = this.ship; if (!s) return null;
    const ctrl = any ? null : s.controller;
    let best = null, bd = maxD * maxD;
    for (const o of this.game.ships) {
      if (o === s || !o.alive || o.sunk) continue;
      if (ctrl?.isEnemy && !ctrl.isEnemy(o)) continue;
      if (filter && !filter(o)) continue;
      const d = o.position.distanceToSquared(s.position);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  _keyToWorld(k, field, out) {
    const v = k[field];
    out.set(v[0], v[1], v[2]);
    const rel = this.path.relativeTo;
    if (rel) {
      const h = rel.heading, c = Math.cos(h), sn = Math.sin(h);
      // local: x starboard, z astern -> world
      const x = out.x * c - out.z * sn, z = out.x * sn + out.z * c;
      out.set(rel.position.x + x, this._pathHeave + out.y, rel.position.z + z);
    }
    return out;
  }
  _updatePath(dt) {
    const P = this.path, cam = this.game.camera;
    P.t += dt;
    if (P.relativeTo) this._pathHeave = damp(this._pathHeave ?? P.relativeTo.position.y, P.relativeTo.position.y, this._s, 'phV', 1.4, Math.max(dt, 1e-4));
    let u = P.t / P.duration;
    if (u >= 1) {
      if (P.loop) { P.t %= P.duration; u = P.t / P.duration; }
      else { u = 1; }
    }
    const e = P.ease ? u * u * (3 - 2 * u) : u;
    const n = P.keys.length, f = e * (n - 1), i = Math.min(n - 2, Math.floor(f)), t = f - i;
    const idx = j => P.keys[Math.max(0, Math.min(n - 1, j))];
    const k0 = idx(i - 1), k1 = idx(i), k2 = idx(i + 1), k3 = idx(i + 2);
    const p0 = this._keyToWorld(k0, 'position', _a).clone(), p1 = this._keyToWorld(k1, 'position', _b).clone();
    const p2 = this._keyToWorld(k2, 'position', _c).clone(), p3 = this._keyToWorld(k3, 'position', _d).clone();
    cam.position.set(catmull(p0.x, p1.x, p2.x, p3.x, t), catmull(p0.y, p1.y, p2.y, p3.y, t), catmull(p0.z, p1.z, p2.z, p3.z, t));
    const l0 = this._keyToWorld(k0, 'lookAt', _a).clone(), l1 = this._keyToWorld(k1, 'lookAt', _b).clone();
    const l2 = this._keyToWorld(k2, 'lookAt', _c).clone(), l3 = this._keyToWorld(k3, 'lookAt', _d).clone();
    this.target.set(catmull(l0.x, l1.x, l2.x, l3.x, t), catmull(l0.y, l1.y, l2.y, l3.y, t), catmull(l0.z, l1.z, l2.z, l3.z, t));
    const oc = this.game.ocean;
    if (oc?.getHeight) cam.position.y = Math.max(cam.position.y, oc.getHeight(cam.position.x, cam.position.z) + 1.5);
    cam.up.set(0, 1, 0); cam.lookAt(this.target);
    const roll = (k1.roll || 0) * (1 - t) + (k2.roll || 0) * t;
    if (roll) cam.rotateZ(roll);
    const fov = (k1.fov || this.baseFov) * (1 - t) + (k2.fov || this.baseFov) * t;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.camPos.copy(cam.position); this.look.copy(this.target);
    if (u >= 1 && !P.loop) {
      const done = P.onDone; this.path = null; this.fixed = true; this.mode = 'shot';
      done?.();
    }
  }
}
