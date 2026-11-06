// Rare sea life around the player: dolphins leaping off the bow, a whale blowing and sounding far off, flying fish
// gliding ahead, a turtle paddling at the surface, a ray leaping in shallow water, small bait fish jumping near coasts.
// API: new SeaLife(game) (system: update(dt, t)); seaLife.spawn(kind) forces an event (debug, ?sealife=<kind>,
// shot scenes); seaLife.warmup(); seaLife.stats().
// Rendering: one InstancedMesh per species (stylised merged primitives, flat-shaded MeshStandardMaterial) = at most
// 6 draw calls, each hidden while it has no live animal. Animation is CPU-composed instance matrices (a few dozen
// instances at most). Splashes reuse fx.splash / ocean.addFoam; sounds audio.play('dolphin' | 'whale:blow' | 'splash').
// Frequency (SEA_LIFE below): each kind has a mean interval in seconds of sailing (exponential draw), counted only in
// mode 'sail', never while a fight is on (audio.combat > 0.12, hostile ship < 1500 m) or in storms; disabled in 'low'.
// Roughly 15-20 sightings per hour of sailing. The whale is noted in the log book (toasts.record), nothing else.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const SEA_LIFE = {
  //          mean gap (s), first allowed after (s), duration (s), needs
  dolphins: { every: 720, after: 90, dur: 22 },
  flyfish:  { every: 700, after: 150, dur: 9 },
  whale:    { every: 1500, after: 300, dur: 26 },
  turtle:   { every: 1100, after: 200, dur: 22 },
  ray:      { every: 1100, after: 200, dur: 10, shallow: true },   // water 2-18 m deep
  bait:     { every: 420, after: 60, dur: 10, shallow: true },     // coastal bait fish, water < 25 m
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3(), _s = new THREE.Vector3();

// ---------- stylised geometry (built facing +Z, up +Y) ----------
function ell(rx, ry, rz, x = 0, y = 0, z = 0, seg = 10) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, seg * 0.6 | 0));
  g.scale(rx, ry, rz); g.translate(x, y, z); return g;
}
function tri(a, b, c) {   // double-sided thin fin
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...b], 3));
  g.computeVertexNormals(); return g;
}
function colorize(g, c) {
  const n = g.attributes.position.count, col = new Float32Array(n * 3), cc = new THREE.Color(c);
  const pos = g.attributes.position;
  for (let i = 0; i < n; i++) {
    // pale belly: lighten vertices below the body axis (painterly countershading)
    const k = pos.getY(i) < 0 ? 1.55 : 1;
    col[i * 3] = Math.min(1, cc.r * k); col[i * 3 + 1] = Math.min(1, cc.g * k); col[i * 3 + 2] = Math.min(1, cc.b * k);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function build(parts) {
  const gs = parts.map(([g, c]) => { const ng = g.index ? g.toNonIndexed() : g; ng.deleteAttribute('uv'); return colorize(ng, c); });
  const m = mergeGeometries(gs); m.computeBoundingSphere(); return m;
}
function dolphinGeo() {
  return build([
    [ell(0.32, 0.36, 1.25), 0x5a6b78], [ell(0.12, 0.1, 0.32, 0, -0.06, 1.38), 0x5a6b78],
    [tri([0, 0.3, 0.1], [0, 0.78, -0.35], [0, 0.3, -0.55]), 0x46545f],
    [tri([0, 0, -1.1], [0.55, 0, -1.55], [0.1, 0, -1.25]), 0x46545f], [tri([0, 0, -1.1], [-0.55, 0, -1.55], [-0.1, 0, -1.25]), 0x46545f],
    [tri([0.25, -0.15, 0.5], [0.6, -0.32, 0.1], [0.25, -0.2, 0.2]), 0x46545f], [tri([-0.25, -0.15, 0.5], [-0.6, -0.32, 0.1], [-0.25, -0.2, 0.2]), 0x46545f],
  ]);
}
function whaleGeo() {
  return build([
    [ell(2.2, 2.0, 7.5, 0, 0, 0, 14), 0x39434c], [ell(1.6, 1.3, 2.2, 0, -0.3, 6.6, 12), 0x39434c],
    [tri([0, 1.7, -3], [0, 2.5, -4.2], [0, 1.4, -4.8]), 0x2c343b],
    [tri([0, 0, -7], [3.4, 0.2, -9.2], [0.4, 0, -7.8]), 0x2c343b], [tri([0, 0, -7], [-3.4, 0.2, -9.2], [-0.4, 0, -7.8]), 0x2c343b],
    [tri([1.6, -0.8, 3], [3.8, -1.6, 0.5], [1.6, -1, 1.5]), 0x2c343b], [tri([-1.6, -0.8, 3], [-3.8, -1.6, 0.5], [-1.6, -1, 1.5]), 0x2c343b],
  ]);
}
function flyfishGeo() {
  return build([
    [ell(0.06, 0.06, 0.24, 0, 0, 0, 8), 0x3d6f9a],
    [tri([0.03, 0.02, 0.08], [0.34, 0.03, -0.06], [0.03, 0.02, -0.12]), 0xa9c4d6], [tri([-0.03, 0.02, 0.08], [-0.34, 0.03, -0.06], [-0.03, 0.02, -0.12]), 0xa9c4d6],
    [tri([0, 0, -0.2], [0, 0.1, -0.34], [0, -0.12, -0.34]), 0x3d6f9a],
  ]);
}
function turtleGeo() {
  return build([
    [ell(0.55, 0.2, 0.7, 0, 0, 0, 10), 0x5f5a33], [ell(0.13, 0.11, 0.18, 0, 0, 0.78), 0x7d7a52],
    [tri([0.4, 0, 0.35], [1.0, -0.05, 0.05], [0.45, 0, 0.0]), 0x7d7a52], [tri([-0.4, 0, 0.35], [-1.0, -0.05, 0.05], [-0.45, 0, 0.0]), 0x7d7a52],
    [tri([0.3, 0, -0.45], [0.55, -0.05, -0.75], [0.15, 0, -0.6]), 0x7d7a52], [tri([-0.3, 0, -0.45], [-0.55, -0.05, -0.75], [-0.15, 0, -0.6]), 0x7d7a52],
  ]);
}
function rayGeo() {
  return build([
    [ell(0.35, 0.12, 0.6, 0, 0, 0, 8), 0x4a4a52],
    [tri([0, 0, 0.6], [1.4, 0, -0.1], [0, 0, -0.5]), 0x3e3e46], [tri([0, 0, 0.6], [-1.4, 0, -0.1], [0, 0, -0.5]), 0x3e3e46],
    [tri([0, 0, -0.5], [0.04, 0, -2.0], [-0.04, 0, -0.5]), 0x3e3e46],
  ]);
}
function baitGeo() { return build([[ell(0.05, 0.07, 0.2, 0, 0, 0, 6), 0x9fb3bd], [tri([0, 0, -0.18], [0, 0.08, -0.28], [0, -0.08, -0.28]), 0x9fb3bd]]); }

const KINDS = {
  dolphins: { geo: dolphinGeo, max: 6 }, whale: { geo: whaleGeo, max: 1 }, flyfish: { geo: flyfishGeo, max: 14 },
  turtle: { geo: turtleGeo, max: 1 }, ray: { geo: rayGeo, max: 2 }, bait: { geo: baitGeo, max: 24 },
};

export class SeaLife {
  constructor(game) {
    this.game = game;
    this.rnd = Math.random;
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, flatShading: true, side: THREE.DoubleSide });
    this.mesh = {};
    for (const [k, d] of Object.entries(KINDS)) {
      const m = new THREE.InstancedMesh(d.geo(), this.mat, d.max);
      m.count = 0; m.visible = false; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true;
      m.name = 'sealife-' + k;
      this.mesh[k] = m; game.scene.add(m);
    }
    this.events = [];      // live sightings { kind, t, dur, ...state }
    this.sailT = 0;
    this.next = {};
    for (const [k, c] of Object.entries(SEA_LIFE)) this.next[k] = c.after + this._exp(c.every);
    const forced = game.params?.get?.('sealife');
    if (forced) this._forced = forced;
  }

  _exp(mean) { return -Math.log(1 - this.rnd() * 0.999) * mean; }

  warmup() {   // show every species for one compile pass
    for (const m of Object.values(this.mesh)) { m.count = 1; m.visible = true; m.setMatrixAt(0, _m.makeTranslation(0, -500, 0)); }
    this._warm = true;
  }

  stats() { return { live: this.events.map(e => e.kind), next: { ...this.next }, sailT: this.sailT }; }

  _calm() {
    const g = this.game, p = g.player;
    if (!p || g.mode !== 'sail') return false;
    if ((g.audio?.combat || 0) > 0.12) return false;
    if ((g.sky?.storm || 0) > 0.5) return false;
    for (const s of g.ships) if (s !== p && !s.sinking && s.hostile && s.position.distanceTo(p.position) < 1500) return false;
    return true;
  }

  _depth(x, z) { const t = this.game.ocean?.terrainAt?.(x, z); return t == null ? 200 : -t; }
  _wy(x, z) { return this.game.ocean?.getHeight?.(x, z) ?? 0; }

  spawn(kind) {
    const g = this.game, p = g.player; if (!p || !KINDS[kind]) return null;
    const h = p.heading, fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    const side = this.rnd() < 0.5 ? -1 : 1, r = this.rnd;
    const e = { kind, t: 0, dur: SEA_LIFE[kind].dur, animals: [] };
    const P = p.position;
    if (kind === 'dolphins') {
      const n = 3 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) e.animals.push({ off: new THREE.Vector2(side * (9 + r() * 14) + (r() - 0.5) * 6, 10 + r() * 26), ph: r() * 6.28, rate: 1.5 + r() * 0.5, wasUp: false });
      e.sound = 1.5;
    } else if (kind === 'flyfish') {
      const n = 8 + Math.floor(r() * 6);
      const cx = P.x + fx * (45 + r() * 30) + rx * side * (10 + r() * 20), cz = P.z + fz * (45 + r() * 30) + rz * side * (10 + r() * 20);
      const dir = h + side * (0.4 + r() * 0.5);
      for (let i = 0; i < n; i++) e.animals.push({ x: cx + (r() - 0.5) * 14, z: cz + (r() - 0.5) * 14, dir: dir + (r() - 0.5) * 0.3, sp: 13 + r() * 5, t0: r() * 1.5, glide: 2.6 + r() * 2.2, hop: 0 });
    } else if (kind === 'whale') {
      const d = 380 + r() * 320, a = h + side * (0.5 + r() * 0.9);
      e.x = P.x + Math.sin(a) * d; e.z = P.z - Math.cos(a) * d; e.dir = h + (r() - 0.5) * 2; e.blown = 0;
      if (this._depth(e.x, e.z) < 30) return null;
      g.hud?.toasts?.record?.('A whale blows in the distance.', 'info', 'info');
    } else if (kind === 'turtle') {
      e.x = P.x + fx * (40 + r() * 20) + rx * side * (14 + r() * 10); e.z = P.z + fz * (40 + r() * 20) + rz * side * (14 + r() * 10);
      e.dir = h + side * 1.2;
    } else if (kind === 'ray' || kind === 'bait') {
      // find shallow water in a ring around the player
      let ok = false;
      for (let k = 0; k < 16 && !ok; k++) {
        const a = r() * 6.28, d = 35 + r() * 90, x = P.x + Math.sin(a) * d, z = P.z - Math.cos(a) * d, dp = this._depth(x, z);
        if (kind === 'ray' ? dp > 2 && dp < 18 : dp > 1.5 && dp < 25) { e.x = x; e.z = z; ok = true; }
      }
      if (!ok) return null;
      e.dir = r() * 6.28;
      if (kind === 'ray') e.animals = [{ ph: 0 }, ...(r() < 0.4 ? [{ ph: 1.2 }] : [])];
      else for (let i = 0; i < 18; i++) e.animals.push({ ox: (r() - 0.5) * 12, oz: (r() - 0.5) * 12, t0: r() * 8, rate: 0.6 + r() * 0.5 });
    }
    this.events.push(e);
    return e;
  }

  update(dt) {
    const g = this.game;
    if (this._warm) { this._warm = false; for (const m of Object.values(this.mesh)) { m.count = 0; m.visible = false; } }
    if (this._forced && g.player) { for (const k of this._forced.split(',')) this.spawn(k); this._forced = null; }
    if (!g.frozen && this._calm()) {
      this.sailT += dt;
      for (const [k, c] of Object.entries(SEA_LIFE)) {
        if (this.sailT < this.next[k]) continue;
        this.next[k] = this.sailT + this._exp(c.every);
        if (!this.events.some(e => e.kind === k)) this.spawn(k);
      }
    }
    for (const k in this.mesh) this.mesh[k].count = 0;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (!g.frozen) e.t += dt;
      // a fight starts: animals leave at once (dive)
      if (e.t > e.dur || (!this._calm() && !g.frozen && g.mode === 'sail' && (g.audio?.combat || 0) > 0.12)) { this.events.splice(i, 1); continue; }
      this['_' + e.kind](e, g.frozen ? 0 : dt);
    }
    for (const k in this.mesh) { const m = this.mesh[k]; m.visible = m.count > 0; if (m.count) m.instanceMatrix.needsUpdate = true; }
  }

  _put(kind, x, y, z, yaw, pitch = 0, roll = 0, sc = 1) {
    const m = this.mesh[kind]; if (m.count >= KINDS[kind].max) return;
    _e.set(pitch, yaw, roll); _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sc, sc, sc));
    m.setMatrixAt(m.count++, _m);
  }

  _splash(x, z, size) { this.game.fx?.splash?.(_p.set(x, this._wy(x, z), z), size); }

  // porpoising pod riding alongside the bow
  _dolphins(e, dt) {
    const p = this.game.player; if (!p) return;
    const h = p.heading, fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    const fade = Math.min(1, e.t / 2, (e.dur - e.t) / 3);
    for (const a of e.animals) {
      a.off.y += dt * (Math.sin(e.t * 0.3 + a.ph) * 1.2 - (fade < 1 && e.t > 5 ? 4 : 0));   // drift fore/aft, drop astern at the end
      const x = p.position.x + rx * a.off.x + fx * a.off.y, z = p.position.z + rz * a.off.x + fz * a.off.y;
      const ph = e.t * a.rate * 2.2 + a.ph, s = Math.sin(ph);
      const wy = this._wy(x, z);
      const y = wy - 0.9 + (s > 0 ? s * 2.4 : s * 1.2) * fade;
      const pitch = -Math.cos(ph) * 0.75;
      const up = y > wy - 0.2;
      if (up !== a.wasUp && dt > 0) { this._splash(x, z, 0.12); this.game.ocean?.addFoam?.(x, z, 1.6, 0.6); a.wasUp = up; }
      if (y > wy - 1.6) this._put('dolphins', x, y, z, h, pitch, 0, 1.8);   // stylised: a bit larger than life so the pod reads from the chase camera
    }
    if (dt > 0 && (e.sound -= dt) < 0) { e.sound = 2.5 + Math.random() * 3; this.game.audio?.play?.('dolphin', { position: p.position }); }
  }

  // flying fish: low gliding arcs that skip off the swell
  _flyfish(e, dt) {
    for (const a of e.animals) {
      const lt = e.t - a.t0; if (lt < 0) continue;
      const cyc = lt % (a.glide + 0.6), on = cyc < a.glide;
      a.x += Math.sin(a.dir) * a.sp * dt * (on ? 1 : 0.4); a.z -= Math.cos(a.dir) * a.sp * dt * (on ? 1 : 0.4);
      const wy = this._wy(a.x, a.z);
      if (!on) { if (a.hop === 1 && dt > 0) { this.game.ocean?.addFoam?.(a.x, a.z, 0.8, 0.4); a.hop = 0; } continue; }
      if (a.hop === 0 && dt > 0) a.hop = 1;
      const u = cyc / a.glide, y = wy + 0.25 + Math.sin(u * Math.PI) * 1.4;
      this._put('flyfish', a.x, y, a.z, a.dir, -Math.cos(u * Math.PI) * 0.25, Math.sin(lt * 9) * 0.15, 1.4);
    }
  }

  // whale: surfaces, blows twice, rolls forward and raises its flukes to sound
  _whale(e, dt) {
    const t = e.t, sp = 2.2;
    e.x += Math.sin(e.dir) * sp * dt; e.z -= Math.cos(e.dir) * sp * dt;
    const wy = this._wy(e.x, e.z);
    let y, pitch = 0;
    if (t < 4) y = wy - 4 + t * 0.85;                       // rising
    else if (t < 16) y = wy - 0.6 + Math.sin(t * 0.8) * 0.25;   // logging at the surface
    else { const u = Math.min(1, (t - 16) / 8); pitch = u * 1.25; y = wy - 0.6 - u * 6; }   // sounding: nose down, flukes up
    if (dt > 0 && ((t > 5 && e.blown === 0) || (t > 11 && e.blown === 1))) {
      e.blown++;
      const bx = e.x + Math.sin(e.dir) * 4, bz = e.z - Math.cos(e.dir) * 4;
      this.game.fx?.splash?.(_p.set(bx, wy + 1.5, bz), 1.1);
      this.game.audio?.play?.('whale:blow', { position: _p.set(bx, wy, bz) });
    }
    if (t > 16 && t < 17 && dt > 0 && !e.foam) { e.foam = 1; this.game.ocean?.addFoam?.(e.x, e.z, 9, 0.8); }
    this._put('whale', e.x, y, e.z, e.dir, pitch);
  }

  _turtle(e, dt) {
    e.x += Math.sin(e.dir) * 0.8 * dt; e.z -= Math.cos(e.dir) * 0.8 * dt;
    const wy = this._wy(e.x, e.z), sink = Math.max(0, e.t - (e.dur - 5)) * 0.4;
    const paddle = Math.sin(e.t * 2.2) * 0.12;
    this._put('turtle', e.x, wy - 0.12 - sink, e.z, e.dir + paddle * 0.3, -0.05, paddle, 1.2);
  }

  // ray: a few leaps out of shallow water, belly flop on landing
  _ray(e, dt) {
    for (const a of e.animals) {
      const lt = e.t - a.ph; if (lt < 0) continue;
      const cyc = lt % 3.2, on = cyc < 1.1;
      const x = e.x + Math.sin(e.dir) * lt * 3 + a.ph * 4, z = e.z - Math.cos(e.dir) * lt * 3;
      const wy = this._wy(x, z);
      if (!on) { if (a.air && dt > 0) { this._splash(x, z, 0.3); a.air = false; } continue; }
      a.air = true;
      const u = cyc / 1.1;
      this._put('ray', x, wy + Math.sin(u * Math.PI) * 1.8, z, e.dir, -0.4 + u * 0.8, Math.sin(lt * 14) * 0.25, 1);
    }
  }

  // bait fish: little silver fish skipping out of the water in a patch near the coast
  _bait(e, dt) {
    for (const a of e.animals) {
      const lt = (e.t + a.t0) * a.rate, cyc = lt % 1, jump = Math.floor(lt) % 2 === 0 && cyc < 0.45;
      if (!jump) continue;
      const x = e.x + a.ox + Math.sin(lt * 1.3) * 3, z = e.z + a.oz + Math.cos(lt * 1.1) * 3, u = cyc / 0.45;
      const wy = this._wy(x, z);
      if (u > 0.92 && dt > 0 && Math.random() < 0.5) this.game.ocean?.addFoam?.(x, z, 0.6, 0.35);
      this._put('bait', x, wy + Math.sin(u * Math.PI) * 0.6, z, e.dir + a.ox, -Math.cos(u * Math.PI) * 0.9, 0, 1.6);
    }
  }
}
