// Procedural sounds of the town scenes (sneak and land battle), built on the game's Audio buses: created when a town
// scene starts, disposed when it ends (nothing exists at sea). Everything goes through audio.sfx, so the master and
// sound-effect volumes of the settings apply. Silent (every call a no-op) until the AudioContext runs.
//   const ts = new TownSounds(game.audio, { night: true })   ts.dispose()
//   Positional calls take sp = { gain, pan } (0..1, -1..1), computed by the scene from its own listener.
//   ts.step(surface, sp, { loud })        footstep: surface 'cobble' | 'plank' | 'grass'; loud 0 (sneaking) .. 1 (running)
//   ts.clink(sp)                         armour and musket clink of a walking guard
//   ts.voice(text, sp, { pitch, urgent }) a short vocal-like cue shaped by the text (syllables, question, shout)
//   ts.swish(sp) (a throw) · ts.stone(sp) (a stone lands) · ts.ko(sp) (knock-out thud) · ts.lock() (lock-picking clicks) · ts.alarm() (bell peal)
//   ts.dog(sp) (a distant bark) · ts.update(dt, { surf, tavern }) (night ambience: crickets, surf 0..1, tavern murmur 0..1)
//   ts.volley(sp, n) (a ragged musket volley of n shots) · ts.melee(sp) (steel and scuffle) · ts.horn(kind) ('rout' | 'hold')
//   ts.drum(beats)
const rnd = (a, b) => a + Math.random() * (b - a);

export class TownSounds {
  constructor(audio, { night = false } = {}) {
    this.audio = audio; this.night = night; this.ok = false; this.nodes = [];
    this._next = { cricket: 0.5, dog: rnd(6, 14), laugh: rnd(3, 8), clink: rnd(1, 3), bell: 0 };
  }

  // lazy: the context may start (first gesture) after the scene
  _init() {
    if (this.ok) return true;
    const a = this.audio, ctx = a?.ctx;
    if (!ctx || ctx.state !== 'running' || !a.sfx) return false;
    this.ctx = ctx;
    this.bus = ctx.createGain(); this.bus.connect(a.sfx);
    this.wet = ctx.createGain(); this.wet.gain.value = 1; this.wet.connect(a.reverbIn || a.sfx);
    const n = Math.floor(ctx.sampleRate * 1.5);
    this.white = ctx.createBuffer(1, n, ctx.sampleRate);
    this.pink = ctx.createBuffer(1, n, ctx.sampleRate);
    const w = this.white.getChannelData(0), p = this.pink.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const x = Math.random() * 2 - 1; w[i] = x * 0.5;
      b0 = 0.997 * b0 + x * 0.029; b1 = 0.985 * b1 + x * 0.032; b2 = 0.95 * b2 + x * 0.048;
      p[i] = (b0 + b1 + b2 + x * 0.02) * 1.6;
    }
    if (this.night) this._buildNight();
    this.ok = true;
    return true;
  }

  // the continuous night beds: surf (pink noise, slow swell) and the tavern murmur (formant-filtered noise)
  _buildNight() {
    const ctx = this.ctx;
    const loop = (buf, rate) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(ctx.currentTime, rnd(0, 1)); this.nodes.push(s); return s; };
    this.surfG = ctx.createGain(); this.surfG.gain.value = 0; this.surfG.connect(this.bus);
    const sLP = this._filter('lowpass', 520, 0.4); loop(this.pink, 0.55).connect(sLP); sLP.connect(this.surfG);
    this.tavG = ctx.createGain(); this.tavG.gain.value = 0; this.tavG.connect(this.bus);
    this.tav = [[380, 0.5], [820, 0.32], [2100, 0.12]].map(([f, v], i) => {
      const bp = this._filter('bandpass', f, 3.2), g = ctx.createGain(); g.gain.value = v;
      loop(this.pink, 0.9 + i * 0.08).connect(bp); bp.connect(g); g.connect(this.tavG);
      return { bp, g, f, v, ph: rnd(0, 6) };
    });
  }

  _filter(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  // an output for one sound: gain, pan, a share to the reverb; disconnected when the sound has died
  _out(sp, vol, wet = 0.15, life = 2) {
    const ctx = this.ctx, g = ctx.createGain(), p = ctx.createStereoPanner();
    g.gain.value = Math.max(0, vol * (sp?.gain ?? 1)); p.pan.value = Math.max(-1, Math.min(1, sp?.pan ?? 0));
    g.connect(p); p.connect(this.bus);
    let w = null;
    if (wet > 0) { w = ctx.createGain(); w.gain.value = wet; p.connect(w); w.connect(this.wet); }
    setTimeout(() => { try { g.disconnect(); p.disconnect(); w?.disconnect(); } catch { /* already gone */ } }, life * 1000 + 200);
    return g;
  }
  _env(param, t, a, peak, d) {
    param.setValueAtTime(0.0001, t); param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); param.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  _noise(out, t, { buf = this.white, type = 'bandpass', f = 1000, q = 1, a = 0.002, peak = 1, d = 0.1, f1 = 0 } = {}) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rnd(0.9, 1.1);
    const fl = this._filter(type, f, q), g = this.ctx.createGain();
    if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + a + d);
    this._env(g.gain, t, a, peak, d);
    s.connect(fl); fl.connect(g); g.connect(out); s.start(t, rnd(0, 1.2)); s.stop(t + a + d + 0.05);
  }
  _tone(out, t, { type = 'sine', f = 440, f1 = 0, a = 0.002, peak = 1, d = 0.1 } = {}) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.type = type;
    o.frequency.setValueAtTime(f, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + a + d);
    this._env(g.gain, t, a, peak, d);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + a + d + 0.05);
  }

  // ---------------------------------------------------------------- the sneak
  step(surface = 'cobble', sp, { loud = 0.5 } = {}) {
    if (!this._init() || (sp?.gain ?? 1) < 0.01) return;
    const t = this.ctx.currentTime + rnd(0, 0.01), out = this._out(sp, 0.12 + loud * 0.5, 0.06, 0.6);
    if (surface === 'plank') {        // hollow boards: a resonant knock, a little creak
      this._tone(out, t, { f: rnd(150, 190), f1: 90, peak: 0.7, d: 0.09 });
      this._noise(out, t, { f: rnd(420, 560), q: 4, peak: 0.6, d: 0.07 });
      if (Math.random() < 0.18) this._tone(out, t + 0.03, { type: 'sawtooth', f: rnd(280, 360), f1: rnd(300, 420), a: 0.02, peak: 0.05, d: 0.12 });
    } else if (surface === 'grass') { // soft swish
      this._noise(out, t, { buf: this.pink, type: 'lowpass', f: 900, peak: 0.5, a: 0.01, d: 0.09 });
    } else {                          // cobbles: heel tap, a grit scrape when running
      this._tone(out, t, { f: rnd(95, 120), f1: 55, peak: 0.55, d: 0.05 });
      this._noise(out, t, { f: rnd(1500, 2300), q: 1.4, peak: 0.55, d: 0.035 });
      if (loud > 0.6) this._noise(out, t + 0.02, { type: 'highpass', f: 3000, peak: 0.18, a: 0.01, d: 0.06 });
    }
  }
  clink(sp) {
    if (!this._init() || (sp?.gain ?? 1) < 0.01) return;
    const t = this.ctx.currentTime + rnd(0.01, 0.05), out = this._out(sp, 0.06, 0.1, 0.6);
    const f = rnd(2600, 3900);
    for (const [r, a] of [[1, 1], [2.71, 0.4], [4.1, 0.2]]) this._tone(out, t, { f: f * r, peak: a, d: rnd(0.05, 0.12) });
    if (Math.random() < 0.5) this._tone(out, t + rnd(0.03, 0.07), { f: f * 1.13, peak: 0.5, d: 0.05 });
  }

  // vocal-like cue: a buzzy glottal source through moving vowel formants, one envelope per syllable
  voice(text, sp, { pitch = 1, urgent = false } = {}) {
    if (!this._init()) return;
    const ctx = this.ctx, words = String(text).split(/\s+/).filter(Boolean);
    const syl = Math.max(1, Math.min(7, words.reduce((n, w) => n + Math.max(1, (w.match(/[aeiouy]+/gi) || []).length), 0)));
    const ask = /\?/.test(text), shout = urgent || /!/.test(text), trail = /…/.test(text);
    const dur = syl * (shout ? 0.13 : 0.16) * (trail ? 1.25 : 1);
    const t0 = ctx.currentTime + 0.02, out = this._out(sp, shout ? 0.32 : 0.2, 0.25, dur + 1);
    const f0 = 118 * pitch * (shout ? 1.35 : 1);
    const src = ctx.createOscillator(); src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0, t0);
    src.frequency.linearRampToValueAtTime(f0 * (ask ? 1.35 : trail ? 0.8 : shout ? 1.1 : 0.88), t0 + dur);
    const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 5.5; vg.gain.value = f0 * 0.02; vib.connect(vg); vg.connect(src.frequency);
    const amp = ctx.createGain(); amp.gain.value = 0.0001;
    const VOW = [[700, 1200], [400, 2000], [500, 900], [300, 2300], [600, 1700]];
    const F1 = this._filter('bandpass', 600, 6), F2 = this._filter('bandpass', 1500, 8), mix = ctx.createGain(); mix.gain.value = 1;
    src.connect(amp); amp.connect(F1); amp.connect(F2); F1.connect(mix); F2.connect(mix); mix.connect(out);
    for (let i = 0; i < syl; i++) {
      const t = t0 + i * dur / syl, v = VOW[(text.charCodeAt(i * 2 % text.length) + i) % VOW.length], len = dur / syl;
      F1.frequency.setTargetAtTime(v[0], t, 0.02); F2.frequency.setTargetAtTime(v[1], t, 0.02);
      const pk = (shout ? 1 : 0.7) * (i === 0 ? 1 : 0.8);
      amp.gain.setTargetAtTime(pk, t, 0.012); amp.gain.setTargetAtTime(0.05, t + len * 0.7, 0.02);
      if (i % 2 === 0) this._noise(out, t, { type: 'highpass', f: 3500, peak: 0.08, d: 0.03 });   // a consonant
    }
    amp.gain.setTargetAtTime(0.0001, t0 + dur, 0.03);
    src.start(t0); vib.start(t0); src.stop(t0 + dur + 0.2); vib.stop(t0 + dur + 0.2);
  }

  swish(sp) {
    if (!this._init()) return;
    const t = this.ctx.currentTime, out = this._out(sp, 0.14, 0.05, 0.6);
    this._noise(out, t, { f: 900, q: 1.5, a: 0.06, peak: 0.8, d: 0.12, f1: 3200 });
  }
  stone(sp) {
    if (!this._init()) return;
    const t = this.ctx.currentTime, out = this._out(sp, 0.35, 0.2, 1);
    this._noise(out, t, { f: 2600, q: 3, peak: 1, d: 0.04 });
    this._tone(out, t, { type: 'triangle', f: rnd(1700, 2200), f1: 900, peak: 0.4, d: 0.05 });
    for (let i = 1; i <= 3; i++) this._noise(out, t + 0.07 * i + rnd(0, 0.03), { f: rnd(1800, 3000), q: 3, peak: 0.5 / i, d: 0.025 });   // it bounces and rolls
  }
  ko(sp) {
    if (!this._init()) return;
    const t = this.ctx.currentTime, out = this._out(sp, 0.6, 0.12, 1.2);
    this._tone(out, t, { f: 120, f1: 42, peak: 1, d: 0.22 });
    this._noise(out, t, { buf: this.pink, type: 'lowpass', f: 700, peak: 0.8, d: 0.18 });
    this._noise(out, t + 0.32, { buf: this.pink, type: 'lowpass', f: 420, a: 0.02, peak: 0.6, d: 0.28 });   // the body falls
    this._tone(out, t + 0.33, { f: 80, f1: 40, peak: 0.5, d: 0.2 });
    this._tone(out, t + 0.36, { f: 3100, peak: 0.12, d: 0.08 });   // the musket on the stones
  }
  lock() {
    if (!this._init()) return;
    const t = this.ctx.currentTime, out = this._out(null, 0.12, 0.05, 0.6);
    for (let i = 0, n = 2 + (Math.random() < 0.4 ? 1 : 0); i < n; i++) {
      const tt = t + i * rnd(0.05, 0.11), f = rnd(3800, 5600);
      this._tone(out, tt, { type: 'triangle', f, f1: f * 0.8, peak: 0.8, d: 0.02 });
      this._noise(out, tt, { type: 'highpass', f: 5000, peak: 0.3, d: 0.012 });
    }
  }
  alarm(strikes = 7) {
    if (!this._init()) return;
    const t0 = this.ctx.currentTime, out = this._out({ gain: 1, pan: 0.35 }, 0.17, 0.6, strikes * 0.45 + 3);
    const P = [[0.5, 0.45, 2.4], [1, 1, 1.8], [1.18, 0.5, 1.4], [1.5, 0.35, 1.0], [2, 0.3, 0.8], [2.74, 0.2, 0.5]];
    for (let s = 0; s < strikes; s++) {
      const t = t0 + s * 0.44 + rnd(0, 0.03), base = 690 * rnd(0.995, 1.005);
      for (const [r, a, d] of P) this._tone(out, t, { f: base * r, peak: a * (s ? 0.85 : 1), d });
    }
  }
  dog(sp) {
    if (!this._init()) return;
    const t0 = this.ctx.currentTime, out = this._out(sp, 0.08, 0.6, 3), n = 1 + Math.floor(Math.random() * 3);
    const lp = this._filter('lowpass', 1400, 0.7); lp.connect(out);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * rnd(0.32, 0.5), f = rnd(320, 460);
      this._tone(lp, t, { type: 'sawtooth', f, f1: f * 0.55, a: 0.01, peak: 0.6, d: 0.14 });
      this._noise(lp, t, { f: 900, q: 2, peak: 0.4, a: 0.01, d: 0.1 });
    }
  }
  _cricket(pan) {
    const t0 = this.ctx.currentTime, out = this._out({ gain: 1, pan }, 0.018, 0.2, 1), f = rnd(4200, 4900);
    for (let k = 0, n = 2 + Math.floor(Math.random() * 3); k < n; k++)
      for (let i = 0; i < 3; i++) this._tone(out, t0 + k * 0.32 + i * 0.035, { f, peak: 1, a: 0.004, d: 0.02 });
  }
  update(dt, { surf = 0, tavern = 0 } = {}) {
    if (!this.night || !this._init()) return;
    const t = this.ctx.currentTime, now = performance.now() / 1000, n = this._next;
    for (const k in n) n[k] -= dt;
    this.surfG.gain.setTargetAtTime(0.05 + surf * (0.22 + 0.1 * Math.sin(now * 0.7)), t, 0.4);
    this.tavG.gain.setTargetAtTime(tavern * 0.5, t, 0.5);
    for (const c of this.tav) { const w = 0.5 + 0.5 * Math.sin(now * (1.4 + c.f / 2000) + c.ph) * Math.sin(now * 0.41 + c.ph); c.g.gain.setTargetAtTime(c.v * (0.4 + w * 0.6), t, 0.15); }
    if (n.cricket <= 0) { n.cricket = rnd(0.25, 1.1); this._cricket(rnd(-0.9, 0.9)); }
    if (n.dog <= 0) { n.dog = rnd(12, 26); this.dog({ gain: 1, pan: rnd(-0.8, 0.8) }); }
    if (tavern > 0.08 && n.laugh <= 0) { n.laugh = rnd(3, 9); this.voice('ha ha ha ha', { gain: tavern * 0.6, pan: rnd(-0.3, 0.3) }, { pitch: rnd(0.9, 1.4) }); }
    if (tavern > 0.08 && n.clink <= 0) { n.clink = rnd(1, 3.5); const o = this._out({ gain: tavern, pan: rnd(-0.3, 0.3) }, 0.05, 0.3, 0.5); this._tone(o, t, { f: rnd(2800, 4200), peak: 1, d: 0.08 }); }
  }

  // ---------------------------------------------------------------- the land battle
  volley(sp, shots = 8) {
    if (!this._init()) return;
    const t0 = this.ctx.currentTime, n = Math.max(2, Math.min(14, shots)), out = this._out(sp, 0.5 / Math.sqrt(n) * 1.6, 0.35, 3);
    for (let i = 0; i < n; i++) {
      const t = t0 + Math.pow(Math.random(), 1.6) * 0.45;
      this._noise(out, t, { type: 'highpass', f: rnd(700, 1200), peak: 1, a: 0.001, d: rnd(0.05, 0.1) });   // crack
      this._tone(out, t, { f: rnd(90, 120), f1: 40, peak: 0.6, d: 0.16 });                                // thump
    }
    this._noise(out, t0 + 0.05, { buf: this.pink, type: 'lowpass', f: 380, a: 0.04, peak: 0.6, d: 1.4 });   // rolling echo
  }
  melee(sp) {
    if (!this._init()) return;
    const t0 = this.ctx.currentTime, out = this._out(sp, 0.25, 0.2, 2);
    for (let i = 0, n = 3 + Math.floor(Math.random() * 4); i < n; i++) {
      const t = t0 + rnd(0, 0.7), f = rnd(850, 1500);
      for (const [r, a, d] of [[1, 1, 0.25], [2.76, 0.5, 0.15], [5.4, 0.25, 0.08]]) this._tone(out, t, { f: f * r, peak: a, d });
      this._noise(out, t, { f: 3000, q: 1, peak: 0.4, d: 0.03 });
    }
    this._noise(out, t0, { buf: this.pink, type: 'lowpass', f: 600, a: 0.1, peak: 0.5, d: 0.7 });   // feet and bodies
    if (Math.random() < 0.6) this.voice('Ha!', sp, { pitch: rnd(0.8, 1.2), urgent: true });
  }
  horn(kind = 'rout') {
    if (!this._init()) return;
    const ctx = this.ctx, t0 = ctx.currentTime, out = this._out({ gain: 1, pan: 0 }, 0.16, 0.5, 5);
    const notes = kind === 'hold' ? [[392, 0.28], [523, 0.28], [659, 0.28], [784, 1.1]] : [[392, 0.5], [392, 0.25], [523, 1.2]];
    let t = t0;
    for (const [f, d] of notes) {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = this._filter('lowpass', 500, 1.5), g = ctx.createGain();
      o.type = 'sawtooth'; o2.type = 'square'; o.frequency.value = f; o2.frequency.value = f * 1.003;
      lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(2400, t + 0.08); lp.frequency.setTargetAtTime(1400, t + 0.1, d * 0.4);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.05); g.gain.setTargetAtTime(0.5, t + 0.06, 0.1); g.gain.setTargetAtTime(0.0001, t + d * 0.9, 0.06);
      const g2 = ctx.createGain(); g2.gain.value = 0.35;
      o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(out);
      o.start(t); o2.start(t); o.stop(t + d + 0.4); o2.stop(t + d + 0.4);
      t += d + 0.04;
    }
    this.drum(kind === 'hold' ? 6 : 3);
  }
  drum(beats = 4) {
    if (!this._init()) return;
    const t0 = this.ctx.currentTime, out = this._out({ gain: 1, pan: -0.2 }, 0.4, 0.3, beats * 0.3 + 1);
    for (let i = 0; i < beats; i++) {
      const t = t0 + i * (i < beats - 1 ? 0.16 : 0.2), acc = i === beats - 1 ? 1 : 0.6;
      this._tone(out, t, { f: 110, f1: 60, peak: acc, d: 0.2 });
      this._noise(out, t, { f: 1800, q: 0.8, peak: acc * 0.5, d: 0.08 });   // the snares
    }
  }

  dispose() {
    for (const s of this.nodes) { try { s.stop(); s.disconnect(); } catch { /* already stopped */ } }
    this.nodes.length = 0;
    try { this.bus?.disconnect(); this.wet?.disconnect(); } catch { /* already gone */ }
    this.white = this.pink = this.bus = this.wet = this.tav = null; this.ok = false; this.audio = null;
  }
}
