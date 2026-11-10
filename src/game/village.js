// game.villages: fishing villages, neutral ports of call open to all (outlaws, nations at war), with neither
// governor nor soldiers. Data: VILLAGES (src/data/world.js, sited in islands.villages), settings and texts
// VILLAGE / VILLAGE_TEXT (src/data/villages.js), styles src/ui/village.css.
//   F within VILLAGE.enterR of the anchorage (shared HUD prompt “Enter …”) → enter(v): mode 'port', time slowed,
//   camera drifting above the beach, the jetty sheet (Radoub, Troc, Hommes, Nouvelles); Escape → leave().
//   Refit: hull up to VILLAGE.repair.hullCap (× a port's price, no privilege), sails to 100 %.
//   Barter: the village market in state.markets[v.id] (src/game/economy.js, pseudo-port villageMarket(v)): local
//   goods cheap, everything else bought back at a low price; the 'trade' event fires as in port (selling a
//   mission cargo = theft, career.js).
//   Men: state.villages[id] = { men, day }; News: ships one class above the player within range, nearby Top 10
//   lairs, sea tier (src/data/seaZones.js).
// Events: 'village:enter' { village }, 'village:leave' { village } (autosave, save.js).
import './../ui/village.css';
import { VILLAGE, VILLAGE_TEXT } from '../data/villages.js';
import { GOODS } from '../data/world.js';
import { ensureMarket, quote, buy, sell, holdUsed, holdCapacity } from './economy.js';
import { isKey } from '../core/keys.js';
import { a, fmtInt, shipDesc } from '../core/i18n.js';
import { threatOf, livePower, ZONE_TEXT } from '../data/seaZones.js';
import { powerClass } from '../data/shipTypes.js';
import { mulberry32 } from '../core/rng.js';
import { ICONS } from '../ui/icons.js';

const NB = ' ';   // between a number and its unit
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const capFirst = t => t[0].toUpperCase() + t.slice(1);
const dayNum = d => d.year * 372 + d.month * 31 + d.day;

// pseudo-port for the market model (economy.js): local goods at VILLAGE.trade.sellK of the price, the rest bought
// back at buyK (the village doesn't sell them: zero equilibrium stock, patched when the market is created)
export function villageMarket(v) {
  const goods = {};
  for (const g in GOODS) {
    const own = v.sells?.includes(g);
    goods[g] = { price: Math.max(1, Math.round(GOODS[g].basePrice * (own ? VILLAGE.trade.sellK : VILLAGE.trade.buyK))), supply: own ? 0.9 : 0, demand: own ? 0.2 : 0.5 };
  }
  return { id: v.id, name: v.name, size: 'small', faction: 'neutral', village: true, goods };
}

export class Villages {
  constructor(game) {
    this.game = game;
    this.isOpen = false; this.village = null;
    this.el = null;
    addEventListener('keydown', e => this._key(e), true);
    game.events.on('notify', d => { if (this.isOpen) this._slip(d?.text ?? String(d), d?.kind || 'info'); });
  }
  get list() { return this.game.islands?.villages || []; }
  nearest(x, z) { return this.game.islands?.nearestVillage?.(x, z) || { village: null, dist: Infinity }; }

  // ---------------- state ----------------
  vstate(v) {
    const st = this.game.state, today = dayNum(st.date);
    st.villages ||= {};
    const r = mulberry32((v.seed || 1) * 7919);
    const [m0, m1] = VILLAGE.men.range, cap = m0 + Math.floor(r() * (m1 - m0 + 1));
    const s = st.villages[v.id] ||= { men: cap, day: today };
    if (today > s.day) { s.men = Math.min(cap, s.men + (today - s.day) * VILLAGE.men.perDay); s.day = today; }
    s.cap = cap;
    return s;
  }
  market(v) {
    const mk = villageMarket(v), m = ensureMarket(this.game, mk), s = this.vstate(v);
    if (!s.mk) { for (const g in m) if (!v.sells?.includes(g)) { m[g].eq = 0; m[g].stock = 0; } s.mk = 1; }
    return mk;
  }

  // ---------------- enter / leave ----------------
  _key(e) {
    const g = this.game;
    if (e.target?.tagName === 'INPUT' || g.hud?.menu?.isOpen) return;
    if (this.isOpen) {
      if (e.code === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); this.leave(); }
      return;
    }
    if (isKey(e, 'f') && g.mode === 'sail' && g.player && !g.ports?.isOpen) {
      const p = g.player.position, nv = this.nearest(p.x, p.z), np = g.islands?.nearestPort?.(p.x, p.z);
      if (nv.village && nv.dist < VILLAGE.enterR && !(np?.port && np.dist < nv.dist)) { e.stopImmediatePropagation(); this.enter(nv.village); }
    }
  }

  enter(v) {
    const g = this.game;
    if (this.isOpen || !v) return;
    this.isOpen = true; this.village = v;
    const from = g.mode; g.mode = 'port';
    if (from !== 'port') g.events.emit('state:change', { from: from || 'sail', to: 'port' });
    this._prevTimeScale = g.timeScale; g.timeScale = 0.05;
    const p = g.player;
    if (p) { p.sailSetting = 0; p.speed = 0; }
    this.vstate(v); this.market(v);
    g.career?.advanceHours?.(VILLAGE.hours);
    g.hud?.show?.(false);
    this._backdrop(v);
    this._welcome = VILLAGE_TEXT.welcome[Math.floor(Math.random() * VILLAGE_TEXT.welcome.length)];
    g.events.emit('village:enter', { village: v });
    g.audio?.play?.('bell');
    this._open();
  }

  // end of career (retirement.retire): closes the sheet without weighing anchor or saving
  dismiss() { if (!this.isOpen) return; this.isOpen = false; this.el?.classList.remove('show'); this.village = null; this.game.timeScale = this._prevTimeScale || 1; }

  leave() {
    const g = this.game, v = this.village;
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el?.classList.remove('show');
    const p = g.player, hp = v.harborPoint;
    if (p && hp) {
      const hd = Math.atan2(v.seaward.x, -v.seaward.z);
      if (p.teleport) p.teleport(hp.x, hp.z, hd); else { p.position.x = hp.x; p.position.z = hp.z; p.heading = hd; }
      p.speed = 0; p.sailSetting = 0.5;
    }
    g.cameraRig?.follow?.(p);
    g.timeScale = this._prevTimeScale || 1;
    g.mode = 'sail';
    g.hud?.show?.(true);
    g.events.emit('village:leave', { village: v });
    g.events.emit('state:change', { from: 'port', to: 'sail' });
    this.village = null;
  }

  // camera: slow drift skimming the water in front of the beach
  _backdrop(v) {
    const rig = this.game.cameraRig; if (!rig) return;
    const s = v.seaward, l = v.lateral, q = v.quay, tc = v.townCenter;
    const key = (a, h) => ({ position: [q.x + s.x * 105 + l.x * a, h, q.z + s.z * 105 + l.z * a], lookAt: [tc.x - l.x * a * 0.25, 4.5, tc.z - l.z * a * 0.25], fov: 40 });   // closer and lower
    if (rig.setShotPath) rig.setShotPath([key(-75, 13), key(-20, 11), key(35, 12), key(80, 14)], { duration: 60, loop: false, ease: true });
    else rig.setShot?.(key(0, 12));
  }

  // ---------------- radoub ----------------
  repairInfo() {
    const p = this.game.player; if (!p) return { hull: 0, sails: 0, hullTo: 0 };
    const R = VILLAGE.repair, cap = p.hullMax * R.hullCap, hullTo = Math.max(p.hull, cap);
    return {
      hull: Math.round(Math.max(0, hullTo - p.hull) * 6 * R.mul), sails: Math.round((1 - p.sails) * p.hullMax * 3 * R.mul),
      hullTo, hullPct: Math.round(p.hull / p.hullMax * 100), hullToPct: Math.round(hullTo / p.hullMax * 100), sailPct: Math.round(p.sails * 100),
    };
  }
  repair(part) {
    const g = this.game, p = g.player, st = g.state, ri = this.repairInfo(), c = ri[part];
    if (!p || c <= 0) return false;
    const f = Math.min(1, st.gold / c);
    if (f <= 0) { this._say(VILLAGE_TEXT.noGold, 'bad'); return false; }
    st.gold -= Math.round(c * f);
    if (part === 'hull') p.hull += (ri.hullTo - p.hull) * f; else p.sails += (1 - p.sails) * f;
    g.career?.advanceHours?.(part === 'hull' ? VILLAGE.repair.hullHours : VILLAGE.repair.sailHours);
    this._say(f < 1 ? 'Partial repairs. Your purse is empty.' : part === 'hull' ? VILLAGE_TEXT.hullDone : VILLAGE_TEXT.sailDone, f < 1 ? 'bad' : 'good');
    g.events.emit('village:repair', { village: this.village, part, cost: Math.round(c * f) });
    return true;
  }

  // ---------------- troc ----------------
  rows(v = this.village) {
    const g = this.game, st = g.state, mk = this.market(v), m = ensureMarket(g, mk);
    const ids = new Set([...(v.sells || []), 'food', ...Object.keys(st.cargo || {}).filter(k => st.cargo[k] > 0), ...Object.keys(m).filter(k => m[k]?.stock >= 1)]);   // + what the village has bought
    return [...ids].filter(k => GOODS[k]).map(k => {
      const q = quote(g, mk, k), have = k === 'food' ? st.food || 0 : st.cargo?.[k] || 0;
      return { good: k, name: GOODS[k].name, own: !!v.sells?.includes(k), stock: m[k].stock, buy: q.buy, sell: q.sell, have };
    }).sort((a, b) => (b.own - a.own) || a.name.localeCompare(b.name));
  }
  buy(good, n) { const k = buy(this.game, this.market(this.village), good, n); if (!k) this._say('No room left in the hold, or not enough gold.', 'bad'); return k; }
  sell(good, n) { return sell(this.game, this.market(this.village), good, n); }

  // ---------------- hommes ----------------
  menOffer(v = this.village) { const s = this.vstate(v), p = this.game.player; return { avail: s.men, cap: s.cap, cost: VILLAGE.men.cost, room: Math.max(0, (p?.crewMax || 0) - (p?.crew || 0)) }; }
  hire(n) {
    const g = this.game, p = g.player, st = g.state, o = this.menOffer();
    const k = Math.max(0, Math.min(n, o.avail, o.room, Math.floor(st.gold / o.cost)));
    if (!k) { this._say(o.avail ? 'No room left aboard, or nothing to pay with.' : VILLAGE_TEXT.menNone, 'bad'); return 0; }
    st.gold -= k * o.cost; p.crew += k; st.crew = p.crew; this.vstate(this.village).men -= k;
    this._say(VILLAGE_TEXT.menDone(k), 'good');
    return k;
  }

  // ---------------- nouvelles ----------------
  news(v = this.village) {
    const g = this.game, p = g.player, hp = v.harborPoint, out = [];
    const dir = (x, z) => COMPASS[Math.round(((Math.atan2(x - hp.x, -(z - hp.z)) * 180 / Math.PI + 360) % 360) / 45) % 8];
    const km = d => `${String(Math.round(d / 100) / 10)}${NB}km`;
    const zs = g.seaZones, z = zs?.at(hp.x, hp.z);
    if (z) out.push({ kind: z.tier === 3 ? 'bad' : z.tier === 1 ? 'good' : 'info', text: z.tier === 3 ? `Here begin the ${ZONE_TEXT[3].tag}: ${z.name}.` : z.tier === 1 ? `These waters are guarded: big men-of-war keep offshore.` : `You are on the ${ZONE_TEXT[2].tag}.` });
    const pc = p ? powerClass(livePower(p)) : 2;
    for (const s of g.ships) {
      if (s === p || s.alive === false || s.sinking || s.sunk || s.struck || !s.ai) continue;
      const d = Math.hypot(s.position.x - hp.x, s.position.z - hp.z);
      if (d > VILLAGE.news.radius) continue;
      const th = threatOf(s, p);
      if (!th || (th.cls <= pc && s.role !== 'hunter' && !s.lordId)) continue;
      const lord = s.lordId ? g.lords?.def?.(s.lordId) : null;
      const who = s.lordId ? `${lord?.nick || s.name}, a Top 10 captain,` : `${a(shipDesc(s.faction, s.type))} (class ${th.roman})`;
      out.push({ kind: th.key === 'over' || th.key === 'tough' ? 'bad' : 'info', text: `${capFirst(who)} has been seen ${km(d)} ${dir(s.position.x, s.position.z)}${s.role === 'hunter' ? '; she is looking for someone' : ''}.`, d });
    }
    for (const l of g.lords?.lairs?.() || []) {
      if (l.defeated) continue;
      const d = Math.hypot(l.x - hp.x, l.z - hp.z);
      const who = l.nicks || l.short;
      if (d < VILLAGE.news.lairR) out.push({ kind: 'bad', text: `${capFirst(who)} ${/ and /.test(who) ? 'keep their' : 'keeps a'} lair ${km(d)} ${dir(l.x, l.z)}.`, d: d + 1e5 });
    }
    if (out.length < 2) out.push({ kind: 'info', text: VILLAGE_TEXT.quiet });
    return out.sort((a, b) => (a.d ?? -1) - (b.d ?? -1)).slice(0, 5);
  }

  // ---------------- jetty sheet ----------------
  _ensureDom() {
    if (this.el) return;
    const el = this.el = document.createElement('div');
    el.className = 'village-layer';
    el.innerHTML = '<div class="vcol tof-parch"></div><div class="vslips"></div>';
    (this.game.uiRoot || document.body).appendChild(el);
    this.col = el.querySelector('.vcol'); this.slips = el.querySelector('.vslips');
    el.addEventListener('click', e => this._click(e));
    el.addEventListener('mousedown', e => e.stopPropagation());
  }
  _open() { this._ensureDom(); this.render(); this.el.classList.add('show'); }
  render() {
    if (!this.el || !this.village) return;
    const g = this.game, v = this.village, st = g.state, p = g.player;
    const ri = this.repairInfo(), mo = this.menOffer(), z = g.seaZones?.at(v.harborPoint.x, v.harborPoint.z);
    const coin = `<i class="coin">${ICONS.gold}</i>`;
    const rows = this.rows().map(r => `<tr class="${r.own ? 'own' : ''}"><td>${esc(r.name)}</td>
      <td class="n">${r.stock > 0 ? `${coin}${r.buy}<small> · ${fmtInt(r.stock)}</small>` : '<small>—</small>'}</td><td class="n">${coin}${r.sell}</td><td class="n">${fmtInt(r.have)}</td>
      <td class="b"><button class="vb" data-act="buy" data-g="${r.good}" ${r.stock > 0 ? '' : 'disabled'} title="Click: 1 · Shift+click: 10">Buy</button><button class="vb" data-act="sell" data-g="${r.good}" ${r.have > 0 ? '' : 'disabled'} title="Click: 1 · Shift+click: all">Sell</button></td></tr>`).join('');
    const news = this.news().map(n => `<li class="${n.kind}">${esc(n.text)}</li>`).join('');
    this.col.innerHTML = `
      <header><h1>${esc(v.name)}</h1><p class="sub">${VILLAGE_TEXT.sub}${z ? ` · <span class="zt t${z.tier}">${ZONE_TEXT[z.tier].tag}</span>` : ''}</p><p class="welcome">${esc(this._welcome || '')}</p></header>
      <section><h2>Repairs</h2>
        <div class="rep"><span>Hull <b>${ri.hullPct}%</b>${ri.hull > 0 ? ` → ${ri.hullToPct}%` : ''}</span>${ri.hull > 0 ? `<button class="vb" data-act="rep-hull">${coin}${fmtInt(ri.hull)}</button>` : '<em>nothing to do here</em>'}</div>
        <div class="rep"><span>Sails <b>${ri.sailPct}%</b>${ri.sails > 0 ? ' → 100%' : ''}</span>${ri.sails > 0 ? `<button class="vb" data-act="rep-sails">${coin}${fmtInt(ri.sails)}</button>` : '<em>in good order</em>'}</div>
        <p class="note">${VILLAGE_TEXT.repairNote}</p></section>
      <section><h2>Barter <small>hold ${fmtInt(holdUsed(g))}/${fmtInt(holdCapacity(g))}</small></h2>
        <table class="trade"><tr class="hd"><td></td><td class="n">They sell</td><td class="n">They buy</td><td class="n">In hold</td><td></td></tr>${rows}</table>
        <p class="note">${VILLAGE_TEXT.tradeNote}</p></section>
      <section><h2>Men <small>${fmtInt(p?.crew || 0)}/${fmtInt(p?.crewMax || 0)} aboard</small></h2>
        <div class="rep"><span>${mo.avail ? `${mo.avail} fisherm${mo.avail > 1 ? 'en' : 'an'} ready to sign on · ${coin}${mo.cost} each` : VILLAGE_TEXT.menNone}</span>
          ${mo.avail ? `<span class="pair"><button class="vb" data-act="hire1">One</button><button class="vb" data-act="hireAll">All</button></span>` : ''}</div></section>
      <section><h2>News</h2><ul class="news">${news}</ul></section>
      <footer><span class="purse">${coin}<b>${fmtInt(st.gold || 0)}</b></span><button class="vb leave" data-act="leave"><span class="kc">Esc</span> Weigh anchor</button></footer>`;
  }
  _click(e) {
    const b = e.target.closest?.('button[data-act]'); if (!b || b.disabled) return;
    const a = b.dataset.act, g = b.dataset.g;
    if (a === 'leave') return this.leave();
    if (a === 'rep-hull') this.repair('hull');
    else if (a === 'rep-sails') this.repair('sails');
    else if (a === 'buy') this.buy(g, e.shiftKey ? 10 : 1);
    else if (a === 'sell') this.sell(g, e.shiftKey ? 1e6 : 1);
    else if (a === 'hire1') this.hire(1);
    else if (a === 'hireAll') this.hire(1e6);
    this.game.audio?.play?.('ui:click');
    this.render();
  }
  _say(text, kind = 'info') { this.game.events.emit('notify', { text, kind }); }
  _slip(text, kind) {
    if (!this.slips) return;
    const d = document.createElement('div'); d.className = `vslip ${kind}`; d.textContent = text;
    this.slips.appendChild(d);
    while (this.slips.children.length > 3) this.slips.firstChild.remove();
    setTimeout(() => d.classList.add('out'), 3200); setTimeout(() => d.remove(), 3800);
  }
  update() {}
}
