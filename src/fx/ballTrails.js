// Continuous cannonball trails: one camera-facing ribbon per ball (one draw call for all of them).
//   const tr = new BallTrails(scene, { max = 192 })
//   const id = tr.start(kind)           // kind 0 round, 1 chain, 2 grape; returns slot (or -1)
//   tr.push(id, x, y, z, t)             // lay a point (call every sim step while the ball flies)
//   tr.release(id)                      // ball gone: the ribbon keeps fading out on its own
//   tr.update(t)                        // rebuild geometry (once per sim step)
// The head is a hot, thin streak; it widens and cools into a pale powder-smoke ribbon that fades with age, so a
// volley reads as continuous strokes across the water instead of a string of beads.
import * as THREE from 'three';

const K = 14;          // points per trail
const LIFE = 0.3;      // seconds a trail point stays visible (round 6: 0.75 s read as horizontal lasers)

const vert = /* glsl */`
attribute vec3 aNext; attribute vec3 aInfo;   // info: side (-1/1), age01 (0 head..1 tail), kind
varying float vAge; varying float vSide; varying float vKind;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec4 mn = modelViewMatrix * vec4(aNext, 1.0);
  vec2 dir = mn.xy - mvPosition.xy;
  float l = length(dir);
  dir = l > 1e-4 ? dir / l : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float a = aInfo.y;
  float w = mix(0.22, 0.5, pow(a, 0.7)) * (aInfo.z > 1.5 ? 0.6 : 1.0);
  mvPosition.xy += nrm * aInfo.x * w;
  vAge = a; vSide = aInfo.x; vKind = aInfo.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const frag = /* glsl */`
uniform vec3 uSun; uniform vec3 uAmb;
varying float vAge; varying float vSide; varying float vKind;
#include <fog_pars_fragment>
void main() {
  float a = vAge;
  if (a >= 1.0) discard;
  float across = 1.0 - vSide * vSide;            // soft edges across the ribbon
  // dark iron at the head (the ball's motion blur), thinning into a faint powder-grey wisp: a short stroke, no glow
  float head = exp(-a * 7.0);
  vec3 smoke = vec3(0.78, 0.77, 0.74) * (uAmb + uSun * 0.6);
  vec3 col = mix(smoke, vec3(0.07, 0.065, 0.06) * (uAmb + uSun * 0.3), head);
  float alpha = across * (1.0 - a) * (1.0 - a) * mix(0.22, 0.85, head);
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}`;

export class BallTrails {
  constructor(scene, { max = 192 } = {}) {
    this.max = max;
    this.px = new Float32Array(max * K); this.py = new Float32Array(max * K); this.pz = new Float32Array(max * K); this.pt = new Float32Array(max * K);
    this.cnt = new Uint8Array(max); this.head = new Uint8Array(max); this.kind = new Uint8Array(max);
    this.live = new Uint8Array(max);   // 1 = ball attached, 0 = fading/free
    this.lastT = new Float32Array(max).fill(-1e9);
    this.free = []; for (let i = max - 1; i >= 0; i--) this.free.push(i);
    this.used = new Set();
    const nv = max * K * 2;
    const g = this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(nv * 3); this.nxt = new Float32Array(nv * 3); this.info = new Float32Array(nv * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aNext', new THREE.BufferAttribute(this.nxt, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aInfo', new THREE.BufferAttribute(this.info, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array(max * (K - 1) * 6);
    let o = 0;
    for (let s = 0; s < max; s++) for (let i = 0; i < K - 1; i++) {
      const a = (s * K + i) * 2;
      idx[o++] = a; idx[o++] = a + 1; idx[o++] = a + 2; idx[o++] = a + 1; idx[o++] = a + 3; idx[o++] = a + 2;
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uSun: { value: new THREE.Color(1, 0.95, 0.85) }, uAmb: { value: new THREE.Color(0.45, 0.5, 0.58) } }]),
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    g.setDrawRange(0, 0);
    scene.add(this.mesh);
  }
  start(kind = 0) {
    let id = this.free.pop();
    if (id === undefined) {
      // steal the oldest fading trail
      let best = -1, bt = 1e9;
      for (const u of this.used) if (!this.live[u] && this.lastT[u] < bt) { bt = this.lastT[u]; best = u; }
      if (best < 0) return -1;
      id = best;
    }
    this.used.add(id);
    this.cnt[id] = 0; this.head[id] = 0; this.kind[id] = kind; this.live[id] = 1;
    return id;
  }
  push(id, x, y, z, t) {
    if (id < 0) return;
    const h = (this.head[id] + 1) % K, o = id * K + h;
    this.px[o] = x; this.py[o] = y; this.pz[o] = z; this.pt[o] = t;
    this.head[id] = h; if (this.cnt[id] < K) this.cnt[id]++;
    this.lastT[id] = t;
  }
  release(id) { if (id >= 0) this.live[id] = 0; }
  update(t) {
    const P = this.pos, N = this.nxt, I = this.info;
    let s = 0;
    for (const id of this.used) {
      if (!this.live[id] && t - this.lastT[id] > LIFE) { this.used.delete(id); this.free.push(id); continue; }
      const n = this.cnt[id]; if (n < 2) continue;
      const base = s * K * 2;
      for (let i = 0; i < K; i++) {
        const k = Math.min(i, n - 1);
        const o = id * K + ((this.head[id] - k + K) % K);
        // next point toward the tail for the ribbon direction (head uses the second point)
        const kn = Math.min(k + 1, n - 1), on = id * K + ((this.head[id] - kn + K) % K);
        const oo = kn === k ? id * K + ((this.head[id] - Math.max(k - 1, 0) + K) % K) : on;
        const age = Math.min(1, Math.max(0, (t - this.pt[o]) / LIFE));
        const a01 = k !== i ? 1 : age;
        for (let side = 0; side < 2; side++) {
          const v = base + i * 2 + side;
          P[v * 3] = this.px[o]; P[v * 3 + 1] = this.py[o]; P[v * 3 + 2] = this.pz[o];
          const sg = kn === k ? -1 : 1;   // flip direction for the last point so the normal stays consistent
          N[v * 3] = this.px[o] + (this.px[oo] - this.px[o]) * sg; N[v * 3 + 1] = this.py[o] + (this.py[oo] - this.py[o]) * sg; N[v * 3 + 2] = this.pz[o] + (this.pz[oo] - this.pz[o]) * sg;
          I[v * 3] = side ? 1 : -1; I[v * 3 + 1] = Math.max(a01, i / (K - 1) * 0.5 + age * 0.5); I[v * 3 + 2] = this.kind[id];
        }
      }
      s++;
    }
    this.geo.setDrawRange(0, s * (K - 1) * 6);
    if (s) {   // only upload the live ribbons (the buffers cover the whole pool)
      const A = this.geo.attributes;
      for (const a of [A.position, A.aNext, A.aInfo]) { a.clearUpdateRanges(); a.addUpdateRange(0, s * K * 2 * 3); a.needsUpdate = true; }
    }
  }
  setLight(sun, amb) { if (sun) this.mat.uniforms.uSun.value.copy(sun); if (amb) this.mat.uniforms.uAmb.value.copy(amb); }
}
