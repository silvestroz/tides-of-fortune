// Visual effects: muzzle flashes, gun smoke, splashes, splinters, fires, debris, wreckage and shot holes.
// API (anyone may call):
//   fx.muzzleFlash(position, direction)
//   fx.smoke(position, direction, amount)
//   fx.splash(position, size)
//   fx.splinters(position, normal, amount)
//   fx.fire(attachObject3D, intensity) -> handle { stop() }
//   fx.explosion(position, size)
//   fx.update(dt, t)
// Extensions:
//   fx.cannonShot(position, direction, inheritVel?)  flash + light pop + smoke bank, one call per gun
//   fx.wreckage(position, amount, spread)            floating planks / barrels that bob on the ocean and fade out
//   fx.flotsam(position, n, { fx, fz, len, sx, sz })  barrels thrown overboard from the hold (I), drift astern and sink
//   fx.bubbles(position, radius, amount)              foamy boil at the surface (sinking ships)
//   fx.foamRing(position, radius)                     expanding foam ring on the water
//   fx.fire(...) handle also has .intensity (0..1, settable), .offset (local Vector3)
//   fx.shotHole(ship, worldPos, normal)              persistent shot-hole decal stuck to the ship hull (max 24 per ship)
//   fx.stats() -> { particles, debris, wreck, fires }
// All effects are pooled (fixed-capacity buffers, no per-frame allocation). Smoke drifts with game.wind,
// particles are lit by game.sky.sunDir / sunColor, flashes and flames are HDR-bright (bloom-friendly).
import * as THREE from 'three';
import { ParticleSystem } from './particles.js';
import { makeParticleAtlas, makeWoodTexture } from './textures.js';
import { mulberry32 } from '../core/rng.js';
import { QUALITY } from '../core/constants.js';

const F_SMOKE = 0, F_FLAME = 1, F_SPRAY = 2, F_GLOW = 3;
// ultra: denser VFX (QUALITY.particles, 1.6) with slightly smaller sprites, so smoke, spray and flames carry more
// detail at the same coverage. 1 in the other tiers.
let PM = 1, PS = 1;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _q2 = new THREE.Quaternion();
const _m4 = new THREE.Matrix4(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

const MAX_LIGHTS = 4;
const MAX_DEBRIS = 400;
const MAX_WRECK = 160;
const MAX_RINGS = 64;

export class FX {
  constructor(game) {
    this.game = game;
    this.rand = mulberry32(777);
    PM = QUALITY.particles || 1; PS = Math.pow(1 / PM, 0.25);
    const atlas = this.atlas = makeParticleAtlas();
    // alpha-blended lit smoke/spray; additive flames/flashes/embers
    this.smokePS = new ParticleSystem({ capacity: Math.round(3000 * PM), atlas, renderOrder: 12 });
    this.glowPS = new ParticleSystem({ capacity: Math.round(1500 * PM), atlas, additive: true, renderOrder: 13 });
    game.scene.add(this.smokePS.mesh, this.glowPS.mesh);

    this._ctx = {
      camera: game.camera, windX: 0, windZ: 0, sunDir: new THREE.Vector3(0, 1, 0), sunColor: new THREE.Color(1, 1, 1),
      ambient: new THREE.Color(0.45, 0.5, 0.58), waterY: (x, z) => this.waterY(x, z),
    };

    // ---- flash lights (fixed count so materials never recompile) ----
    this.lights = [];
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 60, 1.6);
      l.userData.t = 0; l.userData.dur = 0.2; l.userData.peak = 0;
      game.scene.add(l); this.lights.push(l);
    }
    this._lightCursor = 0;

    // ---- debris: instanced wood splinters / chunks with simple ballistic + spin ----
    const wood = makeWoodTexture();
    this.woodMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.85, metalness: 0 });
    const dGeo = new THREE.BoxGeometry(1, 1, 1);
    this.debris = new THREE.InstancedMesh(dGeo, this.woodMat, MAX_DEBRIS);
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debris.count = 0; this.debris.frustumCulled = false; this.debris.castShadow = true;
    this.dd = {
      n: 0, x: new Float32Array(MAX_DEBRIS), y: new Float32Array(MAX_DEBRIS), z: new Float32Array(MAX_DEBRIS),
      vx: new Float32Array(MAX_DEBRIS), vy: new Float32Array(MAX_DEBRIS), vz: new Float32Array(MAX_DEBRIS),
      rx: new Float32Array(MAX_DEBRIS), ry: new Float32Array(MAX_DEBRIS), rz: new Float32Array(MAX_DEBRIS),
      wx: new Float32Array(MAX_DEBRIS), wy: new Float32Array(MAX_DEBRIS), wz: new Float32Array(MAX_DEBRIS),
      sx: new Float32Array(MAX_DEBRIS), sy: new Float32Array(MAX_DEBRIS), sz: new Float32Array(MAX_DEBRIS),
      life: new Float32Array(MAX_DEBRIS), floating: new Uint8Array(MAX_DEBRIS),
    };
    game.scene.add(this.debris);

    // ---- floating wreckage: planks + barrels, bob on waves, slowly sink ----
    this.wreckPlanks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.woodMat, MAX_WRECK);
    const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.1, 10);
    barrelGeo.rotateZ(Math.PI / 2);
    this.wreckBarrels = new THREE.InstancedMesh(barrelGeo, new THREE.MeshStandardMaterial({ color: 0x7a4f28, map: wood, roughness: 0.8 }), MAX_WRECK / 4);
    for (const m of [this.wreckPlanks, this.wreckBarrels]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = false; m.castShadow = true;
      game.scene.add(m);
    }
    const W = MAX_WRECK;
    this.wd = {
      n: 0, x: new Float32Array(W), z: new Float32Array(W), vx: new Float32Array(W), vz: new Float32Array(W),
      yaw: new Float32Array(W), yawV: new Float32Array(W), sx: new Float32Array(W), sy: new Float32Array(W), sz: new Float32Array(W),
      age: new Float32Array(W), life: new Float32Array(W), barrel: new Uint8Array(W), ph: new Float32Array(W), sink: new Float32Array(W),
    };

    // ---- foam rings on water (flat instanced quads with procedural ring shader) ----
    const ringGeo = new THREE.PlaneGeometry(1, 1); ringGeo.rotateX(-Math.PI / 2);
    this.ringAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RINGS * 2), 2);
    this.ringAttr.setUsage(THREE.DynamicDrawUsage);
    ringGeo.setAttribute('iRing', this.ringAttr);
    this.ringMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uSun: { value: new THREE.Color(1, 1, 1) } }]),
      vertexShader: /* glsl */`
        attribute vec2 iRing; varying vec2 vUv; varying vec2 vR;
        #include <fog_pars_vertex>
        void main(){ vUv = uv*2.0-1.0; vR = iRing;
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position,1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSun; varying vec2 vUv; varying vec2 vR;
        #include <fog_pars_fragment>
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){
          float r = length(vUv); float t = vR.x;  // t = 0..1 life
          float ringR = 0.35 + 0.6*t; float w = 0.05 + 0.1*t;   // round 6: thin lacy ring, no disc
          float ring = smoothstep(w, 0.0, abs(r - ringR));
          float inner = smoothstep(ringR, 0.0, r) * (1.0 - t) * (1.0 - t) * 0.12;   // round 6: no opaque splash disc
          float a = max(ring, inner);
          float lace = n(vUv*9.0 + vR.y*17.0) * n(vUv*23.0 - vR.y*5.0);
          a *= smoothstep(0.08, 0.5, lace + 0.25*(1.0-t));
          a *= (1.0 - t) * smoothstep(1.0, 0.9, r);
          if (a < 0.003) discard;
          gl_FragColor = vec4(vec3(0.96,0.99,0.98) * (0.55 + 0.6*uSun), a * 0.6);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.rings = new THREE.InstancedMesh(ringGeo, this.ringMat, MAX_RINGS);
    this.rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rings.count = 0; this.rings.frustumCulled = false; this.rings.renderOrder = 5;
    this.rd = { n: 0, x: new Float32Array(MAX_RINGS), z: new Float32Array(MAX_RINGS), r: new Float32Array(MAX_RINGS),
      age: new Float32Array(MAX_RINGS), life: new Float32Array(MAX_RINGS), seed: new Float32Array(MAX_RINGS) };
    game.scene.add(this.rings);

    // ---- falling spars: broken topmasts topple overboard and float away; one instanced draw call ----
    const sparGeo = new THREE.CylinderGeometry(0.7, 1, 1, 7, 1); sparGeo.translate(0, 0.5, 0);
    this.spars = new THREE.InstancedMesh(sparGeo, new THREE.MeshStandardMaterial({ color: 0x8a6a48, map: wood, roughness: 0.85 }), 16);
    this.spars.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.spars.count = 0; this.spars.frustumCulled = false; this.spars.castShadow = true;
    game.scene.add(this.spars);
    this.fallen = [];
    // ---- attached fires ----
    this.fires = [];
    this._holeMat();   // perf: build the shot-hole decal material + canvas texture at load, not on the first hit
    // delayed emits (rippling volleys etc.) — fixed ring buffer of closures avoided: combat schedules its own.
    this._t = 0;
  }

  r() { return this.rand(); }
  rs() { return this.rand() * 2 - 1; }
  waterY(x, z) { return this.game.ocean?.getHeight ? this.game.ocean.getHeight(x, z) : 0; }

  // ----------------------------------------------------------------- lights
  lightPop(pos, intensity = 60, dur = 0.18, color = 0xffb060, range = 70) {
    const l = this.lights[this._lightCursor]; this._lightCursor = (this._lightCursor + 1) % MAX_LIGHTS;
    l.position.copy(pos); l.color.set(color); l.distance = range;
    l.userData.t = 0; l.userData.dur = dur; l.userData.peak = intensity; l.intensity = intensity;
  }

  // ----------------------------------------------------------------- cannon
  muzzleFlash(pos, dir) {
    const P = this.glowPS, p = P.p;
    // core blast
    p.reset(); p.x = pos.x; p.y = pos.y; p.z = pos.z; p.frame = F_GLOW; p.life = 0.26; p.s0 = 8; p.s1 = 12; p.sizePow = 3;
    p.r = 1.0; p.g = 0.8; p.b = 0.45; p.r1 = 1; p.g1 = 0.4; p.b1 = 0.1; p.a = 1; p.fadeIn = 0; p.fadePow = 1.8; p.emis = 6; p.emisPow = 1;   // tighter core: the flame tongue carries the shape, no white blob
    P.emit();
    // directional flame tongue
    for (let i = 0; i < 8; i++) {
      const k = 0.6 + i * 0.9;
      p.reset(); p.x = pos.x + dir.x * k; p.y = pos.y + dir.y * k + 0.1; p.z = pos.z + dir.z * k;
      p.vx = dir.x * (22 + this.r() * 12); p.vy = dir.y * 20 + this.rs() * 2; p.vz = dir.z * (22 + this.r() * 12); p.drag = 9;
      p.frame = F_FLAME; p.life = 0.25 + this.r() * 0.12; p.s0 = 5.5 - i * 0.4; p.s1 = 7; p.rot = Math.PI / 2 + this.rs() * 0.4;
      p.r = 1; p.g = 0.75; p.b = 0.35; p.r1 = 0.9; p.g1 = 0.25; p.b1 = 0.05; p.a = 0.95; p.fadeIn = 0; p.emis = 5; p.emisPow = 1;
      p.stretch = 0.04;
      P.emit();
    }
    // sparks
    for (let i = 0; i < 8; i++) {
      p.reset(); p.x = pos.x; p.y = pos.y; p.z = pos.z;
      const sp = 18 + this.r() * 25;
      p.vx = dir.x * sp + this.rs() * 7; p.vy = dir.y * sp + this.r() * 6; p.vz = dir.z * sp + this.rs() * 7;
      p.accel = -9; p.drag = 1.5; p.frame = F_GLOW; p.life = 0.3 + this.r() * 0.5; p.s0 = 0.22; p.s1 = 0.12;
      p.r = 1; p.g = 0.7; p.b = 0.3; p.r1 = 0.8; p.g1 = 0.2; p.b1 = 0.02; p.a = 1; p.fadeIn = 0; p.emis = 6; p.stretch = 0.05;
      p.killWater = 1;
      P.emit();
    }
  }

  // billowing gun smoke: a dense jet out of the port that blooms into a slow, wind-carried bank
  smoke(pos, dir, amount = 1) {
    const P = this.smokePS, p = P.p;
    const n = Math.round(16 * amount * PM);
    for (let i = 0; i < n; i++) {
      const f = i / n;
      const sp = (4 + 26 * (1 - f) * (0.6 + this.r() * 0.6));
      p.reset();
      p.x = pos.x + dir.x * (1 + f * 2) + this.rs() * 0.6; p.y = pos.y + this.rs() * 0.4; p.z = pos.z + dir.z * (1 + f * 2) + this.rs() * 0.6;
      p.vx = dir.x * sp + this.rs() * 2.5; p.vy = dir.y * sp + 0.6 + this.r() * 1.8; p.vz = dir.z * sp + this.rs() * 2.5;
      p.drag = 1.4 + this.r() * 0.6; p.wind = 0.6 + this.r() * 0.3; p.accel = 0.9 + this.r() * 0.6;
      p.frame = F_SMOKE; p.life = 10 + this.r() * 8 * amount; p.s0 = (2.6 + this.r() * 2) * PS; p.s1 = (15 + this.r() * 11 * amount) * PS; p.sizePow = 5;
      p.rot = this.r() * 6.28; p.rotV = this.rs() * 0.25;
      const shade = 0.62 + this.r() * 0.2;
      p.r = shade; p.g = shade * 0.97; p.b = shade * 0.93; p.r1 = 0.74; p.g1 = 0.74; p.b1 = 0.73;
      p.a = 0.6 + this.r() * 0.3; p.fadeIn = 0.02; p.fadePow = 1.1;
      p.emis = f < 0.3 ? 1.2 : 0; p.emisPow = 16;   // hot first puffs glow orange for an instant
      P.emit();
    }
    // a few long curling ribbons that peel off the bank and trail downwind, so the smoke reads
    // as volutes rather than a cotton ball at 50-150 m (velocity-stretched smoke sprites, slow spin, low alpha)
    const nr = Math.round((3 + 2 * amount) * Math.sqrt(PM));
    for (let i = 0; i < nr; i++) {
      p.reset();
      const sp = 7 + this.r() * 9, side = this.rs();
      p.x = pos.x + dir.x * 3; p.y = pos.y + 0.5 + this.r(); p.z = pos.z + dir.z * 3;
      p.vx = dir.x * sp - dir.z * side * 3; p.vy = 1.2 + this.r() * 2.2; p.vz = dir.z * sp + dir.x * side * 3;
      p.drag = 0.55; p.wind = 0.85; p.accel = 0.5;
      p.frame = F_SMOKE; p.life = 12 + this.r() * 6; p.s0 = 2 * PS; p.s1 = (8 + this.r() * 6) * PS; p.sizePow = 2;
      p.stretch = 0.35 + this.r() * 0.25; p.rot = this.r() * 6.28; p.rotV = this.rs() * 0.5;
      const sh = 0.7 + this.r() * 0.15;
      p.r = sh; p.g = sh * 0.97; p.b = sh * 0.93; p.r1 = 0.78; p.g1 = 0.78; p.b1 = 0.77;
      p.a = 0.32 + this.r() * 0.16; p.fadeIn = 0.06; p.fadePow = 1.3;
      P.emit();
    }
  }

  cannonShot(pos, dir, vel) {
    this.muzzleFlash(pos, dir);
    this.smoke(pos, dir, 1);
    this.lightPop(_v.copy(pos).addScaledVector(dir, 2), 260, 0.2, 0xffa850, 110);
    // shock ripple on the water below the port
    const wy = this.waterY(pos.x, pos.z);
    if (pos.y - wy < 4) this.foamRing(_v.set(pos.x + dir.x * 3, wy, pos.z + dir.z * 3), 7);
  }

  // ----------------------------------------------------------------- water
  splash(pos, size = 1) {
    const P = this.smokePS, p = P.p;
    const wy = this.waterY(pos.x, pos.z);
    const s = size * 2.3;
    this.game.ocean?.addFoam?.(pos.x, pos.z, 2.5 * s, 0.7);
    // a narrow white column of streaked spray that shoots up and falls back as a curtain (no flat disc):
    // velocity-stretched SPRAY sprites only, sizes kept small so the shape comes from the streaks, not one big blob
    const nCol = Math.round((22 * s + 6) * PM);
    for (let i = 0; i < nCol; i++) {
      const k = this.r();
      p.reset(); p.x = pos.x + this.rs() * 0.5 * s; p.y = wy + 0.2; p.z = pos.z + this.rs() * 0.5 * s;
      const up = (9 + k * 15) * Math.sqrt(s);
      p.vx = this.rs() * 1.1 * s; p.vy = up; p.vz = this.rs() * 1.1 * s;
      p.accel = -13; p.drag = 0.25; p.frame = F_SPRAY;
      p.life = 1.3 + this.r() * 0.8; p.s0 = (0.9 + this.r() * 0.6) * s; p.s1 = (2.2 + this.r() * 1.6) * s; p.sizePow = 1.2;
      p.rot = this.r() * 6.28; p.stretch = 0.07; p.killWater = 1;
      p.r = 0.96; p.g = 0.99; p.b = 1.0; p.a = 0.9; p.fadeIn = 0.0; p.fadePow = 1.6;
      P.emit();
    }
    // a few soft puffs inside the column body (volume, kept small and short-lived)
    for (let i = 0; i < 4 + 3 * s; i++) {
      p.reset(); p.x = pos.x + this.rs() * 0.6 * s; p.y = wy + 1 + this.r() * 4 * s; p.z = pos.z + this.rs() * 0.6 * s;
      p.vy = 6 + this.r() * 6; p.accel = -9; p.drag = 0.8; p.frame = F_SMOKE;
      p.life = 0.9 + this.r() * 0.5; p.s0 = 1.2 * s; p.s1 = 3.2 * s; p.rot = this.r() * 6.28;
      p.r = 0.94; p.g = 0.97; p.b = 1.0; p.a = 0.5; p.fadeIn = 0.05; p.fadePow = 1.4;
      P.emit();
    }
    // low radial crown of droplets
    const nCrown = Math.round((14 * s + 4) * PM);
    for (let i = 0; i < nCrown; i++) {
      const a = (i / nCrown) * 6.283 + this.rs() * 0.3, sp = (3 + this.r() * 4) * s;
      p.reset(); p.x = pos.x; p.y = wy + 0.3; p.z = pos.z;
      p.vx = Math.cos(a) * sp; p.vy = (4 + this.r() * 4) * Math.sqrt(s); p.vz = Math.sin(a) * sp;
      p.accel = -14; p.frame = F_SPRAY; p.life = 0.7 + this.r() * 0.5; p.s0 = 0.4 * s; p.s1 = 1.1 * s;
      p.r = 0.93; p.g = 0.97; p.b = 1; p.a = 0.8; p.fadeIn = 0; p.stretch = 0.08; p.killWater = 1;
      P.emit();
    }
    // faint drifting mist after the fall (low alpha, small: no opaque disc)
    for (let i = 0; i < 2 + 2 * s; i++) {
      p.reset(); p.x = pos.x + this.rs() * 1.5 * s; p.y = wy + 1.5 + this.r() * 3 * s; p.z = pos.z + this.rs() * 1.5 * s;
      p.vy = 0.5; p.drag = 0.6; p.wind = 0.5; p.frame = F_SMOKE; p.life = 2 + this.r() * 1.5; p.s0 = 2 * s; p.s1 = 5 * s;
      p.r = 0.9; p.g = 0.95; p.b = 0.98; p.a = 0.14; p.fadeIn = 0.3; p.rot = this.r() * 6.28;
      P.emit();
    }
    this.foamRing(_v.set(pos.x, wy, pos.z), 3.5 * s + 2);
  }

  foamRing(pos, radius = 6, life = 3.5) {
    if (radius > 8) this.game.ocean?.addFoam?.(pos.x, pos.z, radius, 1);
    const R = this.rd;
    let i = R.n < MAX_RINGS ? R.n++ : this._oldestRing();
    R.x[i] = pos.x; R.z[i] = pos.z; R.r[i] = radius; R.age[i] = 0; R.life[i] = life; R.seed[i] = this.r() * 10;
  }
  _oldestRing() { const R = this.rd; let b = 0; for (let i = 1; i < R.n; i++) if (R.age[i] / R.life[i] > R.age[b] / R.life[b]) b = i; return b; }

  bubbles(pos, radius = 4, amount = 1) {
    this.game.ocean?.addFoam?.(pos.x + this.rs() * radius, pos.z + this.rs() * radius, radius * 1.2, 0.8 * amount);
    const P = this.smokePS, p = P.p;
    for (let i = 0; i < Math.round(6 * amount); i++) {
      const a = this.r() * 6.28, d = Math.sqrt(this.r()) * radius;
      const x = pos.x + Math.cos(a) * d, z = pos.z + Math.sin(a) * d, wy = this.waterY(x, z);
      p.reset(); p.x = x; p.y = wy + 0.1; p.z = z; p.vy = 2.5 + this.r() * 3; p.accel = -10; p.vx = this.rs(); p.vz = this.rs();
      p.frame = F_SPRAY; p.life = 0.5 + this.r() * 0.4; p.s0 = 0.6; p.s1 = 1.8; p.r = 0.95; p.g = 1; p.b = 1; p.a = 0.85; p.fadeIn = 0;
      p.killWater = 1;
      P.emit();
    }
    if (this.r() < 0.35 * amount) this.foamRing(_v.set(pos.x + this.rs() * radius, this.waterY(pos.x, pos.z), pos.z + this.rs() * radius), radius * 0.8, 2.5);
  }

  // ----------------------------------------------------------------- impacts
  splinters(pos, normal, amount = 1) {
    const D = this.dd;
    const n = Math.round(22 * amount);
    for (let k = 0; k < n; k++) {
      let i = D.n < MAX_DEBRIS ? D.n++ : Math.floor(this.r() * MAX_DEBRIS);
      const sp = 6 + this.r() * 16;
      D.x[i] = pos.x; D.y[i] = pos.y; D.z[i] = pos.z;
      D.vx[i] = normal.x * sp + this.rs() * 7; D.vy[i] = Math.abs(normal.y) * sp + 3 + this.r() * 9; D.vz[i] = normal.z * sp + this.rs() * 7;
      D.rx[i] = this.r() * 6; D.ry[i] = this.r() * 6; D.rz[i] = this.r() * 6;
      D.wx[i] = this.rs() * 14; D.wy[i] = this.rs() * 14; D.wz[i] = this.rs() * 14;
      const big = this.r() < 0.3;
      D.sx[i] = big ? 0.25 + this.r() * 0.2 : 0.06 + this.r() * 0.1; D.sy[i] = big ? 0.12 : 0.05 + this.r() * 0.05; D.sz[i] = big ? 1.2 + this.r() * 1.4 : 0.4 + this.r() * 0.9;
      D.life[i] = 5 + this.r() * 4; D.floating[i] = 0;
    }
    // dust / wood-smoke puff + a flash of sparks
    const P = this.smokePS, p = P.p;
    for (let k = 0; k < 6 * amount; k++) {
      p.reset(); p.x = pos.x; p.y = pos.y; p.z = pos.z;
      p.vx = normal.x * (3 + this.r() * 6) + this.rs() * 2; p.vy = 1 + this.r() * 2; p.vz = normal.z * (3 + this.r() * 6) + this.rs() * 2;
      p.drag = 1.2; p.wind = 0.7; p.accel = 0.3; p.frame = F_SMOKE; p.life = 3 + this.r() * 3; p.s0 = 1.2; p.s1 = 6 + this.r() * 4;
      p.r = 0.62; p.g = 0.53; p.b = 0.44; p.r1 = 0.78; p.g1 = 0.76; p.b1 = 0.72; p.a = 0.7; p.rot = this.r() * 6.28; p.fadeIn = 0.02;
      P.emit();
    }
    const G = this.glowPS, g = G.p;
    for (let k = 0; k < 5 * amount; k++) {
      g.reset(); g.x = pos.x; g.y = pos.y; g.z = pos.z;
      g.vx = normal.x * 12 + this.rs() * 8; g.vy = 4 + this.r() * 8; g.vz = normal.z * 12 + this.rs() * 8; g.accel = -9.8;
      g.frame = F_GLOW; g.life = 0.25 + this.r() * 0.3; g.s0 = 0.35; g.s1 = 0.15; g.r = 1; g.g = 0.7; g.b = 0.3; g.a = 1; g.fadeIn = 0; g.emis = 4; g.stretch = 0.05;
      G.emit();
    }
  }

  explosion(pos, size = 1) {
    const s = size;
    this.lightPop(pos, 400 * s, 0.6, 0xffa040, 160 * s);
    const G = this.glowPS, g = G.p;
    // fireball
    for (let i = 0; i < 26 * s; i++) {
      g.reset(); g.x = pos.x + this.rs() * 2 * s; g.y = pos.y + this.r() * 2 * s; g.z = pos.z + this.rs() * 2 * s;
      const sp = (6 + this.r() * 14) * s;
      _v.set(this.rs(), this.r() * 1.4 + 0.2, this.rs()).normalize();
      g.vx = _v.x * sp; g.vy = _v.y * sp; g.vz = _v.z * sp; g.drag = 2.5; g.accel = 3;
      g.frame = this.r() < 0.5 ? F_FLAME : F_GLOW; g.life = 0.6 + this.r() * 0.7; g.s0 = 4 * s; g.s1 = 11 * s; g.sizePow = 3;
      g.r = 1; g.g = 0.85; g.b = 0.5; g.r1 = 0.7; g.g1 = 0.15; g.b1 = 0.02; g.a = 1; g.fadeIn = 0; g.emis = 5; g.emisPow = 1.2; g.rot = this.r() * 6.28;
      G.emit();
    }
    // embers / burning brands
    for (let i = 0; i < 40 * s; i++) {
      g.reset(); g.x = pos.x; g.y = pos.y + 1; g.z = pos.z;
      const sp = (10 + this.r() * 26) * s;
      _v.set(this.rs(), this.r() * 1.5 + 0.3, this.rs()).normalize();
      g.vx = _v.x * sp; g.vy = _v.y * sp; g.vz = _v.z * sp; g.accel = -9.8; g.drag = 0.4;
      g.frame = F_GLOW; g.life = 1.2 + this.r() * 1.8; g.s0 = 0.5; g.s1 = 0.2; g.r = 1; g.g = 0.65; g.b = 0.25; g.r1 = 0.8; g.g1 = 0.2; g.b1 = 0.02;
      g.a = 1; g.fadeIn = 0; g.emis = 4; g.stretch = 0.04; g.killWater = 1;
      G.emit();
    }
    // black-brown smoke column
    const P = this.smokePS, p = P.p;
    for (let i = 0; i < 30 * s; i++) {
      p.reset(); p.x = pos.x + this.rs() * 3 * s; p.y = pos.y + this.r() * 3 * s; p.z = pos.z + this.rs() * 3 * s;
      _v.set(this.rs(), this.r() * 1.8 + 0.4, this.rs()).normalize();
      const sp = (4 + this.r() * 10) * s;
      p.vx = _v.x * sp; p.vy = _v.y * sp + 3; p.vz = _v.z * sp; p.drag = 0.9; p.wind = 0.7; p.accel = 1.8;
      p.frame = F_SMOKE; p.life = 8 + this.r() * 8; p.s0 = 4 * s; p.s1 = (16 + this.r() * 12) * s; p.sizePow = 2.5;
      p.r = 0.2; p.g = 0.17; p.b = 0.15; p.r1 = 0.42; p.g1 = 0.4; p.b1 = 0.4; p.a = 0.85; p.fadeIn = 0.05; p.fadePow = 1.4;
      p.emis = 3; p.emisPow = 6; p.rot = this.r() * 6.28; p.rotV = this.rs() * 0.3;
      P.emit();
    }
    this.splinters(pos, _up, 3 * s);
    this.foamRing(_v.set(pos.x, this.waterY(pos.x, pos.z), pos.z), 18 * s, 5);
  }

  // ----------------------------------------------------------------- hull decals
  _holeMat() {
    if (this._hm) return this._hm;
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d'), rnd = this.rand;
    c.translate(32, 32);
    // soot / scorch halo blown out around the breach (soft, irregular)
    for (let i = 0; i < 7; i++) {
      const a = rnd() * 6.283, d = 2 + rnd() * 5, r = 9 + rnd() * 7;
      const gs = c.createRadialGradient(Math.cos(a) * d, Math.sin(a) * d, 0, Math.cos(a) * d, Math.sin(a) * d, r);
      gs.addColorStop(0, 'rgba(22,14,8,0.55)'); gs.addColorStop(1, 'rgba(22,14,8,0)');
      c.fillStyle = gs; c.beginPath(); c.arc(Math.cos(a) * d, Math.sin(a) * d, r, 0, 6.283); c.fill();
    }
    // splintered pale-wood rim
    for (let i = 0; i < 26; i++) {
      const a = rnd() * 6.283, l = 14 + rnd() * 16;
      c.strokeStyle = `rgba(${200 + rnd() * 40 | 0},${150 + rnd() * 40 | 0},${90 + rnd() * 30 | 0},0.95)`;
      c.lineWidth = 1.5 + rnd() * 2.5;
      c.beginPath(); c.moveTo(Math.cos(a) * 6, Math.sin(a) * 6); c.lineTo(Math.cos(a) * l, Math.sin(a) * l); c.stroke();
    }
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 14);
    g.addColorStop(0, 'rgba(8,5,3,1)'); g.addColorStop(0.7, 'rgba(20,12,6,1)'); g.addColorStop(1, 'rgba(40,24,12,0)');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, 14, 0, 6.283); c.fill();
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    this._hm = new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.1, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false });
    this._hg = new THREE.PlaneGeometry(1, 1);
    return this._hm;
  }
  // perf: compile every lazily-used FX material up front so no shader program is built mid-battle.
  // Compiles against the live scene (its lights/fog) via a throwaway holder scene; called by game.warmup().
  warmup(renderer = this.game.renderer, camera = this.game.camera) {
    const holder = new THREE.Scene();
    const him = new THREE.InstancedMesh(this._hg || (this._holeMat(), this._hg), this._holeMat(), 1); holder.add(him);
    try { renderer.compile(holder, camera, this.game.scene); } catch (e) { console.warn('fx.warmup', e); }
    renderer.initTexture?.(this._hm.map);
  }
  // one InstancedMesh per ship (24 slots, ring buffer): a single draw call instead of one mesh per hole
  shotHole(ship, pos, normal) {
    const grp = ship.model?.group; if (!grp) return;
    let im = ship._holeIM;
    if (!im) {
      this._holeMat();
      im = ship._holeIM = new THREE.InstancedMesh(this._hg, this._hm, 24);
      im.count = 0; im.frustumCulled = false; im.renderOrder = 1; im._next = 0;
      grp.add(im);
    }
    grp.updateWorldMatrix(true, false);
    const lp = _v.copy(pos); grp.worldToLocal(lp);
    // face outward from the hull side (local x), nudge onto the planking
    const side = lp.x >= 0 ? 1 : -1;
    lp.x = side * Math.max(Math.abs(lp.x), ship.beam * 0.47);
    _e.set(0, side * Math.PI / 2, this.r() * 6.28);
    const sc = 1.6 + this.r() * 1.3;   // holes read from the battle camera
    this._holeM = this._holeM || new THREE.Matrix4();
    this._holeM.compose(lp, _q.setFromEuler(_e), _v2.set(sc, sc, sc));
    const i = im._next; im._next = (i + 1) % 24;
    im.setMatrixAt(i, this._holeM); im.count = Math.max(im.count, i + 1);
    im.instanceMatrix.needsUpdate = true;
  }

  // battle damage that persists without open fire: a battered hull (< 55 %) leaks thin dark smoke wisps from
  // its shot holes and deck, thicker as it gets worse, so the state of a target reads at a glance from afar
  _damageSmoke(dt) {
    const P = this.smokePS, p = P.p;
    for (const s of this.game.ships) {
      if (!s.model?.group || s.sinking || !s.hullMax) continue;
      const hf = Math.max(0, s.hull) / s.hullMax;
      if (hf > 0.55) continue;
      const k = (0.55 - hf) / 0.55;
      // below 40 % hull, small flames lick out of the shot holes along the topsides (the
      // fires lit by hits stay on deck); additive glow sprites, a handful per second
      if (hf < 0.4 && this.glowPS.count < this.glowPS.capacity - 200) {
        s._hullFl = (s._hullFl || 0) + dt * (5 + 12 * (0.4 - hf) / 0.4) * PM;
        const G = this.glowPS, g = G.p;
        while (s._hullFl >= 1) {
          s._hullFl -= 1;
          const fx = Math.sin(s.heading), fz = -Math.cos(s.heading);
          // a few fixed spots per ship (seeded by id) so the fire stays in place instead of wandering
          const seed = ((s.id || 1) * 7919 + Math.floor(this.r() * 3) * 131) % 997 / 997;
          const along = (seed - 0.5) * (s.length || 30) * 0.7, sd = (seed > 0.5 ? 1 : -1) * (s.beam || 8) * 0.5;
          g.reset();
          g.x = s.position.x + fx * along + fz * sd + this.rs() * 0.8; g.y = s.position.y + 1.2 + this.r() * 1.5; g.z = s.position.z + fz * along - fx * sd + this.rs() * 0.8;
          g.vx = fz * sd * 0.15 + this.rs() * 0.5; g.vy = 2.5 + this.r() * 3; g.vz = -fx * sd * 0.15 + this.rs() * 0.5;
          g.wind = 0.3; g.drag = 0.8; g.accel = 2.5;
          g.frame = F_FLAME; g.life = 0.45 + this.r() * 0.4; g.s0 = (1.6 + this.r() * 1.4) * PS; g.s1 = 0.6; g.sizePow = 1;
          g.r = 1; g.g = 0.55; g.b = 0.15; g.r1 = 0.8; g.g1 = 0.15; g.b1 = 0.02; g.a = 0.8; g.fadeIn = 0.12; g.fadePow = 0.8;
          g.emis = 1.5; g.emisPow = 1;
          G.emit();
        }
      }
      s._dmgSmk = (s._dmgSmk || 0) + dt * (1.2 + 4 * k);
      if (P.count > P.capacity - 400) continue;
      while (s._dmgSmk >= 1) {
        s._dmgSmk -= 1;
        const fx = Math.sin(s.heading), fz = -Math.cos(s.heading);
        const along = this.rs() * (s.length || 30) * 0.4, side = this.rs() * (s.beam || 8) * 0.4;
        p.reset();
        p.x = s.position.x + fx * along + fz * side; p.y = s.position.y + 2.5 + this.r() * 2; p.z = s.position.z + fz * along - fx * side;
        p.vx = this.rs() * 0.4; p.vy = 1.6 + this.r() * 1.4; p.vz = this.rs() * 0.4; p.wind = 0.9; p.drag = 0.3; p.accel = 0.35;
        p.frame = F_SMOKE; p.life = 7 + this.r() * 5; p.s0 = 1.6 + k; p.s1 = (7 + this.r() * 6) * (0.7 + 0.6 * k); p.sizePow = 2;
        const sh = 0.2 + this.r() * 0.12;
        p.r = sh; p.g = sh * 0.95; p.b = sh * 0.9; p.r1 = 0.5; p.g1 = 0.49; p.b1 = 0.48; p.a = 0.32 + 0.3 * k; p.fadeIn = 0.1; p.fadePow = 1.4;
        p.rot = this.r() * 6.28; p.rotV = this.rs() * 0.15;
        P.emit();
      }
    }
  }

  // ----------------------------------------------------------------- fire
  fire(obj, intensity = 1) {
    const h = { obj, intensity, offset: new THREE.Vector3(), acc: 0, accS: 0, accE: 0, alive: true,
      stop: () => { h.alive = false; } };
    this.fires.push(h);
    return h;
  }

  _updateFire(h, dt) {
    h.obj.updateWorldMatrix(true, false);
    const pos = _v2.copy(h.offset).applyMatrix4(h.obj.matrixWorld);
    const I = h.intensity;
    const G = this.glowPS, g = G.p, P = this.smokePS, p = P.p;
    h.acc += dt * 34 * I * PM; h.accS += dt * 6.5 * I * PM; h.accE += dt * 9 * I * PM;
    while (h.acc >= 1) {
      h.acc -= 1;
      g.reset(); g.x = pos.x + this.rs() * 2.4 * I; g.y = pos.y + this.r() * 0.8; g.z = pos.z + this.rs() * 2.4 * I;
      g.vx = this.rs() * 0.6; g.vy = 3.5 + this.r() * 4; g.vz = this.rs() * 0.6; g.wind = 0.25; g.drag = 0.8; g.accel = 3;
      g.frame = F_FLAME; g.life = 0.5 + this.r() * 0.5; g.s0 = (2.6 + this.r() * 2.2) * (0.6 + 0.6 * I); g.s1 = 0.8; g.sizePow = 1;
      g.rot = this.rs() * 0.25; g.r = 1; g.g = 0.5; g.b = 0.12; g.r1 = 0.75; g.g1 = 0.12; g.b1 = 0.02; g.a = 0.85; g.fadeIn = 0.12; g.fadePow = 0.8;
      g.emis = 1.6; g.emisPow = 1;
      G.emit();
    }
    while (h.accE >= 1) {
      h.accE -= 1;
      g.reset(); g.x = pos.x + this.rs() * 1.2; g.y = pos.y + 1; g.z = pos.z + this.rs() * 1.2;
      g.vx = this.rs() * 2; g.vy = 4 + this.r() * 5; g.vz = this.rs() * 2; g.wind = 0.7; g.drag = 0.6; g.accel = 0.5;
      g.frame = F_GLOW; g.life = 1.2 + this.r() * 1.6; g.s0 = 0.22; g.s1 = 0.08; g.r = 1; g.g = 0.6; g.b = 0.2; g.r1 = 0.9; g.g1 = 0.2; g.b1 = 0.0;
      g.a = 1; g.fadeIn = 0; g.emis = 3; g.stretch = 0.08;
      G.emit();
    }
    while (h.accS >= 1) {
      h.accS -= 1;
      p.reset(); p.x = pos.x + this.rs(); p.y = pos.y + 2 + this.r(); p.z = pos.z + this.rs();
      p.vx = this.rs() * 0.5; p.vy = 3 + this.r() * 2.5; p.vz = this.rs() * 0.5; p.wind = 0.85; p.drag = 0.35; p.accel = 0.6;
      p.frame = F_SMOKE; p.life = 9 + this.r() * 6; p.s0 = 2.5 * (0.6 + 0.5 * I); p.s1 = (14 + this.r() * 10) * (0.6 + 0.5 * I); p.sizePow = 2;
      p.r = 0.16; p.g = 0.14; p.b = 0.13; p.r1 = 0.45; p.g1 = 0.43; p.b1 = 0.42; p.a = 0.75; p.fadeIn = 0.06; p.fadePow = 1.6;
      p.emis = 2.5; p.emisPow = 8; p.rot = this.r() * 6.28; p.rotV = this.rs() * 0.2;
      P.emit();
    }
    // flickering firelight: reuse a light slot occasionally
    if (this.r() < dt * 8 * I) this.lightPop(pos, 70 * I * (0.7 + this.r() * 0.6), 0.35, 0xff7a2a, 70);
  }

  // ----------------------------------------------------------------- wreckage
  wreckage(pos, amount = 1, spread = 10) {
    const W = this.wd;
    const n = Math.round(14 * amount);
    for (let k = 0; k < n; k++) {
      let i = W.n < MAX_WRECK ? W.n++ : Math.floor(this.r() * MAX_WRECK);
      const a = this.r() * 6.28, d = Math.sqrt(this.r()) * spread;
      W.x[i] = pos.x + Math.cos(a) * d; W.z[i] = pos.z + Math.sin(a) * d;
      W.vx[i] = Math.cos(a) * (0.3 + this.r()); W.vz[i] = Math.sin(a) * (0.3 + this.r());
      W.yaw[i] = this.r() * 6.28; W.yawV[i] = this.rs() * 0.3;
      W.barrel[i] = this.r() < 0.2 ? 1 : 0;
      W.sx[i] = 0.35 + this.r() * 0.5; W.sy[i] = 0.18 + this.r() * 0.15; W.sz[i] = 1.5 + this.r() * 4;
      W.age[i] = 0; W.life[i] = 60 + this.r() * 40; W.ph[i] = this.r() * 6.28; W.sink[i] = 0;
    }
  }

  // jettisoned cargo (hold, I key): n barrels laid along the leeward side (pos = middle of that side, o.fx/o.fz =
  // ship's forward, o.len = length covered, o.sx/o.sz = toward open sea), which drift apart gently, stay behind
  // the ship, bob on the swell, then sink (35–55 s). Same instanced mesh as the wrecks (wreckBarrels, already in
  // the scene and compiled by game.warmup() → fx.warmup + renderer.compile(scene)).
  flotsam(pos, n = 4, o = {}) {
    const W = this.wd, len = o.len || 12, fx = o.fx || 0, fz = o.fz || 1, sx = o.sx || 0, sz = o.sz || 0;
    for (let k = 0; k < n; k++) {
      const i = W.n < MAX_WRECK ? W.n++ : Math.floor(this.r() * MAX_WRECK);
      const a = (this.r() - 0.5) * len, out = this.r() * 2.5;
      W.x[i] = pos.x + fx * a + sx * out; W.z[i] = pos.z + fz * a + sz * out;
      const v = 0.4 + this.r() * 0.6;
      W.vx[i] = sx * v + this.rs() * 0.25; W.vz[i] = sz * v + this.rs() * 0.25;
      W.yaw[i] = this.r() * 6.28; W.yawV[i] = this.rs() * 0.5;
      W.barrel[i] = 1; W.sx[i] = 1; W.sy[i] = 1; W.sz[i] = 1;
      W.age[i] = 0; W.life[i] = 35 + this.r() * 20; W.ph[i] = this.r() * 6.28; W.sink[i] = 0;
    }
  }

  // ----------------------------------------------------------------- falling spars
  // fallingSpar(obj, aLocal, bLocal, r): the spar from a to b (obj-local) breaks at a, topples outboard, hits the water
  fallingSpar(obj, aLocal, bLocal, r = 0.3) {
    if (this.fallen.length >= 8) this.fallen.shift();
    obj.updateWorldMatrix(true, false);
    const A = aLocal.clone().applyMatrix4(obj.matrixWorld), B = bLocal.clone().applyMatrix4(obj.matrixWorld);
    const dir = B.clone().sub(A), len = dir.length() || 1; dir.divideScalar(len);
    // topple toward a random side of the ship
    const side = new THREE.Vector3(1, 0, 0).transformDirection(obj.matrixWorld).multiplyScalar(this.r() < 0.5 ? 1 : -1);
    const axis = new THREE.Vector3().crossVectors(dir, side).normalize();
    const q0 = new THREE.Quaternion().setFromUnitVectors(_up, dir);
    this.fallen.push({ A, len, r: Math.max(0.12, r), q0, axis, th: 0, w: 0.25, age: 0, down: false, vx: side.x * 1.5, vz: side.z * 1.5, top: new THREE.Vector3() });
    this.splinters(A, side, 0.6);
  }
  _updateSpars(dt) {
    const S = this.fallen, M = this.spars; let n = 0;
    for (let k = S.length - 1; k >= 0; k--) {
      const f = S[k]; f.age += dt;
      if (!f.down) {
        f.w += dt * (1.2 + 5 * Math.sin(Math.min(1.5, f.th + 0.15))) * 4 / Math.sqrt(f.len);   // gravity topple, accelerating
        f.th = Math.min(1.75, f.th + f.w * dt);
        _q.setFromAxisAngle(f.axis, f.th).multiply(f.q0);
        f.top.set(0, f.len, 0).applyQuaternion(_q).add(f.A);
        if (f.top.y < this.waterY(f.top.x, f.top.z) + 0.5 || f.th >= 1.75) {
          f.down = true; f.qd = _q.clone(); f.downAt = f.age;
          const mid = f.top.clone().add(f.A).multiplyScalar(0.5);
          this.splash(f.top, 1.3); this.splash(mid, 0.8); this.wreckage(mid, 0.5, f.len * 0.4);
        }
      } else {
        // floats off with a slow drift, settles and sinks
        f.A.x += f.vx * dt; f.A.z += f.vz * dt; f.vx *= 1 - dt * 0.3; f.vz *= 1 - dt * 0.3;
        const tSink = f.age - f.downAt;
        f.A.y += (this.waterY(f.A.x, f.A.z) - 0.2 - tSink * 0.25 - f.A.y) * Math.min(1, dt * 2);
        _q.copy(f.qd);
        if (tSink > 14) { S.splice(k, 1); continue; }
      }
      if (n >= 15) continue;
      _m4.compose(f.A, _q, _s.set(f.r, f.len, f.r)); M.setMatrixAt(n++, _m4);
      // a yard across the spar at ~80 % of its length
      _v.set(0, f.len * 0.8, 0).applyQuaternion(_q).add(f.A);
      _q2.setFromAxisAngle(_v2.set(0, 0, 1), Math.PI / 2); _q2.premultiply(_q);
      _v.addScaledVector(_v2.set(0, -1, 0).applyQuaternion(_q2), f.len * 0.28);
      _m4.compose(_v, _q2, _s.set(f.r * 0.7, f.len * 0.56, f.r * 0.7)); M.setMatrixAt(n++, _m4);
    }
    M.count = n; if (n) M.instanceMatrix.needsUpdate = true;
  }

  // ----------------------------------------------------------------- update
  update(dt, t) {
    const g = this.game, ctx = this._ctx;
    const wind = g.wind || { angle: 0, speed: 0 };
    ctx.windX = Math.sin(wind.angle) * wind.speed * 0.5; ctx.windZ = -Math.cos(wind.angle) * wind.speed * 0.5;
    if (g.sky?.sunDir) ctx.sunDir.copy(g.sky.sunDir);
    ctx.focus = g.cameraRig?.target ? g.camera.position.distanceTo(g.cameraRig.target) : 0;
    if (g.sky?.sunColor) {
      // sun colour drives key light; ambient from sky hemisphere-ish tint, darker at night
      const elev = Math.max(0, ctx.sunDir.y);
      ctx.sunColor.copy(g.sky.sunColor).multiplyScalar(0.25 + 0.95 * Math.min(1, elev * 3));
      ctx.ambient.setRGB(0.32, 0.38, 0.46).multiplyScalar(0.35 + 0.75 * Math.min(1, elev * 2.5));
    }
    this.ringMat.uniforms.uSun.value.copy(ctx.sunColor);
    if (this.fallen.length || this.spars.count) this._updateSpars(dt);

    for (let i = this.fires.length - 1; i >= 0; i--) {
      const h = this.fires[i];
      if (!h.alive || !h.obj.parent) { this.fires.splice(i, 1); continue; }
      if (dt > 0) this._updateFire(h, dt);
    }

    if (dt > 0 && g.ships) this._damageSmoke(dt);
    g.camera.updateMatrixWorld();
    this.smokePS.update(dt, ctx);
    this.glowPS.update(dt, ctx);

    // lights
    for (const l of this.lights) {
      const u = l.userData;
      if (u.peak <= 0) continue;
      u.t += dt;
      const k = Math.max(0, 1 - u.t / u.dur);
      l.intensity = u.peak * k * k;
      if (k <= 0) { u.peak = 0; l.intensity = 0; }
    }

    this._updateDebris(dt, t);
    this._updateWreck(dt, t);
    this._updateRings(dt);
  }

  _updateDebris(dt, t) {
    const D = this.dd, M = this.debris;
    for (let i = 0; i < D.n; i++) {
      D.life[i] -= dt;
      if (D.life[i] <= 0) { this._killDebris(i); i--; continue; }
      const wy = this.waterY(D.x[i], D.z[i]);
      if (!D.floating[i]) {
        D.vy[i] -= 9.8 * dt;
        D.x[i] += D.vx[i] * dt; D.y[i] += D.vy[i] * dt; D.z[i] += D.vz[i] * dt;
        D.rx[i] += D.wx[i] * dt; D.ry[i] += D.wy[i] * dt; D.rz[i] += D.wz[i] * dt;
        if (D.y[i] < wy && D.vy[i] < 0) {
          D.floating[i] = 1; D.vx[i] *= 0.2; D.vz[i] *= 0.2;
          if (D.sz[i] > 1 && this.smokePS.count < this.smokePS.capacity - 200) this._miniSplash(D.x[i], wy, D.z[i]);
        }
      } else {
        D.x[i] += D.vx[i] * dt; D.z[i] += D.vz[i] * dt; D.vx[i] *= 1 - dt * 0.5; D.vz[i] *= 1 - dt * 0.5;
        D.y[i] = wy - 0.03 - Math.max(0, 1.5 - D.life[i]) * 0.3;
        D.rx[i] *= 1 - dt * 2; D.rz[i] *= 1 - dt * 2;
      }
      _e.set(D.rx[i], D.ry[i], D.rz[i]); _q.setFromEuler(_e);
      _s.set(D.sx[i], D.sy[i], D.sz[i]);
      _m4.compose(_v.set(D.x[i], D.y[i], D.z[i]), _q, _s);
      M.setMatrixAt(i, _m4);
    }
    M.count = D.n;
    if (D.n) M.instanceMatrix.needsUpdate = true;
  }
  _killDebris(i) {
    const D = this.dd, last = --D.n;
    if (i === last) return;
    for (const k in D) if (k !== 'n') D[k][i] = D[k][last];
  }
  _miniSplash(x, y, z) {
    const P = this.smokePS, p = P.p;
    for (let k = 0; k < 4; k++) {
      p.reset(); p.x = x; p.y = y; p.z = z; p.vx = this.rs() * 2; p.vy = 3 + this.r() * 3; p.vz = this.rs() * 2; p.accel = -12;
      p.frame = F_SPRAY; p.life = 0.5; p.s0 = 0.5; p.s1 = 1.4; p.a = 0.8; p.fadeIn = 0; p.killWater = 1; p.stretch = 0.06;
      P.emit();
    }
  }

  _updateWreck(dt, t) {
    const W = this.wd;
    let np = 0, nb = 0;
    const ocean = this.game.ocean;
    for (let i = 0; i < W.n; i++) {
      W.age[i] += dt;
      if (W.age[i] > W.life[i]) {
        const last = --W.n;
        if (i !== last) for (const k in W) if (k !== 'n') W[k][i] = W[k][last];
        i--; continue;
      }
      W.x[i] += W.vx[i] * dt; W.z[i] += W.vz[i] * dt;
      W.vx[i] *= 1 - dt * 0.15; W.vz[i] *= 1 - dt * 0.15; W.yaw[i] += W.yawV[i] * dt; W.yawV[i] *= 1 - dt * 0.1;
      const x = W.x[i], z = W.z[i], wy = this.waterY(x, z);
      const fade = Math.max(0, (W.age[i] - (W.life[i] - 6)) / 6);
      const y = wy - 0.06 - fade * 1.2;
      if (ocean?.getNormal) { ocean.getNormal(x, z, _v2); } else _v2.set(0, 1, 0);
      _q.setFromUnitVectors(_up, _v2);
      _e.set(Math.sin(t * 0.9 + W.ph[i]) * 0.08, W.yaw[i], Math.cos(t * 0.7 + W.ph[i]) * 0.08, 'YXZ');
      _q.multiply(_q2.setFromEuler(_e));
      if (W.barrel[i] && nb < MAX_WRECK / 4) {
        _s.set(1, 1, 1);
        _m4.compose(_v.set(x, y + 0.15, z), _q, _s);
        this.wreckBarrels.setMatrixAt(nb++, _m4);
      } else {
        _s.set(W.sx[i], W.sy[i], W.sz[i]);
        _m4.compose(_v.set(x, y, z), _q, _s);
        this.wreckPlanks.setMatrixAt(np++, _m4);
      }
    }
    this.wreckPlanks.count = np; this.wreckBarrels.count = nb;
    if (np) this.wreckPlanks.instanceMatrix.needsUpdate = true;
    if (nb) this.wreckBarrels.instanceMatrix.needsUpdate = true;
  }

  _updateRings(dt) {
    const R = this.rd, A = this.ringAttr.array;
    for (let i = 0; i < R.n; i++) {
      R.age[i] += dt;
      if (R.age[i] >= R.life[i]) {
        const last = --R.n;
        if (i !== last) for (const k in R) if (k !== 'n') R[k][i] = R[k][last];
        i--; continue;
      }
      const t = R.age[i] / R.life[i];
      const size = R.r[i] * 2 * (0.6 + 0.8 * Math.sqrt(t));
      _m4.makeScale(size, 1, size).setPosition(R.x[i], this.waterY(R.x[i], R.z[i]) + 0.12, R.z[i]);
      this.rings.setMatrixAt(i, _m4);
      A[i * 2] = t; A[i * 2 + 1] = R.seed[i];
    }
    this.rings.count = R.n;
    if (R.n) { this.rings.instanceMatrix.needsUpdate = true; this.ringAttr.needsUpdate = true; }
  }

  stats() {
    return { particles: this.smokePS.count + this.glowPS.count, debris: this.dd.n, wreck: this.wd.n, fires: this.fires.length };
  }
}
