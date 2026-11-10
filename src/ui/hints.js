// Contextual hints + guided goals of the early career.
// game.hud.hints = new Hints(game, hudEl) (created by the HUD, updated by hud.update before its visibility test).
// Hints: a small parchment card at the bottom left (covers neither the bottom bar, the target sheet nor the
// messages), one at a time (queue ordered by `prio`, pressing situations first), closing by itself after the reading
// time (HINT_TIMING) or on a click. Never outside 'sail' mode nor during duel / boarding / battle / sneaking /
// menus / log / registry / hold / chart: the card is then suspended (time stopped) — if it had been read for
// `minShownToDismiss` s, it counts as read. Triggers: game.events events + a few light polls (4 per second).
// A hint is remembered as soon as it shows: state.tutorials.hints[key] = true; if it concerns a command already used
// (chart, log, registry, hold, R, T opened or used before), it is marked without showing. Setting: settings.hints
// (Options “Tips”); reset() = “Show the tips again”.
// Off in ?shot= scenes (the critic's captures) unless ?hints=1.
// Goals: state.tutorials.goals = { step, port, portName, mission, missionId, again, ready, nationAdj } set by the
// 'game:new' event (menu, Appareiller); missing from old saves (no goals); a discreet line at the top centre of the
// HUD; advances when the Governor tab is open (polled), on 'career:mission' (accepted / done / failed / void) and
// 'career:promote'; finished once a rank is earned. Hidden when hints are off.
// Prologue (src/game/prologue.js, this.prologue), told by the first mate (src/ui/mateGuide.js, this.mate): on a new
// game, goals.step = 'offer' → the mate's panel (Begin / Skip); 'p-*' orders in the same panel (no goal line, no hint
// card meanwhile except urgent ones, prio ≥ URGENT, stacked above it; the hints whose keys an order shows are marked
// seen when it starts: MATE.steps[step].teach), then a farewell (MATE.bye, prologue.bye) and 'visit'.
// API: ensure() · trigger(key) · seen(key) · mark(key) · reset() · dismiss() · advance(secs) (tests) · current ·
//   queue · goal() · update()
import { HINTS, HINT_KEYS, HINT_TIMING as T, VETERAN_SEEN, GOAL_TEXT, GOAL_PORT_TEXT, MATE, MATE_ORDERS } from '../data/hints.js';
import { Prologue } from '../game/prologue.js';
import { MateGuide } from './mateGuide.js';
import { TOAST_ICONS } from './toasts.js';
import { ensureSettings } from './settings.js';
import { nationAdj } from '../core/i18n.js';
import { missionBriefs } from './missionBrief.js';

const NATIONS = ['english', 'spanish', 'french', 'dutch'];
const strip = h => String(h).replace(/<[^>]+>/g, '');
const URGENT = 3;   // during the prologue, only hints of this priority or more (damage, storm, shallows, board) show

export class Hints {
  constructor(game, hudEl) {
    this.game = game;
    const sp = game.params;
    this.allowed = !sp?.get?.('shot') || sp.get('hints') === '1';
    this.queue = []; this.current = null;
    this._last = 0; this._pollT = 0; this._seaT = 0; this._sailSeenAt = null; this._gap = 0;
    this._wantMap = false;
    if (typeof document !== 'undefined' && hudEl) {
      const el = this.el = document.createElement('div');
      el.className = 'hint-card tof-parch interactive off';
      el.setAttribute('role', 'status');
      el.addEventListener('click', () => this.dismiss());
      hudEl.appendChild(el);
      const gl = this.goalEl = document.createElement('div');
      gl.className = 'goal-line off';
      gl.addEventListener('click', e => { const b = e.target.closest?.('[data-pro]'); if (b) this._proAct(b.dataset.pro); });
      hudEl.appendChild(gl);
    }
    this.prologue = new Prologue(game, this);
    this.mate = new MateGuide(game, hudEl, a => this._proAct(a));
    const ev = game.events;
    ev.on('game:loaded', () => this.ensure({ loaded: true }));
    ev.on('game:new', () => this._newGame());
    ev.on('settings:change', ({ patch } = {}) => { if (patch && 'hints' in patch) this._onToggle(); });
    // event triggers
    ev.on('player:sail', ({ step } = {}) => { if (step > 0) this.trigger('sail'); });
    ev.on('cannon:fire', ({ ship } = {}) => { if (ship && ship === game.player) this.trigger('guns'); });
    ev.on('camera:mode', ({ mode, auto } = {}) => { if (auto && mode === 'tactical') this.trigger('camera'); });   // automatic combat view: C to recentre
    ev.on('boarding:end', ({ result } = {}) => { if (result === 'captured') this.trigger('fleet'); });
    for (const e of ['fortune:hire', 'fortune:item', 'treasure:piece', 'career:promote', 'lord:defeated']) ev.on(e, () => this.trigger('registry'));
    ev.on('ship:grounded', ({ ship } = {}) => { if (ship && ship === game.player) this.trigger('shoal'); });
    ev.on('zone:enter', ({ tier } = {}) => { if (tier === 2) this.trigger('zone2'); else if (tier === 3) this.trigger('zone3'); });   // sea tiers
    ev.on('career:mission', d => this._onMission(d || {}));
    ev.on('career:promote', () => this._goalDone());
  }

  // ---------------- state ----------------
  get on() { return this.allowed && ensureSettings(this.game).hints !== false && !!this.game.state; }
  tut() { const s = this.game.state; if (!s) return null; s.tutorials ||= {}; s.tutorials.hints ||= {}; return s.tutorials; }
  ensure({ loaded = false } = {}) {
    const s = this.game.state; if (!s) return;
    const fresh = !s.tutorials || !s.tutorials.hints;
    const t = this.tut();
    // old save of a career under way: the basics are known, only the recent systems get explained
    if (loaded && fresh) {
      const veteran = (s.captures || 0) >= 2 || (s.voyages || 0) >= 1 || Object.values(s.rank || {}).some(r => r > 0);
      if (veteran) for (const k of VETERAN_SEEN) t.hints[k] = true;
    }
    if (t.goals && this._hasRank()) t.goals.step = 'done';
    if (t.goals && (t.goals.step === 'offer' || /^p-/.test(t.goals.step))) t.goals.step = 'visit';   // prologue isn't saved
    this.prologue.bye = null;
    this.queue = []; this._hide(); this._seaT = 0; this._sailSeenAt = null;
    this._renderGoal(true);
  }
  seen(k) { return !!this.game.state?.tutorials?.hints?.[k]; }
  mark(k) { const t = this.tut(); if (t) t.hints[k] = true; }
  reset() {
    const t = this.tut(); if (!t) return;
    t.hints = {}; t.duel = false;   // the first duel gets its tutorial back too
    this.queue = []; this._hide(); this._seaT = 0; this._sailSeenAt = null;
  }

  trigger(k) {
    if (!HINTS[k] || !this.on || this.seen(k) || this.current?.key === k || this.queue.includes(k)) return false;
    const pr = HINTS[k].prio || 0, i = this.queue.findIndex(q => (HINTS[q].prio || 0) < pr);   // stable: after its equals
    if (i < 0) this.queue.push(k); else this.queue.splice(i, 0, k);
    return true;
  }
  dismiss() {
    if (!this.current) return;
    this._hide(); this._gap = T.gap;
    this.game.audio?.play?.('ui:page');
  }
  // tests: advances the reading clock by `secs` seconds
  advance(secs) { this._tick(secs); }

  // ---------------- loop ----------------
  update() {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const real = Math.min(0.1, Math.max(0, (now - (this._last || now)) / 1000));
    this._last = now;
    this._tick(real);
  }
  _tick(real) {
    if (!this.on) { if (this.current || this.queue.length) { this.queue = []; this._hide(); } this._renderGoal(); return; }
    const blocked = this._blocked();
    this._pollT -= real;
    if (this._pollT <= 0) { this._pollT = 0.25; this._pollGoals(); if (!blocked) this._poll(); }
    if (!blocked && this.game.mode === 'sail') this._seaT += real;
    // card shown: suspended if the screen changes; counted as read if it was shown long enough
    const c = this.current;
    if (c) {
      if (blocked) {
        if (c.shown >= T.minShownToDismiss && this.game.mode !== 'sail') this._hide();
        else this.el?.classList.add('held');
      } else {
        this.el?.classList.remove('held');
        c.shown += real;
        if (this._bar) this._bar.style.transform = `scaleX(${Math.max(0, 1 - c.shown / c.life).toFixed(3)})`;
        if (c.shown >= c.life) { this._hide(); this._gap = T.gap; }
      }
    } else if (!blocked) {
      this._gap -= real;
      if (this._gap <= 0) this._next();
    }
    const bye = this.prologue.bye;
    if (bye && !blocked && (bye.t += real) >= MATE.byeTime) { this.prologue.bye = null; this._renderGoal(true); this._flashGoal(); }
    this._renderGoal();
  }
  _blocked() {
    const g = this.game, h = g.hud;
    return g.mode !== 'sail' || !g.player || !!h?.menu?.isOpen || h?.visible === false || !!g.duel?.active || !!g.boarding?.active
      || !!g.landBattle?.active || !!g.sneak?.active || !!h?.toasts?.journal?.isOpen || !!g.registry?.isOpen
      || !!g.hold?.isOpen || !!g.worldMap?.isOpen || !!g.ports?.isOpen;
  }
  _next() {
    const pro = this._inPrologue();
    for (let i = 0; i < this.queue.length; i++) {
      const k = this.queue[i];
      if (pro && (HINTS[k].prio || 0) < URGENT) continue;   // the mate is speaking: ordinary hints wait their turn
      this.queue.splice(i--, 1);
      if (this.seen(k)) continue;
      if (!this._live(k)) continue;   // the moment has passed (port or enemy out of range): it will come back
      return this._show(k);
    }
  }
  // a hint tied to a situation is only shown if the situation still holds
  _live(k) {
    const g = this.game;
    if (k === 'port') return !!g.hud?._nearPort && !g.hud._nearPort.port?.village && !this._inPrologue();
    if (k === 'board') return !!g.combat?.boardHint;
    return true;
  }
  _show(k) {
    const h = HINTS[k], body = h.body();
    const life = Math.min(T.max, Math.max(T.min, T.base + strip(h.title + body).length / T.perChars));
    this.current = { key: k, shown: 0, life };
    this.mark(k);
    if (!this.el) return;
    this.el.innerHTML = `<span class="hc-ico">${TOAST_ICONS[h.topic] || TOAST_ICONS.info}</span>
      <div class="hc-body"><div class="hc-title">${h.title}</div><div class="hc-txt">${body}</div></div>
      <span class="hc-x" aria-hidden="true">×</span><i class="hc-time"></i>`;
    this.el.dataset.hint = k;
    this._bar = this.el.querySelector('.hc-time');
    this.el.className = 'hint-card tof-parch interactive';
    void this.el.offsetWidth; this.el.classList.add('in');
    this.game.audio?.play?.('ui:hover');
  }
  // the mate is on (offer, orders or farewell): ordinary hints and the goal line wait
  _inPrologue() { const st = this.goal()?.step || ''; return st === 'offer' || /^p-/.test(st) || !!this.prologue?.bye; }
  _proAct(a) {
    const st = this.goal()?.step;
    this.game.audio?.play?.('ui:select');
    if (a === 'start' && st === 'offer') { this._gap = 0.6; this.prologue.start(); }
    else if (a === 'skip' && (st === 'offer' || /^p-/.test(st || ''))) { this._gap = T.gap; this.prologue.skip(); this._flashGoal(); }
  }
  _hide() {
    this.current = null;
    if (this.el) { this.el.className = 'hint-card tof-parch interactive off'; delete this.el.dataset.hint; }
  }
  _onToggle() { if (!this.on) { this.queue = []; this._hide(); } this._renderGoal(true); }

  // light polls (outside blocking screens)
  _poll() {
    const g = this.game, p = g.player, h = g.hud; if (!p) return;
    // already used: marked without a hint
    if ((g.timeScale || 1) > 1) this.mark('time');
    if (p.repairing) this.mark('repair');
    // wind and points of sail: a few seconds after sailing (or on first sail, by event)
    if (this._seaT > T.sailDelay) this.trigger('sail');
    if (this.seen('sail') && this._sailSeenAt == null) this._sailSeenAt = this._seaT;
    const enemy = p.controller?.nearestEnemy?.(1500);
    if (!enemy && this._sailSeenAt != null && this._seaT - this._sailSeenAt > T.timeDelay) this.trigger('time');
    if (this._seaT > T.mapDelay || (this._wantMap && !enemy)) this.trigger('map');
    if (!enemy && (h?.toasts?.log?.length || 0) >= T.journalAfter) this.trigger('journal');
    // situations
    const near = p.controller?.nearestEnemy?.(800);
    if (near) this.trigger('guns');
    if (g.combat?.boardHint) this.trigger('board');
    if (h?._nearPort && !h._nearPort.port?.village) this.trigger('port');   // villages: no governor
    const cap = g.fortune?.fx?.repairCap ?? 0.75;
    if ((p.hull ?? 1) < (p.hullMax || 1) * Math.min(0.85, cap) || (p.sails ?? 1) < 0.78) this.trigger('repair');
    const st = g.state || {}, cargo = Object.values(st.cargo || {}).reduce((a, q) => a + (q || 0), 0);
    if (cargo > 0 || (p.loadSpeedF ?? 1) < 0.999) this.trigger('hold');
    if (/^storm/.test(p.weatherKind || '')) this.trigger('storm');
    const sh = h?.shoal?._state; if (sh && sh !== 'off') this.trigger('shoal');
  }

  // ---------------- objectifs ----------------
  goal() { return this.game.state?.tutorials?.goals || null; }
  _hasRank() { const r = this.game.state?.rank || {}; return Object.values(r).some(v => v > 0); }
  _newGame() {
    const g = this.game, s = g.state; if (!s) return;
    const p = g.player, nat = s.nationality || p?.faction || 'english';
    let best = null, bd = Infinity, any = null, ad = Infinity;
    for (const port of g.islands?.ports || []) {
      if (port.haven || !p) continue;
      const d = Math.hypot(port.x - p.position.x, port.z - p.position.z);
      if (port.faction === nat && d < bd) { bd = d; best = port; }
      if (port.faction !== 'pirate' && d < ad) { ad = d; any = port; }
    }
    const port = best || any;
    s.tutorials = { hints: {}, goals: { step: this.on ? 'offer' : 'visit', port: port?.id || null, portName: port?.name || null } };
    this.queue = []; this._hide(); this._seaT = 0; this._sailSeenAt = null; this._wantMap = false; this.prologue.bye = null;
    // the mate's portraits, painted now (under the fade to black), never at sea
    if (this.on && this.allowed) this.mate.prepare(nat);
    this._renderGoal(true);
  }
  _advance(step, patch = {}) {
    const o = this.goal(); if (!o || o.step === 'done') return;
    Object.assign(o, patch, { step });
    if (step !== 'rank') { delete o.ready; }
    // the port screen hides the HUD: the next goal is announced there by a message
    if (this.on && GOAL_PORT_TEXT[step] && (this.game.ports?.isOpen || step === 'done'))
      this.game.events.emit('notify', { text: GOAL_PORT_TEXT[step](o), kind: step === 'done' ? 'good' : 'info', topic: 'rank' });
    // an order of the mate: the hints whose keys it shows are now known (never queued behind it)
    for (const k of MATE.steps[step]?.teach || []) { this.mark(k); this.queue = this.queue.filter(q => q !== k); if (this.current?.key === k) this._hide(); }
    this._renderGoal(true);
    if (step !== 'done') this._flashGoal();
  }
  _flashGoal() { const el = this.goalEl; if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } }
  _goalDone() { const o = this.goal(); if (o && o.step !== 'done') this._advance('done'); }
  _onMission({ mission: m, status }) {
    const o = this.goal();
    if (status === 'accepted') this._wantMap = true;
    if (!o || o.step === 'done' || !m) return;
    if (status === 'accepted' && (o.step === 'visit' || o.step === 'accept')) this._advance('mission', { mission: m.title, missionId: m.id, again: false });
    else if (status === 'done' && o.step === 'mission') this._advance('rank');
    else if ((status === 'failed' || status === 'void') && o.step === 'mission' && (!o.missionId || o.missionId === m.id)) {
      // another mission still active takes over, otherwise a new one must be accepted
      const other = (this.game.state.missions || []).find(x => x.status === 'active' && x.id !== m.id);
      if (other) this._advance('mission', { mission: other.title, missionId: other.id });
      else this._advance('accept', { again: true, mission: null, missionId: null });
    }
  }
  _pollGoals() {
    const o = this.goal(), g = this.game;
    if (!o || o.step === 'done') return;
    if (this._hasRank()) return this._advance('done');
    if (/^p-/.test(o.step)) return this.prologue.poll();
    if (o.step === 'visit' && g.ports?.isOpen && g.ports.screen?.tab === 'governor' && !g.ports.locked?.(g.ports.port, 'governor')) this._advance('accept');
    if (o.step === 'rank' && g.career?.rankOf) {
      let ready = null;
      for (const n of NATIONS) { const r = g.career.rankOf(n); if (r.need != null && r.merit >= r.need && r.rep >= r.minRep) { ready = n; break; } }
      if (!!ready !== !!o.ready) { o.ready = !!ready; o.nationAdj = ready ? nationAdj(ready) : ''; this._renderGoal(true); }
    }
  }
  _renderGoal(force = false) {
    this._renderMate();
    const el = this.goalEl; if (!el) return;
    const o = this.goal(), show = this.on && !!o && o.step !== 'done' && !!GOAL_TEXT[o.step] && !this.prologue.bye;
    // mission that ends in port: what to do there and where (F key), taken from the mission reminder
    let how = show && o.step === 'mission' ? missionBriefs(this.game).find(b => b.id === o.missionId)?.short : '';
    if (how && !how.includes('(F)')) how = '';   // at sea (hunt under way…): the mission's title is enough
    const oo = how ? { ...o, how: how.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) } : o;
    const html = show ? `<span class="gl-lbl">Goal</span><span class="gl-txt">${GOAL_TEXT[o.step](oo)}</span>` : '';
    if (!force && html === this._goalHtml) return;
    this._goalHtml = html;
    if (show) el.innerHTML = html;
    el.classList.toggle('off', !show);
    if (show) el.dataset.step = o.step; else delete el.dataset.step;
  }
  // the first mate's panel: offer, current order (text, what is left to do), farewell
  _renderMate() {
    const m = this.mate; if (!m?.el) return;
    const o = this.goal(), st = o?.step || '', bye = this.prologue.bye, S = MATE.steps[st];
    let v = null;
    if (!this.on || !o) v = null;
    else if (st === 'offer') v = { mode: 'offer', mood: 'neutral', text: MATE.offer.text(o), acts: 'offer', step: 'offer' };
    else if (S) v = { mode: 'order', mood: S.mood, text: S.text(o), todo: S.todo(o), order: MATE.order(S.n, MATE_ORDERS), acts: 'skip', step: st };
    else if (bye) { const B = MATE.bye[bye.how] || MATE.bye.lost; v = { mode: 'bye', mood: B.mood, text: B.text(bye.name, o), step: 'bye' }; }
    if (!v) { if (m.visible) { m.hide(); this._stack(0); } return; }
    const changed = m.show(v), held = m.hold(this._blocked());
    if (changed || held) this._stack(m.height());
  }
  // an urgent hint during the prologue sits above the mate's panel
  _stack(h) {
    if (!this.el) return;
    const v = h ? `${h + 10}px` : '';
    if (this.el.style.getPropertyValue('--mate-h') !== v) { if (v) this.el.style.setProperty('--mate-h', v); else this.el.style.removeProperty('--mate-h'); }
  }
}
export { HINT_KEYS };
