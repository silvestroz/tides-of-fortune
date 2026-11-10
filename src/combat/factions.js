// Faction relations + player reputation hooks.
//   RELATIONS[a][b]                 -1 war, 0 neutral/wary, 1 allied (symmetric)
//   relation(a, b) -> -1|0|1
//   isHostile(game, shipA, shipB)   true if A should treat B as an enemy (wars, pirates, player reputation, grudges)
//   getReputation(game, faction)    player's standing (-100..100), stored in game.state.reputation[faction]
//   changeReputation(game, faction, delta, reason?)  clamps, emits 'reputation:change' { faction, value, delta, reason }
//   onPlayerAttack(game, ship)      hook: player fired on / hit a ship (rep loss with its faction, small gain with its enemies)
//   onPlayerSink(game, ship)        hook: player sank or captured a ship
//   HOSTILE_REP                     reputation below which a faction attacks the player on sight (-25)
// Ship-level grudges: ship.grudges (Set of ships that fired on it) make a ship hostile regardless of politics.
export const RELATIONS = {
  english: { english: 1, spanish: -1, french: 0, dutch: -1, pirate: -1 },
  spanish: { english: -1, spanish: 1, french: 0, dutch: 0, pirate: -1 },
  french:  { english: 0, spanish: 0, french: 1, dutch: -1, pirate: -1 },
  dutch:   { english: -1, spanish: 0, french: -1, dutch: 1, pirate: -1 },
  pirate:  { english: -1, spanish: -1, french: -1, dutch: -1, pirate: 0 },
};
export const HOSTILE_REP = -25;

export function relation(a, b) {
  if (a === b) return a === 'pirate' ? 0 : 1;
  return RELATIONS[a]?.[b] ?? 0;
}

export function getReputation(game, faction) {
  const r = game.state?.reputation;
  return r ? (r[faction] ?? 0) : 0;
}

export function changeReputation(game, faction, delta, reason = '') {
  if (!game.state) return 0;
  const r = game.state.reputation || (game.state.reputation = {});
  const v = Math.max(-100, Math.min(100, (r[faction] ?? 0) + delta));
  if (v !== r[faction]) {
    r[faction] = v;
    game.events.emit('reputation:change', { faction, value: v, delta, reason });
  }
  return v;
}

export function isHostile(game, a, b) {
  if (!a || !b || a === b) return false;
  if ((a._prologue && !b.isPlayer) || (b._prologue && !a.isPlayer)) return false;   // the prologue's target is the player's alone (src/game/prologue.js)
  if (a.grudges?.has(b) || b.grudges?.has(a)) return true;
  if (b.isPlayer) return playerHostility(game, a);
  if (a.isPlayer) return playerHostility(game, b);
  return relation(a.faction, b.faction) < 0;
}

function playerHostility(game, npc) {
  const p = game.player;
  if (npc.faction === 'pirate') return p?.faction !== 'pirate' || getReputation(game, 'pirate') < 0;
  if (getReputation(game, npc.faction) <= HOSTILE_REP) return true;
  // privateer under a nation's flag: that nation's enemies are hostile
  return p ? relation(p.faction, npc.faction) < 0 : false;
}

export function onPlayerAttack(game, ship) {
  if (!ship || ship.isPlayer || ship._repHitT > game.time) return;
  ship._repHitT = game.time + 10;   // at most one reputation hit per ship per 10 s
  const atWar = relation(game.player?.faction, ship.faction) < 0;
  changeReputation(game, ship.faction, atWar ? -2 : -12, 'attack');
  for (const f in RELATIONS) if (f !== ship.faction && relation(f, ship.faction) < 0) changeReputation(game, f, 1, 'attack-enemy');
}

export function onPlayerSink(game, ship) {
  if (!ship || ship.isPlayer) return;
  const atWar = relation(game.player?.faction, ship.faction) < 0;
  changeReputation(game, ship.faction, atWar ? -5 : -20, 'sink');
  for (const f in RELATIONS) if (f !== ship.faction && relation(f, ship.faction) < 0) changeReputation(game, f, ship.faction === 'pirate' ? 6 : 4, 'sink-enemy');
}
