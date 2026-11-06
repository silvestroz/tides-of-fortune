// Web Worker of prebake.js: bakes the relief tiles of a share of the islands.
// Receives { seed, flats, dredges, indices } (edits already computed by siting.js on the main thread), returns
// { tiles: [{ i, x0, z0, cell, nx, nz, x1, z1, h, owner }] } transferring the arrays (no copy).
import { generateWorld } from '../../data/world.js';
import { WorldShape } from './heightfield.js';

self.onmessage = ({ data }) => {
  try {
    const { seed, flats, dredges, indices } = data;
    const shape = new WorldShape(generateWorld(seed), seed);
    shape.flats = flats; shape.dredges = dredges;
    const tiles = [], transfer = [];
    for (const i of indices) {
      const t = shape.bakeIsland(shape.islands[i]);
      tiles.push({ i, ...t }); transfer.push(t.h.buffer, t.owner.buffer);
    }
    self.postMessage({ tiles }, transfer);
  } catch (e) {
    self.postMessage({ error: String(e && e.stack || e) });
  }
};
