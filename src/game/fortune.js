// Fortune — ship's specialists, special items, the mysterious traveller at the tavern, treasure maps.
// State (game.state, extended without breaking old saves):
//   specialists {id: true}            at most one of each of the 8 (src/data/fortune.js SPECIALISTS)
//   items {cat: 1|2}                  special items (10 categories × 2 levels)
//   treasure { pieces 0..4, cove, found, dug:[coveId], gold }   map in progress, treasures dug up
//   travelerBought {key: true}        lots already bought from the traveller (key = week + port + index)
// API (game.fortune):
//   fx                     aggregated multipliers read by the systems (combat, career, weather, ports, duel),
//                          the captain's talent included (state.skill, src/data/creation.js SKILLS)
//   has(id) · item(cat) · hire(id) · giveItem(cat, lvl) · giveRandomItem(maxLvl)
//   captureFinds(enemy)    finds aboard a prize (specialist offered, map piece, item) — boarding.js
//   travelerStock(port) · buyFromTraveler(port, i)
//   addMapPiece(n) · treasureSite() · tryDig() (F near the mark) · drawMap(ctx, worldMap)
//   applyDuel(sim)         sword, pistol, cuirass, age (duelScene.js)
// Events: 'fortune:hire' {id}, 'fortune:item' {cat, lvl}, 'treasure:piece' {pieces}, 'treasure:dug' {gold, cove}.
import { SPECIALISTS, SPECIALIST_IDS, SPECIALIST_CHANCE, ITEMS, ITEM_IDS, ITEM_PRICE, MAP_PIECE_PRICE, TREASURE, AGEING } from '../data/fortune.js';
import { isKey } from '../core/keys.js';
import { mulberry32 } from '../core/rng.js';
import { fmtInt } from '../core/i18n.js';
import { skillFx } from '../data/creation.js';   // character creation: special talent


export const itemName = (cat, lvl) => ITEMS[cat]?.name[Math.max(0, (lvl || 1) - 1)] || cat;
export const itemEffect = (cat, lvl) => ITEMS[cat]?.effect[Math.max(0, (lvl || 1) - 1)] || '';
export class Fortune {
  constructor(game) {
    this.game = game;
    this.ensure();
    game.events.on('game:loaded', () => this.ensure());
    addEventListener('keydown', e => this._key(e), true);
    this._hintT = 0;
  }

  ensure() {
    const s = this.game.state;
    s.specialists ||= {}; s.items ||= {}; s.travelerBought ||= {};
    s.treasure ||= { pieces: 0, cove: null, found: 0, dug: [], gold: 0 };
    s.treasure.dug ||= []; s.treasure.found ||= 0; s.treasure.gold ||= 0;
  }

  has(id) { return !!this.game.state.specialists?.[id]; }
  item(cat) { return this.game.state.items?.[cat] || 0; }

  // Aggregated multipliers (recomputed on every read: a few dozen operations).
  get fx() {
    const h = id => this.has(id), it = c => this.item(c);
    const out = {
      repairHull: h('carpenter') ? 1.6 : 1, repairSail: h('sailmaker') ? 1.6 : 1, repairCap: h('carpenter') ? 0.85 : 0.75,
      speedMul: (h('sailmaker') ? 1.04 : 1) * (h('navigator') ? 1.05 : 1),
      shoalMul: h('navigator') ? 0.5 : 1,
      foodMul: h('cooper') ? 0.7 : 1,
      reloadMul: h('gunner') ? 0.85 : 1,
      crewLossMul: h('surgeon') ? 0.7 : 1,
      starveMul: (h('surgeon') ? 0.6 : 1) * [1, 0.6, 0.3][it('remedy')],
      moraleDriftMul: h('quartermaster') ? 0.6 : 1, desertMul: h('quartermaster') ? 0.5 : 1,
      moraleDaily: (h('cook') ? 0.4 : 0) + [0, 0.3, 0.6][it('instrument')],
      stormMul: [1, 0.6, 0.35][it('barometer')],
      viewMul: [1, 1.25, 1.5][it('spyglass')],
      disguise: it('disguise'), lockpick: it('lockpick'),   // lockpick (escape)
      missionMul: [1, 1.1, 1.2][it('jewel')],
      recruitMul: [1, 1.2, 1.4][it('hat')], recruitCost: [1, 0.9, 0.8][it('hat')],
      healthBonus: [0, 5, 10][it('remedy')], woundMul: h('surgeon') ? AGEING.surgeonWound : 1,
      duelWindup: [1, 0.92, 0.85][it('sword')], duelArmor: it('armor'), duelPistol: [0, 0.6, 1][it('pistol')],
      spreadMul: 1,   // spread of the player's broadsides (Gunnery talent) → ship.gunSpread
    };
    // character creation: special talent (state.skill, src/data/creation.js SKILLS), multipliers that stack with
    // officers and items; no talent or an unknown one (old saves): no effect
    const k = skillFx(this.game.state?.skill);
    if (k) for (const f in k) if (typeof out[f] === 'number') out[f] *= k[f];
    return out;
  }

  update(dt) {
    const g = this.game, p = g.player;
    if (!p) return;
    const fx = this.fx;
    p.fortuneSpeedF = fx.speedMul;
    p.shoalDmgF = fx.shoalMul;
    p.gunSpread = fx.spreadMul;   // Gunnery talent (sole writer of gunSpread, read by combat.js)
    // spyglass: range of the sea chart (the widened radius carries over to the large-chart view)
    const mm = g.hud?.minimap;
    if (mm) {
      const base = 1200 * fx.viewMul;
      if (mm.baseRange !== base) { mm.baseRange = base; mm.range = mm.expanded ? base * 3.5 : base; }
    }
    // mark nearby: prompt to dig
    if (g.mode === 'sail') {
      this._hintT -= dt;
      const site = this.treasureSite();
      if (site && this._hintT <= 0) {
        const d = Math.hypot(site.x - p.position.x, site.z - p.position.z);
        if (d < TREASURE.digRange) { this._hintT = 12; g.events.emit('notify', { text: `The mark on the map is there, on the beach. Press F to land and dig.`, kind: 'good' }); }
      }
    }
  }

  // ---------------- specialists ----------------
  hire(id) {
    const g = this.game;
    if (!SPECIALISTS[id] || this.has(id)) return false;
    g.state.specialists[id] = true;
    g.events.emit('fortune:hire', { id });
    g.events.emit('notify', { text: `${SPECIALISTS[id].name} hired: ${SPECIALISTS[id].effect.charAt(0).toLowerCase() + SPECIALISTS[id].effect.slice(1)}.`, kind: 'good' });
    return true;
  }

  // ---------------- items ----------------
  giveItem(cat, lvl = 1) {
    const g = this.game;
    if (!ITEMS[cat] || this.item(cat) >= lvl) return false;
    g.state.items[cat] = lvl;
    g.events.emit('fortune:item', { cat, lvl });
    return true;
  }
  giveRandomItem(maxLvl = 1, rnd = Math.random) {
    const open = ITEM_IDS.filter(c => this.item(c) < maxLvl);
    if (!open.length) return null;
    const cat = open[Math.floor(rnd() * open.length)];
    const lvl = Math.max(this.item(cat) + 1, maxLvl === 2 && rnd() < 0.4 ? 2 : 1);
    this.giveItem(cat, Math.min(2, lvl));
    return { cat, lvl: this.item(cat) };
  }

  // Finds aboard a prize: drawn once per ship (same result if the screen is redrawn).
  captureFinds(enemy) {
    if (enemy._finds) return enemy._finds;
    const s = this.game.state, r = Math.random;
    const out = { spec: null, map: false, item: null };
    const missing = SPECIALIST_IDS.filter(id => !s.specialists[id]);
    const ch = enemy.lordId ? SPECIALIST_CHANCE.lord : SPECIALIST_CHANCE[enemy.role] ?? 0.3;
    if (missing.length && r() < ch) out.spec = missing[Math.floor(r() * missing.length)];
    if (r() < (enemy.lordId ? 1 : TREASURE.captureMapChance)) out.map = true;
    if (r() < (enemy.lordId ? 1 : TREASURE.captureItemChance)) {
      const open = ITEM_IDS.filter(c => this.item(c) < 2);
      if (open.length) { const cat = open[Math.floor(r() * open.length)]; out.item = { cat, lvl: enemy.lordId || this.item(cat) ? Math.min(2, this.item(cat) + 1) : 1 }; }
    }
    return (enemy._finds = out);
  }
  // applied when the prize is settled (whatever the choice); the specialist signs on through his own button
  takeFinds(f) {
    if (!f || f._taken) return;
    f._taken = true;
    if (f.map) this.addMapPiece(1, true);
    if (f.item && this.giveItem(f.item.cat, f.item.lvl)) this.game.events.emit('notify', { text: `In the captain’s cabin: ${itemName(f.item.cat, f.item.lvl).toLowerCase()}.`, kind: 'good' });
  }

  // ---------------- mysterious traveller (tavern) ----------------
  _week() { const d = this.game.state.date; return Math.floor((d.year * 372 + d.month * 31 + d.day) / 7); }
  travelerHere(port) {
    // he does not stop everywhere: about two taverns out of three each week, always in the havens
    if (port.haven) return true;
    const r = mulberry32(this._week() * 613 + port.id.length * 37 + port.name.charCodeAt(0) * 7);
    return r() < 0.66;
  }
  travelerStock(port) {
    const s = this.game.state, wk = this._week();
    const r = mulberry32(wk * 7919 + port.id.length * 131 + port.name.charCodeAt(0) * 17 + (port.name.charCodeAt(1) || 0));
    const out = [];
    const n = 2 + Math.floor(r() * 2);
    const cats = ITEM_IDS.slice().sort(() => r() - 0.5);
    for (let i = 0; i < n; i++) {
      const cat = cats[i], lvl = r() < 0.3 ? 2 : 1;
      out.push({ kind: 'item', cat, lvl, price: Math.round(ITEM_PRICE[lvl] * (0.75 + r() * 0.5) / 10) * 10 });
    }
    if (r() < 0.75) out.push({ kind: 'map', price: Math.round(MAP_PIECE_PRICE * (0.8 + r() * 0.5) / 10) * 10 });
    out.forEach((o, i) => { o.key = `${wk}:${port.id}:${i}`; o.sold = !!s.travelerBought[o.key]; });
    return out;
  }
  buyFromTraveler(port, i) {
    const g = this.game, s = g.state, o = this.travelerStock(port)[i];
    if (!o || o.sold || s.gold < o.price) return false;
    if (o.kind === 'item' && this.item(o.cat) >= o.lvl) { g.events.emit('notify', { text: 'You already own something better.', kind: 'bad' }); return false; }
    s.gold -= o.price; s.travelerBought[o.key] = true;
    if (o.kind === 'map') this.addMapPiece(1);
    else { this.giveItem(o.cat, o.lvl); g.events.emit('notify', { text: `${itemName(o.cat, o.lvl)}: ${itemEffect(o.cat, o.lvl).charAt(0).toLowerCase() + itemEffect(o.cat, o.lvl).slice(1)}.`, kind: 'good' }); }
    return true;
  }

  // ---------------- treasure maps ----------------
  addMapPiece(n = 1, found = false) {
    const g = this.game, t = g.state.treasure;
    const coves = g.islands?.coves || [];
    if (!t.cove || !coves.some(c => c.id === t.cove)) {
      // sea tiers: no treasure in guarded waters (the avenging pirate would not go there)
      const open = coves.filter(c => g.seaZones?.tierAt(c.anchorPoint.x, c.anchorPoint.z) !== 1);
      let pool = open.filter(c => !t.dug.includes(c.id));
      if (!pool.length) pool = coves.filter(c => !t.dug.includes(c.id));
      const pick = (pool.length ? pool : coves)[Math.floor(Math.random() * Math.max(1, (pool.length ? pool : coves).length))];
      t.cove = pick?.id || null; t.pieces = 0;
    }
    if (t.pieces >= TREASURE.pieces) return;   // complete map waiting to be dug up
    t.pieces = Math.min(TREASURE.pieces, t.pieces + n);
    g.events.emit('treasure:piece', { pieces: t.pieces });
    if (t.pieces >= TREASURE.pieces) {
      const c = this.treasureSite(), isl = c && g.islands.getIsland?.(c.islandId);
      g.events.emit('notify', { text: `The four pieces fit together: a red cross on ${isl?.name || 'an island'}. The mark is on the map (M).`, kind: 'good' });
    } else g.events.emit('notify', { text: `${found ? 'A piece of a treasure map found' : 'A piece of a treasure map'}: ${t.pieces} of ${TREASURE.pieces}.`, kind: 'good' });
  }
  treasureSite() {
    const t = this.game.state.treasure;
    if (!t || t.pieces < TREASURE.pieces || !t.cove) return null;
    return (this.game.islands?.coves || []).find(c => c.id === t.cove) || null;
  }
  _key(e) {
    const g = this.game;
    if (!isKey(e, 'f') || g.mode !== 'sail' || !g.player || g.hud?.menu?.isOpen || e.target?.tagName === 'INPUT') return;
    const site = this.treasureSite(); if (!site) return;
    const p = g.player.position;
    if (Math.hypot(site.x - p.x, site.z - p.z) > TREASURE.digRange) return;
    const np = g.islands?.nearestPort?.(p.x, p.z);
    if (np && np.dist < 400) return;   // the port keeps its F key
    e.stopImmediatePropagation(); e.preventDefault();
    this.tryDig();
  }
  tryDig() {
    const g = this.game, s = g.state, t = s.treasure, site = this.treasureSite();
    if (!site || !g.player) return false;
    const r = Math.random;
    const gold = Math.round(TREASURE.gold[0] + r() * (TREASURE.gold[1] - TREASURE.gold[0]));
    s.gold += gold; s.plunder = (s.plunder || 0) + Math.round(gold * 0.5);
    t.found++; t.gold += gold; t.dug.push(t.cove); t.cove = null; t.pieces = 0;
    let extra = '';
    if (r() < TREASURE.itemChance) { const it = this.giveRandomItem(2, r); if (it) extra = ` At the bottom of the chest: ${itemName(it.cat, it.lvl).toLowerCase()}.`; }
    g.career?.advanceHours?.(6);   // a morning of digging
    g.audio?.play?.('bell');
    g.events.emit('treasure:dug', { gold, cove: site.id });
    g.events.emit('notify', { text: `The spades strike an iron-bound chest! ${fmtInt(gold)} gold.${extra}`, kind: 'good' });
    // the treasure draws an avenging pirate
    const delay = TREASURE.avengerDelay[0] + r() * (TREASURE.avengerDelay[1] - TREASURE.avengerDelay[0]);
    this._avenger = setTimeout(() => g.lords?.spawnAvenger?.(), delay * 1000 / Math.max(0.2, g.timeScale || 1));
    return true;
  }

  // ---------------- world chart (src/ui/map/worldMap.js) ----------------
  drawMap(ctx, map) {
    const g = this.game, site = this.treasureSite(), L = map.layers || {};
    const lab = (t, x, y, o, font, color) => map.label ? map.label(t, x, y, { font, color, ...o }) : (ctx.font = font, ctx.fillStyle = color, ctx.textAlign = 'left', ctx.fillText(t, x + (o.halfW || 8), y + 3));
    ctx.save();
    if (site && L.treasure !== false) {
      const [x, y] = map.w2s(site.x, site.z), r = 9;
      ctx.strokeStyle = '#b01e14'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r * 1.7, 0, Math.PI * 2); ctx.lineWidth = 1.4; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
      lab('Treasure', x, y, { prio: 9, halfW: r * 1.8 }, `italic 14px 'Spectral', Georgia, serif`, '#7a1410');
      map.hit?.(x, y, 18, `<b>The treasure</b><span>The complete map points to this cove. Press F near the beach to dig.</span><em>${map._bearing?.(site.x, site.z) || ''}</em>`);
    }
    if (L.lords !== false) for (const l of g.lords?.lairs?.() || []) {
      const [x, y] = map.w2s(l.x, l.z);
      ctx.fillStyle = l.defeated ? 'rgba(40,24,12,0.35)' : '#1e140c';
      ctx.beginPath(); ctx.arc(x, y - 2, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(x - 3, y + 1, 6, 4);
      ctx.fillStyle = '#e9d8ae'; ctx.fillRect(x - 2.6, y - 3, 1.8, 1.8); ctx.fillRect(x + 0.8, y - 3, 1.8, 1.8);
      if (!l.defeated) { ctx.strokeStyle = '#8e1b1b'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke(); }
      // “lair of the Red Widow”, “lair of Icewater, the Lantern and the Mute” (nicknames with their article)
      const dl = `lair of ${l.nicks || l.short}`;
      lab(dl, x, y, { prio: l.defeated ? 3 : 7, halfW: 8 }, `italic 11.5px 'Spectral', Georgia, serif`, l.defeated ? 'rgba(58,36,18,0.5)' : '#3a2412');
      map.hit?.(x, y, 14, `<b>${dl[0].toUpperCase() + dl.slice(1)}</b><span>${l.defeated ? 'Captain defeated, lair deserted' : 'Top 10 captain · his black sails prowl within 3.6 km'}</span><em>${map._bearing?.(l.x, l.z) || ''}</em>`);
    }
    ctx.restore();
  }

  // ---------------- duel (src/game/duel/duelScene.js) ----------------
  applyDuel(sim) {
    if (!sim?.player) return;
    const fx = this.fx, st = this.game.state, P = sim.player, E = sim.enemy;
    const age = Math.max(0, (st.age || 24) - AGEING.healthAgeFrom);
    P.windupMul = (P.windupMul || 1) * fx.duelWindup * (1 + age * AGEING.duelAgeSlow);
    if (fx.duelArmor) { P.hp += fx.duelArmor; P.maxHp += fx.duelArmor; }
    if (fx.duelPistol && Math.random() < fx.duelPistol && E.hp > 1) { E.hp -= 1; sim.pistolShot = true; }
  }
}
