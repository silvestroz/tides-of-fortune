// Showcase: ?view=port (default) | aerial | beach   [&port=<id>]
export async function setup(game) {
  const v = game.params.get('view') || 'port';
  const isl = game.islands;
  const port = isl.getPort(game.params.get('port') || 'fortroyal') || isl.ports[0];
  const s = port.seaward, l = port.lateral, q = port.quay;
  const P = (a, b, y) => [q.x + s.x * a + l.x * b, y, q.z + s.z * a + l.z * b];
  if (v === 'aerial') {
    game.cameraRig.setShot({ position: [-1500, 2300, -800], lookAt: [-2600, 0, -3200] });
  } else if (v === 'beach') {
    // search a south-facing (sun-lit) flat sandy coast with palms behind it on a lush island
    const i = isl.getIsland(game.params.get('island') || 'grenada');
    let best = null, bestScore = -1e9;
    for (let a = 0; a < 96; a++) {
      const ang = a / 96 * Math.PI * 2, dx = Math.cos(ang), dz = Math.sin(ang);
      let r = 0;
      while (r < 3000 && isl.getTerrainHeight(i.x + dx * r, i.z + dz * r) > 0) r += 4;
      if (r >= 3000) continue;
      const cx = i.x + dx * r, cz = i.z + dz * r;
      const inl = isl.getTerrainHeight(cx - dx * 40, cz - dz * 40), out = isl.getTerrainHeight(cx + dx * 120, cz + dz * 120);
      const score = dz * 2 - Math.abs(inl - 3) - Math.max(0, out + 2) * 0.5 - (isl.coastDistance(cx + dx * 60, cz + dz * 60) < 30 ? 0 : 0);
      if (inl > 0.8 && score > bestScore) { bestScore = score; best = { x: cx, z: cz, dx, dz }; }
    }
    best ||= { x: i.x, z: i.z + 300, dx: 0, dz: 1 };
    const { x, z, dx, dz } = best;
    // stand in the shallows, look along the beach
    game.cameraRig.setShot({ position: [x + dx * 45 + dz * 30, 2.6, z + dz * 45 - dx * 30], lookAt: [x - dz * 90 - dx * 8, 5, z + dx * 90 - dz * 8] });
  } else if (v === 'quay') {
    // close-up ~150 m off the quay: boats on the sand, foam line, fort gun ports
    game.cameraRig.setShot({ position: P(150, 40 * port.fort.side, 16), lookAt: P(-20, 70 * port.fort.side, 6) });
  } else {

    const ship = P(95, 25 * port.fort.side, 0);
    game.spawnShip({ type: 'brig', faction: 'english', x: ship[0], z: ship[2], heading: Math.atan2(l.x, -l.z), sailSetting: 0.5 });
    game.cameraRig.setShot({ position: P(165, -30 * port.fort.side, 8), lookAt: P(-40, 90 * port.fort.side, 27) });   // lower camera, town higher in frame
  }
}
