// The port screen. Two layouts over a live 3D picture:
//   'harbour'  landing vista: the real town behind, big gilded town name + gilded location menu on the left,
//              a port report card on the right, caption bar at the bottom.
//   location   ('market'|'tavern'|'shipyard'|'governor'|'bank'): that location's lit, staffed 3D stage
//              (src/game/ports/stage/) fills the screen; a parchment column (~38% width) on the right holds the
//              controls; a large caption/dialogue bar sits bottom-left; gilded location links run along the top.
// API: new PortScreen(game, sys) ; open(port, tab) ; close() ; render() ; fadeThrough(fn) ; tab ; isOpen
import './port.css';
import { GOODS } from '../../data/world.js';
import { flagSVG } from '../flags.js';
import { ICONS, RULE } from '../icons.js';
import { formatDate } from '../hud.js';
import { GOOD_ICON, SHIP_SIL, SEAL, GLYPH, VIGNETTE, PORTRAIT } from './art.js';
import { portraitURL, portraitLazy, portraitKey } from './portrait3d.js';   // characters: medallions painted from the 3D figures
import { quote, holdUsed, holdCapacity, avgCost, CARGO_CAPACITY, SHIP_PRICES } from '../../game/economy.js';
import { RANKS, RANK_MERIT, NATIONS, PRIVILEGES } from '../../game/career.js';
import { SHIP_SPECS } from '../../ships/shipModel.js';
import { SHIP_TYPES, yardTypes, classOf, CLASS_NAMES } from '../../data/shipTypes.js';
import { HULL_WEAR, playerWear } from '../../data/hullWear.js';   // weathering of the hull shown at the quay
import { ZONE_TEXT } from '../../data/seaZones.js';   // sea tiers: class at the shipyard, sea tier of the missions
import { hashString } from '../../core/rng.js';
import { fmtInt, nationAdj, nationPeople, nationName, shipType } from '../../core/i18n.js';
import { SPECIALISTS, SPECIALIST_IDS, ITEM_IDS, TREASURE, retireTrade } from '../../data/fortune.js';
import { itemName, itemEffect } from '../../game/fortune.js';
import { health, scoreBreakdown } from '../../game/retirement.js';
import { relation } from '../../combat/factions.js';
import { ensureFleet, FLEET, crewMaxOf, holdCapOf, holdUsedOf, salePrice, repairCost } from '../../game/fleet.js';   // squadron

const LOCS = [
  ['market', 'Market', 'Buy and sell'],
  ['tavern', 'Tavern', 'Crew, rum and rumours'],
  ['shipyard', 'Shipyard', 'Repairs, refits, ships'],
  ['governor', 'Governor', 'Ranks and missions'],
  ['bank', 'Counting house', 'Accounts and plunder'],
];
const TYPE_NAMES = new Proxy({}, { get: (_, k) => shipType(k) });
const theGood = id => GOODS[id].name.toLowerCase();
const yourShip = ty => `your ${(TYPE_NAMES[ty] || 'ship').toLowerCase()}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => fmtInt(n);
const coin = `<i class="coin">${ICONS.gold}</i>`;
const BULLET = `<svg viewBox="0 0 24 24" class="fleur" aria-hidden="true"><path d="M12 2 C14 6 14 9 12 12 C10 9 10 6 12 2Z M12 12 C16 9 21 10 21 14 C18 12.5 15 13 12 15 Z M12 12 C8 9 3 10 3 14 C6 12.5 9 13 12 15 Z M9 17 H15 M12 15 V22" fill="currentColor" stroke="currentColor" stroke-width="0.8"/></svg>`;

// deterministic names per port
const pickH = (seed, arr) => arr[(hashString(seed) >>> 0) % arr.length];
const TITLES = { english: 'Sir', spanish: 'Don', french: 'Monsieur', dutch: 'Mijnheer', pirate: 'Master' };
const SURN = { english: ['Ashcombe', 'Pell', 'Hawtrey', 'Blackmore'], spanish: ['Esteban de Lara', 'Rodrigo Ibarra', 'Alonso de Vela', 'Tomás Cardona'], french: ['de Brissac', 'Lavergne', 'du Plessis', 'Tessier'], dutch: ['van Hoorn', 'de Wit', 'Brouwer', 'van Dam'], pirate: ['Mother Quill', 'Saltmarsh', 'Grimsby'] };
const INNS = ['the Drowned Lantern', 'the Golden Gull', 'the Salt and Anchor', 'the Crooked Mast', 'the Blue Parrot', 'the Three Barrels', 'the Weeping Mermaid'];
const KEEP = ['Barnaby', 'old Joaquín', 'Hendrik', 'Marguerite', 'One-eyed Tam', 'big Pepa'];

export class PortScreen {
  constructor(game, sys) {
    this.game = game; this.sys = sys;
    this.isOpen = false; this.tab = 'harbour'; this.sel = null;
    const el = this.el = document.createElement('div');
    el.className = 'port-layer';
    el.innerHTML = `<div class="port-shade"></div><div class="port-frame"></div><div class="ptoasts" aria-live="polite"></div><div class="port-fade"></div>`;
    this.toasts = el.querySelector('.ptoasts');
    this.mi = 0;   // selected market row (keyboard)
    // action feedback: the HUD is hidden ashore, so port notifications land on a slip pinned over the sheet
    game.events.on('notify', d => { if (this.isOpen) this.toast(d?.text ?? String(d), d?.kind || 'info'); });
    game.events.on('trade', d => {
      if (!this.isOpen || !d || !GOODS[d.good]) return;
      this._flash = d.good;
      const tot = d.qty * d.price, nm = GOODS[d.good].name.toLowerCase();
      // consecutive trades of the same good on the same side merge into one slip (no stack of “1 × tobacco”)
      const L = this._lastTrade, now = performance.now();
      const T = (L && L.good === d.good && L.side === d.side && now - L.t < 2500 && L.el?.isConnected) ? L : null;
      const acc = T || { good: d.good, side: d.side, qty: 0, tot: 0, profit: 0 };
      acc.qty += d.qty; acc.tot += tot; acc.profit += d.profit || 0; acc.t = now;
      const text = d.side === 'buy' ? `Bought: ${acc.qty} × ${nm} · −${fmt(acc.tot)}` : `Sold: ${acc.qty} × ${nm} · +${fmt(acc.tot)}${acc.profit ? ` (margin ${acc.profit > 0 ? '+' : '−'}${fmt(Math.abs(acc.profit))})` : ''}`;
      if (T) { T.el.textContent = text; T.el.classList.remove('out'); clearTimeout(T.t1); clearTimeout(T.t2); T.t1 = setTimeout(() => T.el.classList.add('out'), 2600); T.t2 = setTimeout(() => T.el.remove(), 3200); }
      else { acc.el = this.toast(text, d.side === 'buy' ? 'spend' : 'good'); acc.t1 = acc.el?._t1; acc.t2 = acc.el?._t2; this._lastTrade = acc; }
    });
    addEventListener('keydown', e => this._keys(e));
    game.uiRoot.appendChild(el);
    this.frame = el.querySelector('.port-frame');
    this.fadeEl = el.querySelector('.port-fade');
    el.addEventListener('click', e => this._click(e));
    // right click on a market button = the big step (buy ten / sell everything)
    el.addEventListener('contextmenu', e => { const b = e.target.closest?.('.pb'); if (!b) return; e.preventDefault(); this._click({ target: b, shiftKey: true }); });
    el.addEventListener('mouseover', e => {
      const b = e.target.closest?.('button'); if (b && !b.disabled && b !== this._hov) { this._hov = b; game.audio?.play?.('ui:hover'); }
    });
  }

  open(port, tab) {
    this.port = port; this.isOpen = true; this.tab = tab || 'harbour'; this.sel = null; this.fleetSel = null; this.xferSel = null; this._sellArm = null;
    this.el.classList.add('show');
    this.render();
  }
  close() { this.isOpen = false; this.el.classList.remove('show'); }

  fadeThrough(fn) {
    const f = this.fadeEl;
    f.classList.add('on');
    // fn may return a promise (compiled set, ports.goto): the fade lifts once it resolves
    setTimeout(() => { Promise.resolve(fn()).then(() => requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')))); }, 280);
  }

  render() {
    if (!this.isOpen) return;
    const scroll = this.frame.querySelector('.pcol-body')?.scrollTop || 0;
    this.el.dataset.tab = this.tab;
    const fk0 = document.activeElement && this.frame.contains(document.activeElement) ? document.activeElement.dataset.fk : null;
    this.frame.innerHTML = this.tab === 'harbour' ? this._landing() : this._location();
    for (const bt of this.frame.querySelectorAll('button:not([data-fk])')) { const d = bt.dataset; bt.dataset.fk = [d.tab, d.act, d.n, d.part, d.k, d.id, d.ship, d.type].filter(Boolean).join('-'); }
    const fk = fk0;
    const b = this.frame.querySelector('.pcol-body'); if (b) b.scrollTop = scroll;
    if (fk) this.frame.querySelector(`[data-fk="${fk}"]`)?.focus({ preventScroll: true });
    if (this._flash) { this.frame.querySelector(`.mrow[data-g="${this._flash}"]`)?.classList.add('flash'); this._flash = null; }
    if (this.tab === 'shipyard') this._syncYard();
  }

  // the ship shown at the quay of the shipyard stage follows the panel — a type picked on the slipway
  // (new, intact), a ship of the squadron (its own damage) or the flagship (its damage, after refit/purchase).
  _yardShip() {
    const g = this.game, pl = g.player, st = g.state;
    const f = this.fleetSel != null ? st.fleet?.[this.fleetSel] : null;
    if (f) return { type: f.type, faction: pl?.faction, name: f.name, damage: { hull: 1 - (f.hull ?? 1), sails: 1 - (f.sails ?? 1) }, wear: HULL_WEAR.base };
    const sel = this.sel && SHIP_SPECS[this.sel] ? this.sel : pl?.type;
    if (!pl || sel !== pl.type) return { type: sel || 'brig', faction: pl?.faction, name: '', damage: { hull: 0, sails: 0 }, wear: HULL_WEAR.yardNew };
    return { type: pl.type, faction: pl.faction, name: pl.name, damage: { hull: 1 - pl.hull / pl.hullMax, sails: 1 - pl.sails }, wear: playerWear(st) };
  }
  _syncYard() {
    const S = this.sys.stage, sc = S?.kind === 'shipyard' ? S.cur : null;
    if (!sc?.setShip || this.sys.locked(this.port, 'shipyard')) return;
    // free screen area beside the parchment column and above the dialogue, so the cards never cover the ship
    const W = innerWidth || 1, H = innerHeight || 1, R = q => this.frame.querySelector(q)?.getBoundingClientRect();
    const pc = R('.pcol'), cap = R('.caption'), top = R('.loctop');
    sc.setView?.({ x0: 0.025, x1: pc?.width ? pc.left / W - 0.025 : 0.6, y0: top?.height ? top.bottom / H + 0.015 : 0.13, y1: cap?.height ? cap.top / H - 0.02 : 0.8 });
    const w = this._yardShip();
    sc.setShip(w.type, w);
  }

  // ================= landing =================
  _landing() {
    const p = this.port, s = this.sys, att = s.attitude(p), wealth = s.wealth(p);
    return `
      <div class="townhead">
        <div class="bigflag"><span class="pole"></span>${flagSVG(p.faction, { w: 120, h: 80 })}</div>
        <div><div class="pre">${p.haven ? 'A haven of the Brethren of the Coast' : `${p.size === 'large' ? 'A great' : p.size === 'small' ? 'A modest' : 'A thriving'} ${nationAdj(p.faction)} colony`}</div>
        <h1 class="townname">${esc(p.name)}</h1></div>
      </div>
      <nav class="bigmenu">
        ${LOCS.map(([id, t, d], i) => { const lk = s.locked(p, id); return `<button class="bm${lk ? ' locked' : ''}" data-tab="${id}" data-fk="m${id}">${BULLET}<span class="t">${t}</span><span class="key">${i + 1}</span><span class="d">${lk || d}</span></button>`; }).join('')}
        <button class="bm leave" data-act="leave" data-fk="mleave">${GLYPH.anchor}<span class="t">Weigh anchor</span><span class="key">Esc</span><span class="d">Put to sea again</span></button>
      </nav>
      <aside class="report tof-parch">
        <h3>Harbour report</h3>
        <div class="kv"><span>Governor</span><b class="att ${att.cls}">${att.label}</b></div>
        <div class="kv"><span>Souls</span><b>${fmt(p.population || 0)}</b></div>
        ${this.game.living ? `<div class="kv"><span>Garrison</span><b>${(t => t > 65 ? 'strong' : t > 40 ? 'ordinary' : t > 20 ? 'thin' : 'next to none')(this.game.living.town(p).garrison)}</b></div>${this.game.living.townNote(p) ? `<div class="kv"><span>News</span><b>${this.game.living.townNote(p)}</b></div>` : ''}` : ''}
        <div class="kv"><span>Wealth</span><b>${'<i class="dub"></i>'.repeat(wealth)}${'<i class="dub off"></i>'.repeat(5 - wealth)}</b></div>
        ${this._repBar(p.haven ? 'pirate' : p.faction)}
        ${this._purse()}
      </aside>
      ${this._caption(null, this._lines().harbour)}`;
  }

  _purse() {
    const g = this.game, st = g.state, used = holdUsed(g), cap = holdCapacity(g), p = g.player;
    const mor = Math.round(st.morale ?? 70);
    const morLbl = mor > 80 ? 'Exultant' : mor > 60 ? 'Content' : mor > 40 ? 'Restless' : mor > 20 ? 'Sullen' : 'Mutinous';
    return `<div class="purse">
      <div class="pg">${coin}<b>${fmt(st.gold)}</b></div>
      <div class="pi">${GLYPH.hold}<b>${used}/${cap}</b><span>hold</span></div>
      <div class="pi">${GLYPH.food}<b>${st.food}</b><span>provisions</span></div>
      <div class="pi">${GLYPH.crew}<b>${p?.crew ?? st.crew}</b><span>men</span></div>
      <div class="pi ${mor < 35 ? 'warn' : ''}">${GLYPH.morale}<b>${morLbl}</b><span>morale</span></div>
      <div class="pdate">${formatDate(st.date)} · Captain ${esc(st.name)}, ${st.age} years old</div>
    </div>`;
  }

  // ================= location =================
  _location() {
    const loc = LOCS.find(l => l[0] === this.tab) || LOCS[0];
    const lines = this._lines();
    const lock = this.sys.locked(this.port, this.tab);
    return `
      <div class="loctop">
        <div class="locname"><span class="flagmini">${flagSVG(this.port.faction, { w: 48, h: 32 })}</span><span class="tn">${esc(this.port.name)}</span><span class="sep">·</span><span class="ln">${loc[1]}</span></div>
        <nav class="loclinks">
          <button class="ll" data-tab="harbour">${GLYPH.anchor}Harbour<span class="k">Esc</span></button>
          ${LOCS.map(([id, t], i) => `<button class="ll${id === this.tab ? ' sel' : ''}" data-tab="${id}">${t}<span class="k">${i + 1}</span></button>`).join('')}
        </nav>
      </div>
      <section class="pcol tof-parch">
        <div class="pcol-body">${lock ? (this.tab === 'governor' && this.sys.amnestyNeeded(this.port) ? this._amnesty() : this._refused(lock)) : this._tab()}</div>
        <div class="pcol-foot">${this._purse()}<div class="khint"><span class="kc">↑</span><span class="kc">↓</span> choose · <span class="kc">Enter</span> confirm${this.tab === 'market' ? ' · <span class="kc">→</span> buy <span class="kc">←</span> sell (<span class="kc">Shift</span> ×10 / all)' : ''} · <span class="kc">Esc</span> back</div></div>
      </section>
      ${lock ? this._caption('The guard', 'Be on your way, before the governor has you clapped in irons.', 'guard') : this._caption(lines[this.tab]?.who, lines[this.tab]?.text, this.tab === 'governor' && this.port.haven ? 'council' : this.tab === 'tavern' && /Marguerite|Pepa/.test(pickH(this.port.id + 'k', KEEP)) ? 'tavernw' : this.tab)}`;
  }

  _caption(who, text, role) {
    if (!text) return '';
    const seed = role ? hashString(this.port.id + role) : 0;
    const face = role ? `<div class="spk">${PORTRAIT(role, seed, { img: portraitURL(this.game, role, seed, this.port.faction) })}</div>` : '';
    return `<div class="caption${face ? ' has-spk' : ''}">${face}<div class="ctext">${who ? `<div class="who">${esc(who)}</div>` : ''}<p>${text}</p></div></div>`;
  }

  _lines() {
    const g = this.game, p = this.port, st = g.state, pl = g.player, s = this.sys;
    const nat = p.faction, inn = pickH(p.id + 'inn', INNS), keep = pickH(p.id + 'k', KEEP);
    const qs = Object.keys(GOODS).filter(k => k !== 'food').map(k => ({ k, q: quote(g, p, k) }));
    const cheap = qs.slice().sort((a, b) => a.q.buy / a.q.base - b.q.buy / b.q.base)[0];
    const dear = qs.slice().sort((a, b) => b.q.sell / b.q.base - a.q.sell / a.q.base)[0];
    const hull = pl ? Math.round(pl.hull / pl.hullMax * 100) : 100;
    const rec = s.recruitOffer(p);
    const gov = `${TITLES[nat] || 'His Excellency'} ${pickH(p.id + 'gov', SURN[nat] || SURN.english)}`;
    const att = s.attitude(p);
    const yard = this._yardLine();
    return {
      harbour: `${esc(p.name)} dozes under the guns of her fort. Bells ring at the church, gulls wheel above the quay and the market hums with trade. Where will you go, captain?`,
      market: { who: 'The merchant', text: `“${(s => s[0].toUpperCase() + s.slice(1))(theGood(cheap.k))} is worth next to nothing this week, captain: ${cheap.q.buy} gold the ${GOODS[cheap.k].unit}. And I pay a good price for ${theGood(dear.k)}: ${dear.q.sell} gold, no questions asked.”` },
      tavern: { who: `${keep}, keeper of ${inn}`, text: `The great room rings tonight with fiddles and dice. ${rec.avail > 0 ? `${rec.avail} idle sailors eye your coat, looking for a berth` : 'Every able-bodied man in town has already signed on elsewhere'}${st.captures ? `, and all the talk is of the ${st.captures} prizes you have taken` : ''}.` },
      shipyard: yard || { who: 'The master shipwright', text: hull < 95 ? `“${(s => s[0].toUpperCase() + s.slice(1))(yourShip(pl?.type))} has taken a hard beating, captain. She is only ${hull}% sound. Give me a day and the gold it takes, and she will be fit for the King’s fleet.”` : `“Sound as a new penny, ${yourShip(pl?.type)}. Would you like to see what I have on my slipway?”` },
      governor: { who: p.haven ? 'The council of captains' : gov, text: p.haven ? '“No crown here, captain. Bring us prizes and powder, and you will be welcome.”' : att.cls === 'warm' ? `“Captain ${esc(st.name)}! The Crown has no better servant. Sit down, have a glass of madeira, and let us speak of honours.”` : att.cls === 'cold' ? '“You may speak, captain. Briefly.”' : `“Captain. Your name has reached me. Let us see whether it deserves the Crown’s trust.”` },
      bank: { who: 'The clerk', text: `“Your purse holds ${fmt(st.gold)} gold, captain.${st.plunder > 50 ? ` According to the articles, the crew is still owed ${fmt(st.plunder)} gold, and they ask for it every day.` : ' The crew has had its due.'}”` },
    };
  }

  // the master shipwright speaks of the ship shown at the quay (a new type on the slipway, or one of the squadron)
  _yardLine() {
    const pl = this.game.player, st = this.game.state;
    const f = this.fleetSel != null ? st.fleet?.[this.fleetSel] : null;
    if (f) {
      const h = Math.round((f.hull ?? 1) * 100), ty = (TYPE_NAMES[f.type] || 'ship').toLowerCase();
      return { who: 'The master shipwright', text: `“This ${ty}, the <i>${esc(f.name)}</i>? ${h < 95 ? `Only ${h}% sound. I will put her right whenever you wish.` : 'She awaits only your orders.'}”` };
    }
    const sel = this.sel && SHIP_SPECS[this.sel] ? this.sel : null;
    if (!sel || sel === pl?.type) return null;
    const sp = SHIP_SPECS[sel], ty = (TYPE_NAMES[sel] || '').toLowerCase();
    return { who: 'The master shipwright', text: `“Just look at this ${ty}, captain: ${sp.guns} guns and a hold of ${CARGO_CAPACITY[sel]}. Sign, and she is in the water tomorrow.”` };
  }

  _tab() {
    switch (this.tab) {
      case 'market': return this._market();
      case 'tavern': return this._tavern();
      case 'shipyard': return this._shipyard();
      case 'governor': return this._governor();
      case 'bank': return this._bank();
    }
    return '';
  }

  _title(t, lede) {
    const v = VIGNETTE[this.tab] || '';
    return `<div class="stitle${v ? ' has-vig' : ''}">${v}<div class="sth"><h2>${t}</h2>${RULE}${lede ? `<div class="lede">${lede}</div>` : ''}</div></div>`;
  }
  _amnesty() {
    const s = this.sys, n = this.port.faction, c = s.amnestyCost(n), st = this.game.state;
    return `${this._title('The governor’s antechamber', 'The secretary receives you, two soldiers at the door.')}
      <div class="card"><h3>${GLYPH.scroll} Amnesty</h3>
        <p class="ink">“The ${nationPeople(n)} hold you for an enemy, captain. His Excellency can forget your misdeeds, in return for a gift to the Crown.”</p>
        ${this._repBar(n)}
        <div class="btnrow"><button class="btn seal" data-act="amnesty" ${st.gold < c ? 'disabled' : ''}>Buy the amnesty · ${fmt(c)}</button></div></div>`;
  }
  _refused(why) { return `${this._title('Closed doors', why)}<div class="refused">${SEAL('X')}<p>The guard looks your colours up and down and spits on the cobbles.</p></div>`; }

  // ---------------- market ----------------
  // One row per good: icon · name + stock gauge · trend · buy · sell · held (avg paid) · margin per unit.
  _market() {
    const g = this.game, p = this.port, st = g.state;
    const cap = holdCapacity(g), used = holdUsed(g);
    const ids = Object.keys(GOODS);
    this.mi = Math.max(0, Math.min(ids.length - 1, this.mi));
    const rows = ids.map((id, i) => {
      const q = quote(g, p, id), have = id === 'food' ? st.food : st.cargo[id] || 0;
      const paid = avgCost(g, id), gain = have && paid ? q.sell - paid : null;
      const pr = q.buy / q.base;
      const tr = pr < 0.8 ? ['cheap', '▼', 'low'] : pr > 1.25 ? ['dear', '▲', 'high'] : ['even', '◆', 'average'];
      const pct = Math.round((pr - 1) * 100);
      const fill = Math.max(4, Math.min(100, q.stock / Math.max(1, q.eq * 1.6) * 100));
      const canBuy = q.stock > 0 && st.gold >= q.buy && used + GOODS[id].bulk <= cap;
      return `<div class="mrow${have ? ' have' : ''}${i === this.mi ? ' cur' : ''}" data-g="${id}" data-i="${i}" data-fk="r${id}" tabindex="0">
        <span class="gi">${GOOD_ICON(id)}</span>
        <span class="gn"><b>${GOODS[id].name}</b><span class="stk"><i style="width:${fill}%"></i></span><small>${fmt(q.stock)} ${q.stock > 1 ? GOODS[id].unitPl : GOODS[id].unit}</small></span>
        <span class="tr ${tr[0]}" title="Price ${tr[2]}: ${pct > 0 ? '+' : ''}${pct}% of the going rate"><b>${tr[1]}</b><small>${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}%</small></span>
        <button class="pb buy" data-buy="${id}" data-fk="b${id}" tabindex="-1" ${canBuy ? '' : 'disabled'} title="Buy one lot (Shift or right click: ten)"><span class="num">${fmt(q.buy)}</span><span class="chev">+</span></button>
        <button class="pb sell" data-sell="${id}" data-fk="s${id}" tabindex="-1" ${have ? '' : 'disabled'} title="Sell one lot (Shift or right click: all)"><span class="chev">−</span><span class="num">${fmt(q.sell)}</span></button>
        <span class="hv">${have ? `<button class="hvall" data-sell="${id}" data-all="1" tabindex="-1" title="Sell all (${have})"><b>${have}</b><small class="hvt">sell all</small>${paid ? `<small class="hvp">paid ${fmt(Math.round(paid))}</small>` : ''}</button>` : '<span class="nil">—</span>'}</span>
        <span class="mg">${gain !== null ? `<b class="${gain >= 0 ? 'up' : 'dn'}">${gain >= 0 ? '+' : '−'}${fmt(Math.abs(Math.round(gain)))}</b><small>${fmt(Math.abs(Math.round(gain * have)))}</small>` : '<span class="nil">—</span>'}</span>
      </div>`;
    }).join('');
    const pct = Math.min(100, used / cap * 100), profit = st.ledger?.profit || 0;
    return `${this._title('The market')}
      <div class="mstats">
        <div class="ms"><span>${GLYPH.hold} Hold</span><span class="hb${pct > 90 ? ' full' : ''}"><i style="width:${pct}%"></i></span><b>${used} / ${cap}</b></div>
        <div class="ms"><span>${GLYPH.profit} Trading profit</span><b class="${profit >= 0 ? 'up' : 'dn'}">${profit >= 0 ? '+' : '−'}${fmt(Math.abs(profit))}</b></div>
      </div>
      ${this._profile()}
      <div class="mhead"><span></span><span>Goods · stock</span><span>Rate</span><span>Buy</span><span>Sell</span><span>Hold</span><span title="Margin = sale − price paid, per lot and in total">Margin</span></div>
      <div class="mlist">${rows}</div>`;
  }

  // the port's trade profile (most wanted / most plentiful goods, volatile haven prices)
  _profile() {
    const p = this.port, gd = p.goods || {};
    const ids = Object.keys(GOODS).filter(k => k !== 'food' && gd[k]);
    const top = (f) => ids.slice().sort((a, b) => gd[b][f] - gd[a][f]).slice(0, 2).map(k => GOODS[k].name.toLowerCase()).join(', ');
    return `<p class="ink small">Wanted here: <b>${top('demand')}</b> · plentiful: <b>${top('supply')}</b>${p.haven ? ' · haven prices swing a great deal from one week to the next' : ''}.</p>`;
  }

  // ---------------- tavern ----------------
  _tavern() {
    const g = this.game, s = this.sys, p = this.port, pl = g.player;
    const room = pl ? pl.crewMax - pl.crew : 0;
    const rec = s.recruitOffer(p);
    const faces = Math.min(6, rec.avail);
    const SK = ['Topman', 'Gunner', 'Carpenter', 'Boatswain’s mate', 'Able seaman', 'Cook', 'Swordsman', 'Helmsman'];
    return `${this._title('The tavern')}
      <div class="card">
        <h3>${GLYPH.crew} Sign on men</h3>
        <div class="recruits">${Array.from({ length: faces }, (_, i) => `<div class="rec">${this._face(p.id + i)}<span>${pickH(p.id + 's' + i, SK)}</span></div>`).join('')}${rec.avail > faces ? `<div class="rec more">+${rec.avail - faces}</div>` : ''}</div>
        <div class="kv"><span>Sailors ashore</span><b>${rec.avail} / ${rec.cap}</b></div>
        <div class="kv"><span>Bounty per man</span><b>${coin}${rec.cost}</b></div>
        <div class="kv"><span>Free berths aboard</span><b>${Math.max(0, room)} of ${pl?.crewMax ?? 0}</b></div>
        <div class="btnrow"><button class="btn" data-act="hire" data-n="5" ${rec.avail < 1 || room < 1 ? 'disabled' : ''}>Sign on five</button><button class="btn" data-act="hire" data-n="999" ${rec.avail < 1 || room < 1 ? 'disabled' : ''}>Sign on all</button>
          <button class="btn ale" data-act="round" ${g.state.gold < s.roundCost() ? 'disabled' : ''}>${GLYPH.mug} Buy a round · ${s.roundCost()}</button></div>
      </div>
      <div class="card board">
        <h3>${GLYPH.rumor} Gossip by the fire</h3>
        ${s.rumours(p).map(r => `<blockquote><p>${r.text}</p><cite>${r.who}</cite></blockquote>`).join('')}
      </div>${this._waitress()}${this._smuggler()}${this._traveler()}`;
  }

  // the serving girl's tips (rich ships really at sea nearby; one more after a round)
  _waitress() {
    const lv = this.game.living; if (!lv) return '';
    return `<div class="card board"><h3>${GLYPH.mug} The barmaid’s tips</h3>
      ${lv.tips(this.port, 1 + Math.min(1, this.game.state.extraRumour || 0)).map(r => `<blockquote><p>${r.text}</p><cite>${r.who}</cite></blockquote>`).join('')}</div>`;
  }
  // smuggling in poor towns whose market is closed to you
  _smuggler() {
    const lv = this.game.living, p = this.port, st = this.game.state;
    if (!lv?.contrabandHere(p)) return '';
    const goods = Object.keys(st.cargo || {}).filter(k => st.cargo[k] > 0);
    return `<div class="card"><h3>${GLYPH.hold} The smuggler</h3>
      <p class="ink">In the back room, a man with no name buys what the market refuses you, at his own prices.</p>
      ${goods.length ? goods.map(k => `<div class="up"><span class="uico">${GOOD_ICON(k)}</span><span class="ut">${GOODS[k].name}<em>${st.cargo[k]} in the hold · ${fmt(lv.contrabandPrice(p, k))} gold a lot</em></span><span class="pips"></span><button class="btn sm" data-act="smuggle" data-k="${k}">Sell all</button></div>`).join('') : '<p class="ink small">Your hold is empty.</p>'}</div>`;
  }

  // the mysterious traveller (random stock per week and town; src/game/fortune.js)
  _traveler() {
    const g = this.game, fo = g.fortune, p = this.port, st = g.state;
    if (!fo) return '';
    if (!fo.travelerHere(p)) return `<div class="card"><h3>${GLYPH.scroll} The dark corner</h3><p class="ink">The back table is empty this week. They say a traveller in a grey cloak sometimes passes through.</p></div>`;
    const stock = fo.travelerStock(p);
    return `<div class="card">
      <h3>${GLYPH.scroll} A mysterious traveller</h3>
      <p class="ink">At the back of the room, a man in a grey cloak unpacks strange things on a velvet cloth.</p>
      ${stock.map((o, i) => { const own = o.kind === 'item' && fo.item(o.cat) >= o.lvl;
        const nm = o.kind === 'map' ? `Piece of a treasure map` : itemName(o.cat, o.lvl), ds = o.kind === 'map' ? `${st.treasure?.pieces || 0} of ${TREASURE.pieces} in your possession` : itemEffect(o.cat, o.lvl);
        return `<div class="up"><span class="uico">${o.kind === 'map' ? GLYPH.scroll : GLYPH.hold}</span><span class="ut">${nm}<em>${ds}</em></span><span class="pips"></span><button class="btn sm" data-act="traveler" data-n="${i}" ${o.sold || own || st.gold < o.price || (o.kind === 'map' && (st.treasure?.pieces || 0) >= TREASURE.pieces) ? 'disabled' : ''}>${o.sold ? 'Sold' : own ? 'Better owned' : `${coin}${fmt(o.price)}`}</button></div>`; }).join('')}
    </div>`;
  }

  _face(seed) {
    const h = hashString(String(seed)) >>> 0;
    // characters: small bust painted from a 3D sailor (rendered in a queue, the vector oval meanwhile)
    const nat = this.port?.faction, key = portraitKey('sailor', h, nat);
    const img = url => `<svg viewBox="0 0 40 40" class="face" data-pkey="${key}"><defs><clipPath id="fc${h}"><circle cx="20" cy="20" r="19"/></clipPath></defs><circle cx="20" cy="20" r="19" fill="#3a2a1a"/><image href="${url}" x="-4" y="-2" width="48" height="48" clip-path="url(#fc${h})"/></svg>`;
    const ready = portraitLazy(this.game, 'sailor', h, nat, img);
    if (ready) return img(ready);
    const skins = ['#e0b090', '#c99272', '#a8704e', '#7a4a30', '#e8c0a0'], hairs = ['#2a1a10', '#4a2a14', '#7a5a30', '#8a8a80', '#1a1410'], hats = ['#8e1b1b', '#2c4a7a', '#1e1612', '#c9a24a', null];
    const sk = skins[h % 5], hr = hairs[(h >> 3) % 5], hat = hats[(h >> 6) % 5], beard = (h >> 9) % 3 === 0;
    return `<svg viewBox="0 0 40 40" class="face" data-pkey="${key}"><circle cx="20" cy="20" r="19" fill="#3a2a1a"/><path d="M6 40 C6 30 12 27 20 27 C28 27 34 30 34 40Z" fill="${['#5a2a1a', '#2c3d5a', '#3e4a2a', '#e8dcc0'][(h >> 11) % 4]}"/>
      <ellipse cx="20" cy="18" rx="8" ry="9.5" fill="${sk}"/><path d="M12 15 C12 7 28 7 28 15 C25 12 15 12 12 15Z" fill="${hr}"/>
      ${beard ? `<path d="M13 19 C14 29 26 29 27 19 C24 24 16 24 13 19Z" fill="${hr}"/>` : ''}<circle cx="16.5" cy="17.5" r="1.1" fill="#140c08"/><circle cx="23.5" cy="17.5" r="1.1" fill="#140c08"/><path d="M17.5 23 Q20 24.5 22.5 23" stroke="#6a2a20" stroke-width="0.9" fill="none"/>
      ${hat ? `<path d="M9 12 C12 4 28 4 31 12 C26 10 14 10 9 12Z" fill="${hat}"/>` : ''}</svg>`;
  }

  // ---------------- shipyard ----------------
  // guns jettisoned at sea (hold, I key) — “Rearm” at the refit (PortSystem.rearm)
  _rearmRow() {
    const g = this.game, pl = g.player, r = this.sys.rearmInfo?.();
    if (!pl || !r || r.lost <= 0) return '';
    const max = pl.spec?.guns || pl.guns, pct = Math.round(pl.guns / Math.max(1, max) * 100);
    return `<div class="cond" title="Guns thrown into the sea: ${r.lost} of ${max}"><span>Guns</span><span class="cb"><i class="hull" style="width:${pct}%"></i></span><b class="dn">${pl.guns}/${max}</b><button class="btn sm" data-act="rearm" ${!r.free && g.state.gold < r.unit * 2 ? 'disabled' : ''}>${r.free ? 'Free' : `${coin}${fmt(r.cost)}`}</button></div>`;
  }

  _shipyard() {
    const g = this.game, s = this.sys, pl = g.player, st = g.state;
    const rep = s.repairCost(), ups = s.upgrades();
    const sel = this.sel && SHIP_SPECS[this.sel] ? this.sel : pl?.type;
    const spec = SHIP_SPECS[sel], trade = s.shipTradeIn();
    const price = sel === pl?.type ? 0 : s.shipPrice(sel);
    const hullPct = pl ? Math.round(pl.hull / pl.hullMax * 100) : 100, sailPct = pl ? Math.round(pl.sails * 100) : 100;
    const UPI = { guns: ICONS.cannon, hull: ICONS.hull, hold: GLYPH.hold, sheath: ICONS.navigation, canvas: ICONS.sails, berths: GLYPH.crew };
    return `${this._title('The shipyard')}
      <div class="card">
        <h3>${GLYPH.hammer} Repairs to the <i>${esc(pl?.name || 'ship')}</i></h3>
        <div class="cond"><span>Hull</span><span class="cb"><i class="hull" style="width:${hullPct}%"></i></span><b class="${hullPct < 70 ? 'dn' : ''}">${hullPct}%</b><button class="btn sm" data-act="repair" data-part="hull" ${rep.hull <= 0 && !(rep.free && pl && pl.hull < pl.hullMax) ? 'disabled' : ''}>${rep.free && pl && pl.hull < pl.hullMax ? 'Free' : rep.hull > 0 ? `${coin}${fmt(rep.hull)}` : 'Sound'}</button></div>
        <div class="cond"><span>Sails</span><span class="cb"><i class="sails" style="width:${sailPct}%"></i></span><b class="${sailPct < 70 ? 'dn' : ''}">${sailPct}%</b><button class="btn sm" data-act="repair" data-part="sails" ${rep.sails <= 0 && !(rep.free && pl && pl.sails < 1) ? 'disabled' : ''}>${rep.free && pl && pl.sails < 1 ? 'Free' : rep.sails > 0 ? `${coin}${fmt(rep.sails)}` : 'Intact'}</button></div>
        ${this._rearmRow()}
      </div>
      <div class="card">
        <h3>${ICONS.cannon} Refits</h3>
        ${ups.map(u => `<div class="up"><span class="uico">${UPI[u.id]}</span><span class="ut">${u.name}<em>${u.desc}</em></span><span class="pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < u.level ? 'on' : ''}"></i>`).join('')}</span><button class="btn sm" data-act="upgrade" data-k="${u.id}" ${u.level >= u.max || st.gold < u.cost ? 'disabled' : ''}>${u.level >= u.max ? 'At best' : `${coin}${fmt(u.cost)}`}</button></div>`).join('')}
      </div>
      ${s.ammoLocked('chain') || s.ammoLocked('grape') ? `<div class="card">
        <h3>${ICONS.cannon} Special shot</h3>
        ${[['chain', 'Chain shot', 'Cuts sails and rigging, shorter range'], ['grape', 'Grapeshot', 'Sweeps the decks before boarding, short range']].filter(([k]) => s.ammoLocked(k)).map(([k, n, d]) => `<div class="up"><span class="uico">${ICONS[k] || ICONS.cannon}</span><span class="ut">${n}<em>${d}</em></span><span class="pips"></span><button class="btn sm" data-act="buyammo" data-k="${k}" ${st.gold < s.ammoPrice(k) ? 'disabled' : ''}>${coin}${fmt(s.ammoPrice(k))}</button></div>`).join('')}
      </div>` : ''}
      <div class="card">
        <h3>${GLYPH.anchor} Ships on the slipway</h3>
        <div class="shiptabs">${yardTypes(this.port, pl?.type).map(t => `<button class="stype${t === sel && this.fleetSel == null ? ' sel' : ''}${t === pl?.type ? ' own' : ''}" data-ship="${t}">${TYPE_NAMES[t]}</button>`).join('')}</div>
        ${sel !== pl?.type && this.fleetSel == null ? `<div class="oncale"><b>On the slipway</b><span>A new ${TYPE_NAMES[sel].toLowerCase()}, at the quay for a look · <span class="kc">⚓</span> your ship</span></div>` : ''}
        <div class="shiprow"><div class="shipview">${SHIP_SIL(sel)}</div>
        <div class="specs">${(() => { const o = SHIP_SPECS[pl?.type] || spec, own = sel === pl?.type;
          const d = (a, b, inv) => own || a === b ? '' : `<em class="${(a > b) !== !!inv ? 'up' : 'dn'}">${a > b ? '+' : '−'}${String(+Math.abs(a - b).toFixed(1))}</em>`;
          const kn = x => Math.round(x * 1.944);
          return `<div class="cls"><span>Class</span><b title="Power class (guns and hull): in guarded waters, pirates stay a match for you; in perilous seas, nothing holds them back">${CLASS_NAMES[classOf(sel) - 1]}${own || classOf(sel) === classOf(pl?.type) ? '' : `<em class="${classOf(sel) > classOf(pl?.type) ? 'up' : 'dn'}">${classOf(sel) > classOf(pl?.type) ? '+' : '−'}${Math.abs(classOf(sel) - classOf(pl?.type))}</em>`}</b></div>` + [['Guns', spec.guns, o.guns], ['Hull', spec.hull, o.hull], ['Crew', spec.crewMax, o.crewMax], ['Hold', CARGO_CAPACITY[sel], CARGO_CAPACITY[pl?.type] ?? CARGO_CAPACITY[sel]], ['Speed', kn(spec.maxSpeed), kn(o.maxSpeed), ' knots'], ['Draught', spec.navDraft ?? spec.draft, o.navDraft ?? o.draft, ' m', true]]
            .map(([l, a, b, u, inv]) => `<div><span>${l}</span><b>${String(a)}${u || ''}${d(a, b, inv)}</b></div>`).join('')
            + `<div><span>Rig</span><b>${{ square: 'square', 'fore-aft': 'fore-and-aft', mixed: 'mixed' }[SHIP_TYPES[sel]?.rig] || '—'}</b></div>`; })()}</div></div>
        ${sel === pl?.type ? `<div class="own-note">${(s => s[0].toUpperCase() + s.slice(1))(yourShip(sel))}, taken in part exchange for ${coin}${fmt(trade)}.</div>`
          : `<div class="buyship"><span>${coin}${fmt(SHIP_PRICES[sel])} less part exchange ${fmt(trade)}</span><button class="btn seal" data-act="buyship" data-type="${sel}" ${st.gold < price ? 'disabled' : ''}>${price >= 0 ? `Buy · ${fmt(price)}` : `Exchange · +${fmt(-price)}`}</button></div>`}
      </div>
      ${this._fleet()}`;
  }

  // ---------------- squadron (2026-10-22; logic: src/game/fleet.js, actions: PortSystem.fleet*) ----------------
  _fleet() {
    const g = this.game, st = g.state, s = this.sys;
    const fl = ensureFleet(st), rk = s._repairMul();
    const head = `<h3>${GLYPH.anchor} Your squadron <span class="fl-n">${fl.length} / ${FLEET.max}</span></h3>`;
    if (!fl.length) return `<div class="card fleet">${head}<p class="ink small">No prize at anchor. Keep a ship taken by boarding and she will join your squadron.</p></div>`;
    const rows = fl.map((f, i) => {
      const sel = this.fleetSel === i, h = Math.round(f.hull * 100), sl = Math.round((f.sails ?? 1) * 100);
      const cm = crewMaxOf(f.type, f.upgrades), cap = holdCapOf(f.type, f.upgrades), used = holdUsedOf(f);
      const goods = Object.entries(f.cargo || {}).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]);
      const cargoTxt = goods.length ? goods.slice(0, 4).map(([k, q]) => `${GOODS[k].name.toLowerCase()} ${fmt(q)}`).join(' · ') + (goods.length > 4 ? ' …' : '') : 'empty hold';
      const cargoV = goods.reduce((a, [k, q]) => a + Math.round(q * quote(g, this.port, k).sell * FLEET.cargoK), 0), total = salePrice(f) + cargoV;
      const rc = repairCost(f, rk), rtot = rc.hull + rc.sails, dmg = f.hull < 1 || (f.sails ?? 1) < 1;
      const ups = Object.values(f.upgrades || {}).reduce((a, v) => a + (v || 0), 0);
      return `<div class="fl-row${sel ? ' sel' : ''}" data-fleet="${i}">
        <button class="fl-pick" data-act="fl-pick" data-n="${i}" title="${sel ? 'See your flagship at the quay again' : 'See this ship at the quay'}"><b><i>${esc(f.name)}</i></b><span>${TYPE_NAMES[f.type]}${f.own ? ' · your former flagship' : f.from ? ` · taken from ${f.from === 'pirate' ? 'the pirates' : `the ${nationPeople(f.from)}`}` : ''}${ups ? ` · ${ups} refit${ups > 1 ? 's' : ''}` : ''}</span></button>
        <div class="fl-stats"><span>Hull <b class="${h < 70 ? 'dn' : ''}">${h}%</b></span><span>Sails <b class="${sl < 70 ? 'dn' : ''}">${sl}%</b></span><span>Men <b>${f.crew}/${cm}</b></span><span>Hold <b>${used}/${cap}</b></span></div>
        <div class="fl-cargo">${cargoTxt}</div>
        <div class="fl-acts">
          <button class="btn sm${this._sellArm === i ? ' seal' : ''}" data-act="fl-sell" data-n="${i}" title="The yard buys the ship according to her condition, and her cargo at ${Math.round(FLEET.cargoK * 100)}% of the going rate">${this._sellArm === i ? 'Confirm' : 'Sell'} · ${coin}${fmt(total)}</button>
          <button class="btn sm" data-act="fl-repair" data-n="${i}" ${!dmg || (!rc.free && st.gold <= 0) ? 'disabled' : ''}>${!dmg ? 'Sound' : rc.free ? 'Free repairs' : `Repair · ${coin}${fmt(rtot)}`}</button>
          <button class="btn sm" data-act="fl-flag" data-n="${i}" title="Your current ship joins the squadron with her refits; men and cargo move aboard as far as there is room">Flagship</button>
          <button class="btn sm${this.xferSel === i ? ' on' : ''}" data-act="fl-xfer" data-n="${i}">${this.xferSel === i ? 'Close' : 'Transfer'}</button>
        </div>
        ${this.xferSel === i ? this._fleetXfer(i) : ''}
      </div>`;
    }).join('');
    return `<div class="card fleet">${head}<p class="ink small">Your prizes wait at anchor, guarded by a few men. Choose one to see her at the quay.</p>${rows}</div>`;
  }
  _fleetXfer(i) {
    const g = this.game, st = g.state, pl = g.player, f = st.fleet[i];
    if (!f || !pl) return '';
    const flagCap = holdCapacity(g), flagUsed = holdUsed(g), cap = holdCapOf(f.type, f.upgrades), used = holdUsedOf(f);
    const a = k => k === 'men' ? Math.round(pl.crew) : k === 'food' ? st.food || 0 : st.cargo?.[k] || 0, b = k => k === 'men' ? f.crew : f.cargo?.[k] || 0;
    const dens = k => (GOODS[k]?.basePrice || 0) / (GOODS[k]?.bulk || 1);
    const ks = [...new Set([...Object.keys(st.cargo || {}), ...(st.food > 0 ? ['food'] : []), ...Object.keys(f.cargo || {})])].filter(k => GOODS[k] && (a(k) > 0 || b(k) > 0))
      .sort((x, y) => (x === 'food') - (y === 'food') || dens(y) - dens(x));
    const btn = (k, dir, q, lbl, t) => `<button class="fl-b" data-act="fl-mv" data-n="${i}" data-k="${k}" data-dir="${dir}" data-q="${q}" data-fk="mv${i}-${k}-${dir}-${q}" title="${t}" ${(dir === 'in' ? b(k) : a(k)) > 0 ? '' : 'disabled'}>${lbl}</button>`;
    const row = (k, ico, name) => `<div class="fl-xr"><span class="g">${ico}<span>${name}</span></span><b>${a(k) ? fmt(a(k)) : '—'}</b><span class="mv">${btn(k, 'in', 1e9, '«', 'All to the flagship')}${btn(k, 'in', 10, '‹10', 'Ten to the flagship')}${btn(k, 'in', 1, '‹', 'One to the flagship')}<s></s>${btn(k, 'out', 1, '›', 'One to ' + f.name)}${btn(k, 'out', 10, '10›', 'Ten to ' + f.name)}${btn(k, 'out', 1e9, '»', 'All to ' + f.name)}</span><b>${b(k) ? fmt(b(k)) : '—'}</b></div>`;
    return `<div class="fl-x">
      <div class="fl-xh"><span>‹ ${esc(pl.name)}<em>hold ${flagUsed}/${flagCap}</em></span><span><em>hold ${used}/${cap}</em>${esc(f.name)} ›</span></div>
      ${row('men', GLYPH.crew, 'Men')}
      ${ks.map(k => row(k, GOOD_ICON(k), GOODS[k].name)).join('')}
      ${ks.length ? '' : '<p class="ink small">Both holds are empty.</p>'}
      <p class="ink small">The flagship keeps at least ${FLEET.minFlagCrew} men; each hold has its limit.</p>
    </div>`;
  }

  // ---------------- governor ----------------
  _governor() {
    const g = this.game, s = this.sys, p = this.port, st = g.state, c = s.career;
    const nations = `<div class="nations">${NATIONS.map(n => { const v = Math.round(s.rep(n)); return `<div class="nat">${flagSVG(n, { w: 36, h: 24 })}<span class="nb"><i style="left:${(v + 100) / 2}%"></i></span><b class="${v < 0 ? 'dn' : ''}">${v > 0 ? '+' : ''}${v}</b><em>${RANKS[st.rank[n] || 0]}</em></div>`; }).join('')}</div>`;
    if (p.haven) {
      return `${this._title('The council of the Brethren of the Coast')}<div class="card"><h3>${GLYPH.scroll} Reputation</h3>${this._repBar('pirate')}${nations}</div><div class="card">${this._missionList()}</div>`;
    }
    const nat = p.faction, r = c.rankOf(nat);
    const offers = c.offerMissions(p);
    const canPromote = r.next && r.merit >= r.need && r.rep >= r.minRep;
    const letter = st.letters[nat];
    const lands = c.acres(nat), allLands = c.acres(), nextGrant = r.next ? c.landGrant(r.idx + 1) : 0;
    const ladder = RANKS.slice(1).map((t, i) => `<li class="${i + 1 <= r.idx ? 'done' : i + 1 === r.idx + 1 ? 'next' : ''}"${c.landGrant(i + 1) ? ` title="Grant of ${fmt(c.landGrant(i + 1))} acres"` : ''}><i></i><span>${t}</span><em>${RANK_MERIT[i + 1]}</em></li>`).join('');
    return `${this._title('The governor’s palace')}
      <div class="card">
        <h3>${GLYPH.scroll} Standing with the ${nationPeople(nat)}</h3>
        <div class="govgrid"><ol class="ladder">${ladder}</ol>
          <div><div class="rankline"><span class="rk">${RANKS[r.idx]}</span></div>${this._repBar(nat, r.need)}
            <div class="kv"><span>Merit</span><b>${r.merit}${r.next ? ' / ' + r.need : ''}</b></div>
            ${PRIVILEGES.filter(v => v.idx <= r.idx).map(v => `<div class="kv"><span>Privilege</span><b>${v.text}</b></div>`).join('')}
            <div class="kv"><span>Lands granted</span><b>${lands ? fmt(lands) + ' acres' : 'none'}${allLands > lands ? ` · ${fmt(allLands)} in all` : ''}</b></div>
            ${nextGrant ? `<div class="kv"><span>At the rank of ${r.next}</span><b>+${fmt(nextGrant)} acres</b></div>` : ''}
            <div class="kv"><span>Letter of marque</span><b>${letter ? 'obtained' : 'none'}</b></div>
            <div class="btnrow"><button class="btn" data-act="promote" ${canPromote ? '' : 'disabled'}>${canPromote ? 'Accept the promotion' : `${!r.next ? 'Highest honour' : r.rep < r.minRep ? 'Reputation too low' : r.next + ' · merit ' + r.need}`}</button>
            ${letter || !s.marqueAvailable(nat) ? '' : `<button class="btn" data-act="marque" ${st.gold < s.marqueCost(nat) ? 'disabled' : ''}>Letter of marque · ${fmt(s.marqueCost(nat))}</button>`}</div></div></div>
        ${nations}
      </div>
      ${this.game.family?.card?.(p) || ''}
      ${this._diplomacy()}
      <div class="card">
        <h3>${SEAL(nationName(nat)[0])} Missions</h3>
        ${offers.length ? offers.map(m => `<div class="mission"><div class="mt">${m.title}${m.tier ? `<span class="mz t${m.tier}" title="${ZONE_TEXT[m.tier].tip}">${ZONE_TEXT[m.tier].tag}</span>` : ''}<span class="rw">${coin}${fmt(m.reward)} · +${m.rep} · ${m.days} days</span></div><p>${m.text}</p><button class="btn sm" data-act="accept" data-id="${m.id}">Accept</button></div>`).join('') : '<p class="ink">No more missions this week.</p>'}
        ${this._missionList(true)}
      </div>
      <div class="card">
        <h3>${GLYPH.anchor} Retire</h3>
        <p class="ink">Hand back your commission and end your days ashore. Your career will be judged on your fortune, your ranks, your lands, your treasures and the pirate captains defeated.</p>
        <div class="kv"><span>Current score</span><b>${fmt(scoreBreakdown(st).total)} · ${retireTrade(scoreBreakdown(st).total).title}</b></div>
        ${allLands ? `<div class="kv"><span>Of which your lands</span><b>${fmt(allLands)} acres · ${fmt(scoreBreakdown(st).rows.find(x => x[0] === 'Lands')?.[2] || 0)} points</b></div>` : ''}
        <div class="btnrow"><button class="btn${this._retireArm ? ' seal' : ''}" data-act="retire">${this._retireArm ? 'Confirm: end your career' : 'Retire'}</button></div>
      </div>`;
  }

  // the governor's state affairs (peace / alliance proposals) and the wars of the day
  _diplomacy() {
    const lv = this.game.living, p = this.port; if (!lv) return '';
    const offers = lv.governorOffers(p);
    const rel = NATIONS.filter(n => n !== p.faction).map(n => { const v = relation(p.faction, n); return `<div class="kv"><span>${nationPeople(n)}</span><b class="${v < 0 ? 'dn' : v > 0 ? 'up' : ''}">${v < 0 ? 'at war' : v > 0 ? 'allies' : 'at peace'}</b></div>`; }).join('');
    return `<div class="card"><h3>${GLYPH.scroll} Affairs of state</h3>${rel}
      ${offers.map(o => `<div class="mission"><div class="mt">${o.title}<span class="rw">${o.reward ? `${coin}${fmt(o.reward)} · ` : ''}${o.days} days</span></div><p>${o.text}</p><button class="btn sm" data-act="diplo" data-k="${o.key}">Carry the letter</button></div>`).join('')}</div>`;
  }

  // missions under way: type (or “to report”), objective (career.missionObjective) and deadline
  _missionList(compact) {
    const g = this.game, c = this.sys.career, act = g.state.missions.filter(m => m.status === 'active');
    if (!act.length) return compact ? '' : '<h3>Missions</h3><p class="ink">You have no mission under way.</p>';
    const d = g.state.date, today = d.year * 372 + d.month * 31 + d.day, NB = '\u202f';
    const KIND = { deliver: 'Dispatches', hunt: 'Hunt', escort: 'Escort', envoy: 'Envoy', transport: 'Transport', quarry: 'Bounty', scout: 'Scouting', rescue: 'Rescue' };
    return `<h4>Your missions</h4>${act.map(m => {
      const left = m.deadline - today;
      const when = m.deadline ? `Before ${g.living ? g.living.dateLabel(m.deadline) : m.deadline} · ${left <= 0 ? '<b class="dn">last day</b>' : left === 1 ? '<b class="dn">1 day left</b>' : `${left}${NB}days left`}` : '';
      return `<div class="mission act"><div class="mt">${m.title}<span class="rw">${m.ready ? 'to report' : KIND[m.kind] || ''}</span></div><p>${c?.missionObjective?.(m) || ''}</p>${when ? `<p>${when}</p>` : ''}</div>`;
    }).join('')}`;
  }

  _repBar(nat, need) {
    const v = this.sys.rep(nat), pos = (v + 100) / 2;
    return `<div class="repbar"><span class="rl">Hated</span><span class="rt"><i class="mid"></i>${need != null ? `<i class="need" style="left:${(need + 100) / 2}%"></i>` : ''}<b style="left:${pos}%"></b></span><span class="rl">Honoured</span><span class="rv">${v > 0 ? '+' : ''}${Math.round(v)}</span></div>`;
  }

  // ---------------- counting house ----------------
  _bank() {
    const g = this.game, st = g.state, c = this.sys.career, L = st.ledger;
    const owed = Math.round(st.plunder || 0);
    const cargoVal = Object.entries(st.cargo).reduce((a, [k, n]) => a + n * quote(g, this.port, k).sell, 0);
    const share = owed && g.player ? Math.round(owed / Math.max(1, g.player.crew)) : 0;
    const bars = [['Purse', st.gold], ['Cargo', cargoVal], ['Owed', owed]];
    const mx = Math.max(1, ...bars.map(b => b[1]));
    return `${this._title('The counting house')}
      <div class="card">
        <h3>${GLYPH.profit} The ship’s accounts</h3>
        <div class="coinbars">${bars.map(([l, v]) => `<div class="cbar"><span class="stack" style="height:${Math.max(4, v / mx * 100)}%"></span><b>${fmt(v)}</b><em>${l}</em></div>`).join('')}</div>
        <div class="kv"><span>Spent at the market</span><b>${fmt(L.spent)}</b></div>
        <div class="kv"><span>Earned at the market</span><b>${fmt(L.earned)}</b></div>
        <div class="kv tot"><span>Trading profit</span><b class="${L.profit >= 0 ? 'up' : 'dn'}">${fmt(L.profit)}</b></div>
        <div class="kv"><span>Prizes taken</span><b>${st.captures || 0}</b></div>
        <div class="kv"><span>Captain’s savings</span><b>${fmt(st.savings || 0)}</b></div>
        <div class="kv"><span>Retirement score</span><b>${c.score()}</b></div>
      </div>
      <div class="card">
        <h3>${coin} Share out the plunder</h3>
        <div class="crewrow">${Array.from({ length: 5 }, (_, i) => this._face('crew' + i)).join('')}<span>${share ? `${coin}${share} per man` : ''}</span></div>
        <p class="ink">${owed > 0 ? `According to the articles, the crew is owed <b>${fmt(owed)}</b> gold. ${st.unpaidDays > 135 ? 'Their impatience is growing dangerous.' : 'They ask for it every day.'}` : 'The crew has had its due. For now.'}</p>
        <p class="small">Sharing out ends the voyage: the cargo is sold, your share (${Math.round(c.captainShare() * 100)}%) goes to your savings, the rest to the men. Morale goes back to the top, many stay ashore and a few months go by. ${st.daysAtSea} days since the last share-out.</p>
        <div class="btnrow"><button class="btn seal" data-act="divide" ${st.gold > 0 || cargoVal > 0 ? '' : 'disabled'}>Share out the plunder</button></div>
      </div>${this._officers()}`;
  }

  // specialists aboard, special items, treasure map, health
  _officers() {
    const g = this.game, st = g.state, fo = g.fortune;
    if (!fo) return '';
    const sp = SPECIALIST_IDS.map(id => `<div class="kv offi${st.specialists?.[id] ? "" : " off"}"><span>${SPECIALISTS[id].name}</span><b>${st.specialists?.[id] ? SPECIALISTS[id].effect : '—'}</b></div>`).join('');
    const it = ITEM_IDS.filter(c => st.items?.[c]).map(c => `<div class="kv"><span>${itemName(c, st.items[c])}</span><b>${itemEffect(c, st.items[c])}</b></div>`).join('') || '<p class="ink">Nothing of value in your chest.</p>';
    const t = st.treasure || {}, h = health(st, fo.fx), tr = retireTrade(scoreBreakdown(st).total);
    return `<div class="card">
        <h3>${GLYPH.crew} Officers aboard · ${SPECIALIST_IDS.filter(id => st.specialists?.[id]).length}/8</h3>${sp}
      </div>
      <div class="card">
        <h3>${GLYPH.hold} Captain’s chest</h3>${it}
        <div class="kv"><span>Treasure map</span><b>${fo.treasureSite() ? 'complete, the mark is on the map' : `${t.pieces || 0} piece${(t.pieces || 0) > 1 ? 's' : ''} of ${TREASURE.pieces}`}</b></div>
        <div class="kv"><span>Treasures dug up</span><b>${t.found || 0}${t.gold ? ` · ${fmt(t.gold)} gold` : ''}</b></div>
        <div class="kv"><span>Captain’s health</span><b class="${h < 35 ? 'dn' : ''}">${h}%</b></div>
        <div class="kv"><span>Expected retirement</span><b>${tr.title}</b></div>
      </div>`;
  }

  // ---------------- feedback & keyboard ----------------
  toast(text, kind = 'info') {
    const t = document.createElement('div');
    t.className = 'ptoast ' + kind; t.textContent = text;
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    t._t1 = setTimeout(() => t.classList.add('out'), 2600);
    t._t2 = setTimeout(() => t.remove(), 3200);
    return t;
  }

  // Arrows walk the sheet (or the landing menu), Enter presses, market rows take →/← (or +/−) to buy/sell.
  // Digits 1-5 and Escape are handled by PortSystem._key. Bound by e.code / e.key, layout-neutral.
  _keys(e) {
    if (!this.isOpen || e.target?.tagName === 'INPUT' || this.game.hud?.menu?.isOpen) return;
    const root = this.tab === 'harbour' ? this.frame.querySelector('.bigmenu') : this.frame.querySelector('.pcol-body');
    if (!root) return;
    const items = [...root.querySelectorAll('.mrow, button:not(:disabled):not([tabindex="-1"])')];
    const cur = document.activeElement && root.contains(document.activeElement) ? document.activeElement.closest('.mrow, button') : null;
    const row = cur?.classList.contains('mrow') ? cur : null;
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      let i = items.indexOf(cur);
      i = i < 0 ? (e.code === 'ArrowDown' ? 0 : items.length - 1) : (i + (e.code === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      const el = items[i]; el.focus(); el.scrollIntoView({ block: 'nearest' });
      if (el.classList.contains('mrow')) { this.mi = +el.dataset.i; root.querySelectorAll('.mrow.cur').forEach(r => r.classList.remove('cur')); el.classList.add('cur'); }
      this.game.audio?.play?.('ui:hover');
      return;
    }
    if (row) {
      const buyK = e.code === 'ArrowRight' || e.key === '+' || e.code === 'NumpadAdd' || e.code === 'Enter';
      const sellK = e.code === 'ArrowLeft' || e.key === '-' || e.code === 'NumpadSubtract' || e.code === 'Backspace';
      if (buyK || sellK) {
        e.preventDefault();
        const bt = row.querySelector(buyK ? '.pb.buy' : '.pb.sell');
        if (bt && !bt.disabled) this._click({ target: bt, shiftKey: e.shiftKey });
        else this.game.audio?.play?.('ui:back');
      }
    }
  }

  // ---------------- input ----------------
  _click(e) {
    const r = e.target.closest?.('.mrow'); if (r) this.mi = +r.dataset.i;
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const a = this.game.audio, s = this.sys;
    a?.play?.('ui:select');
    const sellArm = this._sellArm; this._sellArm = null;   // selling a squadron ship takes two clicks
    if (b.dataset.tab) { if (b.dataset.tab !== this.tab) s.goto(b.dataset.tab); return; }
    const g0 = this.game.state.gold;
    if (b.dataset.buy) s.buy(this.port, b.dataset.buy, e.shiftKey ? 10 : 1);
    else if (b.dataset.sell) s.sell(this.port, b.dataset.sell, (e.shiftKey || b.dataset.all) ? 9999 : 1);
    else if (b.dataset.ship) { this.sel = b.dataset.ship; this.fleetSel = null; }
    else {
      const act = b.dataset.act;
      if (act === 'leave') return s.leave();
      if (act === 'hire') s.hire(this.port, +b.dataset.n);
      if (act === 'round') s.standRound(this.port);
      if (act === 'repair') s.repair(b.dataset.part);
      if (act === 'rearm') s.rearm?.();   // jettisoned guns
      if (act === 'upgrade') s.upgrade(b.dataset.k);
      if (act === 'buyammo') s.buyAmmo(b.dataset.k);
      if (act === 'buyship') s.buyShip(b.dataset.type);
      // squadron: pick = show at the quay (again = back to the flagship), sell (confirm), repair, swap, transfers
      const fn = +b.dataset.n;
      if (act === 'fl-pick') { this.fleetSel = this.fleetSel === fn ? null : fn; this.sel = null; }
      if (act === 'fl-sell') { if (sellArm === fn) { s.fleetSell(fn); this.fleetSel = this.xferSel = null; } else { this._sellArm = fn; this.fleetSel = fn; this.sel = null; } }
      if (act === 'fl-repair') { s.fleetRepair(fn); this.fleetSel = fn; this.sel = null; }
      if (act === 'fl-flag') { s.fleetFlagship(fn); this.fleetSel = this.xferSel = this.sel = null; }
      if (act === 'fl-xfer') { this.xferSel = this.xferSel === fn ? null : fn; this.fleetSel = fn; this.sel = null; }
      if (act === 'fl-mv') { const q = +b.dataset.q * (e.shiftKey && +b.dataset.q === 1 ? 10 : 1); if (b.dataset.k === 'men') s.fleetMen(fn, b.dataset.dir, q); else s.fleetGoods(fn, b.dataset.k, b.dataset.dir, q); }
      if (act === 'promote') s.career.promote(this.port.faction);
      if (act === 'marque') s.buyMarque(this.port.faction);
      if (act === 'accept') { const m = s.career.offerMissions(this.port).find(x => x.id === b.dataset.id); if (m && !s.career.accept(m) && s.career.refusal) this.toast(s.career.refusal, 'bad'); }
      if (act === 'divide') s.career.divide(this.port);
      if (act === 'amnesty') s.buyAmnesty(this.port.faction);
      if (act === 'smuggle') this.game.living?.smuggle(this.port, b.dataset.k);
      if (act === 'diplo') this.game.living?.acceptOffer(this.port, b.dataset.k);
      if (act === 'traveler') this.game.fortune?.buyFromTraveler(this.port, +b.dataset.n);
      if (act?.startsWith('home-')) this.game.family?.act(this.port, act);   // married life: visit, gift
      if (act === 'retire') { if (this._retireArm) { this._retireArm = false; return this.game.retirement?.retire('voluntary'); } this._retireArm = true; }
      else this._retireArm = false;
    }
    this.render();
    // a type picked on the slipway: bring its specs and the purchase line into view (the type grid is long at 1366)
    if (b.dataset.ship) this.frame.querySelector('.buyship, .own-note')?.scrollIntoView?.({ block: 'nearest' });
    const d = this.game.state.gold - g0;
    if (d) { const pg = this.frame.querySelector('.pcol-foot .pg'); if (pg) { pg.classList.add(d > 0 ? 'gain' : 'loss'); pg.dataset.delta = (d > 0 ? '+' : '−') + fmt(Math.abs(d)); } }
  }
}
