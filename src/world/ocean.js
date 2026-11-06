// Ocean surface: a camera-following Gerstner sea whose CPU height queries match the GPU displacement exactly.
// API (other systems rely on these — keep CPU and GPU waves identical):
//   ocean.getHeight(x, z)            -> number   water surface height at world xz, current time
//   ocean.getNormal(x, z, outVec3)   -> outVec3  surface normal
//   ocean.getDisplacement(x,z,out)   -> out      (optional) full Gerstner displacement
//   ocean.seaState                    0..1 roughness (driven by wind speed); settable
//   ocean.update(dt, t)
// The ocean also renders ship wakes/foam for every ship in game.ships (ship.position, ship.heading, ship.speed, ship.length, ship.beam).
// Extended API:
//   ocean.autoSeaState     bool — true until someone assigns seaState; then seaState is held at the assigned value.
//                          While true, seaState eases toward a value derived from game.wind.speed (3 m/s calm .. 20 m/s storm).
//   ocean.addFoam(x, z, radius = 6, amount = 1)   transient foam splash on the surface (cannonball splashes, sinkings…)
//   ocean.getVelocity(x, z, out)  -> out   approx. orbital velocity of the surface (m/s), for floating debris drift
//   ocean.mesh             the surface THREE.Mesh (camera-following polar grid with 3 LOD bands, ~23k verts, no frustum culling)
//   ocean.material         its ShaderMaterial (uniforms documented in ./ocean/oceanMaterial.js)
//   ocean.wakes            WakeSystem (./ocean/wakes.js)
// Notes: waves are a 12-component Gerstner sum (./ocean/waves.js) attenuated in water shallower than ~25 m using
// islands.depthTexture (same texel data on CPU and GPU). getHeight inverts the horizontal displacement, so it
// returns the height of the *rendered* surface directly above (x, z).
import * as THREE from 'three';
import { WaveSet } from './ocean/waves.js';
import { createOceanMaterial } from './ocean/oceanMaterial.js';
import { getDetailNormalTexture, getFoamTexture } from './ocean/textures.js';
import { WakeSystem } from './ocean/wakes.js';
import { QUALITY } from '../core/constants.js';

const TAU = Math.PI * 2;
const ANG_SEGS = 256;
const fromHalf = THREE.DataUtils.fromHalfFloat;

// Ocean LOD (perf): the radial cell size is r * K * lodFactor(r); lodFactor eases 1 -> 2 between R1 and 1.6*R1 and
// 2 -> 4 between R2 and 1.6*R2, and the angular segment count halves at 1.6*R1 and again at 1.6*R2 (stitched rings).
// The vertex shader (oceanMaterial.js) and Ocean._lod use the same lodFactor, so CPU and GPU wave sets stay identical.
// The inner band uses 0.75x the old angular segments with a 1.33x tighter radial ratio, keeping K (and so the
// per-radius wave fade) exactly as before: ~117k -> ~45k triangles.
// Ultra pushes the bands out (QUALITY.oceanLodR = [R1, R2]); the uniform uLodR is filled from the same live bindings
// when the Ocean is built, so shader and CPU (oceanLodFactor) stay synchronous.
export let OCEAN_LOD_R1 = 250, OCEAN_LOD_R2 = 2000;
const smooth = (e0, e1, x) => { let t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
export function oceanLodFactor(r) {
  return 1 + smooth(OCEAN_LOD_R1, OCEAN_LOD_R1 * 1.6, r) + 2 * smooth(OCEAN_LOD_R2, OCEAN_LOD_R2 * 1.6, r);
}

function buildPolarGrid(segs, K, maxR) {
  const near = 0.5;
  const segsAt = (r) => r >= OCEAN_LOD_R2 * 1.6 ? segs / 4 : r >= OCEAN_LOD_R1 * 1.6 ? segs / 2 : segs;
  const rings = [{ r: 0, n: segs }];
  let r = 0;
  while (r < maxR) {
    r = Math.min(r + Math.max(near, r * K * oceanLodFactor(r)), maxR);
    rings.push({ r, n: segsAt(r) });
  }
  let nv = 0;
  for (const g of rings) { g.o = nv; nv += g.n; }
  const pos = new Float32Array(nv * 3);
  for (const g of rings) for (let j = 0; j < g.n; j++) {
    const a = j / g.n * TAU, k = (g.o + j) * 3;
    pos[k] = Math.cos(a) * g.r; pos[k + 1] = 0; pos[k + 2] = Math.sin(a) * g.r;
  }
  const idx = [];
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i], C = rings[i + 1];
    if (A.n === C.n) {
      for (let j = 0; j < A.n; j++) {
        const a = A.o + j, b = A.o + (j + 1) % A.n, c = C.o + j, d = C.o + (j + 1) % C.n;
        idx.push(a, b, c, b, d, c);   // CCW seen from +Y
      }
    } else {   // C.n === A.n / 2: stitch 2 inner cells to 1 outer cell
      for (let j = 0; j < C.n; j++) {
        const a0 = A.o + 2 * j, a1 = A.o + 2 * j + 1, a2 = A.o + (2 * j + 2) % A.n, c = C.o + j, d = C.o + (j + 1) % C.n;
        idx.push(a0, a1, c, a1, d, c, a1, a2, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), maxR);
  return { geometry: g, rings: rings.length };
}

export class Ocean {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.autoSeaState = true;
    this._seaState = 0.35;
    this._seaVis = 0.35;          // eased value actually used by the waves
    this.waves = new WaveSet();
    this.waves.swellMul = QUALITY.swell || 1;   // Ultra: bigger swell
    this.origin = new THREE.Vector2();

    const quality = game.quality || game.params?.get?.('quality');
    this.wakes = new WakeSystem(game.renderer, { size: quality === 'low' ? 512 : (QUALITY.wakeSize || 1024), extent: 900 });

    if (QUALITY.oceanLodR) [OCEAN_LOD_R1, OCEAN_LOD_R2] = QUALITY.oceanLodR;
    const qs = QUALITY.oceanSegs ?? 1, K = TAU / (ANG_SEGS * qs) * 1.6;   // radial cell size / r (unchanged by the LOD rework)
    const grid = buildPolarGrid(Math.round(ANG_SEGS * 0.75 * qs / 8) * 8, K, 30000);
    const depthTex = new THREE.DataTexture(new Uint16Array([THREE.DataUtils.toHalfFloat(-200)]), 1, 1, THREE.RedFormat, THREE.HalfFloatType);
    depthTex.needsUpdate = true;
    this._dummyDepth = depthTex;
    const shared = {
      ...this.waves.uniforms,
      ...this.wakes.uniforms,
      uOrigin: { value: this.origin },
      uAngRes: { value: K },   // ≈ radial cell size / r (times oceanLodFactor)
      uLodR: { value: new THREE.Vector2(OCEAN_LOD_R1, OCEAN_LOD_R2) },
      uDepthTex: { value: depthTex }, uDepthBounds: { value: new THREE.Vector3(0, 0, 1) }, uHasDepth: { value: 0 },
      uDetail: { value: getDetailNormalTexture() }, uFoamTex: { value: getFoamTexture() },
    };
    this._angRes = K;
    this.material = createOceanMaterial(shared);
    this.uniforms = this.material.uniforms;
    if (QUALITY.tier === 'ultra') { this.material.defines.OCEAN_ULTRA = 1; this.material.needsUpdate = true; }
    const dbg = game.params?.get?.('oceandebug');
    if (dbg) this.material.defines.OCEAN_DEBUG = parseInt(dbg, 10);
    this.mesh = new THREE.Mesh(grid.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.renderOrder = -1;
    this.mesh.name = 'ocean';
    // wake/splash render targets are refreshed lazily, once per presented frame, right before the ocean draws
    this.mesh.onBeforeRender = () => this.wakes.render();
    game.scene.add(this.mesh);

    this._depth = null;     // { data:Uint16Array, res, minX, minZ, size }
    this._scroll = { a: 0, b: 0, c: 0, f: 0 };
    this._envTex = null;
    this._ready = false;
    this.waves.update(0, game.wind?.angle ?? 0, game.wind?.speed ?? 9, this._seaVis, 0, 0);
    this.waves.writeUniforms(0, 0);
  }

  get seaState() { return this._seaState; }
  set seaState(v) { this._seaState = THREE.MathUtils.clamp(+v || 0, 0, 1); this.autoSeaState = false; }

  // ---- depth lookup identical to the GPU's bilinear fetch of islands.depthTexture ----
  _bindDepth() {
    const isl = this.game.islands;
    const tex = isl?.depthTexture, b = isl?.depthTextureBounds;
    if (!tex || !b || this._depth?.tex === tex) return;
    const img = tex.image;
    if (!img?.data) return;
    // decode once to Float32 (CPU lookups stay bit-compatible with the GPU's half-float texels)
    let data = img.data;
    if (tex.type === THREE.HalfFloatType) {
      const f = new Float32Array(data.length);
      for (let i = 0; i < data.length; i++) f[i] = fromHalf(data[i]);
      data = f;
    }
    this._depth = { tex, data, res: img.width, minX: b.minX, minZ: b.minZ, size: b.size };
    this.uniforms.uDepthTex.value = tex;
    this.uniforms.uDepthBounds.value.set(b.minX, b.minZ, b.size);
    this.uniforms.uHasDepth.value = 1;
  }

  terrainAt(x, z) {
    const d = this._depth;
    if (!d) return -200;
    const u = (x - d.minX) / d.size, v = (z - d.minZ) / d.size;
    if (u < 0 || v < 0 || u > 1 || v > 1) return -200;
    const res = d.res;
    const fx = Math.min(Math.max(u * res - 0.5, 0), res - 1), fz = Math.min(Math.max(v * res - 0.5, 0), res - 1);
    const i = Math.min(Math.floor(fx), res - 2), j = Math.min(Math.floor(fz), res - 2);
    const tx = fx - i, tz = fz - j, k = j * res + i, D = d.data;
    const a = D[k], b2 = D[k + 1], c = D[k + res], e = D[k + res + 1];
    return (a + (b2 - a) * tx) + ((c + (e - c) * tx) - (a + (b2 - a) * tx)) * tz;
  }

  _att(x, z) {
    if (!this._depth) return 1;
    const t = this.terrainAt(x, z);
    if (t < -25) return 1;
    const s = THREE.MathUtils.clamp((-t - 2) / 23, 0, 1);
    return 0.3 + 0.7 * s * s * (3 - 2 * s);
  }

  // the GPU mesh fades waves shorter than its local vertex spacing; mirror that so floating objects match the pixels
  _lod(x, z) {
    const r = Math.hypot(x - this.origin.x, z - this.origin.y);
    this.waves.setSpacing(Math.max(r * this._angRes * oceanLodFactor(r), 0.25));
  }
  getHeight(x, z) { this._lod(x, z); return this.waves.height(x, z, this._att(x, z)); }
  getNormal(x, z, out = new THREE.Vector3()) { this._lod(x, z); return this.waves.normal(x, z, out, this._att(x, z)); }
  getDisplacement(x, z, out = new THREE.Vector3()) { this._lod(x, z); return this.waves.displacement(x, z, out, this._att(x, z)); }
  getVelocity(x, z, out = new THREE.Vector3()) {
    const w = this.waves, att = this._att(x, z);
    let X = 0, Y = 0, Z = 0;
    for (let i = 0; i < w.n; i++) {
      const th = w.kdx[i] * x + w.kdz[i] * z - w.phase[i], om = Math.sqrt(9.81 * w.k[i]);
      const s = Math.sin(th), c = Math.cos(th);
      X += w.QA[i] * w.dx[i] * om * s; Z += w.QA[i] * w.dz[i] * om * s; Y -= w.A[i] * om * c;
    }
    return out.set(X * att, Y * att, Z * att);
  }
  addFoam(x, z, radius = 6, amount = 1) { this.wakes.addFoam(x, z, radius, amount); }

  update(dt, t) {
    const g = this.game, u = this.uniforms;
    this.t = t;
    this._bindDepth();
    const wind = g.wind || { angle: 0, speed: 9 };
    if (this.autoSeaState) this._seaState = THREE.MathUtils.clamp((wind.speed - 3) / 17, 0, 1);
    this._seaVis += (this._seaState - this._seaVis) * (this._ready ? Math.min(1, dt * 0.4) : 1);
    const cam = g.camera;
    const ref = g.cameraRig?.target || cam.position;
    this.waves.update(dt, wind.angle, wind.speed, this._seaVis, ref.x, ref.z);

    // mesh follows the camera (snapped to 1 m)
    const ox = Math.round(cam.position.x), oz = Math.round(cam.position.z);
    this.origin.set(ox, oz);
    this.mesh.position.set(ox, 0, oz);
    this.mesh.updateMatrixWorld();
    this.waves.writeUniforms(ox, oz);

    // texture offsets: world origin folded into [0,1) per layer in double precision + scrolling
    const wdx = Math.sin(wind.angle), wdz = -Math.cos(wind.angle);
    u.uWindDir.value.set(wdx, wdz);
    u.uWindSpeed.value = wind.speed;
    const sc = this._scroll, ws = 0.6 + wind.speed * 0.06;
    sc.a += dt * ws * 1.0; sc.b += dt * ws * 0.6; sc.c += dt * ws * 0.9; sc.f += dt * 0.35;
    const prx = ox * wdx + oz * wdz, pry = ox * -wdz + oz * wdx;    // origin in wind-aligned coords (matches shader)
    const fr = (v) => v - Math.floor(v);
    u.uOffA.value.set(fr((prx - sc.a) / 23), fr(pry / 23));
    const bx = pry * 0.8 + prx * 0.6, by = -prx * 0.8 + pry * 0.6;
    u.uOffB.value.set(fr((bx - sc.b * 0.6) / 7.13), fr((by + sc.b * 0.8) / 7.13));
    u.uOffC.value.set(fr((prx - sc.c * 1.3) / 3.7), fr((pry + sc.c * 0.2) / 3.7));
    u.uOffF.value.set(fr((ox + wdx * sc.f * 2.0) / 9), fr((oz + wdz * sc.f * 2.0) / 9), fr((ox - wdx * sc.f) / 31), fr((oz - wdz * sc.f) / 31));
    u.uOffP.value.set(fr(ox / 397), fr(oz / 397));
    u.uGlitOff.value.set((ox * 2) % 4096, (oz * 2) % 4096);

    u.uTime.value = t;
    u.uSeaState.value = this._seaVis;

    // lighting from the sky
    const sky = g.sky;
    if (sky) {
      const night = sky.sunElevation !== undefined ? sky.sunElevation < -4 : false;
      const ld = sky.lightDir && sky.lightDir.lengthSq() > 0 ? sky.lightDir : sky.sunDir;
      u.uLightDir.value.copy(ld).normalize();
      u.uSunDir.value.copy(sky.sunDir);
      u.uIsMoon.value = night ? 1 : 0;
      const L = sky.sunLight;
      if (L) u.uLightCol.value.copy(L.color).multiplyScalar(L.intensity);
      else u.uLightCol.value.copy(sky.sunColor).multiplyScalar(3);
      if (night) u.uLightCol.value.multiplyScalar(1.6);
      if (sky.hemi) u.uAmbient.value.copy(sky.hemi.color).multiplyScalar(sky.hemi.intensity * 1.25);
      else if (sky.ambientColor) u.uAmbient.value.copy(sky.ambientColor);
      const su = sky.u;
      if (su?.uZenith) {
        u.uSkyZenith.value.copy(su.uZenith.value); u.uSkyHorizon.value.copy(su.uHorizon.value);
        if (su.uBand) u.uHzBand.value.copy(su.uBand.value);
        if (su.uGlow) u.uHzGlow.value.copy(su.uGlow.value);
        u.uHzParams.value.set(su.uHaze?.value ?? 1, su.uOvercast?.value ?? 0);
      }
      else if (sky.fogColor) { u.uSkyHorizon.value.copy(sky.fogColor); u.uSkyZenith.value.copy(sky.fogColor).multiplyScalar(0.7); }
      // environment (PMREM) for reflections
      const env = sky.envMap || g.scene.environment || null;
      if (env !== this._envTex) {
        const hadEnv = !!this._envTex;
        this._envTex = env;
        this.material.envMap = env;
        u.envMap.value = env;
        if (hadEnv !== !!env) this.material.needsUpdate = true;
      }
    }
    u.uEnvIntensity.value = 1.0;

    // wakes around the camera target
    this.wakes.update(dt, t, g.ships || [], ref.x, ref.z);
    this._ready = true;
  }

  dispose() {
    this.game.scene.remove(this.mesh);
    this.mesh.geometry.dispose(); this.material.dispose(); this.wakes.dispose();
  }
}
