// Registry (L key, at sea): ranking of the Top 10 pirate captains with the player, lairs, officers aboard, items,
// treasure map, age, health and projected retirement score. A simple sheet over the frozen scene.
// API: new Registry(game) · open() · close() · toggle() · isOpen
import './fortune.css';
import { isKey } from '../core/keys.js';
import { SPECIALISTS, SPECIALIST_IDS, ITEM_IDS, TREASURE, retireTrade, AGEING } from '../data/fortune.js';
import { itemName, itemEffect } from '../game/fortune.js';
import { lordTitle, ord } from '../game/pirateLords.js';
import { scoreBreakdown, health } from '../game/retirement.js';
import { fmtInt, shipType, nationPeople } from '../core/i18n.js';
import { ensureFleet, FLEET, crewMaxOf, holdCapOf, holdUsedOf } from '../game/fleet.js';   // squadron (read only)
import { holdUsed, holdCapacity } from '../game/economy.js';
import { SKILLS } from '../data/creation.js';   // character creation: special talent
import { GOODS } from '../data/world.js';
import { classOf, CLASS_NAMES, powerClass } from '../data/shipTypes.js';   // sea tiers: ship classes
import { livePower } from '../data/seaZones.js';
import { missionBriefs } from './missionBrief.js';   // “Missions” section

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Registry {
  constructor(game) {
    this.game = game; this.isOpen = false;
    this.el = document.createElement('div'); this.el.className = 'board-screen registry-screen';
    (game.uiRoot || document.body).appendChild(this.el);
    addEventListener('keydown', e => this._key(e), true);
    this.el.addEventListener('click', e => { if (e.target.closest?.('[data-c="close"]')) this.close(); });
  }
  _key(e) {
    const g = this.game;
    if (e.target?.tagName === 'INPUT' || g.hud?.menu?.isOpen) return;
    if (this.isOpen && (e.code === 'Escape' || isKey(e, 'l'))) { e.stopImmediatePropagation(); e.preventDefault(); this.close(); return; }
    if (!this.isOpen && isKey(e, 'l') && g.mode === 'sail' && g.player && !e.repeat) { e.preventDefault(); this.open(); }
  }
  toggle() { if (this.isOpen) this.close(); else this.open(); }
  open() {
    const g = this.game;
    this.isOpen = true; this._prevFrozen = g.frozen; g.frozen = true; g.mode = 'map';
    g.hud?.show?.(false);
    this.el.innerHTML = this._html();
    this.el.classList.add('on');
    g.audio?.play?.('ui:page');
  }
  close() {
    const g = this.game;
    if (!this.isOpen) return;
    this.isOpen = false; g.frozen = this._prevFrozen && g.params.get('frozen') ? true : false; g.mode = 'sail';
    g.hud?.show?.(true);
    this.el.classList.remove('on');
    g.audio?.play?.('ui:back');
  }

  // the squadron at a glance (read only; sold, repaired and swapped at the shipyard)
  _fleet() {
    const g = this.game, st = g.state, p = g.player, fl = ensureFleet(st);
    const cargo = c => { const e = Object.entries(c || {}).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]); return e.length ? e.slice(0, 3).map(([k, q]) => `${GOODS[k]?.name.toLowerCase() || k} ${fmtInt(q)}`).join(', ') + (e.length > 3 ? '…' : '') : '—'; };
    const flag = p ? `<tr class="me"><td><b>${esc(p.name)}</b></td><td>${shipType(p.type)} · class ${CLASS_NAMES[powerClass(livePower(p)) - 1]} · flagship</td><td class="n">${Math.round(p.hull / p.hullMax * 100)}%</td><td class="n">${Math.round(p.crew)}/${p.crewMax}</td><td class="n">${holdUsed(g)}/${holdCapacity(g)}</td><td class="d">${cargo({ ...st.cargo, ...(st.food > 0 ? { food: st.food } : {}) })}</td></tr>` : '';
    const rows = fl.map(f => `<tr><td><i>${esc(f.name)}</i></td><td>${shipType(f.type)} · class ${CLASS_NAMES[classOf(f.type) - 1]}${f.own ? '' : f.from ? ` · taken from ${f.from === 'pirate' ? 'the pirates' : `the ${nationPeople(f.from)}`}` : ''}</td><td class="n${f.hull < 0.7 ? ' dn' : ''}">${Math.round(f.hull * 100)}%</td><td class="n">${f.crew}/${crewMaxOf(f.type, f.upgrades)}</td><td class="n">${holdUsedOf(f)}/${holdCapOf(f.type, f.upgrades)}</td><td class="d">${cargo(f.cargo)}</td></tr>`).join('');
    return `<div class="rule"></div>
      <h3>Your squadron (${fl.length}/${FLEET.max})</h3>
      <table class="ranks fleet"><tr class="hd"><td>Ship</td><td>Type</td><td class="n">Hull</td><td class="n">Men</td><td class="n">Hold</td><td>Cargo</td></tr>${flag}${rows}</table>
      ${fl.length ? '<p class="small">Sell, repair, change flagship or transfer men and goods: at the shipyard of a friendly port.</p>' : '<p class="small">No prize at anchor. A ship kept after a boarding joins your squadron.</p>'}`;
  }

  // governor missions under way (title, deadline, full objective from career.missionObjective)
  _missions() {
    const list = missionBriefs(this.game);
    if (!list.length) return '<h3>Missions</h3><p class="ink">No mission under way. Governors entrust them to the captains of their nation.</p>';
    return `<h3>Missions (${list.length})</h3><ul class="lst mis">${list.map(b => `<li class="on${b.urgent ? ' urgent' : ''}${b.ready ? ' ready' : ''}"><b>${esc(b.title)}</b>${b.when ? `<span class="mw">${b.ready ? b.when : `${b.when}${b.date ? ` · ${b.date}` : ''}`}</span>` : ''}<em>${esc(b.full || b.short)}</em></li>`).join('')}</ul>`;
  }

  _html() {
    const g = this.game, st = g.state, lords = g.lords, fo = g.fortune;
    const rows = lords?.ranking() || [];
    let n = 0;
    const table = rows.map(r => {
      const pos = r.defeated ? '—' : ord(++n);
      if (r.isPlayer) return `<tr class="me"><td class="n">${pos}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.ship)}</td><td class="d">your ship</td><td class="n">${fmtInt(r.fame)}</td></tr>`;
      return `<tr class="${r.defeated ? 'beaten' : ''}"><td class="n">${pos}</td><td>${esc(lordTitle(r))}</td><td><i>${esc(r.ship)}</i>, ${shipType(r.type).toLowerCase()}</td><td class="d">${r.defeated ? 'defeated' : esc(r.lairName)}</td><td class="n">${r.defeated ? '' : fmtInt(r.fame)}</td></tr>`;
    }).join('');
    // a missing officer fits on one line (a single shared note), so everything fits in 768 px
    const missing = SPECIALIST_IDS.filter(id => !st.specialists?.[id]);
    const specs = SPECIALIST_IDS.filter(id => st.specialists?.[id]).map(id => `<li class="on"><b>${SPECIALISTS[id].name}</b><em>${SPECIALISTS[id].effect}</em></li>`).join('')
      + (missing.length ? `<li class="note"><em>To be found aboard prizes: ${missing.map(id => `<b>${SPECIALISTS[id].name}</b>`).join(', ')}.</em></li>` : '');
    const items = ITEM_IDS.filter(c => st.items?.[c]).map(c => `<li class="on"><b>${itemName(c, st.items[c])}</b><em>${itemEffect(c, st.items[c])}</em></li>`).join('') || '<li><em>No items. The mysterious traveller in the taverns sometimes sells some.</em></li>';
    const t = st.treasure || {}, site = fo?.treasureSite?.();
    const isl = site && g.islands?.getIsland?.(site.islandId);
    const map = site ? `Complete map: a cross on ${esc(isl?.name || 'an island')} (M).` : `${t.pieces || 0} piece${(t.pieces || 0) > 1 ? 's' : ''} of ${TREASURE.pieces}${t.found ? ` · ${t.found} treasure${t.found > 1 ? 's' : ''} dug up` : ''}`;
    const h = health(st, fo?.fx), sb = scoreBreakdown(st), tr = retireTrade(sb.total);
    return `<div class="board-sheet registry tof-parch">
      <h2>Ledger of captains</h2>
      <div class="sub">The ten most feared of the Brethren of the Coast, and you. Defeating one of them raises you in this ledger.</div>
      <table class="ranks"><tr class="hd"><td></td><td>Captain</td><td>Ship</td><td>Lair</td><td class="n">Renown</td></tr>${table}</table>
      <div class="rule"></div>
      <div class="cols3">
        <div><h3>Officers (${SPECIALIST_IDS.filter(id => st.specialists?.[id]).length}/8)</h3><ul class="lst">${specs}</ul>
          <h3>Captain’s chest</h3><ul class="lst">${items}</ul><h3>Treasure map</h3><p class="ink">${map}</p></div>
        <div>${this._missions()}</div>
        <div><h3>The captain</h3>
          <div class="kv"><span>Age</span><b>${st.age || 24}</b></div>
          ${Object.hasOwn(SKILLS, st.skill ?? "") ? `<div class="kv"><span>Talent</span><b>${SKILLS[st.skill].name}</b></div><p class="small" style="margin-top:0">${SKILLS[st.skill].effect}.</p>` : ''}
          <div class="kv"><span>Health</span><b class="${h < 35 ? 'dn' : ''}">${h}%</b></div>
          <div class="hbar"><i style="width:${h}%"></i></div>
          <div class="kv"><span>Retirement score</span><b>${fmtInt(sb.total)}</b></div>
          <div class="kv"><span>Expected retirement</span><b>${tr.title}</b></div>
          <div class="kv"><span>Lands</span><b>${fmtInt(this.game.career?.acres?.() || 0)} acres</b></div>
          ${st.spouse ? `<div class="kv"><span>Wife</span><b>${esc(st.spouse.name)}${st.spouse.portName ? ` (${esc(st.spouse.portName)})` : ''}</b></div>` : ''}
          ${tr.next ? `<div class="kv"><span>Next step</span><b>${tr.next[1]} · ${fmtInt(tr.next[0])}</b></div>` : ''}
          <p class="small">Voluntary retirement with a governor. Forced at ${AGEING.retireAge} or when health falls to zero.</p></div>
      </div>
      ${this._fleet()}
      <div class="choices"><button data-c="close">Close the ledger · L</button></div>
    </div>`;
  }
}
