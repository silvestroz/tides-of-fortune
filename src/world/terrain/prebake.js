// Bakes the islands' relief in parallel, before the game is built.
// main.js: window.__tofPrebake = await prebakeTerrain(seed); Islands → shape.bake(window.__tofPrebake).
// The main thread computes the sites (siting.js: same edits as Islands), hands islands over to Web Workers
// (bakeWorker.js, split by tile size) and bakes its own share and the open-sea grid meanwhile.
// Returns { key, tiles[index], grid, ms, workers } or null (no Worker, a single core, error): Islands then bakes
// everything itself, as before. shape.bake() only accepts the result if editKey() is identical.
import BakeWorker from './bakeWorker.js?worker&inline';
import { generateWorld } from '../../data/world.js';
import { WorldShape } from './heightfield.js';
import { siteWorld } from './siting.js';

export async function prebakeTerrain(seed) {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  const nW = Math.max(1, Math.min(5, cores - 1));
  if (typeof Worker === 'undefined' || cores < 2) return null;
  const t0 = performance.now();
  const world = generateWorld(seed), shape = new WorldShape(world, seed);
  siteWorld(shape, world);
  const isl = shape.islands;
  // cost ≈ number of cells of the tile; greedy split (the biggest to the least loaded lane), the main thread
  // counts as one more lane
  const cost = isl.map(s => { const sx = s.bbox[2] - s.bbox[0], sz = s.bbox[3] - s.bbox[1], c = s.type === 'mainland' ? 12 : Math.min(10, Math.max(6, Math.round(Math.sqrt(sx * sz) / 360))); return (sx / c) * (sz / c); });
  const lanes = Array.from({ length: nW + 1 }, () => ({ load: 0, idx: [] }));
  for (const i of isl.map((_, i) => i).sort((a, b) => cost[b] - cost[a])) {
    const l = lanes.reduce((a, b) => (b.load < a.load ? b : a));
    l.load += cost[i]; l.idx.push(i);
  }
  const tiles = new Array(isl.length), workers = [];
  const jobs = lanes.slice(1).filter(l => l.idx.length).map(l => new Promise((res, rej) => {
    const w = new BakeWorker(); workers.push(w);
    w.onmessage = ({ data }) => { w.terminate(); if (data.error) rej(new Error(data.error)); else { for (const t of data.tiles) tiles[t.i] = t; res(); } };
    w.onerror = e => { w.terminate(); rej(e); };
    w.postMessage({ seed, flats: shape.flats, dredges: shape.dredges, indices: l.idx });
  }));
  // the main thread's share (the workers run meanwhile)
  for (const i of lanes[0].idx) tiles[i] = shape.bakeIsland(isl[i]);
  const grid = shape.bakeGrid();
  // safeguard: a silent worker doesn't block loading (Islands then bakes everything itself)
  let timer = 0;
  try { await Promise.race([Promise.all(jobs), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('prebake: timed out')), 20000); })]); }
  finally { clearTimeout(timer); for (const w of workers) w.terminate(); }
  for (const t of tiles) delete t.i;
  return { key: shape.editKey(), tiles, grid, ms: Math.round(performance.now() - t0), workers: jobs.length };
}
