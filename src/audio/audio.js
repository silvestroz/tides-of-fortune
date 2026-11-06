// Procedural WebAudio (no external files): ocean ambience, wind, creaks,
// cannon booms, splashes, music bed. Starts on first user gesture. Listens to game.events.
// API: audio.play(name, { position, volume }), audio.setVolumes({ master, music, sfx })
// Extended API:
//   audio.setVolumes({ master, music, sfx })  (0..1; also follows game.settings via 'settings:change')
//   audio.start()          create/resume the AudioContext (called automatically on first pointer/key gesture)
//   audio.ctx              the AudioContext (null until started)
//   audio.combat           0..1 smoothed combat intensity (drives the drums)
//   play() names: 'cannon', 'splash', 'hit', 'creak', 'bell', 'gull', 'flap',
//                 'ui:hover', 'ui:select', 'ui:page', 'ui:back', 'ui:start'
// Event hooks: 'cannon:fire' (booms per gun, staggered along the broadside), 'cannon:splash', 'cannon:hit',
//   'ship:sunk', 'ship:struck', 'port:enter', 'state:change', 'ui:pause', 'settings:change'.
// music director (music.js) — theme picked each frame by _pickTheme(): menu→title, duel/boarding→duel,
//   port→port(nation), famous pirate < 1400 m→boss, combat/tactical cam→battle, storm→storm, else sea. Stingers on
//   boarding:end, duel:end, lord:defeated, player:captured/shipwrecked, enemy ship:sunk/struck. Ambience adds rain,
//   storm wind and a harbour crowd. Debug: audio.stats().
// Runs its own 60 ms timer loop (independent of Game.step and of the frame rate) so ambience follows the live camera.
import * as THREE from 'three';
import { ensureSettings } from '../ui/settings.js';
import { Music } from './music.js';

const _v = new THREE.Vector3(), _r = new THREE.Vector3(), _f = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);

export class Audio {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.combat = 0;
    this._lastFire = -1e9;
    this.settings = ensureSettings(game);
    const kick = () => { this.start(); };
    addEventListener('pointerdown', kick, { capture: true });
    addEventListener('keydown', kick, { capture: true });
    const ev = game.events;
    ev.on('cannon:fire', d => this._onFire(d));
    ev.on('cannon:splash', d => this.play('splash', { position: d?.point }));
    ev.on('cannon:hit', d => this.play('hit', { position: d?.point || d?.target?.position, volume: d?.target === game.player ? 1.2 : 1 }));
    ev.on('ship:sunk', d => { this.play('sink', { position: d?.ship?.position }); });
    ev.on('ship:struck', d => this.play('bell', { volume: 0.7 }));
    ev.on('port:enter', () => this.play('bell'));
    ev.on('settings:change', ({ settings }) => this.setVolumes(settings));
    ev.on('ui:pause', ({ paused }) => this._duck(paused ? 0.35 : 1));
    // music director & stingers (theme itself is chosen every frame in _pickTheme)
    ev.on('port:enter', ({ port } = {}) => { this._port = port || null; });
    ev.on('village:enter', ({ village } = {}) => { this._port = village || null; });   // fishing villages: the village tune
    ev.on('boarding:start', () => { this._boarding = true; });
    ev.on('boarding:end', ({ result } = {}) => {
      this._boarding = false;
      this._sting(result === 'defeat' ? 'defeat' : (result === 'captured' || result === 'sunk') ? 'victory' : null);
    });
    ev.on('duel:end', ({ result } = {}) => { if (!this._boarding) this._sting(result?.winner === 'player' ? 'victory' : 'defeat'); });
    ev.on('lord:defeated', () => this._sting('fanfare', true));
    ev.on('player:captured', () => this._sting('defeat', true));
    ev.on('player:shipwrecked', () => this._sting('defeat', true));
    ev.on('ship:sunk', ({ ship } = {}) => { if (ship && ship !== game.player && this.combat > 0.3) this._sting('victory'); });
    ev.on('ship:struck', ({ ship } = {}) => { if (ship && ship !== game.player && this.combat > 0.3) this._sting('victory'); });
  }

  // ---------------- lifecycle ----------------
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    let ctx;
    try { ctx = this.ctx = new AC({ latencyHint: 'interactive' }); } catch { return; }
    // background tab: requestAnimationFrame stops, so the music scheduler is fed by a timer (browsers throttle it to
    // ~1 s when hidden, hence the 1.6 s horizon); back in the foreground the game loop takes over again.
    document.addEventListener('visibilitychange', () => {
      clearInterval(this._bgTimer); this._bgTimer = 0;
      if (document.hidden) this._bgTimer = setInterval(() => { if (this.ctx?.state === 'running') this.music?.update(0, this.combat || 0, 1.6); }, 400);
    });
    // buses: sfx/amb/music -> master -> duck -> compressor -> out
    this.out = ctx.createDynamicsCompressor();
    Object.assign(this.out, {});
    this.out.threshold.value = -14; this.out.knee.value = 12; this.out.ratio.value = 4; this.out.attack.value = 0.004; this.out.release.value = 0.25;
    this.out.connect(ctx.destination);
    this.duck = ctx.createGain(); this.duck.connect(this.out);
    this.master = ctx.createGain(); this.master.connect(this.duck);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.connect(this.sfx);
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this._impulse(3.2, 2.6);
    this.reverbIn = ctx.createGain(); this.reverbIn.gain.value = 1;
    this.reverbIn.connect(this.reverb); this.reverb.connect(this.sfx);
    this.musicVerb = ctx.createConvolver(); this.musicVerb.buffer = this._impulse(2.2, 3);
    this.musicVerbIn = ctx.createGain(); this.musicVerbIn.connect(this.musicVerb); this.musicVerb.connect(this.musicBus);
    this.noise = { white: this._noise('white', 4), pink: this._noise('pink', 6), brown: this._noise('brown', 6) };
    this.setVolumes(this.settings);
    this._buildAmbience();
    this.music = new Music(this);
    this.music.setTheme(this.game.mode === 'menu' ? 'title' : 'sea');
    this.music.start();
    this._t0 = performance.now();
    // timer, not rAF: music scheduling must keep going when frames are slow (heavy scenes, background tab)
    this._timer = setInterval(() => { try { this._update(); } catch { /* never break the game */ } }, 60);
  }

  setVolumes({ master, music, sfx } = {}) {
    if (master != null) this.settings.master = master;
    if (music != null) this.settings.music = music;
    if (sfx != null) this.settings.sfx = sfx;
    if (!this.ctx) return;
    const t = this.ctx.currentTime, s = this.settings;
    const curve = v => Math.pow(Math.max(0, Math.min(1, v)), 1.6);   // perceptual taper
    this.master.gain.setTargetAtTime(curve(s.master) * 0.9, t, 0.05);
    this.musicBus.gain.setTargetAtTime(curve(s.music) * 0.55, t, 0.05);
    this.sfx.gain.setTargetAtTime(curve(s.sfx), t, 0.05);
  }
  _duck(v) { if (this.ctx) this.duck.gain.setTargetAtTime(v, this.ctx.currentTime, 0.25); }

  // ---------------- buffers ----------------
  _noise(kind, seconds) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w * 0.5;
        else if (kind === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      }
      // crossfade the loop seam
      const fade = Math.floor(ctx.sampleRate * 0.05);
      for (let i = 0; i < fade; i++) { const a = i / fade; d[i] = d[i] * a + d[n - fade + i] * (1 - a); }
    }
    return buf;
  }
  _impulse(seconds, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        lp += (Math.random() * 2 - 1 - lp) * (0.5 - 0.42 * t);    // darker as it decays (air absorption)
        d[i] = lp * Math.pow(1 - t, decay) * (i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1);
      }
    }
    return buf;
  }
  _src(buf, loop = true, rate = 1) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = loop; s.playbackRate.value = rate;
    if (loop) s.loopStart = 0, s.loopEnd = buf.duration;
    return s;
  }
  _filter(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  _gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return g; }

  // ---------------- continuous ambience ----------------
  _buildAmbience() {
    const ctx = this.ctx, A = this.amb;
    const chain = (...nodes) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; };
    // deep ocean bed: brown noise, low-passed, slowly breathing
    const bedSrc = this._src(this.noise.brown, true, 0.9);
    this.bedLP = this._filter('lowpass', 380, 0.5); this.bedGain = this._gain(0.0);
    chain(bedSrc, this.bedLP, this.bedGain, A); bedSrc.start(ctx.currentTime, rnd(0, 3));
    // surf / swells: two pink layers, band-passed, amplitude-modulated by slow wave envelopes
    this.swells = [0, 1].map(i => {
      const s = this._src(this.noise.pink, true, 0.8 + i * 0.13);
      const bp = this._filter('bandpass', 700 + i * 500, 0.6), g = this._gain(0), pan = ctx.createStereoPanner();
      pan.pan.value = i ? 0.45 : -0.45;
      chain(s, bp, g, pan, A); s.start(ctx.currentTime, rnd(0, 5));
      return { bp, g, phase: rnd(0, 6.28), period: rnd(6, 9) };
    });
    // hull wash (rises with ship speed): white noise, band-passed
    const wash = this._src(this.noise.white, true);
    this.washBP = this._filter('bandpass', 1400, 0.8); this.washGain = this._gain(0);
    chain(wash, this.washBP, this.washGain, A); wash.start();
    // wind: pink noise through a moving band-pass + a narrow "whistle in the rigging"
    const wind = this._src(this.noise.pink, true, 1.1);
    this.windBP = this._filter('bandpass', 500, 0.9); this.windGain = this._gain(0);
    chain(wind, this.windBP, this.windGain, A); wind.start(ctx.currentTime, 1.3);
    const whistle = this._src(this.noise.white, true, 1);
    this.whistleBP = this._filter('bandpass', 1800, 8); this.whistleGain = this._gain(0);
    const wp = ctx.createStereoPanner(); wp.pan.value = 0.25;
    chain(whistle, this.whistleBP, this.whistleGain, wp, A); whistle.start();
    // storm rain hiss (sky rain or a storm cell around the player)
    const rain = this._src(this.noise.pink, true, 1.4);
    this.rainHP = this._filter('highpass', 1800, 0.5); this.rainGain = this._gain(0);
    chain(rain, this.rainHP, this.rainGain, A); rain.start(ctx.currentTime, 2.1);
    // harbour crowd: pink noise through three vowel formants with independent wobble (only in port mode)
    this.crowdGain = this._gain(0); this.crowdGain.connect(A);
    this.crowd = [[420, 0.18], [900, 0.12], [2300, 0.05]].map(([f, v], i) => {
      const s2 = this._src(this.noise.pink, true, 0.95 + i * 0.07), bp = this._filter('bandpass', f, 3), g = this._gain(v);
      chain(s2, bp, g, this.crowdGain); s2.start(ctx.currentTime, i * 1.7);
      return { bp, g, f, v, ph: rnd(0, 6) };
    });
    this._next = { creak: 1.5, clink: 3, rope: 4, gull: 6, bell: 9, flap: 0 };
  }

  _update() {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    const now = performance.now() / 1000, dt = Math.min(0.5, now - (this._lastNow || now)); this._lastNow = now;
    const g = this.game, p = g.player, t = ctx.currentTime;
    const fin = (v, d) => (Number.isFinite(v) ? v : d);
    const windSp = Math.min(40, fin(g.wind?.speed, 8)), shipSp = Math.min(40, Math.abs(fin(p?.speed, 0)));
    const menu = g.mode === 'menu';
    // camera height attenuates "on deck" sounds
    const camH = g.camera?.position?.y ?? 20, deck = Math.max(0.25, Math.min(1, 40 / Math.max(10, camH)));

    // ocean swells
    this.bedGain.gain.setTargetAtTime(0.32 + 0.05 * Math.sin(now * 0.31), t, 0.4);
    for (const s of this.swells) {
      const ph = now * 2 * Math.PI / s.period + s.phase;
      const env = Math.pow(Math.max(0, Math.sin(ph)), 3);           // build then crash
      s.g.gain.setTargetAtTime(0.03 + env * 0.16, t, 0.25);
      s.bp.frequency.setTargetAtTime(500 + env * 900, t, 0.3);
    }
    // hull wash
    this.washGain.gain.setTargetAtTime(Math.min(0.2, shipSp * 0.022) * deck, t, 0.3);
    this.washBP.frequency.setTargetAtTime(900 + shipSp * 110 + Math.sin(now * 1.7) * 200, t, 0.2);
    // wind: apparent wind ≈ true wind + speed component
    const app = windSp + shipSp * 0.5;
    const gust = 0.75 + 0.25 * Math.sin(now * 0.23) * Math.sin(now * 0.71 + 1);
    this.windGain.gain.setTargetAtTime(Math.min(0.32, app * 0.017) * gust, t, 0.5);
    this.windBP.frequency.setTargetAtTime(280 + app * 32 * gust, t, 0.5);
    this.whistleGain.gain.setTargetAtTime(Math.max(0, app - 9) * 0.006 * gust * deck, t, 0.6);
    this.whistleBP.frequency.setTargetAtTime(Math.min(4000, 1500 + app * 45 + Math.sin(now * 0.9) * 120), t, 0.6);

    // scheduled one-shots
    const n = this._next;
    for (const k in n) n[k] -= dt;
    if (n.creak <= 0) { n.creak = rnd(2.2, 6) / (0.6 + Math.abs(p?.roll ?? 0.05) * 6 + shipSp * 0.03); if (p && !menu || menu) this.play('creak', { volume: deck }); }
    if (n.rope <= 0) { n.rope = rnd(5, 12) / (0.5 + app * 0.05); this.play('rope', { volume: deck * 0.8 }); }
    const np = p && g.islands?.nearestPort?.(p.position.x, p.position.z);
    const portNear = np?.port ? Math.max(0, 1 - np.dist / 1200) : 0;
    if (n.gull <= 0) { n.gull = rnd(3, 9) / (0.15 + portNear * 1.5); if (portNear > 0.05 || Math.random() < 0.15) this.play('gull', { volume: 0.25 + portNear * 0.6 }); }
    if (n.bell <= 0) { n.bell = rnd(14, 30); if (portNear > 0.3) this.play('bell', { volume: portNear * 0.5, distant: true }); }
    const luff = p?.luff ?? 0;
    if (n.flap <= 0 && luff > 0.25 && (p?.sailSetting ?? 0) > 0) { n.flap = rnd(0.12, 0.45) / luff; this.play('flap', { volume: luff * deck }); }
    else if (n.flap <= 0) n.flap = 0.5;

    // weather: storm cells and sky storm drive wind, rain, swells
    const wk = p?.weatherKind, sky = g.sky;
    const storm = Math.max(fin(sky?.storm, 0), wk === 'storm-eye' ? 1 : wk === 'storm-edge' ? 0.65 : wk === 'squall' ? 0.25 : 0);
    this.storm = storm;
    const rainT = Math.max(fin(sky?.rainIntensity, 0), wk === 'squall' ? 0.5 : 0, storm * 0.9);
    this.rainGain.gain.setTargetAtTime(menu ? 0 : Math.min(0.3, rainT * 0.3), t, 0.8);
    if (storm > 0.05) {
      this.windGain.gain.setTargetAtTime(Math.min(0.5, (app * 0.017 + storm * 0.25) * gust), t, 0.5);
      this.bedGain.gain.setTargetAtTime(0.32 + storm * 0.35, t, 0.6);
    }
    // harbour crowd
    const inVillage = !!g.villages?.isOpen, inPort = g.mode === 'port' && !inVillage;   // fishing village: a few voices, no tavern
    this.crowdGain.gain.setTargetAtTime(inPort ? 0.55 : inVillage ? 0.14 : portNear * 0.12, t, 0.8);
    for (const c of this.crowd) {
      const w = 0.5 + 0.5 * Math.sin(now * (1.3 + c.f / 2000) + c.ph) * Math.sin(now * 0.37 + c.ph);
      c.g.gain.setTargetAtTime(c.v * (0.4 + w * 0.6), t, 0.15);
      c.bp.frequency.setTargetAtTime(c.f * (0.9 + 0.2 * w), t, 0.2);
    }
    if (n.clink <= 0) { n.clink = rnd(1.5, 5); if (inPort) this._tick(rnd(2800, 4200), 0.025, 0.08); }

    // combat intensity: hostile ships nearby or recent gunfire
    let near = 0;
    if (p) for (const s of g.ships || []) {
      if (s === p || s.alive === false || s.struck) continue;
      const hostile = s.hostile === true || s.faction === 'pirate' || g.state?.atWar?.[s.faction];
      if (!hostile) continue;
      const d = Math.hypot(s.position.x - p.position.x, s.position.z - p.position.z);
      near = Math.max(near, 1 - (d - 300) / 900);
    }
    const fireRecent = Math.max(0, 1 - (now - this._lastFire) / 25);
    const target = menu ? 0 : Math.max(0, Math.min(1, Math.max(near * 0.8, fireRecent)));
    this.combat += (target - this.combat) * Math.min(1, dt * (target > this.combat ? 0.8 : 0.12));
    if (this.music) { this.music.setTheme(...this._pickTheme(near)); this.music.update(dt, this.combat); }
  }

  // Music state machine (priority order). Returns [theme, variant].
  _pickTheme(near) {
    const g = this.game, p = g.player, m = g.mode;
    if (m === 'menu') return ['title'];
    if (m === 'duel' || this._boarding) return ['duel'];
    if (m === 'land') return ['battle'];   // land battle reuses the battle theme
    if (m === 'sneak') { if (this.music) this.music.sneakLevel = g.sneak?.level || 0; return ['sneak']; }   // tension 0–3 + alarm
    if (m === 'port') {
      const f = this._port?.village ? 'village' : this._port?.faction || g.islands?.nearestPort?.(p?.position.x ?? 0, p?.position.z ?? 0)?.port?.faction;
      return ['port', f || 'english'];
    }
    const cur = this.music?.cur?.name;
    if (m === 'map') return [cur === 'port' || cur === 'duel' || cur === 'title' ? 'sea' : cur];
    // a famous pirate (pirateLords) close and hostile → boss theme
    if (p) for (const s of g.ships || []) {
      if (!s.lordId || s.alive === false || s.sinking || s.struck) continue;
      if (Math.hypot(s.position.x - p.position.x, s.position.z - p.position.z) < 1400) return ['boss'];
    }
    const tactical = (g.cameraRig?.mode === 'tactical' || g.cameraRig?.engaged) && near > 0;   // recentred view (C): same music
    // hysteresis on battle so it does not flicker at the edge of range
    const battle = cur === 'battle' ? this.combat > 0.18 || tactical : this.combat > 0.35 || tactical;
    if (battle) return ['battle'];
    if ((this.storm || 0) > (cur === 'storm' ? 0.3 : 0.45)) return ['storm'];
    return ['sea'];
  }

  _sting(kind, force = false) {
    if (!kind || !this.music) return;
    const now = performance.now();
    if (!force && now - (this._lastSting || 0) < 6000) return;    // one jingle per engagement burst
    this._lastSting = now;
    try { this.music.stinger(kind); } catch { /* never break the game */ }
  }

  // debug: window.__game.audio.stats()
  stats() { return { state: this.ctx?.state, combat: +this.combat.toFixed(2), storm: +(this.storm || 0).toFixed(2), ...(this.music?.stats() || {}) }; }

  // ---------------- spatial helpers ----------------
  _spatial(pos, { ref = 60, roll = 1.2, max = 1 } = {}) {
    // returns { gain, pan, dist } relative to the camera
    const cam = this.game.camera;
    if (!pos || !cam) return { gain: max, pan: 0, dist: 0 };
    _v.set(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0).sub(cam.position);
    const dist = _v.length();
    cam.matrixWorld.extractBasis(_r, _f, _f);
    const pan = dist > 0.01 ? Math.max(-0.9, Math.min(0.9, _v.dot(_r) / dist)) : 0;
    const gain = Math.min(max, ref / (ref + roll * Math.max(0, dist - ref)));
    return { gain, pan, dist };
  }
  _out(gain, pan, wet = 0.2) {
    const ctx = this.ctx, g = ctx.createGain(); g.gain.value = gain;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    g.connect(p); p.connect(this.sfx);
    if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; p.connect(w); w.connect(this.reverbIn); }
    return g;
  }
  _env(param, t, a, peak, d, end = 0.0001) {
    param.cancelScheduledValues(t); param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + a); param.exponentialRampToValueAtTime(end, t + a + d);
  }

  _onFire(d) {
    if (!d?.ship) return;
    this._lastFire = performance.now() / 1000;
    if (!this.ctx) return;
    const s = d.ship, n = Math.max(1, Math.min(12, d.count || (s.guns || 10) / 2));
    const right = d.side === 'starboard' ? 1 : -1;
    const fx = Math.sin(s.heading), fz = -Math.cos(s.heading), rx = Math.cos(s.heading) * right, rz = Math.sin(s.heading) * right;
    const L = (s.length || 30) * 0.7;
    for (let i = 0; i < n; i++) {
      const k = n === 1 ? 0 : i / (n - 1) - 0.5;
      const pos = { x: s.position.x + fx * k * L + rx * (s.beam || 8) * 0.5, y: 2, z: s.position.z + fz * k * L + rz * (s.beam || 8) * 0.5 };
      this.play('cannon', { position: pos, delay: i * rnd(0.07, 0.16) + (Math.random() < 0.15 ? 0.2 : 0), volume: 1 / Math.sqrt(n) * 1.6, own: s === this.game.player });
    }
  }

  // ---------------- one-shots ----------------
  play(name, { position, volume = 1, delay = 0, own = false, distant = false } = {}) {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    try {
      const fn = this['_s_' + name.replace(':', '_')];
      fn?.call(this, { position, volume, delay, own, distant });
    } catch (e) { /* never let audio break the game */ }
  }

  _s_cannon({ position, volume, delay, own }) {
    const ctx = this.ctx;
    const sp = this._spatial(position, { ref: 80, roll: 0.9 });
    const travel = Math.min(1.2, sp.dist / 343);                      // speed of sound delay
    const t = ctx.currentTime + delay + travel;
    const far = Math.min(1, sp.dist / 1500);
    const out = this._out(sp.gain * volume, sp.pan * 0.8, 0.35 + far * 0.4);
    const lp = this._filter('lowpass', 9000 - far * 7500, 0.5); lp.connect(out);
    // 1) low thump: sine pitch drop
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(rnd(70, 85), t); o.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    const og = ctx.createGain(); this._env(og.gain, t, 0.004, 1.1, 0.7);
    o.connect(og); og.connect(lp); o.start(t); o.stop(t + 0.9);
    // 2) crack: bright noise burst
    const c = this._src(this.noise.white, false, rnd(0.8, 1.2)), cf = this._filter('highpass', 900, 0.7), cg = ctx.createGain();
    this._env(cg.gain, t, 0.001, own ? 1.3 : 0.9, 0.12);
    c.connect(cf); cf.connect(cg); cg.connect(lp); c.start(t, rnd(0, 3)); c.stop(t + 0.25);
    // 3) body / rumble tail: brown noise
    const b = this._src(this.noise.brown, false), bf = this._filter('lowpass', 420, 0.6), bg = ctx.createGain();
    this._env(bg.gain, t, 0.01, 0.9, 1.8 + far);
    b.connect(bf); bf.connect(bg); bg.connect(lp); b.start(t, rnd(0, 3)); b.stop(t + 3);
  }

  _s_splash({ position, volume }) {
    const ctx = this.ctx, sp = this._spatial(position, { ref: 50 }), t = ctx.currentTime + Math.min(0.8, sp.dist / 343);
    const out = this._out(sp.gain * volume * 0.8, sp.pan, 0.2);
    const n = this._src(this.noise.white, false), f = this._filter('bandpass', 2200, 0.9), g = ctx.createGain();
    f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.6);
    this._env(g.gain, t, 0.008, 0.9, 0.7);
    n.connect(f); f.connect(g); g.connect(out); n.start(t, rnd(0, 3)); n.stop(t + 0.9);
    // plunk
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(rnd(300, 420), t); o.frequency.exponentialRampToValueAtTime(90, t + 0.15);
    const og = ctx.createGain(); this._env(og.gain, t, 0.002, 0.25, 0.15); o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.2);
  }

  // gfx-ultra sea life: a whale's blow (long breathy whoosh, low body) and dolphin chirps (short whistles + plop)
  _s_whale_blow({ position, volume }) {
    const ctx = this.ctx, sp = this._spatial(position, { ref: 220, roll: 0.6 }), t = ctx.currentTime + Math.min(1.5, sp.dist / 343);
    const out = this._out(sp.gain * volume * 0.7, sp.pan, 0.45);
    const n = this._src(this.noise.pink, false), f = this._filter('bandpass', 900, 0.6), g = ctx.createGain();
    f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(380, t + 1.6);
    this._env(g.gain, t, 0.08, 0.6, 1.5);
    n.connect(f); f.connect(g); g.connect(out); n.start(t, rnd(0, 3)); n.stop(t + 2);
    const b = this._src(this.noise.brown, false), bf = this._filter('lowpass', 260), bg = ctx.createGain();
    this._env(bg.gain, t, 0.05, 0.5, 1.2); b.connect(bf); bf.connect(bg); bg.connect(out); b.start(t, rnd(0, 3)); b.stop(t + 1.6);
  }

  _s_dolphin({ position, volume }) {
    const ctx = this.ctx, sp = this._spatial(position, { ref: 40 }), t0 = ctx.currentTime + Math.min(0.5, sp.dist / 343);
    const out = this._out(sp.gain * volume * 0.35, sp.pan, 0.2);
    for (let i = 0, n = 2 + Math.floor(Math.random() * 3); i < n; i++) {
      const t = t0 + i * rnd(0.09, 0.2), o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(rnd(2600, 3800), t); o.frequency.exponentialRampToValueAtTime(rnd(5200, 7600), t + 0.08);
      this._env(og.gain, t, 0.005, 0.25, 0.08); o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.15);
    }
    this._s_splash({ position, volume: volume * 0.35 });
  }

  _s_hit({ position, volume }) {
    const ctx = this.ctx, sp = this._spatial(position, { ref: 60 }), t = ctx.currentTime + Math.min(0.8, sp.dist / 343);
    const out = this._out(sp.gain * volume, sp.pan, 0.3);
    // thud
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.2);
    const og = ctx.createGain(); this._env(og.gain, t, 0.002, 0.9, 0.3); o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.4);
    // splintering: a rattle of short resonant clicks
    for (let i = 0; i < 9; i++) {
      const tt = t + i * rnd(0.008, 0.03);
      const n = this._src(this.noise.white, false), f = this._filter('bandpass', rnd(900, 3800), rnd(3, 9)), g = ctx.createGain();
      this._env(g.gain, tt, 0.001, rnd(0.4, 1) * (1 - i / 12), rnd(0.03, 0.09));
      n.connect(f); f.connect(g); g.connect(out); n.start(tt, rnd(0, 3)); n.stop(tt + 0.15);
    }
    // crunch body
    const b = this._src(this.noise.pink, false), bf = this._filter('lowpass', 1400), bg = ctx.createGain();
    this._env(bg.gain, t, 0.003, 0.7, 0.35); b.connect(bf); bf.connect(bg); bg.connect(out); b.start(t, rnd(0, 4)); b.stop(t + 0.5);
  }

  _s_sink({ position }) {
    const ctx = this.ctx, sp = this._spatial(position, { ref: 120 }), t = ctx.currentTime;
    const out = this._out(sp.gain, sp.pan, 0.5);
    // long groan + rushing water
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(42, t + 3.5);
    const of = this._filter('bandpass', 300, 4), og = ctx.createGain(); this._env(og.gain, t, 0.5, 0.25, 3.2);
    o.connect(of); of.connect(og); og.connect(out); o.start(t); o.stop(t + 4);
    const n = this._src(this.noise.pink, false), nf = this._filter('lowpass', 900), ng = ctx.createGain(); this._env(ng.gain, t, 1, 0.5, 4);
    n.connect(nf); nf.connect(ng); ng.connect(out); n.start(t); n.stop(t + 5.5);
  }

  _s_creak({ volume }) {
    // wood creak: a buzzy oscillator whose pitch wavers, through a resonant body filter
    const ctx = this.ctx, t = ctx.currentTime, dur = rnd(0.35, 1.1);
    const out = this._out(volume * rnd(0.05, 0.11), rnd(-0.6, 0.6), 0.15);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f0 = rnd(55, 120); o.frequency.setValueAtTime(f0, t);
    for (let i = 1; i <= 6; i++) o.frequency.linearRampToValueAtTime(f0 * rnd(0.85, 1.35), t + dur * i / 6);
    // stick-slip: amplitude chopped by a fast square LFO
    const am = ctx.createGain(); am.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = rnd(18, 40);
    const lg = ctx.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain);
    const f = this._filter('bandpass', rnd(500, 1100), 6), g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(am); am.connect(f); f.connect(g); g.connect(out);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  }

  _s_rope({ volume }) {
    // rope strain: a thin squeal rising in pitch
    const ctx = this.ctx, t = ctx.currentTime, dur = rnd(0.4, 0.9);
    const out = this._out(volume * 0.035, rnd(-0.7, 0.7), 0.25);
    const o = ctx.createOscillator(); o.type = 'triangle';
    const f0 = rnd(700, 1100); o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * rnd(1.1, 1.4), t + dur);
    const vib = ctx.createOscillator(); vib.frequency.value = rnd(9, 16); const vg = ctx.createGain(); vg.gain.value = f0 * 0.03; vib.connect(vg); vg.connect(o.frequency);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + dur * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); vib.start(t); o.stop(t + dur); vib.stop(t + dur);
  }

  _s_flap({ volume }) {
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._out(volume * 0.35, rnd(-0.3, 0.3), 0.1);
    const n = this._src(this.noise.pink, false), f = this._filter('lowpass', rnd(700, 1400), 1.5), g = ctx.createGain();
    this._env(g.gain, t, 0.006, 1, rnd(0.08, 0.16));
    n.connect(f); f.connect(g); g.connect(out); n.start(t, rnd(0, 5)); n.stop(t + 0.25);
  }

  _s_gull({ volume }) {
    // gull cry: 2–4 descending yelps with formant-ish filtering
    const ctx = this.ctx, n = 2 + Math.floor(Math.random() * 3), pan = rnd(-0.8, 0.8);
    const out = this._out(volume * 0.08, pan, 0.5);
    let t = ctx.currentTime + 0.02;
    for (let i = 0; i < n; i++) {
      const d = rnd(0.16, 0.3), f0 = rnd(1300, 1700) * (1 - i * 0.04);
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0 * 0.75, t); o.frequency.linearRampToValueAtTime(f0, t + d * 0.25); o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + d);
      const f = this._filter('bandpass', 2200, 3), g = ctx.createGain(); this._env(g.gain, t, 0.02, 1, d);
      o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.05);
      t += d + rnd(0.04, 0.12);
    }
  }

  _s_bell({ volume, distant }) {
    // ship's bell / harbour bell: inharmonic partials, two strokes
    const ctx = this.ctx, out = this._out(volume * (distant ? 0.12 : 0.22), distant ? rnd(-0.6, 0.6) : 0, distant ? 0.7 : 0.4);
    const base = distant ? rnd(520, 640) : 880;
    const partials = [[0.5, 0.5, 3.5], [1, 1, 2.6], [1.19, 0.5, 2], [1.56, 0.35, 1.4], [2, 0.3, 1.2], [2.74, 0.18, 0.8], [3.76, 0.1, 0.5]];
    for (const stroke of [0, 0.55]) {
      const t = ctx.currentTime + stroke;
      for (const [r, a, d] of partials) {
        const o = ctx.createOscillator(); o.frequency.value = base * r * rnd(0.998, 1.002);
        const g = ctx.createGain(); this._env(g.gain, t, 0.002, a, d);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + d + 0.1);
      }
    }
  }

  // UI sounds: soft, woody and papery
  _s_ui_hover() { this._tick(2400, 0.035, 0.03); }
  _s_ui_select() { this._tick(1300, 0.08, 0.06); this._tick(2600, 0.04, 0.04, 0.03); }
  _s_ui_back() { this._tick(900, 0.07, 0.06); }
  _s_ui_page() {
    const ctx = this.ctx, t = ctx.currentTime, out = this._out(0.22, 0, 0.1);
    const n = this._src(this.noise.white, false), f = this._filter('bandpass', 3500, 0.6), g = ctx.createGain();
    f.frequency.setValueAtTime(5000, t); f.frequency.exponentialRampToValueAtTime(1800, t + 0.25);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    n.connect(f); f.connect(g); g.connect(out); n.start(t, rnd(0, 3)); n.stop(t + 0.35);
  }
  _s_ui_start() { this._s_bell({ volume: 1.6 }); this.music?.flourish(); }
  _tick(freq, vol, dur, delay = 0) {
    const ctx = this.ctx, t = ctx.currentTime + delay, out = this._out(vol, 0, 0.15);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
    const g = ctx.createGain(); this._env(g.gain, t, 0.002, 1, dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
  }
}
