// Showcase: the player's brig heeling hard on a beam reach through swells, chase-cam composition,
// an NPC frigate on a parallel course off the lee bow. Works frozen (screenshot) and live (playable).
// ?cam=broadside|tactical|path  — alternate compositions for testing the camera rig.
import { PlayerController } from '../ships/playerController.js';
import { wrapAngle } from '../core/constants.js';

export async function setup(game) {
  game.wind.angle = Math.PI * 0.75;         // blowing toward SE, i.e. from the NW
  game.wind.speed = 12;                     // fresh breeze
  if (game.ocean) game.ocean.seaState = 0.7;
  const from = game.wind.angle + Math.PI;   // direction the wind comes from
  const heading = wrapAngle(from + Math.PI * 0.5 + 0.12); // ~97° off the wind: beam reach, wind on the port beam

  const x = -900, z = 900;
  const p = game.player = game.spawnShip({ type: 'brig', faction: 'english', isPlayer: true, x, z, heading, sailSetting: 1, name: 'Merry Wren' });
  p.controller = new PlayerController(game, p);

  // companion / quarry: a frigate ahead and to leeward on the same tack
  const fx = Math.sin(heading), fz = -Math.cos(heading), rx = Math.cos(heading), rz = Math.sin(heading);
  const npc = game.spawnShip({
    type: 'frigate', faction: 'french', x: x + fx * 230 + rx * 150, z: z + fz * 230 + rz * 150,
    heading: heading - 0.05, sailSetting: 1, name: 'La Vigilante',
  });
  npc.hostile = false;

  // bring both ships up to speed and settle heel/buoyancy so even a frozen frame looks under way
  for (const s of [p, npc]) {
    s.sailEff = s.sailSetting;
    for (let i = 0; i < 360; i++) s.update(1 / 30, game.time);
  }
  // keep the frigate abeam-ish of us: match speeds
  npc.desiredHeading = npc.heading;

  const cam = game.params.get('cam');
  const rig = game.cameraRig;
  rig.follow(p);
  if (cam === 'broadside' || cam === 'tactical') rig.setMode(cam);
  else if (cam === 'path') {
    rig.setShotPath([
      { position: [-40, 4, 30], lookAt: [0, 8, -10], fov: 50 },
      { position: [-55, 9, -5], lookAt: [0, 10, -10], fov: 46 },
      { position: [-35, 14, -60], lookAt: [0, 9, 0], fov: 44, roll: 0.03 },
      { position: [20, 24, -90], lookAt: [30, 6, 40], fov: 50 },
    ], { duration: 10, loop: true, relativeTo: p });
  } else {
    // three-quarter chase from the windward (high) quarter: you see the deck tilted toward you,
    // the sails pressed out to leeward and the frigate beyond
    rig.chaseShot({ yaw: 0.85, pitch: 0, dist: 0.8 });
  }
}
