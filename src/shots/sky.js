// Showcase: low camera skimming the swell, looking toward the sun (azimuth follows ?tod) with a Spanish galleon
// silhouetted mid-frame, cumulus banks and cirrus overhead, horizon haze. ?weather=storm|cloudy supported
// (handled by Sky from game.params). ?view=away looks away from the sun (front-lit ship, belt of Venus).
export async function setup(game) {
  const sky = game.sky;
  const away = game.params.get('view') === 'away';
  // aim at the sun's azimuth (or the moon's at night) so the composition always has the light source
  const night = sky.sunElevation <= -8;
  const L = !night ? sky.sunDir : sky.moonDir;
  let ax = L.x, az = L.z;
  const n = Math.hypot(ax, az) || 1; ax /= n; az /= n;
  if (away) { ax = -ax; az = -az; }
  // rotate the look direction a little so the sun sits off-centre (rule of thirds)
  const yaw = away ? 0 : 0.2;
  const dx = ax * Math.cos(yaw) - az * Math.sin(yaw), dz = ax * Math.sin(yaw) + az * Math.cos(yaw);

  const cx = -2600, cz = 2400;          // open water, away from the test island
  const cam = [cx, 7.5, cz];
  const ship = { x: cx + dx * 150 + dz * 18, z: cz + dz * 150 - dx * 18 };
  game.spawnShip({ type: 'galleon', faction: 'spanish', x: ship.x, z: ship.z, heading: Math.atan2(-dz, -dx) * 0 + Math.atan2(dz, dx) + 0.55, sailSetting: 0.8 });
  game.cameraRig.setShot({ position: cam, lookAt: [cx + dx * 400, night ? 120 : 34, cz + dz * 400] });
  game.camera.updateMatrixWorld();
  // storm: fire a bolt into the frame (frozen screenshots catch the flash)
  if (sky.weather === 'storm') { sky.lightning.strike(game.camera, { dist: 2600, angle: -0.35 }); sky.lightning._t = 0.12; }
}
