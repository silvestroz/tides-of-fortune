// Rendering of the town in a tilted top-down view: a standalone three.js scene in the style of the land battle
// (materials and silhouettes shared with landbattle/view.js), ~15 draw calls.
//   const v = new SneakView(game).build(sim, { coat, seed })   v.update(sim, dt)   v.render()   v.dispose()
//   v.project(x, z, y) -> { x, y } screen pixels     SneakView.warmup(game) (called by game.warmup())
// The render's sun follows SNEAK.moonDir / moonElev: the shadows shown are the ones that hide in the simulation.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeMaterials, painted, tr, manGeo } from '../landbattle/view.js';
import { C, rayFree } from './sim.js';
import { SNEAK } from '../../data/sneak.js';
import { mulberry32 } from '../../core/rng.js';

const RAYS = 22, MAXG = 10;
let CONE_MAT = null;
const coneMat = () => CONE_MAT ||= new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
const strip = g => (g.deleteAttribute('uv'), g);

export class SneakView {
  constructor(game) { this.game = game; this.scene = null; }

  static warmup(game) {
    const M = makeMaterials(), s = new THREE.Scene(), g = new THREE.BoxGeometry(1, 1, 1);
    s.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1), new THREE.DirectionalLight(0xffffff, 1));
    for (const m of [M.ground, M.water, M.veg, M.house, M.men, M.ring, coneMat()]) s.add(new THREE.Mesh(g, m));
    for (const k of ['veg', 'house', 'men', 'ring']) { const im = new THREE.InstancedMesh(g, M[k], 1); im.setColorAt(0, new THREE.Color(1, 1, 1)); s.add(im); }
    s.fog = new THREE.Fog(0x8a8f9a, 120, 400);
    const cam = new THREE.PerspectiveCamera(40, 1, 1, 100);
    try { game.renderer.compile(s, cam); } catch (e) { console.warn('warmup sneak', e); }
    g.dispose();
  }

  build(sim, { coat = '#2d4c8f', seed = 1 } = {}) {
    const M = makeMaterials(), m = sim.map, S = this.scene = new THREE.Scene(), r = mulberry32(seed), cell = m.cell;
    this.sim = sim; this.disposables = [];
    const keep = o => { this.disposables.push(o); return o; };
    const MW = m.W * cell, MH = m.H * cell;
    S.background = new THREE.Color(0x6f7c8c);
    S.fog = new THREE.Fog(0x7d8692, 140, 420);
    S.add(new THREE.HemisphereLight(0xc9d2e6, 0x4a4036, 1.05));
    const sun = new THREE.DirectionalLight(0xffc690, 2.6), sd = SNEAK.moonDir, e = SNEAK.moonElev;
    sun.position.set(MW / 2 + sd.x * Math.cos(e) * 200, Math.sin(e) * 200, MH / 2 + sd.z * Math.cos(e) * 200);
    sun.target.position.set(MW / 2, 0, MH / 2); S.add(sun, sun.target);
    sun.castShadow = true; const sc = sun.shadow.camera; sc.left = -150; sc.right = 150; sc.top = 130; sc.bottom = -130; sc.far = 500; sc.updateProjectionMatrix();
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.4;
    // ---- ground: cobbles, plank quay, grassy yards; slightly darkened in shadow (readability) ----
    const PAD = 14, SUB = 2;
    const geo = keep(new THREE.PlaneGeometry((m.W + PAD * 2) * cell, (m.H + PAD * 2) * cell, (m.W + PAD * 2) * SUB, (m.H + PAD * 2) * SUB));
    geo.rotateX(-Math.PI / 2); geo.translate(MW / 2, 0, MH / 2);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
    const PAL = { [C.STREET]: '#a2927a', [C.HOUSE]: '#8d7c66', [C.WATER]: '#6f6a58', [C.QUAY]: '#8a6a48', [C.YARD]: '#6f8248', [C.GATE]: '#a2927a', [C.CRATE]: '#a2927a' };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), inside = x >= 0 && z >= 0 && x <= MW && z <= MH;
      const k = Math.max(0, Math.min(m.W - 1, Math.floor(x / cell))) + Math.max(0, Math.min(m.H - 1, Math.floor(z / cell))) * m.W;
      let t = inside ? m.type[k] : z < 3 * cell ? C.WATER : C.YARD, y = 0;
      if (t === C.WATER) y = -1.6;
      if (!inside && z >= 3 * cell) y = 2 + Math.min(10, Math.max(-x, x - MW, z - MH, 0) * 0.08);
      pos.setY(i, y);
      c.set(PAL[t]);
      const n = Math.sin(x * 0.9) * Math.sin(z * 0.9) * 0.5 + Math.sin(x * 0.13 + z * 0.07) * 0.5;
      c.offsetHSL(n * 0.01, n * 0.03, n * (t === C.QUAY ? 0.02 : 0.04) + (t === C.QUAY ? Math.sin(x * 2.4) * 0.025 : 0));
      if (inside && m.shade[k]) c.multiplyScalar(0.86);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
    const ground = this.ground = new THREE.Mesh(geo, M.ground); ground.receiveShadow = true; S.add(ground);
    const wg = keep(new THREE.PlaneGeometry(MW + 400, 260)); wg.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(wg, M.water); water.position.set(MW / 2, -0.5, 3 * cell - 130); S.add(water);
    // ---- houses: one body + a hipped roof per cell, tinted per block; rampart and monuments ----
    const bodyG = keep(strip(painted(tr(new THREE.BoxGeometry(cell, 1, cell), 0, 0.5, 0), '#ffffff')));
    const roofG = keep(strip(painted(tr(new THREE.CylinderGeometry(0.01, cell * 0.74, 2.4, 4, 1), 0, 1.2, 0, 0, Math.PI / 4), '#ffffff')));
    const cells = [];
    for (let k = 0; k < m.W * m.H; k++) if (m.type[k] === C.HOUSE) cells.push(k);
    const dummy = new THREE.Object3D(), tint = new THREE.Color(), roofC = new THREE.Color();
    const bodies = new THREE.InstancedMesh(bodyG, M.house, cells.length), roofs = new THREE.InstancedMesh(roofG, M.house, cells.length);
    cells.forEach((k, n) => {
      const i = k % m.W, j = k / m.W | 0, h = m.hgt[k], b = m.blocks[m.blockId[k]], wall = m.blockId[k] < 0;
      dummy.position.set((i + 0.5) * cell, 0, (j + 0.5) * cell); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, h, 1); dummy.updateMatrix(); bodies.setMatrixAt(n, dummy.matrix);
      dummy.position.y = h; dummy.scale.set(wall ? 0.001 : 1, wall ? 0.001 : 0.8 + r() * 0.5, wall ? 0.001 : 1); dummy.updateMatrix(); roofs.setMatrixAt(n, dummy.matrix);
      const role = b?.role;
      if (wall || role === 'prison') tint.setHSL(0.09, 0.08, 0.5 + r() * 0.06);
      else if (role === 'governor') tint.setHSL(0.12, 0.35, 0.86);
      else tint.setHSL(0.06 + (b?.tint || 0) * 0.08, 0.28 + r() * 0.1, 0.7 + (b?.tint || 0) * 0.15 + r() * 0.05);
      bodies.setColorAt(n, tint);
      roofs.setColorAt(n, roofC.setHSL(role === 'governor' ? 0.6 : 0.03 + r() * 0.03, role === 'governor' ? 0.2 : 0.55, role === 'prison' ? 0.28 : 0.36 + r() * 0.08));
    });
    for (const im of [bodies, roofs]) { im.castShadow = true; im.receiveShadow = true; S.add(im); }
    // ---- crates / barrels, yard trees ----
    const crateG = keep(mergeGeometries([strip(painted(tr(new THREE.BoxGeometry(2.2, 1.6, 2.2), -0.9, 0.8, -0.6), '#8a6a3e')), strip(painted(tr(new THREE.BoxGeometry(1.6, 1.4, 1.6), 1.1, 0.7, 0.9, 0, 0.4), '#7a5a32')),
      strip(painted(tr(new THREE.CylinderGeometry(0.8, 0.8, 1.7, 8), 1.2, 0.85, -1.2), '#6a4a2a')), strip(painted(tr(new THREE.BoxGeometry(1.4, 1.2, 1.4), -0.6, 2.2, -0.5, 0, 0.7), '#93744a'))]));
    const crates = new THREE.InstancedMesh(crateG, M.house, Math.max(1, m.crates.length));
    m.crates.forEach((k, n) => { dummy.position.set((k % m.W + 0.5) * cell, 0, ((k / m.W | 0) + 0.5) * cell); dummy.rotation.set(0, r() * 6, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); crates.setMatrixAt(n, dummy.matrix); crates.setColorAt(n, tint.setHSL(0.08, 0.3, 0.8 + r() * 0.2)); });
    crates.count = m.crates.length; crates.castShadow = crates.receiveShadow = true; S.add(crates);
    const treeG = keep(mergeGeometries([strip(painted(tr(new THREE.CylinderGeometry(0.3, 0.45, 3, 5), 0, 1.5, 0), '#5a4330')),
      strip(painted(tr(new THREE.IcosahedronGeometry(3.2, 0), 0, 5.2, 0), '#456b2e')), strip(painted(tr(new THREE.IcosahedronGeometry(2.3, 0), 1.2, 6.8, 0.6), '#56803a'))]));
    const trees = new THREE.InstancedMesh(treeG, M.veg, Math.max(1, m.trees.length));
    m.trees.forEach((t, n) => { dummy.position.set(t.x, 0, t.z); dummy.rotation.set(0, r() * 6, 0); dummy.scale.setScalar(t.s); dummy.updateMatrix(); trees.setMatrixAt(n, dummy.matrix); });
    trees.count = m.trees.length; trees.castShadow = true; S.add(trees);
    // ---- prison grate, tavern sign, governor's flag, longboat at the quay ----
    const gate = m.gate;
    this.gateMesh = new THREE.Mesh(keep(mergeGeometries([0, 1, 2, 3, 4, 5].map(q => strip(painted(tr(new THREE.CylinderGeometry(0.09, 0.09, 4, 4), -2 + q * 0.8, 2, 0), '#2a2622'))).concat([strip(painted(tr(new THREE.BoxGeometry(cell, 0.25, 0.2), 0, 3.9, 0), '#2a2622'))]))), M.house);
    this.gateMesh.position.set(gate.x, 0, gate.z); this.gateMesh.visible = !gate.open; this.gateMesh.castShadow = true; S.add(this.gateMesh);
    const props = [];
    const tav = m.blocks.find(b => b.role === 'tavern'), gov = m.blocks.find(b => b.role === 'governor');
    if (tav) { const x = (Math.floor((tav.i0 + tav.i1) / 2) + 0.5) * cell, z = tav.j0 * cell; props.push(strip(painted(tr(new THREE.BoxGeometry(0.15, 0.15, 1.6), x, 4.2, z - 0.8), '#3a2a1a')), strip(painted(tr(new THREE.BoxGeometry(1.3, 0.9, 0.1), x, 3.5, z - 1.5), '#b8862c')), strip(painted(tr(new THREE.SphereGeometry(0.28, 6, 4), x + 1.4, 3.2, z - 0.4), '#ffd27a'))); }
    if (gov) { const x = (Math.floor((gov.i0 + gov.i1) / 2) + 0.5) * cell, z = (gov.j0 + 0.2) * cell; props.push(strip(painted(tr(new THREE.CylinderGeometry(0.12, 0.15, 6, 5), x, gov.h + 3, z + 2), '#3a2a1a'))); this._flagAt = { x: x + 1.3, y: gov.h + 5, z: z + 2 }; }
    const propM = new THREE.Mesh(keep(mergeGeometries(props)), M.house); propM.castShadow = true; S.add(propM);
    if (this._flagAt) { const fl = this.flag = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.6, 1.7, 6, 2)), keep(M.flag.clone())); fl.material.color.set(coat); fl.position.set(this._flagAt.x, this._flagAt.y, this._flagAt.z); S.add(fl); }
    // ---- captain and guards ----
    const men = this.men = new THREE.InstancedMesh(keep(manGeo('musket')), M.men, MAXG); men.castShadow = true; men.frustumCulled = false; men.setColorAt(0, new THREE.Color()); S.add(men);
    this.cap = new THREE.InstancedMesh(keep(manGeo('blade')), M.men, 1); this.cap.castShadow = true; this.cap.frustumCulled = false; this.cap.setColorAt(0, new THREE.Color('#7c1a1a')); S.add(this.cap);
    this.coat = new THREE.Color(coat);
    // rings: objectives (gold, pulsing), captain (always visible, no depth test)
    this.rings = new THREE.InstancedMesh(keep(new THREE.RingGeometry(0.82, 1, 36).rotateX(-Math.PI / 2)), M.ring, 6); this.rings.frustumCulled = false; this.rings.setColorAt(0, new THREE.Color()); S.add(this.rings);
    const pr = this.capRing = new THREE.Mesh(keep(new THREE.RingGeometry(0.7, 0.95, 32).rotateX(-Math.PI / 2)), keep(M.ring.clone()));
    pr.material.depthTest = false; pr.material.color.set(0xffe9a0); pr.renderOrder = 5; S.add(pr);
    // vision cones: a single dynamic mesh (fan clipped by the walls), coloured by wariness
    const cg = this.coneGeo = keep(new THREE.BufferGeometry());
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXG * RAYS * 9), 3));
    cg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAXG * RAYS * 9), 3));
    this.cones = new THREE.Mesh(cg, coneMat()); this.cones.frustumCulled = false; this.cones.renderOrder = 2; S.add(this.cones);
    this.camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 2, 900);
    this.cam = { x: sim.player.x, z: sim.player.z, dist: 78 };
    this._t = 0;
    return this;
  }

  update(sim, dt) {
    this._t += dt;
    const d = new THREE.Object3D(), col = new THREE.Color(), p = sim.player, m = sim.map;
    // capitaine
    const bob = p.moving ? Math.abs(Math.sin(this._t * (p.run ? 14 : 9))) * 0.22 : 0;
    d.position.set(p.x, bob, p.z); d.rotation.set(p.picking ? 0.35 : 0, p.heading, 0); d.scale.setScalar(2.05); d.updateMatrix(); this.cap.setMatrixAt(0, d.matrix); this.cap.instanceMatrix.needsUpdate = true;   // ×1.2
    this.capRing.position.set(p.x, 0.12, p.z); this.capRing.scale.setScalar(1.3 + 0.12 * Math.sin(this._t * 4));
    // guards + cones
    const pa = this.coneGeo.attributes.position.array, ca = this.coneGeo.attributes.color.array, V = SNEAK.view;
    let n = 0, v = 0;
    for (const g of sim.guards) {
      if (g.down || n >= MAXG) continue;
      const moving = g.path?.length && !(g.wait > 0);
      d.position.set(g.x, moving ? Math.abs(Math.sin(this._t * 8 + g.id)) * 0.18 : 0, g.z); d.rotation.set(0, g.heading, 0); d.scale.setScalar(1.9); d.updateMatrix();
      this.men.setMatrixAt(n, d.matrix); this.men.setColorAt(n, col.copy(this.coat)); n++;
      const range = V.range * (sim.alarm || g.sus >= SNEAK.levels[2] ? V.alarmMul : 1) * 0.92, k = Math.min(1, g.sus / 100);
      col.setRGB(1, 0.92 - k * 0.7, 0.55 - k * 0.45);
      if (sim.alarm) col.setRGB(1, 0.15, 0.1);
      let px = g.x, pz = g.z, first = true;
      for (let q = 0; q <= RAYS; q++) {
        const a = g.heading - V.half + q / RAYS * V.half * 2, rr = rayFree(m, g.x, g.z, a, range);
        const x = g.x + Math.sin(a) * rr, z = g.z + Math.cos(a) * rr;
        if (!first) {
          for (const [X, Z] of [[g.x, g.z], [px, pz], [x, z]]) { pa[v] = X; pa[v + 1] = 0.25; pa[v + 2] = Z; ca[v] = col.r; ca[v + 1] = col.g; ca[v + 2] = col.b; v += 3; }
        }
        first = false; px = x; pz = z;
      }
    }
    this.men.count = n; this.men.instanceMatrix.needsUpdate = true; if (this.men.instanceColor) this.men.instanceColor.needsUpdate = true;
    this.coneGeo.setDrawRange(0, v / 3); this.coneGeo.attributes.position.needsUpdate = true; this.coneGeo.attributes.color.needsUpdate = true;
    this.cones.material.opacity = sim.alarm ? 0.3 + 0.12 * Math.sin(this._t * 9) : 0.34;
    // objectifs
    let ri = 0;
    for (const g of m.goals) {
      d.position.set(g.x, 0.2, g.z); d.rotation.set(0, 0, 0); d.scale.setScalar(SNEAK.goalR * (1 + 0.1 * Math.sin(this._t * 3 + ri))); d.updateMatrix();
      this.rings.setMatrixAt(ri, d.matrix); this.rings.setColorAt(ri, col.set(0xf0c050)); ri++;
    }
    if (!m.gate.open) { d.position.set(m.gate.x, 0.2, m.gate.z + m.cell * 0.5); d.scale.setScalar(2.2); d.updateMatrix(); this.rings.setMatrixAt(ri, d.matrix); this.rings.setColorAt(ri, col.set(0x9ec4ff)); ri++; }
    this.rings.count = ri; this.rings.instanceMatrix.needsUpdate = true; if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    this.gateMesh.visible = !m.gate.open;
    if (this.flag) { const fp = this.flag.geometry.attributes.position; for (let i = 0; i < fp.count; i++) { const x = fp.getX(i) + 1.3; fp.setZ(i, Math.sin(this._t * 4 + x * 1.5) * 0.2 * x); } fp.needsUpdate = true; }
    // camera: follows the captain (slight lag)
    const c = this.cam, f = 1 - Math.exp(-dt * 4);
    c.x += (p.x - c.x) * f; c.z += (p.z - c.z) * f;
  }

  render() {
    const r = this.game.renderer, c = this.cam, cam = this.camera;
    const W = innerWidth, H = innerHeight; if (cam.aspect !== W / H) { cam.aspect = W / H; cam.updateProjectionMatrix(); }
    const pitch = 1.12, tz = c.z + 6;
    cam.position.set(c.x, Math.sin(pitch) * c.dist, tz - Math.cos(pitch) * c.dist);
    cam.lookAt(c.x, 0, tz);
    const prevExp = r.toneMappingExposure, sh = r.shadowMap.enabled;
    r.toneMappingExposure = 1.0; r.shadowMap.enabled = true; r.shadowMap.needsUpdate = true;
    r.setRenderTarget(null); r.render(this.scene, cam);
    r.toneMappingExposure = prevExp; r.shadowMap.enabled = sh;
  }

  project(x, z, y = 0) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, behind: v.z > 1 };
  }

  dispose() {
    for (const o of this.disposables || []) o.dispose?.();
    this.scene?.traverse(o => { if (o.isInstancedMesh) o.dispose?.(); if (o.isLight) o.dispose?.(); });
    this.scene = null;
  }
}
