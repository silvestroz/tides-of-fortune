// End-to-end playtest of the REAL game (no ?shot): drives it with keyboard input + game API calls,
// logs state after each step and screenshots it to shots/playtest/NN-step.png.
// Usage: node tools/playtest.mjs [--url http://127.0.0.1:5173/] [--w 1600 --h 900] [--noshots] [--q "quality=low"] [--soft] [--headed]
// Requires the dev server (npm run dev) unless --url points at a built file (file:///.../dist/tides-of-fortune.html).
// Real GPU by default (full Chromium in new headless mode, like tools/shot.mjs; the WebGL renderer is printed at start).
// --soft = software GL (SwiftShader) for machines without a GPU (cloud): ~10x slower. --headed = visible window.
// results.json is rewritten after every step, so a run that stalls still leaves its partial results.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { BASE, SOFT, launchOpts } from './_env.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']);
  return a;
}, []));
const W = +(args.w || 1600), H = +(args.h || 900);
const base = args.url || BASE;
const url = base + (args.q ? (base.includes('?') ? '&' : '?') + args.q : '');
const OUT = args.out || 'shots/playtest';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(launchOpts(['--autoplay-policy=no-user-gesture-required'], { headed: !!args.headed }));
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [], results = [];
let stepN = 0;
page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
page.on('requestfailed', r => errors.push('[requestfailed] ' + r.url()));
// at sea the music director may legitimately pick battle / boss (a Top 10 captain nearby) / storm instead of 'sea'
const SEA_THEMES = ['sea', 'battle', 'boss', 'storm'];
const T0 = Date.now();
const CLK = { force: true, timeout: 90000 };   // software GL: rAF is slow, skip actionability 'stable' waits
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0)}s]`, ...a);

// advance n rendered frames, but never wait longer than ~n*0.4 s of wall time (software GL stalls for seconds at times)
const frames = n => Promise.race([
  page.evaluate(n => new Promise(r => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n),
  page.waitForTimeout(2000 + n * 400)]).catch(() => {});
const ev = (fn, arg) => page.evaluate(fn, arg);
// advance the simulation by `secs` of game time without waiting for rendered frames (the machine renders ~1 fps)
const sim = secs => page.evaluate(secs => { const g = __game; for (let i = 0; i < Math.round(secs * 30); i++) { g.step(1 / 30 * g.timeScale); g.input.justPressed.clear(); g.input.justPressedKeys.clear(); } }, secs);
const state = () => ev(() => {
  const g = window.__game, p = g.player, st = g.state;
  const nan = [];
  const chk = (k, v) => { if (typeof v === 'number' && !Number.isFinite(v)) nan.push(k); };
  if (p) { chk('p.x', p.position.x); chk('p.z', p.position.z); chk('p.heading', p.heading); chk('p.speed', p.speed); chk('p.hull', p.hull); chk('p.crew', p.crew); }
  for (const k of ['gold', 'crew', 'food', 'morale', 'plunder']) chk('state.' + k, st[k]);
  for (const s of g.ships) { chk(`ship${s.id}.x`, s.position.x); chk(`ship${s.id}.z`, s.position.z); }
  chk('cam.x', g.camera.position.x); chk('cam.y', g.camera.position.y);
  const hud = document.getElementById('hud');
  return {
    mode: g.mode, frozen: g.frozen, timeScale: g.timeScale, menu: g.hud?.menu?.screen || null,
    hud: hud ? !hud.classList.contains('hidden') : null, audio: !!g.audio?.ctx, mood: g.audio?.music?.cur?.name ?? null,   // current theme = music.cur.name
    gold: Math.round(st.gold), plunder: Math.round(st.plunder || 0), captures: st.captures, crew: Math.round(p?.crew ?? -1), fleet: st.fleet?.length,
    date: `${st.date.day}/${st.date.month}/${st.date.year}`, name: st.name, ship: p?.name, faction: p?.faction,
    pos: p ? [Math.round(p.position.x), Math.round(p.position.z)] : null, kn: +(p?.speed * 1.944 || 0).toFixed(1), ships: g.ships.length, nan,
  };
});

async function shot(name) {
  const file = `${OUT}/${String(++stepN).padStart(2, '0')}-${name}.png`;
  if (!args.noshots) {
    // pause the render loop while capturing (preserveDrawingBuffer keeps the last frame); much faster on software GL
    await ev(() => __game.renderer.setAnimationLoop(null)).catch(() => {});
    try { await page.screenshot({ path: file, timeout: SOFT ? 300000 : 60000 }); }   // a stalled capture fails the shot, not the whole run
    finally { await ev(() => __game.renderer.setAnimationLoop(() => __game.frame())).catch(() => {}); }
  }
  return file;
}
async function step(name, fn, expect) {
  const t = Date.now();
  let ok = true, note = '', st = null;
  const e0 = errors.length;
  try {
    const r = await fn();
    if (r) note = typeof r === 'string' ? r : JSON.stringify(r);
    st = await state();
    if (expect) { const m = expect(st); if (m !== true) { ok = false; note += ' EXPECT FAILED: ' + m; } }
    if (st.nan.length) { ok = false; note += ' NaN: ' + st.nan.join(','); }
  } catch (e) { ok = false; note += ' THREW: ' + e.message.split('\n')[0]; }
  if (errors.length > e0) { ok = false; note += ' ERRORS: ' + errors.slice(e0).join(' | ').slice(0, 400); }
  const file = await shot(name).catch(e => 'shot failed ' + e.message);
  results.push({ step: name, ok, note: note.trim(), state: st, file, secs: Math.round((Date.now() - t) / 1000) });
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ url, partial: true, results, errors: [...new Set(errors)] }, null, 2));
  log(ok ? 'PASS' : 'FAIL', name, note.trim().slice(0, 300), JSON.stringify(st));
}
const key = async (k, holdMs = 0) => { if (holdMs) { await page.keyboard.down(k); await page.waitForTimeout(holdMs); await page.keyboard.up(k); } else await page.keyboard.press(k); await frames(2); };

// ---------------------------------------------------------------- run
await ev(() => { try { localStorage.clear(); } catch { } }).catch(() => { });
await page.goto(url, { waitUntil: 'load', timeout: 300000 });
await page.evaluate(() => { try { localStorage.removeItem('tof.save.v1'); } catch { } });
await page.reload({ waitUntil: 'load', timeout: 300000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 400000, polling: 500 });
const se = await ev(() => window.__error); if (se) errors.push('[startup] ' + se);
const gpu = await ev(() => { const gl = __game.renderer.getContext(), x = gl.getExtension('WEBGL_debug_renderer_info'); return x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); }).catch(() => '?');
log('ready', await ev(() => window.__islandsMs), 'GPU:', gpu);
if (!SOFT && /swiftshader|llvmpipe|software/i.test(gpu)) log('WARNING: software WebGL despite GPU mode, try --headed');

await step('title-menu', () => frames(4), s => s.mode === 'menu' && s.menu === 'title' && !s.hud || `mode=${s.mode} menu=${s.menu} hud=${s.hud}`);
await step('captain-sheet', async () => { await page.click('.menu-layer [data-act="new"]', CLK); await frames(2);
  await page.fill('#cap-name', 'Anne Playtest', CLK); await page.dispatchEvent('#cap-name', 'input'); await page.click('.menu-layer .choice[data-v="french"]', CLK); await page.click('.menu-layer .choice[data-v="gunnery"]', CLK); await frames(2); },
  s => s.menu === 'captain' || 'menu=' + s.menu);
await step('set-sail', async () => { await page.click('.menu-layer [data-act="start"]', CLK); await page.waitForFunction(() => window.__game.mode === 'sail', null, { timeout: 120000, polling: 500 }); await frames(10); },
  s => (s.mode === 'sail' && s.hud && s.name === 'Anne Playtest' && s.faction === 'french' && (!s.audio || SEA_THEMES.includes(s.mood))) || `bad start state (mood=${s.mood})`);

// sailing
await step('sail-wasd', async () => {
  // software GL runs at a few fps and dt is capped at 1/20 s, so judge the controls by their effect on the ship
  const p0 = await ev(() => ({ x: __game.player.position.x, z: __game.player.position.z, h: __game.player.heading }));
  await key('KeyW'); await key('KeyW');
  const sail = await ev(() => __game.player.sailSetting);
  await page.keyboard.down('KeyD'); await frames(2); await sim(4);
  const helmD = await ev(() => __game.player.controller.helm);
  await page.keyboard.up('KeyD'); await page.keyboard.down('KeyA'); await frames(2); await sim(2);
  const helmA = await ev(() => __game.player.controller.helm);
  await page.keyboard.up('KeyA'); await frames(2); await sim(4);
  const p1 = await ev(() => ({ x: __game.player.position.x, z: __game.player.position.z, h: __game.player.heading, kn: __game.player.speed * 1.944 }));
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  if (sail !== 1 || !(helmD > 0.1) || !(helmA < -0.1)) throw new Error(`controls not applied sail=${sail} helmD=${helmD} helmA=${helmA}`);
  return `full sail, helm ${helmD.toFixed(2)} / ${helmA.toFixed(2)}, moved ${moved.toFixed(1)} m, heading ${p0.h.toFixed(3)}→${p1.h.toFixed(3)}, ${p1.kn.toFixed(1)} kn`;
});
await step('time-compression', async () => {
  // clear nearby AI so compression is allowed
  await ev(() => { const g = __game, p = g.player; for (const s of [...g.ships]) if (s !== p && Math.hypot(s.position.x - p.position.x, s.position.z - p.position.z) < 900) g.removeShip(s); });
  // software GL can stall for many seconds: a fixed frame count may elapse before the game has read the key
  // (the read then saw x1 and the 2nd T only cancelled the 1st). Wait for the controller to act instead.
  const tsWait = v => page.waitForFunction(v => __game.timeScale === v, v, { timeout: 120000, polling: 250 }).catch(() => {});
  await key('KeyT'); await tsWait(4);
  const ts = await ev(() => __game.timeScale);
  await key('KeyT'); await tsWait(1);
  const ts2 = await ev(() => __game.timeScale);
  if (ts !== 4 || ts2 !== 1) throw new Error(`timeScale ${ts} then ${ts2}`);
  return 'x4 then x1';
});
await step('world-map-open', async () => { await key('KeyM'); await frames(4); }, s => (s.mode === 'map' && s.frozen) || `mode=${s.mode} frozen=${s.frozen}`);
await step('world-map-close', async () => { await key('KeyM'); await frames(4); }, s => (s.mode === 'sail' && !s.frozen && s.hud) || `mode=${s.mode} frozen=${s.frozen}`);
await step('pause-menu', async () => { await key('Escape'); await frames(3); const a = await state(); await key('Escape'); await frames(3); const b = await state();
  if (!(a.menu === 'pause' && a.frozen && b.menu === null && !b.frozen)) throw new Error(`pause ${JSON.stringify([a.menu, a.frozen, b.menu, b.frozen])}`); });

// combat: spawn a hostile pirate sloop on our port beam
await step('approach-hostile', async () => {
  await ev(() => {
    const g = __game, p = g.player, f = { x: Math.sin(p.heading), z: -Math.cos(p.heading) };
    const left = { x: f.z, z: -f.x };   // port side (heading 0 = -z, starboard = +x)
    const e = g.combat.spawnAI({ type: 'sloop', faction: 'pirate', role: 'pirate', name: 'Gallows Bird', x: p.position.x + left.x * 160, z: p.position.z + left.z * 160, heading: p.heading, crew: 30, sailSetting: 0.3 });
    e.ai.hold = true; e.ai.fireAtWill = false; e.speed = p.speed;
    window.__foe = e;
    g.cameraRig.follow(p);
  });
  await frames(20);
  return await ev(() => { const g = __game; return { hostile: g.combat.isHostile(g.player, __foe), target: g.hud.target?.name }; });
}, s => s.mode === 'sail' || s.mode);
await step('fire-broadsides', async () => {
  const before = await ev(() => ({ hull: __foe.hull, crew: __foe.crew, shots: __game.combat.stats.shots }));
  await key('KeyQ'); await frames(2); await sim(4);
  await key('KeyE'); await frames(2); await sim(2);
  const after = await ev(() => ({ hull: __foe.hull, crew: __foe.crew, shots: __game.combat.stats.shots, hits: __game.combat.stats.hits }));
  if (after.shots <= before.shots) throw new Error('no shots fired');
  return { before, after };
});
await step('reduce-enemy', async () => {
  await ev(() => { __foe.hull = __foe.hullMax * 0.3; __foe.crew = 8; __foe.sails = 0.4; });
  await frames(5);
});
await step('board', async () => {
  await ev(() => { const g = __game, p = g.player, e = __foe; const f = { x: Math.sin(p.heading), z: -Math.cos(p.heading) }; const left = { x: f.z, z: -f.x };
    e.teleport(p.position.x + left.x * 10, p.position.z + left.z * 10, p.heading); e.speed = p.speed; });
  await sim(0.5);
  // boarding is manual (B, "À l'abordage !"): never on contact
  await page.keyboard.press('b'); await frames(2); await sim(0.2);
  await page.waitForFunction(() => __game.duel.active, null, { timeout: 180000, polling: 500 });
  await frames(20);
}, s => (s.mode === 'duel' && !s.hud) || `mode=${s.mode} hud=${s.hud}`);
await step('duel-fight', async () => { await key('KeyJ'); await sim(1); await page.keyboard.down('KeyD'); await frames(2); await sim(1); await page.keyboard.up('KeyD'); await key('KeyJ'); await sim(1.5); await frames(3);
  return await ev(() => ({ p: __game.duel.sim?.player?.hp ?? __game.duel.sim?.player?.health, e: __game.duel.sim?.enemy?.hp ?? __game.duel.sim?.enemy?.health })); }, s => s.mode === 'duel' || s.mode);
await step('capture-screen', async () => {
  await ev(() => { const d = __game.duel; d._teardown(); d._finish({ winner: 'player', reason: 'wounds' }); });
  await page.waitForSelector('.board-screen.on', { timeout: 120000, polling: 500 });
  await page.waitForTimeout(800); await frames(3);
  return await ev(() => document.querySelector('.board-screen h2')?.textContent);
}, s => (!s.hud) || 'HUD visible behind capture screen');
let goldBefore;
await step('keep-prize', async () => {
  goldBefore = await ev(() => ({ gold: __game.state.gold, plunder: __game.state.plunder, captures: __game.state.captures, spoils: __game.boarding.spoils.gold }));
  await page.click('.board-screen button[data-c="captured"]', CLK); await frames(10);
  const a = await ev(() => ({ gold: __game.state.gold, plunder: __game.state.plunder, captures: __game.state.captures }));
  if (a.captures !== 1) throw new Error('captures not counted exactly once: ' + JSON.stringify(a));
  if (Math.round(a.plunder - goldBefore.plunder) !== Math.round(goldBefore.spoils * 0.5)) throw new Error('plunder share mismatch ' + JSON.stringify(a));
  return { goldBefore, after: a };
}, s => (s.mode === 'sail' && s.hud && s.fleet === 1 && !s.frozen) || `mode=${s.mode} fleet=${s.fleet} frozen=${s.frozen}`);

// port
await step('sail-to-port', async () => {
  await ev(() => { const g = __game, p = g.player; const np = g.islands.nearestPort(p.position.x, p.position.z); const hp = np.port.harborPoint;
    const hd = Math.atan2(-np.port.seaward.x, np.port.seaward.z); p.teleport(hp.x + np.port.seaward.x * 100, hp.z + np.port.seaward.z * 100, hd);
    for (const s of [...g.ships]) if (s !== p && Math.hypot(s.position.x - p.position.x, s.position.z - p.position.z) < 900) g.removeShip(s); });
  await key('KeyW'); await frames(2); await sim(3); await frames(2);
  return await ev(() => { const g = __game, p = g.player, np = g.islands.nearestPort(p.position.x, p.position.z); return `${np.port.name} ${Math.round(np.dist)} m, prompt ${!document.querySelector('.prompt').classList.contains('off')}`; });
});
await step('port-enter', async () => { await key('KeyF'); await page.waitForFunction(() => __game.ports.isOpen, null, { timeout: 60000, polling: 500 }); await page.waitForTimeout(1200); await frames(4); },
  s => (s.mode === 'port' && !s.hud) || `mode=${s.mode} hud=${s.hud}`);
const tab = async (t) => { await page.click(`.port-screen [data-tab="${t}"], [data-tab="${t}"]`, CLK); await page.waitForFunction(t => __game.ports.screen.tab === t, t, { timeout: 240000, polling: 500 }); await page.waitForTimeout(900); await frames(3); };
await step('port-market', async () => {
  await tab('market');
  const g0 = await ev(() => __game.state.gold);
  const b = await page.$('[data-buy]'); if (!b) throw new Error('no buy buttons'); await b.click(CLK); await frames(2);
  const g1 = await ev(() => __game.state.gold);
  const sb = await page.$('[data-sell]'); if (sb) { await sb.click(CLK); await frames(2); }
  const g2 = await ev(() => __game.state.gold);
  return `gold ${g0}→${g1} (buy)→${g2} (sell)`;
});
await step('port-tavern-hire', async () => {
  await tab('tavern');
  const c0 = await ev(() => __game.player.crew);
  const b = await page.$('[data-act="hire"]:not([disabled])'); if (b) await b.click(CLK); await frames(2);
  return `crew ${c0}→${await ev(() => __game.player.crew)}`;
});
await step('port-shipyard-repair', async () => {
  await ev(() => { __game.player.hull = __game.player.hullMax * 0.6; __game.ports.screen.render(); });
  await tab('shipyard');
  await ev(() => __game.ports.screen.render()); await frames(2);
  const h0 = await ev(() => __game.player.hull / __game.player.hullMax);
  const b = await page.$('[data-act="repair"][data-part="hull"]:not([disabled])'); if (!b) throw new Error('repair button missing/disabled'); await b.click(CLK); await frames(2);
  await ev(() => { __game.state.gold += 3000; __game.ports.screen.render(); }); await frames(2);
  const u = await page.$('[data-act="upgrade"][data-k="guns"]:not([disabled])'); if (u) { await u.click(CLK); await frames(2); }
  const r = await ev(() => ({ hull: __game.player.hull / __game.player.hullMax, gunPower: __game.player.gunPower }));
  if (!(r.hull > h0)) throw new Error('hull not repaired');
  if (!(r.gunPower > 1)) throw new Error('gunPower not set by refit');
  return `hull ${h0.toFixed(2)}→${r.hull.toFixed(2)}, gunPower ${r.gunPower}`;
});
await step('port-governor', async () => {
  await tab('governor');
  const n = await ev(() => document.querySelectorAll('[data-act="accept"]').length);
  const esc = await page.$('.mission:has-text("Escort") [data-act="accept"]');
  if (esc) { await esc.click(CLK); await frames(2); }
  return `${n} commissions offered, escort accepted: ${!!esc}`;
});
await step('port-bank', async () => { await tab('bank'); });
await step('port-leave', async () => {
  await key('Escape'); await page.waitForTimeout(900); await key('Escape'); await frames(20);
  return await ev(() => ({ escort: __game.ships.filter(s => s.escortOf === __game.player || s._escortMission).map(s => s.name) }));
}, s => (s.mode === 'sail' && s.hud && s.timeScale === 1 && !s.frozen) || `mode=${s.mode} hud=${s.hud} ts=${s.timeScale} frozen=${s.frozen}`);

// save → reload → continue
let saved;
await step('save', async () => {
  saved = await ev(() => { const ok = __game.ports.save(); const p = __game.player; return { ok, gold: Math.round(__game.state.gold), name: __game.state.name, ship: p.name, x: Math.round(p.position.x), z: Math.round(p.position.z), fleet: __game.state.fleet.length, gunPower: p.gunPower }; });
  if (!saved.ok) throw new Error('save failed');
  return saved;
});
await step('reload-title', async () => {
  await page.reload({ waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 400000, polling: 500 });
  await frames(3);
  const dis = await ev(() => document.querySelector('.menu-layer [data-act="continue"]')?.disabled);
  if (dis !== false) throw new Error('Continue disabled after save');
  return await ev(() => document.querySelector('.menu-layer [data-act="continue"] .note')?.textContent);
}, s => s.mode === 'menu' || s.mode);
await step('continue', async () => {
  await page.click('.menu-layer [data-act="continue"]', CLK); await page.waitForFunction(() => __game.mode === 'sail', null, { timeout: 120000, polling: 500 }); await frames(10);
  const r = await ev(() => { const p = __game.player; return { gold: Math.round(__game.state.gold), name: __game.state.name, ship: p.name, x: Math.round(p.position.x), z: Math.round(p.position.z), fleet: __game.state.fleet.length, gunPower: p.gunPower }; });
  const bad = Object.keys(saved).filter(k => k !== 'ok' && k !== 'x' && k !== 'z' && saved[k] !== r[k]);
  if (Math.hypot(r.x - saved.x, r.z - saved.z) > 30) bad.push('pos');
  if (bad.length) throw new Error('mismatch ' + bad.join(',') + ' ' + JSON.stringify(r));
  return r;
}, s => (s.mode === 'sail' && s.hud && (!s.audio || SEA_THEMES.includes(s.mood))) || `mode=${s.mode} hud=${s.hud} mood=${s.mood}`);

// perf
const perf = await ev(() => new Promise(res => {
  const g = __game, r = g.renderer; const samples = []; let n = 0;
  const origStep = g.step.bind(g);
  r.info.autoReset = false; const op = g.post.render.bind(g.post); g.post.render = dt => { r.info.reset(); op(dt); };   // composer passes would otherwise reset the counters
  let js = 0;
  g.step = dt => { const t = performance.now(); origStep(dt); js += performance.now() - t; };
  const t0 = performance.now();
  const f = () => { n++; samples.push({ calls: r.info.render.calls, tris: r.info.render.triangles }); if (n < 30) requestAnimationFrame(f); else { g.step = origStep; g.post.render = op; r.info.autoReset = true; res({ frames: n, msPerFrame: (performance.now() - t0) / n, stepMsPerFrame: js / n, calls: samples.at(-1).calls, tris: samples.at(-1).tris, ships: g.ships.length, quality: g.settings?.quality, geoms: r.info.memory.geometries, textures: r.info.memory.textures }); } };
  requestAnimationFrame(f);
}));
log('PERF', JSON.stringify(perf));

const failed = results.filter(r => !r.ok);
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ url, results, perf, errors: [...new Set(errors)] }, null, 2));
log(`\n${results.length - failed.length}/${results.length} steps passed`);
for (const r of failed) log('FAILED:', r.step, r.note);
if (errors.length) log('ERRORS:\n' + [...new Set(errors)].slice(0, 30).join('\n'));
await browser.close();
