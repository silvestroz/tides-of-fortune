// Rendering of the town at night in a tilted top-down view: a standalone three.js scene in a painted storybook
// style. Moonlight casts the shadows the simulation hides in (SNEAK.moonDir / moonElev); lanterns and the guards'
// torches are mostly faked (additive light pools on the ground, halos, unlit flames, warm windows) with only
// four real point lights following the lights nearest the captain. The static town is built into a handful of
// merged meshes (≈ 25 draw calls in all).
//   const v = new SneakView(game).build(sim, { coat, nation, seed })   v.update(sim, dt)   v.render()   v.dispose()
//   v.project(x, z, y) -> { x, y } screen pixels     v.pick(clientX, clientY) -> { x, z } on the ground or null
//   v.throwStone({ x, z, dur }) (stone in flight)    v.ping(x, z) (noise ring where it fell)
//   SneakView.warmup(game) (called by game.warmupRare()): compiles the town's programs (the characters' are compiled
//   when a scene starts: SneakActors are built with the scene and disposed with it).
// The captain and the guards are articulated, animated figures (actors.js); rings and the flag material come from
// the land battle's view; the rest is built here.
import * as THREE from 'three';
import { makeMaterials } from '../landbattle/view.js';
import { setFigureFill } from '../duel/figure.js';
import { SneakActors } from './actors.js';
import { C, rayFree } from './sim.js';
import { SNEAK } from '../../data/sneak.js';
import { mulberry32 } from '../../core/rng.js';

const RAYS = 22, MAXG = 12, NPOINT = 4, MAXRING = 28;
const WALLS = ['#d8a95e', '#df917a', '#e9e1cf', '#9dbccc', '#e4cd8c', '#d79aa0'];   // ochre, salmon, white, pale blue, straw, pink
const SHUTTERS = ['#4f6d4a', '#3f5d7e', '#7a3a2a', '#6b5232'];
const ROOFS = ['#c8603e', '#d4784c', '#b5563a', '#cc7a52'];
const LAMP = new THREE.Color(1.0, 0.6, 0.26), WARM = '#ffc66e';

// ------------------------------------------------------------------ materials (created once, shared by the warmup)
let MATS = null;
function materials() {
  if (MATS) return MATS;
  const std = o => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, ...o });
  // ground: cobbles (aKind 1) and planks (aKind 2) drawn from the world position
  const ground = std({ vertexColors: true });
  ground.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aKind;\nvarying float vKind;\nvarying vec2 vGP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKind = aKind; vGP = (modelMatrix * vec4(position, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying float vKind; varying vec2 vGP;
float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float cobble(vec2 p) {
  p *= 1.7; float row = floor(p.y); p.x += 0.5 * mod(row, 2.0);
  vec2 f = fract(p) - 0.5, i = floor(p);
  float e = max(abs(f.x), abs(f.y) * 1.15), h = h21(i);
  return (1.0 - smoothstep(0.34, 0.48, e)) * (0.82 + 0.3 * h);
}
float planks(vec2 p) {
  float b = floor(p.y / 0.75), f = fract(p.y / 0.75), j = fract((p.x + h21(vec2(b, 3.0)) * 7.0) / 4.0);
  return (0.78 + 0.25 * h21(vec2(b, 1.0))) * smoothstep(0.0, 0.08, f) * smoothstep(1.0, 0.92, f) * smoothstep(0.0, 0.015, j);
}`).replace('#include <color_fragment>', `#include <color_fragment>
float kc = clamp(1.0 - abs(vKind - 1.0) * 2.0, 0.0, 1.0), kp = clamp((vKind - 1.5) * 2.0, 0.0, 1.0);
diffuseColor.rgb *= mix(1.0, mix(0.5, 1.08, cobble(vGP)), kc) * mix(1.0, mix(0.45, 1.05, planks(vGP)), kp);`);
  };
  ground.customProgramCacheKey = () => 'sneakGround_v1';
  // tiled roofs: rows of round tiles from the uv (u along the ridge, v up the slope, in metres)
  const roof = std({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
  roof.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vRoofUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoofUv = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vRoofUv;\nfloat rh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }')
      .replace('#include <color_fragment>', `#include <color_fragment>
float rv = vRoofUv.y / 0.42, row = floor(rv), fr = fract(rv), cu = vRoofUv.x / 0.34 + 0.5 * mod(row, 2.0), fc = fract(cu);
float tile = (0.62 + 0.38 * smoothstep(0.0, 0.45, fr)) * (0.8 + 0.2 * sin(fc * 3.14159)) * (0.88 + 0.22 * rh(vec2(floor(cu), row)));
diffuseColor.rgb *= tile;`);
  };
  roof.customProgramCacheKey = () => 'sneakRoof_v1';
  // soft radial glow, drawn once on a canvas
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  const glowTex = new THREE.CanvasTexture(c); glowTex.colorSpace = THREE.SRGBColorSpace;
  const add = o => new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, ...o });
  MATS = {
    ground, roof,
    house: std({ vertexColors: true, flatShading: true }),
    veg: std({ vertexColors: true, flatShading: true }),
    water: std({ color: 0x24506a, emissive: 0x081a28, roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.88 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),   // windows, flames: lit from within
    pool: add({ polygonOffset: true, polygonOffsetFactor: -2 }),                     // light pools on the ground
    halo: add({ side: THREE.DoubleSide }),                                           // halos around the flames
    cone: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    stone: new THREE.MeshBasicMaterial({ color: 0xd8d0c0 }),
  };
  return MATS;
}

// the night: dim blue sky light, moonlight with shadows, a few warm point lights (returned)
function lightRig(S, MW = 230, MH = 160) {
  S.background = new THREE.Color(0x0a1120);
  S.fog = new THREE.Fog(0x0c1424, 150, 430);
  const hemi = new THREE.HemisphereLight(0x6a82b8, 0x2a2630, 1.35);
  const moon = new THREE.DirectionalLight(0xa9c2ff, 1.55), sd = SNEAK.moonDir, e = SNEAK.moonElev;
  moon.position.set(MW / 2 + sd.x * Math.cos(e) * 200, Math.sin(e) * 200, MH / 2 + sd.z * Math.cos(e) * 200);
  moon.target.position.set(MW / 2, 0, MH / 2);
  moon.castShadow = true; const sc = moon.shadow.camera; sc.left = -150; sc.right = 150; sc.top = 130; sc.bottom = -130; sc.far = 500; sc.updateProjectionMatrix();
  moon.shadow.mapSize.set(2048, 2048); moon.shadow.bias = -0.0005; moon.shadow.normalBias = 0.4;
  S.add(hemi, moon, moon.target);
  const points = [];
  for (let i = 0; i < NPOINT; i++) { const p = new THREE.PointLight(0xffa04a, 0, 20, 1.7); S.add(p); points.push(p); }
  return points;
}

// ------------------------------------------------------------------ geometry builder (flat triangles, vertex colours)
const TMP = new THREE.Color(), col = h => new THREE.Color(h);
class Builder {
  constructor(uv = false) { this.p = []; this.c = []; this.uv = uv ? [] : null; }
  tri(a, b, c, k, out = null, uvs = null) {
    if (out) {   // orient the face toward `out`
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * out[0] + ny * out[1] + nz * out[2] < 0) { [b, c] = [c, b]; if (uvs) uvs = [uvs[0], uvs[2], uvs[1]]; }
    }
    this.p.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.c.push(k.r, k.g, k.b);
    if (this.uv) this.uv.push(...(uvs ? uvs.flat() : [0, 0, 0, 0, 0, 0]));
  }
  quad(a, b, c, d, k, out, uvs = null) { this.tri(a, b, c, k, out, uvs && [uvs[0], uvs[1], uvs[2]]); this.tri(a, c, d, k, out, uvs && [uvs[0], uvs[2], uvs[3]]); }
  // box centred on (x, z), from y0 to y0 + h, turned by ry; no bottom face; sides slightly darker
  box(x, y0, z, w, h, d, k, ry = 0) {
    const cs = Math.cos(ry), sn = Math.sin(ry), P = (lx, y, lz) => [x + lx * cs + lz * sn, y, z - lx * sn + lz * cs];
    const hw = w / 2, hd = d / 2, y1 = y0 + h, cy = y0 + h / 2;
    const v = [P(-hw, y0, -hd), P(hw, y0, -hd), P(hw, y0, hd), P(-hw, y0, hd), P(-hw, y1, -hd), P(hw, y1, -hd), P(hw, y1, hd), P(-hw, y1, hd)];
    const face = (i0, i1, i2, i3, f) => {
      const a = v[i0], b = v[i1], c = v[i2];
      this.quad(a, b, c, v[i3], f === 1 ? k : TMP.copy(k).multiplyScalar(f), [(a[0] + c[0]) / 2 - x, (a[1] + c[1]) / 2 - cy, (a[2] + c[2]) / 2 - z]);
    };
    face(4, 5, 6, 7, 1); face(0, 1, 5, 4, 0.9); face(1, 2, 6, 5, 0.86); face(2, 3, 7, 6, 0.9); face(3, 0, 4, 7, 0.86);
  }
  cyl(x, y0, z, r0, r1, h, seg, k) {
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const p = (a, r, y) => [x + Math.sin(a) * r, y, z + Math.cos(a) * r];
      this.quad(p(a0, r0, y0), p(a1, r0, y0), p(a1, r1, y0 + h), p(a0, r1, y0 + h), k, [Math.sin((a0 + a1) / 2), 0, Math.cos((a0 + a1) / 2)]);
      this.tri([x, y0 + h, z], p(a0, r1, y0 + h), p(a1, r1, y0 + h), k, [0, 1, 0]);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

export class SneakView {
  constructor(game) { this.game = game; this.scene = null; }

  static warmup(game) {
    const M = materials(), LM = makeMaterials(), s = new THREE.Scene(), g = new THREE.BoxGeometry(1, 1, 1);
    lightRig(s);
    const kind = new THREE.BoxGeometry(1, 1, 1); kind.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(kind.attributes.position.count), 1));
    const gm = new THREE.Mesh(kind, M.ground); gm.receiveShadow = true; s.add(gm);
    for (const m of [M.roof, M.house, M.veg, M.water, M.glow, M.pool, M.halo, M.cone, M.stone, LM.ring, LM.flag]) { const o = new THREE.Mesh(g, m); o.castShadow = o.receiveShadow = true; s.add(o); }
    for (const m of [M.house, M.veg, M.glow, M.pool, M.halo, LM.ring]) { const im = new THREE.InstancedMesh(g, m, 1); im.setColorAt(0, new THREE.Color(1, 1, 1)); im.castShadow = im.receiveShadow = true; s.add(im); }
    const cam = new THREE.PerspectiveCamera(40, 1, 1, 100), r = game.renderer, sh = r.shadowMap.enabled;
    r.shadowMap.enabled = true;
    try { r.compile(s, cam); } catch (e) { console.warn('warmup sneak', e); }
    r.shadowMap.enabled = sh;
    g.dispose(); kind.dispose();
    s.traverse(o => { if (o.isInstancedMesh) o.dispose(); if (o.isLight) o.dispose?.(); });
  }

  build(sim, { coat = '#2d4c8f', nation = 'spanish', seed = 1 } = {}) {
    const M = materials(), LM = makeMaterials(), m = sim.map, S = this.scene = new THREE.Scene(), r = mulberry32(seed), cell = m.cell;
    this.sim = sim; this.disposables = [];
    const keep = o => { this.disposables.push(o); return o; };
    const MW = m.W * cell, MH = m.H * cell;
    this.points = lightRig(S, MW, MH);
    this._buildGround(M, m, keep, MW, MH);
    // ---- static town: houses, stone, props (one mesh), roofs (one mesh), lit windows and flames (one mesh) ----
    const B = new Builder(), R = new Builder(true), G = new Builder();
    this._houses(B, R, G, m, r);
    this._stone(B, m);
    this._props(B, m, r);
    const lampDecor = this._lamps(B, G, m);
    for (const [b, mat, cast] of [[B, M.house, true], [R, M.roof, true], [G, M.glow, false]]) {
      const o = new THREE.Mesh(keep(b.geometry()), mat); o.castShadow = cast; o.receiveShadow = true; S.add(o);
    }
    this._trees(M, m, keep, r);
    // ---- light pools and halos: static lanterns first, then the guards' torches ----
    const nL = lampDecor.length;
    this.pools = new THREE.InstancedMesh(keep(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), M.pool, nL + MAXG);
    this.halos = new THREE.InstancedMesh(keep(new THREE.PlaneGeometry(1, 1).rotateY(Math.PI).rotateX(1.12)), M.halo, nL + MAXG);
    const d = new THREE.Object3D(), c = new THREE.Color();
    lampDecor.forEach((l, i) => {
      d.position.set(l.x, 0.05, l.z); d.scale.set(l.r * 2, 1, l.r * 2); d.updateMatrix(); this.pools.setMatrixAt(i, d.matrix); this.pools.setColorAt(i, c.copy(LAMP).multiplyScalar(0.55));
      d.position.set(l.hx, l.y, l.hz); d.scale.setScalar(3.2); d.updateMatrix(); this.halos.setMatrixAt(i, d.matrix); this.halos.setColorAt(i, c.copy(LAMP).multiplyScalar(0.8));
    });
    this.nLamps = nL; this.lampDecor = lampDecor;
    for (const o of [this.pools, this.halos]) { o.frustumCulled = false; o.renderOrder = 3; S.add(o); }
    // ---- prison grate, governor's flag ----
    const gate = m.gate, GB = new Builder();
    for (let q = 0; q < 6; q++) GB.box(-2 + q * 0.8, 0, 0, 0.16, 4, 0.16, col('#2a2622'));
    GB.box(0, 3.8, 0, cell, 0.25, 0.22, col('#2a2622'));
    this.gateMesh = new THREE.Mesh(keep(GB.geometry()), M.house);
    this.gateMesh.position.set(gate.x, 0, gate.z); this.gateMesh.visible = !gate.open; this.gateMesh.castShadow = true; S.add(this.gateMesh);
    const gov = m.houses.find(h => h.role === 'governor');
    if (gov) {
      const x = (Math.floor((gov.i0 + gov.i1) / 2) + 0.5) * cell, z = (gov.j0 + 0.5) * cell;
      const fl = this.flag = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.6, 1.7, 6, 2)), keep(LM.flag.clone()));
      fl.material.color.set(coat); fl.position.set(x + 1.3, gov.h + gov.roof + 4.2, z); S.add(fl);
    }
    // ---- captain, guards (articulated figures), the torches in the guards' raised hands ----
    this.actors = new SneakActors(S, { coat, nation, maxGuards: MAXG });
    const TS = new Builder(); TS.box(0, -0.3, 0, 0.09, 0.9, 0.09, col('#4a3020')); TS.box(0, 0.56, 0, 0.16, 0.14, 0.16, col('#2a2420'));
    this.torchSticks = new THREE.InstancedMesh(keep(TS.geometry()), M.house, MAXG);
    const TF = new Builder(); TF.cyl(0, 0, 0, 0.14, 0.02, 0.5, 6, col('#ffb347')); TF.cyl(0, 0.02, 0, 0.08, 0.01, 0.34, 5, col('#fff1b0'));
    this.torchFlames = new THREE.InstancedMesh(keep(TF.geometry()), M.glow, MAXG);
    for (const o of [this.torchSticks, this.torchFlames]) { o.frustumCulled = false; o.count = 0; S.add(o); }
    this.torchSticks.castShadow = true;
    // rings: objectives (gold, pulsing), the grate, hiding spots nearby, noise of a stone; the captain (no depth test)
    this.rings = new THREE.InstancedMesh(keep(new THREE.RingGeometry(0.82, 1, 36).rotateX(-Math.PI / 2)), LM.ring, MAXRING); this.rings.frustumCulled = false; this.rings.setColorAt(0, new THREE.Color()); S.add(this.rings);
    const pr = this.capRing = new THREE.Mesh(keep(new THREE.RingGeometry(0.7, 0.95, 32).rotateX(-Math.PI / 2)), keep(LM.ring.clone()));
    pr.material.depthTest = false; pr.material.color.set(0xffe9a0); pr.renderOrder = 5; S.add(pr);
    // vision cones: a single dynamic mesh (fan clipped by the walls), coloured by wariness
    const cg = this.coneGeo = keep(new THREE.BufferGeometry());
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXG * RAYS * 9), 3));
    cg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAXG * RAYS * 9), 3));
    this.cones = new THREE.Mesh(cg, M.cone); this.cones.frustumCulled = false; this.cones.renderOrder = 2; S.add(this.cones);
    this.stoneMesh = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(0.22, 0)), M.stone); this.stoneMesh.visible = false; S.add(this.stoneMesh);
    this.flights = []; this.pings = [];
    this.camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 2, 900);
    this.cam = { x: sim.player.x, z: sim.player.z, dist: 78 };
    this._t = 0;
    return this;
  }

  // ground: cobbled streets, plank quay, grassy yards and hills, dark sea floor; a little darker in moon shadow
  _buildGround(M, m, keep, MW, MH) {
    const cell = m.cell, PAD = 14, SUB = 2;
    const geo = keep(new THREE.PlaneGeometry((m.W + PAD * 2) * cell, (m.H + PAD * 2) * cell, (m.W + PAD * 2) * SUB, (m.H + PAD * 2) * SUB));
    geo.rotateX(-Math.PI / 2); geo.translate(MW / 2, 0, MH / 2); geo.deleteAttribute('uv');
    const pos = geo.attributes.position, colA = new Float32Array(pos.count * 3), kind = new Float32Array(pos.count), c = new THREE.Color();
    const PAL = { [C.STREET]: '#8a8072', [C.HOUSE]: '#6e665a', [C.WATER]: '#1a2a2c', [C.QUAY]: '#86664a', [C.YARD]: '#5d7a40', [C.GATE]: '#8a8072', [C.CRATE]: '#8a8072' };
    const KIND = { [C.STREET]: 1, [C.GATE]: 1, [C.CRATE]: 1, [C.QUAY]: 2 };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), inside = x >= 0 && z >= 0 && x <= MW && z <= MH;
      const k = Math.max(0, Math.min(m.W - 1, Math.floor(x / cell))) + Math.max(0, Math.min(m.H - 1, Math.floor(z / cell))) * m.W;
      const t = inside ? m.type[k] : z < 3 * cell ? C.WATER : C.YARD, hill = !inside && t === C.YARD;
      let y = t === C.WATER ? -2.2 : 0;
      if (!inside && z >= 3 * cell) y = 2 + Math.min(10, Math.max(-x, x - MW, z - MH, 0) * 0.08);
      pos.setY(i, y);
      c.set(hill ? '#3d5230' : PAL[t]);
      const n = Math.sin(x * 0.9) * Math.sin(z * 0.9) * 0.5 + Math.sin(x * 0.13 + z * 0.07) * 0.5;
      c.offsetHSL(n * 0.012, n * 0.03, n * 0.035);
      if (inside && m.shade[k]) c.multiplyScalar(0.8);
      colA[i * 3] = c.r; colA[i * 3 + 1] = c.g; colA[i * 3 + 2] = c.b;
      kind[i] = inside ? KIND[t] || 0 : 0;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colA, 3)); geo.setAttribute('aKind', new THREE.BufferAttribute(kind, 1)); geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, M.ground); ground.receiveShadow = true; this.scene.add(ground);
    const wg = keep(new THREE.PlaneGeometry(MW + 400, 260)); wg.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(wg, M.water); water.position.set(MW / 2, -0.7, 3 * cell - 130); water.receiveShadow = true; this.scene.add(water);
  }

  // houses: wall body, gable roof with overhang and ridge, shuttered windows (some glowing), doors on the street
  _houses(B, R, G, m, r) {
    const cell = m.cell, open = (i, j) => i >= 0 && j >= 0 && i < m.W && j < m.H && m.type[j * m.W + i] !== C.HOUSE;
    for (const hs of m.houses) {
      if (hs.role === 'prison') continue;   // stone walls (_stone)
      const ins = 0.12, x0 = hs.i0 * cell + ins, x1 = hs.i1 * cell - ins, z0 = hs.j0 * cell + ins, z1 = hs.j1 * cell - ins, h = hs.h;
      const wall = col(hs.role === 'governor' ? '#efe8d8' : hs.role === 'tavern' ? '#d39a52' : WALLS[hs.wall]).offsetHSL((r() - 0.5) * 0.02, 0, (r() - 0.5) * 0.06);
      B.box((x0 + x1) / 2, 0, (z0 + z1) / 2, x1 - x0, h, z1 - z0, wall);
      B.box((x0 + x1) / 2, 0, (z0 + z1) / 2, x1 - x0 + 0.1, 0.55, z1 - z0 + 0.1, wall.clone().multiplyScalar(0.62));   // plinth
      // roof: ridge along the long axis, overhang o; uv in metres (u along the ridge, v up the slope)
      const o = 0.5, rise = hs.roof, rc = col(hs.role === 'governor' ? '#5d6f86' : ROOFS[(hs.id * 7 + hs.wall) % ROOFS.length]).offsetHSL(0, 0, (r() - 0.5) * 0.06);
      const ax = hs.axis === 'x', a0 = (ax ? x0 : z0) - o, a1 = (ax ? x1 : z1) + o, b0 = (ax ? z0 : x0) - o, b1 = (ax ? z1 : x1) + o, bm = (b0 + b1) / 2;
      const P = (a, y, b) => ax ? [a, y, b] : [b, y, a];
      const ratio = rise / ((b1 - b0) / 2 - o), ye = h - o * ratio, slope = Math.hypot(bm - b0, h + rise - ye);
      // big buildings and some houses: hipped roof; the others: gable roof with its two gable walls
      const hip = hs.role || (b1 - b0 > 10 && r() < 0.7) || r() < 0.25, inset = hip ? Math.min((b1 - b0) / 2, (a1 - a0) / 2) : 0, r0 = a0 + inset, r1 = a1 - inset;
      for (const [be, sgn] of [[b0, -1], [b1, 1]]) {
        R.quad(P(a0, ye, be), P(a1, ye, be), P(r1, h + rise, bm), P(r0, h + rise, bm), rc, ax ? [0, 1, sgn] : [sgn, 1, 0],
          [[0, 0], [a1 - a0, 0], [r1 - a0, slope], [r0 - a0, slope]]);
      }
      const g0 = ax ? x0 : z0, g1 = ax ? x1 : z1, w0 = ax ? z0 : x0, w1 = ax ? z1 : x1;
      if (hip) {
        for (const [ae, re, sgn] of [[a0, r0, -1], [a1, r1, 1]]) R.tri(P(ae, ye, b0), P(ae, ye, b1), P(re, h + rise, bm), rc, ax ? [sgn, 1, 0] : [0, 1, sgn], [[0, 0], [b1 - b0, 0], [(b1 - b0) / 2, slope]]);
      } else for (const [ga, sgn] of [[g0, -1], [g1, 1]]) B.tri(P(ga, h, w0), P(ga, h, w1), P(ga, h + rise * 0.98, bm), wall, ax ? [sgn, 0, 0] : [0, 0, sgn]);
      if (r1 > r0 + 0.5) B.box(ax ? (r0 + r1) / 2 : bm, h + rise - 0.12, ax ? bm : (r0 + r1) / 2, ax ? r1 - r0 : 0.42, 0.3, ax ? 0.42 : r1 - r0, rc.clone().multiplyScalar(0.7));   // ridge tiles
      if (r() < 0.45) { const t = 0.2 + r() * 0.6, cx = ax ? x0 + (x1 - x0) * t : bm + 1, cz = ax ? bm + 1 : z0 + (z1 - z0) * t; B.box(cx, h + rise * 0.5, cz, 0.8, rise * 0.6 + 1.2, 0.8, col('#8a7a6a')); }
      // facades: per 5 m segment facing an open cell, windows on each storey, one door on the ground floor
      const storeys = Math.max(1, Math.round((h - 2.4) / 2.3)), shut = col(SHUTTERS[hs.shutter]), sill = wall.clone().multiplyScalar(0.8);
      let doorDone = false;
      for (const [sx, sz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const along = sx === 0, n0 = along ? hs.i0 : hs.j0, n1 = along ? hs.i1 : hs.j1;
        for (let q = n0; q < n1; q++) {
          const ci = along ? q : sx < 0 ? hs.i0 - 1 : hs.i1, cj = along ? (sz < 0 ? hs.j0 - 1 : hs.j1) : q;
          if (!open(ci, cj)) continue;
          const fx = along ? (q + 0.5) * cell : sx < 0 ? x0 : x1, fz = along ? (sz < 0 ? z0 : z1) : (q + 0.5) * cell;
          const off = (k, out = 0.05) => along ? [fx + k, fz + sz * out] : [fx + sx * out, fz + k];
          const dims = (w, dd) => along ? [w, dd] : [dd, w];
          for (let s = 0; s < storeys; s++) for (const k of [-1.25, 1.25]) {
            const y = 1.1 + s * 2.3;
            if (s === 0 && !doorDone && k < 0 && (sz < 0 || r() < 0.3)) {   // door in its frame
              doorDone = true;
              const [dx, dz] = off(0), [fw, fd] = dims(1.5, 0.2), [iw, id] = dims(1.15, 0.2), [ix, iz] = off(0, 0.13);
              B.box(dx, 0, dz, fw, 2.5, fd, col('#3a2a1c')); B.box(ix, 0, iz, iw, 2.2, id, col('#5a3a22'));
              continue;
            }
            const [wx, wz] = off(k), closed = r() < 0.22, lit = !closed && r() < 0.38;
            if (closed) { const [cw, cd] = dims(1.0, 0.12); B.box(wx, y, wz, cw, 1.3, cd, shut); continue; }
            const [pw, pd] = dims(0.82, 0.1);
            if (lit) G.box(wx, y + 0.05, wz, pw, 1.15, pd, col(WARM).offsetHSL((r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.1)); else B.box(wx, y + 0.05, wz, pw, 1.15, pd, col('#1a2230'));
            const [sw, sd] = dims(0.5, 0.12);
            for (const side of [-1, 1]) { const [px, pz] = off(k + side * 0.72, 0.09); B.box(px, y, pz, sw, 1.3, sd, shut); }
            const [lw, ld] = dims(1.0, 0.22), [lx, lz] = off(k, 0.12);
            B.box(lx, y - 0.12, lz, lw, 0.12, ld, sill);
          }
        }
      }
      // the tavern's sign, the palace's portico
      if (hs.role === 'tavern') { const x = (Math.floor((hs.i0 + hs.i1) / 2) + 0.5) * cell + 1.6; B.box(x, 3.6, z0 - 0.7, 0.12, 0.12, 1.4, col('#3a2a1a')); B.box(x, 2.6, z0 - 1.3, 1.3, 0.9, 0.1, col('#b8862c')); }
      if (hs.role === 'governor') {
        for (let q = 0; q < 6; q++) B.cyl(x0 + (x1 - x0) * (0.15 + q * 0.14), 0, z0 - 1.6, 0.32, 0.28, h - 0.6, 8, col('#f2ecdf'));
        B.box((x0 + x1) / 2, h - 0.8, z0 - 1.6, (x1 - x0) * 0.82, 0.8, 1.2, col('#ece4d2'));
      }
    }
  }

  // rampart and prison: stone walls with merlons; the quay edge
  _stone(B, m) {
    const cell = m.cell, pri = m.houses.find(h => h.role === 'prison'), sc = col('#8f8676'), dark = col('#6f6858');
    for (let k = 0; k < m.W * m.H; k++) {
      if (m.type[k] !== C.HOUSE) continue;
      const i = k % m.W, j = k / m.W | 0, isPri = pri && i >= pri.i0 && i < pri.i1 && j >= pri.j0 && j < pri.j1, ring = m.blockId[k] < 0 && !isPri;
      if (!isPri && !ring) continue;
      const h = m.hgt[k], x = (i + 0.5) * cell, z = (j + 0.5) * cell;
      B.box(x, 0, z, cell, h, cell, (isPri ? dark : sc).clone().offsetHSL(0, 0, ((i * 7 + j * 3) % 5 - 2) * 0.012));
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + dx, nj = j + dz, outside = ni < 0 || nj < 0 || ni >= m.W || nj >= m.H;
        if (!outside && m.type[nj * m.W + ni] === C.HOUSE) continue;
        for (let q = 0; q < 3; q++) {   // merlons along the open side
          const t = (q - 1) * cell / 3;
          B.box(x + (dx ? dx * cell * 0.42 : t), h, z + (dz ? dz * cell * 0.42 : t), dx ? 0.7 : 1.0, 0.9, dz ? 0.7 : 1.0, sc);
        }
      }
    }
    // quay: stone edge, a low parapet along the water broken by the landing steps, bollards
    const zq = 3 * cell, steps = m.goals.filter(g => g.id === 'quay').concat(m.kind === 'infiltrate' ? [m.start] : []).map(g => g.x);
    B.box(m.W * cell / 2, -2.2, zq - 0.4, m.W * cell, 2.35, 0.8, col('#6f6a5e'));
    for (let x = 0; x < m.W * cell; x += 8) {
      if (steps.some(sx => Math.abs(sx - (x + 4)) < 7)) continue;
      B.box(x + 4, 0, zq + 0.25, 7.6, 0.7, 0.5, col('#8a8274').offsetHSL(0, 0, ((x / 8) % 3 - 1) * 0.02)); B.box(x + 4, 0.7, zq + 0.25, 7.8, 0.12, 0.62, col('#9a9282'));
    }
    for (let x = 6; x < m.W * cell; x += 11) if (!steps.some(sx => Math.abs(sx - x) < 3)) B.cyl(x, 0, zq + 1.1, 0.28, 0.22, 0.8, 6, col('#2e2a26'));
  }

  // crates and barrels, hiding spots (doorways, barrels, haystacks), boats at the quay
  _props(B, m, r) {
    const cell = m.cell, wood = col('#7a5a34'), wood2 = col('#8f6c3e'), hoop = col('#3a2c20');
    const barrel = (x, z) => { B.cyl(x, 0, z, 0.5, 0.5, 1.15, 8, wood); B.cyl(x, 0.25, z, 0.53, 0.53, 0.08, 8, hoop); B.cyl(x, 0.85, z, 0.53, 0.53, 0.08, 8, hoop); };
    for (const k of m.crates) {
      const x = (k % m.W + 0.5) * cell, z = ((k / m.W | 0) + 0.5) * cell, ry = r() * 6;
      B.box(x - 0.9, 0, z - 0.6, 2.2, 1.6, 2.2, wood2, ry); B.box(x + 1.1, 0, z + 0.9, 1.6, 1.4, 1.6, wood, ry + 0.4); B.box(x - 0.6, 1.6, z - 0.5, 1.4, 1.2, 1.4, wood2, ry + 0.7);
      barrel(x + 1.3, z - 1.3); barrel(x - 1.6, z + 1.4);
    }
    for (const h of m.hides) {
      const tx = -h.nz, tz = h.nx;   // along the wall
      if (h.kind === 'barrels') {
        barrel(h.x - h.nx * 1.0 + tx * 0.6, h.z - h.nz * 1.0 + tz * 0.6); barrel(h.x - h.nx * 0.9 - tx * 0.7, h.z - h.nz * 0.9 - tz * 0.7); barrel(h.x + tx * 1.25, h.z + tz * 1.25);
        B.box(h.x - tx * 1.4, 0, h.z - tz * 1.4, 1.1, 0.9, 1.1, wood2, 0.3);
      } else if (h.kind === 'hay') { B.cyl(h.x + 0.4, 0, h.z + 0.3, 1.7, 1.3, 1.1, 9, col('#c9a54a')); B.cyl(h.x + 0.4, 1.1, h.z + 0.3, 1.3, 0.25, 0.9, 9, col('#d6b45a')); }
      else {   // deep doorway: dark recess, stone jambs, a small awning
        const wx = h.x + h.nx * 0.95, wz = h.z + h.nz * 0.95, al = h.nz !== 0;
        B.box(wx, 0, wz, al ? 2.0 : 0.3, 2.9, al ? 0.3 : 2.0, col('#14110e'));
        for (const sd of [-1, 1]) B.box(wx + tx * sd * 1.15, 0, wz + tz * sd * 1.15, 0.35, 3.1, 0.35, col('#a39a88'));
        B.box(wx - h.nx * 0.5, 3.1, wz - h.nz * 0.5, al ? 2.8 : 1.1, 0.14, al ? 1.1 : 2.8, col('#6b4a30'));
      }
    }
    // boats moored off the quay; the longboat of the escape / of the landing
    const boat = (x, z, len, c0, mast) => {
      B.box(x, -0.9, z, len, 0.9, len * 0.32, c0); B.box(x, -0.05, z, len * 0.92, 0.12, len * 0.3, c0.clone().multiplyScalar(0.7));
      B.box(x + len * 0.5, -0.9, z, len * 0.18, 0.75, len * 0.18, c0, Math.PI / 4);
      if (mast) { B.cyl(x, 0, z, 0.12, 0.09, len * 0.9, 5, col('#4a3424')); B.box(x - len * 0.05, len * 0.25, z, len * 0.55, len * 0.5, 0.06, col('#cfc4a8')); }
    };
    const used = [];
    for (const g of m.goals.filter(q => q.id === 'quay').concat(m.kind === 'infiltrate' ? [m.start] : [])) { boat(g.x, 3 * cell - 2.6, 6, col('#5a3f2a'), false); used.push(g.x); }
    for (let q = 0; q < 5; q++) {
      const x = 10 + r() * (m.W * cell - 20); if (used.some(u => Math.abs(u - x) < 16)) continue; used.push(x);
      boat(x, 3 * cell - 4 - r() * 3, 9 + r() * 5, col(['#4a5a6a', '#6a4a32', '#5a5048'][q % 3]), true);
    }
  }

  // lanterns on wall brackets or posts (flames in the glow mesh); returns where to put their pools and halos
  _lamps(B, G, m) {
    const iron = col('#1e1b18'), out = [];
    const house = (x, z) => m.type[Math.floor(z / m.cell) * m.W + Math.floor(x / m.cell)] === C.HOUSE;
    for (const l of m.lamps) {
      let arm = null;
      if (l.wall) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let s = 0.5; s < 3; s += 0.5) if (house(l.x + dx * s, l.z + dz * s)) { if (!arm || s < arm.s) arm = { dx, dz, s }; break; }
      if (arm) { const wx = l.x + arm.dx * arm.s, wz = l.z + arm.dz * arm.s; B.box((wx + l.x) / 2, l.y + 0.35, (wz + l.z) / 2, arm.dx ? arm.s : 0.08, 0.08, arm.dz ? arm.s : 0.08, iron); }
      else B.cyl(l.x, 0, l.z, 0.12, 0.08, l.y, 5, iron);
      B.box(l.x, l.y - 0.3, l.z, 0.42, 0.08, 0.42, iron); B.box(l.x, l.y + 0.3, l.z, 0.46, 0.1, 0.46, iron);
      G.box(l.x, l.y - 0.25, l.z, 0.3, 0.5, 0.3, col('#ffd27a'));
      out.push({ x: l.x, z: l.z, r: l.r, y: l.y, hx: l.x, hz: l.z });
    }
    return out;
  }

  // palms and round trees in the yards
  _trees(M, m, keep, r) {
    const T = new Builder(), trunk = col('#5a4330');
    for (const t of m.trees) {
      const s = t.s * 1.2;
      if (t.palm) {
        let x = t.x, z = t.z, y = 0; const lean = r() * 6;
        for (let q = 0; q < 5; q++) { const nx = x + Math.sin(lean) * 0.35 * s, nz = z + Math.cos(lean) * 0.35 * s; T.cyl(x, y, z, 0.3 * s, 0.24 * s, 1.5 * s, 6, trunk); x = nx; z = nz; y += 1.45 * s; }
        for (let q = 0; q < 7; q++) {
          const a = q / 7 * Math.PI * 2 + lean, L = 3.4 * s, ex = x + Math.sin(a) * L, ez = z + Math.cos(a) * L, px = Math.cos(a) * 0.7 * s, pz = -Math.sin(a) * 0.7 * s;
          const mid = [x + Math.sin(a) * L * 0.5, y + 0.5 * s, z + Math.cos(a) * L * 0.5], c0 = col(q % 2 ? '#3f6e34' : '#4d7f3c');
          T.tri([x, y + 0.3, z], [ex + px, y - 1.4 * s, ez + pz], mid, c0, [0, 1, 0]);
          T.tri([x, y + 0.3, z], mid, [ex - px, y - 1.4 * s, ez - pz], c0, [0, 1, 0]);
        }
      } else {
        T.cyl(t.x, 0, t.z, 0.4 * s, 0.3 * s, 3 * s, 6, trunk);
        const g = new THREE.IcosahedronGeometry(3.2 * s, 0), p = g.attributes.position;
        for (let i = 0; i < p.count; i += 3) {
          const tri = [0, 1, 2].map(k => [p.getX(i + k) + t.x, p.getY(i + k) * 0.8 + 5.2 * s, p.getZ(i + k) + t.z]);
          T.tri(tri[0], tri[1], tri[2], col(i % 2 ? '#3d6430' : '#4a7538'), [tri[0][0] - t.x, tri[0][1] - 5.2 * s, tri[0][2] - t.z]);
        }
        g.dispose();
      }
    }
    if (!T.p.length) return;
    const o = new THREE.Mesh(keep(T.geometry()), M.veg); o.castShadow = true; o.receiveShadow = true; this.scene.add(o);
  }

  throwStone(e) { this.actors.throwStone(); const p = this.sim.player; this.flights.push({ x0: p.x, z0: p.z, x1: e.x, z1: e.z, t: 0, dur: e.dur }); }
  ping(x, z) { this.pings.push({ x, z, t: 0 }); }

  update(sim, dt) {
    this._t += dt;
    const d = new THREE.Object3D(), c = new THREE.Color(), p = sim.player, m = sim.map, T = this._t;
    // captain and guards (animated figures); the torches follow the bearers' hands
    this.camera.updateMatrixWorld();
    const t0 = performance.now();
    const hands = this.actors.update(sim, dt, this.camera);
    this.animMs = (this.animMs || 0) * 0.95 + (performance.now() - t0) * 0.05;
    this.capRing.position.set(p.x, 0.12, p.z); this.capRing.scale.setScalar(1.3 + 0.12 * Math.sin(T * 4));
    this.capRing.material.color.set(p.hidden ? 0x8fb4ff : 0xffe9a0); this.capRing.material.opacity = p.hidden ? 0.5 : 0.85;
    // torches, cones
    const pa = this.coneGeo.attributes.position.array, ca = this.coneGeo.attributes.color.array, V = SNEAK.view;
    let n = 0, v = 0, nt = 0;
    const torches = [];
    hands.forEach((h, i) => {   // the stick in the fist, leaning a little forward; the flame on top
      d.position.set(h.x, h.y, h.z); d.rotation.set(0.15, h.heading, 0, 'YXZ'); d.scale.setScalar(1.3); d.updateMatrix(); this.torchSticks.setMatrixAt(nt, d.matrix);
      const fl = 1 + 0.18 * Math.sin(T * 17 + i * 3) + 0.1 * Math.sin(T * 29 + i);
      const fx = h.x + Math.sin(h.heading) * 0.14, fz = h.z + Math.cos(h.heading) * 0.14, fy = h.y + 0.9;
      d.position.set(fx, fy, fz); d.rotation.set(0, T * 2, 0); d.scale.set(1.3, 1.3 * fl, 1.3); d.updateMatrix(); this.torchFlames.setMatrixAt(nt, d.matrix);
      torches.push({ x: fx, z: fz, y: fy + 0.2, fl }); nt++;
    });
    for (const g of sim.guards) {
      if (n >= MAXG) break;
      n++;
      if (g.down) continue;
      const range = V.range * SNEAK.light.moon * (sim.alarm || g.sus >= SNEAK.levels[2] ? V.alarmMul : 1), k = Math.min(1, g.sus / 100);
      c.setRGB(1, 0.9 - k * 0.7, 0.55 - k * 0.45);
      if (sim.alarm) c.setRGB(1, 0.15, 0.1);
      let px = g.x, pz = g.z, first = true;
      for (let q = 0; q <= RAYS; q++) {
        const a = g.heading - V.half + q / RAYS * V.half * 2, rr = rayFree(m, g.x, g.z, a, range);
        const x = g.x + Math.sin(a) * rr, z = g.z + Math.cos(a) * rr;
        if (!first) for (const [X, Z] of [[g.x, g.z], [px, pz], [x, z]]) { pa[v] = X; pa[v + 1] = 0.25; pa[v + 2] = Z; ca[v] = c.r; ca[v + 1] = c.g; ca[v + 2] = c.b; v += 3; }
        first = false; px = x; pz = z;
      }
    }
    this.torchSticks.count = this.torchFlames.count = nt; this.torchSticks.instanceMatrix.needsUpdate = this.torchFlames.instanceMatrix.needsUpdate = true;
    this.coneGeo.setDrawRange(0, v / 3); this.coneGeo.attributes.position.needsUpdate = true; this.coneGeo.attributes.color.needsUpdate = true;
    this.cones.material.opacity = sim.alarm ? 0.22 + 0.1 * Math.sin(T * 9) : 0.22;
    // torch pools and halos after the lanterns'
    const nl = this.nLamps;
    torches.forEach((t, i) => {
      d.position.set(t.x, 0.06, t.z); d.rotation.set(0, 0, 0); d.scale.set(SNEAK.light.torch * 2 * t.fl, 1, SNEAK.light.torch * 2 * t.fl); d.updateMatrix(); this.pools.setMatrixAt(nl + i, d.matrix); this.pools.setColorAt(nl + i, c.copy(LAMP).multiplyScalar(0.6));
      d.position.set(t.x, t.y, t.z); d.scale.setScalar(2.6 * t.fl); d.updateMatrix(); this.halos.setMatrixAt(nl + i, d.matrix); this.halos.setColorAt(nl + i, c.copy(LAMP).multiplyScalar(0.9));
    });
    for (const o of [this.pools, this.halos]) { o.count = nl + torches.length; o.instanceMatrix.needsUpdate = true; if (o.instanceColor) o.instanceColor.needsUpdate = true; }
    // real point lights on the light sources nearest the captain (lanterns flicker a little)
    const src = this.lampDecor.map(l => ({ x: l.hx, z: l.hz, y: l.y, fl: 1 + 0.05 * Math.sin(T * 7 + l.x), lamp: true })).concat(torches)
      .map(s => ({ s, d: Math.hypot(s.x - p.x, s.z - p.z) })).sort((a, b) => a.d - b.d);
    this.points.forEach((pl, i) => {
      const s = src[i]?.s; if (!s || src[i].d > 45) { pl.intensity = 0; return; }
      pl.position.set(s.x, s.y + 0.4, s.z); pl.intensity = (s.lamp ? 46 : 38) * s.fl;
    });
    // objectives, the grate, hiding spots nearby, stone noise
    let ri = 0;
    const ring = (x, z, s, color, y = 0.2) => { if (ri >= MAXRING) return; d.position.set(x, y, z); d.rotation.set(0, 0, 0); d.scale.setScalar(s); d.updateMatrix(); this.rings.setMatrixAt(ri, d.matrix); this.rings.setColorAt(ri, c.set(color)); ri++; };
    m.goals.forEach((g, i) => ring(g.x, g.z, SNEAK.goalR * (1 + 0.1 * Math.sin(T * 3 + i)), sim.alarm ? 0x9a4a3a : 0xf0c050));
    if (!m.gate.open) ring(m.gate.x, m.gate.z + m.cell * 0.5, 2.2, 0x9ec4ff);
    if (!p.hidden) for (const h of m.hides) { const dd = Math.hypot(h.x - p.x, h.z - p.z); if (dd < 14) ring(h.x, h.z, 1.1, dd < SNEAK.tools.hideR ? 0x9ec4ff : 0x3a4c66); }
    this.pings = this.pings.filter(q => (q.t += dt) < 1.1);
    for (const q of this.pings) ring(q.x, q.z, 1 + q.t * (SNEAK.tools.stoneNoise - 1) / 1.1, c.setRGB(0.9 - q.t * 0.7, 0.85 - q.t * 0.7, 0.7 - q.t * 0.6).getHex(), 0.3);
    this.rings.count = ri; this.rings.instanceMatrix.needsUpdate = true; if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    this.gateMesh.visible = !m.gate.open;
    // stone in flight
    this.flights = this.flights.filter(f => (f.t += dt) < f.dur);
    const f = this.flights[0]; this.stoneMesh.visible = !!f;
    if (f) { const u = f.t / f.dur; this.stoneMesh.position.set(f.x0 + (f.x1 - f.x0) * u, 1.6 + Math.sin(u * Math.PI) * (2 + f.dur * 6) - u * 1.4, f.z0 + (f.z1 - f.z0) * u); }
    if (this.flag) { const fp = this.flag.geometry.attributes.position; for (let i = 0; i < fp.count; i++) { const x = fp.getX(i) + 1.3; fp.setZ(i, Math.sin(T * 4 + x * 1.5) * 0.2 * x); } fp.needsUpdate = true; }
    // camera: follows the captain (slight lag)
    const cm = this.cam, k = 1 - Math.exp(-dt * 4);
    cm.x += (p.x - cm.x) * k; cm.z += (p.z - cm.z) * k;
  }

  render() {
    const r = this.game.renderer, c = this.cam, cam = this.camera;
    const W = innerWidth, H = innerHeight; if (cam.aspect !== W / H) { cam.aspect = W / H; cam.updateProjectionMatrix(); }
    const pitch = c.pitch ?? 1.12, tz = c.z + 6;
    cam.position.set(c.x, Math.sin(pitch) * c.dist, tz - Math.cos(pitch) * c.dist);
    cam.lookAt(c.x, 0, tz);
    const prevExp = r.toneMappingExposure, sh = r.shadowMap.enabled;
    r.toneMappingExposure = 1.0; r.shadowMap.enabled = true; r.shadowMap.needsUpdate = true;
    const fill = setFigureFill(0.32, '#ffdcb8');   // the figures' own soft lamp: faces and coats read in the night
    r.setRenderTarget(null); r.render(this.scene, cam);
    setFigureFill(1, fill);
    r.toneMappingExposure = prevExp; r.shadowMap.enabled = sh;
  }

  project(x, z, y = 0) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, behind: v.z > 1 };
  }
  pick(cx, cy) {
    const ray = new THREE.Raycaster(), hit = new THREE.Vector3();
    ray.setFromCamera(new THREE.Vector2(cx / innerWidth * 2 - 1, 1 - cy / innerHeight * 2), this.camera);
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit) ? { x: hit.x, z: hit.z } : null;
  }

  dispose() {
    for (const o of this.disposables || []) o.dispose?.();
    this.actors?.dispose(); this.actors = null;
    this.scene?.traverse(o => { if (o.isInstancedMesh) o.dispose?.(); if (o.isLight) o.dispose?.(); });
    this.scene = null;
  }
}
