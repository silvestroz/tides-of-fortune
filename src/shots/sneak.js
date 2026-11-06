// Showcase: sneaking into a hostile Spanish port at nightfall.
//   ?port=<id> (default havana)   ?kind=infiltrate|escape   ?play=<s> advances the game (the captain follows a path)
//   ?view=offer: the “Soldiers guard the quay” screen   ?view=prison: the prison screen with “Attempt an escape”
//   ?level=0..4: forces the gauge (shows the red cones and the alarm)
import { PlayerController } from '../ships/playerController.js';
import { findPath } from '../game/sneak/sim.js';

export async function setup(game) {
  const port = game.islands.getPort?.(game.params.get('port') || 'havana') || game.islands.ports.find(p => !p.haven);
  const hp = port.harborPoint;
  const p = game.player = game.spawnShip({ type: 'brig', faction: 'english', isPlayer: true, x: hp.x + port.seaward.x * 300, z: hp.z + port.seaward.z * 300, heading: 0, sailSetting: 0, name: 'Merry Wren' });
  p.controller = new PlayerController(game, p); p.crew = 60;
  game.cameraRig.follow(p);
  game.combat.setTrafficTarget?.(0);
  Object.assign(game.state, { name: 'Elias Thorne', gold: 2400, crew: 60 });
  for (let i = 0; i < 10; i++) game.step(1 / 30);
  const view = game.params.get('view');
  if (view === 'offer') { game.sneak.offerPort(port); return; }
  if (view === 'prison') { game.boarding._captivityScreen(p, { faction: port.faction, _captain: { name: `the guard of ${port.name}` }, alive: false }, { cause: 'sneak', how: `Caught in the back streets of ${port.name}.` }); return; }
  const kind = game.params.get('kind') || 'infiltrate';
  await game.sneak.start({ kind, port });
  const sn = game.sneak, sim = sn.sim;
  if (kind === 'escape') { sim.map.gate.open = true; sim.map.type[sim.map.gate.j * sim.map.W + sim.map.gate.i] = 0; }
  const play = parseFloat(game.params.get('play') || '9');
  const goal = sim.goals[sim.goals.length > 1 ? 1 : 0];
  const path = findPath(sim.map, sim.player.x, sim.player.z, goal.x, goal.z) || [];
  for (let t = 0; t < play && path.length; t += 1 / 20) {
    const n = path[0], dx = n.x - sim.player.x, dz = n.z - sim.player.z;
    if (Math.hypot(dx, dz) < 0.6) { path.shift(); continue; }
    sim.input = { x: dx, z: dz, run: false, act: false };
    for (const g of sim.guards) g.sus = Math.min(g.sus, 40);   // showcase: we don't get caught
    sim.step(1 / 20);
    if (sim.caught) { sim.caught.x += 12; sim.caught.sus = 0; sim.caught = null; }
  }
  sim.input = { x: 0, z: 0, run: false, act: false };
  const lv = game.params.get('level');
  if (lv != null) {
    const L = +lv, near = sim.guards.filter(g => !g.down).sort((a, b) => Math.hypot(a.x - sim.player.x, a.z - sim.player.z) - Math.hypot(b.x - sim.player.x, b.z - sim.player.z));
    if (L >= 4) sim.raiseAlarm(); else if (near[0]) { near[0].sus = [5, 30, 60, 90][L]; near[0].lastSeen = { x: sim.player.x, z: sim.player.z }; }
    sim.step(0.01);
  }
  sn.view.cam.x = sim.player.x; sn.view.cam.z = sim.player.z;
  sn._scripted = !!game.params.get('frozen');
}
