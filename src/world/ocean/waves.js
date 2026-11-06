// Gerstner wave bank with an exact CPU twin of the GPU vertex displacement.
//   WaveSet.update(dt, windAngle, windSpeed, seaState, refX, refZ)  ease parameters, advance phases
//   WaveSet.displacement(x0, z0, out, att=1)  displacement of the undisplaced grid point (x0,z0)
//   WaveSet.height(x, z, att=1)         surface height at the *displaced* world position (x,z)  (fixed-point inversion)
//   WaveSet.normal(x, z, out, att=1)    surface normal at world (x,z)
//   att: shallow-water amplitude factor (0..1), applied identically on the GPU
//   WaveSet.setSpacing(m)               per-wave LOD fade identical to the vertex shader's (mesh sample spacing)
//   WaveSet.writeUniforms(cx, cz)       push to GPU uniforms relative to origin (cx,cz)
//   WaveSet.uniforms                    { uWave: Vector4[N] (k*dx, k*dz, A, QA), uWaveB: Vector4[N] (phase, k, 0, 0) }
//   GLSL_WAVES                          shader chunk (must match the CPU code exactly)
// Wave argument: theta = k*(d . p0) - phase.  P = p0 + sum(QA*d*cos theta),  y = sum(A*sin theta).
// Direction / wavelength changes keep the phase continuous at the reference point (camera target), so a wind
// shift rotates the sea smoothly around the player instead of sliding it at far coordinates.
import * as THREE from 'three';

export const NUM_WAVES = 12;
const G = 9.81, TAU = Math.PI * 2;

// deterministic per-wave jitter
const JIT = [0.0, 0.62, -0.48, 0.33, -0.81, 0.17, -0.27, 0.71, -0.58, 0.44, -0.12, 0.9];
const lerp = (a, b, t) => a + (b - a) * t;

export class WaveSet {
  constructor() {
    this.n = NUM_WAVES;
    this.k = new Float64Array(NUM_WAVES);
    this.dx = new Float64Array(NUM_WAVES);
    this.dz = new Float64Array(NUM_WAVES);
    this.A = new Float64Array(NUM_WAVES);
    this.QA = new Float64Array(NUM_WAVES);
    this.phase = new Float64Array(NUM_WAVES);
    this.ang = new Float64Array(NUM_WAVES);
    this.kdx = new Float64Array(NUM_WAVES);
    this.kdz = new Float64Array(NUM_WAVES);
    this.uniforms = {
      uWave: { value: Array.from({ length: NUM_WAVES }, () => new THREE.Vector4()) },
      uWaveB: { value: Array.from({ length: NUM_WAVES }, () => new THREE.Vector4()) },
    };
    this.fw = new Float64Array(NUM_WAVES).fill(1);   // per-wave LOD weight (matches the GPU vertex filter)
    this._fwSpacing = -1;
    this.ampSum = 1;
    this._init = false;
    for (let i = 0; i < NUM_WAVES; i++) this.phase[i] = (JIT[(i * 5) % NUM_WAVES] + 1) * 3.1;
  }

  // target spectrum for given wind / sea state
  _targets(windAngle, windSpeed, s) {
    const T = [];
    const s15 = Math.pow(s, 1.35);
    // 2 long swells, slightly off the wind
    // open-ocean swell is always present (even on a glassy day) so hulls ride and the horizon silhouette moves
    // swellMul (quality tier, `QUALITY.swell`): fuller, longer ocean swell; physics follows (same CPU twin)
    const sw = this.swellMul || 1;
    const swA = lerp(0.45, 2.1, Math.pow(s, 1.1)) * sw, swL = lerp(85, 170, s) * (1 + (sw - 1) * 0.45);
    T.push({ ang: windAngle + 0.38, lam: swL, A: swA });
    T.push({ ang: windAngle - 0.27, lam: swL * 0.62, A: swA * 0.6 });
    // wind sea: geometric wavelengths from the peak down to ~1.5 m
    const lp = lerp(16, 48, s), spread = lerp(1.35, 0.8, s);   // wider directional spread: crossing seas, no corduroy
    const kA = lerp(0.035, 0.115, s15);
    const n = NUM_WAVES - 2;
    for (let i = 0; i < n; i++) {
      // de-correlated wavelengths (golden-ratio jitter on the geometric ladder) so no two components beat into stripes
    const lam = lp * Math.pow(0.7, i) * (1 + 0.18 * (((i + 1) * 0.6180339887) % 1 - 0.5));
      const steep = kA * (i < 2 ? 1.0 : lerp(1.0, 0.55, (i - 2) / (n - 2)));
      T.push({ ang: windAngle + JIT[i + 1] * spread, lam, A: steep * lam / TAU });
    }
    const chop = lerp(0.7, 1.35, s);
    return { T, chop };
  }

  update(dt, windAngle, windSpeed, seaState, refX = 0, refZ = 0) {
    const { T, chop } = this._targets(windAngle, windSpeed, seaState);
    const a = this._init ? Math.min(1, dt * 0.35) : 1;
    let ampSum = 0;
    for (let i = 0; i < NUM_WAVES; i++) {
      const t = T[i];
      const kT = TAU / t.lam;
      const oldKdx = this.kdx[i], oldKdz = this.kdz[i];
      // ease angle (shortest path), wavenumber, amplitude
      let da = t.ang - this.ang[i];
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (!this._init) { this.ang[i] = t.ang; this.k[i] = kT; this.A[i] = t.A; }
      else { this.ang[i] += da * a; this.k[i] += (kT - this.k[i]) * a; this.A[i] += (t.A - this.A[i]) * a; }
      const k = this.k[i];
      this.dx[i] = Math.sin(this.ang[i]); this.dz[i] = -Math.cos(this.ang[i]);
      this.kdx[i] = k * this.dx[i]; this.kdz[i] = k * this.dz[i];
      // phase continuity at the reference point + temporal advance (deep-water dispersion)
      if (this._init) this.phase[i] += (this.kdx[i] - oldKdx) * refX + (this.kdz[i] - oldKdz) * refZ;
      this.phase[i] += Math.sqrt(G * k) * dt;
      this.phase[i] %= TAU;
      ampSum += this.A[i];
    }
    // horizontal (Gerstner) amplitude, limited so the surface never folds over: sum(k*QA) <= 0.88
    let S = 0;
    for (let i = 0; i < NUM_WAVES; i++) S += chop * this.k[i] * this.A[i];
    const sc = S > 0.88 ? 0.88 / S : 1;
    for (let i = 0; i < NUM_WAVES; i++) this.QA[i] = chop * this.A[i] * sc;
    this.ampSum = ampSum;
    this._init = true;
  }

  // GPU works in coordinates local to `origin` (cx,cz) for float precision: phase' = phase - k.origin (mod 2π, in doubles)
  writeUniforms(cx, cz) {
    const U = this.uniforms.uWave.value, B = this.uniforms.uWaveB.value;
    for (let i = 0; i < NUM_WAVES; i++) {
      U[i].set(this.kdx[i], this.kdz[i], this.A[i], this.QA[i]);
      let ph = (this.phase[i] - this.kdx[i] * cx - this.kdz[i] * cz) % TAU;
      if (ph < 0) ph += TAU;
      B[i].set(ph, this.k[i], 0, 0);
    }
  }

  // Same wave fade the vertex shader applies for a given mesh sample spacing (m). Call before height/normal.
  setSpacing(spacing) {
    if (spacing === this._fwSpacing) return;
    this._fwSpacing = spacing;
    for (let i = 0; i < NUM_WAVES; i++) {
      const lam = TAU / this.k[i], e0 = lam * 0.12, e1 = lam * 0.28;   // >= 3.5 samples per wavelength: no ring moiré
      let t = (spacing - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t;
      this.fw[i] = 1 - t * t * (3 - 2 * t);
    }
  }

  displacement(x0, z0, out, att = 1) {
    let X = 0, Y = 0, Z = 0;
    for (let i = 0; i < NUM_WAVES; i++) {
      const th = this.kdx[i] * x0 + this.kdz[i] * z0 - this.phase[i];
      const c = Math.cos(th), s = Math.sin(th), f = this.fw[i], qa = this.QA[i] * f;
      X += qa * this.dx[i] * c; Z += qa * this.dz[i] * c; Y += this.A[i] * f * s;
    }
    out.x = X * att; out.y = Y * att; out.z = Z * att;
    return out;
  }

  // find undisplaced p0 whose displaced xz == (x,z): Newton iterations on F(p0) = p0 + D(p0) - p (2x2 Jacobian),
  // then the height at p0. Converges to ~1e-5 m in 2–3 steps even for storm seas.
  _invert(x, z, att = 1) {
    let x0 = x, z0 = z;
    const kdx = this.kdx, kdz = this.kdz, ph = this.phase, dxA = this.dx, dzA = this.dz, QA = this.QA, fw = this.fw, k = this.k;
    for (let it = 0; it < 3; it++) {
      let X = 0, Z = 0, jxx = 1, jxz = 0, jzz = 1;
      for (let i = 0; i < NUM_WAVES; i++) {
        const qa = QA[i] * fw[i] * att;
        if (qa < 1e-4) continue;
        const th = kdx[i] * x0 + kdz[i] * z0 - ph[i];
        const c = Math.cos(th) * qa, sk = Math.sin(th) * qa * k[i];
        const dx = dxA[i], dz = dzA[i];
        X += dx * c; Z += dz * c;
        jxx -= sk * dx * dx; jxz -= sk * dx * dz; jzz -= sk * dz * dz;
      }
      const fx = x0 + X - x, fz = z0 + Z - z;
      const det = jxx * jzz - jxz * jxz;
      if (Math.abs(det) < 1e-3) { x0 -= fx; z0 -= fz; }
      else { x0 -= (jzz * fx - jxz * fz) / det; z0 -= (jxx * fz - jxz * fx) / det; }
      if (fx * fx + fz * fz < 1e-8) break;
    }
    this._x0 = x0; this._z0 = z0;
  }

  height(x, z, att = 1) {
    this._invert(x, z, att);
    const x0 = this._x0, z0 = this._z0;
    let Y = 0;
    for (let i = 0; i < NUM_WAVES; i++) Y += this.A[i] * this.fw[i] * Math.sin(this.kdx[i] * x0 + this.kdz[i] * z0 - this.phase[i]);
    return Y * att;
  }

  normal(x, z, out, att = 1) {
    this._invert(x, z, att);
    return this.normalAtGrid(this._x0, this._z0, out, att);
  }

  normalAtGrid(x0, z0, out, att = 1) {
    // tangents dP/dx0 and dP/dz0
    let txx = 1, txy = 0, txz = 0, tzx = 0, tzy = 0, tzz = 1;
    for (let i = 0; i < NUM_WAVES; i++) {
      const th = this.kdx[i] * x0 + this.kdz[i] * z0 - this.phase[i];
      const c = Math.cos(th), s = Math.sin(th);
      const k = this.k[i], dx = this.dx[i], dz = this.dz[i], f = this.fw[i] * att, q = this.QA[i] * k * s * f, a = this.A[i] * k * c * f;
      txx -= q * dx * dx; txz -= q * dx * dz; txy += a * dx;
      tzx -= q * dx * dz; tzz -= q * dz * dz; tzy += a * dz;
    }
    // N = Tz x Tx
    const nx = tzy * txz - tzz * txy, ny = tzz * txx - tzx * txz, nz = tzx * txy - tzy * txx;
    const l = Math.hypot(nx, ny, nz) || 1;
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }
}

// GLSL twin. uFilterSpacing: geometric sample spacing (m) -> fades waves the mesh cannot represent.
export const GLSL_WAVES = /* glsl */`
#define NUM_WAVES ${NUM_WAVES}
uniform vec4 uWave[NUM_WAVES];   // k*dx, k*dz, A, QA
uniform vec4 uWaveB[NUM_WAVES];  // phase, k
// p: position relative to the origin passed to writeUniforms; att: shallow-water factor
vec3 gerstnerDisp(vec2 p, float spacing, float att) {
  vec3 d = vec3(0.0);
  for (int i = 0; i < NUM_WAVES; i++) {
    vec4 w = uWave[i]; vec4 b = uWaveB[i];
    float lam = 6.2831853 / b.y;
    float f = 1.0 - smoothstep(lam * 0.12, lam * 0.28, spacing);
    float th = dot(w.xy, p) - b.x;
    float c = cos(th), s = sin(th);
    vec2 dir = w.xy / b.y;
    d.xz += w.w * f * dir * c;
    d.y += w.z * f * s;
  }
  return d * att;
}
// returns normal; jac = Jacobian determinant of horizontal map (1 = flat, ->0 = folding crest)
vec3 gerstnerNormal(vec2 p, float footprint, float att, out float jac) {
  vec3 tx = vec3(1.0, 0.0, 0.0), tz = vec3(0.0, 0.0, 1.0);
  for (int i = 0; i < NUM_WAVES; i++) {
    vec4 w = uWave[i]; vec4 b = uWaveB[i];
    float lam = 6.2831853 / b.y;
    float f = smoothstep(footprint * 2.5, footprint * 8.0, lam)  /* stronger: far-sea moiré bands */ * att;
    float th = dot(w.xy, p) - b.x;
    float c = cos(th), s = sin(th);
    vec2 dir = w.xy / b.y;
    float q = w.w * b.y * s * f, a = w.z * b.y * c * f;
    tx += vec3(-q * dir.x * dir.x, a * dir.x, -q * dir.x * dir.y);
    tz += vec3(-q * dir.x * dir.y, a * dir.y, -q * dir.y * dir.y);
  }
  jac = tx.x * tz.z - tx.z * tz.x;
  return normalize(cross(tz, tx));
}
`;
