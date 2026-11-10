// Permanent resource band (gold, provisions, crew, hold, morale) under the ledger strip, plus
// animated gains: “+1,250 gold”, “+40 sugar”, “+12 men” rise from mid-screen and fly into their counter.
// Diff-based (polls game.state / player each tick), so every source — boarding spoils, prize sales, trade, career
// shares, rescued crew — is covered; events (boarding:end, ship:struck, trade, career:*, crew:rescued) only add a
// short caption to the next gains ("Prise", "Vente"…).
// API: new ResourceBar(game, hudEl), update(real), setAwait(bool)
import { ICONS } from './icons.js';
import { GOODS } from '../data/world.js';
import { holdUsed, holdCapacity } from '../game/economy.js';
import { SPECIALISTS, SPECIALIST_IDS } from '../data/fortune.js';
import { fmtInt } from '../core/i18n.js';
import { DAY_SCALE } from '../game/career.js';

// Provisions in ONE unit for the player: calendar days at sea for the present crew (the date of the ledger strip
// turns once a day). Consumption as in Career.advanceDays: crew / 25 barrels per design day of 45 s (cooper −30 %).
// The barrels stay the trade unit at the market and in the hold, with the days alongside.
export function provisionDays(game, food = game.state?.food ?? 0, crew = game.player?.crew ?? game.state?.crew ?? 0) {
  const perDay = crew / 25 * (game.fortune?.fx?.foodMul ?? 1) / DAY_SCALE;   // barrels eaten per calendar day
  return perDay > 0 ? food / perDay : Infinity;
}
// 0 days · < ½ day · ½ day · 1 day · 2½ days · 12 days (halves below ten, rounded down: never more than there is)
export function fmtDays(d) {
  if (!Number.isFinite(d)) return '—';
  if (d >= 10) return `${fmtInt(Math.floor(d))} days`;
  const h = Math.floor(d * 2) / 2, n = Math.floor(h), half = h - n ? '½' : '';
  if (h <= 0) return d > 0 ? '< ½ day' : '0 days';
  return `${n || ''}${half} ${h > 1 ? 'days' : 'day'}`;
}

const fmt = n => fmtInt(n);
const FOOD_I = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 7 H24 C26 12 26 20 24 25 H8 C6 20 6 12 8 7Z" fill="#a8743a" stroke="#4a2c0e" stroke-width="1.6"/><path d="M7 12 H25 M7 20 H25" stroke="#4a2c0e" stroke-width="1.6"/></svg>';
const HOLD_I = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="9" width="22" height="16" rx="1.5" fill="#b98a4c" stroke="#4a2c0e" stroke-width="1.6"/><path d="M5 14 H27 M12 9 V25 M20 9 V25" stroke="#4a2c0e" stroke-width="1.3"/></svg>';
const MOR_I = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 26 V5 M8 6 C14 3 18 10 25 7 V17 C18 20 14 13 8 16" fill="#b5302a" stroke="#4a2c0e" stroke-width="1.6"/></svg>';

const OFF_I = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4 L19 11 L27 12 L21 17 L23 25 L16 21 L9 25 L11 17 L5 12 L13 11Z" fill="#c9a24a" stroke="#4a2c0e" stroke-width="1.6" stroke-linejoin="round"/></svg>';

export class ResourceBar {
  constructor(game, hudEl) {
    this.game = game;
    const el = this.el = document.createElement('div');
    el.className = 'res-band tof-parch await';
    el.innerHTML = `
      <span class="res gold" title="Gold"><i>${ICONS.gold}</i><b class="v"></b><small>gold</small></span>
      <span class="res food" title="Provisions: days at sea for the present crew"><i>${FOOD_I}</i><b class="v"></b><small>provisions</small></span>
      <span class="res crew" title="Crew"><i class="ink">${ICONS.crew}</i><b class="v"></b><small>men</small></span>
      <span class="res hold" title="Cargo (hold)"><i>${HOLD_I}</i><b class="v"></b><small>hold</small></span>
      <span class="res mor" title="Crew morale"><i>${MOR_I}</i><b class="v"></b><small>morale</small></span>
      <span class="res offi" title="Specialist officers aboard (Ledger: L)"><i>${OFF_I}</i><b class="v"></b><small>officers</small></span>`;
    hudEl.appendChild(el);
    this.fly = document.createElement('div'); this.fly.className = 'res-fly'; hudEl.appendChild(this.fly);
    const q = s => el.querySelector(s);
    this.$ = { gold: q('.gold'), food: q('.food'), crew: q('.crew'), hold: q('.hold'), mor: q('.mor'), offi: q('.offi') };
    this._c = {}; this._prev = null; this._t = 0; this._q = []; this._qT = 0;
    this._why = null; this._whyT = -1;
    const ev = game.events, tag = w => { this._why = w; this._whyT = performance.now(); };
    ev?.on('boarding:end', ({ result } = {}) => tag(result === 'defeat' ? null : 'Prize'));
    ev?.on('ship:struck', () => tag('Prize'));
    ev?.on('trade', ({ side } = {}) => tag(side === 'sell' ? 'Sale' : 'Purchase'));
    ev?.on('career:divide', () => tag('Share-out'));
    ev?.on('career:mission', () => tag('Mission'));
    ev?.on('crew:rescued', () => tag('Rescued'));
  }
  setAwait(a) { this.el.classList.toggle('await', a); }
  _snap() {
    const g = this.game, st = g.state || {}, p = g.player;
    const cargo = {}; for (const k in st.cargo || {}) cargo[k] = st.cargo[k] || 0;
    return { gold: st.gold ?? 0, food: st.food ?? 0, crew: p?.crew ?? st.crew ?? 0, cargo, ship: p };
  }
  update(real) {
    this._t -= real;
    if (this._t > 0) { this._drain(real); return; }
    this._t = 0.2;
    const g = this.game, st = g.state || {}, p = g.player, s = this._snap();
    const crewMax = p?.crewMax || s.crew;
    const days = provisionDays(g, s.food, s.crew), mo = Math.round(st.morale ?? 70);
    let used = 0, cap = 0; try { used = holdUsed(g); cap = holdCapacity(g); } catch { /* no ship yet */ }
    this._v('gold', fmt(s.gold));
    this._v('food', fmtDays(days), days < 1);
    const ft = `Provisions: ${fmtDays(days)} at sea for ${Math.round(s.crew)} men (${fmt(s.food)} ${s.food === 1 ? 'barrel' : 'barrels'})`;
    if (this.$.food.title !== ft) this.$.food.title = ft;
    this._v('crew', `${Math.round(s.crew)}/${Math.round(crewMax)}`, s.crew < crewMax * 0.35);
    this._v('hold', `${Math.round(used)}/${Math.round(cap)}`, cap > 0 && used >= cap - 0.5);
    this._v('mor', `${mo}`, mo < 30);
    const sp = st.specialists || {}, ns = Object.values(sp).filter(Boolean).length;   // specialists aboard
    this._v('offi', `${ns}/8`);
    const tt = 'Officers aboard: ' + (ns ? SPECIALIST_IDS.filter(id => sp[id]).map(id => SPECIALISTS[id].name).join(', ') : 'none') + ' (Ledger: L)';
    if (this.$.offi.title !== tt) this.$.offi.title = tt;
    // gains: only when the same ship is followed and the game is running (not on load / ship change)
    const pr = this._prev;
    if (pr && pr.ship === s.ship && g.mode !== 'menu') {
      const why = performance.now() - this._whyT < 4000 ? this._why : null;
      if (s.gold - pr.gold >= 1) this._q.push(['gold', `+${fmt(s.gold - pr.gold)} gold`, why]);
      if (s.crew - pr.crew >= 1) this._q.push(['crew', `+${fmt(s.crew - pr.crew)} ${s.crew - pr.crew >= 2 ? 'men' : 'man'}`, why]);
      if (s.food - pr.food >= 1) { const d = provisionDays(g, s.food - pr.food, s.crew); this._q.push(['food', d >= 0.5 && Number.isFinite(d) ? `+${fmtDays(d)} of provisions` : `+${fmt(s.food - pr.food)} ${s.food - pr.food >= 2 ? 'barrels' : 'barrel'} of provisions`, why]); }
      for (const k in s.cargo) {
        const d = s.cargo[k] - (pr.cargo[k] || 0);
        if (d >= 1) this._q.push(['hold', `+${fmt(d)} ${(GOODS[k]?.name || k).toLowerCase()}`, why]);
      }
    }
    this._prev = s;
    this._drain(0);
  }
  _v(k, txt, low = false) {
    const el = this.$[k]; if (!el) return;
    if (this._c[k] !== txt) { this._c[k] = txt; el.querySelector('.v').textContent = txt; }
    if (this._c[k + 'L'] !== low) { this._c[k + 'L'] = low; el.classList.toggle('low', low); }
  }
  // stagger the flying labels (0.35 s apart) so a big prize reads as a cascade, not a pile
  _drain(real) {
    this._qT -= real;
    if (this._qT > 0 || !this._q.length) return;
    this._qT = 0.35;
    const [k, txt, why] = this._q.shift();
    this._spawn(k, txt, why);
  }
  _spawn(k, txt, why) {
    const dst = this.$[k]; if (!dst || this.el.classList.contains('await')) return;
    this.game.hud?.toasts?.record?.(why ? `${why}: ${txt}` : txt, 'good', k === 'crew' ? 'crew' : 'gold');   // gains go to the journal (J)
    const n = document.createElement('div');
    n.className = `res-gain g-${k}`;
    n.innerHTML = (why ? `<small>${why}</small>` : '') + `<span>${txt}</span>`;
    this.fly.appendChild(n);
    const W = innerWidth, H = innerHeight, r = dst.getBoundingClientRect();
    const slot = (this.fly.childElementCount - 1) % 4;   // concurrent gains stack downward instead of overlapping
    const x0 = W * 0.5, y0 = H * 0.3 + slot * 52;
    n.style.transform = `translate(${x0}px, ${y0}px) translate(-50%, -50%) scale(0.6)`; n.style.opacity = '0';
    const a = n.animate([
      { transform: `translate(${x0}px, ${y0}px) translate(-50%, -50%) scale(0.6)`, opacity: 0 },
      { transform: `translate(${x0}px, ${y0 - 26}px) translate(-50%, -50%) scale(1.12)`, opacity: 1, offset: 0.15 },
      { transform: `translate(${x0}px, ${y0 - 34}px) translate(-50%, -50%) scale(1)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${r.left + r.width / 2}px, ${r.top + r.height / 2}px) translate(-50%, -50%) scale(0.45)`, opacity: 0.2 },
    ], { duration: 2300, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'forwards' });
    a.onfinish = () => {
      n.remove();
      dst.classList.remove('pulse'); void dst.offsetWidth; dst.classList.add('pulse');
    };
  }
}
