// Career / life-sim state. Expands game.state (created in Game) with:
//   gold, crew (mirrors player.crew), morale 0..100, food (barrels), cargo {good: qty}, fleet [{type,name}],
//   rank {nation: index}, reputation {nation: -100..100} (via combat/factions.js), date {year,month,day},
//   age (years), daysAtSea, unpaidDays, plunder (gold owed to the crew), ledger {cost, profit, spent, earned},
//   upgrades {guns, hull, hold}, missions [..], letters {nation: true}, lands [{port, acres}], log [...].
// API:
//   new Career(game)   (system: update(dt) advances the calendar while sailing)
//   career.rankOf(nation) -> { idx, title, next, need }   RANKS titles
//   career.promote(nation) -> title|null  (call at a governor; checks reputation thresholds)
//   career.divide()     divide the plunder: pays crew their share, morale reset; returns gold paid
//   career.advanceDays(n)  advance calendar (markets recover, age, food & morale effects)
//   career.score()      retirement score
//   career.offerMissions(port) -> [mission]   career.accept(m) (false: reason in career.refusal)   career.missions
//   career.missionObjective(m) -> text   career.missionTargets() -> [{ id, kind, x, z, r?, port?, label, tip }] (chart)
//   (kind 'envoy' = peace / alliance letter offered by living.governorOffers, delivered by living.deliverEnvoy)
//   Mission kinds: deliver, hunt, escort, envoy, transport, quarry, scout, rescue — tuning and texts in src/data/missions.js
// Events emitted: 'career:day' {date}, 'career:promote' {nation, title}, 'career:mission' {mission, status}
//   'career:starving', 'notify'. Listens: 'ship:sunk', 'ship:struck', 'port:enter'.
import { getReputation, changeReputation, relation } from '../combat/factions.js';
import { tickMarkets, sell, holdUsed, holdCapacity } from './economy.js';
import { mulberry32 } from '../core/rng.js';
import { SHIP_TYPES, classOf } from '../data/shipTypes.js';
import { ZONE_TIERS, capFor } from '../data/seaZones.js';   // sea tiers: ship of the quarry mission, bounties
import { a, nationAdj, nationPeople, NBSP, theName } from '../core/i18n.js';
import { scoreBreakdown } from './retirement.js';   // final score
import { MutinyScreen } from './mutiny.js';           // mutiny: duel with the ringleader or give in
import { Family } from './family.js';                 // married life (game.family)
import { mutinyOutcome } from '../data/mutiny.js';
import { MISSIONS, CARGOES, QUARRY_NAMES, QUARRY_TEXT, WRECKS, RESCUE_TEXT, SCOUT_TEXT, qtyLabel, fill, cap, theShipN, dayLabel } from '../data/missions.js';   // governor's missions
import { GOODS } from '../data/world.js';
import { playerWear, wearSeaDay } from '../data/hullWear.js';   // the flagship's hull fouls at sea

export const RANKS = ['Commoner', 'Ensign', 'Lieutenant', 'Captain', 'Major', 'Colonel', 'Admiral', 'Baron', 'Count', 'Duke'];
export const LAND_GRANT = [0, 0, 0, 50, 100, 200, 400, 800, 1600, 3000];
export const NATIONS = ['english', 'spanish', 'french', 'dutch'];
// Promotions are earned by merit: enemy ships sunk/captured (of nations at war with the patron, or under its letter
// of marque) and missions completed. RANK_MERIT[i] = merit needed to reach RANKS[i]; reputation must stay >= RANK_MIN_REP.
export const RANK_MERIT = [0, 2, 5, 9, 14, 20, 28, 38, 50, 65];
export const RANK_MIN_REP = 0;
const KILL_MERIT = { sloop: 1, schooner: 1.5, brig: 2, merchantman: 1.5, frigate: 3, galleon: 4 };
for (const [id, t] of Object.entries(SHIP_TYPES)) KILL_MERIT[id] ??= t.merit;
// Cumulative privileges per rank idx in a nation (applied in that nation's ports).
export const PRIVILEGES = [
  { idx: 3, text: 'Easier recruiting (+30% volunteers, bounty −20%)' },
  { idx: 4, text: 'Repairs at half price' },
  { idx: 5, text: 'Better prices at the market (4%)' },
  { idx: 6, text: 'Free repairs' },
  { idx: 7, text: 'Favoured prices at the market (8%)' },
  { idx: 9, text: 'Taverns empty out for you (volunteers ×2)' },
];
export function privileges(state, nation) {
  const i = (nation && state?.rank?.[nation]) || 0;
  return {
    idx: i,
    recruitMul: (i >= 3 ? 1.3 : 1) * (i >= 9 ? 2 : 1), recruitCost: i >= 3 ? 0.8 : 1,
    repairMul: i >= 6 ? 0 : i >= 4 ? 0.5 : 1,
    priceEdge: i >= 7 ? 0.08 : i >= 5 ? 0.04 : 0,
  };
}
// Food & morale tuning
export const MORALE = { starve: 8, seaDrift: 0.3, longVoyage: 45, longDrift: 0.8, unpaid: 0.6, lootK: 0.5, lootMax: 25, richPerMan: 60, richBonus: 0.3,
  desertBelow: 30, warnBelow: 12, mutinyBelow: 8, mutinyDelay: 3 };
// ONE clock. A calendar day = one day/night cycle of the sky = REAL_SECONDS_PER_DAY real
// seconds of play (sky.dayLengthSeconds is set from it); the date turns at the sky's midnight, time compression T
// speeds both up. Per-day rates below are divided by DAY_SCALE (45 / SECONDS_PER_DAY, the original 45 s design day)
// so food, morale and desertions keep their real-time pace. Mission deadlines are given directly in (new) days.
// Ageing no longer follows the calendar year (a year would be 24 h of play): see AGE_YEAR below.
// overload: speed −perOver per 100 % over capacity, floor minF
export const LOAD = { perOver: 0.6, minF: 0.55 };
// speed factor of a hold carrying `used` units for `cap` (ship.loadSpeedF; the hold screen I previews it)
export const loadFactor = (used, cap) => { const over = used / Math.max(1, cap) - 1; return over > 0 ? Math.max(LOAD.minF, 1 - over * LOAD.perOver) : 1; };
export const REAL_SECONDS_PER_DAY = 240;   // 4 real minutes = 1 calendar day = 1 day/night cycle
export const SECONDS_PER_DAY = REAL_SECONDS_PER_DAY;   // former name, kept for imports
// Captain's age: one year of life passes in AGE_YEAR.seaDays days at sea (≈ 36 min of sailing); days spent
// ashore or skipped (share-out, prison, overland raid…) count for their real length (365 per year).
// Starts at 24, retires at 55–58 after 12–18 h of play.
export const AGE_YEAR = { seaDays: 9, landDays: 365 };
export const DAY_SCALE = 45 / SECONDS_PER_DAY;
const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export class Career {
  constructor(game) {
    this.game = game;
    const s = game.state;
    Object.assign(s, {
      morale: s.morale ?? 72, age: s.age ?? 24, daysAtSea: s.daysAtSea ?? 0, unpaidDays: s.unpaidDays ?? 0,
      plunder: s.plunder ?? 0, upgrades: s.upgrades || { guns: 0, hull: 0, hold: 0 }, missions: s.missions || [],
      letters: s.letters || {}, lands: s.lands || [], log: s.log || [], cargo: s.cargo || {}, fleet: s.fleet || [],
      ledger: s.ledger || { cost: {}, profit: 0, spent: 0, earned: 0 }, rank: s.rank || {}, reputation: s.reputation || {},
      markets: s.markets || {}, missionSeq: s.missionSeq || 1, captures: s.captures || 0,
      merit: s.merit || {}, savings: s.savings || 0, voyages: s.voyages || 0, taverns: s.taverns || {},
    });
    for (const n of NATIONS) s.merit[n] ??= RANK_MERIT[s.rank?.[n] || 0] || 0;   // old saves: rank already held counts as merit
    for (const n of NATIONS) { s.rank[n] ??= 0; if (s.merit[n] < (RANK_MERIT[s.rank[n]] || 0)) s.merit[n] = RANK_MERIT[s.rank[n]]; s.reputation[n] ??= (n === (s.nationality || 'english') ? 10 : 0); }
    this._acc = 0; this._tod = null;
    this.mutinyUI = typeof document !== 'undefined' ? new MutinyScreen(game, this) : null;
    game.family ??= new Family(game);   // visits, letters and gifts after the wedding (lot 7c follow-up)
    s.ageF ??= 0;   // accumulated fraction of a year of life
    if (game.sky) game.sky.dayLengthSeconds = REAL_SECONDS_PER_DAY;   // one clock for sky and calendar
    const ev = game.events;
    ev.on('ship:sunk', ({ ship } = {}) => this._onKill(ship, 'sunk'));
    ev.on('ship:struck', ({ ship } = {}) => this._onKill(ship, 'struck'));
    ev.on('port:enter', ({ port } = {}) => this._onPort(port));
    ev.on('boarding:start', ({ enemy } = {}) => { if (enemy) enemy._boarded = true; });
    ev.on('boarding:end', ({ result, enemy } = {}) => { if (enemy && result !== 'defeat') this._onKill(enemy, 'boarded'); });
    ev.on('ship:sunk', ({ ship } = {}) => { if (ship && ship === this.escortShip) this._escortLost(); });
    // governor's missions (src/data/missions.js): quarry sunk by others, transport goods sold / jettisoned / lost
    ev.on('ship:sunk', ({ ship } = {}) => this._quarryGone(ship));
    ev.on('trade', ({ side, good } = {}) => { if (side === 'sell' && good) this._checkCargo('sold', [good]); });
    ev.on('hold:jettison', () => this._checkCargo('jettison'));
    ev.on('port:leave', () => this._checkCargo('lost'));
    // deadlines were recalibrated (MISSIONS.perDay); a mission accepted before that (save without `missionDelays`)
    // gains MISSIONS.oldBonus days, once; every mission accepted since sets the flag
    ev.on('game:loaded', () => game.player?.model?.setWear(playerWear(game.state)));
    ev.on('game:loaded', () => {
      const st = game.state; if (!st || st.missionDelays >= 2) return;
      for (const m of st.missions || []) if (m.status === 'active' && m.deadline && !m.ready) m.deadline += MISSIONS.oldBonus ?? 2;
      st.missionDelays = 2;
    });
  }

  get missions() { return this.game.state.missions; }

  update(dt) {
    const g = this.game;
    if (dt > 0) this._clock(dt);
    if (g.mode !== 'sail' || !g.player || dt <= 0) return;
    if (g.state.mutinyPending && this.mutinyUI?.canOpen()) this.mutinyUI.open();   // deferred until the captain is free
    // crew count follows the ship
    if (g.player) g.state.crew = g.player.crew;
    // overloaded hold (e.g. after moving to a smaller ship): sluggish ship, warned once
    this._loadT = (this._loadT || 0) - dt;
    if (this._loadT <= 0) {
      this._loadT = 1;
      const used = holdUsed(g), cap = Math.max(1, holdCapacity(g)), over = used / cap - 1;
      g.player.loadSpeedF = loadFactor(used, cap);
      if (over > 0 && !this._overWarned) { this._overWarned = true; g.events.emit('notify', { text: `Hold overloaded (${used}/${cap}): the ship is crawling. Sell at the market or throw cargo overboard (I) to lighten her.`, kind: 'bad', topic: 'crew', key: 'overload' }); }
      if (over <= 0) this._overWarned = false;
    }
    this._escT = (this._escT || 0) - dt;
    if (this._escT <= 0) { this._escT = 0.5; this._updateEscort(); this._updateMissions(); }
  }

  // the sky is the clock. The date turns when the sky passes midnight (a sea day if sailing, otherwise a
  // day ashore). Without auto-advancing sky (?tod=, ?shot=), seconds of sailing are counted instead.
  _clock(dt) {
    const g = this.game, sky = g.sky, sail = g.mode === 'sail' && !!g.player;
    if (sky?.autoAdvance) {
      const t = sky.timeOfDay;
      if (this._tod != null && t < this._tod - 12) this.advanceDays(1, sail);
      this._tod = t;
    } else if (sail) {
      this._acc += dt;
      while (this._acc >= SECONDS_PER_DAY) { this._acc -= SECONDS_PER_DAY; this.advanceDays(1, true); }
    }
  }
  // fraction of the current day elapsed (0..1)
  dayFrac() {
    const sky = this.game.sky;
    return sky?.autoAdvance ? sky.timeOfDay / 24 : Math.min(0.99, this._acc / SECONDS_PER_DAY);
  }
  // Time spent ashore (entering port, digging…): moves the sky clock on; the date turns at midnight.
  advanceHours(h) {
    const sky = this.game.sky;
    if (!sky?.autoAdvance) { this._acc += h / 24 * SECONDS_PER_DAY; while (this._acc >= SECONDS_PER_DAY) { this._acc -= SECONDS_PER_DAY; this.advanceDays(1, false); } return; }
    const t = sky.timeOfDay + h, days = Math.floor(t / 24);
    sky.setTimeOfDay(t); this._tod = sky.timeOfDay;
    if (days > 0) this.advanceDays(days, false);
  }

  _age(years) {
    const g = this.game, s = g.state;
    s.ageF = (s.ageF || 0) + years;
    while (s.ageF >= 1) { s.ageF -= 1; s.age++; g.events.emit('notify', { text: `The years at sea go by. Captain ${s.name} is now ${s.age} years old.`, kind: 'info' }); }
  }

  advanceDays(n = 1, atSea = false) {
    const g = this.game, s = g.state;
    this._age(n / (atSea ? AGE_YEAR.seaDays : AGE_YEAR.landDays));
    for (let i = 0; i < n; i++) {
      const d = s.date; d.day++;
      if (d.day > DIM[d.month - 1]) { d.day = 1; d.month++; if (d.month > 12) { d.month = 1; d.year++; } }
      if (atSea) {
        s.daysAtSea++;
        g.player?.model?.setWear(wearSeaDay(s));
        const crew = g.player?.crew ?? s.crew ?? 0;
        const fx = g.fortune?.fx;   // specialists & items
        s.foodDue = (s.foodDue || 0) + crew / 25 * (fx?.foodMul ?? 1) / DAY_SCALE;   // barrels per day (cooper: −30 %), fractional
        const need = Math.max(1, Math.floor(s.foodDue)), dayNeed = Math.max(1, Math.ceil(crew / 25 * (fx?.foodMul ?? 1) / DAY_SCALE));
        let dm = 0;
        if (s.foodDue < 1) { /* nothing eaten yet today */ }
        else if (s.food >= need) { s.food -= need; s.foodDue -= need; }
        else {
          s.food = 0; s.foodDue = 0;
          dm -= MORALE.starve / DAY_SCALE;
          if (g.player && g.player.crew > 4) { const lost = Math.max(1, Math.round(g.player.crew * 0.03 / DAY_SCALE * (fx?.starveMul ?? 1))); g.player.crew -= lost; s.crew = g.player.crew; }
          g.events.emit('career:starving', {});
          g.events.emit('notify', { text: 'The bread room is empty. The men are starving and some of them die.', kind: 'bad' });
        }
        // long voyages wear on the men; unpaid plunder sours them faster
        dm -= (s.daysAtSea > MORALE.longVoyage * DAY_SCALE ? MORALE.longDrift : MORALE.seaDrift) * (fx?.moraleDriftMul ?? 1) / DAY_SCALE;
        if (s.food > 0) dm += (fx?.moraleDaily || 0) / DAY_SCALE;   // cook, music
        if (s.plunder > 50) s.unpaidDays++;
        if (s.unpaidDays > 30 * DAY_SCALE) dm -= MORALE.unpaid / DAY_SCALE;
        if (crew > 0 && s.gold / crew > MORALE.richPerMan) dm += MORALE.richBonus / DAY_SCALE;
        s.morale = Math.max(0, Math.min(100, s.morale + dm));
        if (s.food > 0 && s.food < dayNeed * 3 * DAY_SCALE && i === n - 1) g.events.emit('notify', { text: `Provisions low: only ${s.food} barrels left.`, kind: 'bad' });
        this._crewMood(true);
      }
      this._lootMood();
      tickMarkets(g, 12);   // stocks recover ~58 % per (4 min) day
      for (const m of s.missions) if (m.status === 'active' && this._dateNum(d) > m.deadline) {
        m.status = 'failed'; changeReputation(g, m.nation, MISSIONS.failRep, 'mission-failed'); g.events.emit('career:mission', { mission: m, status: 'failed' });
        const owed = m.kind === 'transport' && this._carried(m.good) > 0;   // the goods supplied are still the governor's
        if (owed) m.owed = true;
        g.events.emit('notify', { text: `Mission failed: ${m.title}.${owed ? ` The cargo is still owed: it will be seized at the next ${nationAdj(m.nation)} port.` : ''}`, kind: 'bad' });
      }
    }
    g.events.emit('career:day', { date: s.date });
  }

  // Loot raises spirits: any rise of gold + plunder owed since last check, per man.
  _lootMood() {
    const g = this.game, s = g.state, crew = Math.max(1, g.player?.crew ?? s.crew ?? 1);
    const w = (s.gold || 0) + (s.plunder || 0);
    if (s.lootSeen == null) s.lootSeen = w;
    const d = w - s.lootSeen; s.lootSeen = w;
    if (d > 0 && g.mode !== 'port') s.morale = Math.min(100, s.morale + Math.min(MORALE.lootMax, d / crew * MORALE.lootK));
  }

  // Low morale: desertions; very low: a warning, then mutiny. atSea: daily tick; otherwise on entering port.
  _crewMood(atSea) {
    const g = this.game, s = g.state, p = g.player;
    if (!p) return;
    const m = s.morale, dn = this._dateNum(s.date);
    if (m >= 20) s.mutinyWarn = null;
    if (m < MORALE.desertBelow && p.crew > 6) {
      const f = (MORALE.desertBelow - m) / MORALE.desertBelow;
      const dk = g.fortune?.fx.desertMul ?? 1;   // quartermaster
      // at sea: expected losses of the old 45 s design day (chance × 2 % × f), scaled to the day's length
      const exp = p.crew * 0.02 * f * (0.35 + f * 0.5) * dk / DAY_SCALE;
      const n = atSea ? Math.floor(exp + Math.random()) : Math.round(Math.max(1, p.crew * 0.25 * f) * dk);
      if (n) {
        p.crew = Math.max(6, p.crew - n); s.crew = p.crew;
        g.events.emit('career:desert', { n });
        g.events.emit('notify', { text: atSea ? `${n} m${n > 1 ? 'en' : 'an'} took the longboat during the night. Desertion.` : `${n} m${n > 1 ? 'en vanish' : 'an vanishes'} into the back streets and never come${n > 1 ? '' : 's'} back aboard.`, kind: 'bad' });
      }
    }
    if (!atSea || s.mutinyPending) return;
    if (m < MORALE.warnBelow && s.mutinyWarn == null) {
      s.mutinyWarn = dn;
      g.events.emit('career:mutiny-warning', {});
      g.events.emit('notify', { text: 'The boatswain takes you aside: “The men are talking of mutiny, captain. Go back to port and share out the plunder, or they will do it themselves.”', kind: 'bad' });
    } else if (m < MORALE.mutinyBelow && s.mutinyWarn != null && dn - s.mutinyWarn >= MORALE.mutinyDelay * DAY_SCALE) this.mutiny();
  }

  // Mutiny: the crew confronts the captain. The choice screen (src/game/mutiny.js) offers a duel with the ringleader on
  // the player's own deck, or giving in (the old fixed loss); state.mutinyPending keeps it until the captain is free.
  mutiny() {
    const s = this.game.state;
    s.mutinyPending = true; s.mutinyWarn = null;
    if (!this.mutinyUI) return this._mutinyApply('yield');
    this.mutinyUI.open();   // or later, from update()
  }
  // choice: 'yield' | 'duel' (won: the duel's outcome); tuning MUTINY in src/data/mutiny.js
  _mutinyApply(choice, won = false, leader = null) {
    const g = this.game, s = g.state, p = g.player;
    const o = mutinyOutcome(choice, { gold: s.gold, crew: p?.crew ?? s.crew ?? 0 }, won);
    s.gold -= o.gold; s.plunder = Math.max(0, (s.plunder || 0) - o.gold);
    if (p && o.men) { p.crew = Math.max(4, p.crew - o.men); s.crew = p.crew; }
    if (o.wounds) s.wounds = (s.wounds || 0) + o.wounds;
    s.morale = Math.max(s.morale, o.morale); s.mutinyWarn = null; s.mutinyPending = false;
    if (!(choice === 'duel' && won)) s.unpaidDays = 0;   // the mutineers took their pay (a beaten revolt leaves the debt)
    s.lootSeen = (s.gold || 0) + (s.plunder || 0);
    const who = leader?.name || 'The ringleader';
    g.events.emit('career:mutiny', { gold: o.gold, men: o.men, choice, won });
    const text = choice === 'duel' && won
      ? `${who} down, the mutineers lay down their arms. ${o.men > 1 ? `The ringleader and ${o.men - 1} of his followers are put in irons` : 'The ringleader is put in irons'}; the crew goes back to work.`
      : choice === 'duel'
        ? `Beaten on your own deck! ${who} and ${o.men} mutineers take the longboat with ${o.gold} gold. You keep a nasty gash from it.`
        : `Mutiny! ${o.men} mutineers seize ${o.gold} gold and the longboat. The loyal men stay aboard.`;
    g.events.emit('notify', { text, kind: choice === 'duel' && won ? 'good' : 'bad', topic: 'crew' });
    return o;
  }

  // ---------------- escort missions (integration) ----------------
  // An accepted escort commission spawns a friendly merchantman that keeps station off the player's quarter.
  // It must be alive and within 900 m when the player enters the destination port; if she sinks the mission fails.
  _spawnEscort(m) {
    const g = this.game, p = g.player, c = g.combat;
    if (!p || !c?.spawnAI || (this.escortShip && this.escortShip.alive && !this.escortShip.sinking)) return;
    const f = { x: Math.sin(p.heading), z: -Math.cos(p.heading) };
    let x = p.position.x - f.x * 140 + f.z * 70, z = p.position.z - f.z * 140 - f.x * 70;
    if (g.islands?.isLand?.(x, z, 40)) { x = p.position.x - f.x * 120; z = p.position.z - f.z * 120; }
    const names = ['Good Intent', 'Providence', 'Fair Trader', 'Blessing', 'Marigold'];
    const e = c.spawnAI({ type: 'merchantman', faction: m.nation, role: 'merchant', x, z, heading: p.heading, sailSetting: 0.5, name: names[m.id.length % names.length], speed: 0 });
    e.escortOf = p; e._escortMission = m.id; e.ai.fireAtWill = false;
    this.escortShip = e;
    g.events.emit('notify', { text: `The merchantman ${e.name} falls in behind you. Bring her safely to ${m.toName}.`, kind: 'info' });
  }
  _escortLost() {
    const g = this.game, m = this.game.state.missions.find(x => x.status === 'active' && x.kind === 'escort');
    this.escortShip = null;
    if (!m) return;
    m.status = 'failed'; changeReputation(g, m.nation, -6, 'mission-failed');
    g.events.emit('career:mission', { mission: m, status: 'failed' });
    g.events.emit('notify', { text: `The merchantman is lost. Mission failed: ${m.title}.`, kind: 'bad' });
  }
  _updateEscort() {
    const g = this.game, p = g.player, m = g.state.missions.find(x => x.status === 'active' && x.kind === 'escort');
    let e = this.escortShip;
    if (!m) { if (e) { e.escortOf = null; this.escortShip = null; } return; }
    if (!e || !g.ships.includes(e)) { this._spawnEscort(m); e = this.escortShip; }   // e.g. after loading a save
    if (!e || !e.ai || !p) return;
    if (e.escortOf !== p) e.escortOf = p;
    if (e.ai.state === 'cruise') {
      const f = { x: Math.sin(p.heading), z: -Math.cos(p.heading) };
      e.ai.waypoint = { x: p.position.x - f.x * 120 + f.z * 60, z: p.position.z - f.z * 120 - f.x * 60 };
      const d = Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z);
      e.ai._escortSail = d > 260 ? 1 : d > 140 ? Math.max(0.3, p.sailSetting) : 0.2;
    }
  }

  _dateNum(d) { return d.year * 372 + d.month * 31 + d.day; }

  rankOf(nation) {
    const s = this.game.state, idx = s.rank[nation] || 0;
    return { idx, title: RANKS[idx], next: RANKS[idx + 1] || null, need: RANK_MERIT[idx + 1] ?? null, merit: Math.floor(s.merit?.[nation] || 0), minRep: RANK_MIN_REP, rep: getReputation(this.game, nation) };
  }

  promote(nation) {
    const g = this.game, s = g.state, r = this.rankOf(nation);
    if (r.next && r.merit >= r.need && r.rep >= r.minRep) {
      s.rank[nation] = r.idx + 1;
      const acres = LAND_GRANT[r.idx + 1], at = g.ports?.isOpen ? g.ports.port : null;
      if (acres) s.lands.push({ nation, acres, title: RANKS[r.idx + 1], port: at?.id, portName: at?.name });   // concession near the port of the promotion
      g.events.emit('career:promote', { nation, title: r.next, acres });
      g.events.emit('notify', { text: `Promoted to the rank of ${r.next}${acres ? `, with a grant of ${acres} acres${at ? ` near ${at.name}` : ''}` : ''}.`, kind: 'good', major: true, topic: 'rank' });
      return r.next;
    }
    return null;
  }

  // Lands granted with the ranks (LAND_GRANT, Capitaine and above): total acres, in one nation or in all
  acres(nation) { return (this.game.state.lands || []).filter(l => !nation || l.nation === nation).reduce((a, l) => a + (l.acres || 0), 0); }
  landGrant(idx) { return LAND_GRANT[idx] || 0; }

  // Divide the plunder (end of a voyage): the cargo is sold at this port, the captain's share goes to his savings
  // (untouchable), the rest to the crew; morale back to full, some hands go ashore, and a few months pass.
  captainShare() { const top = Math.max(0, ...NATIONS.map(n => this.game.state.rank[n] || 0)); return Math.min(0.5, 0.2 + top * 0.03); }
  divide(port) {
    const g = this.game, s = g.state;
    port ||= g.ports?.port;
    let sold = 0;
    // goods supplied for a transport mission stay aboard (they are not the crew's to share)
    if (port) for (const k of Object.keys(s.cargo)) { const g0 = s.gold; sell(g, port, k, Math.max(0, (s.cargo[k] || 0) - this._reserved(k))); sold += s.gold - g0; }
    const pool = Math.max(0, Math.round(s.gold));
    const cap = Math.round(pool * this.captainShare()), crewPay = pool - cap;
    const perMan = g.player ? Math.round(crewPay / Math.max(1, g.player.crew)) : 0;
    s.savings = (s.savings || 0) + cap; s.gold = 0;
    s.plunder = 0; s.unpaidDays = 0; s.daysAtSea = 0; s.morale = 100; s.mutinyWarn = null; s.voyages = (s.voyages || 0) + 1;
    if (s.ledger) s.ledger.cost = {};
    // most of the hands take their share and stay ashore; fewer the poorer the share
    if (g.player) { const leave = Math.round(g.player.crew * Math.min(0.6, 0.25 + perMan / 400)); g.player.crew = Math.max(4, g.player.crew - leave); s.crew = g.player.crew; }
    const months = 3 + (pool > 20000 ? 1 : 0);   // 3 months ashore (4 after a rich voyage)
    this.advanceDays(months * 30, false);   // same hour of the sky, months later (ages 3–4 months)
    s.lootSeen = 0;
    g.events.emit('career:divide', { pool, cap, crewPay, perMan, sold });
    g.events.emit('notify', { text: `End of the voyage. ${pool} gold shared out${sold ? ` (cargo sold for ${sold})` : ''}: ${perMan} per man, ${cap} paid into your savings. ${months} months pass ashore.`, kind: 'good' });
    return crewPay;
  }

  // one score for the counting house, the Registre and the retirement sheet (src/game/retirement.js, SCORE)
  score() { return scoreBreakdown(this.game.state).total; }

  // ---------------- missions ----------------
  // Offers are drawn from a generator seeded by the date and the port: the list is the same all day long (accept()
  // finds an offer again by its id). Every type that can be built here is a candidate; the governor proposes
  // MISSIONS.offers[0..1] of them, all of different types (weighted draw without replacement, MISSIONS.weights).
  offerMissions(port) {
    const g = this.game, s = g.state, nation = port?.faction;
    if (!port || port.haven || !NATIONS.includes(nation)) return [];
    const M = MISSIONS, today = this._dateNum(s.date);
    const r = mulberry32(today * 131 + port.id.length * 977 + port.name.charCodeAt(0));
    const pick = a => a[Math.floor(r() * a.length)], range = ([a, b]) => a + Math.round(r() * (b - a));
    const hp = port.harborPoint || port, dist = q => Math.hypot((q.harborPoint || q).x - hp.x, (q.harborPoint || q).z - hp.z);
    const daysFor = (d, [lo, hi], extra = M.slack ?? 1.5) => Math.max(lo, Math.min(hi, Math.ceil(extra + d / M.perDay)));
    const ports = g.islands?.ports || [];
    // never the port of origin (compared by id: a port object rebuilt elsewhere must not slip through), nor a port so
    // close that the errand would be over before it began
    const others = ports.filter(p => p.id !== port.id && !p.haven && relation(p.faction, nation) >= 0 && dist(p) >= M.minDist);
    const enemies = NATIONS.filter(n => relation(n, nation) < 0);
    const mk = (key, o) => ({ id: `m${port.id}${today}_${key}`, nation, from: port.id, fromName: port.name, status: 'offer', ...o, deadline: today + o.days });
    const cands = [];
    const add = (kind, m) => { if (m) cands.push({ kind, w: M.weights[kind] ?? 1, m }); };
    // dispatches
    if (others.length) {
      const to = pick(others), days = daysFor(dist(to), M.deliver?.days || [4, 9]);
      add('deliver', mk('pl', { kind: 'deliver', title: `Dispatches for ${to.name}`, to: to.id, toName: to.name, days, reward: 600 + Math.round(r() * 500), rep: 6,
        text: `Carry sealed dispatches to the governor of ${to.name} within ${days}${NBSP}days.` }));
    }
    // hunt: the rover, or two ships of an enemy nation
    if (enemies.length && r() < 0.5) {
      const e = pick(enemies);
      add('hunt', mk('hn', { kind: 'hunt', target: e, title: `Harass the ${nationPeople(e)}`, count: 2, days: M.hunt?.nationDays ?? 8, reward: 2200 + Math.round(r() * 1200), rep: 12,
        text: `Take or sink two ${nationAdj(e)} ships. The Crown will reward you handsomely, and with land.` }));
    } else add('hunt', mk('hp', { kind: 'hunt', target: 'pirate', title: 'Hunt down the freebooter', count: 1, days: M.hunt?.pirateDays ?? 6, reward: 1400 + Math.round(r() * 900), rep: 10,
      text: 'A pirate sloop is preying on our ships. Sink her or capture her, then come back and tell us.' }));
    // escort
    if (others.length > 1) {
      const to = pick(others), days = daysFor(dist(to), M.escort?.days || [4, 10], M.escort?.slack ?? 2.5);
      add('escort', mk('es', { kind: 'escort', title: `Escort a merchantman to ${to.name}`, to: to.id, toName: to.name, days, reward: 900 + Math.round(r() * 400), rep: 7,
        text: `The merchantman sails with you to ${to.name}. Bring her safe and sound into port before ${dayLabel(today + days)}.` }));
    }
    // transport: goods supplied, to deliver to another port of the nation
    { const T = M.transport, dests = others.filter(p => p.faction === nation && dist(p) >= T.minDist);
      if (dests.length) {
        const to = pick(dests), c = pick(CARGOES), qty = range(c.qty), d = dist(to), days = daysFor(d, T.days), date = dayLabel(today + days);
        const v = { to: to.name, qty: qtyLabel(qty, c.good, GOODS), date };
        add('transport', mk('tr', { kind: 'transport', title: fill(c.title, v), to: to.id, toName: to.name, good: c.good, qty, days,
          reward: range(T.reward) + Math.round(d / 1000 * T.perKm) + (c.bonus || 0), rep: T.rep, merit: T.merit, text: fill(c.text, v) }));
      } }
    // quarry: a named captain cruises near an island
    { const Q = M.quarry, sites = this._islandSites(port, Q.minDist, Q.maxDist, false);
      if (sites.length) {
        const sub = r() < Q.smugglerShare ? 'smuggler' : 'pirate', site = pick(sites), N = QUARRY_NAMES;
        const zone = this._waterNear(site.x, site.z, site.radius + 300, site.radius + 900, r);
        const tier = Math.min(2, Math.floor((s.rank?.[nation] || 0) / 3));
        // sea tiers: the wanted ship stays under the cap of the zone it cruises in
        const zt = zone && g.seaZones ? g.seaZones.tierAt(zone.x, zone.z) : 3, zc = capFor(zt, sub === 'smuggler' ? 'merchant' : 'pirate').maxClass;
        const fit = Q.types[sub][tier].filter(t => classOf(t) <= zc), type = pick(fit.length ? fit : Q.types[sub][tier]);
        const captain = `${pick(N.first)} ${pick(N.last)}`, nick = pick(N.nick[sub]), ship = pick(N.ship[sub]);
        const d = dist(zone || site), days = daysFor(d, Q.days, 2), date = dayLabel(today + days);
        const v = { who: `${captain}, known as ${nick}`, place: site.name, date, theship: theShipN(type, ship), Theship: cap(theShipN(type, ship)) };
        if (zone) add('quarry', mk('qr', { kind: 'quarry', sub, captain, nick, ship, type, place: site.name, zone: { x: Math.round(zone.x), z: Math.round(zone.z), r: Q.zoneR },
          title: sub === 'pirate' ? `The head of ${captain}` : `The smuggler of ${site.name}`,
          days, reward: range(Q.reward[sub]) + tier * 400, rep: sub === 'pirate' ? Q.rep : Q.rep - 3, merit: sub === 'pirate' ? Q.merit : Q.merit - 1,
          duel: Q.duel[0] + r() * (Q.duel[1] - Q.duel[0]), text: fill(pick(QUARRY_TEXT[sub]), v) }));
      } }
    // scouting: an enemy port (failing that, a Brethren of the Coast haven), then back here
    { const S = M.scout;
      let tg = ports.filter(p => !p.haven && enemies.includes(p.faction) && dist(p) >= S.minDist), haven = false;
      if (!tg.length) { tg = ports.filter(p => p.haven && dist(p) >= S.minDist); haven = true; }
      if (tg.length) {
        const to = pick(tg), d = dist(to), days = daysFor(2 * d, S.days), date = dayLabel(today + days);
        const v = { to: to.name, near: `${S.near}${NBSP}m`, date, people: nationPeople(to.faction) };
        add('scout', mk('sc', { kind: 'scout', haven, to: to.id, toName: to.name, title: haven ? `Scout the ${to.name} haven` : `Scout ${to.name}`, days,
          reward: range(S.reward) + Math.round(2 * d / 1000 * S.perKm), rep: S.rep, merit: S.merit, near: S.near, text: fill(pick(SCOUT_TEXT[haven ? 'haven' : 'port']), v) }));
      } }
    // rescue: castaways on an islet with no port
    { const R = M.rescue, sites = this._islandSites(port, R.minDist, R.maxDist, true);
      if (sites.length) {
        const site = pick(sites), spot = this._waterNear(site.x, site.z, site.radius + 260, site.radius + 700, r);
        const wreck = pick(WRECKS[nation] || WRECKS.english), men = range(R.men), d = dist(spot || site), days = daysFor(2 * d, R.days), date = dayLabel(today + days);
        const v = { theship: `The ship “${wreck}”`, ofship: `of the ship “${wreck}”`, Theship: `The ship “${wreck}”`, from: port.name, place: site.name, date };
        if (spot) add('rescue', mk('rs', { kind: 'rescue', wreck, place: site.name, spot: { x: Math.round(spot.x), z: Math.round(spot.z) }, men, near: R.near,
          title: `The castaways of ${site.name}`, days, reward: range(R.reward), rep: R.rep, merit: R.merit, text: fill(pick(RESCUE_TEXT), v) }));
      } }
    // sea tiers: tier of the mission's place (destination, cruising zone, castaways) and bounty
    // × ZONE_TIERS[t].reward (1 / 1.25 / 1.6); m.tier is shown in the offer
    if (g.seaZones) for (const c of cands) {
      const m = c.m, q = m.zone || m.spot || (m.to && (ports.find(p => p.id === m.to)?.harborPoint));
      if (!q) continue;
      m.tier = g.seaZones.tierAt(q.x, q.z);
      m.reward = Math.round(m.reward * (ZONE_TIERS[m.tier]?.reward ?? 1) / 10) * 10;
    }
    // weighted draw without replacement: 3 or 4 different types
    const want = M.offers[0] + (r() < 0.5 ? 0 : M.offers[1] - M.offers[0]), out = [];
    while (out.length < want && cands.length) {
      let x = r() * cands.reduce((a, c) => a + c.w, 0), i = 0;
      while (i < cands.length - 1 && (x -= cands[i].w) > 0) i++;
      out.push(cands.splice(i, 1)[0].m);
    }
    return out.filter(m => m.to !== port.id && !s.missions.some(a => a.id === m.id));
  }

  // islands far enough from this port to send the player there (no port on them; islets only for a rescue)
  _islandSites(port, d0, d1, islets) {
    const isl = this.game.islands, hp = port.harborPoint || port;
    const withPort = new Set([...(isl?.ports || []), ...(isl?.villages || [])].map(p => p.islandId));   // fishing villages: inhabited island
    return (isl?.list || []).filter(i => i.id !== 'main' && !withPort.has(i.id) && (!islets || i.type === 'cay' || i.type === 'atoll' || i.radius < 320))
      .filter(i => { const d = Math.hypot(i.x - hp.x, i.z - hp.z); return d >= d0 && d <= d1; })
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  // open water between r0 and r1 from a point, deep enough for a frigate (no reef, no sand bar), deterministic for
  // a given generator
  _waterNear(cx, cz, r0, r1, r) {
    const isl = this.game.islands, a0 = r() * Math.PI * 2, deep = MISSIONS.deep;
    for (const k of [0, 0.5, 1]) for (let i = 0; i < 12; i++) {
      const a = a0 + i * Math.PI / 6, rr = r0 + (r1 - r0) * k, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      if (Math.abs(x) < 7500 && Math.abs(z) < 7500 && !isl?.isLand?.(x, z, 90) && !(isl?.getTerrainHeight?.(x, z) > -deep)) return { x, z };
    }
    return null;
  }

  // Accepts an offer. Returns false (reason in this.refusal) when three missions are under way, when an escort is
  // already sailing with the player, or when the hold cannot take the goods of a transport.
  accept(m) {
    const g = this.game, s = g.state, act = s.missions.filter(x => x.status === 'active');
    this.refusal = null;
    if (act.length >= MISSIONS.maxActive) { this.refusal = `You already have ${MISSIONS.maxActive} missions under way.`; return false; }
    if (m.kind === 'escort' && act.some(x => x.kind === 'escort')) { this.refusal = `You are already escorting a merchantman: only one at a time.`; return false; }
    if (m.kind === 'transport') {
      const need = Math.ceil(m.qty * (GOODS[m.good]?.bulk || 1)), free = holdCapacity(g) - holdUsed(g);
      if (need > free) { this.refusal = `Not enough room in the hold: ${need} needed and only ${Math.max(0, free)} left. Sell or throw cargo overboard first.`; return false; }
    }
    const am = { ...m, status: 'active', progress: 0 };
    s.missions.push(am); s.missionDelays = 2;   // recalibrated deadlines (see game:loaded)
    g.events.emit('career:mission', { mission: m, status: 'accepted' });
    if (am.kind === 'escort') this._spawnEscort(am);
    const by = dayLabel(am.deadline);
    if (am.kind === 'transport') {
      s.cargo[am.good] = (s.cargo[am.good] || 0) + am.qty;   // supplied by the governor: no purchase cost in the ledger
      g.events.emit('notify', { text: `${cap(qtyLabel(am.qty, am.good, GOODS))} are hoisted into your hold. Deliver them to ${am.toName} before ${by}; do not sell them or throw them overboard.`, kind: 'info' });
    } else if (am.kind === 'quarry') g.events.emit('notify', { text: `The governor hands you the description of ${am.captain}, known as ${am.nick}: he was seen near ${am.place}. The place is marked on your map (M).`, kind: 'info', topic: 'lord' });
    else if (am.kind === 'scout') g.events.emit('notify', { text: `Come within ${am.near}${NBSP}m of ${am.toName}, then return to ${am.fromName} before ${by}.`, kind: 'info' });
    else if (am.kind === 'rescue') g.events.emit('notify', { text: `The castaways of ${am.place} are waiting for you. Their position is marked on your map (M); bring them back to ${am.fromName} before ${by}.`, kind: 'info' });
    return true;
  }

  // ---------------- missions under way (sail mode, every 0.5 s) ----------------
  _updateMissions() {
    const g = this.game, s = g.state, p = g.player;
    if (!p) return;
    this._checkCargo('lost');
    // a mission port in sight (1,5 km): say once how to finish there (enter with F), so nobody waits at the quay
    this._told ||= new Set();
    for (const port of g.islands?.ports || []) {
      const hp = port.harborPoint || port;
      if (Math.hypot(hp.x - p.position.x, hp.z - p.position.z) > 1500) continue;
      const what = this.missionAtPort(port), key = `${port.id}:${what}`;
      if (!what || this._told.has(key)) continue;
      this._told.add(key);
      g.events.emit('notify', { text: `${port.name} in sight: enter port (F) to ${what}.`, kind: 'info', topic: 'port' });
    }
    for (const m of s.missions) {
      if (m.status !== 'active') continue;
      if (m.kind === 'quarry') this._updateQuarry(m);
      else if (m.kind === 'scout' && !m.ready) {
        const t = g.islands?.getPort?.(m.to) || g.islands?.ports?.find(q => q.id === m.to); if (!t) continue;
        const d = Math.min(Math.hypot(t.x - p.position.x, t.z - p.position.z), t.harborPoint ? Math.hypot(t.harborPoint.x - p.position.x, t.harborPoint.z - p.position.z) : Infinity);
        if (d > (m.near || MISSIONS.scout.near)) continue;
        m.ready = true;
        const gar = g.living?.town?.(t)?.garrison, ships = g.ships.filter(o => o !== p && o.alive && !o.sinking && Math.hypot(o.position.x - t.harborPoint?.x, o.position.z - t.harborPoint?.z) < 1500).length;
        m.report = `${gar ? `a garrison of about ${Math.max(10, Math.round(gar / 10) * 10)} men` : 'batteries noted'} · ${ships ? `${ships} sail at anchor` : 'empty roads'}`;
        g.events.emit('career:mission', { mission: m, status: 'progress' });
        g.events.emit('notify', { text: `${t.name} scouted: ${m.report}. Go back and report to ${m.fromName} before ${dayLabel(m.deadline)}.`, kind: 'good' });
      } else if (m.kind === 'rescue' && !m.ready && m.spot) {
        if (Math.hypot(m.spot.x - p.position.x, m.spot.z - p.position.z) > (m.near || MISSIONS.rescue.near)) continue;
        m.ready = true;
        const room = Math.max(0, Math.round((p.crewMax || p.crew) - p.crew)), join = Math.min(m.men, room);
        if (join) { p.crew += join; s.crew = p.crew; }
        m.joined = join;
        g.events.emit('career:mission', { mission: m, status: 'progress' });
        g.events.emit('notify', { text: `Your longboat picks up ${m.men} castaways near ${m.place}, starving but alive. ${join === m.men ? 'All of them sign on with the crew' : join ? `${join} sign on with the crew, the others travel in the ’tween decks` : 'For want of berths, they travel in the ’tween decks'}. Bring them back to ${m.fromName}.`, kind: 'good', topic: 'crew' });
      } else if (m.kind === 'escort') {   // the merchantman may also make the harbour on her own, the player close by
        const e = this.escortShip, to = g.islands?.ports?.find(q => q.id === m.to);
        if (e?.alive && !e.sinking && to?.harborPoint && Math.hypot(e.position.x - to.harborPoint.x, e.position.z - to.harborPoint.z) < 450
          && Math.hypot(p.position.x - to.harborPoint.x, p.position.z - to.harborPoint.z) < 1600) {
          g.events.emit('notify', { text: `${theName(e.name, true)} anchors under the guns of ${to.name}. The harbour master salutes you.`, kind: 'good' });
          this._complete(m); g.removeShip(e); this.escortShip = null;
        }
      }
    }
  }

  // ---- transport: the goods supplied must stay aboard (hold + squadron) until delivered
  _reserved(good) { return (this.game.state.missions || []).filter(m => m.status === 'active' && m.kind === 'transport' && m.good === good).reduce((a, m) => a + m.qty, 0); }
  _carried(good) { const s = this.game.state; return (s.cargo?.[good] || 0) + (s.fleet || []).reduce((a, f) => a + (f.cargo?.[good] || 0), 0); }
  _checkCargo(cause, goods) {
    const g = this.game, s = g.state, T = MISSIONS.transport;
    const act = s.missions.filter(m => m.status === 'active' && m.kind === 'transport' && (!goods || goods.includes(m.good)));
    for (const good of new Set(act.map(m => m.good))) {
      const list = act.filter(m => m.good === good).sort((a, b) => b.deadline - a.deadline);
      let have = this._carried(good), need = list.reduce((a, m) => a + m.qty, 0);
      for (const m of list) {
        if (have >= need) break;
        need -= m.qty; m.status = 'failed';
        const rep = cause === 'sold' ? T.theftRep : MISSIONS.failRep;
        changeReputation(g, m.nation, rep, 'mission-failed');
        g.events.emit('career:mission', { mission: m, status: 'failed' });
        const what = qtyLabel(m.qty, m.good, GOODS);
        g.events.emit('notify', { text: cause === 'sold' ? `You sold the cargo entrusted to you by ${m.fromName}: ${what} misappropriated. The ${nationPeople(m.nation)} speak of theft. Mission failed: ${m.title}.`
          : cause === 'jettison' ? `The cargo entrusted to you by ${m.fromName} ended up overboard. Mission failed: ${m.title}.`
          : `The cargo entrusted to you by ${m.fromName} is no longer aboard. Mission failed: ${m.title}.`, kind: 'bad' });
      }
    }
  }
  _unload(good, qty) {   // delivery: from the hold first, then from the squadron
    const s = this.game.state;
    let left = qty;
    const take = (o) => { const n = Math.min(left, o[good] || 0); o[good] = (o[good] || 0) - n; if (!o[good]) delete o[good]; left -= n; };
    take(s.cargo);
    for (const f of s.fleet || []) if (left > 0 && f.cargo) take(f.cargo);
  }

  // ---- named quarry: her ship takes the sea when the player nears the place, and cruises there
  _quarryShip(m) { return this.game.ships.find(o => o.missionId === m.id && !o.sunk) || null; }
  _updateQuarry(m) {
    const g = this.game, p = g.player.position, Q = MISSIONS.quarry, z = m.zone;
    if (!z) return;
    const sh = this._quarryShip(m);
    if (sh) {   // the smuggler (merchant AI) would sail off to a port: keep her on her cruising ground
      if (m.sub === 'smuggler' && sh.ai?.state === 'cruise') {
        const w = sh.ai.waypoint;
        if (!w || Math.hypot(w.x - z.x, w.z - z.z) > z.r * 1.2 || Math.hypot(w.x - sh.position.x, w.z - sh.position.z) < 180) {
          const a = Math.random() * Math.PI * 2, rr = z.r * (0.3 + Math.random() * 0.6);
          sh.ai.waypoint = { x: z.x + Math.cos(a) * rr, z: z.z + Math.sin(a) * rr };
        }
      }
      return;
    }
    if (m.ready || Math.hypot(z.x - p.x, z.z - p.z) > Q.spawnRange || !g.combat?.spawnAI) return;
    let x, zz, ok = false;
    for (let i = 0; i < 24 && !ok; i++) {
      const a = Math.random() * Math.PI * 2, rr = 150 + Math.random() * z.r * 0.8;
      x = z.x + Math.cos(a) * rr; zz = z.z + Math.sin(a) * rr;
      ok = Math.abs(x) < 7600 && Math.abs(zz) < 7600 && !g.islands?.isLand?.(x, zz, 70) && Math.hypot(x - p.x, zz - p.z) > 500
        && !g.ships.some(o => Math.hypot(o.position.x - x, o.position.z - zz) < 150);
    }
    if (!ok) return;
    const spec = SHIP_TYPES[m.type] ? { crew: SHIP_TYPES[m.type].crew } : { crew: 90 };
    const sh2 = g.combat.spawnAI({ type: SHIP_TYPES[m.type] ? m.type : 'schooner', faction: 'pirate', role: m.sub === 'smuggler' ? 'merchant' : 'pirate', x, z: zz,
      heading: Math.random() * Math.PI * 2, sailSetting: 0.6, name: m.ship, crew: Math.round(spec.crew * Q.crewF[m.sub === 'smuggler' ? 'smuggler' : 'pirate']) });
    if (!sh2) return;
    sh2.missionId = m.id;
    if (m.sub !== 'smuggler') sh2.gunPower = Q.gunPower;
    sh2._captain = { name: `${m.captain}, known as ${m.nick}`, faction: 'pirate', difficulty: m.duel ?? 0.58, weapon: 'cutlass' };
    if (sh2.ai) sh2.ai.waypoint = { x: z.x, z: z.z };
    g.events.emit('mission:quarry', { mission: m, ship: sh2 });
    g.events.emit('notify', { text: `A suspicious sail near ${m.place}: ${theShipN(m.type, m.ship)}, ship of ${m.captain}, known as ${m.nick}. That is your man.`, kind: 'bad', major: true, tone: 'bad', topic: 'lord', key: 'quarry' });
  }
  // the quarry went down without the player's hand in it: no bounty, no blame
  _quarryGone(ship) {
    if (!ship?.missionId) return;
    const g = this.game, m = g.state.missions.find(x => x.id === ship.missionId && x.status === 'active' && x.kind === 'quarry');
    if (!m || m.ready) return;
    m.status = 'void';
    g.events.emit('career:mission', { mission: m, status: 'void' });
    g.events.emit('notify', { text: `${cap(theShipN(m.type, m.ship))} went down without you: the bounty on ${m.captain} slips away. The mission is void.`, kind: 'info' });
  }

  // ---- what entering this port does for the missions under way (HUD port prompt, approach notice), or null
  missionAtPort(port) {
    if (!port) return null;
    for (const m of this.game.state.missions || []) {
      if (m.status !== 'active') continue;
      if (m.kind === 'deliver' && m.to === port.id) return 'hand over the dispatches';
      if (m.kind === 'envoy' && (m.to === port.id || (port.faction === m.other && !port.haven))) return 'hand over the letter';
      if (m.kind === 'transport' && m.to === port.id) return 'deliver the cargo';
      if (m.kind === 'escort' && m.to === port.id) return 'bring the merchantman in';
      if ((m.kind === 'quarry' || m.kind === 'hunt') && m.ready && port.faction === m.nation && !port.haven) return m.kind === 'quarry' ? 'collect the bounty' : 'report on the hunt';
      if ((m.kind === 'scout' || m.kind === 'rescue') && m.ready && port.id === m.from) return m.kind === 'scout' ? 'make your report' : 'land the castaways';
    }
    return null;
  }

  // ---- objective of a mission under way, for the governor's list and the chart
  missionObjective(m) {
    const adj = nationAdj(m.nation);
    switch (m.kind) {
      case 'deliver': return `Enter port at ${m.toName} (F): the dispatches are handed over on arrival.`;
      case 'escort': return `Bring the merchantman to ${m.toName}: she must follow you closely as you enter port.`;
      case 'envoy': return `Enter port at ${m.toName} (or any ${nationAdj(m.other)} port) (F): the letter is handed over on arrival.`;
      case 'hunt': return m.ready ? `Done: enter ${a(adj)} port (F) to report.` : `${m.target === 'pirate' ? 'Pirate ship taken or sunk' : `${nationAdj(m.target)} ships taken or sunk`}: ${m.progress || 0}/${m.count}.`;
      case 'transport': return `Deliver ${qtyLabel(m.qty, m.good, GOODS)} to ${m.toName}: enter port (F), they are unloaded on arrival. Aboard: ${Math.min(m.qty, this._carried(m.good))}/${m.qty}.`;
      case 'quarry': return m.ready ? `${m.captain} out of action: enter ${a(adj)} port (F) to collect the bounty.` : `Sink, take or force the surrender of ${theShipN(m.type, m.ship)}, ship of ${m.captain}, known as ${m.nick}, near ${m.place}.`;
      case 'scout': return m.ready ? `Report ready (${m.report || 'defences noted'}): return to port at ${m.fromName} (F).` : `Come within ${m.near || MISSIONS.scout.near}${NBSP}m of ${m.toName}, then return to ${m.fromName}.`;
      case 'rescue': return m.ready ? `${m.men} castaways aboard: return to port at ${m.fromName} (F).` : `Pick up the castaways near ${m.place}, then return to ${m.fromName}.`;
      default: return '';
    }
  }
  // map targets of the missions under way: { id, kind, x, z, r?, port?, label, tip, title, deadline }
  missionTargets() {
    const g = this.game, ports = g.islands?.ports || [], byId = id => ports.find(p => p.id === id), out = [];
    for (const m of g.state.missions || []) {
      if (m.status !== 'active') continue;
      const base = { id: m.id, kind: m.kind, title: m.title, deadline: m.deadline, tip: this.missionObjective(m) };
      const at = (p, label) => { if (p) out.push({ ...base, x: p.x, z: p.z, port: p.id, label }); };
      if (m.kind === 'deliver') at(byId(m.to), 'dispatches to deliver');
      else if (m.kind === 'envoy') at(byId(m.to), 'letter to deliver');
      else if (m.kind === 'escort') at(byId(m.to), 'merchantman to bring here');
      else if (m.kind === 'transport') at(byId(m.to), `deliver ${qtyLabel(m.qty, m.good, GOODS)}`);
      else if (m.kind === 'quarry') { if (m.ready) continue; out.push({ ...base, x: m.zone.x, z: m.zone.z, r: m.zone.r, label: `${m.captain}, known as ${m.nick}` }); }
      else if (m.kind === 'scout') at(byId(m.ready ? m.from : m.to), m.ready ? 'report to make' : 'to scout');
      else if (m.kind === 'rescue') { if (m.ready) at(byId(m.from), 'bring the castaways back'); else if (m.spot) out.push({ ...base, x: m.spot.x, z: m.spot.z, label: 'castaways' }); }
    }
    return out;
  }

  _complete(m) {
    const g = this.game;
    m.status = 'done'; m.reward = Math.round((m.reward || 0) * (g.fortune?.fx.missionMul ?? 1)); g.state.gold += m.reward;   // jewel
    this._merit(m.nation, m.merit ?? (m.kind === 'hunt' ? 3 : 2));   // envoy missions carry their own merit
    changeReputation(g, m.nation, m.rep, 'mission');
    g.events.emit('career:mission', { mission: m, status: 'done' });
    g.events.emit('notify', { text: `Mission accomplished: ${m.title}. ${m.reward ? `${m.reward} gold paid.` : `The ${nationPeople(m.nation)} will not forget it.`}`, kind: 'good' });
  }

  // integration: one credit per enemy ship. A ship can strike, then be boarded, then be burnt — previously each of
  // 'ship:struck' + 'ship:sunk' added captures and plunder (and boarding added its own share on top).
  // Now: captures / mission progress count once per ship; generic plunder (salvage value) only for ships sunk
  // without being boarded — boarded prizes get their plunder share from the actual spoils in boarding.js.
  _onKill(ship, how) {
    if (!ship || ship.isPlayer) return;
    const s = this.game.state;
    // only ships the player fought count (not AI-vs-AI kills)
    if (how !== 'boarded' && !ship.lastAttacker?.isPlayer) return;
    if (how === 'sunk' && !ship._boarded && !ship._plunderCredited) {
      ship._plunderCredited = true;
      s.plunder = (s.plunder || 0) + Math.round(({ sloop: 300, schooner: 450, brig: 700, merchantman: 1100, frigate: 1500, galleon: 2600 }[ship.type] || Math.round((SHIP_TYPES[ship.type]?.price || 4000) / 9)) * 0.3);
    }
    if (ship._careerCounted) return;
    ship._careerCounted = true;
    // merit with every nation at war with the victim that the player serves (own flag or letter of marque)
    const pf = this.game.player?.faction;
    const w = (KILL_MERIT[ship.type] || 1) * (how === 'boarded' ? 1.5 : 1);
    for (const n of NATIONS) if (n !== ship.faction && relation(n, ship.faction) < 0 && (n === pf || s.letters[n])) this._merit(n, w);
    s.captures = (s.captures || 0) + 1;
    const qm = ship.missionId && s.missions.find(m => m.id === ship.missionId && m.status === 'active' && m.kind === 'quarry');
    if (qm && !qm.ready) {   // named quarry: sunk, struck or boarded by the player
      qm.ready = true; qm.how = how;
      this.game.events.emit('career:mission', { mission: qm, status: 'progress' });
      this.game.events.emit('notify', { text: `${how === 'sunk' ? `${cap(theShipN(qm.type, qm.ship))} sinks` : how === 'struck' ? `${cap(theShipN(qm.type, qm.ship))} strikes her colours` : `${qm.captain} is in your irons`}: ${qm.nick} will trouble no one again. Collect the bounty in ${a(nationAdj(qm.nation))} port.`, kind: 'good', topic: 'lord' });
    }
    for (const m of s.missions) if (m.status === 'active' && m.kind === 'hunt' && ship.faction === m.target) {
      m.progress = (m.progress || 0) + 1;
      if (m.progress >= m.count) m.ready = true;
    }
  }

  _merit(n, v) {
    const s = this.game.state, r = this.rankOf(n);
    s.merit[n] = (s.merit[n] || 0) + v;
    if (r.next && s.merit[n] >= r.need && (s.merit[n] - v) < r.need)
      this.game.events.emit('notify', { text: `Word of your exploits has reached the ${nationPeople(n)}: a governor awaits you for a promotion.`, kind: 'good' });
  }

  _onPort(port) {
    if (!port) return;
    const s = this.game.state;
    this._crewMood(false);
    s.lastPort = port.id;
    this._checkCargo('lost');
    for (const m of s.missions) {
      if (m.status === 'failed' && m.owed && m.kind === 'transport' && port.faction === m.nation && !port.haven) {   // late transport: goods seized
        const n = Math.min(m.qty, this._carried(m.good)); m.owed = false;
        if (n > 0) { this._unload(m.good, n); this.game.events.emit('notify', { text: `The harbour master has ${qtyLabel(n, m.good, GOODS)} owed to ${m.fromName} seized.`, kind: 'bad' }); }
        continue;
      }
      if (m.status !== 'active') continue;
      if (m.kind === 'deliver' && m.to === port.id) this._complete(m);
      else if (m.kind === 'transport' && m.to === port.id) {
        this._unload(m.good, m.qty);
        this.game.events.emit('notify', { text: `${cap(qtyLabel(m.qty, m.good, GOODS))} are unloaded on the quay at ${port.name}.`, kind: 'info' });
        this._complete(m);
      }
      else if (m.kind === 'quarry' && m.ready && port.faction === m.nation) this._complete(m);
      else if ((m.kind === 'scout' || m.kind === 'rescue') && m.ready && port.id === m.from) this._complete(m);
      else if (m.kind === 'escort' && m.to === port.id) {
        const e = this.escortShip, p = this.game.player;
        if (e && e.alive && !e.sinking && p && Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z) < 900) {
          this._complete(m); this.game.removeShip(e); this.escortShip = null;
        } else this.game.events.emit('notify', { text: 'The harbour master asks after the merchantman you were supposed to escort.', kind: 'bad' });
      }
      else if (m.kind === 'hunt' && m.ready && port.faction === m.nation) this._complete(m);
      else if (m.kind === 'envoy' && port.faction === m.other) this.game.living?.deliverEnvoy(m, port);   // peace / alliance letter
    }
  }
}
