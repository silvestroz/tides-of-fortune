// Sites of the ports, villages and coves on the analytic coast, and the terrain edits they need (flattened quay,
// dredged channel, fort). Pure functions of the world shape (WorldShape): Islands calls them, and so does prebake.js
// before the game is built, so that the relief tiles baked in Web Workers carry the same edits.
//   siteWorld(shape, world) -> { ports, coves, villages }   (in this order: the edits accumulate on shape)

// find the coast point along the port's seaward axis
export function findCoast(sh, ax, az, sx, sz) {
  let x = ax, z = az;
  if (sh.rawHeight(x, z) > 0) {
    for (let i = 0; i < 400 && sh.rawHeight(x, z) > 0; i++) { x += sx * 5; z += sz * 5; }
  } else {
    for (let i = 0; i < 400 && sh.rawHeight(x, z) <= 0; i++) { x -= sx * 5; z -= sz * 5; }
    x += sx * 5; z += sz * 5;
  }
  return { x, z };
}

// port: quay, town flat, dredged approach and fort headland (terrain edits registered on the shape)
export function sitePort(sh, p) {
  const [sx, sz] = p.side;
  const c = findCoast(sh, p.anchor[0], p.anchor[1], sx, sz);
  const big = p.size === 'large' ? 1.3 : p.size === 'medium' ? 1.0 : 0.75;
  // quay line sits ~12 m seaward of the natural coast
  const qx = c.x + sx * 12, qz = c.z + sz * 12;
  const ix = -sx, iz = -sz;                 // inland axis
  const lx = -sz, lz = sx;                  // lateral axis (x right when facing inland... any)
  const hw = 150 * big, depth = 300 * big;
  sh.addFlatten({ cx: qx, cz: qz, ax: ix, az: iz, hw, d0: 0, d1: depth, h0: 2.3, slope: 0.085, fall: 90 });   // steeper coteau, the town climbs in tiers
  sh.addDredge({ cx: qx, cz: qz, ax: sx, az: sz, hw: hw * 0.9, d0: 0, d1: 520, depth: -11, fall: 120, shelf: 70, shelfDepth: -2.2 });   // sandy shelf at the quay: turquoise water over visible sand
  // fort on a headland to one side
  const fs = p.fortSide;
  const fx = qx + lx * fs * (hw + 95) - sx * 5, fz = qz + lz * fs * (hw + 95) - sz * 5;
  const fh = Math.min(28, Math.max(9, sh.rawHeight(fx - sx * 30, fz - sz * 30) * 0.8 + 6));
  sh.addFlatten({ circle: true, cx: fx, cz: fz, r: 46, fall: 55, h0: fh, dome: 0 });
  const harborPoint = { x: qx + sx * 230, z: qz + sz * 230 };
  return {
    id: p.id, name: p.name, faction: p.faction, islandId: p.islandId, size: p.size, goods: p.goods,
    haven: p.haven, population: p.population, townSeed: p.townSeed,
    x: qx + ix * 70, z: qz + iz * 70,
    quay: { x: qx, z: qz }, seaward: { x: sx, z: sz }, lateral: { x: lx, z: lz },
    townCenter: { x: qx + ix * 70, z: qz + iz * 70 }, extent: { hw, depth },
    fort: { x: fx, z: fz, y: fh, side: fs },
    harborPoint,
  };
}

// fishing villages: a flattened, low beach and a channel dredged through the reef out to deep water
export function siteVillage(sh, v) {
  const [sx, sz] = v.side;
  const c = findCoast(sh, v.anchor[0], v.anchor[1], sx, sz);
  const qx = c.x + sx * 6, qz = c.z + sz * 6, ix = -sx, iz = -sz, lx = -sz, lz = sx;
  const hw = 70, depth = 110;
  sh.addFlatten({ cx: qx, cz: qz, ax: ix, az: iz, hw, d0: 0, d1: depth, h0: 1.4, slope: 0.035, fall: 60 });
  sh.addDredge({ cx: qx, cz: qz, ax: sx, az: sz, hw: 32, d0: 30, d1: 460, depth: -8.5, fall: 70, shelf: 55, shelfDepth: -1.6 });
  return {
    id: v.id, name: v.name, village: true, faction: 'neutral', islandId: v.islandId, size: 'small', sells: v.sells || ['food'], seed: v.seed || 1,
    x: qx + ix * 35, z: qz + iz * 35,
    quay: { x: qx, z: qz }, seaward: { x: sx, z: sz }, lateral: { x: lx, z: lz },
    townCenter: { x: qx + ix * 35, z: qz + iz * 35 }, extent: { hw, depth },
    harborPoint: { x: qx + sx * 200, z: qz + sz * 200 },
  };
}

export function siteCove(sh, c) {
  const [sx, sz] = c.side;
  const p = findCoast(sh, c.anchor[0], c.anchor[1], sx, sz);
  return { id: c.id, islandId: c.islandId, x: p.x - sx * 18, z: p.z - sz * 18, anchorPoint: { x: p.x + sx * 180, z: p.z + sz * 180 } };
}

export function siteWorld(sh, world) {
  const ports = world.ports.map(p => sitePort(sh, p));
  const coves = world.coves.map(c => siteCove(sh, c));
  const villages = (world.villages || []).map(v => siteVillage(sh, v));
  return { ports, coves, villages };
}
