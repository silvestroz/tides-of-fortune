// PortSystem: takes over the HUD's F-key port entry, freezes sailing, frames the town as a slowly drifting
// backdrop, and runs the port screen (src/ui/port/). Owns the Career (game.career) and save hooks.
// API (game.ports):
//   enter(port, tab?)   open the port screen (also on 'port:enter' from the HUD)
//   leave()             close, emit 'port:leave' {port} + 'state:change' {from:'port', to:'sail'}, place ship at harborPoint
//   isOpen, port, screen (PortScreen), career (Career)
//   attitude(port) -> { label, cls:'warm'|'fair'|'cold'|'hostile', rep }   rep(nation)
//   locked(port, tab) -> reason string | null   (hostile ports bar the governor/shipyard/market)
//   buy/sell/hire/standRound/repair/upgrade/buyShip/buyMarque  game actions used by the UI
// Events: emits 'port:leave', 'state:change', 'notify', 'port:arrest' {port}; listens 'port:enter'.
import { PortScreen } from '../../ui/port/portScreen.js';
import { isKey } from '../../core/keys.js';
import { Career, privileges, NATIONS } from '../career.js';
import { buy, sell, ensureMarket, bestRoutes, SHIP_PRICES, quote, holdCapacity } from '../economy.js';
import { ensureFleet, repairShip, sellShip, swapFlagship, transferGoods, transferMen } from '../fleet.js';   // squadron
import { rearmCost } from '../transship.js';   // jettisoned guns replaced at the refit
import { getReputation, changeReputation, relation, HOSTILE_REP } from '../../combat/factions.js';
import { GOODS } from '../../data/world.js';
import { mulberry32 } from '../../core/rng.js';
import { shipType, fmtInt, theName, ofName } from '../../core/i18n.js';
import { installSaveHooks, saveGame, applyUpgrades, NO_UPGRADES } from '../save.js';
import { PortStage } from './stage/stage.js';

export const AMMO_PRICES = { chain: 600, grape: 450 };
export const PORT_HOURS = 4;   // hours of the sky clock spent coming ashore (was: a whole day)
const UPGRADES = [
  { id: 'guns', name: 'Heavier guns', desc: 'more range, harder blows', base: 900, max: 3 },
  { id: 'hull', name: 'Doubled planking', desc: 'a stronger hull, +10% per refit', base: 1100, max: 3 },
  { id: 'hold', name: 'Deepened hold', desc: '+15% cargo per refit', base: 700, max: 3 },
  { id: 'sheath', name: 'Copper sheathing', desc: 'a clean bottom, +15% turning per refit', base: 800, max: 2 },
  { id: 'canvas', name: 'Fine canvas', desc: 'close weave, +6% speed per refit', base: 1000, max: 2 },
  { id: 'berths', name: 'Extra hammocks', desc: 'in the ’tween decks, +10% berths per refit', base: 600, max: 2 },
];
export class PortSystem {
  constructor(game) {
    this.game = game;
    this.career = game.career = new Career(game);
    game.addSystem(this.career);
    this.isOpen = false; this.port = null;
    this.stage = new PortStage(game);
    this.screen = new PortScreen(game, this);
    game.portKeyHandled = true;
    // we handle F ourselves (HUD defers via portKeyHandled)
    addEventListener('keydown', e => this._key(e), true);   // capture: runs before the HUD's Esc/F
    game.events.on('port:enter', ({ port } = {}) => { if (port && !this.isOpen) this.enter(port); });
    game.events.on('game:loaded', () => ensureFleet(game.state));   // old saves: squadron ships get crew 0, no refits
    installSaveHooks(game);
  }

  _key(e) {
    const g = this.game;
    if (e.target?.tagName === 'INPUT' || g.hud?.menu?.isOpen) return;
    if (this.isOpen) {
      if (e.code === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); if (this.screen.tab !== 'harbour') this.goto('harbour'); else this.leave(); }
      const n = { Digit1: 'market', Digit2: 'tavern', Digit3: 'shipyard', Digit4: 'governor', Digit5: 'bank' }[e.code];
      if (n) this.goto(n);
      return;
    }
    if (isKey(e, 'f') && g.mode === 'sail' && g.player) {
      const np = g.islands?.nearestPort?.(g.player.position.x, g.player.position.z);
      if (np && np.dist < 400) { e.stopImmediatePropagation(); g.events.emit('port:enter', { port: np.port }); }
    }
  }

  enter(port, tab, opts = {}) {
    const g = this.game;
    // hostile ports: who meets you on the quay (lot 7b: instead of a plain arrest, offer to sneak into town)
    const hostile = this.attitude(port).cls === 'hostile' && !port.haven;
    let fate = opts.fate || null;   // 'disguise' | 'sparse' | 'arrest' | 'sneaked' (infiltration succeeded)
    if (hostile && !fate) {
      const dz = g.fortune?.fx.disguise || 0;   // disguise (60 % / always slips past the soldiers)
      fate = dz && (dz >= 2 || Math.random() < 0.6) ? 'disguise'
        : Math.random() < (1 - (g.living?.town(port).garrison ?? 60) / 100) * 0.6 ? 'sparse' : 'arrest';   // town garrison
      if (fate === 'arrest' && g.sneak && !this.isOpen) { g.sneak.offerPort(port, tab); return; }
    }
    this._sneakPass = fate === 'sneaked' ? port.id : null;
    this.port = port; this.isOpen = true;
    const from = g.mode; g.mode = 'port';
    if (from !== 'port') g.events.emit('state:change', { from: from || 'sail', to: 'port' });
    this._prevTimeScale = g.timeScale;
    g.timeScale = 0.05;   // sim near-paused (sea in slow motion); camera rig uses real time so the backdrop still drifts
    g.state.lastPortName = port.name;
    ensureMarket(g, port);
    // a few hours pass coming ashore (the date turns if the sky passes midnight)
    this.career.advanceHours(PORT_HOURS);
    g.hud?.show?.(false);
    this._backdrop(port);
    if (!hostile || fate === 'sneaked') { /* no soldiers on the quay, or slipped past them through the back streets */ }
    else if (fate === 'disguise') {
      g.events.emit('notify', { text: 'Under your disguise, the soldiers on the quay do not recognise you.', kind: 'good' });
    } else if (fate === 'sparse') {
      g.events.emit('notify', { text: 'The garrison is so thin that nobody stops you on the quay.', kind: 'good' });
    } else {
      const fine = Math.min(g.state.gold, Math.round(200 + g.state.gold * 0.15));
      g.state.gold -= fine;
      g.events.emit('port:arrest', { port, fine });
      g.events.emit('notify', { text: `Soldiers seize you on the quay. ${fine} gold buys your freedom.`, kind: 'bad' });
    }
    this.screen.open(port, 'harbour');
    if (tab && tab !== 'harbour') this.goto(tab, true);
    // ships at anchor around the harbour
    if (g.player) { g.player.sailSetting = 0; g.player.speed = 0; }
  }

  leave() {
    const g = this.game, port = this.port;
    if (!this.isOpen) return;
    this.isOpen = false; this.screen.close(); this._sneakPass = null;
    this.stage.clear(); if (this._frozeSim) { g.frozen = this._prevFrozen; this._frozeSim = false; }
    const p = g.player, hp = port.harborPoint;
    if (p && hp) {
      const hd = Math.atan2(port.seaward.x, -port.seaward.z);
      if (p.teleport) p.teleport(hp.x, hp.z, hd); else { p.position.x = hp.x; p.position.z = hp.z; p.heading = hd; }
      p.speed = 0; p.sailSetting = 0.5;
    }
    g.cameraRig?.follow?.(p);
    g.timeScale = this._prevTimeScale || 1;
    g.mode = 'sail';
    g.hud?.show?.(true);
    g.events.emit('port:leave', { port });
    g.events.emit('state:change', { from: 'port', to: 'sail' });
    g.events.emit('notify', { text: `Anchor weighed at ${port.name}.`, kind: 'info' });
    g.audio?.play?.('bell');
  }

  // camera on a slow drift across the town, looking over the quay
  _backdrop(port) {
    const rig = this.game.cameraRig; if (!rig) return;
    const s = port.seaward, l = port.lateral || { x: -s.z, z: s.x };
    const tc = port.townCenter || port, hp = port.harborPoint;
    const key = (a, h) => ({ position: [hp.x + s.x * 60 + l.x * a, h, hp.z + s.z * 60 + l.z * a], lookAt: [tc.x - l.x * a * 0.3, 14, tc.z - l.z * a * 0.3], fov: 42 });
    if (rig.setShotPath) rig.setShotPath([key(-140, 34), key(-40, 30), key(60, 32), key(140, 36)], { duration: 70, loop: false, ease: true });
    else rig.setShot?.(key(0, 32));
  }

  // switch location: builds that location's 3D stage (or returns to the harbour vista)
  goto(tab, instant = false) {
    const g = this.game, sc = this.screen;
    if (!this.isOpen) return;
    const apply = () => {
      let ready = null;
      if (tab === 'harbour' || this.locked(this.port, tab)) {
        this.stage.clear();
        if (this._frozeSim) { g.frozen = this._prevFrozen; this._frozeSim = false; }
      } else {
        ready = this.stage.show(tab, this.port);   // set compiled (promise), the fade waits for it
        if (!this._frozeSim) { this._prevFrozen = g.frozen; g.frozen = true; this._frozeSim = true; }   // world sim idles behind the stage
      }
      sc.tab = tab; sc.sel = null; sc.fleetSel = null; sc.xferSel = null; sc.render();
      return ready;
    };
    g.audio?.play?.('ui:page');
    if (instant) return apply();
    sc.fadeThrough(apply);
  }

  update() {}

  // ---------------- queries ----------------
  rep(n) { return getReputation(this.game, n); }

  attitude(port) {
    if (port.haven) { const r = this.rep('pirate'); return { rep: r, cls: r < -20 ? 'cold' : 'warm', label: r < -20 ? 'Distrusts you' : 'Welcomes you' }; }
    const r = this.rep(port.faction);
    const war = relation(this.game.player?.faction, port.faction) < 0 && !this.game.state.letters?.[port.faction];
    if (r <= HOSTILE_REP || (war && r < 5)) return { rep: r, cls: 'hostile', label: 'Wants to hang you' };
    if (r < 0 || war) return { rep: r, cls: 'cold', label: 'Cold' };
    if (r > 30) return { rep: r, cls: 'warm', label: 'Holds you in esteem' };
    return { rep: r, cls: 'fair', label: 'Courteous' };
  }

  locked(port, tab) {
    if (tab === 'tavern' || tab === 'bank' || port.haven) return null;
    if (this.attitude(port).cls === 'hostile' && tab !== 'governor' && (this.game.fortune?.fx.disguise || 0) >= 2) return null;   // false papers
    if (this._sneakPass === port.id && this.isOpen && tab === 'tavern') return null;   // slipped into town, the tavern serves you
    if (this.attitude(port).cls === 'hostile') return tab === 'governor' ? 'The governor would gladly see you hanged.' : 'Closed to the Crown’s enemies';
    // protectionism — a rich port of a nation at war with your flag bars its market, unless you come disguised
    if (tab === 'market' && this.game.living?.protectionist(port) && !(this.game.fortune?.fx.disguise >= 1)) return 'Governor’s ordinance: no trade with the enemy';
    return null;
  }

  wealth(port) {
    if (this.game.living) return this.game.living.wealth(port);   // prosperity changes over time
    const base = { small: 2, medium: 3, large: 4 }[port.size] || 3;
    return Math.max(1, Math.min(5, base + ((port.population || 0) > 5000 ? 1 : 0) - (port.haven ? 1 : 0)));
  }

  // ---------------- actions ----------------
  buy(port, good, n) { const k = buy(this.game, port, good, n); if (!k) this._say('No room left in the hold, or not enough gold.', 'bad'); }
  sell(port, good, n) { sell(this.game, port, good, n); }

  // Tavern recruits: a per-town pool (state.taverns[portId] = { n, t }) sized by town size, the captain's fame and
  // the crew's morale (word gets around), boosted by rank privileges; refills ~1/20 of its size per day.
  fame() { const st = this.game.state; return (st.captures || 0) * 2 + Object.values(st.rank || {}).reduce((a, b) => a + b, 0) * 3 + (st.missions || []).filter(m => m.status === 'done').length * 2; }
  recruitCap(port) {
    const st = this.game.state, pv = port.haven ? { recruitMul: 1 } : privileges(st, port.faction);
    const base = { small: 10, medium: 20, large: 32 }[port.size] || 15;
    return Math.max(2, Math.round(base * (port.haven ? 1.5 : 1) * (0.7 + Math.min(1, this.fame() / 40) * 0.8) * (0.5 + Math.min(100, st.morale ?? 70) / 100 * 0.7) * pv.recruitMul * (this.game.fortune?.fx.recruitMul ?? 1)));   // hat
  }
  recruitOffer(port) {
    const st = this.game.state, d = st.date, now = d.year * 372 + d.month * 31 + d.day;
    st.taverns ||= {};
    const cap = this.recruitCap(port);
    const t = st.taverns[port.id] ||= { n: cap, t: now };
    if (now > t.t) { t.n = Math.min(cap, t.n + (now - t.t) * cap / 2); t.t = now; }   // full again in 2 days
    const pv = port.haven ? { recruitCost: 1 } : privileges(st, port.faction);
    return { avail: Math.floor(t.n), cap, cost: Math.round((port.haven ? 18 : 25) * pv.recruitCost * (this.game.fortune?.fx.recruitCost ?? 1)) };
  }
  hire(port, n) {
    const g = this.game, p = g.player, st = g.state, o = this.recruitOffer(port);
    const k = Math.max(0, Math.min(n, o.avail, (p?.crewMax || 0) - (p?.crew || 0), Math.floor(st.gold / o.cost)));
    if (!k) return this._say('Nobody signs on at that price.', 'bad');
    st.gold -= k * o.cost; p.crew += k; st.crew = p.crew; st.taverns[port.id].n -= k;
    this._say(`${k} new sailors sign the articles.`, 'good');
  }
  roundCost() { return Math.max(20, Math.round((this.game.player?.crew || 30) * 1.5)); }
  standRound(port) {
    const st = this.game.state, c = this.roundCost();
    if (st.gold < c) return;
    st.gold -= c; st.morale = Math.min(100, st.morale + 8);
    st.extraRumour = (st.extraRumour || 0) + 1;
    this._say('The whole room cheers you.', 'good');
  }

  // Tavern talk. The facts (best trade routes, a cove, then the barkeep's real news from living.js) are unchanged; the
  // wording is drawn from a second seeded generator (v) so the picks of the first one (r) stay the same.
  rumours(port) {
    const g = this.game, st = g.state;
    const dn = st.date.year * 372 + st.date.month * 31 + st.date.day;
    const r = mulberry32(dn * 7919 + port.id.charCodeAt(0) * 31 + (st.extraRumour || 0));
    const v = mulberry32(dn * 104729 + port.id.length * 613 + port.id.charCodeAt(0) + (st.extraRumour || 0) * 17);
    const out = [];
    const WHO = ['a one-eyed boatswain', 'a Dutch factor, a little tipsy', 'the serving girl, wiping a tankard', 'an old gunner with powder-burnt hands', 'a deserter from the garrison', 'a Creole pilot who knows every reef',
      'a loud-mouthed tobacco seller', 'a ship’s boy who has drunk too much', 'an old one-armed freebooter', 'a ship’s carpenter, pipe in his teeth', 'a defrocked priest', 'a smuggler in muddy boots'];
    const pick = a => a[Math.floor(r() * a.length)], pv = a => a[Math.floor(v() * a.length)];
    const routes = bestRoutes(g, 6);
    if (routes.length) {
      const rt = routes[Math.floor(r() * Math.min(3, routes.length))];
      const G = GOODS[rt.good].name, gl = G.toLowerCase(), x = String(Math.round(rt.ratio * 10) / 10);
      out.push({ who: pick(WHO), text: pv([
        `${G}: it sells for a song at ${rt.from.name}, and they pay nearly ${x} times as much for it at ${rt.to.name}.`,
        `${G}? Buy at ${rt.from.name}, sell at ${rt.to.name}: nearly ${x} times your stake, so they say.`,
        `At ${rt.from.name}, the warehouses are overflowing: ${gl} going cheap. At ${rt.to.name}, they fight over it at nearly ${x} times the price.`,
        `Listen to an old factor: ${gl} from ${rt.from.name} to ${rt.to.name}, and you come home rich. Nearly ${x} times your stake.`,
      ]) });
    }
    const coves = g.islands?.coves || [];
    if (coves.length) {
      const c = coves[Math.floor(r() * coves.length)];
      const isl = g.islands.getIsland?.(c.islandId);
      const dir = c.z < (isl?.z ?? 0) ? 'south' : 'north';
      const side = dir === 'north' ? 'south' : 'north', where = isl?.name || 'some lost island';
      const who = pv(['old Harrow', 'Toothless Jack', 'the widow Calloway', 'Bartholomew the Left-Handed', 'Mad Ned Fletcher', 'a certain Portuguese']);
      const mark = pv(['a split rock faces the sea', 'three palms lean out to sea', 'a cross is carved in the trunk of a silk-cotton tree', 'a half-buried wreck shows its ribs', 'a spring falls from a red cliff']);
      out.push({ who: pick(WHO), cove: c.id, text: pv([
        `They say ${who} buried his share in a cove of ${where}, on the ${side} coast, where ${mark}.`,
        `My grandmother swore ${who} had hidden his chest on the ${side} coast of ${where}. A cove, where ${mark}.`,
        `The old-timers say ${who} never spent his plunder: it sleeps in a cove of ${where}, ${side} coast, where ${mark}.`,
      ]) });
    }
    // the barkeep's news are real (convoys that will sail, top-10 captains, wars): src/game/living.js
    if (g.living) out.unshift(...g.living.rumours(port, st.extraRumour || 0));
    return out;
  }

  repairCost() {
    const p = this.game.player; if (!p) return { hull: 0, sails: 0 };
    const k = this.port && !this.port.haven ? privileges(this.game.state, this.port.faction).repairMul : 1;   // rank privilege
    return { hull: Math.round((p.hullMax - p.hull) * 6 * k), sails: Math.round((1 - p.sails) * p.hullMax * 3 * k), free: k === 0 };
  }
  repair(part) {
    const g = this.game, p = g.player, st = g.state, rc = this.repairCost(), c = rc[part];
    if (!p) return;
    if (rc.free) { if (part === 'hull') p.hull = p.hullMax; else p.sails = 1; return this._say('Repairs offered by the arsenal, with the governor’s compliments.', 'good'); }
    if (c <= 0) return;
    const f = Math.min(1, st.gold / c);
    st.gold -= Math.round(c * f);
    if (part === 'hull') p.hull += (p.hullMax - p.hull) * f; else p.sails += (1 - p.sails) * f;
    this._say(f < 1 ? 'Partial repairs. Your purse is empty.' : 'The carpenters put her back in order.', f < 1 ? 'bad' : 'good');
  }
  // Guns jettisoned at sea (hold, I key) replaced at the refit — state.upgrades.gunsLost, in pairs if the purse
  // falls short; free with the refit at the arsenal (rank privilege)
  rearmInfo() {
    const st = this.game.state, lost = st.upgrades?.gunsLost || 0, mul = this._repairMul();
    return { lost, cost: rearmCost(lost, mul), unit: rearmCost(1, mul), free: mul === 0 };
  }
  rearm() {
    const g = this.game, st = g.state, p = g.player, r = this.rearmInfo();
    if (!p || r.lost <= 0) return;
    let n = r.lost;
    if (!r.free && st.gold < r.cost) n = Math.min(r.lost, Math.floor(st.gold / Math.max(1, r.unit * 2)) * 2);
    if (n <= 0) return this._say('Not enough to pay for a single gun, captain.', 'bad');
    if (!r.free) st.gold -= r.unit * n;
    st.upgrades.gunsLost = r.lost - n;
    applyUpgrades(p, st.upgrades);
    this._say(n < r.lost ? `${n} guns back in battery. Your purse is empty.` : r.free ? 'The arsenal gives you back your guns, with the governor’s compliments.' : 'The guns are back in battery.', n < r.lost ? 'bad' : 'good');
  }
  upgrades() {
    const u = this.game.state.upgrades;
    return UPGRADES.map(x => ({ ...x, level: u[x.id] || 0, cost: Math.round(x.base * (1 + (u[x.id] || 0) * 0.8) * (this.game.player?.spec?.guns || 14) / 14) }));
  }
  upgrade(id) {
    const g = this.game, st = g.state, u = this.upgrades().find(x => x.id === id), p = g.player;
    if (!u || u.level >= u.max || st.gold < u.cost) return;
    st.gold -= u.cost; st.upgrades[id] = u.level + 1;
    if (p && id === 'hull') { p.hullMax = Math.round(p.hullMax * 1.1); p.hull = Math.min(p.hullMax, p.hull + p.hullMax * 0.1); }
    applyUpgrades(p, st.upgrades);
    this._say(`${u.name}: work complete.`, 'good');
  }
  shipTradeIn() {
    const p = this.game.player; if (!p) return 0;
    return Math.round((SHIP_PRICES[p.type] || 4000) * 0.55 * (0.4 + 0.6 * p.hull / p.hullMax));
  }
  shipPrice(type) { return (SHIP_PRICES[type] || 0) - this.shipTradeIn(); }
  buyShip(type) {
    const g = this.game, st = g.state, old = g.player, price = this.shipPrice(type);
    if (!old || st.gold < price) return;
    st.gold -= price;
    const C = old.controller?.constructor;
    const np = g.spawnShip({ type, faction: old.faction, isPlayer: true, x: old.position.x, z: old.position.z, heading: old.heading, name: old.name, sailSetting: 0 });
    np.crew = Math.min(np.crewMax, old.crew);
    if (C) np.controller = new C(g, np);
    g.removeShip(old); g.player = np; st.shipType = type; st.upgrades = NO_UPGRADES();   // refits stay with the old hull
    this._say(`The ${shipType(type).toLowerCase()} ${np.name} is yours.`, 'good');
  }
  // ---------------- squadron (2026-10-22, logic in src/game/fleet.js) ----------------
  _repairMul() { return this.port && !this.port.haven ? privileges(this.game.state, this.port.faction).repairMul : 1; }
  _flag() { const p = this.game.player; return p ? { type: p.type, name: p.name, faction: p.faction, hull: p.hull / p.hullMax, sails: p.sails, crew: p.crew, crewMax: p.crewMax } : null; }
  _crewBack(flag) { const p = this.game.player; if (p && flag) { p.crew = flag.crew; this.game.state.crew = Math.round(p.crew); } }
  fleetRepair(i) {
    const f = ensureFleet(this.game.state)[i]; if (!f) return;
    const r = repairShip(this.game.state, i, this._repairMul());
    if (!r || (!r.spent && !r.free)) return;
    if (r.free) return this._say(`Repairs ${ofName(f.name)} offered by the arsenal.`, 'good');
    this._say(r.f < 1 ? 'Partial repairs. Your purse is empty.' : `The carpenters put ${theName(f.name)} back in order.`, r.f < 1 ? 'bad' : 'good');
  }
  fleetSell(i) {
    const g = this.game, flag = this._flag();
    const r = sellShip(g.state, i, { priceOf: k => quote(g, this.port, k).sell, flag });
    if (!r) return;
    this._crewBack(flag);
    const e = r.entry, men = r.menBack ? ` ${r.menBack} men return aboard${r.menAshore ? `, ${r.menAshore} stay ashore` : ''}.` : r.menAshore ? ` ${r.menAshore} men stay ashore.` : '';
    this._say(`${theName(e.name, true)} is sold for ${fmtInt(r.gold)} gold${r.cargo ? `, cargo included (${fmtInt(r.cargo)})` : ''}.${men}`, 'good');
  }
  fleetFlagship(i) {
    const g = this.game, st = g.state, old = g.player;
    if (!old) return;
    const r = swapFlagship(st, i, this._flag()); if (!r) return;
    const C = old.controller?.constructor;
    const np = g.spawnShip({ type: r.type, faction: old.faction, isPlayer: true, x: old.position.x, z: old.position.z, heading: old.heading, name: r.name, sailSetting: 0, crew: r.crew });
    applyUpgrades(np, st.upgrades, true);   // the new flagship brings its own refits (state.upgrades swapped by swapFlagship)
    np.hull = Math.max(1, r.hull * np.hullMax); np.sails = r.sails ?? 1; np.crew = r.crew; st.crew = np.crew; st.shipType = r.type;
    if (C) np.controller = new C(g, np);
    g.removeShip(old); g.player = np;
    const left = Object.values(r.left).reduce((a, q) => a + q, 0), stay = st.fleet[i];
    this._say(`You hoist your flag aboard ${theName(np.name)}. ${theName(stay.name, true)} joins the squadron${stay.crew ? ` with ${stay.crew} men` : ''}${left ? `, ${fmtInt(left)} lots stay in her hold` : ''}.`, 'good');
  }
  fleetGoods(i, k, dir, n) { return transferGoods(this.game.state, i, k, dir, n, holdCapacity(this.game)); }
  fleetMen(i, dir, n) { const flag = this._flag(); const q = transferMen(this.game.state, i, dir, n, flag); this._crewBack(flag); return q; }

  // chain shot and grape are bought once at a shipyard (game.state.ammoUnlocked; absent = all unlocked)
  ammoPrice(kind) { return AMMO_PRICES[kind] || 0; }
  ammoLocked(kind) { const l = this.game.state.ammoUnlocked; return !!l && !l[kind]; }
  buyAmmo(kind) {
    const st = this.game.state, price = AMMO_PRICES[kind];
    if (!price || !this.ammoLocked(kind) || st.gold < price) return;
    st.gold -= price; st.ammoUnlocked[kind] = true;
    this._say(kind === 'chain' ? 'Chain shot, linked two by two: enough to cut a mast to pieces.' : 'Bags of grapeshot: enemy decks will empty fast.', 'good');
  }
  marqueCost(n) { return 800; }
  // a letter of marque is only issued by a governor whose nation is at war (with someone other than the player's flag ally)
  marqueAvailable(n) { return NATIONS.includes(n) && NATIONS.some(o => o !== n && relation(n, o) < 0) && !this.game.state.letters[n] && this.game.player?.faction !== n; }
  buyMarque(n) {
    const st = this.game.state;
    if (!this.marqueAvailable(n) || st.gold < this.marqueCost(n)) return;
    st.gold -= this.marqueCost(n); st.letters[n] = true;
    changeReputation(this.game, n, 5, 'marque');
    this._say('A letter of marque, sealed with red wax. Their enemies are now your lawful prey.', 'good');
  }

  // Amnesty: a hostile nation's governor pardons you for a price (reputation lifted to a neutral standing).
  amnestyCost(n) { return Math.round(1000 + Math.max(0, -this.rep(n)) * 40); }
  amnestyNeeded(port) { return !port.haven && NATIONS.includes(port.faction) && this.attitude(port).cls === 'hostile'; }
  buyAmnesty(n) {
    const st = this.game.state, c = this.amnestyCost(n);
    if (st.gold < c) return this._say('The secretary counts your coins and shakes his head.', 'bad');
    st.gold -= c;
    changeReputation(this.game, n, Math.max(0, 6 - this.rep(n)), 'amnesty');
    this._say(`Amnesty granted. ${c} gold and an oath, and your name is struck from the register of the hanged.`, 'good');
  }

  save() { return saveGame(this.game, 'manual'); }
  _say(text, kind = 'info') { this.game.events.emit('notify', { text, kind }); }
}
