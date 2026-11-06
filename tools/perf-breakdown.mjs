// Triangle / draw-call breakdown by system, near Havana (default game start, sail
// mode, Élevé unless ?quality=…): one render with everything, then one render per top-level scene group hidden
// (ships, towns `LOD`, terrain, ocean, vegetation `Mesh`, `DirectionalLight` = the shadow pass…). A group's delta
// includes its share of the shadow pass. Also prints the nearest towns' LOD level / triangles and each ship's hull LOD.
// usage: node tools/perf-breakdown.mjs [fixed|natural] [extra query] [w] [h]
//   fixed  : AI removed, 24 non-AI ships of 12 types at seeded open-water spots 150–3 000 m around the player (27 ships
//            with the player and pre-placed ones) — the same scene before / after a change
//   natural: default traffic (Math.random seeded)
// Software rendering takes ~30–40 s per render (9–10 renders); on a GPU it is instant.
import { chromium } from 'playwright';
import { BASE, launchOpts } from './_env.mjs';
const mode = process.argv[2] || 'fixed';
const q = 'start=havana&' + (process.argv[3] || '');   // reference scene near Havana (the default start has been Port Royal since character creation)
const W = +(process.argv[4] || 960), H = +(process.argv[5] || 540);
const browser = await chromium.launch(launchOpts());
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.addInitScript(() => { let s = 12345; Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; });
const errs = [];
page.on('pageerror', e => errs.push('ERR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('[error] ' + m.text()); else if (m.text().startsWith('PERF')) console.log(m.text()); });
const t0 = Date.now();
await page.goto(BASE + '?' + q, { timeout: 300000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 400000, polling: 500 });
console.log('ready s', (Date.now() - t0) / 1000);
const r = await page.evaluate(async (mode) => {
  const g = __game, R = g.renderer;
  g.hud.menu.close(); g.mode = 'sail'; g.events.emit('state:change', { from: 'menu', to: 'sail' }); g.cameraRig.follow(g.player);
  g.renderer.setAnimationLoop(null);
  if (mode === 'fixed') {
    g.combat.setTrafficTarget(0);
    for (const s of g.ships.slice()) if (s !== g.player) g.removeShip(s);
    const types = ['galleon', 'merchantman', 'frigate', 'brig', 'sloop', 'schooner', 'pink', 'corvette', 'nao', 'brigantine', 'threedecker', 'lugger'];
    const facs = ['spanish', 'spanish', 'english', 'french', 'dutch', 'pirate'];
    let seed = 777; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const P = g.player.position; let n = 0, guard = 0;
    while (n < 24 && guard++ < 2000) {
      const a = rnd() * Math.PI * 2, d = 150 + Math.pow(rnd(), 1.3) * 2850;
      const x = P.x + Math.cos(a) * d, z = P.z + Math.sin(a) * d;
      if (g.islands.isLand?.(x, z, 50)) continue;
      if (g.ships.some(s => Math.hypot(s.position.x - x, s.position.z - z) < 120)) continue;
      const s = g.spawnShip({ type: types[n % types.length], faction: facs[n % facs.length], x, z, heading: rnd() * 6.28, sailSetting: 0.7, speed: 0 });
      s.controller = null; n++;
    }
  }
  for (let i = 0; i < 20; i++) g.step(1 / 30);
  const frame = () => { R.info.autoReset = false; R.info.reset(); g.post.render(1 / 30); return { calls: R.info.render.calls, tris: R.info.render.triangles }; };
  frame(); const all = frame(); console.log('PERF all ' + JSON.stringify(all) + ' ships ' + g.ships.length);
  const cats = {};
  const shipGroups = new Set(g.ships.map(s => s.model?.group).filter(Boolean));
  const add = (name, obj) => { (cats[name] ||= []).push(obj); };
  for (const c of g.scene.children) {
    if (shipGroups.has(c)) { add('ships', c); continue; }
    add(c.name || c.type || '?', c);
  }
  const res = { all, ships: g.ships.length, quality: g.quality, progs: R.info.programs.length, cats: {} };
  for (const [name, objs] of Object.entries(cats)) {
    const vis = objs.map(o => o.visible); objs.forEach(o => o.visible = false);
    const f = frame(); objs.forEach((o, i) => o.visible = vis[i]);
    const d = { calls: all.calls - f.calls, tris: all.tris - f.tris, n: objs.length };
    if (d.calls || d.tris) { res.cats[name] = d; console.log('PERF cat ' + name + ' ' + JSON.stringify(d)); }
  }
  // static info (no extra renders): town LOD levels and their triangle counts, ship LOD state
  const triOf = (o) => { let n = 0; o.traverse(m => { if (m.isMesh && m.geometry) { const g = m.geometry; n += (g.index ? g.index.count : g.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1); } }); return Math.round(n); };
  const cam = g.camera.position;
  res.towns = [];
  for (const c of g.scene.children) if (c.isLOD) {
    const lvl = c.levels.findIndex(l => l.object.visible);
    const near = c.levels[0].object, far = c.levels[1]?.object;
    const d = Math.round(Math.hypot(c.position.x - cam.x, c.position.z - cam.z));
    // near: a village is still one merged Mesh; a town is a Group of chunk meshes (userData.chunk) plus the
    // moored hulls/foam attached as extra children — tell them apart so nearOwn/kids/r stay meaningful for both.
    const chunkKids = near.isMesh ? [near] : near.children.filter(k => k.userData?.chunk);
    const extraKids = near.isMesh ? [] : near.children.filter(k => !k.userData?.chunk);
    const kids = extraKids.map(k => (k.material?.type || k.type) + ':' + triOf(k));
    const nearOwn = chunkKids.reduce((s, k) => s + Math.round((k.geometry.index ? k.geometry.index.count : k.geometry.attributes.position.count) / 3), 0);
    // span of the chunk grid (no THREE import in this page.evaluate context): min/max of each chunk's own bounding box
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const k of chunkKids) { const bb = k.geometry.boundingBox; if (!bb) continue; for (let a = 0; a < 3; a++) { const ax = 'xyz'[a]; lo[a] = Math.min(lo[a], bb.min[ax]); hi[a] = Math.max(hi[a], bb.max[ax]); } }
    const r = Math.round(Math.hypot(hi[0] - lo[0], hi[2] - lo[2]) / 2) || 0;
    res.towns.push({ d, lvl, near: triOf(near), nearOwn, chunks: chunkKids.length, kids, far: far ? triOf(far) : 0, r });
  }
  res.towns.sort((a, b) => a.d - b.d); res.towns = res.towns.slice(0, 3);
  res.perShip = g.ships.map(s => [s.type, Math.round(Math.hypot(s.position.x - cam.x, s.position.z - cam.z)), s.model.lodFar ? 'far' : 'near', Math.round(((s.model.lodFar ? s.model.group.children[0].geometry : s.model.group.children[0].geometry).index.count) / 3)].join(' ')).sort((a, b) => +a.split(' ')[1] - +b.split(' ')[1]);
  res.cam = [cam.x, cam.y, cam.z].map(Math.round);
  return res;
}, mode);
console.log(JSON.stringify(r, null, 1));
if (errs.length) console.log(errs.slice(0, 20).join('\n'));
await browser.close();
