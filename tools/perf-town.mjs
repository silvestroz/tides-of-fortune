// Town scenes (sneak, land battle): entry time, draw calls, and the at-sea resource check. Town content must exist
// only inside its scene: shader programs and geometries/textures counted at sea before entering and after leaving
// must match.
// usage: node tools/perf-town.mjs [--soft] [--only sneak,landbattle] [--w 1366 --h 768]
//   for each scene: entry (s) from start() to the first frame on screen, draw calls of a frame, programs at sea
//   before / during / after, renderer.info.memory at sea before / after.
import { chromium } from 'playwright';
import { BASE, launchOpts } from './_env.mjs';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const only = opt('--only', 'sneak,landbattle').split(','), W = +opt('--w', 1366), H = +opt('--h', 768);
const browser = await chromium.launch(launchOpts());
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(BASE + '?dynres=0', { waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__ready, null, { timeout: 300000 });
// let the title-screen idle warm-ups finish, then set sail (as the menu does)
await page.waitForFunction(() => !window.__game._rareQ || window.__game._rareQ.length === 0, null, { timeout: 300000, polling: 1000 });
await page.evaluate(() => { const g = window.__game; g.menu?.close?.(); const from = g.mode; g.mode = 'sail'; g.events.emit('state:change', { from, to: 'sail' }); });
const frames = n => page.evaluate(n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const sea = () => page.evaluate(() => { const i = window.__game.renderer.info; return { programs: i.programs.length, geometries: i.memory.geometries, textures: i.memory.textures }; });
await frames(4);
const first = await sea();
console.log(`at sea: ${first.programs} programs, ${first.geometries} geometries, ${first.textures} textures`);
for (const kind of only) {
  const before = await sea();
  const t = await page.evaluate(async kind => {
    const g = window.__game, mode = kind === 'sneak' ? g.sneak : g.landBattle, port = g.islands.ports.find(p => !p.haven);
    const t0 = performance.now();
    let tf = 0;
    const orig = g.renderer.render.bind(g.renderer);
    const p = kind === 'sneak' ? mode.start({ kind: 'infiltrate', port }) : mode.start(port, { approach: 'land' });
    await p;
    // first frame of the scene on screen: the next render through the mode's override
    await new Promise(r => { const f = () => { if (g.renderOverride) { tf = performance.now(); r(); } else requestAnimationFrame(f); }; f(); });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const i = g.renderer.info;
    return { entry: (tf - t0) / 1000, calls: i.render.calls, tris: i.render.triangles, programs: i.programs.length, geometries: i.memory.geometries, textures: i.memory.textures };
  }, kind);
  await frames(3);
  const calls = await page.evaluate(() => window.__game.renderer.info.render.calls);
  await page.evaluate(kind => { const g = window.__game, mode = kind === 'sneak' ? g.sneak : g.landBattle; mode._teardown(); }, kind);
  await frames(4);
  const after = await sea();
  console.log(`${kind}: entry ${t.entry.toFixed(2)} s · ${calls} draw calls · ${t.tris} triangles · in scene ${t.programs} programs, ${t.geometries} geometries, ${t.textures} textures`);
  console.log(`  at sea before ${before.programs} programs / ${before.geometries} geo / ${before.textures} tex  ->  after ${after.programs} / ${after.geometries} / ${after.textures}` +
    (after.programs > before.programs || after.geometries > before.geometries || after.textures > before.textures ? '   GROWS' : '   ok'));
}
console.log(errors.length ? `console errors:\n  ${errors.slice(0, 8).join('\n  ')}` : 'no console errors');
await browser.close();
