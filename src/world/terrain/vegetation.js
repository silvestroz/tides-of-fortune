// Instanced vegetation & props: coconut palms (curved trunk + alpha fronds, wind sway), broadleaf canopy clumps,
// bushes, rocks, driftwood (direct light dimmed under drifting cloud shadows, like the terrain). Scattered once from the baked heightfield (deterministic), then streamed:
//   near set (< NEAR m from camera): detailed geometry, all instances, shadows
//   far set  (< FAR m): low-poly geometry, a thinned subset scaled up to keep coverage
// Exclusion zones (towns/forts) are registered via addExclusion({x,z,r}) or rect before scatter() runs.
import * as THREE from 'three';
import { mergeGeometries as _merge } from 'three/addons/utils/BufferGeometryUtils.js';
function mergeGeometries(list) {
  const ng = list.map(g => g.index ? g.toNonIndexed() : g);
  const keys = Object.keys(ng[0].attributes).filter(k => ng.every(g => g.attributes[k]));
  for (const g of ng) for (const k of Object.keys(g.attributes)) if (!keys.includes(k)) g.deleteAttribute(k);
  for (const g of ng) { g.morphAttributes = {}; if (!g.attributes.normal) g.computeVertexNormals(); }
  const m = _merge(ng);
  if (!m) { console.warn('vegetation: merge fallback'); return ng[0]; }
  return m;
}
import { mulberry32 } from '../../core/rng.js';
import { QUALITY } from '../../core/constants.js';
import { getFrondTexture, getDetailTexture } from './textures.js';
import { CLOUD_SHADOW, cloudShadowPars, cloudShadowApply } from '../sky/cloudShadow.js';

// LOD distances follow the quality tier; set by tierDistances() when Vegetation is built (QUALITY is applied by Game
// after the modules are imported, so module-level constants would always read the default tier)
let NEAR = 520;
// far-tier reach: beyond ~2.6 km a crown is a few px and the terrain's baked vegetation tint carries the island.
let FAR = 2600;
let MID = 1300;            // beyond this the far tier is thinned 3x more (scaled up to keep coverage)
let SHADOW_R = 150;        // only instances this close cast shadows (sun shadow frustum radius is ~90 m, 150 in ultra)
let NR_K = 1;              // near-geometry radius scale for trees / shrubs (ultra)
function tierDistances() {
  const v = QUALITY.vegetation ?? 1;
  NEAR = QUALITY.vegNear || 520;
  FAR = QUALITY.vegFar || (v < 0.5 ? 1700 : v < 0.8 ? 2200 : 2600);
  MID = QUALITY.vegMid || 1300;
  SHADOW_R = QUALITY.vegShadowR || 150;
  NR_K = NEAR / 520;
}
const KEEP_R = 90;         // always kept regardless of view direction (shadows/edges near camera)

// Jagged leaf-cluster card: several sub-clumps of pointed leaves with a hard, notched alpha edge and
// baked per-clump value (light upper-left rim, dark lower core) so crowns read as broken painterly masses.
let _clusterTex = null;
function getClusterTexture() {
  if (_clusterTex) return _clusterTex;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), rand = mulberry32(4242);
  const clumps = [[0.5, 0.42, 0.24]];
  for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + rand() * 0.6, d = 0.2 + rand() * 0.1; clumps.push([0.5 + Math.cos(a) * d, 0.48 + Math.sin(a) * d * 0.85, 0.1 + rand() * 0.07]); }
  const leaf = (x, y, L, W, rot, l) => {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.fillStyle = `rgb(${l * 0.9 | 0},${l | 0},${l * 0.72 | 0})`;
    g.beginPath(); g.moveTo(-L, 0); g.quadraticCurveTo(0, -W, L, 0); g.quadraticCurveTo(0, W, -L, 0); g.fill(); g.restore();
  };
  // dark under-layer first, then lit leaves on top, upper-left biased
  for (const pass of [0, 1]) for (const [cx, cy, r] of clumps) {
    const n = Math.round(r * S * (pass ? 2.2 : 1.4));
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * r * S * (pass ? 0.95 : 1.1);
      const x = cx * S + Math.cos(a) * rr, y = cy * S + Math.sin(a) * rr;
      // value: light toward the clump's upper-left rim, dark in the core / underside
      const lx = Math.cos(a) * rr / (r * S), ly = Math.sin(a) * rr / (r * S);
      const lit = Math.max(0, -0.55 * lx - 0.8 * ly) * (0.4 + 0.6 * rr / (r * S));
      const l = pass ? 95 + 150 * lit + rand() * 30 : 45 + rand() * 20;
      leaf(x, y, 6 + rand() * 6, 2.4 + rand() * 1.8, a + (rand() - 0.5) * 1.2, Math.min(255, l));
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
  return (_clusterTex = t);
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
const _c = new THREE.Color(), _dir = new THREE.Vector3();

// ---------- geometry builders ----------
function colorize(g, fn) {
  const p = g.attributes.position, n = p.count, c = new Float32Array(n * 3), w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = fn(p.getX(i), p.getY(i), p.getZ(i), i);
    c[i * 3] = r[0]; c[i * 3 + 1] = r[1]; c[i * 3 + 2] = r[2]; w[i] = r[3] ?? 0;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setAttribute('aSway', new THREE.BufferAttribute(w, 1));
  return g;
}
const lin = (hex) => { _c.set(hex); return [_c.r, _c.g, _c.b]; };

// curved trunk along a bezier, height H; returns { geo, top: Vector3 }
function palmTrunk(H, lean, segs, radial) {
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(lean * 0.25, H * 0.55, 0), new THREE.Vector3(lean, H, 0));
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  // taper + ring bumps
  const p = g.attributes.position, n = g.attributes.normal;
  const pts = curve.getSpacedPoints(segs);
  for (let i = 0; i < p.count; i++) {
    const ring = Math.floor(i / (radial + 1));
    const t = ring / segs;
    const c = pts[ring];
    const r = (0.36 - 0.14 * t) * (1 + 0.1 * Math.max(0, Math.sin(t * segs * Math.PI)));
    p.setXYZ(i, c.x + n.getX(i) * r, c.y + n.getY(i) * r, c.z + n.getZ(i) * r);
  }
  const bark = lin('#8b7355'), bark2 = lin('#5e4a36');
  colorize(g, (x, y, z, i) => {
    const ring = Math.floor(i / (radial + 1)), t = ring / segs;
    const band = (ring % 2) ? 1 : 0.78;
    const k = band * (0.8 + 0.2 * t);
    const c = (ring % 2) ? bark : bark2;
    return [c[0] * k, c[1] * k, c[2] * k, Math.pow(Math.max(0, y) / H, 2) * 0.6];
  });
  g.deleteAttribute('uv');
  return { geo: g, top: new THREE.Vector3(lean, H, 0) };
}

// one drooping frond as a curved strip (uv.x across, uv.y along)
function frond(len, width, droop, segs) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const x = t * len;
    const y = Math.sin(t * Math.PI * 0.55) * len * 0.28 - droop * t * t * len;
    const w = width * (0.35 + Math.sin(Math.min(1, t * 1.1 + 0.1) * Math.PI) * 0.65);
    // V-shaped cross section (leaflets fold down)
    pos.push(x, y + 0.02, 0, x, y - w * 0.3, -w, x, y - w * 0.3, w);
    uv.push(0.5, t, 0.0, t, 1.0, t);
    if (i < segs) {
      const a = i * 3;
      idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a, a + 2, a + 3, a + 2, a + 5, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function palmCrown(top, nFronds, len, rand, lowpoly) {
  const parts = [];
  for (let f = 0; f < nFronds; f++) {
    const g = frond(len * (0.8 + rand() * 0.35), len * 0.3, 0.6 + rand() * 0.45, lowpoly ? 4 : 8);
    const yaw = (f / nFronds) * Math.PI * 2 + rand() * 0.4;
    const pitch = (rand() - 0.3) * 0.5;
    g.rotateZ(pitch); g.rotateY(yaw);
    g.translate(top.x, top.y, top.z);
    parts.push(g);
  }
  // a couple of young upright fronds
  if (!lowpoly) for (let f = 0; f < 3; f++) {
    const g = frond(len * 0.6, len * 0.14, 0.05, 4);
    g.rotateZ(0.9 + rand() * 0.3); g.rotateY(rand() * Math.PI * 2); g.translate(top.x, top.y, top.z);
    parts.push(g);
  }
  const g = mergeGeometries(parts);
  const fr = lin('#86b444'), fb = lin('#2c4e1c');
  colorize(g, (x, y, z) => {
    const d = Math.hypot(x - top.x, z - top.z) / len;
    const t = Math.min(1, 0.15 + d * 1.1);
    return [fb[0] + (fr[0] - fb[0]) * t, fb[1] + (fr[1] - fb[1]) * t, fb[2] + (fr[2] - fb[2]) * t, 0.6 + d * 0.9];
  });
  return g;
}

function blob(radius, detail, rand, squash = 0.8, bump = 0.22) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  const ph = [rand() * 10, rand() * 10, rand() * 10];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * 1.3 / radius * 3 + ph[0]) * Math.sin(y * 1.7 / radius * 3 + ph[1]) * Math.sin(z * 1.1 / radius * 3 + ph[2]);
    const k = 1 + bump * n;
    p.setXYZ(i, x * k, y * k * squash, z * k);
  }
  return mergeVerticesSafe(g);
}
function mergeVerticesSafe(g) { g.deleteAttribute('uv'); return g; }

// broadleaf tree: short trunk + several canopy blobs; normals spherical from crown centre (soft painterly shading)
function broadleaf(rand, lowpoly) {
  const parts = [];
  const H = 3 + rand() * 1.5;
  const trunk = new THREE.CylinderGeometry(0.35, 0.6, H, lowpoly ? 3 : 6, 1);
  trunk.translate(0, H / 2 - 0.5, 0);
  trunk.deleteAttribute('uv');
  const tr = lin('#5a4632');
  colorize(trunk, () => [tr[0], tr[1], tr[2], 0]);
  parts.push(trunk);
  const crownC = new THREE.Vector3(0, H + 2.5, 0);
  const n = lowpoly ? 3 : 8;
  const leafA = lin('#5a8a34'), leafB = lin('#1e3e1a');
  const canopy = [];
  for (let i = 0; i < n; i++) {
    const r = (lowpoly ? 4.6 : 2.6) + rand() * (i === 0 ? 2.0 : 1.4);
    const g = blob(r, lowpoly ? 0 : 1, rand, 0.62 + rand() * 0.2, lowpoly ? 0.3 : 0.55);
    const a = i / n * Math.PI * 2 + rand() * 0.9, d = i === 0 ? 0 : 3.4 + rand() * 3.4;   // offset clumps -> broken silhouette
    g.translate(Math.cos(a) * d, H + 0.4 + rand() * 3.2 + (i === 0 ? 2.6 : 0) - d * 0.25, Math.sin(a) * d);
    canopy.push(g);
  }
  const cg = mergeGeometries(canopy);
  const p = cg.attributes.position, nn = cg.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    _p.set(p.getX(i), p.getY(i), p.getZ(i)).sub(crownC);
    _p.y *= 1.4; _p.normalize();
    // blend geometric normal with spherical normal
    const gx = nn.getX(i), gy = nn.getY(i), gz = nn.getZ(i);
    _s.set(gx * 0.35 + _p.x * 0.65, gy * 0.35 + _p.y * 0.65, gz * 0.35 + _p.z * 0.65).normalize();
    nn.setXYZ(i, _s.x, _s.y, _s.z);
  }
  colorize(cg, (x, y, z) => {
    // dark interior, light sunlit rim: height term x radial distance from crown centre
    const rr = Math.min(1, Math.hypot(x, (y - H - 2.5) * 0.8, z) / 7.5);
    const t = Math.min(1, Math.min(1, Math.max(0, (y - H) / 6)) * 0.55 + rr * rr * 0.6);
    const c = [leafB[0] + (leafA[0] - leafB[0]) * t, leafB[1] + (leafA[1] - leafB[1]) * t, leafB[2] + (leafA[2] - leafB[2]) * t];
    return [c[0], c[1], c[2], 0.25 + t * 0.25];
  });
  parts.push(cg);
  return mergeGeometries(parts);
}

function bush(rand, lowpoly) {
  const parts = [];
  for (let i = 0; i < (lowpoly ? 1 : 3); i++) {
    const g = blob(1.3 + rand() * 0.8, lowpoly ? 0 : 1, rand, 0.7, 0.3);
    g.translate((rand() - 0.5) * 2, 0.6, (rand() - 0.5) * 2);
    parts.push(g);
  }
  const g = mergeGeometries(parts);
  const a = lin('#4d7d2c'), b = lin('#36602a');
  colorize(g, (x, y) => { const t = Math.min(1, Math.max(0, y / 2)); return [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t, b[2] + (a[2] - b[2]) * t, 0.12 * t]; });
  return g;
}

function rock(rand, lowpoly) {
  const g = new THREE.DodecahedronGeometry(1, lowpoly ? 0 : 1);
  const p = g.attributes.position;
  const ph = [rand() * 10, rand() * 10];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.18 * Math.sin(x * 3 + ph[0]) * Math.cos(z * 2.6 + ph[1]);
    p.setXYZ(i, x * k * 1.2, y * k * 0.7, z * k);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const a = lin('#9a9086'), b = lin('#6a625a');
  colorize(g, (x, y) => { const t = Math.min(1, Math.max(0, y * 0.6 + 0.5)); return [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t, b[2] + (a[2] - b[2]) * t, 0]; });
  return g;
}

function driftwood() {
  const g = new THREE.CylinderGeometry(0.18, 0.26, 4.5, 5, 1);
  g.rotateZ(Math.PI / 2);
  const br = new THREE.CylinderGeometry(0.08, 0.14, 1.6, 4, 1);
  br.rotateZ(0.9); br.translate(1.2, 0.4, 0.2);
  const m = mergeGeometries([g.toNonIndexed(), br.toNonIndexed()]);
  m.deleteAttribute('uv');
  const c = lin('#b9ab92');
  colorize(m, () => [c[0], c[1], c[2], 0]);
  return m;
}

// leaf-card canopy: short trunk + branches, each ending in a cluster of crossed alpha cards (leaf texture)
function cardTree(rand, lowpoly) {
  const H = 4 + rand() * 2;
  const wood = [], cards = [];
  const tr = new THREE.CylinderGeometry(0.3, 0.55, H, lowpoly ? 4 : 6, 1); tr.translate(0, H / 2 - 0.4, 0); tr.deleteAttribute('uv');
  wood.push(tr);
  const nC = lowpoly ? 5 : 9;
  for (let i = 0; i < nC; i++) {
    const a = rand() * Math.PI * 2, d = i === 0 ? 0 : 2.2 + rand() * 3.0;
    const cy = H + 1 + rand() * 2.4 + (i === 0 ? 2.2 : 0) - d * 0.2;
    const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
    if (i && !lowpoly) { const br = new THREE.CylinderGeometry(0.08, 0.16, d + 0.6, 4, 1); br.deleteAttribute('uv'); br.translate(0, (d + 0.6) / 2, 0); br.rotateZ(-Math.PI / 2 + 0.6); br.rotateY(-a); br.translate(0, H - 0.6, 0); wood.push(br); }
    const r = (lowpoly ? 3.8 : 3.0) + rand() * 1.6;
    const nk = lowpoly ? 2 : 3;
    for (let k = 0; k < nk; k++) {
      const q = new THREE.PlaneGeometry(r * 2.1, r * 1.5);
      q.rotateY(k / nk * Math.PI + rand() * 0.4); q.rotateX((rand() - 0.5) * 0.5);
      q.translate(cx, cy, cz); cards.push(q);
    }
    const top = new THREE.PlaneGeometry(r * 2, r * 2); top.rotateX(-Math.PI / 2 + (rand() - 0.5) * 0.4); top.translate(cx, cy + r * 0.25, cz); cards.push(top);
  }
  const wg = mergeGeometries(wood); const bark = lin('#4e3c2a');
  colorize(wg, (x, y) => [bark[0], bark[1], bark[2], Math.max(0, y - H * 0.5) * 0.04]);
  const cg = mergeGeometries(cards);
  // spherical normals from crown centre for soft painterly light
  const C = new THREE.Vector3(0, H + 2.2, 0), p = cg.attributes.position, nn = cg.attributes.normal;
  for (let i = 0; i < p.count; i++) { _p.set(p.getX(i), p.getY(i), p.getZ(i)).sub(C); _p.y *= 1.3; _p.normalize(); nn.setXYZ(i, _p.x, _p.y, _p.z); }
  const A = lin('#b8dc6a'), B = lin('#1f3d18');
  colorize(cg, (x, y, z) => { const rr = Math.min(1, Math.hypot(x, z) / 6.5); const t = Math.min(1, Math.max(0, (y - H) / 5) * 0.7 + rr * rr * 0.45); return [B[0] + (A[0] - B[0]) * t, B[1] + (A[1] - B[1]) * t, B[2] + (A[2] - B[2]) * t, 0.3 + t * 0.3]; });
  return { wood: wg, leaves: cg };
}

// banana: short pseudostem with a few huge paddle leaves (frond texture reused)
function banana(rand) {
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const g = frond(2.8 + rand(), 0.75, 0.25 + rand() * 0.2, 5);
    g.rotateZ(0.5 + rand() * 0.4); g.rotateY(i / 7 * Math.PI * 2 + rand() * 0.5); g.translate(0, 2.6, 0); parts.push(g);
  }
  const g = mergeGeometries(parts); const c = lin('#7fb04a');
  colorize(g, (x, y) => [c[0], c[1], c[2], 0.5 + Math.max(0, y - 2.6) * 0.2]);
  const st = new THREE.CylinderGeometry(0.18, 0.25, 2.8, 5, 1); st.translate(0, 1.3, 0); st.deleteAttribute('uv');
  const sc = lin('#6a7a3a'); colorize(st, () => [sc[0], sc[1], sc[2], 0]);
  return { stem: st, leaves: g };
}

// mangrove: arched prop roots + low dense card crown
function mangrove(rand) {
  const roots = [];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + rand() * 0.3, R = 1.6 + rand() * 1.2;
    const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 2.2, 0), new THREE.Vector3(Math.cos(a) * R * 0.6, 2.6, Math.sin(a) * R * 0.6), new THREE.Vector3(Math.cos(a) * R, -0.6, Math.sin(a) * R));
    const t = new THREE.TubeGeometry(c, 5, 0.07, 4); t.deleteAttribute('uv'); roots.push(t);
  }
  const tr = new THREE.CylinderGeometry(0.15, 0.22, 2.4, 5); tr.translate(0, 3.2, 0); tr.deleteAttribute('uv'); roots.push(tr);
  const wg = mergeGeometries(roots); const b = lin('#5a4a3a'); colorize(wg, () => [b[0], b[1], b[2], 0]);
  const ct = cardTree(rand, false); ct.leaves.scale(0.8, 0.55, 0.8); ct.leaves.translate(0, -0.2, 0);
  return { wood: wg, leaves: ct.leaves };
}

function pebbles(rand) {
  const parts = [];
  for (let i = 0; i < 9; i++) { const g = new THREE.IcosahedronGeometry(0.12 + rand() * 0.18, 0); g.scale(1.3, 0.55, 1); g.translate((rand() - 0.5) * 3, 0.03, (rand() - 0.5) * 3); g.deleteAttribute('uv'); parts.push(g); }
  const g = mergeGeometries(parts); const a = lin('#a89e90');
  colorize(g, (x, y, z, i) => { const k = 0.7 + ((i * 7) % 5) * 0.1; return [a[0] * k, a[1] * k, a[2] * k, 0]; });
  return g;
}
function grassTuft(rand) {
  const parts = [];
  for (let i = 0; i < 6; i++) { const q = new THREE.PlaneGeometry(0.9, 0.9); q.translate(0, 0.45, 0); q.rotateY(i / 6 * Math.PI + rand()); q.rotateX((rand() - 0.5) * 0.3); q.translate((rand() - 0.5) * 0.8, 0, (rand() - 0.5) * 0.8); parts.push(q); }
  const g = mergeGeometries(parts); const a = lin('#9aae5a'), b = lin('#5e7a34');
  colorize(g, (x, y) => { const t = Math.min(1, y / 0.9); return [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t, b[2] + (a[2] - b[2]) * t, y * 0.6]; });
  return g;
}

// ---------- materials ----------
function vegMaterial({ map = null, alphaTest = 0, side = THREE.FrontSide, swayAmp = 1, translucency = 0 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, map, alphaTest, side, alphaToCoverage: !!map });
  const u = { uLeaf: { value: translucency > 0.3 && !map ? 1 : 0 }, uDay: { value: 1 }, uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.7, 0.7) }, uDetail: { value: getDetailTexture() } };
  mat.userData.uniforms = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, CLOUD_SHADOW.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform vec2 uWind;
        attribute float aSway;
        varying vec3 vVWorld; varying float vSway;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 ip = instanceMatrix[3].xyz;
          float ph = dot(ip.xz, vec2(0.071, 0.113));
          float s = aSway * ${swayAmp.toFixed(2)};
          float w = sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7 + transformed.x * 0.4) * 0.25 + 0.45;
          transformed.x += uWind.x * w * s * 0.35;
          transformed.z += uWind.y * w * s * 0.35;
          transformed.y += sin(uTime * 3.1 + ph + transformed.x * 0.8) * s * 0.07;
          vSway = aSway;
        }`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vVWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uDetail; uniform float uDay; uniform float uLeaf; varying vec3 vVWorld; varying float vSway;
        ${cloudShadowPars}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        ${cloudShadowApply('vVWorld')}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vegMoon;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 vegMoon;
        {
          vec4 d1 = texture2D(uDetail, vVWorld.xz * 0.013 + vVWorld.y * 0.01);
          vec4 d2 = texture2D(uDetail, vVWorld.xz * 0.09 + vVWorld.y * 0.05);
          diffuseColor.rgb *= 0.78 + 0.34 * d1.g + 0.16 * (d2.b - 0.5);
          if (uLeaf > 0.5) {
            // leaf-cluster breakup: cellular clumps with dark gaps + light leaf tips + per-tree hue
            vec4 c1 = texture2D(uDetail, vVWorld.xz * 0.11 + vVWorld.y * 0.09);
            vec4 c2 = texture2D(uDetail, vVWorld.zy * 0.23 + vVWorld.x * 0.05);
            float clump = c1.b * 0.6 + c2.b * 0.4;
            diffuseColor.rgb *= mix(0.45, 1.25, smoothstep(0.15, 0.75, clump));
            diffuseColor.rgb += vec3(0.05, 0.07, 0.0) * smoothstep(0.75, 0.95, c2.a);
          }
          vegMoon = diffuseColor.rgb * vec3(0.06, 0.09, 0.16) * (1.0 - uDay);
        }`);
    if (translucency > 0) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
        outgoingLight += uDay * diffuseColor.rgb * ${translucency.toFixed(2)} * vec3(0.9, 1.0, 0.5) * 0.25;
        #include <opaque_fragment>`);
    }
  };
  mat.customProgramCacheKey = () => 'veg3-' + (map ? 'm' : '') + alphaTest + side + swayAmp + translucency;
  return mat;
}

// ---------- Vegetation system ----------
export class Vegetation {
  constructor(game, islands) {
    tierDistances();
    this.game = game; this.islands = islands;
    this.exclusions = [];
    for (const p of islands.ports) {
      this.exclusions.push({ x: p.quay.x - p.seaward.x * p.extent.depth * 0.45, z: p.quay.z - p.seaward.z * p.extent.depth * 0.45, r: Math.max(p.extent.hw, p.extent.depth * 0.55) + 20 });
      this.exclusions.push({ x: p.fort.x, z: p.fort.z, r: 70 });
    }
    for (const v of islands.villages || []) this.exclusions.push({ x: v.quay.x - v.seaward.x * 45, z: v.quay.z - v.seaward.z * 45, r: 82 });   // fishing villages
    this.types = [];
    const rand = mulberry32(1234);
    this.frondMat = vegMaterial({ map: getFrondTexture(), alphaTest: 0.45, side: THREE.DoubleSide, swayAmp: 1.4, translucency: 1 });
    this.solidMat = vegMaterial({ swayAmp: 1 });
    this.canopyMat = vegMaterial({ swayAmp: 0.6, translucency: 0.5 });
    // palm variants: (trunk, crown) pairs; near & far
    const palmNear = [], palmFar = [];
    for (let v = 0; v < 3; v++) {
      const H = 9 + v * 2.5, lean = 1.6 + v * 1.4;
      const t = palmTrunk(H, lean, 10, 7), tf = palmTrunk(H, lean, 3, 4);
      palmNear.push({ trunk: t.geo, crown: palmCrown(t.top, 14, 5.4, mulberry32(v + 7), false) });
      palmFar.push({ trunk: tf.geo, crown: palmCrown(tf.top, 11, 6.2, mulberry32(v + 7), true) });
    }
    this.palmNear = palmNear; this.palmFar = palmFar;
    this.leafMat = vegMaterial({ map: getClusterTexture(), alphaTest: 0.5, side: THREE.DoubleSide, swayAmp: 0.5, translucency: 0.8 });
    const umb = (r, lp) => { const t = cardTree(r, lp); t.leaves.scale(1.35, 0.45, 1.35); t.leaves.translate(0, 4.5, 0); t.wood.scale(1, 1.9, 1); return t; };
    const tall = (r, lp) => { const t = cardTree(r, lp); t.leaves.scale(0.7, 1.5, 0.7); t.leaves.translate(0, 1.0, 0); t.wood.scale(0.8, 1.5, 0.8); return t; };
    this.cardNear = [cardTree(mulberry32(31), false), umb(mulberry32(33), false), tall(mulberry32(34), false)];
    this.cardFar = [cardTree(mulberry32(31), true), umb(mulberry32(33), true), tall(mulberry32(34), true)];
    this.banana = banana(mulberry32(61)); this.mangrove = mangrove(mulberry32(71));
    this.pebbles = pebbles(mulberry32(81)); this.tuft = grassTuft(mulberry32(91));
    this.treeNear = [broadleaf(mulberry32(31), false), broadleaf(mulberry32(32), false)];
    this.treeFar = [broadleaf(mulberry32(31), true), broadleaf(mulberry32(32), true)];
    this.bushNear = bush(mulberry32(41), false); this.bushFar = bush(mulberry32(41), true);
    this.rockNear = rock(mulberry32(51), false); this.rockFar = rock(mulberry32(51), true);
    this.drift = driftwood();
    void rand;
    this._scatter();
    this._buildMeshes();
    this._camPrev = new THREE.Vector3(1e9, 0, 0);
  }

  excluded(x, z) {
    for (const e of this.exclusions) if ((x - e.x) ** 2 + (z - e.z) ** 2 < e.r * e.r) return true;
    return false;
  }

  _scatter() {
    const sh = this.islands.shape;
    // instance records: Float32Array [x, y, z, rotY, scale, tilt, tint, variant]
    const recs = { palm: [], tree: [], bush: [], rock: [], drift: [], banana: [], mangrove: [], pebble: [], tuft: [], seagrape: [] };
    for (const t of sh.tiles) {
      const isl = t.isl;
      const rand = mulberry32(isl.index * 7919 + 17);
      const step = QUALITY.vegStep || 10;    // jitter grid spacing in metres (ultra 8: 1.56x denser)
      const nI = Math.floor((t.x1 - t.x0) / step), nJ = Math.floor((t.z1 - t.z0) / step);
      const palmBias = isl.type === 'cay' || isl.type === 'atoll' || isl.type === 'flat' ? 1.6 : 1;
      for (let j = 0; j < nJ; j++) for (let i = 0; i < nI; i++) {
        const x = t.x0 + (i + rand()) * step, z = t.z0 + (j + rand()) * step;
        const r0 = rand();
        if ((QUALITY.vegetation ?? 1) < 1 && ((Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) >>> 0) % 1000 >= QUALITY.vegetation * 1000) continue;   // quality tier thinning
        // quick reject using the tile directly
        const fx = Math.round((x - t.x0) / t.cell), fz = Math.round((z - t.z0) / t.cell);
        const k = fz * t.nx + fx;
        if (!t.owner[k]) continue;
        const h0 = t.h[k];
        if (h0 < -0.4) continue;
        const h = sh.sampleTile(t, x, z);
        const e = 2.5;
        const gx = (sh.sampleTile(t, x + e, z) - sh.sampleTile(t, x - e, z)) / (2 * e);
        const gz = (sh.sampleTile(t, x, z + e) - sh.sampleTile(t, x, z - e)) / (2 * e);
        const slope = Math.hypot(gx, gz);
        if (this.excluded(x, z)) {
          continue;
        }
        // bare sea stacks (world.js `bare`): a few fallen boulders at the foot of the cliffs, nothing grows
        if (isl.bare) {
          if (h > -0.3 && h < 4 && slope > 0.2 && r0 < 0.07) recs.rock.push([x, h - 0.4, z, rand() * 6.28, 0.8 + rand() * rand() * 3.2, rand() * 0.4, rand(), 0]);
          continue;
        }
        const n = sh.n3(x / 700 + 11, z / 700 - 4);
        const moist = Math.min(1, Math.max(0, isl.moist + 0.28 * n));
        const patch = sh.n2(x / 160 + isl.index, z / 160) * 0.5 + 0.5;  // clumping
        const beachTop = 2.2 + 1.4 * (1 - moist);
        // rocks: shore boulders and steep slopes
        if ((slope > 0.75 && r0 < 0.05) || (h > -0.3 && h < 1.2 && slope > 0.25 && r0 < 0.06)) {
          recs.rock.push([x, h - 0.4, z, rand() * 6.28, 0.8 + rand() * rand() * 3.2, rand() * 0.4, rand(), 0]);
          continue;
        }
        // mangroves: sheltered muddy fringe on moist islands, just at the waterline
        if (h > -0.4 && h < 0.9 && slope < 0.12 && isl.moist > 0.7 && patch > 0.72 && sh.n4(x / 260, z / 260) > 0.35 && r0 < 0.3) {
          recs.mangrove.push([x, Math.min(h, 0.2), z, rand() * 6.28, 0.8 + rand() * 0.5, 0, rand(), 0]); continue;
        }
        if (h < 0.6) {
          if (h > 0.1 && r0 < 0.05) recs.pebble.push([x, h, z, rand() * 6.28, 0.8 + rand() * 0.6, 0, rand(), 0]);
          continue;
        }
        // beach dressing: pebbles, grass tufts, sea-grape shrubs at the back of the beach
        if (h < beachTop + 1.2 && slope < 0.3) {
          const r1 = rand();
          if (r1 < 0.05) recs.pebble.push([x, h, z, rand() * 6.28, 0.8 + rand() * 0.6, 0, rand(), 0]);
          else if (h > beachTop - 0.8 && r1 < 0.32) recs.tuft.push([x + (rand() - 0.5) * 4, h - 0.05, z + (rand() - 0.5) * 4, rand() * 6.28, 0.8 + rand() * 0.8, 0, rand(), 0]);
          else if (h > beachTop - 0.3 && r1 < 0.4) recs.seagrape.push([x, h - 0.2, z, rand() * 6.28, 0.6 + rand() * 0.5, 0, rand(), 0]);
        }
        // driftwood on the dry beach
        if (h < beachTop && slope < 0.15 && r0 < 0.012) {
          recs.drift.push([x, h + 0.1, z, rand() * 6.28, 0.8 + rand() * 0.5, 0, rand(), 0]); continue;
        }
        if (slope > 1.3) continue;
        // palms: beach fringe & lowlands, clumped
        const palmZone = Math.max(0, 1 - Math.abs(h - (beachTop + 3)) / 9) * palmBias;
        const palmP = palmZone * (0.12 + 0.5 * patch) * (1 - Math.min(1, slope * 1.4)) * (isl.dry > 0.5 ? 0.35 : 1);
        if (r0 < palmP * (h < beachTop + 4 ? 1.25 : 0.75) && h > beachTop - 0.9) {
          // lean toward the sea: downhill direction
          const lean = Math.atan2(-gz, -gx);
          recs.palm.push([x, h - 0.2, z, -lean + (rand() - 0.5) * 1.2, 1.0 + rand() * 0.5, 0, rand(), Math.floor(rand() * 3)]);
          continue;
        }
        if (h < beachTop + 0.8) continue;
        // broadleaf jungle: moist interior, denser in valleys
        const jungleP = (isl.dry > 0.5 ? 0.06 : 0.6) * Math.min(1, moist * 1.15) * (0.45 + 0.75 * patch) * (1 - Math.min(0.85, slope * 0.55)) * Math.min(1, (h - beachTop) / 8);
        if (r0 < jungleP * 0.55 * (0.4 + patch)) {
          const nC = 1 + Math.floor(rand() * 3);
          for (let c = 0; c < nC; c++) {
            const ox = c ? x + (rand() - 0.5) * 9 : x, oz = c ? z + (rand() - 0.5) * 9 : z;
            const oh = c ? sh.sampleTile(t, ox, oz) : h;
            if (oh < beachTop || this.excluded(ox, oz)) continue;
            { const vv = rand(); recs.tree.push([ox, oh - 0.8, oz, rand() * 6.28, 0.6 + rand() * 0.8, (rand() - 0.5) * 0.12, rand(), vv < 0.5 ? 0 : vv < 0.78 ? 1 : 2]); }
          }
          continue;
        }
        if (r0 > 0.9 && moist > 0.7 && h < beachTop + 30 && rand() < 0.25) { recs.banana.push([x, h - 0.1, z, rand() * 6.28, 0.8 + rand() * 0.5, 0, rand(), 0]); continue; }
        if (r0 < 0.62 && rand() < (isl.dry > 0.5 ? 0.25 : 0.12)) {
          recs.bush.push([x, h - 0.3, z, rand() * 6.28, 0.7 + rand() * 0.9, 0, rand(), 0]);
        }
      }
    }
    // pack to Float32Arrays and bucket into a coarse grid for fast range queries
    this.sets = {};
    for (const [name, list] of Object.entries(recs)) {
      const a = new Float32Array(list.length * 8);
      list.forEach((r, i) => a.set(r, i * 8));
      this.sets[name] = a;
    }
    this.counts = Object.fromEntries(Object.entries(recs).map(([k, v]) => [k, v.length]));
  }

  _mk(geo, mat, count, shadow) {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    m.count = 0; m.frustumCulled = false;
    m.castShadow = shadow; m.receiveShadow = true;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.game.scene.add(m);
    return m;
  }

  _buildMeshes() {
    const c = this.counts;
    // per variant meshes, capacity = total of that kind (cheap: matrices only)
    this.meshes = [];
    const add = (kind, variant, geoNear, geoFar, mat, farThin, farScale, shadow = true) => {
      const cap = Math.min(c[kind], 4000);
      const near = this._mk(geoNear, mat, cap, false);
      const close = shadow ? this._mk(geoNear, mat, cap, true) : null;   // shadow-casting subset of the near tier
      const far = geoFar ? this._mk(geoFar, mat, Math.min(14000, Math.ceil(c[kind] / farThin) + 4), false) : null;
      this.meshes.push({ kind, variant, near, close, far, farThin, farScale });
    };
    for (let v = 0; v < 3; v++) {
      add('palm', v, this.palmNear[v].trunk, this.palmFar[v].trunk, this.solidMat, 2, 1.25);
      add('palm', v, this.palmNear[v].crown, this.palmFar[v].crown, this.frondMat, 2, 1.25);
    }
    for (let v = 0; v < 3; v++) {
      add('tree', v, this.cardNear[v].wood, this.cardFar[v].wood, this.solidMat, 2, 1.45, false);
      add('tree', v, this.cardNear[v].leaves, this.cardFar[v].leaves, this.leafMat, 2, 1.45, true);
    }
    add('banana', 0, this.banana.stem, null, this.solidMat, 1, 1);
    add('banana', 0, this.banana.leaves, null, this.frondMat, 1, 1);
    add('mangrove', 0, this.mangrove.wood, null, this.solidMat, 1, 1, false);
    add('mangrove', 0, this.mangrove.leaves, this.cardFar[0].leaves, this.leafMat, 2, 0.8);
    add('pebble', 0, this.pebbles, null, this.solidMat, 1, 1, false);
    add('tuft', 0, this.tuft, null, this.frondMat, 1, 1, false);
    add('seagrape', 0, this.bushNear, null, this.leafMat, 1, 1);
    add('bush', 0, this.bushNear, null, this.solidMat, 1, 1);
    add('rock', 0, this.rockNear, this.rockFar, this.solidMat, 3, 1.3);
    add('drift', 0, this.drift, null, this.solidMat, 1, 1);
  }

  // extra instance records added after the scatter (palms & shrubs planted inside port towns by src/world/towns/towns.js).
  // rec = [x, y, z, rotY, scale, tilt, tint, variant]; rebuilds the instanced meshes once (startup only).
  addInstances(byKind) {
    let any = false;
    for (const [kind, list] of Object.entries(byKind)) {
      if (!list.length || !this.sets[kind]) continue;
      const a = new Float32Array(this.sets[kind].length + list.length * 8);
      a.set(this.sets[kind]); list.forEach((r, i) => a.set(r, this.sets[kind].length + i * 8));
      this.sets[kind] = a; this.counts[kind] = a.length / 8; any = true;
    }
    if (!any) return;
    for (const M of this.meshes) for (const m of [M.near, M.close, M.far]) if (m) { this.game.scene.remove(m); m.dispose(); }
    this._buildMeshes();
    this._camPrev.set(1e9, 0, 0);
  }

  update(dt, t, force) {
    for (const m of [this.frondMat, this.solidMat, this.canopyMat, this.leafMat]) {
      m.userData.uniforms.uTime.value = t;
      { const h = this.game.sky?.timeOfDay ?? 12; m.userData.uniforms.uDay.value = Math.min(1, Math.max(0, Math.min(h - 6, 19 - h) / 1.2)); }
      const w = this.game.wind;
      if (w) m.userData.uniforms.uWind.value.set(Math.sin(w.angle), -Math.cos(w.angle)).multiplyScalar(Math.min(1.6, w.speed / 8));
    }
    const camO = this.game.camera, cam = camO.position;
    camO.getWorldDirection(_dir);
    const yaw = Math.atan2(_dir.x, _dir.z), pitch = _dir.y;
    let dy = Math.abs(yaw - (this._yawPrev ?? 1e9)); if (dy > Math.PI) dy = Math.PI * 2 - dy;
    if (!force && cam.distanceToSquared(this._camPrev) < 60 * 60 && dy < 0.17 && Math.abs(pitch - (this._pitchPrev ?? 9)) < 0.15) return;
    this._camPrev.copy(cam); this._yawPrev = yaw; this._pitchPrev = pitch;
    const far2 = FAR * FAR, mid2 = MID * MID, sh2 = SHADOW_R * SHADOW_R, keep2 = KEEP_R * KEEP_R;
    // horizontal view wedge (half horizontal FOV + margin for the update hysteresis); disabled when looking steeply down
    const hfov = Math.atan(Math.tan((camO.fov ?? 60) * Math.PI / 360) * (camO.aspect ?? 1.8));
    const hl = Math.hypot(_dir.x, _dir.z) || 1, fx = _dir.x / hl, fz = _dir.z / hl;
    const wedge = pitch > -0.8, cosW = Math.cos(Math.min(Math.PI, hfov + 0.3 + Math.max(0, -pitch) * 0.9));
    for (const M of this.meshes) {
      const NR = M.kind === 'tree' ? 380 * NR_K : M.kind === 'palm' ? NEAR : (M.kind === 'pebble' || M.kind === 'tuft') ? 160 * NR_K : 300 * NR_K;
      const near2 = NR * NR, nearBand2 = (NR - 40) ** 2;
      const cap = M.kind === 'tree' ? 1500 : 3000;
      const farCap = M.kind === 'tree' ? 14000 : 5000;
      const a = this.sets[M.kind];
      let nn = 0, nf = 0, nc = 0;
      const n = a.length / 8;
      for (let i = 0; i < n; i++) {
        const o = i * 8;
        if ((M.kind === 'palm' || M.kind === 'tree') && a[o + 7] !== M.variant) continue;
        const dx = a[o] - cam.x, dz = a[o + 2] - cam.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > far2 && d2 > near2) continue;
        if (wedge && d2 > keep2 && (dx * fx + dz * fz) < cosW * Math.sqrt(d2)) continue;
        const tint = a[o + 6];
        if (d2 < near2) {
          const tgt = M.close && d2 < sh2 ? M.close : M.near;
          const k = tgt === M.near ? nn : nc;
          if (k < cap) {
            this._compose(a, o, 1);
            tgt.setMatrixAt(k, _m); tgt.setColorAt(k, this._tint(M.kind, tint));
            if (tgt === M.near) nn++; else nc++;
          }
        }
        const fThin = d2 > mid2 ? M.farThin * 3 : M.farThin;
        if (M.far && nf < farCap && d2 > nearBand2 && d2 < far2 && (i % fThin) === 0) {
          this._compose(a, o, M.farScale * (d2 > mid2 ? 1.35 : 1));
          M.far.setMatrixAt(nf, _m);
          M.far.setColorAt(nf, this._tint(M.kind, tint));
          nf++;
        }
      }
      for (const [mm, cnt] of [[M.near, nn], [M.close, nc]]) if (mm) { mm.count = cnt; mm.instanceMatrix.needsUpdate = true; if (mm.instanceColor) mm.instanceColor.needsUpdate = true; }
      if (M.far) { M.far.count = nf; M.far.instanceMatrix.needsUpdate = true; if (M.far.instanceColor) M.far.instanceColor.needsUpdate = true; }
    }
  }

  _tint(kind, t) {
    if (kind === 'tree' || kind === 'mangrove') return t < 0.15 ? _c.setRGB(1.25, 1.05, 0.55) : _c.setRGB(0.75 + t * 0.5, 0.82 + t * 0.35, 0.65 + t * 0.4);
    if (kind === 'seagrape') return _c.setRGB(0.95 + t * 0.2, 1.0, 0.6);
    if (kind === 'palm') return _c.setRGB(0.9 + t * 0.2, 0.92 + t * 0.15, 0.85 + t * 0.2);
    if (kind === 'rock') return _c.setRGB(0.85 + t * 0.3, 0.83 + t * 0.3, 0.8 + t * 0.3);
    return _c.setRGB(0.85 + t * 0.3, 0.9 + t * 0.2, 0.85 + t * 0.2);
  }

  _compose(a, o, sMul) {
    _p.set(a[o], a[o + 1], a[o + 2]);
    _e.set(a[o + 5], a[o + 3], 0, 'YXZ');
    _q.setFromEuler(_e);
    const s = a[o + 4] * sMul;
    _s.set(s, s, s);
    _m.compose(_p, _q, _s);
  }
}
