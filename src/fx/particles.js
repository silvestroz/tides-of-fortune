// GPU-friendly billboard particle system: one InstancedBufferGeometry quad + per-instance attributes,
// CPU-simulated in a dense structure-of-arrays (no per-frame allocations).
//
//   const ps = new ParticleSystem({ capacity, additive, atlas, sorted, renderOrder })
//   scene.add(ps.mesh)
//   const p = ps.p;  p.reset(); p.x = ...; ...; ps.emit();      // fill the template, then emit
//   ps.update(dt, ctx)   ctx = { camera, windX, windZ, sunDir, sunColor, ambient, waterY(x,z) }
//
// Template fields (p.*):
//   x,y,z  vx,vy,vz      position / velocity (m, m/s)
//   life                 seconds
//   s0, s1, sizePow      start size, end size (m, quad width), ease-out exponent of growth
//   rot, rotV            radians, radians/s
//   r,g,b  r1,g1,b1      albedo at birth -> albedo at death
//   a                    peak opacity;  fadeIn (0..1 of life), fadePow (fade-out exponent)
//   frame                atlas frame 0 smoke, 1 flame, 2 spray, 3 glow
//   emis, emisPow        self-illumination (HDR multiplier) and its decay exponent over life
//   drag                 1/s relaxation of velocity toward (wind * wind)
//   wind                 0..1 how much the particle is carried by the wind
//   accel                vertical acceleration (m/s^2) (negative = gravity, positive = buoyancy)
//   stretch              >0 stretches the quad along screen-space velocity (spray streaks, embers)
//   killWater            1 = die when falling below the water surface
import * as THREE from 'three';

const FIELDS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'age', 'life', 's0', 's1', 'sizePow', 'rot', 'rotV',
  'r', 'g', 'b', 'r1', 'g1', 'b1', 'a', 'fadeIn', 'fadePow', 'frame', 'emis', 'emisPow', 'drag', 'wind',
  'accel', 'stretch', 'killWater'];

const DEFAULTS = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, s0: 1, s1: 1, sizePow: 2, rot: 0, rotV: 0,
  r: 1, g: 1, b: 1, r1: -1, g1: -1, b1: -1, a: 1, fadeIn: 0.05, fadePow: 1, frame: 0, emis: 0, emisPow: 2,
  drag: 0, wind: 0, accel: 0, stretch: 0, killWater: 0 };

class Template {
  constructor() { this.reset(); }
  reset() { for (const k in DEFAULTS) this[k] = DEFAULTS[k]; return this; }
}

const VERT = /* glsl */`
attribute vec4 iPosSize;
attribute vec4 iColAlpha;
attribute vec4 iMisc;     // rot, frame, emissive, heat
attribute vec4 iVel;      // world velocity xyz, stretch
uniform vec3 uSunDirV;
uniform float uFocus;
varying vec2 vUv;
varying vec2 vCorner;
varying vec4 vCol;
varying float vEmis;
varying float vScatter;
varying float vFrame;
varying float vSeed;
varying float vNear;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(iPosSize.xyz, 1.0);
  vec2 c = position.xy;
  float size = iPosSize.w;
  vec2 ax = vec2(1.0, 0.0), ay = vec2(0.0, 1.0);
  if (iVel.w > 0.0) {
    vec3 vv = (viewMatrix * vec4(iVel.xyz, 0.0)).xyz;
    float l = length(vv.xy);
    if (l > 1e-3) { ay = vv.xy / l; ax = vec2(ay.y, -ay.x); }
    c.y *= 1.0 + iVel.w * l;
  } else {
    float s = sin(iMisc.x), co = cos(iMisc.x);
    ax = vec2(co, s); ay = vec2(-s, co);
  }
  mvPosition.xy += (ax * c.x + ay * c.y) * size;
  // light-space corner (rotation-invariant lighting: view-aligned)
  vCorner = (ax * position.x + ay * position.y) * 2.0;
  float f = iMisc.y;
  vUv = uv * 0.5 + vec2(mod(f, 2.0) * 0.5, 0.5 - floor(f / 2.0) * 0.5);
  vCol = iColAlpha;
  vEmis = iMisc.z;
  vFrame = iMisc.y;
  vSeed = fract(iMisc.x * 0.159);
  // fade billboards that swallow the camera (a blurry bank filling the lens): gone inside ~1 size, full at 3 sizes
  vNear = smoothstep(size * 1.0, size * 3.0, -mvPosition.z) * smoothstep(uFocus * 0.3, uFocus * 0.6, -mvPosition.z);
  // ...and anything well in front of the framed subject (out-of-focus foreground banks)
  vec3 vd = normalize(mvPosition.xyz);
  vScatter = pow(max(0.0, dot(vd, uSunDirV)), 6.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
uniform sampler2D uAtlas;
uniform vec3 uSunDirV;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform float uAdditive;
varying vec2 vUv;
varying vec2 vCorner;
varying vec4 vCol;
varying float vEmis;
varying float vScatter;
varying float vFrame;
varying float vSeed;
varying float vNear;
float pHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(pHash(i), pHash(i + vec2(1, 0)), f.x), mix(pHash(i + vec2(0, 1)), pHash(i + vec2(1, 1)), f.x), f.y); }
#include <fog_pars_fragment>
void main() {
  float tex = texture2D(uAtlas, vUv).a;
  float alpha = tex * vCol.a;
  bool smk = uAdditive < 0.5 && vFrame < 0.5;
  if (smk) {
    // round 6: painted volutes instead of cotton balls — the puff erodes from its thin rim inward as it fades
    // (noise in billboard space breaks the round silhouette), so a bank dissolves softly instead of shrinking discs
    float nz = pNoise(vCorner * 3.2 + vSeed * 37.0) * 0.5 + pNoise(vCorner * 7.3 - vSeed * 23.0) * 0.3 + pNoise(vCorner * 15.0 + vSeed * 11.0) * 0.2;
    float er = (1.0 - vCol.a) * 0.35 + 0.04;
    alpha = smoothstep(er, er + 0.65, tex * (0.55 + 0.9 * nz)) * min(1.0, vCol.a * 1.3);
  }
  alpha *= uAdditive > 0.5 ? 1.0 : vNear;
  if (alpha < 0.002) discard;
  vec3 col;
  if (uAdditive > 0.5) {
    col = vCol.rgb * (1.0 + vEmis);
  } else {
    // pseudo-volumetric: sphere normal from the billboard corner, wrapped lambert, density self-shadow
    vec2 cc = vCorner;
    float r2 = clamp(dot(cc, cc), 0.0, 1.0);
    vec3 n = normalize(vec3(cc, sqrt(1.0 - r2) * 0.9 + 0.15));
    if (smk) {
      // round 7: relief from the volute texture itself (density gradient) so each curl is lit on its sun side,
      // instead of one shaded sphere per billboard (the 'cotton ball' read)
      vec2 gd = vec2(dFdx(tex), dFdy(tex)) / max(1e-4, length(fwidth(vUv)) * 256.0);
      n = normalize(mix(n, normalize(vec3(-gd * 2.2, 0.6)), 0.6));
    }
    float ndl = dot(n, uSunDirV);
    // stronger key/shadow split for smoke: a lit sun side and a cool, sky-tinted shadow side (painted volume)
    float wrap = smk ? smoothstep(-0.45, 0.85, ndl) : clamp(ndl * 0.6 + 0.4, 0.0, 1.0);
    float selfShadow = mix(1.0, smk ? 0.35 : 0.45, smoothstep(0.2, 0.95, tex));
    vec3 light = uSunColor * wrap * selfShadow * (smk ? 0.95 : 0.85) + uAmbient * mix(1.0, 0.75, tex) * (smk ? vec3(0.85, 0.92, 1.1) : vec3(1.0));
    // silver lining when looking toward the sun through thin smoke
    light += uSunColor * vScatter * (1.0 - tex) * 2.2;
    col = vCol.rgb * light;
    if (smk) {
      // painted volume: shaded belly (cool, darker underside), lit crown, and broken value inside the puff so a bank
      // reads as rolling volutes instead of uniform cotton
      float nz2 = pNoise(vCorner * 4.0 + vSeed * 53.0);
      col *= mix(0.68, 1.05, smoothstep(-0.9, 0.7, cc.y)) * (0.82 + 0.3 * nz2);
    }
    // fire-lit underside / glowing heat
    col += vCol.rgb * vec3(1.0, 0.55, 0.22) * vEmis * (0.6 + 0.4 * (1.0 - cc.y));
  }
  // additive systems: premultiplied with partial occlusion so flames read orange even over a bright sky
  gl_FragColor = uAdditive > 0.5 ? vec4(col * alpha, alpha * 0.55) : vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const _m = new THREE.Vector3();

export class ParticleSystem {
  constructor({ capacity = 2000, additive = false, atlas, sorted = !additive, renderOrder = 10 } = {}) {
    this.capacity = capacity;
    this.count = 0;
    this.sorted = sorted;
    this.additive = additive;
    this.p = new Template();
    this.d = {};
    for (const f of FIELDS) this.d[f] = new Float32Array(capacity);

    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = name => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      return a;
    };
    this.aPos = mk('iPosSize'); this.aCol = mk('iColAlpha'); this.aMisc = mk('iMisc'); this.aVel = mk('iVel');
    g.instanceCount = 0;
    this.geometry = g;

    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uAtlas: { value: null }, uSunDirV: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) }, uAmbient: { value: new THREE.Color(0.4, 0.45, 0.5) }, uFocus: { value: 1e4 },
      uAdditive: { value: additive ? 1 : 0 },
    }]);
    this.uniforms.uAtlas.value = atlas;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.order = new Uint32Array(capacity);
    this.depth = new Float32Array(capacity);
    this._cmp = (a, b) => this.depth[b] - this.depth[a];
  }

  // emit the current template; returns index or -1
  emit() {
    if (this.count >= this.capacity) return -1;
    const i = this.count++, d = this.d, p = this.p;
    for (let k = 0; k < FIELDS.length; k++) { const f = FIELDS[k]; d[f][i] = p[f]; }
    d.age[i] = 0;
    if (p.r1 < 0) { d.r1[i] = p.r; d.g1[i] = p.g; d.b1[i] = p.b; }
    return i;
  }

  kill(i) {
    const last = --this.count, d = this.d;
    if (i !== last) for (let k = 0; k < FIELDS.length; k++) { const a = d[FIELDS[k]]; a[i] = a[last]; }
  }

  clear() { this.count = 0; }

  update(dt, ctx) {
    const d = this.d;
    const wx = ctx.windX, wz = ctx.windZ;
    for (let i = 0; i < this.count; i++) {
      const age = (d.age[i] += dt);
      if (age >= d.life[i]) { this.kill(i); i--; continue; }
      const k = Math.min(1, d.drag[i] * dt), w = d.wind[i];
      d.vx[i] += (wx * w - d.vx[i]) * k;
      d.vz[i] += (wz * w - d.vz[i]) * k;
      d.vy[i] += -d.vy[i] * k + d.accel[i] * dt;
      d.x[i] += d.vx[i] * dt; d.y[i] += d.vy[i] * dt; d.z[i] += d.vz[i] * dt;
      d.rot[i] += d.rotV[i] * dt;
      if (d.killWater[i] > 0 && d.vy[i] < 0 && d.y[i] < ctx.waterY(d.x[i], d.z[i])) { this.kill(i); i--; continue; }
    }
    // camera-space depth sort (back to front) for alpha-blended systems
    const n = this.count, cam = ctx.camera.position;
    const order = this.order;
    for (let i = 0; i < n; i++) order[i] = i;
    if (this.sorted && n > 1) {
      const dep = this.depth;
      for (let i = 0; i < n; i++) { const dx = d.x[i] - cam.x, dy = d.y[i] - cam.y, dz = d.z[i] - cam.z; dep[i] = dx * dx + dy * dy + dz * dz; }
      order.subarray(0, n).sort(this._cmp);
    }
    const P = this.aPos.array, C = this.aCol.array, M = this.aMisc.array, V = this.aVel.array;
    for (let j = 0; j < n; j++) {
      const i = order[j], o = j * 4;
      const t = d.age[i] / d.life[i];
      const grow = 1 - Math.pow(1 - t, d.sizePow[i]);
      const fi = d.fadeIn[i];
      const aIn = fi > 0 ? Math.min(1, t / fi) : 1;
      const alpha = d.a[i] * aIn * aIn * (3 - 2 * aIn) * Math.pow(1 - t, d.fadePow[i]);
      P[o] = d.x[i]; P[o + 1] = d.y[i]; P[o + 2] = d.z[i]; P[o + 3] = d.s0[i] + (d.s1[i] - d.s0[i]) * grow;
      C[o] = d.r[i] + (d.r1[i] - d.r[i]) * t; C[o + 1] = d.g[i] + (d.g1[i] - d.g[i]) * t; C[o + 2] = d.b[i] + (d.b1[i] - d.b[i]) * t; C[o + 3] = alpha;
      M[o] = d.rot[i]; M[o + 1] = d.frame[i]; M[o + 2] = d.emis[i] * Math.pow(1 - t, d.emisPow[i]); M[o + 3] = 0;
      V[o] = d.vx[i]; V[o + 1] = d.vy[i]; V[o + 2] = d.vz[i]; V[o + 3] = d.stretch[i];
    }
    for (const a of (this._attrs || (this._attrs = [this.aPos, this.aCol, this.aMisc, this.aVel]))) {   // no per-frame array alloc
      a.clearUpdateRanges();
      if (n > 0) { a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
    }
    this.geometry.instanceCount = n;
    // lighting uniforms (view space sun)
    const u = this.uniforms;
    _m.copy(ctx.sunDir).transformDirection(ctx.camera.matrixWorldInverse);
    u.uSunDirV.value.copy(_m);
    u.uSunColor.value.copy(ctx.sunColor);
    u.uAmbient.value.copy(ctx.ambient);
    u.uFocus.value = ctx.focus || 1e4;
  }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
