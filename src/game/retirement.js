// End of career: health (age + wounds), voluntary retirement (at a governor's) or forced (age, health at zero),
// final score screen with a retirement trade, local hall of fame (localStorage 'tof.halloffame').
// API: scoreBreakdown(state, lordsDefeated?, topLord?) -> { rows:[[label, detail, pts]], total }
//   health(state, fx?) -> 0..100
//   new Retirement(game) (system) · retire(reason) · isRetired
// Events: 'career:retire' {reason, total, trade}.
import { SCORE, AGEING, retireTrade, PIRATE_LORDS } from '../data/fortune.js';
import { a, fmtInt } from '../core/i18n.js';
import { formatDate } from '../ui/hud.js';

const SAVE_KEY = 'tof.save.v1', HOF_KEY = 'tof.halloffame';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function health(st, fx) {
  const age = Math.max(0, (st.age || 24) - AGEING.healthAgeFrom);
  const h = 100 - age * AGEING.healthPerYear - (st.wounds || 0) * AGEING.healthPerWound * (fx?.woundMul ?? 1) + (fx?.healthBonus || 0);
  return Math.max(0, Math.min(100, Math.round(h)));
}

export function scoreBreakdown(st) {
  const S = SCORE;
  const wealth = Math.max(0, (st.savings || 0) + (st.gold || 0));
  const ranks = Object.values(st.rank || {}).reduce((a, b) => a + b, 0);
  const acres = (st.lands || []).reduce((a, l) => a + (l.acres || 0), 0);
  const missions = (st.missions || []).filter(m => m.status === 'done').length;
  const treasures = st.treasure?.found || 0;
  const lords = PIRATE_LORDS.filter(l => st.lords?.[l.id]?.defeated);
  const top = st.lords?.[PIRATE_LORDS[0].id]?.defeated;
  const agePen = Math.max(0, (st.age || 24) - S.agePenaltyFrom) * S.agePenalty;
  const rows = [
    ['Fortune', `${fmtInt(wealth)} gold (savings and purse)`, Math.floor(wealth / S.wealthDiv)],
    ['Ranks', `${ranks} rank${ranks > 1 ? 's' : ''} in all`, ranks * S.rank],
    ['Lands', `${fmtInt(acres)} acres`, Math.floor(acres / S.acresDiv)],
    ['Prizes', `${st.captures || 0}`, (st.captures || 0) * S.capture],
    ['Missions', `${missions} accomplished`, missions * S.mission],
    ['Treasures', `${treasures} dug up`, treasures * S.treasure],
    ['Top 10 defeated', `${lords.length} pirate captain${lords.length > 1 ? 's' : ''}`, lords.length * S.lord + (top ? S.topLordBonus : 0)],
    st.spouse ? ['Wife', `${st.spouse.name}, daughter of the governor of ${st.spouse.portName}`, S.spouse] : null,   // married in an older save (the ball is gone)
    ['Age and wounds', `${st.age || 24} years old, ${st.wounds || 0} wound${(st.wounds || 0) > 1 ? 's' : ''}`, -(agePen + (st.wounds || 0) * S.wound)],
  ].filter(Boolean);
  return { rows, total: Math.max(0, rows.reduce((a, r) => a + r[2], 0)) };
}

export class Retirement {
  constructor(game) {
    this.game = game;
    this.isRetired = false;
    const ev = game.events;
    ev.on('career:day', () => this._check());
    ev.on('port:enter', () => this._check());
    this._warned = 0;
    const root = game.uiRoot || document.body;
    this.el = document.createElement('div'); this.el.className = 'board-screen retire-screen'; root.appendChild(this.el);
  }

  health() { return health(this.game.state, this.game.fortune?.fx); }

  _check() {
    const g = this.game, st = g.state;
    if (this.isRetired || g.params?.get('shot') || !g.player) return;
    const h = this.health();
    if ((st.age || 0) >= AGEING.retireAge) return this._later('age');
    if (h <= 0) return this._later('health');
    if (h < 25 && this._warned !== 2) { this._warned = 2; g.events.emit('notify', { text: 'Your old wounds keep you awake at night. It may be time to think of retiring.', kind: 'bad' }); }
    else if (h < 50 && !this._warned) { this._warned = 1; g.events.emit('notify', { text: 'The surgeon frowns: your health is declining.', kind: 'info' }); }
  }
  _later(reason) {
    if (this._pending) return;
    this._pending = true;
    // let the current screen (capture, duel…) finish before turning the page
    const tryNow = () => { const g = this.game; if (g.boarding?.active || g.duel?.active || g.mode === 'duel') return setTimeout(tryNow, 800); this.retire(reason); };
    setTimeout(tryNow, 600);
  }

  retire(reason = 'voluntary') {
    const g = this.game, st = g.state;
    if (this.isRetired) return;
    this.isRetired = true;
    if (g.ports?.isOpen) { g.ports.screen.close(); g.ports.isOpen = false; g.ports.stage?.clear?.(); }
    g.villages?.dismiss?.();   // fishing villages: without 'village:leave' (no save after the end)
    g.frozen = true; g.mode = 'menu'; g.hud?.show?.(false);
    const sb = scoreBreakdown(st), trade = retireTrade(sb.total);
    const lede = {
      voluntary: `The governor accepts your resignation. You lay your sword on his table and hand back your commission.`,
      age: `At ${st.age}, the shrouds have grown too stiff for your old legs. You leave the helm to a younger man.`,
      health: `Your wounds have got the better of you. The surgeon is adamant: you will never go to sea again.`,
    }[reason] || '';
    let hof = [];
    try { hof = JSON.parse(localStorage.getItem(HOF_KEY) || '[]'); } catch { hof = []; }
    const entry = { name: st.name, total: sb.total, trade: trade.title, date: { ...st.date }, at: Date.now(), ...(st.assist ? { assist: true } : {}) };   // “Assisted” career
    hof.push(entry); hof.sort((a, b) => b.total - a.total); hof = hof.slice(0, 8);
    try { localStorage.setItem(HOF_KEY, JSON.stringify(hof)); localStorage.removeItem(SAVE_KEY); } catch { /* no storage */ }
    g.events.emit('career:retire', { reason, total: sb.total, trade: trade.title });
    this.el.innerHTML = `<div class="board-sheet retire-sheet tof-parch">
      <h2>End of career</h2>
      <div class="sub">${lede}</div>
      <div class="sub">Captain ${esc(st.name)}, ${st.age} years old · ${formatDate(st.date)}</div>
      <div class="rule"></div>
      <table class="score">${sb.rows.map(([l, d, v]) => `<tr><td>${l}</td><td class="d">${d}</td><td class="n${v < 0 ? ' dn' : ''}">${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtInt(Math.abs(v))}</td></tr>`).join('')}
        <tr class="tot"><td>Final score</td><td></td><td class="n">${fmtInt(sb.total)}</td></tr></table>
      <div class="rule"></div>
      <div class="trade"><div class="tl">Your retirement</div><div class="tt">${trade.title}</div><p>${trade.text}</p>
        ${trade.next ? `<div class="tn">You were ${fmtInt(trade.next[0] - sb.total)} points short of ending as ${a(trade.next[1].toLowerCase())}.</div>` : ''}</div>
      <div class="rule"></div>
      <h3>Roll of honour</h3>
      <ol class="hof">${hof.map(h => `<li class="${h === entry ? 'me' : ''}"><span>${esc(h.name)}</span><em>${esc(h.trade)}${h.assist ? ' · assisted' : ''}</em><b>${fmtInt(h.total)}</b></li>`).join('')}</ol>
      <div class="choices"><button data-c="new">New career</button></div>
    </div>`;
    this.el.classList.add('on');
    this.el.querySelector('button').onclick = () => { const url = location.pathname + (g.params.get('quality') ? `?quality=${g.params.get('quality')}` : ''); if (g.leaveGuard) g.leaveGuard.reload(url); else location.href = url; };   // leave guard: no browser confirmation
    return sb;
  }
}
