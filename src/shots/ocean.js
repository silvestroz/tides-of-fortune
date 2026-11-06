// Ocean showcase. URL params:
//   ?view=1 (default)  low chase over a brig's quarter: wake, crest glow, sun glitter, second ship beyond
//   ?view=2            near an island: depth colours, turquoise shallows and surf bands, ship wakes
//   ?view=3            high aerial: Kelvin wakes of two ships, depth gradient into the horizon
//   ?view=4            water-level grazing view toward the sun (reflection / glitter / horizon test)
//   ?sea=0..1          sea state (default 0.45);  ?wind=m/s
import { HALF_WORLD } from '../core/constants.js';

export async function setup(game) {
  const P = game.params;
  const view = P.get('view') || '1';
  const sea = P.get('sea') != null ? parseFloat(P.get('sea')) : 0.45;
  game.wind.angle = Math.PI * 0.75;
  game.wind.speed = P.get('wind') ? parseFloat(P.get('wind')) : 6 + sea * 14;
  game.ocean.seaState = sea;

  // pick a sea area: open water far from land, or next to the first port's island for view 2
  const isl = game.islands;
  let cx = -2400, cz = 2600;
  if (view === '2' && isl?.ports?.length) {
    const p = isl.ports[0];
    const s = p.seaward || { x: 0, z: 1 };
    cx = p.harborPoint.x + s.x * 120; cz = p.harborPoint.z + s.z * 120;
  } else if (isl?.coastDistance) {
    // search a grid for deep water ≥ 600 m from any coast
    let best = null, bd = -1;
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
      const x = i * 1000, z = j * 1000;
      if (Math.abs(x) > HALF_WORLD - 1500 || Math.abs(z) > HALF_WORLD - 1500) continue;
      const d = isl.coastDistance(x, z);
      const score = Math.min(d, 1500) - Math.hypot(x, z) * 0.05;
      if (score > bd) { bd = score; best = [x, z]; }
    }
    if (best) [cx, cz] = best;
  }

  const heading = view === '2' ? headingAlongCoast(game, cx, cz) : 2.2;
  const fx = Math.sin(heading), fz = -Math.cos(heading), rx = Math.cos(heading), rz = Math.sin(heading);
  const brig = game.spawnShip({ type: 'brig', faction: 'english', x: cx, z: cz, heading, sailSetting: 1, name: 'Kestrel' });
  const frig = game.spawnShip({ type: 'frigate', faction: 'spanish', x: cx + fx * 90 + rx * 110, z: cz + fz * 90 + rz * 110, heading: heading - 0.06, sailSetting: 1, name: 'Santa Lucia' });
  for (const s of [brig, frig]) { s.speed = 10; s.sailEff = 1; s.controller = { update() {} }; s.desiredHeading = s.heading; }
  // let the trails build up (ships sail ~150 m)
  for (let i = 0; i < 15 * 30; i++) {
    for (const s of [brig, frig]) { s.speed = 10; }
    game.step(1 / 30);
  }
  keepSpeed(game, [brig, frig]);

  const b = brig.position, h = brig.heading;
  const F = [Math.sin(h), -Math.cos(h)], R = [Math.cos(h), Math.sin(h)];
  const at = (f, r, y) => [b.x + F[0] * f + R[0] * r, y, b.z + F[1] * f + R[1] * r];
  const rig = game.cameraRig;
  if (view === '2' || view === '5') {
    // find the beach: march from the harbour toward land until terrain rises above sea level
    const { bx, bz, s } = findBeach(isl);
    if (view === '5') rig.setShot({ position: [bx + s.x * 160, 120, bz + s.z * 160 + 1], lookAt: [bx + s.x * 40, 0, bz + s.z * 40], fov: 55 });
    else rig.setShot({ position: [bx + s.x * 230 + s.z * 60, 30, bz + s.z * 230 - s.x * 60], lookAt: [bx - s.z * 40, 2, bz + s.x * 40], fov: 55 });
  }
  else if (view === '3') rig.setShot({ position: at(-120, -60, 170), lookAt: at(-10, 40, 0), fov: 55 });
  else if (view === '4') {
    const sd = game.sky.sunDir; const ang = Math.atan2(sd.x, -sd.z);
    const p = [b.x - Math.sin(ang) * 60 - R[0] * 40, 3.2, b.z + Math.cos(ang) * 60 - R[1] * 40];
    rig.setShot({ position: p, lookAt: [p[0] + Math.sin(ang) * 100, 2, p[2] - Math.cos(ang) * 100], fov: 60 });
  }
  else rig.setShot({ position: at(-70, -38, 17), lookAt: at(25, 20, 2), fov: 55 });
  // keep the shadow camera on the action
  rig.target.set(b.x, 0, b.z);
}

function keepSpeed(game, ships) {
  // simple controller so live (--play) runs keep the wakes going
  for (const s of ships) s.controller = { update() { s.speed = Math.max(s.speed, 10); s.rudder = 0; } };
}

function headingAlongCoast(game, x, z) {
  const p = game.islands.ports[0];
  const s = p.seaward || { x: 0, z: 1 };
  // sail parallel to the coast (perpendicular to seaward)
  return Math.atan2(-s.z, -s.x);
}

// a natural beach with a gentle shelf (not a dredged harbour): scan radially around islands
function findBeach(isl) {
  let best = null;
  for (const I of isl.list.slice(0, 6)) {
    for (let k = 0; k < 48; k++) {
      const a = k / 48 * Math.PI * 2, sx = Math.cos(a), sz = Math.sin(a);
      let r = I.radius * 2.2, x, z;
      // walk inward to the waterline
      for (; r > 0; r -= 4) { x = I.x + sx * r; z = I.z + sz * r; if (isl.getTerrainHeight(x, z) >= 0) break; }
      if (r <= 0) continue;
      const d40 = isl.getTerrainHeight(x + sx * 40, z + sz * 40), d120 = isl.getTerrainHeight(x + sx * 120, z + sz * 120);
      const score = -Math.abs(d40 + 3) - Math.abs(d120 + 10) * 0.5;
      if (d40 < 0 && (!best || score > best.score)) best = { score, bx: x, bz: z, s: { x: sx, z: sz } };
    }
  }
  return best || { bx: 0, bz: 0, s: { x: 0, z: 1 } };
}
