// Procedural, original music director. Every melody is generated at runtime from a seeded random walk on the theme's
// mode (no tune is transcribed from any game or song). Themes crossfade on their own bus.
//   themes: title · sea (calm, wind) · battle (tension, percussion) · duel (rhythmic) · boss (famous pirate) ·
//           storm · port (tavern, one variant per nation: english/spanish/french/dutch/pirate; fishing villages: village)
//   stingers (short jingles): victory · defeat · fanfare (famous pirate defeated)
// API: new Music(audio) ; start() ; setTheme(name, variant?) ; update(dt, intensity 0..1) ; stinger(name) ;
//      flourish() ; stats() -> { theme, variant, voices, buses }
// Node hygiene: one-shot voices stop themselves (onended decrements `voices`); Karplus-Strong feedback loops are
// disconnected by timer; a theme's pads are stopped and its bus disconnected after its fade-out. All gains ≤ 1.
import { mulberry32 } from '../core/rng.js';

const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11],
  phrygDom: [0, 1, 4, 5, 7, 8, 10],
};
const NOTE = n => 440 * Math.pow(2, (n - 69) / 12);   // midi -> Hz

// Theme table. root = midi of the tonic (bass register), steps = steps per bar, bpm = steps-per-minute / 2.
const THEMES = {
  title:  { mode: 'dorian', root: 50, bpm: 76, steps: 8, seed: 11, chords: [0, 5, 3, 4], lead: 'pluck', pad: 0.03, density: 0.55 },
  sea:    { mode: 'dorian', root: 50, bpm: 84, steps: 8, seed: 23, chords: [0, 3, 6, 4, 0, 5, 3, 4], lead: 'pluck', pad: 0.032, density: 0.6 },
  battle: { mode: 'harmonic', root: 40, bpm: 132, steps: 8, seed: 37, chords: [0, 0, 5, 4], lead: 'brass', pad: 0.026, density: 0.85 },
  duel:   { mode: 'aeolian', root: 45, bpm: 152, steps: 8, seed: 41, chords: [0, 5, 6, 4], lead: 'pluck', pad: 0, density: 0.95 },
  boss:   { mode: 'phrygian', root: 36, bpm: 100, steps: 8, seed: 53, chords: [0, 1, 0, 6], lead: 'brass', pad: 0.04, density: 0.6 },
  storm:  { mode: 'aeolian', root: 35, bpm: 66, steps: 8, seed: 61, chords: [0, 5, 1, 4], lead: 'flute', pad: 0.045, density: 0.35 },
  port:   { mode: 'ionian', root: 43, bpm: 116, steps: 6, seed: 71, chords: [0, 3, 4, 0], lead: 'pluck', pad: 0, density: 0.9 },
  sneak:  { mode: 'phrygian', root: 38, bpm: 84, steps: 8, seed: 97, chords: [0, 1, 0, 6], lead: 'pluck', pad: 0.022, density: 0.45 },   // infiltration
};
// Port variants: instrumentation + mode per nation (tavern jig in 6/8).
const PORT_VARIANTS = {
  english: { mode: 'ionian', root: 43, lead: 'fiddle', second: 'concertina', perc: 'stomp', seed: 71 },
  spanish: { mode: 'phrygDom', root: 40, lead: 'pluck', second: 'pluck', perc: 'castanet', seed: 73 },
  french:  { mode: 'mixolydian', root: 41, lead: 'flute', second: 'concertina', perc: 'tambour', seed: 79 },
  dutch:   { mode: 'ionian', root: 48, lead: 'concertina', second: 'bell', perc: 'stomp', seed: 83 },
  pirate:  { mode: 'dorian', root: 38, lead: 'fiddle', second: 'pluck', perc: 'stomp', seed: 89, bpm: 124 },
  village: { mode: 'mixolydian', root: 45, lead: 'flute', second: 'pluck', perc: 'tambour', seed: 101, bpm: 96 },   // fishing villages: slow tune, flute and plucked strings
};

// Original motif generator: 4 bars of melody (scale degrees, null = rest) from a seeded walk, phrase form A A' B A''.
function makeMelody(seed, steps, density) {
  const r = mulberry32(seed);
  const bar = (start, end) => {
    const out = []; let d = start;
    for (let i = 0; i < steps; i++) {
      if (i > 0 && r() > density && i !== steps - 1) { out.push(null); continue; }
      if (i === steps - 1) d = end;
      else { const j = r(); d += j < 0.35 ? 1 : j < 0.7 ? -1 : j < 0.82 ? 2 : j < 0.94 ? -2 : (r() < 0.5 ? 4 : -3); }
      d = Math.max(-2, Math.min(9, d)); out.push(d);
    }
    return out;
  };
  const A = bar(4, 2), B = bar(7, 4), C = bar(2, 0);
  const A2 = A.map((d, i) => (i >= steps - 2 ? (i === steps - 1 ? 4 : d) : d));
  return [A, A2, B, C];
}

export class Music {
  constructor(audio) {
    this.a = audio; this.ctx = audio.ctx;
    this.out = this.ctx.createGain(); this.out.gain.value = 0.9; this.out.connect(audio.musicBus);
    const w = this.ctx.createGain(); w.gain.value = 0.35; this.out.connect(w); w.connect(audio.musicVerbIn);
    this.stingBus = this.ctx.createGain(); this.stingBus.gain.value = 0.85; this.stingBus.connect(this.out);
    this.voices = 0; this.intensity = 0; this.cur = null; this._fading = 0; this._duckUntil = 0;
    this._started = false; this.nextT = 0;
  }

  // ---------------- public ----------------
  start() { this._started = true; this.nextT = this.ctx.currentTime + 0.3; if (!this.cur) this.setTheme('sea'); }
  stats() { return { theme: this.cur?.name, variant: this.cur?.variant, voices: this.voices, buses: 1 + this._fading }; }

  setTheme(name, variant = null) {
    if (!THEMES[name]) name = 'sea';
    if (name === 'port' && !PORT_VARIANTS[variant]) variant = 'english';
    if (name !== 'port') variant = null;
    if (this.cur && this.cur.name === name && this.cur.variant === variant) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const fade = name === 'battle' || name === 'duel' || name === 'boss' || name === 'storm' ? 1.2 : 2.5;
    if (this.cur) this._retire(this.cur, fade);
    const base = THEMES[name], v = variant ? PORT_VARIANTS[variant] : {};
    const th = { ...base, ...v, name, variant };
    const bus = ctx.createGain(); bus.gain.setValueAtTime(0.0001, t); bus.gain.setTargetAtTime(1, t + fade * 0.25, fade / 3);
    bus.connect(this.out);
    th.bus = bus; th.pads = []; th.scale = MODES[th.mode];
    th.mel = makeMelody(th.seed, th.steps, th.density);
    th.bar = 0; th.step = 0;
    this.cur = th;
    if (th.pad > 0) this._pad(th);
    if (this.nextT < t) this.nextT = t + 0.1;
  }


  stinger(kind) {
    const ctx = this.ctx, t = ctx.currentTime + 0.05;
    this._duckUntil = t + 3.2;
    if (this.cur) { const g = this.cur.bus.gain; g.cancelScheduledValues(t); g.setTargetAtTime(0.22, t, 0.08); g.setTargetAtTime(1, t + 3, 0.6); }
    const to = this.stingBus;
    if (kind === 'victory' || kind === 'fanfare') {
      // rising major arpeggio + held tonic chord (brass + plucks), bigger for a famous pirate
      const root = 55, seq = kind === 'fanfare' ? [0, 4, 7, 12, 7, 12, 16] : [0, 4, 7, 12];
      seq.forEach((s, i) => this._brass(t + i * 0.13, NOTE(root + s), 0.12, 0.22, to));
      const end = t + seq.length * 0.13;
      for (const s of [0, 4, 7]) this._brass(end, NOTE(root + s), 0.08, 1.6, to);
      this._drum(end, 0.5, 60, to); this._drum(t, 0.3, 70, to);
      if (kind === 'fanfare') for (let i = 0; i < 6; i++) this._snare(end - 0.4 + i * 0.06, 0.12, to);
    } else if (kind === 'defeat') {
      // falling minor line, low drone, single muffled drum
      [7, 5, 3, 2, 0].forEach((s, i) => this._flute(t + i * 0.32, NOTE(57 + s), 0.11, 0.5, to));
      this._brass(t + 1.5, NOTE(45), 0.09, 2.2, to); this._brass(t + 1.5, NOTE(48), 0.06, 2.2, to);
      this._drum(t + 1.5, 0.45, 48, to);
    }
  }

  flourish() {
    const t = this.ctx.currentTime + 0.05;
    [0, 4, 7, 12].forEach((s, i) => this._pluck(t + i * 0.09, NOTE(62 + s), 0.2, 1.2, 0.993, this.stingBus));
  }

  // ahead = scheduling horizon in s (0.3 in the game loop; longer from the background-tab timer, see Audio.start)
  update(dt, intensity, ahead = 0.3) {
    if (!this._started || !this.cur) return;
    this.intensity = intensity;
    const ctx = this.ctx, look = ctx.currentTime + ahead;
    if (this.nextT < ctx.currentTime - 1) this.nextT = ctx.currentTime + 0.05;
    while (this.nextT < look) {
      const th = this.cur, spb = 60 / (th.bpm + (th.name === 'battle' ? intensity * 14 : th.name === 'sneak' ? (this.sneakLevel || 0) * 11 : 0)) / 2;
      this._tick(th, this.nextT, spb);
      this.nextT += spb;
    }
  }

  // ---------------- sequencing ----------------
  _deg(th, deg, oct = 0) {
    const s = th.scale, o = Math.floor(deg / 7), d = ((deg % 7) + 7) % 7;
    return NOTE(th.root + 12 * (o + oct) + s[d]);
  }

  _tick(th, t, spb) {
    const st = th.step, bar = th.bar, n = th.steps, chord = th.chords[bar % th.chords.length];
    const mel = th.mel[bar % th.mel.length], deg = mel[st], B = th.bus, c = this.intensity;
    const R = Math.random;
    switch (th.name) {
      case 'title':
      case 'sea': {
        if (deg != null && R() < 0.8) this._pluck(t, this._deg(th, deg, 2), 0.13, spb * 3, 0.993, B);
        if (st === 0) this._pluck(t, this._deg(th, chord, 0), 0.17, spb * 6, 0.996, B);
        if (st === 4) this._pluck(t, this._deg(th, chord + 4, 0), 0.08, spb * 3, 0.994, B);
        if (st === 2 || st === 6) this._pluck(t, this._deg(th, chord + 2, 1), 0.05, spb * 2, 0.993, B);
        if (st === 0 && th.name === 'sea') this._drum(t, 0.1, 68, B);
        if (th.name === 'sea' && bar % 8 >= 4 && deg != null && st % 2 === 0) this._flute(t, this._deg(th, deg + 2, 2), 0.035, spb * 1.6, B);
        break;
      }
      case 'battle': {
        // driving low ostinato, brass calls, toms and snare that thicken with intensity
        this._pluck(t, this._deg(th, chord + (st % 4 === 3 ? 4 : 0), 0), 0.12, spb * 1.2, 0.99, B);
        if (deg != null && (st % 2 === 0 || c > 0.6)) this._brass(t, this._deg(th, deg, 2), 0.075, spb * 1.7, B);
        if (st === 0 || st === 3 || st === 6) this._drum(t, 0.38 + c * 0.25, 62, B);
        if (st === 4) this._drum(t, 0.3, 90, B);
        if (st % 2 === 1 && c > 0.3) this._snare(t, 0.06 + c * 0.07, B);
        if (st === 7 && bar % 4 === 3) for (let i = 0; i < 4; i++) this._snare(t + i * spb / 4, 0.05 + i * 0.02, B);
        break;
      }
      case 'duel': {
        // fast plucked 8ths, stabs on off-beats, clap on 2 and 4
        const arp = [0, 2, 4, 2, 7, 4, 2, 4][st];
        this._pluck(t, this._deg(th, chord + arp, 1), 0.1, spb * 1.4, 0.991, B);
        if (deg != null && st % 2 === 0) this._pluck(t, this._deg(th, deg, 2), 0.12, spb * 2, 0.994, B);
        if (st === 0 || st === 5) this._drum(t, 0.4, 72, B);
        if (st === 2 || st === 6) this._snare(t, 0.12, B);
        if (st % 2 === 1) this._click(t, 0.05, 5200, B);
        if (st === 1 || st === 5) this._brass(t, this._deg(th, chord + 4, 1), 0.05, spb * 0.8, B);
        break;
      }
      case 'boss': {
        // slow, heavy: tolling low brass, menacing semitone, war drums
        if (st === 0) { this._brass(t, this._deg(th, chord, 0), 0.11, spb * 7, B); this._brass(t, this._deg(th, chord + 4, 0), 0.06, spb * 7, B); }
        if (st === 0 || st === 2 || st === 3 || st === 6) this._drum(t, st === 0 ? 0.65 : 0.4, st === 0 ? 46 : 58, B);
        if (deg != null && st % 2 === 0 && bar % 4 !== 0) this._brass(t, this._deg(th, deg, 2), 0.06, spb * 1.8, B);
        if (st === 4) this._bell(t, this._deg(th, chord + 1, 3), 0.05, B);
        if (st % 2 === 1 && c > 0.4) this._snare(t, 0.06, B);
        break;
      }
      case 'storm': {
        // sparse wind-flute over a tremolo pad, distant timpani rolls, no clear beat
        if (deg != null && st % 2 === 0 && R() < 0.55) this._flute(t, this._deg(th, deg, 2), 0.07, spb * 3.5, B);
        if (st === 0 && bar % 2 === 0) for (let i = 0; i < 8; i++) this._drum(t + i * 0.06, 0.06 + i * 0.025, 44, B);
        if (st === 4 && R() < 0.4) this._pluck(t, this._deg(th, chord + 1, 1), 0.07, spb * 4, 0.996, B);
        break;
      }
      case 'sneak': {
        // sneaking: low pizzicato pulse (0), ticking (1), timpani and a flute semitone (2), snare and brass (3),
        // alarm: bell, bass drum on every step, roll at the end of the bar (4)
        const L = this.sneakLevel || 0;
        if (st === 0 || (L >= 1 && st === 4)) this._pluck(t, this._deg(th, chord, 0), 0.12, spb * 2.2, 0.99, B);
        if (deg != null && R() < 0.3 + L * 0.12) this._pluck(t, this._deg(th, deg, 2), 0.045 + L * 0.012, spb * 1.5, 0.992, B);
        if (L >= 1 && st % 2 === 1) this._click(t, 0.02 + L * 0.008, 3200, B);
        if (L >= 2 && (st === 0 || st === 3 || st === 6)) this._drum(t, 0.16 + L * 0.06, 56, B);
        if (L >= 2 && st === 4 && bar % 2 === 0) this._flute(t, this._deg(th, chord + 1, 2), 0.03, spb * 3, B);
        if (L >= 3 && st % 2 === 1) this._snare(t, 0.04 + (L - 3) * 0.03, B);
        if (L >= 3 && deg != null && st % 2 === 0) this._brass(t, this._deg(th, deg, 1), 0.045, spb * 1.4, B);
        if (L >= 4) {
          if (st % 4 === 0) this._bell(t, this._deg(th, chord + (st ? 1 : 0), 3), 0.06, B);
          this._drum(t, 0.3, 64, B);
          if (st === 7) for (let i = 0; i < 4; i++) this._snare(t + i * spb / 4, 0.05 + i * 0.02, B);
        }
        break;
      }
      case 'port': {
        // tavern jig in 6/8: bass on 1 and 4, chord "oom-pa", lead line, second voice in thirds, nation percussion
        if (st === 0 || st === 3) this._pluck(t, this._deg(th, chord + (st ? 4 : 0), 0), 0.15, spb * 2.5, 0.995, B);
        if (st === 1 || st === 2 || st === 4 || st === 5) this._voice(th.second, t, this._deg(th, chord + 2, 1), 0.04, spb * 0.8, B);
        if (deg != null) this._voice(th.lead, t, this._deg(th, deg, 2), 0.09, spb * 1.3, B);
        if (deg != null && bar % 4 === 2) this._voice(th.second, t, this._deg(th, deg - 2, 2), 0.045, spb * 1.2, B);
        if (th.perc === 'stomp') { if (st === 0 || st === 3) this._drum(t, 0.3, 55, B); if (st === 2 || st === 5) this._click(t, 0.05, 2400, B); }
        else if (th.perc === 'castanet') { if (st !== 0) this._click(t, 0.06, 3800, B); if (st === 0) this._drum(t, 0.25, 80, B); if (st === 5 && bar % 2) this._click(t + spb / 2, 0.05, 3800, B); }
        else { if (st === 0) this._drum(t, 0.25, 90, B); if (st % 2 === 1) this._snare(t, 0.035, B); }
        break;
      }
    }
    if (++th.step >= n) { th.step = 0; th.bar++; }
  }

  _voice(kind, t, f, vol, dur, to) {
    if (kind === 'fiddle') this._fiddle(t, f, vol, dur, to);
    else if (kind === 'flute') this._flute(t, f, vol, dur, to);
    else if (kind === 'concertina') this._reed(t, f, vol, dur, to);
    else if (kind === 'bell') this._bell(t, f, vol, to);
    else this._pluck(t, f, vol * 1.2, dur * 2, 0.993, to);
  }

  // ---------------- voices ----------------
  _track(src, stopAt, ...extra) {
    this.voices++;
    src.onended = () => { this.voices--; try { src.disconnect(); for (const n of extra) n.disconnect(); } catch { /* already gone */ } };
    src.stop(stopAt);
  }

  _pluck(t, f, vol, dur, fb = 0.993, to = this.out) {
    // Karplus-Strong: noise burst into a tuned feedback delay
    const ctx = this.ctx;
    const n = ctx.createBufferSource(); n.buffer = this.a.noise.white;
    const exc = ctx.createGain(); exc.gain.setValueAtTime(1, t); exc.gain.setValueAtTime(0, t + 1 / f);
    const d = ctx.createDelay(0.05); d.delayTime.value = 1 / f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(6000, f * 7); lp.Q.value = -3;   // Q in dB < 0: loop gain stays < 1
    const fbG = ctx.createGain(); fbG.gain.value = fb;
    const g = ctx.createGain(); g.gain.setValueAtTime(Math.min(1, vol), t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.4);
    n.connect(exc); exc.connect(d); d.connect(lp); lp.connect(fbG); fbG.connect(d); lp.connect(g); g.connect(to);
    n.start(t, Math.random() * 2); n.stop(t + 0.05);
    this.voices++;
    setTimeout(() => { this.voices--; try { fbG.disconnect(); lp.disconnect(); d.disconnect(); g.disconnect(); exc.disconnect(); } catch { /* gone */ } },
      Math.max(0, (t - ctx.currentTime + dur + 0.6) * 1000));
  }

  _osc(type, t, f, vol, a, dur, to, { detune = 0, lpF = 0, vib = 0 } = {}) {
    const ctx = this.ctx, o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.min(1, vol), t + a); g.gain.setTargetAtTime(0.0001, t + Math.max(a, dur), dur * 0.25 + 0.05);
    let head = o; const extra = [g];
    if (lpF) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lpF; lp.Q.value = 0.5; o.connect(lp); head = lp; extra.push(lp); }
    head.connect(g); g.connect(to);
    o.start(t);
    let lfo = null;
    if (vib) {
      lfo = ctx.createOscillator(); lfo.frequency.value = 5.2; const lg = ctx.createGain(); lg.gain.value = f * vib;
      lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); extra.push(lg);
      lfo.stop(t + dur * 2 + 0.4); lfo.onended = () => { try { lfo.disconnect(); } catch { /* gone */ } };
    }
    this._track(o, t + dur * 2 + 0.4, ...extra);
  }
  _brass(t, f, vol, dur, to) { this._osc('sawtooth', t, f, vol, 0.04, dur, to, { lpF: Math.min(2400, f * 5) }); }
  _flute(t, f, vol, dur, to) { this._osc('sine', t, f, vol, 0.06, dur, to, { vib: 0.006 }); this._osc('triangle', t, f * 2, vol * 0.15, 0.06, dur, to); }
  _fiddle(t, f, vol, dur, to) { this._osc('sawtooth', t, f, vol * 0.8, 0.03, dur, to, { lpF: 3200, vib: 0.004 }); }
  _reed(t, f, vol, dur, to) { this._osc('square', t, f, vol * 0.5, 0.02, dur, to, { lpF: 1800, detune: -7 }); this._osc('square', t, f, vol * 0.5, 0.02, dur, to, { lpF: 1800, detune: 7 }); }
  _bell(t, f, vol, to) { this._osc('sine', t, f, vol, 0.003, 0.25, to); this._osc('sine', t, f * 2.76, vol * 0.3, 0.003, 0.12, to); }

  _drum(t, vol, f0, to = this.out) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f0 * 1.6, t); o.frequency.exponentialRampToValueAtTime(f0, t + 0.08);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.min(1, vol), t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g); g.connect(to); o.start(t); this._track(o, t + 0.5, g);
  }
  _snare(t, vol, to = this.out) {
    const ctx = this.ctx, n = ctx.createBufferSource(); n.buffer = this.a.noise.white;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(Math.min(1, vol), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    n.connect(f); f.connect(g); g.connect(to); n.start(t, Math.random() * 3); this._track(n, t + 0.15, f, g);
  }
  _click(t, vol, freq, to = this.out) {
    const ctx = this.ctx, n = ctx.createBufferSource(); n.buffer = this.a.noise.white;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 4;
    const g = ctx.createGain(); g.gain.setValueAtTime(Math.min(1, vol), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    n.connect(f); f.connect(g); g.connect(to); n.start(t, Math.random() * 3); this._track(n, t + 0.05, f, g);
  }

  _pad(th) {
    // sustained low fifth (detuned saws), slow swell; storm gets a tremolo
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.value = th.pad;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = th.name === 'storm' ? 420 : 700; lp.Q.value = 0.7;
    const lfo = ctx.createOscillator(); lfo.frequency.value = th.name === 'storm' ? 4.5 : 0.07;
    const lg = ctx.createGain(); lg.gain.value = th.pad * 0.6;
    lfo.connect(lg); lg.connect(g.gain); lfo.start(t);
    const oscs = [lfo];
    const rootF = NOTE(th.root), fifth = rootF * Math.pow(2, th.scale[4] / 12);
    for (const [f, det] of [[rootF, -6], [rootF, 5], [fifth, 3]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(t); oscs.push(o);
    }
    lp.connect(g); g.connect(th.bus);
    th.pads.push({ oscs, nodes: [lg, lp, g] });
  }

  _retire(th, fade) {
    const t = this.ctx.currentTime;
    th.bus.gain.cancelScheduledValues(t); th.bus.gain.setTargetAtTime(0.0001, t, fade / 4);
    this._fading++;
    for (const p of th.pads) for (const o of p.oscs) o.stop(t + fade + 0.5);
    setTimeout(() => {
      this._fading--;
      try { for (const p of th.pads) { for (const o of p.oscs) o.disconnect(); for (const n of p.nodes) n.disconnect(); } th.bus.disconnect(); } catch { /* gone */ }
    }, (fade + 3) * 1000);
  }
}
