// Unified event messages: hierarchical toasts + central banner + journal (J).
// Every 'notify' goes through Toasts.push(text, kind, opts):
//   kind  'info' | 'good' | 'bad' | 'major'  ('warn' → 'bad'); opts.major = true or a text match (war, promotion,
//         Top 10 captain sighted/defeated, alliance, treaty…) promotes a message to the central banner.
//   opts.key  coalescing key: a new message with the same key replaces the visible one (hit reports, wind gauge);
//         identical texts are grouped (“×3”) instead of stacking.
//   opts.topic  icon override: 'wind' | 'weather' | 'diplomacy' | 'rumour' | 'gold' | 'combat' | 'crew' | 'shoal'
//               | 'lord' | 'rank' | 'treasure' (otherwise guessed from the text).
//   opts.logOnly  journal only, no toast (low-stakes news, echoes of what the HUD already shows)
//   opts.defer 'prologue'  held back while the guided prologue runs (notifyRules.inPrologue), shown a few seconds
//               after it ends (world news: wars, alliances, convoys)
// Queue: at most MAX visible toasts (2; MAX_FROZEN in ?frozen screenshots), the rest waits; lifetime by importance;
// an info still waiting after QUEUE_STALE ms is dropped from the screen (it stays in the journal).
// Toasts carry no ship's-bell line on screen (the journal keeps it); every toast is fully opaque (no fading stack).
// Banner: one at a time, under the goal line at the top (never over the ships); #hud gets .banner-on meanwhile so
// the F / B prompts step down below it.
// Journal: the last 60 messages with ship's-bell time and date, opened with J at sea (Esc / J close).
// API: new Toasts(game, hudEl) · push(text, kind, opts) · update(real) · journal.open()/close()/toggle()
import { isKey } from '../core/keys.js';
import { TOAST_ART } from './paintedIcons.js';
import { inPrologue } from '../game/notifyRules.js';

const MAX = 2, MAX_FROZEN = 2, LOG_N = 60, QUEUE_STALE = 6000, DEFER_AFTER = 4000;
const LIFE = { info: 3200, good: 4600, bad: 5600, major: 4200 };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- painted icons (paintedIcons.js): one per message topic ----
export const TOAST_ICONS = Object.fromEntries(Object.entries(TOAST_ART).map(([k, v]) => [k, `<svg viewBox="0 0 32 32" aria-hidden="true">${v}</svg>`]));
const TOPIC_RX = [
  ['lord', /black sail|lair|top 10|ledger|pirate captain|is defeated\b/i],
  ['rank', /promoted|\brank\b|promotion|grant of/i],
  ['diplomacy', /\bwar\b|peace|alliance|treaty|letter of marque|diplomat/i],
  ['treasure', /treasure|piece of a .*map/i],
  ['weather', /squall|storm|thunder|hurricane|breeze/i],
  ['wind', /windward|leeward|weather gauge/i],
  ['shoal', /shallows|shoal|aground|reef/i],
  ['rumour', /rumour|they say|tavern|announced|convoy/i],
  ['gold', /\bgold\b|bounty|plunder|ransom|shared out|share-out/i],
  ['crew', /\bm[ae]n\b|sailor|crew|mutin|desert|picked up/i],
  ['combat', /\bshots?\b|broadside|strikes? her colours|sinks|\bmast|dismasted|magazine|board|\bhits?\b/i],
];
const MAJOR_RX = /^war!|^alliance:|promoted to the rank|black sail|is defeated!|^peace signed|^mutiny!|^dismasted!|our ship is going down/i;

export class Toasts {
  constructor(game, hudEl) {
    this.game = game;
    const frozen = !!game.params?.get('frozen');
    this.keep = frozen && !game.params.get('logfade');   // frozen screenshots keep their toasts
    this.max = frozen ? MAX_FROZEN : MAX;
    this.hudEl = hudEl;
    this.stack = document.createElement('div'); this.stack.className = 'toasts';
    this.banner = document.createElement('div'); this.banner.className = 'banner off';
    hudEl.appendChild(this.stack); hudEl.appendChild(this.banner);
    this.live = [];          // { el, text, kind, key, n, t0, life }
    this.queue = [];
    this.bq = []; this._bT = 0; this._bOn = false;
    this.later = []; this._laterT = 0;   // deferred until the prologue ends (opts.defer)
    this.log = [];
    this.journal = new Journal(game, this);
  }

  _topic(text, kind, topic) {
    if (topic && TOAST_ICONS[topic]) return topic;
    for (const [t, rx] of TOPIC_RX) if (rx.test(text)) return t;
    return kind;
  }
  push(text, kind = 'info', opts = {}) {
    if (!text) return null;
    if (opts.defer === 'prologue' && inPrologue(this.game)) {
      if (!this.later.some(l => l.text === text)) this.later.push({ text, kind, opts: { ...opts, defer: null } });
      return null;
    }
    if (kind === 'warn') kind = 'bad';
    if (!LIFE[kind]) kind = 'info';
    const major = kind === 'major' || opts.major || MAJOR_RX.test(text);
    const tone = kind === 'major' ? (opts.tone || 'good') : kind;
    const topic = this._topic(text, tone, opts.topic);
    const g = this.game;
    this.log.unshift({ text, kind: major ? 'major' : kind, topic, bell: opts.bell || '', date: g.state?.date ? { ...g.state.date } : null });
    if (this.log.length > LOG_N) this.log.length = LOG_N;
    this.journal.dirty = true;
    if (opts.logOnly) return null;   // journal only: the screen already shows it (target card, gauges…) or it can wait
    if (major) { this._banner(text, tone, topic); return null; }
    // group duplicates / coalesce by key
    const same = this.live.find(t => (opts.key && t.key === opts.key) || t.text === text);
    if (same) {
      if (same.text === text) same.n++; else { same.n = 1; same.text = text; }
      same.kind = kind; same.t0 = performance.now(); same.life = LIFE[kind];
      this._paint(same, topic); same.el.classList.remove('bump'); void same.el.offsetWidth; same.el.classList.add('bump');
      return same.el;
    }
    const q = this.queue.find(t => (opts.key && t.key === opts.key) || t.text === text);
    if (q) { if (q.text === text) q.n++; else Object.assign(q, { text, kind, topic }); return null; }
    const item = { text, kind, topic, key: opts.key || null, n: 1, q0: performance.now() };
    // a bad message jumps ahead of queued infos; a toast fading out no longer takes a place
    if (this.live.filter(t => !t.out).length >= this.max) { if (kind === 'bad') this.queue.unshift(item); else this.queue.push(item); this._evictInfo(); return null; }
    return this._show(item);
  }
  // journal only (no toast): flying resource gains already animate on screen
  record(text, kind = 'good', topic = 'gold') {
    const g = this.game;
    this.log.unshift({ text, kind, topic, bell: '', date: g.state?.date ? { ...g.state.date } : null });
    if (this.log.length > LOG_N) this.log.length = LOG_N;
  }
  _evictInfo() {   // make room for a waiting important message by retiring the oldest info early
    const imp = this.queue.find(t => t.kind !== 'info'); if (!imp) return;
    const old = this.live.find(t => t.kind === 'info' && !t.out);
    if (old && !this.keep) old.t0 = performance.now() - old.life + 300;
  }
  _paint(t, topic) {
    t.el.className = `toast tof-parch ${t.kind}`;
    t.el.innerHTML = `<span class="mark">${TOAST_ICONS[topic] || TOAST_ICONS[t.kind]}</span><span class="txt">${esc(t.text)}</span>${t.n > 1 ? `<span class="cnt">×${t.n}</span>` : ''}`;
  }
  _show(item) {
    const el = document.createElement('div');
    const t = Object.assign(item, { el, t0: performance.now(), life: LIFE[item.kind] });
    this._paint(t, item.topic);
    this.stack.prepend(el);
    this.live.unshift(t);
    return el;
  }
  _banner(text, tone, topic) {
    if (this.bq.some(b => b.text === text) || (this._bOn && this._bText === text)) return;
    this.bq.push({ text, tone, topic });
  }
  update() {
    const now = performance.now();
    // toasts: age, fade, refill from the queue
    for (const t of this.live) {
      if (t.out || this.keep) continue;
      if (now - t.t0 > t.life) { t.out = true; t.el.classList.add('out'); setTimeout(() => t.el.remove(), 520); }
    }
    this.live = this.live.filter(t => !t.out || t.el.isConnected);
    if (!this.keep) this.queue = this.queue.filter(t => t.kind !== 'info' || now - t.q0 < QUEUE_STALE);
    const vis = this.live.filter(t => !t.out).length;
    if (vis < this.max && this.queue.length) this._show(this.queue.shift());
    // world news held back during the prologue: released a few seconds after it ends
    if (this.later.length) {
      if (inPrologue(this.game)) this._laterT = now + DEFER_AFTER;
      else if (now > this._laterT) for (const l of this.later.splice(0)) this.push(l.text, l.kind, l.opts);
    }
    // banner: one at a time
    if (this._bOn && !this.keep && now > this._bT) { this._bOn = false; this.banner.className = 'banner off'; this._bGap = now + 450; this.hudEl?.classList.remove('banner-on'); }
    if (!this._bOn && this.bq.length && now > (this._bGap || 0)) {
      const b = this.bq.shift();
      this._bOn = true; this._bText = b.text; this._bT = now + LIFE.major + Math.min(1800, b.text.length * 20);
      this.hudEl?.classList.add('banner-on');
      const [head, ...rest] = splitHead(b.text);
      this.banner.innerHTML = `<div class="b-inner tof-parch"><i class="b-orn l"></i><span class="b-ico">${TOAST_ICONS[b.topic] || TOAST_ICONS.major}</span>
        <div class="b-txt"><div class="b-head">${esc(head)}</div>${rest.length ? `<div class="b-sub">${esc(rest.join(' '))}</div>` : ''}</div><i class="b-orn r"></i></div>`;
      this.banner.className = `banner on ${b.tone}`;
      requestAnimationFrame(() => this.hudEl?.style.setProperty('--bh', `${this.banner.offsetHeight || 0}px`));   // the prompts step under it
      this.game.audio?.play?.('ui:page');
    }
  }
}
// “War! The English and…” → head “War!”, sub “The English and…”
function splitHead(text) {
  const m = text.match(/^(.{3,60}?[!:.])\s+(.+)$/);
  if (m && m[1].length <= 60) return [m[1].replace(/\s*:$/, ''), m[2]];
  return [text];
}

// ---- Ship's log (J) ----
class Journal {
  constructor(game, toasts) {
    this.game = game; this.toasts = toasts; this.isOpen = false; this.dirty = true;
    const el = this.el = document.createElement('div'); el.className = 'journal-layer';
    (game.uiRoot || document.body).appendChild(el);
    addEventListener('keydown', e => this._key(e), true);
    el.addEventListener('click', e => { if (e.target === el || e.target.closest?.('[data-j="close"]')) this.close(); });
  }
  _key(e) {
    const g = this.game;
    if (e.target?.tagName === 'INPUT' || g.hud?.menu?.isOpen || e.repeat) return;
    if (this.isOpen && (e.code === 'Escape' || isKey(e, 'j'))) { e.preventDefault(); e.stopImmediatePropagation(); this.close(); return; }
    if (!this.isOpen && isKey(e, 'j') && g.mode === 'sail' && g.player) { e.preventDefault(); this.open(); }
  }
  toggle() { this.isOpen ? this.close() : this.open(); }
  open() {
    const g = this.game; this.isOpen = true; this._prevFrozen = g.frozen; g.frozen = true;
    this.render(); this.el.classList.add('on'); g.hud?.show?.(false); g.audio?.play?.('ui:page');
    g.events?.emit('ui:pause', { paused: true });
  }
  close() {
    if (!this.isOpen) return; const g = this.game; this.isOpen = false;
    g.frozen = this._prevFrozen ?? false; this.el.classList.remove('on'); g.hud?.show?.(true); g.audio?.play?.('ui:page');
    g.events?.emit('ui:pause', { paused: false });
  }
  render() {
    const L = this.toasts.log;
    const fmtD = d => d ? `${d.day}/${d.month}/${d.year}` : '';
    const rows = L.length ? L.map(m => `<li class="${m.kind}"><span class="j-ico">${TOAST_ICONS[m.topic] || TOAST_ICONS[m.kind]}</span>
      <span class="j-txt">${esc(m.text)}</span><span class="j-when">${esc(m.bell)}${m.bell && m.date ? ' · ' : ''}${fmtD(m.date)}</span></li>`).join('')
      : '<li class="empty">Nothing to log for now.</li>';
    this.el.innerHTML = `<div class="journal tof-parch"><h2>Ship’s journal</h2><div class="j-lede">The latest news from aboard, newest first</div>
      <ul>${rows}</ul><div class="j-foot"><span class="kc">J</span> or <span class="kc">Esc</span> closes the journal</div>
      <button class="j-x interactive" data-j="close" aria-label="Close">×</button></div>`;
    this.dirty = false;
  }
}
