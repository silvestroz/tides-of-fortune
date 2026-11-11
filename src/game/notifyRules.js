// Which events deserve a message to the player (pure rules, no DOM; read by the 'notify' emitters).
//   concernsPlayer(game, ship)  the player's own ship, a ship he fights (either side has fired, or it hunts him),
//                               his escort, the prologue target: anything else is a third party, whose surrender,
//                               sinking or exploding magazine is not reported (neither toast nor journal)
//   inPrologue(game)            the guided prologue is under way (state.tutorials.goals.step 'p-…'): world news
//                               and Top 10 sightings are deferred or dropped (Toasts.push opts.defer)
export function concernsPlayer(game, ship) {
  const p = game?.player;
  if (!ship || !p) return false;
  if (ship === p || ship.isPlayer) return true;
  if (ship.escortOf === p || ship === game.career?.escortShip || ship._prologue) return true;
  if (ship.lastAttacker === p || ship.grudges?.has?.(p) || p.grudges?.has?.(ship)) return true;
  const ai = ship.ai;
  return !!(ai && ai.target === p && (ai.state === 'engage' || ai.state === 'flee' || ai.state === 'board'));
}

export const inPrologue = game => /^p-/.test(game?.state?.tutorials?.goals?.step || '');

// a foe that is really fighting: not at anchor (prologue target), not struck, and engaged with the player
export function fightingFoe(game, foe) {
  const p = game?.player;
  if (!foe || !p || foe._prologue || foe.struck || foe.sinking || foe.alive === false) return false;
  const ai = foe.ai;
  if (ai && ai.target === p && ai.state === 'engage') return true;
  return !!(foe.grudges?.has?.(p) && ai && ai.state !== 'cruise');
}
