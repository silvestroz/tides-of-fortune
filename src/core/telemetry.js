// Usage statistics, all through Vercel Web Analytics. Rules, paths and settings: src/data/telemetry.js.
// API:
//   telemetryMode({ params, nav, prod, settings }) -> 'off' | 'debug' | 'send'   (pure, tested in node)
//   frameStats(hist) -> { n, p50, p95, fps50, fps5, slow, hitch }   histogram of frame durations (whole ms, 0–200)
//   startTelemetry() -> Telemetry, one per page (window.__telemetry), created by main.js BEFORE the game (Vercel
//                       script, errors, failed loading)
//   tel.attach(game)  listens to game.events, measures frames at sea; tel.ready(game) loading done; tel.fail(err)
//   tel.mark(path)    one virtual page /jeu/…, once per session, at most maxMarks (nothing when off)
import { TELEMETRY as T, PATHS as P, loadBucket, fpsBucket } from '../data/telemetry.js';
import { ensureSettings } from '../ui/settings.js';

const ENV = import.meta.env || {};
const QUALITY_SLUG = { low: 'bas', medium: 'moyen', high: 'eleve', ultra: 'ultra' };

export function telemetryMode({ params, nav = {}, prod = false, settings = {} } = {}) {
  const q = params?.get?.('telemetry');
  if (settings.stats === false) return 'off';   // the player's choice wins, even in debug
  if (q === 'debug') return 'debug';
  if (q === '0' || q === 'off') return 'off';
  if (nav.webdriver) return 'off';
  if (params?.has?.('shot')) return 'off';
  if (nav.doNotTrack === '1' || nav.globalPrivacyControl === true) return 'off';
  return prod ? 'send' : 'off';
}

export function frameStats(hist) {
  let n = 0; for (let i = 0; i < hist.length; i++) n += hist[i];
  if (!n) return { n: 0 };
  const at = f => { let c = 0; for (let i = 0; i < hist.length; i++) { c += hist[i]; if (c >= f * n) return i; } return hist.length - 1; };
  let slow = 0, hitch = 0;
  for (let i = 0; i < hist.length; i++) { if (i >= T.slowMs) slow += hist[i]; if (i >= T.hitchMs) hitch += hist[i]; }
  const p50 = at(0.5), p95 = at(0.95);
  return { n, p50, p95, fps50: Math.round(1000 / Math.max(1, p50)), fps5: Math.round(1000 / Math.max(1, p95)), slow, hitch };
}

export class Telemetry {
  constructor() {
    this.params = new URLSearchParams(location.search);
    this.host = location.hostname;
    this.game = null; this.log = []; this.marks = new Set();
    this.hist = new Uint32Array(201); this._sea = 0; this._vis = 0; this._step = undefined;
    this.mode = this._mode();
    window.__telemetry = this;
    this._vercel();
    if (this.on) this._hookErrors();
    addEventListener('error', () => this.mark(P.error));
    addEventListener('unhandledrejection', () => this.mark(P.error));
    setInterval(() => this._tick(), 1000);
  }

  // debug (local log) or send (production on a Vercel host)
  get on() { return this.mode === 'debug' || (this.mode === 'send' && T.vercel && T.vercelHost.test(this.host)); }

  _mode() {
    return telemetryMode({ params: this.params, nav: navigator, prod: !!ENV.PROD, settings: this.game?.settings || ensureSettings({}) });
  }

  // Vercel's script, served by the deployment, cookie-free; beforeSend drops everything if the player opts out midway
  _vercel() {
    if (this._va || this.mode !== 'send' || !this.on) return;
    this._va = true;
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    window.va('beforeSend', ev => (this.mode === 'send' ? ev : null));
    const s = document.createElement('script');
    s.defer = true; s.src = T.vercelScript; s.dataset.sdkn = '@vercel/analytics';
    document.head.appendChild(s);
  }

  mark(path) {
    if (!this.on || !path || this.marks.has(path) || this.marks.size >= T.maxMarks) return;
    this.marks.add(path);
    if (this.mode === 'debug') { this.log.push(path); if (this.log.length > T.logMax) this.log.shift(); return; }
    try { window.va?.('pageview', { route: path, path }); } catch { /* never blocking */ }
  }

  attach(game) {
    this.game = game;
    this.mode = this._mode();
    const on = (n, f) => game.events.on(n, d => { if (!this.on) return; try { f(d || {}); } catch { /* never blocking */ } });
    game.events.on('settings:change', ({ patch } = {}) => { if (patch && 'stats' in patch) this.setEnabled(patch.stats !== false); });
    on('game:new', () => { this._step = 'new'; this.mark(P.newGame); this.mark(P.mode(game.state?.assist ? 'assistance' : 'classique')); });
    on('game:loaded', () => { this._step = undefined; this.mark(P.resumed); });
    on('career:mission', ({ status }) => { if (status === 'failed') this.mark(P.missionFailed); });
    on('career:promote', () => this.mark(P.promote));
    on('boarding:end', ({ result }) => { if (result === 'captured') this.mark(P.capture); });
    on('duel:end', ({ result: r }) => { if (r?.winner) this.mark(P.duel(r.winner === 'player' ? 'gagne' : 'perdu')); });
    on('player:shipwrecked', () => this.mark(P.defeat('naufrage')));
    on('player:captured', ({ kind }) => this.mark(P.defeat(kind === 'marooned' ? 'abandon' : 'prison')));
    on('career:retire', () => this.mark(P.retire));
    this._vercel();
    if (this.on) { this._hookErrors(); this._sampler(); }
  }

  ready() { this.mark(P.loaded(loadBucket(performance.now() / 1000))); }
  fail() { this.mark(P.bootFail); }

  // Options → “Statistics”: off = nothing is counted any more (beforeSend also filters whatever is still queued)
  setEnabled(v) {
    this.mode = this._mode();
    if (!v || this.mode === 'off') { this.hist.fill(0); return; }
    this._vercel();
    if (this.on) { this._hookErrors(); this._sampler(); }
  }

  // frame durations at sea (tab visible): histogram in whole ms, read once for the smoothness mark
  _sampler() {
    if (this._sampling || !this.game) return;
    this._sampling = true;
    let last = 0;
    const f = now => {
      if (!this.on) { this._sampling = false; return; }
      if (last && this.game.mode === 'sail' && document.visibilityState === 'visible') { const ms = now - last; if (ms < 1000) this.hist[Math.min(200, Math.round(ms))]++; }
      last = now; requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }

  _tick() {
    if (!this.on || document.visibilityState !== 'visible') return;
    const g = this.game;
    this._vis++;
    for (const m of T.sessionMin) if (this._vis === m * 60) this.mark(P.session(m));
    if (g?.mode === 'sail' && ++this._sea === T.fluidityS) {
      const s = frameStats(this.hist);
      if (s.n) this.mark(P.fluidity(QUALITY_SLUG[g.quality] || 'eleve', fpsBucket(s.fps50)));
    }
    const step = g?.state?.tutorials?.goals?.step;
    if (step && step !== this._step) {
      if (this._step !== undefined) {
        const p = P.step[step];
        this.mark(typeof p === 'object' ? (p[this._step] || p.other) : p);
      }
      this._step = step;
    }
  }

  // caught errors (event handlers, failures): a single “erreur” page per session
  _hookErrors() {
    if (this._hooked) return;
    this._hooked = true;
    const ce = console.error.bind(console);
    console.error = (...a) => { try { this.mark(P.error); } catch { /* rien */ } ce(...a); };
  }
}

export function startTelemetry() {
  try { return window.__telemetry || new Telemetry(); }
  catch { return { attach() {}, ready() {}, fail() {}, mark() {}, setEnabled() {} }; }
}
