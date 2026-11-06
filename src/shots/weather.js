// Showcase for gameplay weather cells (src/world/weatherZones.js): the player's brig running under a
// squall's lee, a storm on the horizon. ?cam=high for a wide view. Playable live.
import { PlayerController } from '../ships/playerController.js';

export async function setup(game) {
  game.wind.angle = Math.PI * 0.75; game.wind.speed = 11;
  const x = -900, z = 900, heading = game.wind.angle + 0.25;   // broad reach, downwind
  const p = game.player = game.spawnShip({ type: game.params.get('type') || 'brig', faction: 'english', isPlayer: true, x, z, heading, sailSetting: 1, name: 'Merry Wren' });
  p.controller = new PlayerController(game, p);
  const W = game.weatherZones;
  if (W) {
    const fx = Math.sin(heading), fz = -Math.cos(heading), rx = Math.cos(heading), rz = Math.sin(heading);
    const sq = W.zones.find(zn => zn.kind === 'squall'), st = W.zones.find(zn => zn.kind === 'storm');
    // squall just upwind of us (we are in its lee), storm far ahead off the bow
    sq.x = x - Math.sin(game.wind.angle) * sq.r * 0.2; sq.z = z + Math.cos(game.wind.angle) * sq.r * 0.2;
    st.x = x + fx * 2600 + rx * 900; st.z = z + fz * 2600 + rz * 900;
    W.update(1 / 30, game.time);
  }
  p.sailEff = 1;
  for (let i = 0; i < 300; i++) { game.weatherZones?.update(1 / 30, game.time); p.update(1 / 30, game.time); }
  const rig = game.cameraRig;
  rig.follow(p);
  if (game.params.get('cam') === 'high') rig.setShot({ position: [x - 500, 420, z + 900], lookAt: [x + 300, 80, z - 600] });
}
