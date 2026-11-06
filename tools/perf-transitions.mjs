// Timing of in-game transitions: chart, port (tabs), village, duel (deck and sets), land battle, sneaking.
// For each transition: duration of the call (construction, main thread blocked), duration of the next 3 frames
// (shader compilation, texture uploads), programs, textures and geometries created.
// usage: node tools/perf-transitions.mjs [--dist] [--nobuild] [--only port,duel,…] [--w 960 --h 540] [--query "…"] [--cpu2d]
//          [--waitwarm] (wait for the title-screen warm-ups to finish)  [--profile "onglet market|duel : pont"]   CPU profile (call + next frames) of the steps whose label contains one of these texts
// In software rendering the base frame already costs several seconds: look mostly at « appel » (JS) and « prog+ »
// (each new program = one compilation at first render, 10 to 60 ms on a real GPU under Windows/ANGLE).
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, launchOpts } from './_env.mjs';
import { summarize } from './_cpuprofile.mjs';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const useDist = args.includes('--dist'), query = opt('--query', ''), only = opt('--only', '');
const W = +opt('--w', 960), H = +opt('--h', 540), PROF = opt('--profile', '');

let url = BASE, server = null;
if (useDist) {
  if (!args.includes('--nobuild')) execSync('npm run build', { stdio: 'ignore' });
  const file = path.resolve('dist/tides-of-fortune.html');
  server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(file)); });
  await new Promise(r => server.listen(5198, '127.0.0.1', r));
  url = 'http://127.0.0.1:5198/';
}
// --cpu2d: 2D canvas rasterised by the CPU (in software rendering, the "accelerated" canvas goes through SwiftShader
// and inflates everything that paints textures; the CPU gives an order of magnitude closer to a real machine)
const browser = await chromium.launch(launchOpts(process.argv.includes('--cpu2d') ? ['--disable-accelerated-2d-canvas'] : []));
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', e => errs.push('ERR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('[error] ' + m.text()); });
const t0 = Date.now();
await page.goto(url + (query ? '?' + query : ''), { timeout: 600000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 900000, polling: 250 });
console.log(`prêt en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (args.includes('--waitwarm')) {   // --waitwarm: let the title-screen warm-ups (game.warmupRare) finish before measuring
  const w = await page.evaluate(async () => { const g = window.__game, t = performance.now(); while (g._rareQ?.length && performance.now() - t < 900000) await new Promise(r => setTimeout(r, 500)); return { left: g._rareQ?.length ?? 0, ms: Math.round(performance.now() - t) }; });
  console.log(`réchauffages de l'écran titre : ${w.left ? w.left + ' restants' : 'terminés'} en ${w.ms} ms`);
}

// measurement in the page
await page.evaluate(() => {
  const g = window.__game, R = g.renderer;
  const raf = () => new Promise(r => requestAnimationFrame(r));
  window.__measure = async (label, fn, frames = 3) => {
    const p0 = R.info.programs.length, tx0 = R.info.memory.textures, ge0 = R.info.memory.geometries;
    let err = null; const a = performance.now();
    try { await fn(); } catch (e) { err = String(e && e.message || e); }
    const call = performance.now() - a;
    const fts = []; let last = performance.now();
    for (let i = 0; i < frames; i++) { await raf(); const t = performance.now(); fts.push(Math.round(t - last)); last = t; }
    return { label, call: Math.round(call), frames: fts, programs: R.info.programs.length - p0, textures: R.info.memory.textures - tx0, geometries: R.info.memory.geometries - ge0, mode: g.mode, err };
  };
  window.__toSail = () => {
    const g = window.__game;
    for (const el of document.querySelectorAll('.lb-screen.on, .sn-screen.on')) el.classList.remove('on');
    if (g.mode === 'port') { try { g.ports.leave(); } catch {} }
    if (g.worldMap?.isOpen) g.worldMap.close();
    g.renderOverride = null; g.mode = 'sail'; g.cameraRig.follow(g.player);
  };
});
const res = [];
const cdp = PROF ? await page.context().newCDPSession(page) : null;
if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); }
const step = async (key, label, fn, frames) => {
  if (only && !only.split(',').includes(key)) return;
  const prof = cdp && PROF.split('|').some(x => label.includes(x));
  if (prof) await cdp.send('Profiler.start');
  const r = await page.evaluate(([l, f, n]) => window.__measure(l, new Function('return (async () => {' + f + '})()'), n), [label, fn, frames ?? 3]);
  if (prof) { const { profile } = await cdp.send('Profiler.stop'); summarize(profile, label, { top: 30, callers: 10, files: 12 }); }
  res.push(r);
  console.log(`${r.label.padEnd(34)} appel ${String(r.call).padStart(6)} ms · images ${r.frames.map(x => String(x).padStart(5)).join(' ')} ms · prog+ ${String(r.programs).padStart(2)} · tex+ ${String(r.textures).padStart(3)} · géo+ ${String(r.geometries).padStart(4)} · ${r.mode}${r.err ? ' · ERREUR ' + r.err : ''}`);
};
const G = 'const g = window.__game;';

await step('sail', 'menu → mer (réchauffage)', `${G} g.hud?.menu?.close?.(); g.mode = 'sail'; g.events.emit('state:change', { from: 'menu', to: 'sail' }); g.cameraRig.follow(g.player);`);
await step('sail', 'mer (référence)', `await new Promise(r => setTimeout(r, 10));`);
await step('map', 'carte : ouvrir', `${G} g.worldMap.open();`);
await step('map', 'carte : fermer', `${G} g.worldMap.close();`);
await step('map', 'carte : ouvrir (2e)', `${G} g.worldMap.open();`);
await step('map', 'carte : fermer (2e)', `${G} g.worldMap.close();`);
const PORT = `const p = g.islands.getPort('portroyal') || g.islands.ports.find(q => !q.haven);`;
await step('port', 'port : entrer (Port Royal)', `${G} ${PORT} g.ports.enter(p);`);
for (const tab of ['market', 'shipyard', 'tavern', 'governor']) await step('port', `port : onglet ${tab}`, `${G} g.ports.goto('${tab}', true);`);
await step('port', 'port : quitter', `${G} g.ports.leave();`);
await step('port', 'port : entrer (2e fois)', `${G} ${PORT} g.ports.enter(p);`);
await step('port', 'port : onglet market (2e visite)', `${G} g.ports.goto('market', true);`);
await step('port', 'port : onglet tavern (2e visite)', `${G} g.ports.goto('tavern', true);`);
await step('port', 'port : quitter (2e)', `${G} g.ports.leave();`);
await step('port', 'port : autre ville anglaise, marché', `${G} const p = g.islands.ports.find(q => q.faction === 'english' && q.id !== 'portroyal' && !q.haven); g.ports.enter(p); g.ports.goto('market', true);`);
await step('port', 'port : quitter (autre ville)', `${G} g.ports.leave();`);
await step('village', 'village : accoster', `${G} const v = g.islands.villages[0]; g.villages.enter(v);`);
await step('village', 'village : repartir', `${G} g.villages.leave();`);
await step('duel', 'duel : pont (abordage)', `${G} const c = g.combat, p = g.player; const e = c.spawnAI({ type: 'galleon', faction: 'spanish', role: 'patrol', x: p.position.x + 30, z: p.position.z + 2, heading: 0, sailSetting: 0, name: 'San Telmo', crew: 120 }); e.ai.hold = true; e.ai.fireAtWill = false; window.__duelFoe = e; g.duel.start({ opponent: { name: 'Don Rodrigo', faction: 'spanish', difficulty: 0.6 }, setting: e, crewPlayer: 150, crewEnemy: 120, intro: false, seed: 5, noInput: true });`, 4);
await step('duel', 'duel : fin', `${G} g.duel.abort(); window.__toSail();`);
await step('duel', 'duel : 2e abordage', `${G} const e = window.__duelFoe; g.duel.start({ opponent: { name: 'Don Rodrigo', faction: 'spanish', difficulty: 0.6 }, setting: e, crewPlayer: 150, crewEnemy: 120, intro: false, seed: 6, noInput: true });`, 4);
await step('duel', 'duel : fin (2e)', `${G} g.duel.abort(); window.__toSail(); const e = window.__duelFoe; if (e) g.removeShip?.(e);`);
for (const scene of ['tavern', 'rampart']) {
  await step('stages', `duel : décor ${scene}`, `${G} g.duel.start({ opponent: { name: 'Garde', faction: 'spanish', difficulty: 0.5 }, setting: { scene: '${scene}', faction: 'spanish' }, crewPlayer: 1, crewEnemy: 1, intro: false, seed: 5, noInput: true });`, 4);
  await step('stages', `duel : fin (${scene})`, `${G} g.duel.abort(); window.__toSail();`);
}
await step('land', 'bataille à terre : début', `${G} const p = g.islands.getPort('havana'); await g.landBattle.start(p, { approach: 'land' });`, 4);
await step('land', 'bataille à terre : fin', `${G} g.landBattle.forceEnd('player'); await new Promise(r => setTimeout(r, 50)); document.querySelector('[data-act="keep"]')?.click(); await new Promise(r => setTimeout(r, 1500)); window.__toSail();`);
await step('sneak', 'infiltration : début', `${G} const p = g.islands.getPort('havana'); await g.sneak.start({ kind: 'infiltrate', port: p });`, 4);
await step('sneak', 'infiltration : fin', `${G} await g.sneak.forceEnd('success'); await new Promise(r => setTimeout(r, 1500)); window.__toSail();`);

const fin = await page.evaluate(() => { const R = window.__game.renderer; return { programs: R.info.programs.length, textures: R.info.memory.textures, geometries: R.info.memory.geometries, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }; });
console.log(`fin : ${fin.programs} programmes · ${fin.textures} textures · ${fin.geometries} géométries · tas ${fin.heap} Mo`);
console.log(errs.length ? 'console : ' + errs.slice(0, 6).join(' | ') : 'console propre');
if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(res, null, 1));
await browser.close();
server?.close();
