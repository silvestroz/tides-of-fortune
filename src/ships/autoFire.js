// Auto-fire of the player's broadsides (“Assisted” game mode).
//   autoFire(game, ship, ctrl) -> ['port'|'starboard', …]  sides fired by this call; called by PlayerController.update
//                                  at sea (mode 'sail'), only if game.state.assist and without ctrl.holdFire (G key)
//   engagedWith(ship, o)        o attacks the player (ai.target, state 'engage') or the player has already hit it (o.grudges)
//   autoTarget(game, ship, side) nearest engaged ship in this side's arc, in range, excluding a prize to keep
// Firing rules: those of the AI gun crews (ai.js, _gunnery); safeguards and settings: AUTO_FIRE (src/data/assist.js).
// Event 'assist:fire' { side, target } on every automatic broadside (the shot itself goes through combat.fireBroadside:
// 'cannon:fire', repairs interrupted, end of the lugger's discretion… as with manual fire).
import { AUTO_FIRE, isAssist } from '../data/assist.js';

export function engagedWith(p, o) {
  if (!o || o === p || !o.alive || o.sinking || o.sunk || o.struck) return false;
  if (o.grudges?.has(p)) return true;                         // the player hit it: the player opened fire
  const ai = o.ai;
  return !!(ai && ai.target === p && ai.state === 'engage');   // it attacks the player
}

// prize to keep: boardable (combat._canBoard) and no longer fighting, or whose hull wouldn't survive a broadside
function keepPrize(c, p, o) {
  if (!c._canBoard?.(p, o)) return false;
  const attacking = o.ai?.target === p && o.ai.state === 'engage';
  return !attacking || o.hull / (o.hullMax || 1) < AUTO_FIRE.holdHull;
}

export function autoTarget(game, p, side) {
  const c = game.combat, maxR = c.getBroadsideRange(p, p.ammo || 'round') * AUTO_FIRE.rangeK;
  let best = null, bd = Infinity;
  for (const o of game.ships) {
    if (!engagedWith(p, o)) continue;
    const dx = o.position.x - p.position.x, dz = o.position.z - p.position.z, d = Math.hypot(dx, dz);
    if (d > maxR || d >= bd) continue;
    if (c._sideOff(p, side, dx, dz) > Math.atan2((o.length || 20) * 0.5, d) + AUTO_FIRE.arcPad) continue;
    if (keepPrize(c, p, o)) continue;
    best = o; bd = d;
  }
  return best;
}

// no broadside through a ship that isn't hostile (reputation, war declared by mistake)
function clearLine(game, p, t) {
  const dx = t.position.x - p.position.x, dz = t.position.z - p.position.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
  for (const o of game.ships) {
    if (o === p || o === t || !o.alive || o.sinking || o.sunk || game.combat.isHostile(p, o)) continue;
    const ox = o.position.x - p.position.x, oz = o.position.z - p.position.z, along = ox * ux + oz * uz;
    if (along < 0 || along > d) continue;
    if (Math.abs(ox * uz - oz * ux) < (o.length || 20) * 0.6) return false;
  }
  return true;
}

export function autoFire(game, p, ctrl) {
  if (!isAssist(game.state) || ctrl?.holdFire || !game.combat) return [];
  if (!p?.alive || p.struck || p.sinking || p.repairing || (p.crew ?? 0) < 4) return [];
  if (game.time < (ctrl._afT || 0)) return [];
  ctrl._afT = game.time + AUTO_FIRE.scanS;
  const fired = [];
  for (const side of ['port', 'starboard']) {
    if ((p.reload?.[side] ?? 1) < 1) continue;
    const t = autoTarget(game, p, side);
    if (!t || !clearLine(game, p, t)) continue;
    if (game.combat.fireBroadside(p, side, p.ammo)) { fired.push(side); game.events.emit('assist:fire', { side, target: t }); }
  }
  return fired;
}
