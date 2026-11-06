// Moving weather cells over the sea, separate from the global sky weather
// (src/world/sky/weather.js, ?weather=storm):
//   squall  white cumulus with a rain curtain; ships under its lee (downwind half, + a margin) get a speed boost
//   storm   large dark cell; a fast ring on its edge (strong wind) but the eye wall tears hull and canvas, slows
// Cells drift with game.wind and are re-seeded upwind when they leave the map.
// each cell also has a life (WEATHER.squallLife / stormLife, real seconds); once spent, it is re-seeded
// elsewhere out of the player's sight, so the weather map renews several times per calendar day (240 s). The sky's
// global weather (sky.setWeather) is directed from here: storm overhead -> 'storm', squall -> 'cloudy', otherwise a
// clear/cloudy cycle every WEATHER.skyCycle seconds (only with the auto-advancing sky, without ?weather=).
// API: game.weatherZones (system) · zones [{ kind, x, z, r, vx, vz }] · at(x, z) -> { kind, speedF, dmg } ·
//      ship.weatherSpeedF (written here, read in Ship._step) · ship.weatherKind ('squall'|'storm-edge'|'storm-eye'|null)
// Draw calls: 2 (instanced billboard puffs + instanced rain curtains). Map: worldMap draws `zones`.
import * as THREE from 'three';
import { HALF_WORLD, wrapAngle } from '../core/constants.js';
import { mulberry32 } from '../core/rng.js';

export const WEATHER = {
  // wind shift: the wind itself now slowly veers, instead of holding one heading for the whole game.
  // Damped random walk on game.wind.angle (rad/s), not a hard cycle — feels like gusty real weather rather than
  // a metronome. windShiftRate bounds how fast it can turn (~0.006 rad/s ≈ a 90° swing over ~4-5 min of sea time,
  // close to one time-sync calendar day) ; windShiftAccel/-Damping shape the acceleration so it eases in and out
  // rather than snapping. Off in `?shot=` showcases and outside `sail` mode (see _windShift()).
  windShiftRate: 0.006, windShiftAccel: 0.0009, windShiftDamping: 0.18,
  squalls: 7, storms: 2,
  squallR: [260, 420], stormR: [750, 1050],
  squallDrift: 9, stormDrift: 5,      // m/s
  squallBoost: 0.28,                   // +28 % top speed under a squall's lee
  stormEdgeBoost: 0.42,                // +42 % in the fast ring (0.55–1.05 r)
  stormEyeR: 0.42,                     // eye wall inside this fraction of r
  stormEyeSpeed: 0.8,                  // speed ×0.8 in the eye wall
  stormHullDmg: 0.008,                 // share of hullMax lost per second in the eye (0,8 %/s, below R repairs 2 %/s)
  stormSailDmg: 0.004,                 // sail integrity /s in the eye (R repairs 2,4 %/s)
  stormFloor: 0.12,                    // the storm alone never takes a hull below 12 %
  squallLife: [110, 240], stormLife: [300, 600],   // s before a cell is renewed elsewhere
  renewAway: 2600,                     // only renewed when its edge is farther than this from the player (m)
  skyCycle: [45, 100],                 // s between two clear/cloudy draws of the sky (open sea)
  skyCloudy: 0.45,                     // chance of a cloudy sky at each draw
};
const PUFFS = { squall: 11, storm: 28 };
const ALT = { squall: [150, 210], storm: [170, 260] };

function puffTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), rnd = mulberry32(911);
  for (let i = 0; i < 26; i++) {
    const r = S * (0.12 + rnd() * 0.16), a = rnd() * Math.PI * 2, d = rnd() * S * 0.24;
    const cx = S / 2 + Math.cos(a) * d, cy = S / 2 + Math.sin(a) * d * 0.7;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.6, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const PUFF_VS = /* glsl */`
  varying vec2 vUv; varying vec3 vCol; varying float vFade; varying float vShade;
  void main() {
    vUv = uv;
    vCol = instanceColor;
    vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float s = length(instanceMatrix[0].xyz);
    c.xy += position.xy * s;
    vShade = 0.72 + 0.28 * (position.y + 0.5);     // lit tops, grey bellies
    vFade = smoothstep(9000.0, 4500.0, -c.z) * smoothstep(20.0, 160.0, -c.z);
    gl_Position = projectionMatrix * c;
  }`;
const PUFF_FS = /* glsl */`
  uniform sampler2D uMap; uniform vec3 uTint; uniform float uLight;
  varying vec2 vUv; varying vec3 vCol; varying float vFade; varying float vShade;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    vec3 col = mix(vCol * vShade, uTint, 0.28) * uLight;
    float a = t.a * vFade * 0.95;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;
const RAIN_VS = /* glsl */`
  varying vec2 vUv; varying float vFade; varying float vDark; varying float vFacing;
  void main() {
    vUv = uv; vDark = instanceColor.r;
    vec4 c = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    // cylinder seen edge-on reads as a hard glassy band: fade the grazing walls (soft, veil-like curtain)
    vec3 n = normalize(mat3(modelViewMatrix) * mat3(instanceMatrix) * normal);
    vFacing = abs(dot(n, normalize(-c.xyz)));
    vFade = smoothstep(8000.0, 3500.0, -c.z);
    gl_Position = projectionMatrix * c;
  }`;
const RAIN_FS = /* glsl */`
  uniform float uTime; uniform vec3 uTint; uniform float uLight;
  varying vec2 vUv; varying float vFade; varying float vDark; varying float vFacing;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    // painterly rain veil: slanted, wind-blown smears of varying density (no regular columns), soft top and foot
    vec2 p = vec2(vUv.x * 46.0 + vUv.y * 2.2, vUv.y * 3.0);
    float big = vnoise(vec2(vUv.x * 7.0 + uTime * 0.03, vUv.y * 1.4 - uTime * 0.05));        // drifting sheets
    float mid = vnoise(p + vec2(0.0, uTime * 0.9));                                             // falling smears
    float fine = vnoise(vec2(p.x * 3.0, p.y * 0.6 + uTime * 2.2));                              // streak texture
    float dens = smoothstep(0.25, 0.85, big) * (0.55 + 0.45 * mid) * (0.75 + 0.25 * fine);
    float edge = smoothstep(0.05, 0.6, vFacing);
    float a = (0.05 + 0.11 * vDark) * dens * edge * smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.62, vUv.y) * vFade;
    if (a < 0.003) discard;
    vec3 col = mix(vec3(0.70, 0.74, 0.79), vec3(0.26, 0.29, 0.34), vDark);
    gl_FragColor = vec4(mix(col, uTint, 0.3) * uLight, a);
    #include <colorspace_fragment>
  }`;

export class WeatherZones {
  constructor(game) {
    this.game = game;
    this.rnd = mulberry32((+game.params?.get?.('seed') || 7) * 131 + 17);
    this.rndLife = mulberry32((+game.params?.get?.('seed') || 7) * 977 + 5);   // own stream (cell layout unchanged)
    this.rndWind = mulberry32((+game.params?.get?.('seed') || 7) * 331 + 61);  // wind shift: own stream, doesn't touch cell layout
    this._windVel = 0;   // rad/s, current turning speed of game.wind.angle
    this.zones = [];
    for (let i = 0; i < WEATHER.squalls; i++) this.zones.push(this._make('squall'));
    for (let i = 0; i < WEATHER.storms; i++) this.zones.push(this._make('storm'));
    this._buildMeshes();
    this._fx = 0; this._last = new Map();
  }

  _make(kind, x, z) {
    const R = kind === 'storm' ? WEATHER.stormR : WEATHER.squallR, rnd = this.rnd;
    const lim = HALF_WORLD * 0.85;
    const zn = { kind, r: R[0] + rnd() * (R[1] - R[0]), x: x ?? (rnd() * 2 - 1) * lim, z: z ?? (rnd() * 2 - 1) * lim,
      seed: Math.floor(rnd() * 1e6), spin: rnd() < 0.5 ? -1 : 1, wob: rnd() * 10 };
    zn.life = this._life(kind) * this.rndLife();   // staggered at start
    return zn;
  }
  _life(kind) { const L = kind === 'storm' ? WEATHER.stormLife : WEATHER.squallLife; return L[0] + this.rndLife() * (L[1] - L[0]); }
  // a spent cell dissolves out of sight and forms again somewhere else on the map
  _renew(zn) {
    const p = this.game.player?.position, lim = HALF_WORLD * 0.85;
    for (let k = 0; k < 8; k++) {
      const x = (this.rndLife() * 2 - 1) * lim, z = (this.rndLife() * 2 - 1) * lim;
      if (!p || Math.hypot(x - p.x, z - p.z) - zn.r > WEATHER.renewAway) { zn.x = x; zn.z = z; break; }
    }
    zn.life = this._life(zn.kind);
  }
  // a cell that drifted off the map comes back on the upwind edge
  _reseed(zn) {
    const w = this.game.wind || { angle: 0 };
    const dx = Math.sin(w.angle), dz = -Math.cos(w.angle), lim = HALF_WORLD * 0.9;
    const side = (this.rnd() * 2 - 1) * lim;
    zn.x = -dx * lim + -dz * side; zn.z = -dz * lim + dx * side;
    zn.x = Math.max(-lim, Math.min(lim, zn.x)); zn.z = Math.max(-lim, Math.min(lim, zn.z));
  }

  _buildMeshes() {
    const g = this.game;
    let nP = 0; for (const z of this.zones) nP += PUFFS[z.kind];
    const quad = new THREE.PlaneGeometry(1, 1);
    this.puffMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: puffTexture() }, uTint: { value: new THREE.Color(0.8, 0.82, 0.85) }, uLight: { value: 1 } },
      vertexShader: PUFF_VS, fragmentShader: PUFF_FS, transparent: true, depthWrite: false,
    });
    this.puffs = new THREE.InstancedMesh(quad, this.puffMat, nP);
    this.puffs.frustumCulled = false; this.puffs.renderOrder = 2; this.puffs.name = 'weather:puffs';
    // puff layout per zone (local offsets), fixed
    this._puffLocal = [];
    const col = new THREE.Color();
    let k = 0;
    for (const zn of this.zones) {
      const r = mulberry32(zn.seed), n = PUFFS[zn.kind], A = ALT[zn.kind];
      for (let i = 0; i < n; i++, k++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * zn.r * (zn.kind === 'storm' ? 0.85 : 0.6);
        const size = zn.r * (zn.kind === 'storm' ? 0.42 : 0.55) * (0.6 + r() * 0.6);
        this._puffLocal.push({ zn, ox: Math.cos(a) * d, oz: Math.sin(a) * d, y: A[0] + r() * (A[1] - A[0]) + (1 - d / zn.r) * 40, size });
        const v = zn.kind === 'storm' ? 0.34 + r() * 0.16 : 0.92 + r() * 0.08;
        this.puffs.setColorAt(k, col.setRGB(v, v * 1.01, v * 1.04));
      }
    }
    this.puffs.instanceColor.needsUpdate = true;
    g.scene.add(this.puffs);

    const cyl = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true); cyl.translate(0, 0.5, 0);
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uTint: this.puffMat.uniforms.uTint, uLight: this.puffMat.uniforms.uLight },
      vertexShader: RAIN_VS, fragmentShader: RAIN_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.rain = new THREE.InstancedMesh(cyl, this.rainMat, this.zones.length);
    this.rain.frustumCulled = false; this.rain.renderOrder = 1; this.rain.name = 'weather:rain';
    this.zones.forEach((zn, i) => this.rain.setColorAt(i, col.setRGB(zn.kind === 'storm' ? 1 : 0, 0, 0)));
    this.rain.instanceColor.needsUpdate = true;
    g.scene.add(this.rain);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
  }

  // effect of the weather at a point: speed multiplier and eye-wall damage flag
  at(x, z) {
    const w = this.game.wind || { angle: 0 };
    const wx = Math.sin(w.angle), wz = -Math.cos(w.angle);
    let speedF = 1, kind = null, dmg = 0;
    for (const zn of this.zones) {
      const dx = x - zn.x, dz = z - zn.z, d2 = dx * dx + dz * dz;
      if (d2 > zn.r * zn.r * 2.6) continue;
      if (zn.kind === 'squall') {
        // the lee: a disc shifted downwind; boost fades toward its rim
        const lx = dx - wx * zn.r * 0.45, lz = dz - wz * zn.r * 0.45;
        const e = Math.sqrt(lx * lx + lz * lz) / (zn.r * 1.1);
        if (e < 1) { const f = 1 + WEATHER.squallBoost * Math.min(1, (1 - e) * 2.2); if (f > speedF) { speedF = f; kind = 'squall'; } }
      } else {
        const e = Math.sqrt(d2) / zn.r;
        if (e < WEATHER.stormEyeR) { speedF = Math.min(speedF, WEATHER.stormEyeSpeed); kind = 'storm-eye'; dmg = 1; }
        else if (e < 1.05 && kind !== 'storm-eye') {
          const f = 1 + WEATHER.stormEdgeBoost * Math.min(1, (e - WEATHER.stormEyeR) / 0.15) * Math.min(1, (1.05 - e) / 0.12);
          if (f > speedF) { speedF = f; kind = 'storm-edge'; }
        }
      }
    }
    return { speedF, kind, dmg };
  }

  update(dt, t) {
    const g = this.game;
    if (!(dt > 0)) return;
    const w = g.wind || { angle: 0, speed: 9 };
    const wx = Math.sin(w.angle), wz = -Math.cos(w.angle), lim = HALF_WORLD * 0.95;
    for (const zn of this.zones) {
      const v = zn.kind === 'storm' ? WEATHER.stormDrift : WEATHER.squallDrift;
      zn.wob += dt * 0.05;
      const cx = Math.sin(zn.wob) * 0.35, cz = Math.cos(zn.wob * 0.8) * 0.35;   // slow meander across the wind
      zn.vx = (wx + -wz * cx) * v; zn.vz = (wz + wx * cz) * v;
      zn.x += zn.vx * dt; zn.z += zn.vz * dt;
      if (Math.abs(zn.x) > lim || Math.abs(zn.z) > lim) this._reseed(zn);
      zn.life -= dt;
      if (zn.life <= 0) {
        const pp = g.player?.position;
        if (!pp || Math.hypot(zn.x - pp.x, zn.z - pp.z) - zn.r > WEATHER.renewAway) this._renew(zn);
      }
    }
    this._skyDirector(dt);
    this._windShift(dt);
    // ship effects (every frame, cheap: ~9 cells × ~20 ships)
    for (const s of g.ships) {
      if (!s.alive || s.sinking) continue;
      const fx = this.at(s.position.x, s.position.z);
      s.weatherSpeedF = (s.weatherSpeedF ?? 1) + (fx.speedF - (s.weatherSpeedF ?? 1)) * Math.min(1, dt * 0.8);
      s.weatherKind = fx.kind;
      if (fx.dmg && g.mode === 'sail') {
        const floor = s.hullMax * WEATHER.stormFloor;
        const bk = s.isPlayer ? (g.fortune?.fx.stormMul ?? 1) : 1;   // barometer
        if (s.hull > floor) s.hull = Math.max(floor, s.hull - WEATHER.stormHullDmg * s.hullMax * bk * dt);
        s.sails = Math.max(0.2, s.sails - WEATHER.stormSailDmg * bk * dt);
      }
      if (s.isPlayer) this._notify(s, fx.kind);
    }
    this._updateMeshes(t);
  }

  // the global sky follows the weather around the player, and changes on its own in open sea
  _skyDirector(dt) {
    const g = this.game, sky = g.sky, p = g.player?.position;
    if (!sky?.autoAdvance || !p || g.mode !== 'sail' || g.params?.get?.('weather')) return;
    this._skyT = (this._skyT ?? 0) - dt;
    if (this._skyT > 0) return;
    this._skyT = 1;
    this._baseT = (this._baseT ?? 0) - 1;
    if (this._baseT <= 0 || !this._base) {
      const C = WEATHER.skyCycle;
      this._baseT = C[0] + this.rndLife() * (C[1] - C[0]);
      this._base = this.rndLife() < WEATHER.skyCloudy ? 'cloudy' : 'clear';
    }
    let want = this._base;
    for (const zn of this.zones) {
      const d = Math.hypot(zn.x - p.x, zn.z - p.z) / zn.r;
      if (zn.kind === 'storm' && d < 1.5) { want = 'storm'; break; }
      if (zn.kind === 'squall' && d < 1.3) want = 'cloudy';
    }
    if (want !== sky.weather) sky.setWeather(want);
  }

  // wind shift: game.wind.angle wanders slowly instead of holding one heading all game — damped random
  // walk on turning speed (not position), so it eases in and out rather than snapping or cycling metronomically.
  // Off outside normal sailing and in showcase scenes (`?shot=`, `?weather=`), which set game.wind.angle themselves
  // and rely on it staying put for the duration of the capture.
  _windShift(dt) {
    const g = this.game;
    if (!g.wind || g.mode !== 'sail' || g.params?.get?.('shot') || g.params?.get?.('weather') || navigator.webdriver) return;
    const R = WEATHER;
    this._windVel += (this.rndWind() * 2 - 1) * R.windShiftAccel * dt;
    this._windVel *= Math.max(0, 1 - R.windShiftDamping * dt);
    this._windVel = Math.max(-R.windShiftRate, Math.min(R.windShiftRate, this._windVel));
    g.wind.angle = wrapAngle(g.wind.angle + this._windVel * dt);
  }

  _notify(s, kind) {
    if (kind === this._pk) return;
    this._pk = kind;
    const msg = { squall: ['Squall to leeward: the breeze freshens!', 'good'], 'storm-edge': ['Edge of the storm: a fair wind, she flies!', 'good'], 'storm-eye': ['In the heart of the storm: the hull is suffering!', 'bad'] }[kind];
    if (msg && this.game.mode === 'sail') this.game.events?.emit('notify', { text: msg[0], kind: msg[1], topic: 'weather', key: 'weather' });
  }

  _updateMeshes(t) {
    const m = this._m, p = this._p, s = this._s, q = this._q;
    this._puffLocal.forEach((pl, i) => {
      const zn = pl.zn, a = t * 0.01 * zn.spin * (zn.kind === 'storm' ? 1.6 : 0.4);
      const ca = Math.cos(a), sa = Math.sin(a);
      p.set(zn.x + pl.ox * ca - pl.oz * sa, pl.y, zn.z + pl.ox * sa + pl.oz * ca);
      s.setScalar(pl.size);
      this.puffs.setMatrixAt(i, m.compose(p, q, s));
    });
    this.puffs.instanceMatrix.needsUpdate = true;
    this.zones.forEach((zn, i) => {
      const rr = zn.r * (zn.kind === 'storm' ? 0.8 : 0.5);
      const w = this.game.wind || { angle: 0 };
      p.set(zn.x + Math.sin(w.angle) * zn.r * 0.15, -2, zn.z - Math.cos(w.angle) * zn.r * 0.15);
      s.set(rr, ALT[zn.kind][0] + 10, rr);
      this.rain.setMatrixAt(i, m.compose(p, q, s));
    });
    this.rain.instanceMatrix.needsUpdate = true;
    this.rainMat.uniforms.uTime.value = t;
    // tint toward the fog colour and dim at night (cheap: read the scene fog / sun if present)
    const fog = this.game.scene.fog?.color;
    if (fog) this.puffMat.uniforms.uTint.value.copy(fog);
    const sun = this.game.sky?.sunDir?.y ?? this.game.sky?.sunElevation;
    if (typeof sun === 'number') this.puffMat.uniforms.uLight.value = Math.max(0.28, Math.min(1, 0.45 + sun * 2));
    const show = this.game.mode !== 'port' && this.game.mode !== 'duel';
    this.puffs.visible = this.rain.visible = show;
  }
}
