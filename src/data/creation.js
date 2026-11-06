// Character creation. Original, pure tables (importable in node).
// Captain sheet (src/ui/menu.js): starting nation, special talent, epoch.
//   START_PORT[nation]            starting port (id from src/data/world.js); fallback: the nation's first port
//   startPortFor(ports, nation)   port from islands.ports; startPose(port) -> { x, z, heading } (roads, bow seaward)
//   START_REP / startReputation(nation)   initial reputation: START_REP with one's own nation, 0 elsewhere
//   SKILLS[id] { name, short, effect, fx }   fx = multipliers applied to game.fortune.fx (src/game/fortune.js)
//   skillFx(id) -> fx | null      null: no talent (old save) or unknown value → no effect
//   EPOCHS[id] { id, year, name, short, rel, fam, yardBan } ; epochOf(id) (unknown → DEFAULT_EPOCH) ;
//   applyEpochShips(id)           the epoch's traffic weights and shipyard (src/data/shipTypes.js, setShipEra)
// The “wit” talent also keeps its historical effect on prices (economy.js: 3 % gentler).
import { setShipEra } from './shipTypes.js';

export const START_PORT = { english: 'portroyal', spanish: 'havana', french: 'fortroyal', dutch: 'willemstad' };
export const START_REP = 10;

export function startPortFor(ports = [], nation = 'english') {
  const id = START_PORT[nation];
  return ports.find(p => p.id === id) || ports.find(p => p.faction === nation && !p.haven) || ports[0] || null;
}
// in the roads, bow pointing seaward (heading 0 = north = −Z, clockwise: dx = sin heading, dz = −cos heading)
export function startPose(port) {
  if (!port) return { x: 0, z: 0, heading: 0.6 };
  const h = port.harborPoint || port, sw = port.seaward;
  return { x: h.x, z: h.z, heading: sw ? Math.atan2(sw.x, -sw.z) : 0.6 };
}
export function startReputation(nation, nations = ['english', 'spanish', 'french', 'dutch']) {
  return Object.fromEntries(nations.map(n => [n, n === nation ? START_REP : 0]));
}

// Talents: one clear, moderate effect each, wired into the existing multipliers of game.fortune.fx
// (combat.js: reloadMul, crewLossMul ; ship.gunSpread ; ship.fortuneSpeedF ; ship.shoalDmgF ; duel: duelWindup ;
// career.js: missionMul ; retirement.js: woundMul). They stack with the officers and special items.
export const SKILLS = {
  fencing:    { name: 'Fencing', short: 'A quicker blade in duels', effect: 'Duel wind-up 10% faster', fx: { duelWindup: 0.9 } },
  gunnery:    { name: 'Gunnery', short: 'Quicker, truer broadsides', effect: 'Reload and spread −10%', fx: { reloadMul: 0.9, spreadMul: 0.9 } },
  navigation: { name: 'Navigation', short: 'Sail faster, skim the reefs', effect: 'Speed +4%, reef damage −30%', fx: { speedMul: 1.04, shoalMul: 0.7 } },
  wit:        { name: 'Wit & charm', short: 'Kinder governors and merchants', effect: 'Prices −3%, mission rewards +10%', fx: { missionMul: 1.1 } },
  medicine:   { name: 'Medicine', short: 'Fewer men lost', effect: 'Losses under fire −20%, lighter wounds', fx: { crewLossMul: 0.8, woundMul: 0.8 } },
};
export const SKILL_IDS = Object.keys(SKILLS);
export const skillFx = id => (Object.prototype.hasOwnProperty.call(SKILLS, id) ? SKILLS[id].fx : null);

// Starting epochs: date, initial diplomacy (rel = [nation, nation, −1 war | 0 peace | 1 alliance], applied by
// living.startEpoch() via _setRelation), traffic weight per ship family (fam) and types missing from the shipyard
// (yardBan). The captain's age does not depend on the year (AGE_YEAR, career.js): only the displayed date changes.
export const EPOCHS = {
  early: {
    id: 'early', year: 1640, name: 'The early years', short: 'Spain against all, small hulls',
    rel: [['spanish', 'english', -1], ['spanish', 'french', -1], ['spanish', 'dutch', -1], ['english', 'french', 0], ['english', 'dutch', 0], ['french', 'dutch', 1]],
    fam: { vaisseau: 0.25, fregate: 0.6, corvette: 0.8, galion: 1.35, cotre: 1.3, caboteur: 1.2 },
    yardBan: ['seventyfour', 'threedecker', 'heavyfrigate'],
  },
  golden: { id: 'golden', year: 1660, name: 'The golden age', short: 'Shifting wars, open seas', rel: null, fam: null, yardBan: null },
  late: {
    id: 'late', year: 1680, name: 'The age of squadrons', short: 'Ships of the line, France against all',
    rel: [['french', 'dutch', -1], ['french', 'spanish', -1], ['english', 'dutch', 1], ['english', 'spanish', 0], ['english', 'french', 0], ['spanish', 'dutch', 1]],
    fam: { vaisseau: 1.8, fregate: 1.3, corvette: 1.2, galion: 0.7, cotre: 0.85 },
    yardBan: ['nao'],
  },
};
export const EPOCH_IDS = Object.keys(EPOCHS);
export const DEFAULT_EPOCH = 'golden';
export const epochOf = id => EPOCHS[id] || EPOCHS[DEFAULT_EPOCH];
export const applyEpochShips = id => setShipEra(epochOf(id));
