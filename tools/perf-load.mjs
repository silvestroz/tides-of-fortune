// Loading time, step by step, and the cost of each system per frame.
// usage: node tools/perf-load.mjs [--dist] [--nobuild] [--frames N] [--query "quality=high&…"] [--w 1600 --h 900] [--cpu2d]
//   --dist   : builds dist/tides-of-fortune.html (npm run build) and serves it locally (single file, like Vercel);
//              otherwise the dev server (TOF_URL, separate modules: slower loading, only compare it with itself)
//   --frames : frames measured at sea after loading (default 90)
// Prints: navigation → script → `new Game` → `start()` → ready; `game.bootTimes` (system constructors, island
// steps, shader warm-up); programs, geometries, textures; then per frame: JS per system (update), ships, camera,
// render (post.render call), draw calls, triangles.
// In software rendering (SwiftShader), rendering and shader compilation cost far more than on a GPU: only the JS
// times (world generation, geometry, updates) compare from one machine to another, proportionally.
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, launchOpts } from './_env.mjs';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const useDist = args.includes('--dist'), frames = +opt('--frames', 90), query = opt('--query', '');
const W = +opt('--w', 1600), H = +opt('--h', 900);

let url = BASE, server = null;
if (useDist) {
  if (!args.includes('--nobuild')) execSync('npm run build', { stdio: 'ignore' });
  const file = path.resolve('dist/tides-of-fortune.html');
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/tides-of-fortune.html') || req.url === '/' || req.url.startsWith('/?')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(file));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(5199, '127.0.0.1', r));
  url = 'http://127.0.0.1:5199/';
  console.log('dist', (fs.statSync(file).size / 1048576).toFixed(2), 'Mo');
}

// --cpu2d: 2D canvas rasterised by the CPU (in software rendering, the "accelerated" canvas goes through SwiftShader
// and inflates everything that paints textures; the CPU gives an order of magnitude closer to a real machine)
const browser = await chromium.launch(launchOpts(process.argv.includes('--cpu2d') ? ['--disable-accelerated-2d-canvas'] : []));
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', e => errs.push('ERR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('[error] ' + m.text()); });
await page.addInitScript(() => {
  window.__perf = { scriptStart: 0 };
  // timestamp of the game's construction: first access to window.__game
  let g = null;
  Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: v => { g = v; window.__perf.gameSet = performance.now(); } });
});
const t0 = Date.now();
await page.goto(url + (query ? '?' + query : ''), { timeout: 600000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 900000, polling: 250 });
const wall = (Date.now() - t0) / 1000;
const boot = await page.evaluate(() => {
  const g = window.__game, nav = performance.getEntriesByType('navigation')[0], R = g.renderer;
  const paints = Object.fromEntries(performance.getEntriesByType('paint').map(p => [p.name, Math.round(p.startTime)]));
  return {
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), paints,
    gameCtorStart: Math.round(g.bootTimes.length ? window.__perf.gameSet - g.bootTimes.reduce((a, b) => a + b[1], 0) : 0),
    gameSet: Math.round(window.__perf.gameSet), ready: Math.round(performance.now()),
    times: (() => { const nm = {}; for (const k of Object.keys(g)) { const v = g[k]; if (v && typeof v === 'object' && v.constructor && v.constructor !== Object) nm[v.constructor.name] ??= k; } return g.bootTimes.map(([n, ms]) => [nm[n] ? `${nm[n]} (${n})` : n, ms]); })(), programs: R.info.programs.length, geometries: R.info.memory.geometries, textures: R.info.memory.textures,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null,
    islandsMs: window.__islandsMs, prebake: window.__prebake || null, renderer: (() => { try { const gl = R.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; } catch { return '?'; } })(),
  };
});
console.log(`prêt en ${wall.toFixed(1)} s (horloge) · renderer ${boot.renderer}`);
console.log(`  DOMContentLoaded ${boot.domContentLoaded} ms · first-paint ${boot.paints['first-paint'] ?? '?'} ms · window.__game ${boot.gameSet} ms · prêt ${boot.ready} ms`);
console.log(`  programmes ${boot.programs} · géométries ${boot.geometries} · textures ${boot.textures} · tas JS ${boot.heapMB} Mo`);
if (boot.prebake) console.log(`  relief cuit avant la construction du jeu : ${boot.prebake.ms} ms (${boot.prebake.workers} workers + fil principal)`);
const tot = {}; for (const [n, ms] of boot.times) tot[n] = (tot[n] || 0) + ms;
const rows = Object.entries(tot).sort((a, b) => b[1] - a[1]);
console.log('  étapes (ms, cumul par nom) :');
for (const [n, ms] of rows) if (ms >= 5) console.log(`    ${String(ms).padStart(6)}  ${n}`);

// ---- at sea: cost per frame ----
const fr = await page.evaluate(async (N) => {
  const g = window.__game, R = g.renderer;
  g.hud?.menu?.close?.(); g.mode = 'sail'; g.events.emit('state:change', { from: 'menu', to: 'sail' }); g.cameraRig.follow(g.player);
  const acc = {}, add = (k, v) => { acc[k] = (acc[k] || 0) + v; };
  const wrap = (obj, key, label) => { const o = obj[key].bind(obj); obj[key] = (...a) => { const t = performance.now(); const r = o(...a); add(label, performance.now() - t); return r; }; return () => { obj[key] = o; }; };
  const undo = [];
  const keyOf = s => Object.keys(g).find(k => g[k] === s) || s.constructor?.name || '?';
  for (const s of g.systems) if (s.update) undo.push(wrap(s, 'update', 'sys:' + keyOf(s)));
  const ss = g.step.bind(g);
  g.step = dt => { const t = performance.now(); ss(dt); add('step (total)', performance.now() - t); };
  const sh = g.ships.map(s => s); for (const s of sh) undo.push(wrap(s, 'update', 'ships'));
  if (g.cameraRig?.lateUpdate) undo.push(wrap(g.cameraRig, 'lateUpdate', 'camera'));
  if (g.nameplates?.update) undo.push(wrap(g.nameplates, 'update', 'nameplates'));
  const pr = g.post.render.bind(g.post); let calls = 0, tris = 0;
  g.post.render = dt => { R.info.autoReset = false; R.info.reset(); const t = performance.now(); pr(dt); add('render (post.render)', performance.now() - t); calls += R.info.render.calls; tris += R.info.render.triangles; R.info.autoReset = true; };
  const ft = []; let last = performance.now();
  await new Promise(res => { let n = 0; const f = () => { const t = performance.now(); ft.push(t - last); last = t; if (++n < N) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  g.step = ss; g.post.render = pr; for (const u of undo) u();
  ft.shift(); ft.sort((a, b) => a - b);
  const per = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, +(v / N).toFixed(2)]));
  return { per, calls: Math.round(calls / N), tris: Math.round(tris / N), ships: g.ships.length, p50: +ft[Math.floor(ft.length / 2)].toFixed(1), p95: +ft[Math.floor(ft.length * 0.95)].toFixed(1), max: +ft[ft.length - 1].toFixed(1), q: g.quality };
}, frames);
console.log(`en mer (${frames} images, ${fr.ships} navires, qualité ${fr.q}) : image p50 ${fr.p50} ms · p95 ${fr.p95} · max ${fr.max} · ${fr.calls} appels · ${(fr.tris / 1e6).toFixed(2)} M triangles`);
for (const [k, v] of Object.entries(fr.per).sort((a, b) => b[1] - a[1])) if (v >= 0.05) console.log(`    ${v.toFixed(2).padStart(7)} ms  ${k}`);
if (errs.length) console.log('console :', errs.slice(0, 5).join(' | ')); else console.log('console propre');
await browser.close();
server?.close();
