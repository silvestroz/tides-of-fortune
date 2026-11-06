// Integration showcase: player ship near the test island, mid-afternoon.
import { PlayerController } from '../ships/playerController.js';
export async function setup(game) {
  const p = game.player = game.spawnShip({ type: 'brig', faction: 'english', isPlayer: true, x: 300, z: 100, heading: 0.9, sailSetting: 1, name: 'Merry Wren' });
  p.controller = new PlayerController(game, p);
  game.spawnShip({ type: 'galleon', faction: 'spanish', x: 380, z: -40, heading: -2.2, sailSetting: 0.5 });
  game.cameraRig.setShot({ position: [230, 22, 170], lookAt: [360, 6, 20] });
}
