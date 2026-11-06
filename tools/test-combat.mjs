// Combat loop test. AI-vs-AI battle for 60 simulated seconds via game.step, logs hits/sinkings.
// Usage: node tools/test-combat.mjs [--seconds 60] [--traffic 1]
// Requires the dev server (http://127.0.0.1:5173). Exits 1 if no hits happen or console errors occur.
import { chromium } from 'playwright';
import { BASE, PORT, launchOpts } from './_env.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']);
  return a;
}, []));
const SECONDS = +(args.seconds || 60);

const browser = await chromium.launch(launchOpts());
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
// an empty-ish scene: use the overview shot with frozen time so the render loop doesn't advance the sim
await page.goto(BASE + '?shot=overview&frozen=1&nohud=1', { timeout: 180000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000 });

const result = await page.evaluate(async (SECONDS) => {
  const g = window.__game, c = g.combat;
  // clear the scene
  for (const s of [...g.ships]) g.removeShip(s);
  g.player = null;
  c.setTrafficTarget(0);
  g.wind.angle = Math.PI * 0.5; g.wind.speed = 8;
  // find open water
  let cx = 2600, cz = 2600;
  const log = [];
  const ev = (name, f) => g.events.on(name, e => log.push(f(e)));
  const T = () => g.time.toFixed(1).padStart(5);
  ev('cannon:fire', e => `${T()} FIRE   ${e.ship.name} (${e.ship.faction}) ${e.side} x${e.count} ${e.ammo}`);
  ev('ship:struck', e => `${T()} STRUCK ${e.ship.name}`);
  ev('ship:sinking', e => `${T()} SINKING ${e.ship.name}`);
  ev('ship:sunk', e => `${T()} SUNK   ${e.ship.name}`);
  let hits = { hull: 0, sails: 0, crew: 0 }, splashes = 0;
  g.events.on('cannon:hit', e => hits[e.part]++);
  g.events.on('cannon:splash', () => splashes++);

  const mk = (type, faction, role, dx, dz, h, name) => c.spawnAI({ type, faction, role, x: cx + dx, z: cz + dz, heading: h, sailSetting: 0.7, name });
  const ships = [
    mk('frigate', 'english', 'patrol', -150, 0, Math.PI / 2, 'HMS Resolute'),
    mk('brig', 'english', 'patrol', -170, 140, Math.PI / 2, 'HMS Kestrel'),
    mk('galleon', 'spanish', 'patrol', 150, 30, -Math.PI / 2, 'San Telmo'),
    mk('merchantman', 'spanish', 'merchant', 220, -160, -Math.PI / 2, 'Santa Clara'),
    mk('sloop', 'pirate', 'pirate', -60, -300, 0.2, 'Black Tern'),
  ];
  const t0 = performance.now();
  const dt = 1 / 30;
  const snap = [];
  for (let i = 0; i < SECONDS * 30; i++) {
    g.step(dt);
    if (i % 300 === 299) snap.push(`${T()} ` + g.ships.map(s => `${s.name}[${s.ai?.state}] h${Math.round(s.hull)} c${s.crew} s${(s.sails * 100 | 0)}%`).join(' | '));
  }
  // finish off the most damaged ship to verify the full sinking sequence ends in 'ship:sunk' + removal
  const victim = ships.filter(s => !s.sunk).sort((a, b) => a.hull / a.hullMax - b.hull / b.hullMax)[0];
  if (victim && !victim.sinking) c.startSinking(victim);
  for (let i = 0; i < 45 * 30; i++) g.step(dt);
  const removed = victim ? !g.ships.includes(victim) : false;
  log.push(`${T()} victim ${victim?.name} removed=${removed}`);
  const ms = performance.now() - t0;
  return {
    log, snap, hits, splashes, stats: c.stats, fx: g.fx.stats(), msPerStep: ms / ((SECONDS + 45) * 30), removed,
    final: ships.map(s => ({ name: s.name, faction: s.faction, hull: +(s.hull / s.hullMax).toFixed(2), crew: s.crew, sails: +s.sails.toFixed(2), struck: s.struck, sunk: !!s.sunk, sinking: !!s.sinking, state: s.ai?.state })),
  };
}, SECONDS);

console.log('--- event log ---');
for (const l of result.log) console.log(l);
console.log('--- snapshots (every 10 s) ---');
for (const l of result.snap) console.log(l);
console.log('--- summary ---');
console.log('hits by part:', result.hits, ' splashes:', result.splashes);
console.log('combat stats:', result.stats);
console.log('fx stats:', result.fx, ` sim cost: ${result.msPerStep.toFixed(2)} ms/step`);
console.table(result.final);
if (errors.length) console.log('CONSOLE ERRORS:\n' + [...new Set(errors)].join('\n'));
const ok = result.stats.hits > 0 && result.stats.sunk > 0 && result.removed && !errors.length;
console.log(ok ? 'PASS' : 'FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
