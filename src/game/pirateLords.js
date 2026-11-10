// PirateLords — the Top 10 pirate captains (src/data/fortune.js PIRATE_LORDS). Each has a lair (a cove, or a
// Brethren of the Coast haven) and a ship, which puts to sea near the lair when the player approaches and cruises
// there. Defeating him (sinking, making him strike, boarding) strikes him off the ranking, brings gold + an item and
// raises the player in the Registry (src/ui/registry.js, L key).
// State: game.state.lords {id: { lair, defeated, how, date, next }}
// API (game.lords): ranking() -> [{ id|'player', name, nick, ship, fame, defeated, isPlayer, lairName }]
//   playerRank() -> 1..11 · playerFame() · lairs() -> [{x, z, short, defeated}] · spawnAvenger()
// Events: 'lord:spawn' {id, ship}, 'lord:defeated' {id, how}.
// Sea tiers: lairs per tier (ZONE_TIERS[t].lords: ranks 1–4 in perilous seas, 5–10 on the trade routes), never
// within LAIRS.minFromStart of a starting port nor in guarded waters; old saves reassigned once
// (state.lordsLairs = LAIRS.version). No captain puts to sea while the player is in guarded waters; the avenging
// pirate is the highest captain whose class fits under the pirate cap of the player's zone + 1, and he appears
// outside guarded waters.
import { PIRATE_LORDS, LORD_TUNING, PLAYER_FAME } from '../data/fortune.js';
import { SHIP_SPECS } from '../ships/shipModel.js';
import { GUARDED, LAIRS, ZONE_TIERS, capFor } from '../data/seaZones.js';   // sea tiers
import { classOf } from '../data/shipTypes.js';
import { fmtInt } from '../core/i18n.js';
import { inPrologue } from './notifyRules.js';

const dayNum = d => d.year * 372 + d.month * 31 + d.day;
export const ord = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
export const lordTitle = l => `${l.name}, known as ${l.nick}`;

export class PirateLords {
  constructor(game) {
    this.game = game;
    this._t = 0;
    this.ensure();
    const ev = game.events;
    ev.on('game:loaded', () => this.ensure());
    ev.on('ship:sunk', ({ ship } = {}) => this._onBeaten(ship, 'sunk'));
    ev.on('ship:struck', ({ ship } = {}) => this._onBeaten(ship, 'struck'));
    ev.on('boarding:end', ({ result, enemy } = {}) => { if (enemy && result && result !== 'defeat') this._onBeaten(enemy, 'boarded', true); });
  }

  ensure() {
    const s = this.game.state;
    s.lords ||= {};
    const sites = this.lairSites(), again = s.lordsLairs !== LAIRS.version;
    const used = { 2: 0, 3: 0 };
    PIRATE_LORDS.forEach((l, i) => {
      const e = s.lords[l.id] ||= { defeated: false };
      if (!sites.length || (e.lair && !again)) return;
      // sea tiers: the most feared in perilous seas, the others on the trade routes
      const want = ZONE_TIERS[3].lords.includes(i + 1) ? 3 : 2;
      let pool = sites.filter(x => x.tier === want); if (!pool.length) pool = sites;
      e.lair = pool[(used[want]++) % pool.length].key;
    });
    if (sites.length) s.lordsLairs = LAIRS.version;
  }
  // lair sites: Brethren of the Coast ports then coves, outside guarded waters and far from the starting ports
  lairSites() {
    const isl = this.game.islands, zs = this.game.seaZones;
    const ports = isl?.ports || [], start = ports.filter(p => GUARDED[p.id]).map(p => p.harborPoint || p);
    const out = [];
    for (const h of ports.filter(p => p.haven)) out.push({ key: `port:${h.id}`, x: h.harborPoint.x, z: h.harborPoint.z });
    for (const c of isl?.coves || []) out.push({ key: `cove:${c.id}`, x: c.anchorPoint.x, z: c.anchorPoint.z });
    return out.map(o => ({ ...o, tier: zs ? zs.tierAt(o.x, o.z) : 2 }))
      .filter(o => o.tier !== 1 && start.every(p => Math.hypot(p.x - o.x, p.z - o.z) >= LAIRS.minFromStart));
  }

  def(id) { return PIRATE_LORDS.find(l => l.id === id); }
  _lairPos(e) {
    const isl = this.game.islands;
    if (!e?.lair || !isl) return null;
    const [k, id] = e.lair.split(':');
    if (k === 'port') { const p = isl.ports.find(x => x.id === id); return p && { x: p.harborPoint.x, z: p.harborPoint.z, name: p.name, island: p.name }; }
    const c = isl.coves.find(x => x.id === id);
    return c && { x: c.anchorPoint.x, z: c.anchorPoint.z, beachX: c.x, beachZ: c.z, island: isl.getIsland?.(c.islandId)?.name || 'an island' };
  }
  lairs() {
    const s = this.game.state;
    // one mark per site: captains who share a lair are named together
    const by = new Map();
    for (const l of PIRATE_LORDS) {
      const e = s.lords[l.id], p = this._lairPos(e); if (!p) continue;
      const k = e.lair, o = by.get(k) || { x: p.beachX ?? p.x, z: p.beachZ ?? p.z, names: [], full: [], defeated: true };
      o.names.push(l.nick.replace(/^l[ae] |^l’/, '')); o.full.push(l.nick); o.defeated &&= !!e.defeated; by.set(k, o);
    }
    const list = n => n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0] || '';
    return [...by.values()].map(o => ({ ...o, short: list(o.names), nicks: list(o.full) }));   // nicks: nicknames with their article (“the Red Widow”)
  }
  alive(id) { return this.game.ships.find(sh => sh.lordId === id && sh.alive && !sh.sinking && !sh.struck) || null; }

  playerFame() {
    const s = this.game.state, P = PLAYER_FAME;
    const ranks = Object.values(s.rank || {}).reduce((a, b) => a + b, 0);
    const done = (s.missions || []).filter(m => m.status === 'done').length;
    let f = (s.captures || 0) * P.capture + ranks * P.rank + done * P.mission + (s.treasure?.found || 0) * P.treasure;
    for (const l of PIRATE_LORDS) if (s.lords?.[l.id]?.defeated) f += P.lord + l.fame * 0.5;
    return Math.round(f);
  }
  ranking() {
    const s = this.game.state;
    const rows = PIRATE_LORDS.map(l => ({ ...l, defeated: !!s.lords?.[l.id]?.defeated, lairName: this._lairPos(s.lords?.[l.id])?.island || '—' }));
    rows.push({ id: 'player', isPlayer: true, name: `Captain ${s.name}`, nick: '', ship: this.game.player?.name || '', fame: this.playerFame() });
    const standing = rows.filter(r => !r.defeated).sort((a, b) => b.fame - a.fame);
    return [...standing, ...rows.filter(r => r.defeated)];
  }
  playerRank() { return this.ranking().findIndex(r => r.isPlayer) + 1; }
  defeatedCount() { const s = this.game.state; return PIRATE_LORDS.filter(l => s.lords?.[l.id]?.defeated).length; }

  update(dt) {
    const g = this.game;
    if (g.mode !== 'sail' || !g.player || !(dt > 0)) return;
    this._t -= dt; if (this._t > 0) return;
    this._t = 3;
    const s = g.state, p = g.player.position, now = dayNum(s.date);
    if (g.seaZones?.tierAt(p.x, p.z) === 1) return;   // sea tiers: never a black sail in guarded waters
    if (this._avengerDue) { this._avengerDue = 0; this.spawnAvenger(); }   // avenger postponed until the player leaves guarded waters
    let n = PIRATE_LORDS.filter(l => this.alive(l.id)).length;
    for (const l of PIRATE_LORDS) {
      if (n >= LORD_TUNING.maxAlive) break;
      const e = s.lords[l.id];
      if (!e || e.defeated || this.alive(l.id) || (e.next && now < e.next)) continue;
      const lp = this._lairPos(e); if (!lp) continue;
      if (Math.hypot(lp.x - p.x, lp.z - p.z) > LORD_TUNING.spawnRange) continue;
      if (this._spawn(l, lp.x, lp.z, 250, 900)) n++;
    }
  }

  _spawn(l, cx, cz, r0, r1, hunt = false) {
    const g = this.game, c = g.combat;
    if (!c?.spawnAI) return null;
    let x, z, ok = false;
    for (let i = 0; i < 20 && !ok; i++) {
      const a = Math.random() * Math.PI * 2, d = r0 + Math.random() * (r1 - r0);
      x = cx + Math.cos(a) * d; z = cz + Math.sin(a) * d;
      ok = Math.abs(x) < 7600 && Math.abs(z) < 7600 && !g.islands?.isLand?.(x, z, 70) && !g.ships.some(s => Math.hypot(s.position.x - x, s.position.z - z) < 150)
        && g.seaZones?.tierAt(x, z) !== 1;   // sea tiers: never inside guarded waters
    }
    if (!ok) return null;
    const spec = SHIP_SPECS[l.type] || SHIP_SPECS.brig;
    const sh = c.spawnAI({ type: l.type, faction: 'pirate', role: hunt ? 'hunter' : 'pirate', x, z, heading: Math.random() * Math.PI * 2, sailSetting: 0.6, name: l.ship, crew: Math.round(spec.crewMax * LORD_TUNING.crewF) });
    sh.lordId = l.id; sh.gunPower = LORD_TUNING.gunPower;
    sh._captain = { name: lordTitle(l), faction: 'pirate', difficulty: l.difficulty, weapon: 'cutlass' };
    if (hunt && g.player) sh.ai?.setTarget?.(g.player);
    g.events.emit('lord:spawn', { id: l.id, ship: sh });
    // a lord sighted near his lair: news, not an emergency; dropped during the guided prologue (it would be stale)
    if (!hunt && !inPrologue(g)) g.events.emit('notify', { text: `A black sail near the lair: the ${l.ship}, ship of ${lordTitle(l)}.`, kind: 'bad', major: true, tone: 'bad', topic: 'lord' });
    return sh;
  }

  // After a treasure is dug up: the most feared captain still at sea comes to take it back.
  spawnAvenger() {
    const g = this.game, s = g.state, p = g.player;
    if (!p || g.mode === 'menu') return null;
    // sea tiers: the most feared whose class fits under the pirate cap of the player's zone + 1
    const zs = g.seaZones, tier = zs ? zs.tierAt(p.position.x, p.position.z) : 3;
    if (tier === 1) { this._avengerDue = 1; return null; }   // the player took refuge in guarded waters: he will wait offshore
    const top = capFor(tier, 'pirate').maxClass + 1;
    const l = PIRATE_LORDS.find(x => !s.lords[x.id]?.defeated && !this.alive(x.id) && classOf(x.type) <= top);
    let sh;
    if (l) sh = this._spawn(l, p.position.x, p.position.z, 1300, 1800, true);
    else {
      const c = g.combat; let x = p.position.x + 1500, z = p.position.z;
      if (g.islands?.isLand?.(x, z, 60)) x -= 3000;
      sh = c?.spawnAI?.({ type: 'raider', faction: 'pirate', role: 'hunter', x, z, heading: 0, name: 'Grudge', crew: 150 });
      sh?.ai?.setTarget?.(p);
    }
    if (sh) g.events.emit('notify', { text: `A black sail is cracking on in your wake: ${l ? lordTitle(l) : 'a pirate'} wants the treasure!`, kind: 'bad', major: true, tone: 'bad', topic: 'lord' });
    return sh;
  }

  _onBeaten(ship, how, boarded = false) {
    if (!ship?.lordId) return;
    const g = this.game, s = g.state, e = s.lords?.[ship.lordId], l = this.def(ship.lordId);
    if (!e || !l) return;
    if (!boarded && !ship.lastAttacker?.isPlayer) {   // sunk by someone else: he will put to sea again later
      if (how === 'sunk') e.next = dayNum(s.date) + LORD_TUNING.respawnDays;
      return;
    }
    if (e.defeated) return;
    const before = this.playerRank();
    e.defeated = true; e.how = how; e.date = { ...s.date };
    const gold = Math.round(LORD_TUNING.goldBonus[0] + Math.random() * (LORD_TUNING.goldBonus[1] - LORD_TUNING.goldBonus[0]));
    s.gold += gold; s.plunder = (s.plunder || 0) + Math.round(gold * 0.5);
    const it = g.fortune?.giveRandomItem?.(2);
    const after = this.playerRank();
    g.events.emit('lord:defeated', { id: l.id, how });
    g.events.emit('notify', { text: `${lordTitle(l)} is defeated! The bounty: ${fmtInt(gold)} gold${it ? ', and an item from the cabin' : ''}. You ${after < before ? `move up from ${ord(before)} to ${ord(after)} place` : `stay in ${ord(after)} place`} in the Ledger (L).`, kind: 'good', major: true, topic: 'lord' });
  }
}
