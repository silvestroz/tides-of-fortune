// LivingWorld (game.living): dynamic diplomacy, pirate hunters tied to infamy, protectionism and smuggling,
// announced convoys that really sail, the barman's rumours and the barmaid's tips, towns that change
// (population, prosperity, garrison). Settings: src/data/living.js.
// State (recreated by ensure(), old saves stay valid):
//   state.diplomacy { rel: {'a|b': -1|0|1}, since: {'a|b': day}, next: day }
//   state.towns     { portId: { pop, prosper, garrison, note, noteDay } }
//   state.convoys   [{ id, faction, from, to, treasure, depart, arrive, status:'planned'|'taken'|'arrived', known }]
//   state.news      [{ day, text, kind }]   (last 12)
//   state.hunters   { nation: next sea-time instant (s) }   state.living { month, convoyNext, seaT }
// API: relationsChanged · rumours(port) · tips(port) · governorOffers(port) · acceptOffer(port, key) (envoy
//   mission, kind 'envoy') · deliverEnvoy(m, port) · envoyFor(a, b)
//   protectionist(port) · contrabandHere(port) · smuggle(port, good) · town(port) · wealth(port) · drawMap(ctx, map)
//   startEpoch(id) (new game: date, diplomacy, the epoch's ships — src/data/creation.js)
// Events: 'diplomacy:change' {a, b, from, to}, 'hunter:spawn' {ship, nation}, 'convoy:spawn' {convoy, ship}.
import { RELATIONS, relation, getReputation, changeReputation } from '../combat/factions.js';
import { DIPLOMACY, INFAMY, MARKETS, CONVOYS, TOWNS } from '../data/living.js';
import { LAND } from '../data/landbattle.js';
import { NATIONS, SECONDS_PER_DAY } from './career.js';
import { quote, sell } from './economy.js';
import { GOODS } from '../data/world.js';
import { SHIP_SPECS } from '../ships/shipModel.js';
import { classOf } from '../data/shipTypes.js';   // sea tiers
import { getPace } from '../ships/ship.js';
import { a as article, nationPeople, nationAdj, shipDesc, fmtInt, NBSP, MONTHS } from '../core/i18n.js';
import { mulberry32, hashString } from '../core/rng.js';
import { epochOf, applyEpochShips } from '../data/creation.js';   // character creation: starting epoch

const DEFAULT_REL = JSON.parse(JSON.stringify(RELATIONS));   // starting relations (new game)
const dayNum = d => d.year * 372 + d.month * 31 + d.day;
const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const PAIRS = []; for (let i = 0; i < NATIONS.length; i++) for (let j = i + 1; j < NATIONS.length; j++) PAIRS.push([NATIONS[i], NATIONS[j]]);
const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const dirOf = (dx, dz) => DIRS[Math.round(((Math.atan2(dx, -dz) / (Math.PI * 2)) * 8 + 8)) % 8];
const leagues = d => { const l = Math.max(1, Math.round(d / 1000)); return l === 1 ? 'one league' : `${l}${NBSP}leagues`; };

export class LivingWorld {
  constructor(game) {
    this.game = game;
    this._t = 0; this._wpT = 0;
    this.convoyShips = new Map();   // convoy id -> ship (runtime)
    this.ensure();
    const ev = game.events;
    ev.on('game:loaded', () => { this.convoyShips.clear(); this.ensure(); });
    ev.on('career:day', () => this._onDay());
    ev.on('ship:sunk', ({ ship } = {}) => this._onLost(ship));
    ev.on('ship:struck', ({ ship } = {}) => this._onLost(ship));
    ev.on('boarding:end', ({ result, enemy } = {}) => { if (enemy && result && result !== 'defeat') this._onLost(enemy); });
  }

  get today() { return dayNum(this.game.state.date); }

  ensure() {
    const s = this.game.state, now = this.today;
    s.diplomacy ||= { rel: {}, since: {}, next: now + DIPLOMACY.checkEvery };
    for (const [a, b] of PAIRS) { const k = key(a, b); s.diplomacy.rel[k] ??= DEFAULT_REL[a][b]; s.diplomacy.since[k] ??= now - 200; }
    this._applyRelations();
    s.towns ||= {};
    for (const p of this.game.islands?.ports || []) {
      p._basePop ??= p.population;
      p._baseFaction ??= p.faction;   // nation of origin (another loaded game may not have conquered the town)
      const t = s.towns[p.id] ||= { pop: p.population, prosper: 1, garrison: p.haven ? 20 : TOWNS.garrisonBase[p.size] || 50 };
      p.population = t.pop;
      this._hoist(p, t.faction || p._baseFaction);   // conquered town (governor installed)
    }
    s.convoys ||= []; s.news ||= []; s.hunters ||= {};
    applyEpochShips(s.epoch);   // character creation: the epoch's traffic and shipyard (no epoch: golden age, tables unchanged)
    s.living ||= {};
    s.living.townDay ??= now;   // towns roll once per calendar day (was: per month)
    s.living.convoyNext ??= now;
    s.living.seaT ??= 0;
    if (!s.convoys.some(c => c.status === 'planned')) this._planConvoys(true);
  }

  _applyRelations() {
    const rel = this.game.state.diplomacy.rel;
    for (const [a, b] of PAIRS) { const v = rel[key(a, b)]; RELATIONS[a][b] = v; RELATIONS[b][a] = v; }
  }

  news(text, kind = 'info') {
    const s = this.game.state;
    s.news.unshift({ day: this.today, text, kind });
    if (s.news.length > 12) s.news.length = 12;
  }

  // ------------------------------------------------------------------ diplomatie
  _setRelation(a, b, v, why, quiet = false) {   // quiet: starting diplomacy (startEpoch), no news and no message
    const s = this.game.state, k = key(a, b), from = s.diplomacy.rel[k];
    if (from === v) return;
    s.diplomacy.rel[k] = v; s.diplomacy.since[k] = this.today;
    this._applyRelations();
    if (quiet) { this.game.events.emit('diplomacy:change', { a, b, from, to: v, why }); return; }
    const A = nationPeople(a), B = nationPeople(b);
    const text = v < 0 ? `War! The ${A} and the ${B} have broken the peace.` : v > 0 ? `Alliance: the ${A} and the ${B} join their fleets.`
      : from < 0 ? `Peace signed between the ${A} and the ${B}${why === 'player' ? ', thanks to your good offices' : ''}.` : `The alliance between the ${A} and the ${B} has come to an end.`;
    this.news(text, v < 0 ? 'war' : 'peace');
    this.game.events.emit('diplomacy:change', { a, b, from, to: v, why });
    this._envoysOnChange(a, b, v, why);
    this.game.events.emit('notify', { text, kind: v < 0 ? 'bad' : 'info', major: v !== 0, tone: v < 0 ? 'bad' : 'good', topic: 'diplomacy' });
    this._checkLetters();
  }

  // character creation: starting epoch of a new game (src/data/creation.js EPOCHS) — date, initial diplomacy
  // (default relations then the epoch's, set silently by _setRelation and dated 200 days back), the epoch's traffic
  // and shipyard. Days already counted follow the change of date.
  startEpoch(id) {
    const s = this.game.state, ep = epochOf(id), before = this.today;
    s.date = { year: ep.year, month: s.date?.month || 6, day: s.date?.day || 1 };
    const d = this.today - before;
    if (d) {
      s.diplomacy.next += d; for (const k in s.diplomacy.since) s.diplomacy.since[k] += d;
      s.living.townDay += d; s.living.convoyNext += d;
      for (const c of s.convoys) { c.depart += d; c.arrive += d; }
      for (const n of s.news) n.day += d;
      for (const t of Object.values(s.towns)) if (t.noteDay != null) t.noteDay += d;
      for (const t of Object.values(s.taverns || {})) if (t?.t != null) t.t += d;
    }
    const want = {};
    for (const [a, b] of PAIRS) want[key(a, b)] = DEFAULT_REL[a][b];
    for (const [a, b, v] of ep.rel || []) want[key(a, b)] = v;
    for (const [a, b] of PAIRS) { this._setRelation(a, b, want[key(a, b)], 'epoch', true); s.diplomacy.since[key(a, b)] = this.today - 200; }
    // announced convoys between two nations now at war: rescheduled
    const fac = id => this._portById(id)?.faction;
    s.convoys = s.convoys.filter(c => c.status !== 'planned' || relation(fac(c.from), fac(c.to)) >= 0);
    this._planConvoys(true);
    applyEpochShips(ep.id);
    return ep;
  }

  // a letter of marque is only valid against the enemies of the nation that signed it
  _checkLetters() {
    const g = this.game, s = g.state, pf = g.player?.faction;
    for (const n of Object.keys(s.letters || {})) {
      if (!s.letters[n]) continue;
      const atWar = NATIONS.some(o => o !== n && relation(n, o) < 0);
      const vsFlag = pf && pf !== 'pirate' && pf !== n && relation(n, pf) < 0;
      if (!atWar || vsFlag) {
        delete s.letters[n];
        g.events.emit('notify', { text: `Your letter of marque from the ${nationPeople(n)} has lapsed: ${vsFlag ? 'they are now at war with your flag' : 'they are no longer at war with anyone'}.`, kind: 'bad' });
      }
    }
  }

  _rollDiplomacy() {
    const s = this.game.state, now = this.today, r = Math.random;
    const cands = [];
    for (const [a, b] of PAIRS) {
      const k = key(a, b), v = s.diplomacy.rel[k], age = now - (s.diplomacy.since[k] ?? 0);
      if (v < 0 && age >= DIPLOMACY.minWarDays) cands.push([a, b, 0, DIPLOMACY.peaceChance]);
      if (v === 0 && age >= DIPLOMACY.minPeaceDays) { cands.push([a, b, -1, DIPLOMACY.warChance / 2]); cands.push([a, b, 1, DIPLOMACY.allyChance / 2]); }
      if (v > 0 && age >= DIPLOMACY.minPeaceDays) cands.push([a, b, 0, DIPLOMACY.breakChance]);
    }
    // a nation with no war at all is quicker to find one (the world doesn't fall asleep)
    const wars = PAIRS.filter(([a, b]) => s.diplomacy.rel[key(a, b)] < 0).length;
    for (const c of cands) if (c[2] < 0) c[3] *= wars === 0 ? 4 : wars >= 3 ? 0.3 : 1;
    for (const c of cands.sort(() => r() - 0.5)) if (r() < c[3]) { this._setRelation(c[0], c[1], c[2]); return; }
  }

  // the governor proposes: carry peace to an enemy, or seal an alliance. It is an envoy mission
  // (state.missions, kind 'envoy', career.js system): the treaty is only signed when the letter is delivered.
  governorOffers(port) {
    const g = this.game, s = g.state, N = port.faction;
    if (port.haven || !NATIONS.includes(N)) return [];
    const out = [], rep = n => getReputation(g, n), rank = s.rank?.[N] || 0;
    for (const M of NATIONS) {
      if (M === N || this.envoyFor(N, M)) continue;
      const v = relation(N, M), age = this.today - (s.diplomacy.since[key(N, M)] ?? 0);
      const peace = v < 0 && age >= DIPLOMACY.offerWarDays && rep(N) >= DIPLOMACY.peaceRepMin && rep(M) >= DIPLOMACY.otherRepMin;
      const ally = v === 0 && rank >= DIPLOMACY.allyRank && rep(N) >= DIPLOMACY.allyRepMin && rep(M) >= DIPLOMACY.allyOtherRepMin;
      if (!peace && !ally) continue;
      const to = this._envoyTarget(port, M); if (!to) continue;
      const days = to.d > DIPLOMACY.envoyFar ? DIPLOMACY.envoyFarDays : DIPLOMACY.envoyDays, P = nationPeople(M);
      if (peace) out.push({ key: `peace:${M}`, kind: 'peace', other: M, to: to.port.id, toName: to.port.name, days, title: `Carry peace to the ${P}`, reward: DIPLOMACY.peaceReward,
        text: `“The war against the ${P} is ruining our planters. You have their ear, captain: carry our proposals to the governor of ${to.port.name} within ${days}${NBSP}days.” The peace will only be signed when the letter is delivered.` });
      else out.push({ key: `ally:${M}`, kind: 'ally', other: M, to: to.port.id, toName: to.port.name, days, title: `Seal an alliance with the ${P}`, reward: DIPLOMACY.allyReward,
        text: `“United with the ${P}, we would hold these seas. Hand this letter to the governor of ${to.port.name} within ${days}${NBSP}days: your renown will open many doors.”` });
    }
    return out.slice(0, 2);
  }
  // envoy mission under way between two nations (in either direction)
  envoyFor(a, b) {
    return (this.game.state.missions || []).find(m => m.kind === 'envoy' && m.status === 'active' && ((m.nation === a && m.other === b) || (m.nation === b && m.other === a))) || null;
  }
  // destination port: the nearest of nation M that would not have the captain arrested
  _envoyTarget(port, M) {
    const g = this.game, hp = port.harborPoint || port;
    const c = (g.islands?.ports || []).filter(q => q !== port && !q.haven && q.faction === M && g.ports?.attitude?.(q).cls !== 'hostile')
      .map(q => ({ port: q, d: Math.hypot((q.harborPoint || q).x - hp.x, (q.harborPoint || q).z - hp.z) })).sort((a, b) => a.d - b.d);
    return c[0] || null;
  }
  acceptOffer(port, k) {
    const g = this.game, o = this.governorOffers(port).find(x => x.key === k);
    if (!o || !g.career) return false;
    const today = this.today, N = port.faction;
    const m = { id: `env${port.id}${today}_${o.other}`, kind: 'envoy', diplo: o.kind, nation: N, other: o.other, from: port.id, to: o.to, toName: o.toName,
      title: o.kind === 'peace' ? `Peace with the ${nationPeople(o.other)}: letter for ${o.toName}` : `Alliance with the ${nationPeople(o.other)}: letter for ${o.toName}`,
      text: o.text, reward: o.reward || 0, rep: DIPLOMACY.envoyRep, merit: o.kind === 'peace' ? DIPLOMACY.peaceMerit : DIPLOMACY.allyMerit,
      status: 'offer', days: o.days, deadline: today + o.days };
    if (!g.career.accept(m)) {
      g.events.emit('notify', { text: `You already have three missions under way: the governor keeps his letter.`, kind: 'bad' });
      return false;
    }
    g.events.emit('notify', { text: `The governor seals the letter with red wax. Hand it to the governor of ${o.toName} (or of any ${nationAdj(o.other)} port) before ${dayLabel(m.deadline)}.`, kind: 'info', topic: 'diplomacy' });
    return true;
  }
  // delivery of the letter (career._onPort, on entering a port of the recipient nation)
  deliverEnvoy(m, port) {
    const g = this.game;
    if (m.status !== 'active' || port.haven || port.faction !== m.other) return false;
    if (g.ports?.attitude?.(port).cls === 'hostile') {   // soldiers on the quay: the letter will never be delivered
      m.status = 'failed'; changeReputation(g, m.nation, -6, 'mission-failed');
      g.events.emit('career:mission', { mission: m, status: 'failed' });
      g.events.emit('notify', { text: `At ${port.name}, the ${nationPeople(m.other)} hold you for an enemy: the governor refuses to receive you. Mission failed: ${m.title}.`, kind: 'bad' });
      return false;
    }
    const v = relation(m.nation, m.other), want = m.diplo === 'peace' ? 0 : 1;
    if (v < want) this._setRelation(m.nation, m.other, want, 'player');
    changeReputation(g, m.other, DIPLOMACY.envoyOtherRep, 'diplomacy');
    g.events.emit('notify', { text: m.diplo === 'peace' ? `The governor of ${port.name} breaks the seal, reads at length, then signs: peace is made between the ${nationPeople(m.nation)} and the ${nationPeople(m.other)}.`
      : `The governor of ${port.name} sets his seal beneath that of his counterpart: the ${nationPeople(m.nation)} and the ${nationPeople(m.other)} are allies.`, kind: 'good', topic: 'diplomacy' });
    g.career._complete(m);
    return true;
  }
  // the world doesn't wait for the envoy: treaty signed without him, or a war that voids the alliance
  _envoysOnChange(a, b, to, why) {
    if (why === 'player') return;
    for (const m of this.game.state.missions || []) {
      if (m.kind !== 'envoy' || m.status !== 'active' || !((m.nation === a && m.other === b) || (m.nation === b && m.other === a))) continue;
      const moot = m.diplo === 'peace' ? to >= 0 : to !== 0;
      if (!moot) continue;
      m.status = 'void';
      this.game.events.emit('career:mission', { mission: m, status: 'void' });
      this.game.events.emit('notify', { text: m.diplo === 'peace' && to >= 0 ? `Peace was made without you between the ${nationPeople(m.nation)} and the ${nationPeople(m.other)}: your letter is void.`
        : to < 0 ? `War has broken out between the ${nationPeople(m.nation)} and the ${nationPeople(m.other)}: the alliance plan is buried, and your letter with it.`
        : `The alliance was concluded without you: your letter is void.`, kind: 'info', topic: 'diplomacy' });
    }
  }

  // ------------------------------------------------------------------ towns
  // Aftermath of an assault (landBattle.js). Victory: garrison reduced, prosperity and population down, possible
  // change of nation (state.towns[id].faction, reapplied on load). Defeat: garrison losses.
  assaulted(port, { won = false, killed = 0, newFaction = null } = {}) {
    const t = this.game.state.towns?.[port.id]; if (!t) return;
    const L = LAND.town;
    if (won) {
      t.garrison = Math.min(t.garrison, L.garrisonLeft); t.prosper = Math.max(0.5, t.prosper + L.prosper);
      t.pop = Math.round(t.pop * L.pop); port.population = t.pop;
      if (newFaction) { t.faction = newFaction; this._hoist(port, newFaction); }
      t.note = newFaction ? 'conquered' : 'plundered'; t.noteDay = this.today;   // the news is published by the caller
    } else t.garrison = Math.max(5, Math.round(t.garrison - killed * L.repulsed));
  }
  // changes a port's nation and hoists its colours at sea (fort, square, ships at anchor: towns.setPortFaction);
  // chart, minimap and port screen read port.faction live.
  _hoist(port, faction) {
    if (!faction) return;
    port.faction = faction;
    try { this.game.islands?.towns?.setPortFaction?.(port); } catch (e) { console.warn('flag repaint failed', e); }
  }
  dateLabel(n) { return dayLabel(n); }   // “12 March” (mission deadlines, governor's screen)
  town(port) { return this.game.state.towns?.[port.id] || { pop: port.population, prosper: 1, garrison: 50 }; }
  wealth(port) {
    const t = this.town(port);
    const base = { small: 2, medium: 3, large: 4 }[port.size] || 3;
    return Math.max(1, Math.min(5, base + (t.pop > 5000 ? 1 : 0) - (port.haven ? 1 : 0) + Math.round((t.prosper - 1) * 2.5)));
  }
  townNote(port) { const t = this.town(port); return t.note && this.today - (t.noteDay || 0) <= TOWNS.noteDays ? t.note : null; }

  _monthTick() {
    const g = this.game, s = g.state, r = Math.random;
    for (const p of g.islands?.ports || []) {
      const t = s.towns[p.id]; if (!t) continue;
      const atWar = !p.haven && NATIONS.some(o => o !== p.faction && relation(p.faction, o) < 0);
      const gBase = p.haven ? 20 : (TOWNS.garrisonBase[p.size] || 50) + (atWar ? TOWNS.garrisonWar : 0);
      t.garrison = Math.round(t.garrison + (gBase - t.garrison) * 0.25);
      t.prosper += (1 - t.prosper) * TOWNS.recover;
      t.pop = Math.round(t.pop * (1 + TOWNS.growth * t.prosper));
      const raidRisk = TOWNS.raid * (atWar ? 2 : 1) * (t.garrison < 40 ? 2 : 1) * (p.haven ? 0 : 1);
      const x = r();
      if (x < TOWNS.epidemic) {
        const loss = 0.1 + r() * 0.12; t.pop = Math.round(t.pop * (1 - loss)); t.prosper = Math.max(0.5, t.prosper - 0.12);
        this._townEvent(p, t, 'epidemic', `Yellow fever strikes ${p.name}: ${fmtInt(Math.round(t.pop * loss))} souls carried off.`);
      } else if (x < TOWNS.epidemic + raidRisk) {
        t.pop = Math.round(t.pop * (0.88 + r() * 0.07)); t.prosper = Math.max(0.5, t.prosper - 0.2); t.garrison = Math.max(5, t.garrison - 20);
        this._townEvent(p, t, 'plundered', `Freebooters have plundered ${p.name}. The garrison is decimated.`);
      } else if (x < TOWNS.epidemic + raidRisk + TOWNS.boom) {
        t.prosper = Math.min(1.5, t.prosper + 0.15); t.pop = Math.round(t.pop * 1.04);
        this._townEvent(p, t, 'booming', `${p.name} prospers: settlers and merchants flock there.`);
      }
      t.pop = Math.max(150, Math.min((p._basePop || t.pop) * 2.2, t.pop));
      p.population = t.pop;
    }
  }
  _townEvent(p, t, note, text) {
    t.note = note; t.noteDay = this.today;
    this.news(text, 'town');
  }

  // ------------------------------------------------------------------ markets
  playerFlagAtWar(port) { const pf = this.game.player?.faction; return !!pf && pf !== 'pirate' && relation(pf, port.faction) < 0 && !this.game.state.letters?.[port.faction]; }
  protectionist(port) { return !port.haven && NATIONS.includes(port.faction) && this.wealth(port) >= MARKETS.protectWealth && (this.playerFlagAtWar(port) || getReputation(this.game, port.faction) < -10); }
  contrabandHere(port) { return !port.haven && this.wealth(port) <= MARKETS.contrabandWealth && !!this.game.ports?.locked(port, 'market'); }
  contrabandPrice(port, good) { return Math.max(1, Math.round(quote(this.game, port, good).sell * MARKETS.contrabandCut)); }
  smuggle(port, good) {
    const g = this.game, st = g.state, have = st.cargo?.[good] || 0;
    if (!have || !this.contrabandHere(port)) return 0;
    const g0 = st.gold; sell(g, port, good, have);
    const got = st.gold - g0, keep = Math.round(got * MARKETS.contrabandCut);
    st.gold = g0 + keep;
    if (st.ledger) { st.ledger.profit -= got - keep; st.ledger.earned -= got - keep; }
    g.events.emit('notify', { text: `The smuggler carries off ${have} ${GOODS[good].unitPl || 'lots'} of ${GOODS[good].name.toLowerCase()} by the back door: ${keep} gold.`, kind: 'good' });
    return have;
  }

  // ------------------------------------------------------------------ convois
  _ports() { return (this.game.islands?.ports || []).filter(p => !p.haven && p.harborPoint); }
  _planConvoys(initial = false) {
    const s = this.game.state, now = this.today, ports = this._ports();
    const active = s.convoys.filter(c => c.status === 'planned' && c.arrive >= now).length;
    s.convoys = s.convoys.filter(c => c.status === 'planned' ? c.arrive >= now - 2 : now - c.arrive < 60).slice(-12);
    if (ports.length < 2) return;
    const spec = SHIP_SPECS.merchantman, perDay = spec.maxSpeed * CONVOYS.speed * getPace(this.game) * SECONDS_PER_DAY;
    for (let n = active; n < CONVOYS.maxPlanned; n++) {
      const from = ports[Math.floor(Math.random() * ports.length)];
      const to = ports.filter(p => p !== from && relation(p.faction, from.faction) >= 0 && Math.hypot(p.harborPoint.x - from.harborPoint.x, p.harborPoint.z - from.harborPoint.z) > CONVOYS.minDist);
      if (!to.length) continue;
      const dst = to[Math.floor(Math.random() * to.length)];
      const dist = Math.hypot(dst.harborPoint.x - from.harborPoint.x, dst.harborPoint.z - from.harborPoint.z);
      const depart = now + (initial && n === 0 ? -1 : CONVOYS.leadMin + Math.floor(Math.random() * (CONVOYS.leadMax - CONVOYS.leadMin)));
      s.convoys.push({ id: `cv${now}_${n}_${Math.floor(Math.random() * 1e4)}`, faction: from.faction, from: from.id, to: dst.id,
        treasure: from.faction === 'spanish' && Math.random() < CONVOYS.treasure, depart, arrive: depart + Math.max(1, Math.ceil(dist * 1.25 / perDay)), status: 'planned', known: false });
    }
  }
  _portById(id) { return this.game.islands?.ports?.find(p => p.id === id); }
  convoyPos(c, day = this.today + this._dayFrac()) {
    const a = this._portById(c.from)?.harborPoint, b = this._portById(c.to)?.harborPoint;
    if (!a || !b) return null;
    const t = Math.max(0, Math.min(1, (day - c.depart) / Math.max(1, c.arrive - c.depart)));
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, t, a, b };
  }
  _dayFrac() { return Math.min(0.99, this.game.career?.dayFrac?.() ?? 0); }   // hour of the sky clock
  _updateConvoys() {
    const g = this.game, p = g.player?.position, now = this.today;
    if (!p || !g.combat?.spawnConvoy) return;
    for (const c of g.state.convoys) {
      if (c.status !== 'planned') continue;
      if (now > c.arrive) { c.status = 'arrived'; continue; }
      if (now < c.depart) continue;
      const sh = this.convoyShips.get(c.id);
      if (sh && g.ships.includes(sh)) continue;
      if (sh) this.convoyShips.delete(c.id);   // dispersed out of sight: it will resume its route
      const pos = this.convoyPos(c); if (!pos) continue;
      const d = Math.hypot(pos.x - p.x, pos.z - p.z);
      if (d > CONVOYS.spawnRange || d < 900) continue;
      // nearest open water along the route
      let x = pos.x, z = pos.z, ok = false;
      for (let k = 0; k < 12 && !ok; k++) {
        const tt = Math.min(1, pos.t + k * 0.02);
        x = pos.a.x + (pos.b.x - pos.a.x) * tt + (k % 2 ? 120 : -120) * (k > 6 ? 1 : 0); z = pos.a.z + (pos.b.z - pos.a.z) * tt;
        ok = !g.islands?.isLand?.(x, z, 80);
      }
      if (!ok) continue;
      const heading = Math.atan2(pos.b.x - x, -(pos.b.z - z));
      const { charge } = g.combat.spawnConvoy({ faction: c.faction, x, z, heading, treasure: c.treasure });
      charge.convoyId = c.id;
      const to = this._portById(c.to);
      if (charge.ai) charge.ai.waypoint = { x: to.harborPoint.x, z: to.harborPoint.z, port: to };
      this.convoyShips.set(c.id, charge);
      g.events.emit('convoy:spawn', { convoy: c, ship: charge });
      if (c.known) g.events.emit('notify', { text: `Sails on the horizon: the ${nationAdj(c.faction)} convoy announced at the tavern is heading for ${to.name}.`, kind: 'info', topic: 'rumour' });
    }
  }
  _onLost(ship) {
    if (!ship?.convoyId) return;
    const c = this.game.state.convoys.find(x => x.id === ship.convoyId);
    if (c && c.status === 'planned') { c.status = 'taken'; this.convoyShips.delete(c.id); }
  }

  // ------------------------------------------------------------------ pirate hunters
  infamy(n) { return Math.max(0, -getReputation(this.game, n)); }
  hunters(n) { return this.game.ships.filter(s => s.hunterOf === n && s.alive && !s.sinking && !s.sunk && !s.struck); }
  _updateHunters(dt) {
    const g = this.game, s = g.state, pl = g.player;
    s.living.seaT += dt;
    const T = s.living.seaT;
    for (const n of NATIONS) {
      const inf = this.infamy(n);
      if (inf < INFAMY.threshold) { delete s.hunters[n]; continue; }
      s.hunters[n] ??= T + INFAMY.firstDelay;
      const heavy = inf >= INFAMY.heavy;
      if (T < s.hunters[n] || this.hunters(n).length >= (heavy ? 2 : 1)) continue;
      if (this._spawnHunter(n, heavy)) s.hunters[n] = T + INFAMY.cooldown;
      else s.hunters[n] = T + 10;
    }
    // hunters follow the player's track
    this._wpT -= dt;
    if (this._wpT <= 0 && pl) {
      this._wpT = 4;
      for (const sh of g.ships) if (sh.hunterOf && sh.ai && sh.ai.state === 'cruise' && !g.seaZones?.forbids(sh, pl.position.x, pl.position.z, pl)) sh.ai.waypoint = { x: pl.position.x, z: pl.position.z };
    }
  }
  _spawnHunter(n, heavy) {
    const g = this.game, p = g.player, c = g.combat;
    if (!p || !c?.spawnAI) return null;
    let x, z, ok = false;
    for (let k = 0; k < 20 && !ok; k++) {
      const a = Math.random() * Math.PI * 2, d = INFAMY.spawnMin + Math.random() * (INFAMY.spawnMax - INFAMY.spawnMin);
      x = p.position.x + Math.cos(a) * d; z = p.position.z + Math.sin(a) * d;
      ok = Math.abs(x) < 7600 && Math.abs(z) < 7600 && !g.islands?.isLand?.(x, z, 80);
    }
    if (!ok) return null;
    // sea tiers: hunters capped by the player's zone (src/data/seaZones.js, cap.hunter)
    const capC = g.seaZones?.cap(g.seaZones.tierAt(p.position.x, p.position.z), 'hunter').maxClass ?? 5;
    let pool = INFAMY.types[heavy ? 1 : 0].filter(t => SHIP_SPECS[t] && classOf(t) <= capC);
    if (!pool.length) pool = INFAMY.types[0].filter(t => SHIP_SPECS[t] && classOf(t) <= capC);
    if (!pool.length) pool = ['brig'];
    const type = pool[Math.floor(Math.random() * pool.length)] || 'frigate';
    const NAMES = { english: ['Retribution', 'Avenger', 'Nemesis'], spanish: ['Justicia', 'Castigo', 'San Miguel'], french: ['Le Justicier', 'La Vengeance', 'Le Redoutable'], dutch: ['Wraak', 'Gerechtigheid', 'Zwaard'] };
    const nm = NAMES[n] || NAMES.english;
    const sh = c.spawnAI({ type, faction: n, role: 'hunter', x, z, heading: Math.atan2(p.position.x - x, -(p.position.z - z)), sailSetting: 0.9,
      name: nm[Math.floor(Math.random() * nm.length)], crew: Math.round(SHIP_SPECS[type].crewMax * 0.9) });
    sh.hunterOf = n;
    sh.grudges?.add(p);
    if (sh.ai) sh.ai.waypoint = { x: p.position.x, z: p.position.z };
    g.events.emit('hunter:spawn', { ship: sh, nation: n });
    g.events.emit('notify', { text: `${article(`${nationAdj(n)} pirate hunter`).replace(/^a/, 'A')}, ${article(shipDesc(null, type))} named ${sh.name}, is on your trail. There is a price on your head among the ${nationPeople(n)}.`, kind: 'bad' });
    return sh;
  }

  // ------------------------------------------------------------------ tavern
  // The facts come from the world (planned convoys, Top 10 captains, news, wars); only the wording changes, drawn
  // from a second generator (v) so as not to shift the draws of the first one (r), which pick the facts.
  rumours(port, extra = 0) {
    const g = this.game, s = g.state, now = this.today;
    const seed = ((now / 4) | 0) * 977 + hashString(port.id) + extra * 31;
    const r = mulberry32(seed), v = mulberry32(seed + 40503), pk = a => a[Math.floor(v() * a.length)];
    const out = [];
    // the real convoy nearest in time
    const cv = s.convoys.filter(c => c.status === 'planned' && c.arrive > now + 2).sort((a, b) => Math.abs(a.depart - now) - Math.abs(b.depart - now));
    if (cv.length) {
      const c = cv[Math.floor(r() * Math.min(2, cv.length))], a = this._portById(c.from), b = this._portById(c.to);
      c.known = true;
      const when = c.depart > now ? `will sail from ${a.name} ${c.depart - now > 1 ? `in ${c.depart - now}${NBSP}days` : 'tomorrow'}` : `left ${a.name} ${now - c.depart}${NBSP}day${now - c.depart > 1 ? 's' : ''} ago`;
      const what = c.treasure ? 'a Spanish treasure galleon, escorted by two men-of-war,' : `${article(`${nationAdj(c.faction)} merchant convoy`)}`;
      const What = what[0].toUpperCase() + what.slice(1), date = dayLabel(c.arrive);
      out.push({ who: 'the barman', convoy: c.id, text: pk([
        `${What} ${when}, bound for ${b.name}. Expected to arrive around ${date}.`,
        `My brother-in-law rolls barrels on the quay: ${what} ${when}, heading for ${b.name}. They expect it there around ${date}.`,
        `${What} ${when} for ${b.name}. The underwriters of ${a.name} are betting on an arrival around ${date}.`,
        `Keep this to yourself: ${what} ${when}, on the road to ${b.name}. It should anchor there around ${date}.`,
      ]) });
    }
    // Top 10 captains
    const lords = g.lords?.ranking?.().filter(x => !x.isPlayer && !x.defeated) || [];
    if (lords.length) {
      const l = lords[Math.floor(r() * Math.min(5, lords.length))];
      const ship = l.ship ? `“${l.ship}”` : null;
      out.push({ who: 'the barman', text: pk([
        `${l.name}, known as ${l.nick}, has been sighted near ${l.lairName}${ship ? `, aboard the ship ${ship}` : ''}. That captain never goes out without a loaded broadside.`,
        `${l.nick} — ${l.name} in the King’s registers — prowls around ${l.lairName}. Those who have crossed him speak of it only in whispers.`,
        `A fisherman swears he saw ${ship ? `the ${ship}` : 'the ship'} of ${l.name}, known as ${l.nick}, anchoring near ${l.lairName}. He has cast his nets elsewhere ever since.`,
        `${l.name}, known as ${l.nick}, has again left a whole crew on a waterless islet. His lair is near ${l.lairName}, or so they say.`,
      ]) });
    }
    // wars and news
    const recent = s.news.filter(x => now - x.day < 120);
    if (recent.length) out.push({ who: 'the barman', text: recent[Math.floor(r() * Math.min(3, recent.length))].text });
    else {
      const wars = PAIRS.filter(([a, b]) => relation(a, b) < 0), list = wars.map(([a, b]) => `${nationPeople(a)} against ${nationPeople(b)}`).join(', ');
      out.push({ who: 'the barman', text: wars.length ? pk([
        `The fighting goes on: ${list}.`,
        `The recruiters are scouring the quays. ${list}: the war is not about to end.`,
        `The underwriters have doubled their premiums: ${list}. Good times for privateers.`,
      ]) : pk([
        'Not one war in the whole archipelago: the privateers are idle.',
        'Peace everywhere. The privateer captains gamble their letters of marque at dice.',
        'Not a gunshot for weeks. Bad weather for privateers, fair weather for merchants.',
      ]).replace(' : ', `: `) });
    }
    return out;
  }
  // the barmaid: rich ships nearby (real ships at sea or convoys under way)
  tips(port, n = 1) {
    const g = this.game, hp = port.harborPoint || port, out = [];
    const v = mulberry32(this.today * 131 + hashString(port.id) + 7), pk = a => a[Math.floor(v() * a.length)];
    const rich = g.ships.filter(s => !s.isPlayer && s.alive && !s.sinking && !s.struck && (s.treasure || s.ai?.role === 'merchant'))
      .map(s => ({ s, d: Math.hypot(s.position.x - hp.x, s.position.z - hp.z) })).filter(o => o.d < 5500).sort((a, b) => (b.s.treasure ? 1 : 0) - (a.s.treasure ? 1 : 0) || a.d - b.d);
    for (const { s, d } of rich.slice(0, n)) {
      const esc = s.guards?.some(x => x.alive && !x.sinking) ? 'under escort' : 'unescorted';
      const what = s.treasure ? 'a galleon laden with silver' : article(shipDesc(s.faction, s.type)), What = what[0].toUpperCase() + what.slice(1);
      const where = `${leagues(d)} ${dirOf(s.position.x - hp.x, s.position.z - hp.z)} of here`;
      out.push({ who: 'the barmaid, in a low voice', text: pk([
        `${What} is cruising ${where}, ${esc}. Her officers paid in gold.`,
        `A sailor whispered to me that ${what} lies at anchor ${where}, ${esc}. His pockets were full.`,
        `${What}, ${where}, ${esc}. Her captain left a tip in silver: her hold must be full.`,
      ]) });
    }
    if (out.length < n) {
      const c = g.state.convoys.find(x => x.status === 'planned' && x.depart <= this.today && x.arrive > this.today);
      const pos = c && this.convoyPos(c);
      if (pos) {
        c.known = true;
        const where = `${leagues(Math.hypot(pos.x - hp.x, pos.z - hp.z))} ${dirOf(pos.x - hp.x, pos.z - hp.z)} of here`, to = this._portById(c.to)?.name;
        out.push({ who: 'the barmaid, in a low voice', text: pk([
          `${article(`${nationAdj(c.faction)} convoy`).replace(/^a/, 'A')} is passing right now ${where}, towards ${to}.`,
          `The lookouts of the fort have reported ${article(`${nationAdj(c.faction)} convoy`)} ${where}. It is heading for ${to}.`,
        ]) });
      }
    }
    if (!out.length) out.push({ who: 'the barmaid', none: true, text: pk([
      `“Nothing worth the powder these days, captain. Come back and see me.”`,
      `“Only fishing boats and empty coasters. Come back tomorrow.”`,
      `“The officers have stopped drinking here since the governor doubled the tax on rum. I hear nothing.”`,
    ]) });
    return out;
  }

  // ------------------------------------------------------------------ loop
  _onDay() {
    const s = this.game.state, now = this.today;
    let guard = 0;
    while (now >= s.diplomacy.next && guard++ < 12) { s.diplomacy.next += DIPLOMACY.checkEvery; this._rollDiplomacy(); }
    if (now >= s.diplomacy.next) s.diplomacy.next = now + DIPLOMACY.checkEvery;
    // one town roll per calendar day (a day now lasts about what a month did); long jumps roll 12 at most
    for (let k = 0; s.living.townDay < now && k < 12; k++) { s.living.townDay++; this._monthTick(); }
    s.living.townDay = now;
    if (now >= s.living.convoyNext) { s.living.convoyNext = now + CONVOYS.planEvery; this._planConvoys(); }
  }

  update(dt) {
    const g = this.game;
    if (g.mode !== 'sail' || !g.player || !(dt > 0)) return;
    this._t -= dt;
    this._updateHunters(dt);
    if (this._t > 0) return;
    this._t = 2;
    this._updateConvoys();
  }

  // ------------------------------------------------------------------ carte (M)
  drawMap(ctx, map) {
    const g = this.game, s = g.state, now = this.today, L = map.layers || {};
    ctx.save();
    // routes of the announced convoys
    if (L.convoys !== false) for (const c of s.convoys) {
      if (!c.known || c.status !== 'planned' || c.arrive < now) continue;
      const pos = this.convoyPos(c); if (!pos) continue;
      const [ax, ay] = map.w2s(pos.a.x, pos.a.z), [bx, by] = map.w2s(pos.b.x, pos.b.z);
      ctx.strokeStyle = 'rgba(122,80,20,0.8)'; ctx.lineWidth = 1.6; ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      const txt = `${c.treasure ? 'treasure galleon' : 'convoy'} · ${c.depart > now ? `sails ${dayLabel(c.depart)}` : `arrives ${dayLabel(c.arrive)}`}`;
      let hx = (ax + bx) / 2, hy = (ay + by) / 2;
      if (now >= c.depart) { const [x, y] = map.w2s(pos.x, pos.z); hx = x; hy = y; ctx.fillStyle = c.treasure ? '#b8862a' : '#7a5014'; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#2a1c10'; ctx.lineWidth = 1; ctx.stroke(); }
      if (map.label) map.label(txt, (ax + bx) / 2, (ay + by) / 2, { font: `italic 11px 'Spectral', Georgia, serif`, color: '#5a3a10', prio: 5, pos: ['t', 'b', 'r', 'l'], gap: 5 });
      else { ctx.font = `italic 11px 'Spectral', Georgia, serif`; ctx.fillStyle = '#5a3a10'; ctx.textAlign = 'center'; ctx.fillText(txt, (ax + bx) / 2, (ay + by) / 2 - 6); }
      map.hit?.(hx, hy, 14, `<b>${c.treasure ? 'Treasure galleon' : `${nationAdj(c.faction)} convoy`}</b><span>Announced at the tavern · ${c.depart > now ? `sails ${dayLabel(c.depart)}` : `under way, arrives ${dayLabel(c.arrive)}`}</span>`);
    }
    // state of the towns under their name (secondary label, dropped if there is no room)
    if (L.towns !== false && (map.view?.zoom ?? 2) > 1.5) for (const p of g.islands?.ports || []) {
      const t = s.towns?.[p.id]; if (!t) continue;
      const [x, y] = map.w2s(p.x, p.z), big = p.size === 'large' ? 1.25 : p.size === 'medium' ? 1 : 0.85;
      const note = this.townNote(p), txt = `${fmtInt(t.pop)} souls${note ? ' · ' + note : ''}`;
      const font = `italic 12px 'Spectral', Georgia, serif`, color = note === 'epidemic' || note === 'plundered' ? '#7a1a12' : '#3a2a16';
      if (map.label) map.label(txt, x, y + 7 * big * 1.9 + 6, { font, color, prio: 1.5, pos: ['b', 'r', 'l'], gap: 2 });
      else { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.fillText(txt, x + 7 * big * 1.1 + 24 * big, y - 7 * big * 1.2 + 13); }
    }
    ctx.restore();
  }
}

// absolute day -> “12 March”
export function dayLabel(n) {
  let m = Math.floor(n / 31) % 12, d = n % 31;
  if (d === 0) { d = 31; m -= 1; }
  m = ((m - 1) % 12 + 12) % 12;
  d = Math.min(d, [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m]);   // dayNum leaves gaps after short months
  return `${d} ${MONTHS[m]}`;
}
