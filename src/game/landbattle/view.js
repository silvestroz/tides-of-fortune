// Rendering of the land battle: standalone three.js scene (tilted top-down view), terrain painted with vertex
// colours, woods / rocks / houses / men as InstancedMesh (≈ 15 draw calls in all).
//   const v = new LandView(game)  v.build(sim, { coat, nation })  v.update(sim, dt, sel)  v.render()  v.dispose()
//   v.pick(ndcX, ndcY) -> { x, z } on the terrain    v.project(x, z) -> { x, y } screen pixels
// Shared materials created once (makeMaterials) and precompiled by game.warmup() via LandView.warmup(game).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { T, heightAt } from './sim.js';
import { mulberry32 } from '../../core/rng.js';

const MAX_MEN = 520;
let MATS = null;
function makeMaterials() {
  if (MATS) return MATS;
  const std = o => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, ...o });
  MATS = {
    ground: std({ vertexColors: true }),
    water: std({ color: 0x3f8f9a, roughness: 0.35, transparent: true, opacity: 0.82 }),
    veg: std({ vertexColors: true }),
    rock: std({ vertexColors: true, flatShading: true }),
    house: std({ vertexColors: true, flatShading: true }),
    men: menMaterial(std({ vertexColors: true, roughness: 0.8 })),
    ring: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }),
    smoke: new THREE.MeshBasicMaterial({ color: 0xe9e2d2, transparent: true, opacity: 0.5, depthWrite: false }),
    flag: std({ color: 0xffffff, side: THREE.DoubleSide }),
  };
  return MATS;
}

// geometries with vertex colours: each part is tinted a fixed colour; aTint attribute (characters):
// 1 = the part takes the instance colour (the company's coat), 0 = its own colour (belts, hat, skin…).
// By default, a white part is tinted, the others are not.
function painted(geo, col, tint) {
  const c = new THREE.Color(col), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const y = geo.attributes.position.getY(i); const k = 0.82 + 0.18 * Math.min(1, Math.max(0, y / 1.8)); a[i * 3] = c.r * k; a[i * 3 + 1] = c.g * k; a[i * 3 + 2] = c.b * k; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  geo.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n).fill(tint ?? (c.getHex() === 0xffffff ? 1 : 0)), 1));
  return geo.index ? geo.toNonIndexed() : geo;
}
// the instance colour only tints parts with aTint = 1 (without the attribute: nothing is tinted)
function menMaterial(m) {
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aTint;')
      .replace('#include <color_vertex>', THREE.ShaderChunk.color_vertex.replace('vColor.rgb *= instanceColor.rgb;', 'vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, aTint );'));
  };
  m.customProgramCacheKey = () => 'landMen_v2';
  return m;
}
const tr = (g, x, y, z, rx = 0, ry = 0, rz = 0) => { g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); return g; };
// stylised silhouette (≈ 2.4 m, exaggerated to read from above): marching legs, gaiters, skirted coat
// (white = tinted by the company), shoulders, arms carrying the weapon, the musketeers' crossed belts or the
// swordsmen's baldric (not tinted), head, three-cornered hat.
function manGeo(weapon) {
  const P = (g, c, t) => painted(g, c, t);
  const D = '#3b3026', SK = '#d9a982', HAT = '#231d18', BUFF = '#efe6cf';
  const parts = [
    P(tr(new THREE.CylinderGeometry(0.17, 0.13, 0.95, 7), -0.15, 0.5, 0.12, -0.18), D),                 // front leg
    P(tr(new THREE.CylinderGeometry(0.17, 0.13, 0.95, 7), 0.15, 0.5, -0.12, 0.18), D),                  // back leg
    P(tr(new THREE.CylinderGeometry(0.15, 0.15, 0.32, 7), -0.15, 0.26, 0.17, -0.18), BUFF),              // gaiters
    P(tr(new THREE.CylinderGeometry(0.15, 0.15, 0.32, 7), 0.15, 0.26, -0.17, 0.18), BUFF),
    P(tr(new THREE.BoxGeometry(0.22, 0.12, 0.42), -0.15, 0.06, 0.26), '#1c1612'),
    P(tr(new THREE.BoxGeometry(0.22, 0.12, 0.42), 0.15, 0.06, -0.1), '#1c1612'),
    P(tr(new THREE.CylinderGeometry(0.34, 0.5, 0.66, 9), 0, 0.95, 0), '#ffffff'),                        // coat skirts
    P(tr(new THREE.CylinderGeometry(0.4, 0.31, 0.72, 9).scale(1, 1, 0.74), 0, 1.62, 0), '#ffffff'),      // V-shaped torso
    P(tr(new THREE.SphereGeometry(0.21, 8, 6), -0.38, 1.88, 0), '#ffffff'), P(tr(new THREE.SphereGeometry(0.21, 8, 6), 0.38, 1.88, 0), '#ffffff'),   // shoulders
    P(tr(new THREE.CylinderGeometry(0.33, 0.33, 0.1, 9).scale(1, 1, 0.76), 0, 1.28, 0), '#3a2414'),    // belt
    P(tr(new THREE.CylinderGeometry(0.11, 0.13, 0.16, 7), 0, 2.03, 0), SK),                              // neck
    P(tr(new THREE.SphereGeometry(0.25, 9, 7).scale(0.92, 1.08, 1), 0, 2.27, 0.02), SK),                // head
    P(tr(new THREE.CylinderGeometry(0.2, 0.24, 0.16, 8), 0, 2.48, 0), HAT),                             // crown
    P(tr(new THREE.CylinderGeometry(0.36, 0.36, 0.06, 3), 0, 2.42, 0, 0, Math.PI, 0), HAT),            // three-cornered brim (small: seen from above, the coat must dominate)
  ];
  if (weapon === 'musket') {
    for (const s of [-1, 1]) parts.push(P(tr(new THREE.BoxGeometry(0.07, 0.92, 0.04), 0, 1.6, 0.3, 0, 0, s * 0.62), BUFF));   // crossed belts
    parts.push(
      P(tr(new THREE.CylinderGeometry(0.1, 0.09, 0.52, 6), -0.4, 1.66, 0.12, 0.5, 0, -0.25), '#ffffff'),   // right arm
      P(tr(new THREE.CylinderGeometry(0.1, 0.09, 0.52, 6), 0.4, 1.62, 0.16, 0.7, 0, 0.35), '#ffffff'),     // left arm
      P(tr(new THREE.CylinderGeometry(0.085, 0.075, 0.46, 6), -0.24, 1.42, 0.42, 1.25, 0, 0.9), '#ffffff'),
      P(tr(new THREE.CylinderGeometry(0.085, 0.075, 0.46, 6), 0.22, 1.66, 0.44, 1.2, 0, -0.9), '#ffffff'),
      P(tr(new THREE.CylinderGeometry(0.045, 0.06, 2.1, 5), 0.0, 1.7, 0.5, 0, 0, -0.95), '#5a3a22'),      // musket carried across
      P(tr(new THREE.CylinderGeometry(0.026, 0.026, 0.9, 4), 0.62, 2.12, 0.5, 0, 0, -0.95), '#b8bcc0'),   // barrel
    );
  } else {
    parts.push(P(tr(new THREE.BoxGeometry(0.07, 1.0, 0.04), 0, 1.58, 0.29, 0, 0, -0.62), BUFF));          // baldric
    parts.push(
      P(tr(new THREE.CylinderGeometry(0.1, 0.09, 0.52, 6), -0.44, 1.72, 0.14, -0.6, 0, -0.35), '#ffffff'),  // raised sword arm
      P(tr(new THREE.CylinderGeometry(0.085, 0.075, 0.46, 6), -0.56, 2.1, 0.32, -1.1, 0, -0.2), '#ffffff'),
      P(tr(new THREE.CylinderGeometry(0.1, 0.09, 0.52, 6), 0.42, 1.62, 0.04, 0.2, 0, 0.2), '#ffffff'),
      P(tr(new THREE.CylinderGeometry(0.085, 0.075, 0.46, 6), 0.48, 1.2, 0.12, 0.25, 0, 0.1), '#ffffff'),
      P(tr(new THREE.BoxGeometry(0.06, 1.15, 0.13), -0.6, 2.62, 0.7, -0.75, 0, -0.1), '#cfd3d6'),           // lame
      P(tr(new THREE.BoxGeometry(0.28, 0.05, 0.08), -0.58, 2.2, 0.42, -0.75, 0, -0.1), '#c9a24a'),          // sword guard
    );
  }
  return mergeGeometries(parts.map(p => (p.deleteAttribute('uv'), p)));
}
function riderGeo() {
  const H = '#5a3a26', HD = '#3a271a', P = (g, c, t) => painted(g, c, t);
  const parts = [
    P(tr(new THREE.CapsuleGeometry(0.46, 1.5, 4, 9).scale(0.86, 1, 1), 0, 1.55, 0, Math.PI / 2), H),          // horse's body
    P(tr(new THREE.CapsuleGeometry(0.26, 0.75, 3, 7), 0, 2.15, 1.05, -0.75), H),                              // neck
    P(tr(new THREE.CapsuleGeometry(0.2, 0.5, 3, 7), 0, 2.45, 1.48, Math.PI / 2 - 0.35), H),                    // head
    P(tr(new THREE.BoxGeometry(0.1, 0.5, 0.42), 0, 2.38, 0.88, -0.75), HD),                                   // mane
    P(tr(new THREE.CapsuleGeometry(0.12, 0.7, 2, 5), 0, 1.4, -1.15, -0.5), HD),                              // queue
    ...[[-0.26, 0.72, 0.15], [0.26, 0.72, -0.15], [-0.26, -0.72, -0.12], [0.26, -0.72, 0.12]].map(([x, z, a]) =>
      P(tr(new THREE.CylinderGeometry(0.12, 0.08, 1.1, 5), x, 0.55, z, a), HD)),                               // marching legs
    P(tr(new THREE.BoxGeometry(0.95, 0.12, 0.8), 0, 2.02, -0.1), '#8e1b1b', 0),                                // saddle cloth
    P(tr(new THREE.CylinderGeometry(0.3, 0.38, 0.85, 8).scale(1, 1, 0.78), 0, 2.55, -0.1), '#ffffff'),       // rider
    P(tr(new THREE.SphereGeometry(0.15, 7, 5), -0.32, 2.85, -0.1), '#ffffff'), P(tr(new THREE.SphereGeometry(0.15, 7, 5), 0.32, 2.85, -0.1), '#ffffff'),
    P(tr(new THREE.CylinderGeometry(0.12, 0.1, 0.8, 5), -0.3, 2.25, 0.05, 0.3, 0, 0.5), '#3b3026'),             // rider's legs
    P(tr(new THREE.CylinderGeometry(0.12, 0.1, 0.8, 5), 0.3, 2.25, 0.05, 0.3, 0, -0.5), '#3b3026'),
    P(tr(new THREE.SphereGeometry(0.23, 8, 6), 0, 3.15, -0.08), '#d9a982'),
    P(tr(new THREE.CylinderGeometry(0.18, 0.22, 0.14, 8), 0, 3.34, -0.08), '#231d18'),
    P(tr(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 3), 0, 3.29, -0.08, 0, Math.PI, 0), '#231d18'),
    P(tr(new THREE.CylinderGeometry(0.09, 0.08, 0.5, 5), -0.42, 2.95, 0.2, -0.9, 0, -0.3), '#ffffff'),         // sword arm
    P(tr(new THREE.BoxGeometry(0.07, 1.2, 0.15), -0.5, 3.4, 0.62, -0.9, 0, -0.1), '#cfd3d6'),                   // raised sabre
  ];
  return mergeGeometries(parts.map(p => (p.deleteAttribute('uv'), p)));
}

export class LandView {
  constructor(game) { this.game = game; this.scene = null; }

  static warmup(game) {
    // precompiles every program of the battle (a miniature scene with each material) to avoid the hitch
    const M = makeMaterials(), s = new THREE.Scene(), g = new THREE.BoxGeometry(1, 1, 1);
    s.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1), new THREE.DirectionalLight(0xffffff, 1));
    for (const m of Object.values(M)) s.add(new THREE.Mesh(g, m));
    const im = new THREE.InstancedMesh(g, M.men, 1); im.setColorAt(0, new THREE.Color(1, 1, 1)); s.add(im);
    for (const k of ['veg', 'rock', 'house', 'ring', 'smoke']) s.add(new THREE.InstancedMesh(g, M[k], 1));
    s.fog = new THREE.Fog(0xcfd6d0, 300, 1100);
    const cam = new THREE.PerspectiveCamera(40, 1, 1, 100);
    try { game.renderer.compile(s, cam); } catch (e) { console.warn('warmup landbattle', e); }
    g.dispose();
  }

  build(sim, { coat = '#2d4c8f', seed = 1 } = {}) {
    const M = makeMaterials(), m = sim.map, S = this.scene = new THREE.Scene(), r = mulberry32(seed);
    this.sim = sim; this.disposables = [];
    const keep = o => { this.disposables.push(o); return o; };
    S.background = new THREE.Color(0xb9c9cf);
    S.fog = new THREE.Fog(0xc7d0c8, 420, 1150);
    const hemi = new THREE.HemisphereLight(0xf3ead8, 0x4d5a3a, 1.15); S.add(hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xffe2b8, 2.3);
    const cx = m.W * m.cell / 2, cz = m.H * m.cell / 2;
    sun.position.set(cx - 260, 380, cz - 180); sun.target.position.set(cx, 0, cz); S.add(sun, sun.target);
    sun.castShadow = true; const sc = sun.shadow.camera; sc.left = -300; sc.right = 300; sc.top = 260; sc.bottom = -260; sc.far = 1200; sc.updateProjectionMatrix();
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
    // ---- terrain: fine grid, colours painted per cell type + brush noise ----
    const SUB = 3, GW = m.W * SUB, GH = m.H * SUB, PAD = 18;   // border extended off the map (PAD cells of grass/sea)
    const geo = keep(new THREE.PlaneGeometry((m.W + PAD * 2) * m.cell, (m.H + PAD * 2) * m.cell, GW + PAD * 2 * SUB, GH + PAD * 2 * SUB));
    geo.rotateX(-Math.PI / 2); geo.translate(cx, 0, cz);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
    const PAL = { [T.OPEN]: '#7f9a4c', [T.WOOD]: '#4c6a33', [T.HILL]: '#a39a5e', [T.ROCK]: '#8a8174', [T.TOWN]: '#b59c74', [T.WATER]: '#c9b98a' };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), inside = x >= 0 && z >= 0 && x <= m.W * m.cell && z <= m.H * m.cell;
      const xc = Math.max(1, Math.min(m.W * m.cell - 1, x)), zc = Math.max(1, Math.min(m.H * m.cell - 1, z));
      let y = heightAt(m, xc, zc), t = sim.cellAt(xc, zc);
      if (!inside) { const d = Math.max(-x, -z, x - m.W * m.cell, z - m.H * m.cell, 0); y = z < 0 ? y - d * 0.09 : y + d * 0.04 + Math.sin(x * 0.02) * d * 0.03; if (z < 0 && y < 0.6) t = T.WATER; else t = T.OPEN; }
      if (t === T.WATER) y = Math.min(y, -1.2);
      pos.setY(i, y);
      c.set(PAL[t]);
      const n = Math.sin(x * 0.11 + Math.cos(z * 0.07) * 2) * 0.5 + Math.sin(z * 0.13 + x * 0.03) * 0.5;
      c.offsetHSL(n * 0.015, n * 0.04, n * 0.035 + (y - 6) * 0.004);
      if (!inside) c.lerp(new THREE.Color('#8fa06a'), 0.25);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
    const ground = this.ground = new THREE.Mesh(geo, M.ground); ground.receiveShadow = true; S.add(ground);
    const wg = keep(new THREE.PlaneGeometry((m.W + PAD * 2) * m.cell * 1.5, 900 + m.H * m.cell)); wg.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(wg, M.water); water.position.set(cx, -0.2, (m.H * m.cell - 900) / 2); S.add(water);   // sea to the south and the map's inlets
    // ---- woods: trees (foliage cone + trunk), 3 to 4 per cell ----
    const treeG = keep(mergeGeometries([painted(tr(new THREE.CylinderGeometry(0.35, 0.5, 3, 5), 0, 1.5, 0), '#5a4330'),
      painted(tr(new THREE.ConeGeometry(3.2, 7, 7), 0, 6.2, 0), '#3f6a2c'), painted(tr(new THREE.ConeGeometry(2.4, 5, 7), 0, 9, 0), '#527c35')].map(p => (p.deleteAttribute('uv'), p))));
    const rockG = keep(painted(new THREE.DodecahedronGeometry(3, 0), '#8c8476'));
    const trees = [], rocks = [];
    for (let j = 0; j < m.H; j++) for (let i = 0; i < m.W; i++) {
      const t = m.type[j * m.W + i];
      if (t === T.WOOD) for (let q = 0; q < 3; q++) trees.push([(i + r()) * m.cell, (j + r()) * m.cell, 0.75 + r() * 0.5]);
      else if (t === T.OPEN && r() < 0.03) trees.push([(i + r()) * m.cell, (j + r()) * m.cell, 0.8 + r() * 0.3]);
      else if (t === T.ROCK && m.h[j * m.W + i] > 0) for (let q = 0; q < 2; q++) rocks.push([(i + r()) * m.cell, (j + r()) * m.cell, 0.9 + r() * 1.1]);
    }
    for (let q = 0; q < 140; q++) { const x = (r() * (m.W + 16) - 8) * m.cell, z = (m.H + 1 + r() * 14) * m.cell; trees.push([x, z, 0.8 + r() * 0.6]); }
    const dummy = new THREE.Object3D();
    const inst = (g, mat, list, f) => { const im = new THREE.InstancedMesh(g, mat, Math.max(1, list.length)); list.forEach((p, k) => { f(p); dummy.updateMatrix(); im.setMatrixAt(k, dummy.matrix); }); im.count = list.length; im.castShadow = true; im.receiveShadow = true; S.add(im); return im; };
    inst(treeG, M.veg, trees, ([x, z, s]) => { dummy.position.set(x, this._h(x, z) - 0.3, z); dummy.scale.setScalar(s); dummy.rotation.set(0, r() * 6, 0); });
    inst(rockG, M.rock, rocks, ([x, z, s]) => { dummy.position.set(x, this._h(x, z) + s * 0.6, z); dummy.scale.set(s, s * 0.8, s); dummy.rotation.set(r(), r() * 6, r()); });
    // ---- town: houses (rendered walls, tiled roofs) around the square, palisade, flagpole ----
    const houseG = keep(mergeGeometries([painted(tr(new THREE.BoxGeometry(8, 5, 6), 0, 2.5, 0), '#e2d3b4'),
      painted(tr(new THREE.CylinderGeometry(0.01, 6.2, 3.4, 4, 1), 0, 6.7, 0, 0, Math.PI / 4), '#a24f2f')].map(p => (p.deleteAttribute('uv'), p))));
    const houses = [];
    for (let k = 0; k < 18; k++) {
      const a = k / 18 * Math.PI * 2 + r() * 0.2, d = 46 + r() * 22;
      const x = m.town.x + Math.cos(a) * d * 1.3, z = m.town.z + Math.sin(a) * d;
      if (sim.cellAt(x, z) === T.ROCK || sim.cellAt(x, z) === T.WATER) continue;
      houses.push([x, z, -a + Math.PI / 2, 0.8 + r() * 0.5]);
    }
    const hm = inst(houseG, M.house, houses, ([x, z, a, s]) => { dummy.position.set(x, this._h(x, z) - 0.2, z); dummy.scale.set(s, s * (0.9 + r() * 0.4), s); dummy.rotation.set(0, a, 0); });
    const tint = new THREE.Color(); houses.forEach((_, k) => hm.setColorAt(k, tint.setHSL(0.08 + r() * 0.05, 0.25, 0.75 + r() * 0.25)));
    const pole = new THREE.Mesh(keep(painted(new THREE.CylinderGeometry(0.2, 0.25, 14, 5), '#4a3727')), M.house);
    pole.position.set(m.town.x, this._h(m.town.x, m.town.z) + 7, m.town.z); S.add(pole);
    const flag = this.flag = new THREE.Mesh(keep(new THREE.PlaneGeometry(5, 3.2, 6, 2)), M.flag.clone()); keep(flag.material);
    flag.position.set(m.town.x + 2.6, this._h(m.town.x, m.town.z) + 12.2, m.town.z); flag.material.color.set(coat); S.add(flag);
    // square to hold: ring on the ground
    const sq = new THREE.Mesh(keep(new THREE.RingGeometry(40, 42, 48)), M.ring.clone()); keep(sq.material);
    sq.rotation.x = -Math.PI / 2; sq.position.set(m.town.x, this._h(m.town.x, m.town.z) + 0.4, m.town.z); sq.material.color.set(0xf0d58a); sq.material.opacity = 0.45; S.add(sq); this.square = sq;
    // ---- hommes : trois InstancedMesh (fantassins sabre, fantassins mousquet, cavaliers) ----
    const mk = g => { keep(g); const im = new THREE.InstancedMesh(g, M.men, MAX_MEN); im.castShadow = true; im.count = 0; im.frustumCulled = false; im.setColorAt(0, new THREE.Color()); S.add(im); return im; };
    this.menBlade = mk(manGeo('blade')); this.menGun = mk(manGeo('musket')); this.menHorse = mk(riderGeo());
    this.rings = new THREE.InstancedMesh(keep(new THREE.RingGeometry(0.86, 1, 32).rotateX(-Math.PI / 2)), M.ring, 32);
    this.rings.count = 0; this.rings.frustumCulled = false; this.rings.setColorAt(0, new THREE.Color()); S.add(this.rings);
    this.puffs = new THREE.InstancedMesh(keep(new THREE.IcosahedronGeometry(1, 1)), M.smoke, 160);
    this.puffs.count = 0; this.puffs.frustumCulled = false; S.add(this.puffs);
    this.smoke = [];
    this.coats = { player: { sabreurs: new THREE.Color('#8a2a1f'), mousquetaires: new THREE.Color('#5a6a32'), officiers: new THREE.Color('#2b2f4a') }, enemy: new THREE.Color(coat) };
    // ---- camera ----
    this.camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 2, 2600);
    this.cam = { x: m.deploy.x, z: m.deploy.z + 90, dist: 330, yaw: 0 };
    this._t = 0;
    return this;
  }

  _h(x, z) { return Math.max(0, heightAt(this.sim.map, x, z)); }

  puff(x, z, n = 4, big = 1) {
    for (let k = 0; k < n; k++) this.smoke.push({ x: x + (Math.random() - 0.5) * 8, y: this._h(x, z) + 1.8, z: z + (Math.random() - 0.5) * 8, s: (1.2 + Math.random()) * big, t: 0, life: 2.2 + Math.random() });
    if (this.smoke.length > 160) this.smoke.splice(0, this.smoke.length - 160);
  }

  // places each company's men in ranks (formation centred on the company, oriented by its heading)
  update(sim, dt, selected = new Set(), visibleFn = () => true) {
    this._t += dt;
    const d = new THREE.Object3D(), col = new THREE.Color(), cnt = { b: 0, g: 0, h: 0 };
    let ri = 0;
    for (const u of sim.units) {
      if (!sim.alive(u) || !visibleFn(u)) continue;
      const mounted = u.K.mounted, gun = u.K.fire > 0 && !mounted && u.kind !== 'officiers';
      const im = mounted ? this.menHorse : gun ? this.menGun : this.menBlade, key = mounted ? 'h' : gun ? 'g' : 'b';
      const cols = Math.max(3, Math.ceil(Math.sqrt(u.n * (mounted ? 1 : 2.2)))), sp = mounted ? 4.6 : 2.6;   // figures ×1.45: readable from above
      const ch = Math.cos(u.heading), sh = Math.sin(u.heading), rout = u.state === 'rout';
      if (u.side === 'player') col.copy(this.coats.player[u.kind] || this.coats.player.sabreurs); else col.copy(this.coats.enemy);
      if (rout) col.lerp(new THREE.Color(0x9a9a9a), 0.45);
      for (let k = 0; k < u.n && cnt[key] < MAX_MEN; k++) {
        const cI = k % cols, rI = Math.floor(k / cols);
        let lx = (cI - (cols - 1) / 2) * sp, lz = -rI * sp * 1.1;
        const jit = Math.sin(u.id * 13.1 + k * 7.7), jit2 = Math.cos(u.id * 5.3 + k * 3.1);
        lx += jit * (rout ? 2.5 : 0.35); lz += jit2 * (rout ? 2.5 : 0.35);
        const x = u.x + lx * ch + lz * sh, z = u.z - lx * sh + lz * ch;
        const bob = (u.path?.length || rout) ? Math.abs(Math.sin(this._t * 9 + k)) * 0.25 : 0;
        d.position.set(x, this._h(x, z) + bob, z);
        d.rotation.set(0, (rout ? u.heading + Math.PI * 0 : u.heading) + jit * 0.15, u.engaged ? Math.sin(this._t * 10 + k) * 0.12 : 0);
        d.scale.setScalar((u.kind === 'officiers' ? 1.65 : 1.45) * (mounted ? 1.15 : 1.25));   // bigger figurines (read at 15–20 px)
        d.updateMatrix(); im.setMatrixAt(cnt[key], d.matrix); im.setColorAt(cnt[key], col); cnt[key]++;
      }
      // selection / side ring
      const R = Math.max(5, Math.sqrt(u.n) * (mounted ? 3.6 : 2.4));
      d.position.set(u.x, this._h(u.x, u.z) + 0.35, u.z); d.rotation.set(0, 0, 0); d.scale.set(R, 1, R); d.updateMatrix();
      this.rings.setMatrixAt(ri, d.matrix);
      this.rings.setColorAt(ri, col.set(u.side === 'enemy' ? 0xc0392b : selected.has(u) ? 0xffe9a0 : 0x6f8fb0).multiplyScalar(selected.has(u) || u.side === 'enemy' ? 1 : 0.7));
      ri++;
    }
    for (const [im, k] of [[this.menBlade, 'b'], [this.menGun, 'g'], [this.menHorse, 'h']]) { im.count = cnt[k]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    this.rings.count = ri; this.rings.instanceMatrix.needsUpdate = true; if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    // powder smoke
    let pi = 0;
    this.smoke = this.smoke.filter(p => (p.t += dt) < p.life);
    for (const p of this.smoke) {
      const k = p.t / p.life; d.position.set(p.x + k * 6, p.y + k * 5, p.z + k * 2); d.rotation.set(0, 0, 0); d.scale.setScalar(p.s * (1 + k * 2.2)); d.updateMatrix();
      this.puffs.setMatrixAt(pi++, d.matrix);
    }
    this.puffs.count = pi; this.puffs.instanceMatrix.needsUpdate = true;
    // flag flying
    const fp = this.flag.geometry.attributes.position;
    for (let i = 0; i < fp.count; i++) { const x = fp.getX(i) + 2.5; fp.setZ(i, Math.sin(this._t * 4 + x * 1.2) * 0.25 * x); }
    fp.needsUpdate = true;
    this.square.material.opacity = 0.3 + 0.2 * (0.5 + 0.5 * Math.sin(this._t * 2.5));
  }

  setFlag(color) { this.flag.material.color.set(color); }

  render() {
    const g = this.game, r = g.renderer, c = this.cam, cam = this.camera, m = this.sim.map;
    const W = innerWidth, H = innerHeight; if (cam.aspect !== W / H) { cam.aspect = W / H; cam.updateProjectionMatrix(); }
    c.x = Math.max(-40, Math.min(m.W * m.cell + 40, c.x)); c.z = Math.max(-60, Math.min(m.H * m.cell + 20, c.z));
    c.dist = Math.max(120, Math.min(560, c.dist));
    const pitch = 0.95 - (c.dist - 120) / 440 * 0.12;   // higher when zoomed out
    cam.position.set(c.x - Math.sin(c.yaw) * Math.cos(pitch) * c.dist, Math.sin(pitch) * c.dist + 10, c.z - Math.cos(c.yaw) * Math.cos(pitch) * c.dist);
    cam.lookAt(c.x, 8, c.z);
    const prevExp = r.toneMappingExposure, sh = r.shadowMap.enabled;
    r.toneMappingExposure = 1.05; r.shadowMap.enabled = true; r.shadowMap.needsUpdate = true;
    r.setRenderTarget(null); r.render(this.scene, cam);
    r.toneMappingExposure = prevExp; r.shadowMap.enabled = sh;
  }

  pick(nx, ny) {
    const ray = new THREE.Raycaster(); ray.setFromCamera({ x: nx, y: ny }, this.camera);
    const hit = ray.intersectObject(this.ground, false)[0];
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  }
  project(x, z, y = 0) {
    const v = new THREE.Vector3(x, this._h(x, z) + y, z).project(this.camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, behind: v.z > 1 };
  }

  dispose() {
    for (const o of this.disposables || []) o.dispose?.();
    this.scene?.traverse(o => { if (o.isInstancedMesh) o.dispose?.(); if (o.isLight) o.dispose?.(); });
    this.scene = null;
  }
}

// materials and geometries shared with src/game/sneak/view.js (same painted style)
export { makeMaterials, painted, tr, manGeo };
