// Rendering of the land battle: standalone three.js scene (tilted top-down view) built with the land art kit
// (src/game/land/kit.js): painted terrain matching the sim map (woods, hills, rocks, fields, the road from the beach,
// cobbled square and streets), the town of varied houses around its square with church and fort (on the map's built
// cells), the beach with the longboats, the sea with the player's ships at anchor. Companies are drawn in tidy ranks
// with a banner each, squeezed into a column in the streets, scattering when routed; volleys put a line of smoke and
// muzzle flashes along the front rank, cavalry raises dust. Overlays: selection rings, march paths, order markers,
// the outline of the square filling up while it is held, and the flag over it changing hands. ≈ 40 draw calls.
//   const v = await new LandView(game).build(sim, { coat, seed, nation, playerFaction, ships }, step)
//   v.update(sim, dt, selected, visibleFn)  v.render()  v.dispose()
//   v.volley(unit) (smoke + flashes)  v.clash(x, z) (melee dust)  v.order(x, z, target) (order marker)
//   v.pick(ndcX, ndcY) -> { x, z } on the terrain    v.project(x, z, y) -> { x, y, behind } screen pixels
//   v.squareState -> 'free' | 'held' | 'enemy' | 'contested' (updated each frame)
// Everything (materials, geometries, the kit's materials) is created by build() and released by dispose(): nothing of
// the battle exists at sea or at the title screen. build() is asynchronous: it yields (await step()) between its stages
// so that the loading screen (src/ui/townLoader.js) stays alive.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { T, heightAt, findPath, cellIndex } from './sim.js';
import { LAND } from '../../data/landbattle.js';
import { mulberry32 } from '../../core/rng.js';
import { kitMaterials, kitTick, GeoBuilder, PALETTE, house, church, fort, lowWall, longboat, anchoredShips, fountain, pot, sacks,
  vegGeos, scatter, paintGround, clothGeo, flagUV, waveCloth, PuffPool, KM } from '../land/kit.js';

const MAX_MEN = 520;
// the battle's own materials (a fresh set per battle, disposed with it): soldiers, overlays drawn above everything
// (selection rings, march paths, order markers, the square's outline: always readable)
function makeMaterials() {
  const M = {
    men: menMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 })),
    decal: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
  };
  M.dispose = () => { M.men.dispose(); M.decal.dispose(); };
  return M;
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

// banner of a company: pole with finial and crossbar, cloth (white = tinted by the side's colour) with a pale cross and
// a gold fringe, baked in a light wave
function bannerGeo() {
  const P = (g, c, t) => painted(g, c, t);
  const parts = [
    P(tr(new THREE.CylinderGeometry(0.07, 0.09, 7.6, 5), 0, 3.8, 0), '#4a3727', 0),
    P(tr(new THREE.ConeGeometry(0.18, 0.5, 5), 0, 7.85, 0), '#d4a843', 0),
    P(tr(new THREE.CylinderGeometry(0.05, 0.05, 3.1, 4), 1.5, 7.3, 0, 0, 0, Math.PI / 2), '#4a3727', 0),
    P(tr(new THREE.BoxGeometry(2.9, 2.0, 0.07, 8, 4, 1), 1.55, 6.25, 0), '#ffffff', 1),
    P(tr(new THREE.BoxGeometry(2.9, 0.34, 0.1, 8, 1, 1), 1.55, 6.25, 0), '#f2ead6', 0),
    P(tr(new THREE.BoxGeometry(0.34, 2.0, 0.1, 1, 4, 1), 1.25, 6.25, 0), '#f2ead6', 0),
    P(tr(new THREE.BoxGeometry(2.9, 0.16, 0.11, 8, 1, 1), 1.55, 5.2, 0), '#d4a843', 0),
  ];
  const g = mergeGeometries(parts.map(p => (p.deleteAttribute('uv'), p)));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); if (x > 0.12) p.setZ(i, p.getZ(i) + Math.sin((x - 0.1) * 1.8) * 0.28 * Math.min(1, x)); }
  g.computeVertexNormals();
  return g;
}
// flat chevron lying on the ground, its tip toward -x (order marker)
function chevronGeo() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1.4, 0, -1.1, 1.4, 0, -0.5, 0, 0, 0, 1.4, 0, -0.5, 0.65, 0, 0,
    0, 0, 0, 0.65, 0, 0, 1.4, 0, 0.5, 0, 0, 0, 1.4, 0, 0.5, 1.4, 0, 1.1], 3));
  return g;
}

const SQUARE_DASHES = 44, MAX_DOTS = 420, MAX_MARK = 12, MAX_BANNERS = 24;
const COL = {
  sel: new THREE.Color(0xffe08a), mine: new THREE.Color(0x86acd0).multiplyScalar(0.8), foe: new THREE.Color(0xd8452f), rout: new THREE.Color(0x9a9a9a),
  move: new THREE.Color(0xffd56a), attack: new THREE.Color(0xff5a3c),
  held: new THREE.Color(0xffd050), free: new THREE.Color(0xf3e6c2), enemyHeld: new THREE.Color(0xc8553a), contested: new THREE.Color(0xffffff),
  smoke: 0xf4f0e8, flash: 0xffc46a, dust: 0xcdb48a,
};
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class LandView {
  constructor(game) { this.game = game; this.scene = null; }

  // coat: the garrison's colour · nation / playerFaction: their flags (player colours = NATION_COATS of playerFaction,
  // passed as playerCoat) · ships: types of the player's ships riding at anchor off the beach
  async build(sim, { coat = '#2d4c8f', playerCoat = '#3a3a3a', seed = 1, nation = 'spanish', playerFaction = 'pirate', ships = ['brig'] } = {}, step = async () => {}) {
    const M = makeMaterials(), K = kitMaterials(), m = sim.map, S = this.scene = new THREE.Scene(), r = mulberry32(seed);
    this.sim = sim; this.disposables = [M, K]; this.nation = nation; this.playerFaction = playerFaction;
    const keep = o => { this.disposables.push(o); return o; };
    const MW = m.W * m.cell, MH = m.H * m.cell, cx = MW / 2, cz = MH / 2, Y = (x, z) => this._ground(x, z);
    S.background = new THREE.Color(0xc4d2d6);
    S.fog = new THREE.Fog(0xc4d2d6, 560, 1400);
    S.add(new THREE.HemisphereLight(0xe4ecf2, 0x76684a, 1.25));
    const sun = new THREE.DirectionalLight(0xffdfb0, 2.5);
    sun.position.set(cx - 380, 340, cz - 90); sun.target.position.set(cx, 0, cz); S.add(sun, sun.target);
    sun.castShadow = true; const sc = sun.shadow.camera; sc.left = -330; sc.right = 330; sc.top = 300; sc.bottom = -300; sc.far = 1300; sc.updateProjectionMatrix();
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;

    // ---- per-cell paint (colour + sand / paved / field / rock weights) from the sim map; the road from the beach ----
    const N = m.W * m.H, cellPaint = new Array(N), field = new Uint8Array(N), road = new Uint8Array(N);
    const route = findPath(m, m.deploy.x, m.deploy.z, m.town.x, m.town.z) || [];
    let prev = { x: m.deploy.x, z: 0 };
    for (const p of [{ x: m.deploy.x, z: m.deploy.z }, ...route]) {   // every cell crossed by the polyline
      const L = Math.hypot(p.x - prev.x, p.z - prev.z), n = Math.ceil(L / 3);
      for (let q = 0; q <= n; q++) road[cellIndex(m, prev.x + (p.x - prev.x) * q / Math.max(1, n), prev.z + (p.z - prev.z) * q / Math.max(1, n))] = 1;
      prev = p;
    }
    const tcx = m.town.x / m.cell, tcz = m.town.z / m.cell, edge = (i, j) => i === 0 || j === 0 || i === m.W - 1 || j === m.H - 1;
    // woods around the map: dense along its edge (the edge cells are an impassable thicket), patchy further out
    const forest = (x, z) => { const o = Math.max(-x, -z, x - MW, z - MH, 0), n = 0.5 + 0.25 * (Math.sin(x * 0.013 + Math.cos(z * 0.011) * 2) + Math.sin(z * 0.017 + x * 0.006));
      return Math.max(0, Math.min(1, n * 0.9 + Math.max(0, 1 - o / 45) * 0.45 - 0.15)); };
    for (let j = 0; j < m.H; j++) for (let i = 0; i < m.W; i++) {
      const k = j * m.W + i, dT = Math.hypot((i + 0.5 - tcx) / 1.3, j + 0.5 - tcz);
      if (m.type[k] === T.OPEN && !m.street[k] && !road[k] && dT > 8.5 && dT < 17 && hash(Math.floor(i / 3), Math.floor(j / 2)) > 0.7) field[k] = 1;
    }
    for (let j = 0; j < m.H; j++) for (let i = 0; i < m.W; i++) {
      const k = j * m.W + i, t = m.type[k], n = hash(i, j);
      let o;
      if (m.built[k]) o = { color: '#a8977a', paved: 0.7 };
      else if (t === T.TOWN) o = { color: '#d0b88e', paved: 1 };
      else if (m.street[k]) o = { color: '#bfa784', paved: 1 };
      else if (road[k]) o = { color: '#b69b6b', sand: 0.75 };
      else if (field[k]) o = { color: hash(Math.floor(i / 3) + 5, Math.floor(j / 2)) > 0.5 ? '#c7af5e' : '#97a84a', field: 1 };
      else if (t === T.WOOD) o = { color: n > 0.5 ? '#5b7a37' : '#557334' };
      else if (t === T.HILL) o = { color: n > 0.5 ? '#aaa263' : '#a19a5a', rock: 0.15 };
      else if (t === T.ROCK) o = edge(i, j) ? { color: '#5e7b39', rock: 0.2 } : { color: '#9a9180', rock: 0.85 };
      else if (t === T.WATER) o = { color: '#cdb98a', sand: 1 };
      else o = { color: n > 0.5 ? '#87a34f' : '#809e4a' };
      const c = new THREE.Color(o.color); c.offsetHSL((n - 0.5) * 0.02, 0, (n - 0.5) * 0.04);
      cellPaint[k] = [c.r, c.g, c.b, o.sand || 0, o.paved || 0, o.field || 0, o.rock || 0];
    }
    const sand = new THREE.Color(PALETTE.sand), bed = new THREE.Color('#bda877'), meadow = new THREE.Color('#84a04d'), floor = new THREE.Color('#5a7937'), og = new THREE.Color();
    const paintAt = (x, z, y) => {
      let v;
      if (x >= 0 && z >= 0 && x <= MW && z <= MH) {   // bilinear blend of the four nearest cells
        const fx = Math.max(0, Math.min(m.W - 1.001, x / m.cell - 0.5)), fz = Math.max(0, Math.min(m.H - 1.001, z / m.cell - 0.5)), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, w = fz - j;
        const a = cellPaint[j * m.W + i], b = cellPaint[j * m.W + i + 1], c = cellPaint[(j + 1) * m.W + i], d = cellPaint[(j + 1) * m.W + i + 1];
        v = a.map((_, q) => (a[q] * (1 - u) + b[q] * u) * (1 - w) + (c[q] * (1 - u) + d[q] * u) * w);
      } else { og.copy(meadow).lerp(floor, smooth(0.3, 0.75, forest(x, z))); v = [og.r, og.g, og.b, 0, 0, 0, 0]; }
      const sx = x - m.town.x, sz = z - m.town.z, rr = Math.hypot(sx, sz);
      if (rr < LAND.squareR + 4) {   // the square: a compass rose of darker paving (rings and rays)
        const a = Math.atan2(sz, sx), band = Math.max(1 - Math.abs(rr - 13) / 2.2, 1 - Math.abs(rr - 30) / 1.8, rr > 4 && rr < 30 ? 1 - Math.abs(Math.sin(a * 4)) * rr / 4 : 0, 0);
        const k = 1 - 0.28 * Math.min(1, band) * v[4];
        v = [v[0] * k, v[1] * k, v[2] * k * 0.97, v[3], v[4], v[5], v[6]];
      }
      if (y < 2.4) {   // beach, then the seabed
        const s = Math.min(1, (2.4 - y) / 1.4), c = y < 0 ? bed : sand;
        v = [v[0] * (1 - s) + c.r * s, v[1] * (1 - s) + c.g * s, v[2] * (1 - s) + c.b * s, Math.max(v[3], s), v[4] * (1 - s), v[5] * (1 - s), v[6] * (1 - s)];
      }
      const lift = 1 + Math.max(-0.08, Math.min(0.08, (y - 8) * 0.006));
      return { color: new THREE.Color(v[0] * lift, v[1] * lift, v[2] * lift), sand: v[3], paved: v[4], field: v[5], rock: v[6] };
    };

    await step();
    // ---- terrain: the battle map and a painted border (beach and sea to the south, the harbour shore to the north) ----
    const SUB = 3, PAD = 24;
    const geo = keep(new THREE.PlaneGeometry((m.W + PAD * 2) * m.cell, (m.H + PAD * 2) * m.cell, (m.W + PAD * 2) * SUB, (m.H + PAD * 2) * SUB));
    geo.rotateX(-Math.PI / 2); geo.translate(cx, 0, cz);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, Y(pos.getX(i), pos.getZ(i)));
    paintGround(geo, paintAt); geo.computeVertexNormals();
    const ground = this.ground = new THREE.Mesh(geo, K.paint); ground.receiveShadow = true; S.add(ground);
    {   // sea: depth-tinted, foam along the shore
      const wW = (m.W + PAD * 2) * m.cell, wH = (m.H + PAD * 2) * m.cell, wg = keep(new THREE.PlaneGeometry(wW, wH, Math.round(wW / 6), Math.round(wH / 6)));
      wg.rotateX(-Math.PI / 2); wg.translate(cx, 0.15, cz);
      const p = wg.attributes.position, col = new Float32Array(p.count * 3), foam = new Float32Array(p.count), c = new THREE.Color();
      const shallow = new THREE.Color('#63bcb2'), mid = new THREE.Color('#2f8aa0'), deep = new THREE.Color('#215f80');
      for (let i = 0; i < p.count; i++) {
        const depth = -Y(p.getX(i), p.getZ(i));
        c.copy(shallow).lerp(mid, Math.min(1, Math.max(0, depth / 5))).lerp(deep, Math.min(1, Math.max(0, (depth - 5) / 12)));
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        foam[i] = Math.max(0, 1 - Math.abs(depth - 0.3) / 1.6);
      }
      wg.setAttribute('color', new THREE.BufferAttribute(col, 3)); wg.setAttribute('aFoam', new THREE.BufferAttribute(foam, 1));
      S.add(new THREE.Mesh(wg, K.water));
    }

    await step();
    // ---- town (houses on the built cells, church, fort, a fountain), field walls, square, longboats, ships: merged ----
    const B = new GeoBuilder();
    const cellC = k => [((k % m.W) + 0.5) * m.cell, (Math.floor(k / m.W) + 0.5) * m.cell];
    const footY = (x, z, rad) => Math.min(Y(x - rad, z - rad), Y(x + rad, z - rad), Y(x - rad, z + rad), Y(x + rad, z + rad), Y(x, z));
    const nave = [];
    // a little fountain square in place of the house nearest the market square (on a built cell: nothing to cross)
    let fk = -1, fd = Infinity;
    for (let k = 0; k < N; k++) if (m.built[k] === 1) { const [x, z] = cellC(k), dd = Math.hypot(x - m.town.x, z - m.town.z); if (dd > LAND.squareR + 8 && dd < fd) { fd = dd; fk = k; } }
    for (let k = 0; k < N; k++) {
      if (m.built[k] === 2) nave.push(cellC(k));
      if (m.built[k] !== 1) continue;
      if (k === fk) {
        const [x, z] = cellC(k), y = footY(x, z, 4);
        B.ground = y; B.aoH = 1.5;
        B.block(x, y - 1.2, z, m.cell - 0.6, 1.32, m.cell - 0.6, '#bfa784', KM.COBBLE);
        fountain(B, { x, z, y: y + 0.12, r: 2.1 });
        for (const [dx, dz] of [[-3.4, -3.4], [3.4, 3.2]]) pot(B, x + dx, y + 0.12, z + dz, 1.4, r);
        sacks(B, { x: x + 3.2, z: z - 3.0, y: y + 0.12, rot: r() * 3, rand: r });
        continue;
      }
      const [x0, z0] = cellC(k), x = x0 + (r() - 0.5) * 1.4, z = z0 + (r() - 0.5) * 1.4, dT = Math.hypot((x - m.town.x) / 1.3, z - m.town.z) / m.cell;
      const rot = Math.round(Math.atan2(m.town.x - x, m.town.z - z) / (Math.PI / 8)) * (Math.PI / 8) + (r() - 0.5) * 0.08, fr = r();
      house(B, { x, z, y: footY(x, z, 4), w: 7.8 + r() * 1.9, d: 6.8 + r() * 2.3, rot, floors: dT < 6 ? (fr < 0.2 ? 3 : fr < 0.75 ? 2 : 1) : (fr < 0.4 ? 2 : 1), hip: r() < 0.4, rand: r });
    }
    if (nave.length) {
      const x = nave.reduce((a, c) => a + c[0], 0) / nave.length, z = nave.reduce((a, c) => a + c[1], 0) / nave.length;
      church(B, { x, z, y: footY(x, z, 10), rot: Math.PI, roof: PALETTE.roofs[0], spire: nation === 'english' || nation === 'dutch' });
    }
    const fy = Math.max(1.5, footY(m.fort.x, m.fort.z - 6, 14)), F = fort(B, { x: m.fort.x, z: m.fort.z, y: fy });
    {   // the square: a well at the foot of the flagpole, market stalls
      const y = Y(m.town.x, m.town.z);
      B.ground = y; B.aoH = 1;
      B.cyl(m.town.x, y - 0.5, m.town.z, 2.4, 2.4, 1.4, 14, PALETTE.stone, KM.STONE);
      B.cyl(m.town.x, y + 0.9, m.town.z, 2.6, 2.6, 0.25, 14, '#cbbd9c', KM.STONE);
      B.cyl(m.town.x, y + 1.1, m.town.z, 0.22, 0.14, 15, 6, '#4a3727', KM.WOOD);
      this._pole = { x: m.town.x, y: y + 16, z: m.town.z };
      const awn = ['#b8402e', '#e8dcc0', '#3a6a8a', '#d8a040', '#5a7a3a', '#a8603a'];
      for (const sg of [-1, 1]) for (let q = 0; q < 3; q++) {   // market stalls on the east and west rims, outside the circle to hold
        const x = m.town.x + sg * (LAND.squareR + 6), z = m.town.z + (q - 1) * 14 + (r() - 0.5) * 3, sy = Y(x, z), rot = sg * Math.PI / 2;
        B.ground = sy; B.aoH = 1.5;
        B.block(x, sy - 0.4, z, 3.2, 1.3, 1.8, '#7a5a3a', KM.WOOD, rot);
        for (const [ox, oz] of [[-1.5, -0.8], [1.5, -0.8], [-1.5, 0.8], [1.5, 0.8]]) B.cyl(x + oz * sg, sy, z + ox, 0.07, 0.07, 2.6, 4, '#3a2a1a', KM.WOOD);
        B.gable(x, sy + 2.6, z, 3.4, 2.2, 0.6, awn[(q + (sg > 0 ? 3 : 0)) % awn.length], KM.CLOTH, rot, 0.2);
        for (let c = 0; c < 3; c++) B.cyl(x + (r() - 0.5) * 2, sy + 0.9, z + (r() - 0.5) * 2.4, 0.3, 0.3, 0.4, 7, ['#c8a050', '#8a4a2a', '#5a7a3a'][c], KM.WOOD);
        B.block(x + sg * 2.4, sy - 0.1, z + 1.4, 1.1, 1.0, 1.1, '#a07a4a', KM.WOOD, r() * 3);
        B.cyl(x + sg * 2.3, sy - 0.1, z - 1.5, 0.5, 0.5, 1.1, 8, '#7a5232', KM.WOOD);
      }
    }
    for (let k = 0; k < N; k++) if (field[k]) {   // dry-stone walls around the fields
      const [x, z] = cellC(k), h = m.cell / 2, i = k % m.W, j = Math.floor(k / m.W);
      if (i > 0 && !field[k - 1]) lowWall(B, x - h, z - h, x - h, z + h, Y);
      if (i < m.W - 1 && !field[k + 1]) lowWall(B, x + h, z - h, x + h, z + h, Y);
      if (j > 0 && !field[k - m.W]) lowWall(B, x - h, z - h, x + h, z - h, Y);
      if (j < m.H - 1 && !field[k + m.W]) lowWall(B, x - h, z + h, x + h, z + h, Y);
    }
    const shoreZ = x => { let z = 0; while (z > -200 && Y(x, z) > 0.7) z -= 2; return z; };
    for (let q = 0; q < 4; q++) {   // the longboats pulled up on the beach
      const x = m.deploy.x + (q - 1.5) * 15 + (r() - 0.5) * 5, z = shoreZ(x) + 3.5;
      longboat(B, { x, z, y: Y(x, z), rot: (r() - 0.5) * 0.5 });
    }
    const ancho = [], fleet = ships.slice(0, 3);
    fleet.forEach((type, q) => {
      const x = m.deploy.x + (q - (fleet.length - 1) / 2) * 85 + (r() - 0.5) * 20;
      let z = shoreZ(x); while (z > -400 && Y(x, z) > -3) z -= 4;
      ancho.push({ type, x, z: z - 12 - r() * 12, rot: Math.PI / 2 + (r() - 0.5) * 0.6 });
    });
    const hulls = anchoredShips(B, ancho, playerFaction);
    if (hulls) { keep(hulls.geometry); keep(hulls.material); keep(hulls.customDepthMaterial); S.add(hulls); }
    const town = new THREE.Mesh(keep(B.build()), K.paint); town.castShadow = true; town.receiveShadow = true; S.add(town);

    // ---- vegetation and rocks (instanced), on the sim's cells and over the border ----
    await step();
    const V = keep(vegGeos()), inner = { broadleaf: [], palm: [], bush: [], rock: [] }, border = { broadleaf: [], palm: [], bush: [], rock: [] };
    let veg = inner;
    const tint = () => new THREE.Color(0.88 + r() * 0.22, 0.88 + r() * 0.2, 0.84 + r() * 0.16);
    const add = (kind, x, z, s) => veg[kind].push({ x, y: Y(x, z) - (kind === 'rock' ? 0.3 : 0.15), z, s, r: r() * 6.283, tint: kind === 'rock' ? 0xffffff : tint() });
    const deployR = (x, z) => Math.hypot((x - m.deploy.x) / 2.2, z - m.deploy.z) < 3.2 * m.cell;
    for (let j = 0; j < m.H; j++) for (let i = 0; i < m.W; i++) {
      const k = j * m.W + i, t = m.type[k], at = () => [(i + 0.1 + r() * 0.8) * m.cell, (j + 0.1 + r() * 0.8) * m.cell];
      if (m.built[k] || m.street[k] || road[k] || field[k] || t === T.TOWN || t === T.WATER) continue;
      if (t === T.WOOD) {
        for (let q = 0; q < 2; q++) { const [x, z] = at(); add(j < 7 || r() < 0.18 ? 'palm' : 'broadleaf', x, z, 0.8 + r() * 0.45); }
        const [x, z] = at(); add('bush', x, z, 0.8 + r() * 0.5);
      } else if (t === T.ROCK && edge(i, j)) {   // the thicket along the map's edge
        for (let q = 0; q < 2; q++) { const [x, z] = at(); add(j < 3 || j > m.H - 3 ? 'palm' : 'broadleaf', x, z, 0.85 + r() * 0.45); }
        const [x, z] = at(); add(r() < 0.25 ? 'rock' : 'bush', x, z, 0.8 + r() * 0.5);
      } else if (t === T.ROCK) {
        for (let q = 0; q < 1 + (r() < 0.6); q++) { const [x, z] = at(); add('rock', x, z, 0.9 + r() * 1.1); }
        if (r() < 0.5) { const [x, z] = at(); add('bush', x, z, 0.7 + r() * 0.4); }
      } else {
        const [x, z] = at(); if (deployR(x, z)) continue;
        const q = r();
        if (t === T.HILL) { if (q < 0.1) add('bush', x, z, 0.7 + r() * 0.5); else if (q < 0.16) add('rock', x, z, 0.6 + r() * 0.6); }
        else if (q < 0.045) add('palm', x, z, 0.85 + r() * 0.3); else if (q < 0.11) add('bush', x, z, 0.7 + r() * 0.5); else if (q < 0.135) add('broadleaf', x, z, 0.8 + r() * 0.3);
      }
    }
    veg = border;   // the border: woods on the hills, palms on the shores (outside the shadow box: no shadows)
    for (let x = -160; x <= MW + 160; x += 12) for (let z = -160; z <= MH + 160; z += 12) {
      if (x >= -4 && z >= -4 && x <= MW + 4 && z <= MH + 4) continue;
      const px = x + (r() - 0.5) * 9, pz = z + (r() - 0.5) * 9, y = Y(px, pz);
      if (y < 0.8 || (Math.abs(px - m.fort.x) < 40 && Math.abs(pz - m.fort.z) < 32)) continue;
      if (y < 4) { if (r() < 0.3) add('palm', px, pz, 0.8 + r() * 0.35); }
      else if (r() < forest(px, pz) * 1.1) add(r() < 0.2 ? 'palm' : 'broadleaf', px, pz, 0.85 + r() * 0.5);
      else if (r() < 0.15) add('bush', px, pz, 0.8 + r() * 0.5);
    }
    for (const kind of ['broadleaf', 'palm', 'bush', 'rock']) {
      S.add(scatter(V[kind], K.paint, inner[kind]));
      if (border[kind].length) S.add(scatter(V[kind], K.paint, border[kind], { shadow: false }));
    }

    // ---- flags: over the square (changes hands as it is held) and over the fort ----
    const flag = (w, h, faction) => { const g = keep(clothGeo(w, h, 10, 4)); flagUV(g, faction); const f = new THREE.Mesh(g, K.flag); f.castShadow = true; S.add(f); return f; };
    this.sqFlag = flag(5.4, 3.4, nation); this._sqFaction = nation;
    this.fortFlag = flag(6.5, 4.2, nation); this.fortFlag.position.set(F.flag[0] + 0.2, F.flag[1] - 2.1, F.flag[2]);

    // ---- men: three InstancedMesh (swordsmen, musketeers, riders), banners ----
    const mk = (g, n) => { keep(g); const im = new THREE.InstancedMesh(g, M.men, n); im.castShadow = true; im.count = 0; im.frustumCulled = false; im.setColorAt(0, new THREE.Color()); S.add(im); return im; };
    this.menBlade = mk(manGeo('blade'), MAX_MEN); this.menGun = mk(manGeo('musket'), MAX_MEN); this.menHorse = mk(riderGeo(), MAX_MEN);
    this.banners = mk(bannerGeo(), MAX_BANNERS);
    this.coats = { player: { sabreurs: new THREE.Color('#8a2a1f'), mousquetaires: new THREE.Color('#5a6a32'), officiers: new THREE.Color('#2b2f4a') }, enemy: new THREE.Color(coat) };
    this.flagCols = { player: new THREE.Color(playerCoat), enemy: new THREE.Color(coat) };
    // ---- overlays and effects ----
    const ov = (g, n) => { keep(g); const im = new THREE.InstancedMesh(g, M.decal, n); im.count = 0; im.frustumCulled = false; im.renderOrder = 5; im.setColorAt(0, new THREE.Color()); S.add(im); return im; };
    this.rings = ov(new THREE.RingGeometry(0.94, 1, 48).rotateX(-Math.PI / 2), 64);
    this.dots = ov(new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2), MAX_DOTS);
    this.marks = ov(chevronGeo(), MAX_MARK);
    this.dashes = ov(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), SQUARE_DASHES);
    this.smoke = new PuffPool(S, K, 700); this.flashes = new PuffPool(S, K, 240, { additive: true });
    this._vs = new Map(); this._orders = []; this._d = new THREE.Object3D(); this._c = new THREE.Color();
    this.squareState = 'free';
    // ---- camera ----
    this.camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 2, 2800);
    this.cam = { x: m.deploy.x, z: m.deploy.z + 90, dist: 330, yaw: 0 };
    this._t = 0;
    return this;
  }

  // render height everywhere: the sim's relief on the map; outside it, hills to the east and west, the beach and the
  // sea to the south, the harbour shore to the north (wavy coast lines)
  _ground(x, z) {
    const m = this.sim.map, MW = m.W * m.cell, MH = m.H * m.cell;
    let y = heightAt(m, Math.max(0, Math.min(MW, x)), Math.max(0, Math.min(MH, z)));
    if (x >= 0 && z >= 0 && x <= MW && z <= MH) return y;
    const dE = Math.max(0, -x, x - MW);
    y += dE * (0.06 + 0.035 * Math.sin(z * 0.017 + x * 0.004)) + Math.sin(x * 0.021) * Math.cos(z * 0.017) * Math.min(1, dE / 60) * 5;
    const dS = -z + (9 * Math.sin(x * 0.013) + 5 * Math.sin(x * 0.041 + 1)) * Math.min(1, Math.max(0, -z / 25));
    const dN = z - MH + 7 * Math.sin(x * 0.017 + 2) * Math.min(1, Math.max(0, (z - MH) / 25));
    if (dS > 0) { const s = smooth(0, 45, dS); y = y * (1 - s) + (-0.6 - dS * 0.05) * s; }
    if (dN > 0) { const s = smooth(0, 60, dN); y = y * (1 - s) + (-0.8 - dN * 0.06) * s; }
    return y;
  }
  _h(x, z) { return Math.max(-0.4, this._ground(x, z)); }

  // lateral clear half-width at (x, z) across the heading (houses, rocks, water): squeezes a company into a column
  _clear(x, z, ch, sh, max) {
    const m = this.sim.map;
    for (let s = 2.5; s <= max; s += 2.5) for (const sg of [-1, 1]) {
      const t = m.type[cellIndex(m, x + sg * s * ch, z - sg * s * sh)];
      if (t === T.ROCK || t === T.WATER) return s - 1.3;
    }
    return max;
  }

  // per-company view state: smoothed position of each man, rout and dust timers, last formation
  _state(u) {
    let vs = this._vs.get(u.id);
    if (!vs) this._vs.set(u.id, vs = { px: new Float32Array(u.maxN), pz: new Float32Array(u.maxN), tx: new Float32Array(u.maxN), tz: new Float32Array(u.maxN), init: false, rout: 0, dust: 0, ux: u.x, uz: u.z, speed: 0, f: null });
    return vs;
  }
  // target slot of each man: ranks of `cols` men (front rank at the company's point, the others behind), squeezed in
  // the streets; routed men scatter further and further around the fleeing company
  _formation(u, vs) {
    const mounted = u.K.mounted, sp = mounted ? 4.6 : 2.6, ch = Math.cos(u.heading), sh = Math.sin(u.heading), rout = u.state === 'rout';
    let cols = Math.max(3, Math.ceil(Math.sqrt(u.n * (mounted ? 1 : 2.2))));
    cols = Math.max(2, Math.min(cols, Math.floor(this._clear(u.x, u.z, ch, sh, (cols - 1) / 2 * sp + 1.5) * 2 / sp) + 1));
    const rows = Math.ceil(u.n / cols);
    for (let k = 0; k < u.n; k++) {
      const rI = Math.floor(k / cols), inRow = Math.min(cols, u.n - rI * cols), cI = k - rI * cols;
      let lx = (cI - (inRow - 1) / 2) * sp + (hash(u.id, k) - 0.5) * 0.3, lz = -rI * sp * 1.1 + (hash(k, u.id) - 0.5) * 0.3;
      if (rout) { const a = hash(u.id + 3, k) * 6.283, rr = Math.min(18, 2 + vs.rout * 4.5) * (0.35 + 0.65 * hash(k, u.id + 9)); lx = lx * 0.5 + Math.cos(a) * rr; lz = lz * 0.5 + Math.sin(a) * rr; }
      vs.tx[k] = u.x + lx * ch + lz * sh; vs.tz[k] = u.z - lx * sh + lz * ch;
    }
    return (vs.f = { cols, rows, sp, ch, sh });
  }

  // a volley: muzzle flashes and a line of smoke along the front rank, drifting toward the target
  volley(u) {
    const vs = this._vs.get(u.id), f = vs?.f;
    if (!f) { for (let q = 0; q < 4; q++) this.smoke.spawn({ x: u.x + (Math.random() - 0.5) * 10, y: this._h(u.x, u.z) + 2.6, z: u.z + (Math.random() - 0.5) * 10, size: 2.2, grow: 1.8, life: 4, color: COL.smoke, alpha: 0.55, rise: 0.5 }); return; }
    const n = Math.min(f.cols, u.n), small = u.kind === 'officiers' ? 0.7 : 1;
    for (let k = 0; k < n; k++) {
      const x = vs.px[k] + f.sh * 2.2, z = vs.pz[k] + f.ch * 2.2, y = this._h(x, z) + 2.9;
      this.flashes.spawn({ x, y, z, size: (2.6 + Math.random() * 0.9) * small, grow: 0.5, life: 0.28 + Math.random() * 0.1, color: COL.flash, alpha: 1, fadeIn: 200 });
      this.flashes.spawn({ x, y, z, size: 1.2 * small, grow: 0.2, life: 0.18, color: 0xfff2c0, alpha: 1, fadeIn: 200 });
      for (let q = 0; q < 2; q++) this.smoke.spawn({ x: x + f.sh * (0.8 + q * 1.8), y: y - 0.3 + q * 0.4, z: z + f.ch * (0.8 + q * 1.8), vx: f.sh * (4 + q * 2) + (Math.random() - 0.5), vz: f.ch * (4 + q * 2) + (Math.random() - 0.5),
        size: (2.8 + Math.random() * 1.0) * small, grow: 1.9, life: 4 + Math.random() * 2, color: COL.smoke, alpha: 0.72, rise: 0.45 });
    }
  }
  // melee: dust kicked up where the companies meet
  clash(x, z) {
    for (let q = 0; q < 3; q++) this.smoke.spawn({ x: x + (Math.random() - 0.5) * 9, y: this._h(x, z) + 1, z: z + (Math.random() - 0.5) * 9, size: 2.4, grow: 1.5, life: 1.6, color: COL.dust, alpha: 0.38, rise: 1 });
  }
  // order given: chevrons closing on the point (gold march) or on the targeted company (red)
  order(x, z, target = null) {
    this._orders.push({ x, z, target, t: 0 });
    if (this._orders.length > MAX_MARK / 4) this._orders.shift();
  }

  update(sim, dt, selected = new Set(), visibleFn = () => true) {
    this._t += dt; kitTick(dt);
    const d = this._d, col = this._c, cnt = { b: 0, g: 0, h: 0 }, k8 = Math.min(1, dt * 7), t = this._t;
    let ri = 0, bi = 0, di = 0;
    const ring = (x, z, rot, sx, sz, c) => {   // ellipse outline on the ground
      if (ri >= this.rings.instanceMatrix.count) return;
      d.position.set(x, this._h(x, z) + 0.4, z); d.rotation.set(0, rot, 0); d.scale.set(sx, 1, sz); d.updateMatrix();
      this.rings.setMatrixAt(ri, d.matrix); this.rings.setColorAt(ri++, c);
    };
    for (const u of sim.units) {
      const vs = this._vs.get(u.id);
      if (!sim.alive(u) || !visibleFn(u)) { if (vs) vs.init = false; continue; }
      const st = this._state(u), rout = u.state === 'rout';
      st.rout = rout ? st.rout + dt : 0;
      if (dt > 0) { st.speed = Math.hypot(u.x - st.ux, u.z - st.uz) / dt; st.ux = u.x; st.uz = u.z; }
      const f = this._formation(u, st), moving = st.speed > 0.5;
      const mounted = u.K.mounted, gun = u.K.fire > 0 && !mounted && u.kind !== 'officiers';
      const im = mounted ? this.menHorse : gun ? this.menGun : this.menBlade, key = mounted ? 'h' : gun ? 'g' : 'b';
      if (u.side === 'player') col.copy(this.coats.player[u.kind] || this.coats.player.sabreurs); else col.copy(this.coats.enemy);
      if (rout) col.lerp(COL.rout, 0.45);
      const sc = (u.kind === 'officiers' ? 1.65 : 1.45) * (mounted ? 1.15 : 1.25);
      for (let k = 0; k < u.n && cnt[key] < MAX_MEN; k++) {
        if (!st.init) { st.px[k] = st.tx[k]; st.pz[k] = st.tz[k]; }
        else { st.px[k] += (st.tx[k] - st.px[k]) * k8; st.pz[k] += (st.tz[k] - st.pz[k]) * k8; }
        const x = st.px[k], z = st.pz[k], bob = moving ? Math.abs(Math.sin(t * (rout ? 12 : 9) + k)) * (rout ? 0.4 : 0.25) : 0;
        d.position.set(x, this._h(x, z) + bob, z);
        d.rotation.set(0, u.heading + (hash(k, u.id + 5) - 0.5) * (rout ? 1.4 : 0.08), u.engaged ? Math.sin(t * 10 + k) * 0.12 : 0);
        d.scale.setScalar(sc); d.updateMatrix(); im.setMatrixAt(cnt[key], d.matrix); im.setColorAt(cnt[key], col); cnt[key]++;
      }
      st.init = true;
      const back = -(f.rows - 1) * f.sp * 1.1;   // depth of the block (behind the front rank)
      if (!rout && bi < MAX_BANNERS) {   // the company's banner, behind the front rank
        const bz = Math.max(back, -f.sp * 1.1), x = u.x + bz * f.sh, z = u.z + bz * f.ch;
        d.position.set(x, this._h(x, z) + (moving ? Math.abs(Math.sin(t * 9)) * 0.2 : 0), z);
        d.rotation.set(0, u.heading + Math.PI / 2 + Math.sin(t * 1.3 + u.id) * 0.15, 0); d.scale.setScalar(u.kind === 'officiers' ? 1.6 : 1.4); d.updateMatrix();
        this.banners.setMatrixAt(bi, d.matrix); this.banners.setColorAt(bi++, this.flagCols[u.side]);
      }
      if (mounted && moving && dt > 0 && (st.dust -= dt) <= 0) {   // cavalry dust
        st.dust = 0.06; const k = Math.floor(Math.random() * u.n), x = st.px[k] - f.sh * 3, z = st.pz[k] - f.ch * 3;
        this.smoke.spawn({ x, y: this._h(x, z) + 0.8, z, size: 2.6, grow: 2.2, life: 1.7, color: COL.dust, alpha: 0.34, rise: 0.9 });
      }
      // ring around the block: gold = selected, blue = yours, red = the enemy's, grey = routed
      const sel = selected.has(u), cx = u.x + back / 2 * f.sh, cz = u.z + back / 2 * f.ch;
      const c = rout ? COL.rout : sel ? col.copy(COL.sel).multiplyScalar(0.85 + 0.15 * Math.sin(t * 5)) : u.side === 'enemy' ? COL.foe : COL.mine;
      const hw = (f.cols - 1) / 2 * f.sp + (mounted ? 5 : 3.5), hd = -back / 2 + (mounted ? 5 : 3.5);
      ring(cx, cz, u.heading, hw, hd, c);
      if (sel) ring(cx, cz, u.heading, hw + 1.6, hd + 1.6, c);   // selected: a double outline
    }
    for (const u of this._vs.keys()) if (!sim.units.some(v => v.id === u && sim.alive(v))) this._vs.delete(u);
    // march paths of the selected companies (gold dots to the destination, red toward a targeted company)
    const dot = (x, z, c, s) => { if (di >= MAX_DOTS) return; d.position.set(x, this._h(x, z) + 0.4, z); d.rotation.set(0, 0, 0); d.scale.setScalar(s); d.updateMatrix(); this.dots.setMatrixAt(di, d.matrix); this.dots.setColorAt(di++, c); };
    for (const u of selected) {
      if (!sim.alive(u) || u.state === 'rout') continue;
      const tgt = u.target && sim.alive(u.target) ? u.target : null, pts = tgt ? [{ x: tgt.x, z: tgt.z }] : u.path || [];
      if (!pts.length) continue;
      let px = u.x, pz = u.z, acc = -8 + ((t * 6) % 5);
      for (const p of pts) {
        const L = Math.hypot(p.x - px, p.z - pz);
        for (; acc < L; acc += 5) if (acc > 0) dot(px + (p.x - px) * acc / L, pz + (p.z - pz) * acc / L, tgt ? COL.attack : COL.move, 0.75);
        acc -= L; px = p.x; pz = p.z;
      }
      if (!tgt) ring(px, pz, 0, 3, 3, COL.move);
    }
    // order markers
    let mi = 0;
    this._orders = this._orders.filter(o => (o.t += dt) < 1.3);
    for (const o of this._orders) {
      if (o.target && sim.alive(o.target)) { o.x = o.target.x; o.z = o.target.z; }
      const k = o.t / 1.3, R = (o.target ? 14 : 9) * (1 - k * 0.7) + 2, s = (k < 0.75 ? 1.7 : 1.7 * (1 - k) / 0.25);
      for (let q = 0; q < 4; q++) {
        const a = q * Math.PI / 2 + Math.PI / 4 + k * 0.6, x = o.x + Math.cos(a) * R, z = o.z + Math.sin(a) * R;
        d.position.set(x, this._h(x, z) + 0.5, z); d.rotation.set(0, -a, 0); d.scale.setScalar(s); d.updateMatrix();
        this.marks.setMatrixAt(mi, d.matrix); this.marks.setColorAt(mi++, o.target ? COL.attack : COL.move);
      }
    }
    // the square: outline filling up clockwise while it is held, coloured by who stands in it
    const m = sim.map, inSq = s => sim.units.some(u => u.side === s && sim.alive(u) && u.state !== 'rout' && Math.hypot(u.x - m.town.x, u.z - m.town.z) < LAND.squareR);
    const P = inSq('player'), E = inSq('enemy'), frac = sim.over && sim.result?.winner === 'player' ? 1 : Math.min(1, sim.hold / LAND.holdTime);
    this.squareState = P && E ? 'contested' : P ? 'held' : E ? 'enemy' : 'free';
    const base = this.squareState === 'contested' ? col.copy(COL.contested).multiplyScalar(0.7 + 0.3 * Math.sin(t * 8)) : this.squareState === 'enemy' ? COL.enemyHeld : COL.free;
    for (let k = 0; k < SQUARE_DASHES; k++) {
      const a = Math.PI / 2 - (k + 0.5) / SQUARE_DASHES * Math.PI * 2, x = m.town.x + Math.cos(a) * LAND.squareR, z = m.town.z + Math.sin(a) * LAND.squareR;
      d.position.set(x, this._h(x, z) + 0.4, z); d.rotation.set(0, -a - Math.PI / 2, 0); d.scale.set(3.6, 1, k < frac * SQUARE_DASHES ? 1.9 : 1.1); d.updateMatrix();
      this.dashes.setMatrixAt(k, d.matrix); this.dashes.setColorAt(k, k < frac * SQUARE_DASHES ? COL.held : base);
    }
    for (const [im, n] of [[this.menBlade, cnt.b], [this.menGun, cnt.g], [this.menHorse, cnt.h], [this.banners, bi], [this.rings, ri], [this.dots, di], [this.marks, mi], [this.dashes, SQUARE_DASHES]]) {
      im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    // the flag over the square comes down while the square is held, the player's colours go up in its place
    const pole = this._pole, top = pole.y - 1.8, low = pole.y - 12, faction = frac >= 0.5 ? this.playerFaction : this.nation;
    if (faction !== this._sqFaction) { flagUV(this.sqFlag.geometry, faction); this._sqFaction = faction; }
    this.sqFlag.position.set(pole.x + 0.2, frac < 0.5 ? top - (top - low) * frac * 2 : low + (top - low) * (frac - 0.5) * 2, pole.z);
    waveCloth(this.sqFlag.geometry, t, 0.35); waveCloth(this.fortFlag.geometry, t + 1.7, 0.4);
    this.smoke.update(dt); this.flashes.update(dt);
  }

  render() {
    const g = this.game, r = g.renderer, c = this.cam, cam = this.camera, m = this.sim.map;
    const W = innerWidth, H = innerHeight; if (cam.aspect !== W / H) { cam.aspect = W / H; cam.updateProjectionMatrix(); }
    c.x = Math.max(-60, Math.min(m.W * m.cell + 60, c.x)); c.z = Math.max(-120, Math.min(m.H * m.cell + 40, c.z));
    c.dist = Math.max(90, Math.min(600, c.dist));
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
    this.smoke?.dispose(); this.flashes?.dispose();
    this.scene?.traverse(o => { if (o.isInstancedMesh) o.dispose?.(); if (o.isLight) o.dispose?.(); });
    this.scene = null;
  }
}

