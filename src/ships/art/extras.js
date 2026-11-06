// Flags (ensign / jack / masthead pennants) geometry, crew figure geometry + crew material, lantern glow sprites.
import * as THREE from 'three';
import { GLOBAL } from './materials.js';

// ---------------------------------------------------------------- flags
// hoists: [{ pos: Vector3, kind: 0 ensign | 1 pennant | 2 jack, L, H }]
export function buildFlagGeometry(hoists) {
  const pos = [], uv = [], aFlag = [], aKind = [], idx = [];
  let n = 0;
  for (const h of hoists) {
    const NU = h.kind === 1 ? 12 : 14, NV = h.kind === 1 ? 1 : 6;
    const base = n;
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
      const u = i / NU, v = j / NV;
      pos.push(h.pos.x, h.pos.y, h.pos.z);
      let Hh = h.H, vv = v;
      if (h.kind === 1) { Hh = h.H * (1 - 0.88 * u); }
      aFlag.push(u, vv, h.L, Hh);
      aKind.push(h.kind === 1 ? 1 : 0);
      if (h.kind === 1) uv.push(u, 0.296 - v * 0.29);
      else uv.push(u, 1 - v * 0.655);
      n++;
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const a = base + j * (NU + 1) + i, b = a + 1, c = a + NU + 2, d = a + NU + 1;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(0).map((_, i) => (i % 3 === 0 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFlag', new THREE.Float32BufferAttribute(aFlag, 4));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(aKind, 1));
  g.setIndex(idx);
  g.computeBoundingSphere(); g.boundingSphere.radius += 12;
  return g;
}

// ---------------------------------------------------------------- crew
// One merged low-poly sailor (1.75 m). Attribute aPart: 0 skin, 1 shirt (tinted by instance colour), 2 trousers, 3 hat/hair, 4 boots / belt, 5 hat brim (some)
let _crewGeo = null;
export function getCrewGeometry() {
  if (_crewGeo) return _crewGeo;
  const parts = [];
  const add = (geo, m, part, color) => {
    geo = geo.toNonIndexed(); geo.applyMatrix4(m);
    const n = geo.attributes.position.count;
    const c = new THREE.Color(color);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [c.r, c.g, c.b]), 3));
    geo.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(n).fill(part), 1));
    geo.deleteAttribute('uv');
    parts.push(geo);
  };
  const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  // a sturdier sailor that reads at 30–70 m — tapered legs in trousers, shoes, a V torso with
  // shoulder caps, arms bent at the elbow, a sash belt, a head with a nose and a cap; part 5 = a hat brim shown on
  // some sailors only (collapsed in the vertex shader from the instance colour), so a crew is not a row of clones
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.095, 0.068, 0.46, 8), M(s * 0.105, 0.68, 0, 0, 0, s * 0.04), 2, '#4a3f33');   // thigh
    add(new THREE.CylinderGeometry(0.068, 0.058, 0.42, 8), M(s * 0.115, 0.27, 0.01, 0.04, 0, s * 0.02), 2, '#4a3f33'); // shin
    add(new THREE.BoxGeometry(0.11, 0.08, 0.25), M(s * 0.12, 0.04, -0.035), 4, '#1c1410');
  }
  add(new THREE.CylinderGeometry(0.215, 0.165, 0.58, 12), M(0, 1.2, 0, 0, 0, 0, 1, 1, 0.68), 1, '#ffffff');   // shirt torso (tinted)
  add(new THREE.SphereGeometry(0.17, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), M(0, 1.47, 0, 0, 0, 0, 1.08, 0.5, 0.7), 1, '#ffffff');   // shoulders top
  add(new THREE.CylinderGeometry(0.172, 0.172, 0.09, 12), M(0, 0.9, 0, 0, 0, 0, 1, 1, 0.74), 4, '#6e1a14');     // sash belt
  add(new THREE.CylinderGeometry(0.17, 0.15, 0.14, 12), M(0, 0.84, 0, 0, 0, 0, 1, 1, 0.74), 2, '#4a3f33');     // trouser seat
  for (const s of [-1, 1]) {
    add(new THREE.SphereGeometry(0.075, 8, 6), M(s * 0.23, 1.43, 0, 0, 0, 0, 1.05, 0.9, 1), 1, '#ffffff');    // shoulder cap
    add(new THREE.CylinderGeometry(0.068, 0.058, 0.3, 7), M(s * 0.265, 1.27, 0.0, 0.08, 0, s * 0.14), 1, '#ffffff');   // upper arm
    add(new THREE.CylinderGeometry(0.052, 0.044, 0.28, 7), M(s * 0.29, 1.0, 0.07, 0.55, 0, s * 0.08), 0, '#c58e62');   // bare forearm (rolled sleeve)
    add(new THREE.SphereGeometry(0.058, 7, 5), M(s * 0.3, 0.86, 0.15, 0, 0, 0, 0.9, 1.1, 1), 0, '#c58e62');           // hand
  }
  add(new THREE.CylinderGeometry(0.058, 0.068, 0.11, 8), M(0, 1.55, 0), 0, '#c58e62');
  add(new THREE.SphereGeometry(0.118, 12, 9), M(0, 1.67, 0.005, 0, 0, 0, 0.92, 1.1, 1), 0, '#c58e62');
  add(new THREE.ConeGeometry(0.022, 0.05, 6), M(0, 1.655, 0.12, Math.PI / 2 + 0.25), 0, '#b07a52');             // nose
  add(new THREE.SphereGeometry(0.124, 12, 5, 0, Math.PI * 2, 0, Math.PI * 0.48), M(0, 1.7, -0.005, -0.08), 3, '#ffffff');   // cap / bandana
  add(new THREE.CylinderGeometry(0.21, 0.21, 0.016, 14), M(0, 1.735, 0, -0.05, 0, 0, 1, 1, 0.92), 5, '#2a1f17');   // brim (some only)
  _crewGeo = mergeSimple(parts);
  return _crewGeo;
}
function mergeSimple(geos) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color', 'aPart']) {
    const arrs = geos.map(g => g.attributes[name].array);
    const total = arrs.reduce((a, b) => a + b.length, 0);
    const buf = new Float32Array(total); let o = 0;
    for (const a of arrs) { buf.set(a, o); o += a.length; }
    out.setAttribute(name, new THREE.BufferAttribute(buf, geos[0].attributes[name].itemSize));
  }
  out.computeBoundingSphere();
  return out;
}

let _crewMat = null;
export function getCrewMaterial() {
  if (_crewMat) return _crewMat;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, envMapIntensity: 0.6 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;\nattribute vec4 aHat;')
      .replace('#include <color_vertex>', `
vColor = vec4(1.0);
vColor.rgb = color;
#ifdef USE_INSTANCING_COLOR
  if (aPart > 0.5 && aPart < 1.5) vColor.rgb = instanceColor.rgb;
  if (aPart > 2.5 && aPart < 3.5) vColor.rgb = mix(vec3(0.12, 0.09, 0.07), vec3(0.62, 0.12, 0.1), step(0.5, fract(instanceColor.r * 7.3 + instanceColor.b * 3.1)));
  if (aPart > 4.5) vColor.rgb = vec3(0.14, 0.1, 0.08);
  if (aPart < 0.5) vColor.rgb *= 0.85 + 0.3 * fract(instanceColor.g * 13.7);
#endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING_COLOR
  // hat brim on ~40 % of the crew (hash of the instance colour); the others keep a bare cap
  if (aPart > 4.5 && fract(instanceColor.r * 5.31 + instanceColor.g * 2.17) > 0.4) transformed = vec3(0.0, 1.6, 0.0);
#endif`);
  };
  m.customProgramCacheKey = () => 'shipCrew_v2';
  _crewMat = m;
  return m;
}

// ---------------------------------------------------------------- lantern glow (additive sprites)
let _glowTex = null;
function glowTex() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,230,170,1)'); g.addColorStop(0.18, 'rgba(255,190,110,0.55)'); g.addColorStop(0.5, 'rgba(255,140,60,0.12)'); g.addColorStop(1, 'rgba(255,120,40,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c); _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}
let _glowMat = null;
export function getGlowMaterial() {
  if (_glowMat) return _glowMat;
  _glowMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: glowTex() }, uNight: GLOBAL.uNight, uTime: GLOBAL.uTime },
    vertexShader: /* glsl */`
      attribute float aSize; uniform float uNight; uniform float uTime; varying float vA;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float flick = 0.9 + 0.1 * sin(uTime * 8.0 + position.x * 5.0);
        vA = (0.15 + 0.85 * uNight) * flick;
        gl_PointSize = aSize * (1.0 + 1.6 * uNight) * 900.0 / max(1.0, -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uTex; varying float vA;
      void main() { vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(t.rgb * t.a * vA * 2.2, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  return _glowMat;
}

// ---------------------------------------------------------------- waterline foam skirt + stern wake (one transparent mesh)
// aF = (across 0 at hull .. 1 outer edge, along-hull coordinate in metres, kind 0 skirt | 1 wake, bowness 0..1)
export function buildFoamGeometry(H) {
  const pos = [], aF = [], idx = [];
  const N = 64, y = 0.03;
  let acc = 0, prev = null;
  for (const side of [-1, 1]) {
    const base = pos.length / 3; acc = 0; prev = null;
    for (let i = 0; i <= N; i++) {
      const s = Math.min(0.999, Math.max(0.001, i / N));
      const p = H.point(s, y, side);
      const f = H.frame(s, y, side);
      const nx = f.n.x, nz = f.n.z, nl = Math.hypot(nx, nz) || 1;
      if (prev) acc += p.distanceTo(prev); prev = p.clone();
      const bow = Math.max(0, 1 - s / 0.25);
      const w = 0.7 + 1.6 * bow * bow + 0.4 * Math.max(0, (s - 0.85) / 0.15);
      const pin = H.point(s, 0.28, side);
      pos.push(pin.x - side * 0.02, 0.28, pin.z, p.x + (nx / nl) * w, -0.04, p.z + (nz / nl) * w);
      aF.push(0, acc, 0, bow, 1, acc, 0, bow);
    }
    for (let i = 0; i < N; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  }
  // wake: tapered strip trailing from the stern
  { const base = pos.length / 3, z0 = H.z(1, y) - 0.6, hw0 = Math.max(0.6, H.hw(0.97, y)), NW = 16, Lw = H.L * 1.4;
    for (let i = 0; i <= NW; i++) {
      const t = i / NW, z = z0 + t * Lw, hw = hw0 * (0.85 + 1.9 * t);
      for (const sx of [-1, 1]) { pos.push(sx * hw, y + 0.01, z); aF.push(sx * 0.5 + 0.5, t, 1, 0); }
    }
    for (let i = 0; i < NW; i++) { const a = base + i * 2; idx.push(a, a + 2, a + 3, a, a + 3, a + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aF', new THREE.Float32BufferAttribute(aF, 4));
  g.setIndex(idx); g.computeBoundingSphere();
  return g;
}
export function makeFoamMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0xf2f6f2, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const u = { uSpeed: { value: 0 } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { uTime: GLOBAL.uTime, uNight: GLOBAL.uNight });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aF; varying vec4 vF; varying vec2 vFP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvF = aF; vFP = position.xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uSpeed; uniform float uTime; uniform float uNight; varying vec4 vF; varying vec2 vFP;
float fh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fh(i), fh(i + vec2(1, 0)), f.x), mix(fh(i + vec2(0, 1)), fh(i + 1.0), f.x), f.y); }`)
      .replace('#include <alphatest_fragment>', `
float sp = clamp(uSpeed / 9.0, 0.0, 1.0);
float n = fn(vFP * 1.7 + vec2(0.0, uTime * 0.6)) * 0.6 + fn(vFP * 4.3 - vec2(uTime * 0.4, 0.0)) * 0.4;
float a;
if (vF.z < 0.5) {
  // contact skirt: solid at the hull, breaking into lacy patches outward; thicker & livelier at the bow with speed
  float edge = 1.0 - smoothstep(0.0, 1.0, vF.x);
  float lace = smoothstep(0.35 + 0.4 * vF.x, 0.75 + 0.2 * vF.x, n + edge * 0.45);
  a = (edge * 0.55 + lace * 0.6) * (0.55 + 0.45 * vF.w * (0.4 + sp)) * (0.6 + 0.4 * sp);
  a *= smoothstep(0.0, 0.08, vF.x) * 0.35 + 0.65;
} else {
  // stern wake: two churned lines along the quarters + broken centre trail, fading aft
  float x = abs(vF.x * 2.0 - 1.0);
  float t = vF.y;
  float rims = smoothstep(0.55, 0.9, x) * (1.0 - smoothstep(0.9, 1.0, x));
  float core = (1.0 - smoothstep(0.0, 0.45, x)) * 0.7;
  float churn = smoothstep(0.4, 0.8, n);
  a = (rims * 0.8 + core * churn) * (1.0 - smoothstep(0.05 + 0.6 * sp, 0.15 + 0.85 * sp, t)) * smoothstep(0.0, 0.04, t) * sp;
  a *= 0.4 + 0.6 * churn;
}
diffuseColor.a *= clamp(a, 0.0, 0.9);
diffuseColor.rgb *= mix(1.0, 0.12, uNight) * (0.88 + 0.12 * n);
#include <alphatest_fragment>`);
  };
  m.customProgramCacheKey = () => 'shipFoam_v2';
  return m;
}
