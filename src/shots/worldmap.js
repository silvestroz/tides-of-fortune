// Showcase: the full-screen sea chart open mid-voyage, with a sailed track, sighted ships and a rumoured cove.
//   ?view=wide   whole-archipelago zoom
import { PlayerController } from '../ships/playerController.js';
export async function setup(game) {
  const view = game.params.get('view') || 'voyage';
  game.combat.setTrafficTarget?.(0);
  const ports = game.islands.ports;
  const a = ports[0], b = ports[Math.min(3, ports.length - 1)];
  const p = game.player = game.spawnShip({ type: 'brig', faction: 'english', isPlayer: true, x: a.harborPoint.x, z: a.harborPoint.z, heading: 0.6, name: 'Merry Wren' });
  p.controller = new PlayerController(game, p);
  game.cameraRig.follow(p);
  // synthesize a voyage track from port a toward port b with some tacks
  const wm = game.worldMap;
  const N = 60;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = a.harborPoint.x + (b.harborPoint.x - a.harborPoint.x) * t * 0.7 + Math.sin(t * 9) * 260;
    const z = a.harborPoint.z + (b.harborPoint.z - a.harborPoint.z) * t * 0.7 + Math.cos(t * 7) * 180;
    if (!game.islands.isLand(x, z, 20)) wm.track.push({ x: Math.round(x), z: Math.round(z) });
  }
  const last = wm.track[wm.track.length - 1];
  p.teleport(last.x, last.z, Math.atan2(b.harborPoint.x - last.x, -(b.harborPoint.z - last.z)));
  wm._lastTrack = last;
  const mk = (type, faction, role, dx, dz, h) => { if (!game.islands.isLand(last.x + dx, last.z + dz, 40)) game.combat.spawnAI({ type, faction, role, x: last.x + dx, z: last.z + dz, heading: h, name: { galleon: 'Santa Inés', sloop: 'Gallows Bird', frigate: 'La Vigilante' }[type] }); };
  mk('galleon', 'spanish', 'merchant', 900, -400, 1.2); mk('sloop', 'pirate', 'pirate', -700, 600, 2.4); mk('frigate', 'french', 'patrol', 400, 1100, 4.1); mk('frigate', 'french', 'patrol', 1300, -900, 4.1);
  for (let i = 0; i < 5; i++) game.step(1 / 30);
  wm._sightT = 0; wm.update();
  const cove = game.islands.coves?.[0];
  if (cove) wm.reveal(cove.id);
  wm.open();
  if (view === 'wide') { wm._fit(); wm.view.zoom = 1; wm._clampView(); }
  else wm.focus(last.x, last.z, 2.6);
  wm.draw();
}
