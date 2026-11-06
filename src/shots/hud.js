// Showcase: the player's brig, battered after an exchange, a hostile Spanish frigate off the starboard bow,
// a port nearby (prompt visible), captain's-log toasts. ?menu=1 title screen, ?menu=captain captain sheet.
import { PlayerController } from '../ships/playerController.js';

export async function setup(game) {
  game.wind.angle = Math.PI * 0.75; game.wind.speed = 11;
  const port = game.islands?.ports?.[0];
  const hp = port?.harborPoint || { x: 0, z: 0 };
  const menu = game.params.get('menu');
  let x = hp.x - 220, z = hp.z + 140, heading = 0.8;
  if (menu) {
    // hero composition: open water well off the harbour, ship crossing the frame, island behind
    const sw = port?.seaward || { x: 0, z: 1 };
    x = hp.x + sw.x * 950; z = hp.z + sw.z * 950;
    heading = Math.atan2(sw.z, -sw.x) ;            // perpendicular to the seaward axis (sail along the coast)
  }
  const p = game.player = game.spawnShip({ type: 'brig', faction: 'english', isPlayer: true, x, z, heading, sailSetting: 1, name: 'Merry Wren' });
  p.controller = new PlayerController(game, p);
  p.hull = p.hullMax * 0.62; p.sails = 0.78; p.crew = Math.round(p.crewMax * 0.55);
  p.reload = { port: 0.42, starboard: 1 };
  p.ammo = 'chain'; p.speed = 5.1; p.sailEff = 1;
  const e = game.spawnShip({ type: 'frigate', faction: 'spanish', x: x + 170, z: z - 60, heading: 0.8 + 0.5, sailSetting: 0.5, name: 'Santa Lucía' });
  e.hull = e.hullMax * 0.48; e.sails = 0.55; e.crew = Math.round(e.crewMax * 0.7); e.hostile = true;
  game.spawnShip({ type: 'merchantman', faction: 'dutch', x: x - 600, z: z + 500, heading: 2.4, sailSetting: 1, name: 'Goede Hoop' });
  game.spawnShip({ type: 'sloop', faction: 'english', x: x + 900, z: z + 300, heading: -1, sailSetting: 1, name: 'Kestrel' });
  game.state.gold = 4385; game.state.name = 'Elias Thorne';
  game.state.date = { year: 1661, month: 3, day: 14 };
  game.cameraRig.follow(p);
  if (menu) {
    // camera further out to sea, low, looking past the ship toward the island
    const sw = port?.seaward || { x: 0, z: 1 };
    const fx = Math.sin(heading), fz = -Math.cos(heading);
    const cx = x + sw.x * 120 - fx * 40, cz = z + sw.z * 120 - fz * 40;
    game.cameraRig.setShot({ position: [cx, 14, cz], lookAt: [x - sw.x * 120 + fx * 10, 16, z - sw.z * 120 + fz * 10], fov: 50 });
    for (const s2 of game.ships) if (s2 !== p) { s2.position.x += sw.x * 2000; s2.position.z += sw.z * 2000; }
  } else game.cameraRig.chaseShot?.({ yaw: 0.35, pitch: 0.05, dist: 1 });
  const ev = game.events;
  ev.emit('notify', { text: 'A Spanish frigate in sight, two points on the starboard bow.', kind: 'info' });
  for (let i = 0; i < 4; i++) ev.emit('cannon:hit', { target: e, attacker: p, part: i < 3 ? 'sails' : 'hull', damage: 3 });
  for (let i = 0; i < 3; i++) ev.emit('cannon:hit', { target: p, attacker: e, part: 'hull', damage: 4 });
  await new Promise(r => setTimeout(r, 800));
}
