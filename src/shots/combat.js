// Showcase: the player's frigate trading broadsides with a Spanish galleon at ~120 m, mid-volley:
// banks of gun smoke drifting downwind, muzzle flashes, splash columns, splinters, the galleon burning.
//   ?view=sink     a ship mid-sinking (bow rising, fires, bubbles, wreckage)
//   ?view=cine     low cinematic still across the player's deck
//   ?view=wide     high wide angle on the engagement
//   ?view=ai       pure AI duel (English frigate vs Spanish galleon), 40 s simulated, framed on both ships
//   ?view=fleet    an AI-vs-AI melee (English patrol vs Spanish convoy + pirates), simulated 25 s
import { PlayerController } from '../ships/playerController.js';

// find open water near (x,z) big enough for the scene
export function openWater(game, x, z, r = 400) {
  const isl = game.islands;
  if (!isl?.isLand) return { x, z };
  for (let ring = 0; ring < 30; ring++) {
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2, d = ring * 300;
      const cx = x + Math.cos(a) * d, cz = z + Math.sin(a) * d;
      let ok = true;
      for (let j = 0; j < 16 && ok; j++) {
        const b = j / 16 * Math.PI * 2;
        for (const rr of [0, r * 0.5, r]) if (isl.isLand(cx + Math.cos(b) * rr, cz + Math.sin(b) * rr, 30)) { ok = false; break; }
      }
      if (ok) return { x: cx, z: cz };
      if (ring === 0) break;
    }
  }
  return { x, z };
}

export async function setup(game) {
  const view = game.params.get('view') || 'duel';
  // ?view=ai is deterministic — seeded Math.random for the whole simulated engagement (?seed=, default 1717)
  const rand0 = Math.random;
  if (view === 'ai') { let st = (+(game.params.get('seed') || 1717) >>> 0) || 1; Math.random = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; }; }
  try { return await setupView(game, view); } finally { Math.random = rand0; }
}

async function setupView(game, view) {
  const combat = game.combat;
  combat.setTrafficTarget(0);
  combat.noMagazine = true;
  game.wind.angle = Math.PI * 0.5 + 0.35;   // blowing toward ESE: smoke rolls from the player toward the enemy
  game.wind.speed = 7;

  const c = openWater(game, 2600, 2600, 500);
  const H = 0;                               // both ships head north, beam reach on the starboard tack
  const fx = Math.sin(H), fz = -Math.cos(H), rx = Math.cos(H), rz = Math.sin(H);

  const p = game.player = game.spawnShip({ type: 'frigate', faction: 'english', isPlayer: true, x: c.x, z: c.z, heading: H, sailSetting: 0.5, name: 'Merry Wren' });
  p.controller = new PlayerController(game, p);
  p.crew = 190;

  const g = combat.spawnAI({ type: 'galleon', faction: 'spanish', role: 'patrol', x: c.x + rx * 120 + fx * 18, z: c.z + rz * 120 + fz * 18, heading: H + 0.04, sailSetting: 0.5, name: 'San Telmo', crew: 240 });
  g.ai.setTarget(p); g.ai.hold = true; g.ai.fireAtWill = false;
  g.desiredHeading = g.heading;

  // settle both under way
  for (const s of [p, g]) { s.speed = s.spec.maxSpeed * 0.42; s.sailEff = s.sailSetting; }
  const dt = 1 / 30;
  for (let i = 0; i < 60; i++) game.step(dt);

  if (view === 'sink') return sinkScene(game, p, g);
  if (view === 'fleet') return fleetScene(game, p, g, c);
  if (view === 'ai') return aiScene(game, p, g, c);

  // ---- the engagement: galleon already battered and burning ----
  g.hull = g.hullMax * 0.42; g.sails = 0.18; g.crew = 170;   // tattered canvas + a topmast gone overboard
  g._listSide = -1;  // listing toward the player (battered side)
  g.listing = -0.05;
  combat.igniteAt(g, g.position.x - fx * 12, 6, g.position.z - fz * 12, 1.0);
  combat.igniteAt(g, g.position.x + fx * 15, 6, g.position.z + fz * 15, 0.7);
  // earlier hits: shot holes along her engaged side
  for (let k = 0; k < 14; k++) game.fx.shotHole(g, { x: g.position.x - rx * 6, y: g.position.y + 1 + Math.random() * 3, z: g.position.z + fz * (Math.random() - 0.5) * 36 }, null);
  // a few seconds of burning so plumes are established
  for (let i = 0; i < 150; i++) game.step(dt);

  // galleon fires first (her smoke bank drifts away), then the player's ripple, mid-volley at capture
  // capture timing: game.start() adds 6 warm-up steps (0.2 s) after setup. The player's ripple starts ~0.65 s
  // before the frozen frame (guns 1-6 fired, balls in flight, more flashes mid-ripple); the galleon's return fire
  // started ~1.6 s earlier so its shot lands as splashes/splinters around the player.
  g.reload.port = 1;
  combat.fireBroadside(g, 'port', 'round');
  for (let i = 0; i < 34; i++) game.step(dt);
  p.reload.starboard = 1;
  combat.fireBroadside(p, 'starboard', 'round');
  for (let i = 0; i < 14; i++) game.step(dt);
  const rig = game.cameraRig;
  if (view === 'wide') {
    // the wide vista kept the ships at ~10 % of the frame; closer and lower, the pair spans the middle third
    rig.setShot({ position: [c.x - 70, 32, c.z + 100], lookAt: [c.x + 62, 6, c.z - 12] });
  } else if (view === 'cine') {
    // low over the player's port quarter, looking across her deck at the galleon through the smoke
    // off the player's starboard quarter, low, looking along her engaged side toward the galleon
    rig.setShot({ position: [c.x - 30, 14, c.z + 40], lookAt: [c.x + 95, 9, c.z - 18] });
  } else {
    // default: the real in-game combat camera (tactical battle framing on player + galleon)
    rig.follow(p); rig.frameShips([p, g]);
  }
}

function sinkScene(game, p, g) {
  const combat = game.combat;
  g._listSide = 1;
  combat.igniteAt(g, g.position.x, 6, g.position.z - 10, 1);
  combat.startSinking(g);
  g._sinkStyle = 1;  // bow rises
  const dt = 1 / 30;
  for (let i = 0; i < 30 * 14; i++) game.step(dt);
  const x = g.position.x, z = g.position.z;
  game.cameraRig.setShot({ position: [x - 75, 12, z + 55], lookAt: [x, 7, z - 4] });
}

function fleetScene(game, p, g, c) {
  const combat = game.combat;
  // English frigate + brig vs Spanish galleon escorting merchants, pirates lurking
  g.ai.hold = false; g.ai.fireAtWill = true; g.ai.setTarget(null);
  p.controller = null; p.isPlayer = true;
  const mk = (type, faction, role, dx, dz, h) => combat.spawnAI({ type, faction, role, x: c.x + dx, z: c.z + dz, heading: h, sailSetting: 0.7 });
  mk('brig', 'english', 'patrol', -200, 80, 0.3);
  mk('merchantman', 'spanish', 'merchant', 260, -200, 2.4);
  mk('sloop', 'pirate', 'pirate', -300, -350, 1.4);
  const dt = 1 / 30;
  for (let i = 0; i < 30 * 25; i++) game.step(dt);
  game.cameraRig.setShot({ position: [c.x - 250, 120, c.z + 300], lookAt: [c.x + 40, 0, c.z - 60] });
}

function aiScene(game, p, g, c) {
  const combat = game.combat;
  combat.noMagazine = true;
  game.removeShip(p); game.player = null;
  g.ai.hold = false; g.ai.fireAtWill = true; g.ai.setTarget(null);
  g.position.set(c.x + 150, 0, c.z - 40); g.heading = -Math.PI / 2 - 0.3;
  const e = combat.spawnAI({ type: 'frigate', faction: 'english', role: 'patrol', x: c.x - 150, z: c.z + 40, heading: Math.PI / 2, sailSetting: 0.7, name: 'HMS Resolute' });
  const dt = 1 / 30;
  let best = null;
  // run until both are broadside-on (heading difference near 0 or PI) and a volley is in flight, max 70 s
  for (let i = 0; i < 30 * 70; i++) {
    game.step(dt);
    const dh = Math.abs(Math.sin(e.heading - g.heading));
    const d = Math.hypot(e.position.x - g.position.x, e.position.z - g.position.z);
    if (i > 30 * 8 && dh < 0.35 && d < 280 && combat.b.n > 6 && combat.q.n > 0) { best = i; break; }
  }
  for (let i = 0; i < 8; i++) game.step(dt);
  const mx = (e.position.x + g.position.x) / 2, mz = (e.position.z + g.position.z) / 2;
  // camera off the line between them, looking at the midpoint, so both broadsides face the viewer obliquely.
  // fixed shot from the final positions (frameShips followed the removed player ship and damped over 60
  // steps: sometimes zenithal), on the sun side of the line so the pair is front-lit, distance fitted to the gap
  const ax = g.position.x - e.position.x, az = g.position.z - e.position.z, L = Math.hypot(ax, az) || 1;
  let nx = -az / L, nz = ax / L;
  const sd = game.sky?.sunDir; if (sd && nx * sd.x + nz * sd.z < 0) { nx = -nx; nz = -nz; }
  const D = Math.max(150, L * 0.7 + 70);
  game.cameraRig.setShot({ position: [mx + nx * D - ax / L * 30, 30, mz + nz * D - az / L * 30], lookAt: [mx, 6, mz] });
  console.info('[combat ai view] broadside-on at', best == null ? 'never' : (best / 30).toFixed(1) + ' s');
}
