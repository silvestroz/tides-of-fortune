// Game — the root object: renderer, scene, camera rig, world (sky, ocean, islands), ships and every game system.
// Runs the frame loop (step → lateUpdate → render), the shader warm-ups and the showcase scenes (?shot=).
// `mode` is one of 'sail' | 'port' | 'duel' | 'map' | 'menu' | 'land' | 'sneak'. Debug handle: window.__game.
import * as THREE from 'three';
import { Events } from './events.js';
import { Input } from './input.js';
import { mulberry32 } from './rng.js';
import { QUALITY, applyQualityTier } from './constants.js';
import { ensureSettings } from '../ui/settings.js';

import { Sky } from '../world/sky.js';
import { Ocean } from '../world/ocean.js';
import { Islands } from '../world/islands.js';
import { PostFX } from './post.js';
import { DynRes } from './dynres.js';                     // perf: adaptive resolution
import { FramePacer } from './framePacer.js';
import { ShipOcclusion } from '../world/occlusion.js';             // even steps, cadence on fast screens
import { PerfOverlay } from '../ui/perfOverlay.js';       // perf: F3 overlay
import { Ship } from '../ships/ship.js';
import { SeaZones } from '../world/seaZones.js';   // sea tiers
import { Villages } from '../game/village.js';     // fishing villages
import { WeatherZones } from '../world/weatherZones.js';
import { buildShipModel, SHIP_SPECS } from '../ships/shipModel.js';
import { warmupPortraits } from '../ui/port/portrait3d.js';   // character portraits
import { CameraRig } from '../camera/cameraRig.js';
import { PlayerController } from '../ships/playerController.js';
import { CombatSystem } from '../combat/combat.js';
import { FX } from '../fx/fx.js';
import { HUD } from '../ui/hud.js';
import { Nameplates } from '../ui/nameplates.js';
import { Audio } from '../audio/audio.js';
import { PortSystem } from '../game/ports/ports.js';
import { DuelSystem } from '../game/duel/duelScene.js';
import { Boarding } from '../game/boarding.js';
import { WorldMap } from '../ui/map/worldMap.js';
import { Fortune } from '../game/fortune.js';              // specialists, items, treasure maps
import { PirateLords } from '../game/pirateLords.js';      // top 10 pirate captains
import { Retirement } from '../game/retirement.js';        // end of career
import { LivingWorld } from '../game/living.js';           // diplomacy, hunters, convoys, towns
import { Registry } from '../ui/registry.js';              // Registry (L)
import { HoldScreen } from '../ui/holdScreen.js';         // the hold at sea (I)
import { LandBattle } from '../game/landbattle/landBattle.js';   // town attacks, land battle
import { Sneak } from '../game/sneak/sneak.js';                  // infiltration / prison escape
import { installGpuProbe } from './gpuProbe.js';                   // propose the ultra tier on strong GPUs
import { SeaLife } from '../world/seaLife.js';                    // dolphins, whale, flying fish, turtle, ray
import { startPortFor, startPose } from '../data/creation.js';    // character creation: starting port

// URL params (used by the screenshot tool and for debugging):
//   ?shot=<name>   run a showcase scene from src/shots/<name>.js instead of normal play
//   ?tod=<hours>   force time of day (e.g. 17.5)
//   ?seed=<int>    world seed
//   ?frozen=1      freeze simulation time after setup (stable screenshots)
//   ?nohud=1       hide HUD
export class Game {
  constructor(container, uiRoot) {
    this.bootTimes = []; this._bt = performance.now();   // construction times (ms), read by tools/perf-load.mjs
    this.params = new URLSearchParams(location.search);
    this.container = container;
    this.uiRoot = uiRoot;
    this.seed = parseInt(this.params.get('seed') || '1717', 10);
    this.rand = mulberry32(this.seed);
    this.events = new Events();
    this.time = 0;              // simulation seconds
    this.timeScale = 1;
    this.frozen = false;
    this.mode = 'sail';         // 'sail' | 'port' | 'duel' | 'map' | 'menu' | 'land' | 'sneak'

    // ---- quality tier (integration): ?quality=low|medium|high overrides the saved setting ----
    ensureSettings(this);
    this.quality = applyQualityTier(this.params.get('quality') || this.settings.quality || 'high').tier;
    // ---- renderer ----
    // the scene is rendered through PostFX into its own 4x MSAA target, so the default framebuffer needs no AA
    // preserveDrawingBuffer (a copy of the image every frame) only for the tools (Playwright: navigator.webdriver,
    // ?shot= showcases), which freeze the loop before a capture; players keep the direct swap
    const keepBuffer = !!navigator.webdriver || this.params.has('shot') || this.params.get('keepbuffer') === '1';
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: QUALITY.antialias || this.params.get('post') === '0', powerPreference: 'high-performance', preserveDrawingBuffer: keepBuffer });
    this.pacer = new FramePacer({ mode: this.settings.fps || 'auto', calibrate: !navigator.webdriver });   // refresh rate, even dt, cadence (settings.fps)
    this.events.on('settings:change', ({ patch }) => { if (patch.fps) this.pacer.mode = patch.fps; });
    this.dynres = new DynRes(this);   // pixel ratio: tier cap (1.0 unless 'high') + dynamic scale, ?dynres=0 / ?pr=N
    r.setPixelRatio(this.dynres.scale);
    // every program compiled by renderer.compile (warm-ups) is pinned at once, before the warm-up set is
    // disposed; those of a first render, right after that render (renderer.render)
    this._pinned = 0; this._pinLen = 0;
    { const rc = r.compile.bind(r); r.compile = (...a) => { const m = rc(...a); this._pinPrograms(); return m; }; }
    { const rr = r.render.bind(r); r.render = (sc, cam) => { rr(sc, cam); if (r.info.programs && r.info.programs.length !== this._pinLen) this._pinPrograms(); }; }   // and after every render that created some
    r.setSize(innerWidth, innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 40000);
    this.camera.position.set(0, 30, 80);

    this.input = new Input(r.domElement);
    this.bootMark('renderer');

    // ---- world state shared by systems ----
    this.wind = { angle: Math.PI * 0.75, speed: 9 };   // m/s, blows toward angle
    this.ships = [];          // all Ship entities (player included)
    this.player = null;       // the player's Ship
    this.state = {            // career / life-sim state (phase 2 expands this)
      name: 'Captain', gold: 1200, crew: 40, food: 60, rank: {}, reputation: {},
      date: { year: 1660, month: 6, day: 1 }, fleet: [], cargo: {},
    };
    this.systems = [];

    // ---- systems (order matters for update) ----
    this.sky = this.addSystem(new Sky(this));
    this.ocean = this.addSystem(new Ocean(this));
    this.islands = this.addSystem(new Islands(this));
    this.fx = this.addSystem(new FX(this));
    this.combat = this.addSystem(new CombatSystem(this));
    this.weatherZones = this.addSystem(new WeatherZones(this));   // squalls / storms (speed, damage, map)
    this.seaZones = this.addSystem(new SeaZones(this));           // sea tiers (src/data/seaZones.js)
    this.cameraRig = this.addSystem(new CameraRig(this));
    this.post = new PostFX(this); this.bootMark('PostFX');
    this.perfOverlay = new PerfOverlay(this, uiRoot || document.body);
    this.audio = new Audio(this); this.bootMark('Audio');
    this.hud = this.params.get('nohud') ? null : this.addSystem(new HUD(this));
    this.nameplates = this.params.get('nohud') ? null : new Nameplates(this);   // updated after the camera

    this.ports = this.addSystem(new PortSystem(this));   // also creates this.career
    this.villages = this.addSystem(new Villages(this));  // fishing villages: neutral ports of call (F)
    this.duel = this.addSystem(new DuelSystem(this));
    this.boarding = new Boarding(this); this.bootMark('Boarding');
    this.worldMap = this.addSystem(new WorldMap(this));   // sets mapKeyHandled
    this.fortune = this.addSystem(new Fortune(this));
    this.lords = this.addSystem(new PirateLords(this));
    this.retirement = new Retirement(this);
    this.living = this.addSystem(new LivingWorld(this));
    this.registry = this.params.get('nohud') ? null : new Registry(this);
    this.hold = this.params.get('nohud') ? null : new HoldScreen(this);      // the hold at sea (I): jettison goods
    this.landBattle = this.addSystem(new LandBattle(this));   // mode 'land'
    this.sneak = this.addSystem(new Sneak(this));             // mode 'sneak'
    this.seaLife = QUALITY.tier === 'low' ? null : this.addSystem(new SeaLife(this));   // rare sea animals
    this.occlusion = this.addSystem(new ShipOcclusion(this));   // ships behind islands are not drawn (?occlusion=0)

    if (this.params.get('tod')) this.sky.setTimeOfDay(parseFloat(this.params.get('tod')));

    addEventListener('resize', () => this.resize());
    this.clock = new THREE.Timer();
  }

  addSystem(s) { this.bootMark(s.constructor?.name); this.systems.push(s); return s; }
  bootMark(name) { const t = performance.now(); this.bootTimes?.push([name || '?', Math.round(t - this._bt)]); this._bt = t; }

  spawnShip(opts) {
    const s = new Ship(this, opts);
    this.ships.push(s);
    return s;
  }
  removeShip(s) {
    const i = this.ships.indexOf(s);
    if (i >= 0) this.ships.splice(i, 1);
    s.dispose?.();
  }

  async start() {
    const shot = this.params.get('shot');
    if (shot) {
      // showcases: warm-ups (sea, ship designs) and rare warm-ups straight away, BEFORE staging, so that no
      // compilation lands inside a showcase that runs in real time from its setup
      this.warmup(); this.warmupRare(true);
      const mods = import.meta.glob('../shots/*.js');
      const loader = mods[`../shots/${shot}.js`];
      if (!loader) throw new Error('Unknown shot ' + shot);
      const mod = await loader();
      await mod.setup(this);
    } else {
      await this.setupDefaultGame();
    }
    this.bootMark('start:setup');
    // warm up a few frames before signalling readiness (lets shaders compile / sims settle)
    for (let i = 0; i < 6; i++) this.step(1 / 30);
    this.bootMark('start:steps');
    this.warmup();   // perf: precompile all scene + FX shaders now (load time), not on first sight / first broadside
    this.bootMark('start:warmup');
    this.events.on('state:change', e => { if (e.from === 'menu' && e.to === 'sail') this.warmup(); });
    if (this.params.get('frozen')) this.frozen = true;
    installGpuProbe(this);   // suggest once the tier that suits the machine: ultra on a strong GPU, Standard when ultra does not hold
    window.__ready = true;
    // loading summary in the console (measure on a real machine: F12 → Console)
    { const nm = {}; for (const [k, v] of Object.entries(this)) if (v && typeof v === 'object' && v.constructor && v.constructor !== Object) nm[v.constructor.name] ??= k;   // minified names → game keys
      const t = {}; for (const [n, ms] of this.bootTimes) t[nm[n] || n] = (t[nm[n] || n] || 0) + ms; const top = Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 6);
      console.info(`[loading] ready at ${(performance.now() / 1000).toFixed(1)} s${window.__prebake ? ` · terrain baked in ${window.__prebake.ms} ms (${window.__prebake.workers} workers)` : ''} · ${top.map(([n, ms]) => `${n} ${ms} ms`).join(' · ')}`); }
    this.renderer.setAnimationLoop(ts => this.frame(ts));
    if (!shot) this.warmupRare();   // title screen: one per idle slot
  }

  async setupDefaultGame() {
    // start in the roads of an English port (the captain sheet's default nation); ?start=<port id> for the tools
    // (perf-breakdown: havana). The captain sheet moves the ship in front of a port of the chosen nation.
    const ports = this.islands.ports || [], port = ports.find(p => p.id === this.params.get('start')) || startPortFor(ports, 'english');
    const start = startPose(port);
    this.player = this.spawnShip({ type: 'brig', faction: 'english', isPlayer: true, x: start.x, z: start.z, heading: this.params.get('start') ? 0.6 : start.heading, name: 'Merry Wren' });
    this.player.controller = new PlayerController(this, this.player);
    this.cameraRig.follow(this.player);
    this.combat.spawnInitialTraffic?.();
  }

  // ts: rAF timestamp from the animation loop (the frame pacer turns it into an even step and may skip a refresh);
  // tools that call frame() by hand pass nothing and get the wall-clock step, as before
  frame(ts) {
    this.clock.update();
    let dt = this.clock.getDelta();
    if (ts !== undefined) { dt = this.pacer.tick(ts); if (dt < 0) return; }
    dt = Math.min(dt, 1 / 20);
    if (this.frozen) dt = 0;
    this.step(dt * this.timeScale);
    // perf: resolution changes happen BEFORE rendering: a resize after the render cleared the canvas, and a frame
    // presented (or captured) right then showed an all-black 3D view (the intermittent black combat screenshots)
    const now = ts ?? performance.now();
    this.dynres.frame(now);
    if (this.renderOverride) this.renderOverride(dt); else this.post.render(dt);   // renderOverride: full-screen modes (port stages, duel sets, land battle, sneaking)
    this.input.endFrame();
    this.perfOverlay.frame(now);
  }

  step(dt) {
    this.time += dt;
    for (const s of this.systems) s.update?.(dt, this.time);
    for (const ship of this.ships) ship.update(dt, this.time);
    this.cameraRig?.lateUpdate?.(dt);   // camera positions after ships move
    this.nameplates?.update(dt);
    this.duel?.lateUpdate?.(dt);        // the duel camera overrides the rig while active
  }

  // perf: compile every material in the scene (including frustum-culled objects and FX pools) so no shader
  // program is built mid-game; called at load and when setting sail (screen is faded then).
  warmup() {
    const m = n => this.bootMark('warmup:' + n);   // duration of each step (game.bootTimes)
    m('begin');
    warmupPortraits(this, { render: false });   // character portraits: the hall paintings know the game; the bust renders in warmupRare
    // port sets, duel deck and portrait medallions compile during the title screen (warmupRare); whatever is not
    // done when the menu closes compiles on first use, as before. The town scenes (land battle, sneaking) build and
    // compile their own content when they start, under their loading screen (src/ui/townLoader.js).
    // The sea is drawn by PostFX into a render target (linear output, no tone mapping); compiled for the screen
    // (null target), the warm-up programs were useless to it and everything recompiled on the first frame (the duel
    // recompiled its characters). So we compile into a small target, like the real render.
    const rt0 = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.post?.enabled ? (this._warmRT ||= new THREE.WebGLRenderTarget(4, 4)) : null);
    this.fx?.warmup?.(); m('fx');
    this.seaLife?.warmup?.(); m('seaLife');      // sea animals (one mesh per species, shown for the compile)
    this.duel?.warmup?.(); m('duel');         // duel: duellists' ink contour program
    try { this.renderer.compile(this.scene, this.camera); } catch (e) { console.warn('warmup', e); }
    m('compile');
    // perf: renderer.compile() skips shadow-depth programs (hull/sail customDepthMaterial, crew/staff depth). Keep a
    // hidden pool with one model per ship type; on first warmup show it under the camera for one shadow+colour render
    // so every depth variant compiles at load, then hide it (never disposed -> its programs stay referenced).
    if (!this._shipWarmPool) {
      const r = this.renderer, c = this.player?.position || { x: 0, z: 0 };
      this._shipWarmPool = Object.keys(SHIP_SPECS).filter(t => !SHIP_SPECS[t].base || SHIP_SPECS[t].base === t).map(type => {   // one per base design (variants share programs)
        try { const m = buildShipModel(type, { faction: 'english', name: 'warmup' }); m.group.position.set(c.x, 0, c.z); this.scene.add(m.group); return m; }
        catch (e) { console.warn('warmup ship', type, e); return null; }
      }).filter(Boolean);
      const prevT = r.getRenderTarget();
      try { r.shadowMap.needsUpdate = true; r.compile(this.scene, this.camera); r.render(this.scene, this.camera); }
      catch (e) { console.warn('warmup shadows', e); }
      r.setRenderTarget(prevT);
      for (const m of this._shipWarmPool) m.group.visible = false;
      m('shipPool');
    }
    this.renderer.setRenderTarget(rt0);
    try { this.post?.warm?.(); } catch (e) { console.warn('warmup post', e); } m('post');   // post chain, upscaler included (dynamic resolution)
    // ocean wakes: the cannon-splash splat pass only renders when a ball lands -> its program compiled on the first
    // broadside (measured ~1 new program mid-combat). Compile it into its own render target (linear output key).
    const w = this.ocean?.wakes, r = this.renderer;
    if (w?.splatScene && w.splashB) {
      const prev = r.getRenderTarget();
      try { r.setRenderTarget(w.splashB); r.compile(w.splatScene, w.camera); } catch (e) { console.warn('warmup wakes', e); }
      r.setRenderTarget(prev);
    }
  }

  // Warm-up of the rare modes off the loading path, one per idle slot (requestIdleCallback) and only while in the
  // menu (title screen, captain creation): at sea, a step (0.1 to 1 s) would be a hitch. Most useful first.
  // warmupRare(true): everything, right now (?shot= showcases, stable captures).
  warmupRare(now = false) {
    const stage = kind => () => this.ports?.stage?.constructor?.warmup?.(this, kind);
    const q = this._rareQ ||= [
      ['duelDeck', () => {                                 // first boarding: duel deck, dressing, sailors (sea's target)
        const r = this.renderer, rt0 = r.getRenderTarget();
        r.setRenderTarget(this.post?.enabled ? (this._warmRT ||= new THREE.WebGLRenderTarget(4, 4)) : null);
        try { this.duel?.warmupDeck?.(this._shipWarmPool?.[0]); } finally { r.setRenderTarget(rt0); }
      }],
      ['portraits', () => warmupPortraits(this)],          // character portraits: port speaker busts (studio programs)
      ['worldMap', () => this.worldMap?._ensureBase?.()],  // chart (M): engraved 3072² background baked once (~1 s on first open)
      ['port:market', stage('market')], ['port:tavern', stage('tavern')], ['port:shipyard', stage('shipyard')], ['port:governor', stage('governor')],
    ];
    const run = () => { const it = q.shift(); if (!it) return; this._bt = performance.now(); try { it[1](); } catch (e) { console.warn('warmup', it[0], e); } this.bootMark('warmup:' + it[0]); };
    if (now) { while (q.length) run(); return; }
    const idle = window.requestIdleCallback ? f => requestIdleCallback(f, { timeout: 3000 }) : f => setTimeout(f, 120);
    const next = () => { if (!q.length) return; if (this.mode !== 'menu') { setTimeout(next, 2000); return; } idle(() => { if (this.mode === 'menu') run(); next(); }); };
    next();
  }

  // three disposes a shader program as soon as no material uses it — every port, duel or land battle
  // recompiled them on each visit (a 10 to 60 ms hitch per program on Windows). We keep them all (usedTimes + 1):
  // ~150 to 250 programs in all, a few tens of KB each driver-side; safety cap 600.
  _pinPrograms() {
    const P = this.renderer.info.programs;
    if (!P) return;
    for (const p of P) if (!p._tofPin && this._pinned < 600) { p._tofPin = true; p.usedTimes++; this._pinned++; }
    this._pinLen = P.length;
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.post.resize?.(innerWidth, innerHeight);
  }
}
