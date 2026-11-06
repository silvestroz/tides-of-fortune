// Rain streaks (one draw call, GPU-animated in a box wrapped around the camera) and lightning
// (flash envelope + jagged bolt mesh that blooms). Driven by Sky; intensity 0..1.
// API: new Rain() ; .mesh ; .update(dt, t, camera, wind, intensity, lightColor)
//      new Lightning(rand) ; .mesh ; .flash (0..~2, read by sky) ; .dir (Vector3) ; .update(dt, camera, stormAmount) ; .strike(camera)
import * as THREE from 'three';
import { mulberry32 } from '../../core/rng.js';

const BOX = 90;          // rain volume half-size (m)
const N_DROPS = 9000;

export class Rain {
  constructor() {
    const rnd = mulberry32(777);
    const pos = new Float32Array(N_DROPS * 2 * 3);
    const seed = new Float32Array(N_DROPS * 2 * 2);
    for (let i = 0; i < N_DROPS; i++) {
      const x = rnd() * 2 - 1, y = rnd(), z = rnd() * 2 - 1, s = rnd();
      for (let e = 0; e < 2; e++) {
        const k = i * 2 + e;
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        seed[k * 2] = e; seed[k * 2 + 1] = s;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
    this.uniforms = {
      uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uIntensity: { value: 0 },
      uWind: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute vec2 aSeed;
        uniform vec3 uCam; uniform float uTime, uIntensity; uniform vec2 uWind;
        varying float vA;
        void main() {
          float B = ${BOX.toFixed(1)};
          float speed = 26.0 + aSeed.y * 10.0;
          vec3 vel = vec3( uWind.x, -speed, uWind.y );
          vec3 p = vec3( position.x * B, position.y * 2.0 * B, position.z * B );
          p += vel * uTime;
          // wrap into a box around the camera
          vec3 rel = p - uCam;
          rel.xz = mod( rel.xz + B, 2.0 * B ) - B;
          rel.y = mod( rel.y + B * 0.6, 2.0 * B ) - B * 0.6;
          vec3 wp = uCam + rel;
          wp -= normalize( vel ) * aSeed.x * ( 1.1 + aSeed.y * 0.9 ); // streak tail
          float dist = length( rel );
          vA = uIntensity * step( aSeed.y, uIntensity * 1.1 ) * smoothstep( B, B * 0.5, dist ) * smoothstep( 1.5, 5.0, dist ) * ( 1.0 - aSeed.x * 0.85 );
          vA *= step( 0.0, wp.y ); // no rain under the sea
          gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; varying float vA;
        void main() { gl_FragColor = vec4( uColor * vA * 0.35, 1.0 ); }`,
    });
    this.mesh = new THREE.LineSegments(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
  }
  update(dt, t, camera, wind, intensity, ambient) {
    this.mesh.visible = intensity > 0.02;
    const u = this.uniforms;
    u.uCam.value.copy(camera.position);
    u.uTime.value = t;
    u.uIntensity.value = intensity;
    u.uWind.value.set(Math.sin(wind.angle) * wind.speed * 0.6, -Math.cos(wind.angle) * wind.speed * 0.6);
    u.uColor.value.copy(ambient).multiplyScalar(0.9).addScalar(0.08);
  }
}

export class Lightning {
  constructor() {
    this.rnd = mulberry32(31337);
    this.flash = 0;
    this.dir = new THREE.Vector3(1, 0.3, 0).normalize();
    this.timer = 3;
    this._env = [];     // pending flicker pulses [time, strength]
    this._t = 0;
    // bolt = camera-facing triangle ribbons: a hot core + a wide soft glow (additive, HDR so bloom catches it)
    const MAXQ = 200;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXQ * 4 * 3), 3));
    this.geo.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(MAXQ * 4), 1));
    this.geo.setAttribute('aCore', new THREE.BufferAttribute(new Float32Array(MAXQ * 4), 1));
    const idx = [];
    for (let q = 0; q < MAXQ; q++) idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2);
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 1 } },
      vertexShader: 'attribute float aSide; attribute float aCore; varying float vS; varying float vC; void main(){ vS=aSide; vC=aCore; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform float uOpacity; varying float vS; varying float vC; void main(){ float x=abs(vS); float core=smoothstep(1.0,0.0,x/0.18)*vC; float glow=exp(-x*x*5.0); vec3 c=vec3(0.75,0.82,1.0)*(core*14.0+glow*mix(1.2,0.5,vC)); gl_FragColor=vec4(c*uOpacity,1.0); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: true,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = -800;
  }
  _buildBolt(start, end, camPos) {
    const segs = [];
    const r = this.rnd;
    const seg = (a, b, depth) => {
      const steps = depth === 0 ? 24 : 8;
      let prev = a.clone();
      const len = a.distanceTo(b);
      for (let i = 1; i <= steps && segs.length < 190; i++) {
        const t = i / steps;
        const p = a.clone().lerp(b, t);
        if (i < steps) { p.x += (r() - 0.5) * len * 0.09; p.z += (r() - 0.5) * len * 0.09; p.y += (r() - 0.5) * len * 0.03; }
        segs.push([prev, p, depth]);
        if (depth < 2 && r() < (depth === 0 ? 0.3 : 0.15) && i < steps - 2) {
          const bEnd = p.clone().add(new THREE.Vector3((r() - 0.5) * len * 0.35, -len * (0.12 + r() * 0.2), (r() - 0.5) * len * 0.35));
          seg(p, bEnd, depth + 1);
        }
        prev = p;
      }
    };
    seg(start, end, 0);
    const pos = this.geo.attributes.position.array, side = this.geo.attributes.aSide.array, core = this.geo.attributes.aCore.array;
    const dir = new THREE.Vector3(), toCam = new THREE.Vector3(), perp = new THREE.Vector3();
    const dist = start.distanceTo(camPos);
    segs.forEach(([a, b, depth], q) => {
      dir.subVectors(b, a).normalize();
      toCam.subVectors(camPos, a).normalize();
      perp.crossVectors(dir, toCam).normalize();
      const w = dist * (depth === 0 ? 0.012 : depth === 1 ? 0.006 : 0.0035);   // ~ constant pixel width
      const c = depth === 0 ? 1 : 0.6;
      const P = [[a, -1], [a, 1], [b, -1], [b, 1]];
      P.forEach(([v, sg], k) => {
        const i = q * 4 + k;
        pos[i * 3] = v.x + perp.x * w * sg; pos[i * 3 + 1] = v.y + perp.y * w * sg; pos[i * 3 + 2] = v.z + perp.z * w * sg;
        side[i] = sg; core[i] = c;
      });
    });
    this.geo.setDrawRange(0, segs.length * 6);
    for (const k of ['position', 'aSide', 'aCore']) this.geo.attributes[k].needsUpdate = true;
  }
  strike(camera, opts = {}) {
    const r = this.rnd;
    // place the bolt somewhere in front-ish of the camera, 1.5–5 km away
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const ang = opts.angle ?? (r() - 0.5) * 1.6;
    const d = new THREE.Vector3(fwd.x * Math.cos(ang) - fwd.z * Math.sin(ang), 0, fwd.x * Math.sin(ang) + fwd.z * Math.cos(ang));
    const dist = opts.dist ?? (1500 + r() * 3500);
    const base = camera.position.clone().addScaledVector(d, dist); base.y = 0;
    const top = base.clone().add(new THREE.Vector3((r() - 0.5) * 300, 650 + r() * 250, (r() - 0.5) * 300));
    this._buildBolt(top, base, camera.position);
    this.dir.copy(top).sub(camera.position).normalize();
    this._t = 0;
    this._env = [[0, 1.0], [0.09, 0.55], [0.17, 1.0 * (0.6 + r() * 0.5)], [0.33, 0.4]];
    this.mesh.visible = true;
  }
  update(dt, camera, storm) {
    this._t += dt;
    if (storm > 0.55) {
      this.timer -= dt;
      if (this.timer <= 0) { this.strike(camera); this.timer = 4 + this.rnd() * 9 / storm; }
    }
    // flash envelope: sum of decaying pulses
    let f = 0;
    for (const [t0, s] of this._env) { const k = this._t - t0; if (k >= 0) f += s * Math.exp(-k * 14); }
    this.flash = f;
    this.mesh.visible = f > 0.05;
    this.material.uniforms.uOpacity.value = Math.min(1.5, f);
  }
}
