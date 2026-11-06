// Islands: the archipelago terrain, vegetation and towns, plus the ports, coves and fishing villages sited on it.
// API:
//   islands.list   [{ id, name, x, z, radius, faction|null, type }]
//   islands.ports  [{ id, name, faction, islandId, x, z, harborPoint:{x,z}, size:'small'|'medium'|'large', goods:{...} }]
//   islands.getTerrainHeight(x, z) -> number (metres above sea level; < 0 = seabed depth)
//   islands.isLand(x, z, margin=0) -> bool    (used by ship physics for grounding / AI avoidance)
//   islands.nearestPort(x, z)      -> { port, dist }
//   islands.villages               fishing villages [{ id, name, village: true, faction: 'neutral', harborPoint, seaward, townCenter, sells, seed }]
//   islands.nearestVillage(x, z)   -> { village, dist } · islands.getVillage(id)
//   islands.update(dt, t)          (LOD streaming, animated foliage/flags)
// Extended API:
//   islands.getPort(id)            -> port | undefined
//   islands.getIsland(id)          -> island | undefined
//   islands.coves  [{ id, islandId, x, z, anchorPoint:{x,z} }]   hidden coves (treasure sites; x,z on the beach)
//   islands.coastDistance(x, z)    -> metres to nearest dry land (0 on land; coarse, ~8 m resolution)
//   islands.depthTexture           THREE.DataTexture (R = terrain height m, HalfFloat, linear, whole world)
//   islands.depthTextureBounds     { minX, minZ, size }
//   islands.goods                  GOODS table (name, basePrice, ...)
//   port extra fields: haven(bool), population, quay:{x,z}, seaward:{x,z} (unit), fort:{x,z,y}, townCenter:{x,z},
//                      lanterns lit automatically from sky.timeOfDay
import * as THREE from 'three';
import { generateWorld, GOODS } from '../data/world.js';
import { WorldShape } from './terrain/heightfield.js';
import { sitePort, siteVillage, siteCove } from './terrain/siting.js';
import { TerrainMeshes } from './terrain/terrainMesh.js';
import { createTerrainMaterial } from './terrain/terrainMaterial.js';
import { Vegetation } from './terrain/vegetation.js';
import { Towns } from './towns/towns.js';
import { HALF_WORLD } from '../core/constants.js';

export class Islands {
  constructor(game) {
    this.game = game;
    const _t0 = performance.now();
    const seed = game.seed ?? 1717;
    const world = this.world = generateWorld(seed);
    this.goods = GOODS;
    const shape = this.shape = new WorldShape(world, seed);

    // ---- site ports & coves on the analytic coast, then carve harbours ----
    this.ports = world.ports.map(p => this._sitePort(p));
    this.coves = world.coves.map(c => this._siteCove(c));
    this.villages = (world.villages || []).map(v => this._siteVillage(v));   // fishing villages (src/game/village.js)
    // relief tiles baked in parallel before the game is built (main.js → terrain/prebake.js), accepted only if
    // the terrain edits are identical; otherwise baked here
    const pre = globalThis.__tofPrebake || null; globalThis.__tofPrebake = null;
    shape.bake(pre);
    game.bootMark?.('islands:shape');   // loading steps (game.bootTimes)

    // verify harbour points are navigable, push further out if needed
    for (const p of [...this.ports, ...this.villages]) {
      for (let k = 0; k < 40 && shape.height(p.harborPoint.x, p.harborPoint.z) > -7; k++) {
        p.harborPoint.x += p.seaward.x * 20; p.harborPoint.z += p.seaward.z * 20;
      }
    }

    this.list = world.islands.map(i => ({ id: i.id, name: i.name, x: i.x, z: i.z, radius: i.radius, faction: i.faction, type: i.type }));
    this._islandById = Object.fromEntries(world.islands.map(i => [i.id, i]));
    this._portById = Object.fromEntries(this.ports.map(p => [p.id, p]));

    // ---- depth texture for the ocean (and coast distance field) ----
    const dt = shape.buildDepthData(2048);
    { const half = new Uint16Array(dt.data.length); for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(dt.data[i]);
      const tex = new THREE.DataTexture(half, dt.res, dt.res, THREE.RedFormat, THREE.HalfFloatType);
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false; tex.flipY = false;
      tex.needsUpdate = true;
      this.depthTexture = tex; }
    this.depthTextureBounds = dt.bounds;
    this._buildDistanceField(dt.data, 2048);
    game.bootMark?.('islands:depth+distance');

    // ---- render ----
    this.material = createTerrainMaterial();
    this.ports.forEach((p, i) => { if (i < 16) this.material.userData.uniforms.uTowns.value[i].set(p.townCenter.x, p.townCenter.z, 0, p.extent.hw * 1.1); });
    this.terrain = new TerrainMeshes(game, shape, this.material);
    game.bootMark?.('islands:terrain');
    const dbg = game.params?.get('islandsDebug') || '';
    this.vegetation = dbg.includes('noveg') ? null : new Vegetation(game, this);
    game.bootMark?.('islands:vegetation');
    this.towns = dbg.includes('notown') ? null : new Towns(game, this);
    game.bootMark?.('islands:towns');
    this._camPrev = new THREE.Vector3(1e9, 0, 0);
    this.update(0, 0, true);
    window.__islandsMs = Math.round(performance.now() - _t0);
  }

  // sites are computed in terrain/siting.js (also called by prebake.js, before the game is built)
  _sitePort(p) { return sitePort(this.shape, p); }
  _siteVillage(v) { return siteVillage(this.shape, v); }
  _siteCove(c) { return siteCove(this.shape, c); }

  _buildDistanceField(h, N) {
    // two-pass chamfer distance (in cells) to the nearest land cell (h > 0)
    const d = new Float32Array(N * N);
    const INF = 1e9;
    for (let i = 0; i < N * N; i++) d[i] = h[i] > 0 ? 0 : INF;
    const D1 = 1, D2 = Math.SQRT2;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i; let v = d[k]; if (!v) continue;
      if (i > 0) v = Math.min(v, d[k - 1] + D1);
      if (j > 0) { v = Math.min(v, d[k - N] + D1); if (i > 0) v = Math.min(v, d[k - N - 1] + D2); if (i < N - 1) v = Math.min(v, d[k - N + 1] + D2); }
      d[k] = v;
    }
    for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) {
      const k = j * N + i; let v = d[k]; if (!v) continue;
      if (i < N - 1) v = Math.min(v, d[k + 1] + D1);
      if (j < N - 1) { v = Math.min(v, d[k + N] + D1); if (i < N - 1) v = Math.min(v, d[k + N + 1] + D2); if (i > 0) v = Math.min(v, d[k + N - 1] + D2); }
      d[k] = v;
    }
    const cell = this.depthTextureBounds.size / N;
    for (let i = 0; i < N * N; i++) d[i] = Math.min(d[i] * cell, 4000);
    this._dist = d; this._distN = N; this._distCell = cell;
  }

  coastDistance(x, z) {
    const N = this._distN, c = this._distCell;
    const fx = Math.min(N - 1.001, Math.max(0, (x + HALF_WORLD) / c - 0.5)), fz = Math.min(N - 1.001, Math.max(0, (z + HALF_WORLD) / c - 0.5));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, d = this._dist, k = j * N + i;
    return (d[k] * (1 - u) + d[k + 1] * u) * (1 - v) + (d[k + N] * (1 - u) + d[k + N + 1] * u) * v;
  }

  getTerrainHeight(x, z) { return this.shape.height(x, z); }

  // true if (x,z) is dry land, or (margin > 0) within `margin` metres of dry land / on a reef shallower than 1.5 m
  isLand(x, z, margin = 0) {
    const h = this.shape.height(x, z);
    if (h > 0) return true;
    if (margin <= 0) return false;
    if (h > -1.5) return true;
    return this.coastDistance(x, z) < margin;
  }

  nearestPort(x, z) {
    let best = null, bd = Infinity;
    for (const p of this.ports) { const d = Math.hypot(x - p.harborPoint.x, z - p.harborPoint.z); if (d < bd) { bd = d; best = p; } }
    return { port: best, dist: bd };
  }
  getPort(id) { return this._portById[id]; }
  // fishing villages: the nearest { village, dist } (distance to the anchorage), or by id
  nearestVillage(x, z) {
    let best = null, bd = Infinity;
    for (const v of this.villages || []) { const d = Math.hypot(x - v.harborPoint.x, z - v.harborPoint.z); if (d < bd) { bd = d; best = v; } }
    return { village: best, dist: bd };
  }
  getVillage(id) { return (this.villages || []).find(v => v.id === id) || null; }
  getIsland(id) { return this.list.find(i => i.id === id); }

  update(dt, t, force = false) {
    const cam = this.game.camera.position;
    this.material.userData.uniforms.uTime.value = t;
    { const h = this.game.sky?.timeOfDay ?? 12; this.material.userData.uniforms.uNight.value = Math.min(1, Math.max(0, Math.max(6.5 - h, h - 18.6) / 0.8)); }
    if (force || cam.distanceToSquared(this._camPrev) > 400) {
      this.terrain.update(cam, force);
      this._camPrev.copy(cam);
    }
    this.vegetation?.update(dt, t, force);
    this.towns?.update(dt, t, force);
  }
}
