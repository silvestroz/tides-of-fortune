// Sky: time of day, sun and moon, sky dome, clouds, weather (rain, lightning) and the scene lighting they drive.
// API (other systems rely on these):
//   sky.sunDir        THREE.Vector3 (normalized, pointing from scene TOWARD the sun)
//   sky.sunColor      THREE.Color   (current direct-light colour)
//   sky.sunLight      THREE.DirectionalLight (casts shadows; sky keeps its shadow camera centred on game.cameraRig target / camera)
//   sky.fogColor      THREE.Color   (horizon colour used by ocean for distance blending)
//   sky.timeOfDay     hours 0..24;   sky.setTimeOfDay(h)
//   sky.envMap        texture usable as scene.environment (PMREM) – may be null
//   sky.update(dt,t)
// Extended API:
//   sky.setWeather('clear'|'cloudy'|'storm', { instant=false })   smooth transition (~20 s); sky.weather = target name
//   sky.storm         0..1 current storm blend (read-only);  sky.overcast 0..1 ;  sky.rainIntensity 0..1
//   sky.lightning     { flash 0..~2, dir Vector3, strike(camera) }  — flash also brightens fill light
//   sky.moonDir       THREE.Vector3 toward the moon ;  sky.isNight (bool) ; sky.sunElevation (degrees)
//   sky.lightDir      THREE.Vector3 direction toward the current key light (sun by day, moon by night)
//   sky.ambientColor  THREE.Color   sky fill colour (hemisphere sky colour × intensity)
//   sky.sunVisibility 0..1 (sun disc not hidden by storm / below horizon) — used by post god-rays
//   sky.dayLengthSeconds  real seconds per in-game 24 h when time auto-advances (normal play only)
//   sky.autoAdvance   bool (false when ?tod or ?shot is set)
//   ?tod=h forces time;  ?weather=clear|cloudy|storm forces weather at startup.
// Timeline: sunrise 6.0, sunset ~19.4 (19.2 = sun touching the horizon), solar noon 12.7, max elevation ~66°.
// Global aerial-perspective fog is installed by ./sky/atmosphere.js (patches fog chunks; scene.fog is a FogExp2).
import * as THREE from 'three';
import { ATMOS } from './sky/atmosphere.js';
import { createSkyUniforms, createSkyMaterial } from './sky/skyDome.js';
import { createPaletteState, samplePalette } from './sky/palette.js';
import { CloudLayer } from './sky/clouds.js';
import { Rain, Lightning } from './sky/weather.js';
import { QUALITY } from '../core/constants.js';

const SUNRISE = 6.0, SUNSET = 19.4;
const MAX_EL = THREE.MathUtils.degToRad(66);
const WEATHER = {
  clear:  { coverage: 0.5, cirrus: 0.5, overcast: 0, rain: 0, storm: 0, wind: null, sea: null },
  cloudy: { coverage: 0.78, cirrus: 0.35, overcast: 0.25, rain: 0, storm: 0.2, wind: 12, sea: 0.65 },
  storm:  { coverage: 1.0, cirrus: 0.0, overcast: 1, rain: 1, storm: 1, wind: 22, sea: 1.0 },
};

const _v = new THREE.Vector3();
const _flashCol = new THREE.Color(0.8, 0.85, 1.0);
const _flashFog = new THREE.Color(0.6, 0.65, 0.8);

export class Sky {
  constructor(game) {
    this.game = game;
    this.timeOfDay = 15.5;
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();
    this.sunColor = new THREE.Color(1, 0.95, 0.85);
    this.fogColor = new THREE.Color(0x9cc4dc);
    this.ambientColor = new THREE.Color();
    this.envMap = null;
    this.sunElevation = 30;
    this.isNight = false;
    this.sunVisibility = 1;
    this.dayLengthSeconds = 240;          // set by Career from REAL_SECONDS_PER_DAY (1 calendar day)
    const p = game.params;
    this.autoAdvance = !p.get('tod') && !p.get('shot');

    // weather state (current blends → targets)
    this.weather = 'clear';
    this.w = { ...WEATHER.clear };
    this.wTarget = WEATHER.clear;
    this.storm = 0; this.overcast = 0; this.rainIntensity = 0;
    this._baseWind = null; this._baseSea = null;

    this.pal = createPaletteState();
    this.u = createSkyUniforms();

    // ---- sky dome (rendered after opaques so early-z skips covered pixels)
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), createSkyMaterial(this.u));
    this.dome.scale.setScalar(30000);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = 100000;
    game.scene.add(this.dome);
    game.scene.background = null;

    // ---- environment capture scene (sky only, clamped sun)
    this.envScene = new THREE.Scene();
    this.envDome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), createSkyMaterial(this.u, { env: true }));
    this.envDome.scale.setScalar(100);
    this.envScene.add(this.envDome);
    this.pmrem = new THREE.PMREMGenerator(game.renderer);
    // the environment is recomputed in the same target (same texture): a new texture every time forced every
    // material to revalidate its program on the next frame and reallocated a half-float target
    { const pm = this.pmrem, alloc = pm._allocateTargets.bind(pm);
      pm._allocateTargets = () => { const rt = this._envRT; return rt && pm._pingPongRenderTarget && rt.width === pm._pingPongRenderTarget.width && rt.height === pm._pingPongRenderTarget.height && rt.width === 3 * Math.max(pm._cubeSize, 16 * 7) && rt.height === 4 * pm._cubeSize ? rt : alloc(); }; }
    this._envRT = null;
    this._envTimer = 0;
    this._envKey = null;

    // ---- clouds, rain, lightning
    this.clouds = new CloudLayer(this.u);
    game.scene.add(this.clouds.mesh);
    this.rain = new Rain();
    game.scene.add(this.rain.mesh);
    this.lightning = new Lightning();
    game.scene.add(this.lightning.mesh);
    this._windOff = new THREE.Vector2();

    // ---- fog (aerial perspective via patched chunks)
    game.scene.fog = new THREE.FogExp2(this.fogColor.getHex(), 0.00016);
    this.fogBaseDensity = 0.00016;

    // ---- lights
    this.sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(QUALITY.shadowMapSize, QUALITY.shadowMapSize);
    this.shadowRadius = QUALITY.shadowR || 90;   // ultra: 150 m on a 4096 map (finer texels and farther)
    if (QUALITY.shadowSoft) this.sunLight.shadow.radius = QUALITY.shadowSoft;   // wider PCF kernel: soft edges
    const c = this.sunLight.shadow.camera;
    c.left = c.bottom = -this.shadowRadius; c.right = c.top = this.shadowRadius; c.near = 1; c.far = 1400;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.06;
    game.scene.add(this.sunLight, this.sunLight.target);
    this.hemi = new THREE.HemisphereLight(0xbfdcff, 0x335566, 0.9);
    game.scene.add(this.hemi);

    this.setTimeOfDay(this.timeOfDay);
    const wq = p.get('weather');
    this.setWeather(WEATHER[wq] ? wq : 'clear', { instant: true });
    this._apply(0, true);
  }

  setTimeOfDay(h) {
    this.timeOfDay = ((h % 24) + 24) % 24;
    const t = this.timeOfDay;
    let a; // 0..PI over the day arc, PI..2PI at night
    if (t >= SUNRISE && t <= SUNSET) a = (t - SUNRISE) / (SUNSET - SUNRISE) * Math.PI;
    else { const n = (t - SUNSET + 24) % 24; a = Math.PI + n / (24 - (SUNSET - SUNRISE)) * Math.PI; }
    // rises in the east (+X), crosses the south (+Z) high, sets in the west (-X)
    this.sunDir.set(Math.cos(a), Math.sin(a) * Math.sin(MAX_EL), Math.sin(a) * Math.cos(MAX_EL)).normalize();
    // moon: roughly opposite, tilted so it rides higher at night and sits a little north
    this.moonDir.set(-this.sunDir.x * 0.9, -this.sunDir.y * 0.55 + 0.1, -this.sunDir.z * 0.4 - 0.45).normalize();
    this.sunElevation = THREE.MathUtils.radToDeg(Math.asin(this.sunDir.y));
    this._envKey = null; // force env refresh
    if (this.pal) this._apply(0, true);
  }

  setWeather(name, { instant = false } = {}) {
    if (!WEATHER[name]) return;
    const g = this.game;
    if (this.weather === 'clear' || this._baseWind === null) {
      this._baseWind = g.wind.speed;
      this._baseSea = g.ocean?.seaState ?? null;
    }
    this.weather = name;
    this.wTarget = WEATHER[name];
    if (instant) {
      Object.assign(this.w, this.wTarget);
      this.clouds.setCoverage(this.wTarget.coverage);
      this.clouds.update(0, g.camera, this._windOff, true);
      if (this.wTarget.wind) g.wind.speed = Math.max(this._baseWind, this.wTarget.wind);
      if (this.wTarget.sea != null && g.ocean) g.ocean.seaState = this.wTarget.sea;
      this._envKey = null;
    }
  }

  _apply(dt, force) {
    const g = this.game, u = this.u, pal = this.pal, w = this.w;
    const morning = this.timeOfDay < 12 ? 1 : 0;
    samplePalette(this.sunElevation, morning, w.storm, pal);
    this.storm = w.storm; this.overcast = w.overcast; this.rainIntensity = w.rain;
    this.isNight = this.sunElevation < -6;

    u.uZenith.value.copy(pal.zenith);
    u.uHorizon.value.copy(pal.horizon);
    u.uGlow.value.copy(pal.glow);
    u.uBand.value.copy(pal.band);
    u.uAnti.value.copy(pal.anti);
    u.uCloudLit.value.copy(pal.cloudLit);
    u.uCloudShade.value.copy(pal.cloudShade);
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);
    u.uStars.value = pal.stars;
    u.uCirrus.value = w.cirrus;
    u.uOvercast.value = w.overcast;
    u.uHaze.value = pal.haze;
    const sunAbove = THREE.MathUtils.smoothstep(this.sunElevation, -1.5, 1.0);
    this.sunVisibility = sunAbove * (1 - w.overcast * 0.95);
    u.uSunVis.value = 1 - w.overcast * 0.95;

    // sun disc colour: warm, saturated near the horizon (very bright; bloom picks it up)
    const lowSun = 1 - THREE.MathUtils.smoothstep(this.sunElevation, 0, 25);
    this.sunColor.copy(pal.light);
    u.uSunColor.value.copy(pal.light).lerp(pal.glow, lowSun * 0.5);

    // ---- key light: sun by day, moon by night
    const lf = this.flash || 0;
    const useMoon = this.sunElevation < -4;
    this.lightDir.copy(useMoon ? this.moonDir : this.sunDir);
    this.sunLight.color.copy(pal.light);
    this.sunLight.intensity = pal.lightI * (useMoon ? Math.max(0, Math.min(1, this.moonDir.y * 3)) : 1);
    // lightning lights the scene: a cold key light from the bolt's direction for the duration of the flash
    if (lf > 0.02) {
      const k = Math.min(1.6, lf);
      this.lightDir.lerp(this.lightning.dir, Math.min(1, k)).normalize();
      if (this.lightDir.y < 0.15) { this.lightDir.y = 0.15; this.lightDir.normalize(); }
      this.sunLight.color.lerp(_flashCol, Math.min(1, k));
      this.sunLight.intensity += k * 3.2;
    }
    // the sun's shadow stays declared (castShadow) and is switched off through its intensity: toggling castShadow at
    // nightfall (and at each night-time lightning flash) changed the programs of every material in the world
    // (~20 to 40 recompiled, a hitch of half a second or more). The shadow map isn't redrawn at night.
    { const on = this.sunLight.intensity > 0.05, sh = this.sunLight.shadow; sh.intensity = on ? 1 : 0; sh.autoUpdate = on; }

    // ---- fill: hemisphere sky/sea colours (env map provides the rest)
    this.hemi.color.copy(pal.hemiSky);
    this.hemi.groundColor.copy(pal.hemiGround);
    this.hemi.intensity = pal.hemiI * 0.55 + lf * 2.0;
    this.ambientColor.copy(pal.hemiSky).multiplyScalar(pal.hemiI);
    if (lf > 0) this.hemi.color.lerp(_flashCol, Math.min(1, lf));

    // ---- fog / aerial perspective
    this.fogColor.copy(pal.horizon);
    if (lf > 0) this.fogColor.lerp(_flashFog, Math.min(0.6, lf * 0.4));
    const fog = g.scene.fog;
    fog.color.copy(this.fogColor);
    // de-haze at altitude (tactical / aerial views keep saturation)
    const camAlt = THREE.MathUtils.smoothstep(g.camera.position.y, 40, 500);
    fog.density = this.fogBaseDensity * (0.85 + pal.haze * 0.2) * (1 + w.storm * 3.2 + w.rain * 1.2) * (1 - 0.6 * camAlt * (1 - w.storm));
    ATMOS.sunDir.x = this.sunDir.x; ATMOS.sunDir.y = this.sunDir.y; ATMOS.sunDir.z = this.sunDir.z;
    // fog toward the sun warms like the sky band + Mie glow (approximation of the dome's horizon)
    const bandW = (0.35 + 0.65 * lowSun) * THREE.MathUtils.smoothstep(this.sunElevation, -20, -1) * (1 - w.overcast * 0.7);
    _v.set(pal.band.r - pal.horizon.r, pal.band.g - pal.horizon.g, pal.band.b - pal.horizon.b).multiplyScalar(bandW * 0.8)
      .add(_v.clone().set(pal.glow.r, pal.glow.g, pal.glow.b).multiplyScalar(0.12 * sunAbove * (1 - w.overcast * 0.6)));
    ATMOS.sunGlow.x = Math.max(0, _v.x); ATMOS.sunGlow.y = Math.max(0, _v.y); ATMOS.sunGlow.z = Math.max(0, _v.z);
    ATMOS.params.y = 4 + 4 * lowSun;   // tighter in-scatter lobe: the pow(mu, 2) fog glow hazed half the sea toward the sun

    g.renderer.toneMappingExposure = pal.exposure;

    // clouds: lighting inputs
    const cu = this.clouds.uniforms;
    cu.uSunUp.value = THREE.MathUtils.smoothstep(this.sunElevation, -8, 4);
    cu.uLightI.value = Math.min(1.2, pal.lightI / 3);
  }

  _updateEnv(dt) {
    // regenerate PMREM when the lighting state changed noticeably (or every few seconds)
    this._envTimer -= dt;
    const key = `${this.sunElevation.toFixed(0)}|${(this.storm * 10).toFixed(0)}|${(this.overcast * 10).toFixed(0)}`;
    if (key === this._envKey && this._envTimer > -20) return;
    // at least 1.5 s between two computations (sun at 1.5°/s, weather transitions), except a forced jump (_envKey null)
    if (this._envKey !== null && this._envTimer > 6.5) return;
    this._envKey = key;
    this._envTimer = 8;
    const flash = this.u.uFlash.value; this.u.uFlash.value = 0;
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000, { size: 128 });
    this.u.uFlash.value = flash;
    if (rt === this._envRT) return;   // recomputed in place
    if (this._envRT) this._envRT.dispose();
    this._envRT = rt;
    this.envMap = rt.texture;
    this.game.scene.environment = this.envMap;
  }

  update(dt, t) {
    const g = this.game;
    // the sky's continuous advance doesn't force the environment to be recomputed every frame (setTimeOfDay resets
    // _envKey for jumps): the key (1° of sun) decides
    if (this.autoAdvance && dt > 0) { const ek = this._envKey; this.setTimeOfDay(this.timeOfDay + dt * 24 / this.dayLengthSeconds); this._envKey = ek; }

    // weather transition (~20 s)
    const k = dt > 0 ? 1 - Math.exp(-dt / 6) : 0;
    const w = this.w, tw = this.wTarget;
    for (const key of ['coverage', 'cirrus', 'overcast', 'rain', 'storm']) w[key] += (tw[key] - w[key]) * k;
    this.clouds.setCoverage(tw.coverage);
    if (dt > 0) {
      const targetWind = tw.wind ? Math.max(this._baseWind ?? 9, tw.wind) : this._baseWind;
      if (targetWind != null && this.weather !== 'clear') g.wind.speed += (targetWind - g.wind.speed) * k * 0.5;
      else if (targetWind != null && this.weather === 'clear' && Math.abs(g.wind.speed - targetWind) > 0.05 && this._fromStorm) g.wind.speed += (targetWind - g.wind.speed) * k * 0.5;
      if (g.ocean) {
        const targetSea = tw.sea ?? this._baseSea;
        if (targetSea != null && (this.weather !== 'clear' || this._fromStorm)) g.ocean.seaState += (targetSea - g.ocean.seaState) * k * 0.5;
      }
      if (this.weather !== 'clear') this._fromStorm = true;
    }

    // lightning
    this.lightning.update(dt, g.camera, w.storm);
    this.flash = this.lightning.flash;
    this.u.uFlash.value = this.flash;
    this.u.uFlashDir.value.copy(this.lightning.dir);

    // wind drift for clouds / cirrus
    const ws = g.wind.speed * 1.6;
    this._windOff.x += Math.sin(g.wind.angle) * ws * dt;
    this._windOff.y += -Math.cos(g.wind.angle) * ws * dt;
    this.u.uWindOff.value.copy(this._windOff);
    this.u.uTime.value = t;

    this._apply(dt, false);
    this._updateEnv(dt);

    // dome & clouds follow the camera
    const cam = g.camera;
    this.dome.position.copy(cam.position);
    this.clouds.update(dt, cam, this._windOff);
    this.rain.update(dt, t, cam, g.wind, w.rain, this.ambientColor);

    // shadow camera centred on the camera target, snapped to shadow texels to avoid shimmering
    const target = g.cameraRig?.target || cam.position;
    const L = this.lightDir;
    const sl = this.sunLight;
    const texel = (this.shadowRadius * 2) / sl.shadow.mapSize.x;
    // build light-space basis and snap the target in it
    const fwd = _v.copy(L).negate();
    const right = new THREE.Vector3().crossVectors(fwd, Math.abs(fwd.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd);
    const tr = target.dot(right), tu = target.dot(up);
    const snapped = target.clone()
      .addScaledVector(right, Math.round(tr / texel) * texel - tr)
      .addScaledVector(up, Math.round(tu / texel) * texel - tu);
    sl.target.position.copy(snapped);
    sl.position.copy(snapped).addScaledVector(L, 600);
    sl.target.updateMatrixWorld();
  }
}
