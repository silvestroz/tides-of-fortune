// Showcase: a landing in front of a Spanish town, land battle in progress.
//   ?port=<id> (default havana)   ?approach=sea|land   ?play=<s> advances the battle (troops sent onto the square)
//   ?view=offer: the “Attack the town” choice screen   ?view=victory: the victory screen
import { PlayerController } from '../ships/playerController.js';

export async function setup(game) {
  const port = game.islands.getPort?.(game.params.get('port') || 'havana') || game.islands.ports.find(p => !p.haven);
  const hp = port.harborPoint;
  const p = game.player = game.spawnShip({ type: 'frigate', faction: 'english', isPlayer: true, x: hp.x, z: hp.z, heading: 0, sailSetting: 0, name: 'Merry Wren' });
  p.controller = new PlayerController(game, p); p.crew = 150;
  game.cameraRig.follow(p);
  game.combat.setTrafficTarget?.(0);
  Object.assign(game.state, { name: 'Elias Thorne', gold: 2400, crew: 150 });
  for (let i = 0; i < 10; i++) game.step(1 / 30);
  const view = game.params.get('view');
  if (view === 'offer') { game.landBattle.offer(port); return; }
  await game.landBattle.start(port, { approach: game.params.get('approach') || 'land' });
  const lb = game.landBattle, sim = lb.sim;
  const play = parseFloat(game.params.get('play') || (view === 'victory' ? '0' : '18'));
  const mine = sim.units.filter(u => u.side === 'player');
  sim.order(mine, sim.map.town.x, sim.map.town.z - 40);
  for (let t = 0; t < play; t += 1 / 20) sim.step(1 / 20);
  const v = lb.view; v.cam.x = sim.map.town.x - 20; v.cam.z = sim.map.town.z - 120; v.cam.dist = 300;
  if (view === 'victory') lb.forceEnd('player');
}
