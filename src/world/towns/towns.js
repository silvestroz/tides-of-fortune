// Procedural colonial port towns + forts. Near LOD split into a grid of merged chunks per town (TOWN_CHUNK_M, so the
// shadow pass can cull most of a large town instead of drawing it whole) + one cheap single far mesh,
// one shared painterly material (aMat ids, see builder.js), waving faction flags (shared shader), lanterns lit at night.
//   new Towns(game, islands);  towns.update(dt, t, force)
//   towns.list [{ port, lod, near, far, tris }]   near = Group of merged per-chunk meshes (TOWN_CHUNK_M), far = Mesh
//                                                 (fishing villages included: port.village, src/world/towns/village3d.js)
//   towns.setPortFaction(port)   repaints that port's flags (fort, plaza, moored ships) after port.faction changed
//                                (town conquered: living.assaulted / living.ensure)
import * as THREE from 'three';
import { GeoBuilder, M } from './builder.js';
import { mulberry32 } from '../../core/rng.js';
import { getDetailTexture, getFlagAtlas, FLAG_INDEX } from '../terrain/textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getShipStaticParts } from '../../ships/shipModel.js';
import { makeHullMaterial } from '../../ships/art/materials.js';
import { makeFoamMaterial } from '../../ships/art/extras.js';
import { HarbourLife } from './harbourLife.js';
import { buildVillage } from './village3d.js';   // fishing villages

const TOWN_CHUNK_M = 60;   // cell size of the "near" mesh (GeoBuilder.buildChunks(), see builder.js)
const STYLE = {
  spanish: { wall: ['#f2ecdc', '#e3b04e', '#e58f6a', '#d9c7a6', '#a9c4cf', '#e6a98a', '#f4efe2', '#d8a24a', '#c97c5a', '#b8d0c0'], roof: ['#b9582f', '#a84e2c', '#c46a42', '#8e3e22', '#d07a48', '#a8603a'], roofMat: M.TILE, wallMat: M.PLASTER, roofKind: 'hip', pitch: 0.55, trim: '#3f6a5a', trims: ['#3f6a5a', '#6a3a24', '#2f5470', '#7a2a24'] },
  english: { wall: ['#9a5a40', '#a8674a', '#d9cdb6', '#8c4e38', '#cdbf9f', '#b07a52'], roof: ['#4a5260', '#55606e', '#3f4652'], roofMat: M.SLATE, wallMat: M.BRICK, roofKind: 'gable', pitch: 0.75, trim: '#efe8da' },
  french:  { wall: ['#f0e6d0', '#e2b86a', '#d89878', '#a8bfcc', '#e6d0b0', '#cf9c7a', '#f4eee0'], roof: ['#56606c', '#b8603c', '#4a525e', '#9a4a30'], roofMat: M.SLATE, wallMat: M.PLASTER, roofKind: 'hip', pitch: 0.8, trim: '#3c5a8a' },
  dutch:   { wall: ['#a0503a', '#b8784a', '#8a4632', '#e8d8b8', '#9c6a3e'], roof: ['#9a4a2e', '#3c3c3c', '#a85a36'], roofMat: M.TILE, wallMat: M.BRICK, roofKind: 'gable', pitch: 1.1, trim: '#f2ecdc' },
  pirate:  { wall: ['#8a6a4a', '#7a5a3c', '#9c7c58', '#6e5038'], roof: ['#a08a5a', '#8c7448', '#6a5a40'], roofMat: M.THATCH, wallMat: M.WOOD, roofKind: 'gable', pitch: 0.7, trim: '#3a2a1a' },
};

function townMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const u = { uDetail: { value: getDetailTexture() }, uNight: { value: 0 } };
  mat.userData.uniforms = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aMat; varying float vMat; varying vec3 vTW; varying vec3 vTN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMat = aMat; vTW = (modelMatrix * vec4(transformed,1.0)).xyz; vTN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uDetail; uniform float uNight; varying float vMat; varying vec3 vTW; varying vec3 vTN;
        vec4 triT(vec3 p, vec3 n, float s){ vec3 w = pow(abs(n), vec3(4.0)); w /= w.x+w.y+w.z;
          return texture2D(uDetail, p.zy*s)*w.x + texture2D(uDetail, p.xz*s)*w.y + texture2D(uDetail, p.xy*s)*w.z; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float mid = floor(vMat + 0.5);
        vec3 P = vTW, N = normalize(vTN);
        vec4 d = triT(P, N, 0.11), dB = triT(P, N, 0.027);
        float emis = 0.0;
        vec3 c = diffuseColor.rgb;
        float u = abs(N.x) > abs(N.z) ? P.z : P.x;
        if (mid == 0.0) { c *= 0.8 + 0.3*dB.r + 0.12*d.a; float grime = smoothstep(2.5, 0.0, fract(P.y/3.6)*3.6) * 0.0 + smoothstep(0.55,0.95,dB.g); c *= 1.0 - 0.28*grime*step(abs(N.y),0.5); c = mix(c, c*vec3(0.8,0.75,0.68), smoothstep(0.6,0.9,triT(P,N,0.008).r)); }          // plaster
        else if (mid == 1.0) { vec2 b = abs(N.y) > 0.6 ? P.xz * vec2(3.6, 7.0) : vec2(u*3.6 + floor(P.y*7.0)*0.5, P.y*7.0); float m = step(0.1, fract(b.x))*step(0.14, fract(b.y));
          c *= mix(0.62, 0.9 + 0.25*fract(sin(dot(floor(b),vec2(12.9,78.2)))*437.5), m); }                                     // brick
        else if (mid == 2.0) { vec2 t2 = vec2(u * 3.0, P.y * 3.2); t2.x += floor(t2.y) * 0.5;
          float cell = fract(sin(dot(floor(t2), vec2(12.9,78.2)))*437.5);
          float barrel = sin(fract(t2.x) * 3.14159); float lap = smoothstep(0.0, 0.25, fract(t2.y));
          c *= (0.55 + 0.5 * barrel) * (0.7 + 0.3 * lap) * (0.8 + 0.4 * cell);
          c = mix(c, c * vec3(0.7, 0.75, 0.55), smoothstep(0.6, 0.9, dB.r) * 0.6); }                                      // terracotta barrel tiles + lichen
        else if (mid == 5.0) { float rows = mid == 2.0 ? 3.0 : 4.0; float along = P.y*rows;
          float a = fract(along); vec2 t2 = vec2(u*(mid==2.0?2.6:3.2) + floor(along)*0.5, along);
          c *= (0.72 + 0.35*a) * (0.85 + 0.25*fract(sin(dot(floor(t2),vec2(12.9,78.2)))*437.5)) * mix(0.75,1.0,step(0.08,fract(t2.x))); } // tiles/slate
        else if (mid == 3.0) { c *= 0.7 + 0.45*d.g; c *= mix(0.7, 1.0, step(0.06, fract(u*3.3 + P.y*0.02))); }               // wood planks
        else if (mid == 4.0) { vec2 b = abs(N.y) > 0.6 ? P.xz * vec2(1.2, 2.4) : vec2(u*1.5 + floor(P.y*2.6)*0.5, P.y*2.6); b.x += abs(N.y) > 0.6 ? floor(b.y) * 0.5 : 0.0; vec2 fb = fract(b);
          float m = smoothstep(0.02, 0.07, fb.x) * smoothstep(0.98, 0.93, fb.x) * smoothstep(0.03, 0.1, fb.y) * smoothstep(0.97, 0.9, fb.y);
          float rnd = fract(sin(dot(floor(b),vec2(41.3,17.7)))*137.1);
          c *= mix(0.5, (0.72 + 0.4*rnd) * (0.85 + 0.3*d.r), m) * (0.75 + 0.45*dB.r);
          c = mix(c, c * vec3(0.62, 0.6, 0.55), smoothstep(0.45, 0.8, triT(P, N, 0.012).r));
          c = mix(c, c * vec3(0.95, 0.85, 0.7), rnd * 0.35);
          // weathering streaks + moss toward the base
          c *= 1.0 - 0.25 * smoothstep(0.55, 0.85, triT(P * vec3(1.0, 0.15, 1.0), N, 0.15).g);
          c = mix(c, vec3(0.18, 0.24, 0.12), smoothstep(0.5, 0.95, dB.r) * smoothstep(3.0, 0.0, P.y - 0.0) * 0.6); }                  // stone ashlar
        else if (mid == 6.0) { c *= 0.65 + 0.6*d.g; }                                                                          // thatch
        else if (mid == 7.0) { float lit = step(0.45, fract(sin(dot(floor(P*0.7),vec3(12.9,78.2,37.1)))*437.5)); c = mix(c, vec3(1.0,0.6,0.26), uNight*lit); emis = uNight * lit * 1.3; }                              // window
        else if (mid == 8.0) { c = vec3(1.0,0.75,0.4); emis = 0.3 + uNight * 2.2; }                                                                    // lamp
        else if (mid == 11.0) { vec2 b = P.xz*1.4; c *= 0.75 + 0.3*fract(sin(dot(floor(b),vec2(12.9,78.2)))*437.5); c *= 0.8 + 0.3*dB.r; }
        // ground contact darkening for walls
        c *= mix(0.72, 1.0, smoothstep(0.0, 1.6, P.y - floor(P.y / 200.0) * 200.0 - 0.0 + 999.0));
        diffuseColor.rgb = c;
        vec3 townEmis = c * emis;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += townEmis + diffuseColor.rgb * vec3(0.05,0.07,0.12) * uNight;');
  };
  mat.customProgramCacheKey = () => 'town-v3';
  return mat;
}

function flagMaterial() {
  const u = { uTime: { value: 0 }, uMap: { value: getFlagAtlas() } };
  const mat = new THREE.MeshStandardMaterial({ map: getFlagAtlas(), side: THREE.DoubleSide, roughness: 0.9 });
  mat.userData.uniforms = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; attribute float aFlag; attribute float aPhase;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vMapUv = vec2((mod(aFlag,4.0) + uv.x)/4.0, (1.0 - floor(aFlag/4.0)*0.5) - (1.0-uv.y)*0.5);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float fx = uv.x; float w = sin(fx*7.0 - uTime*6.0 + aPhase)*0.6 + sin(fx*13.0 - uTime*9.0 + aPhase*2.0)*0.2;
        transformed.z += w * fx * 0.9;  transformed.y -= fx*fx*0.6;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        { float fx = uv.x; float dw = cos(fx*7.0 - uTime*6.0 + aPhase)*4.2*fx; objectNormal = normalize(vec3(-dw, 0.0, 1.0)); }`);
  };
  mat.customProgramCacheKey = () => 'flag-v1';
  return mat;
}

export class Towns {
  constructor(game, islands) {
    this.game = game; this.islands = islands;
    this.material = townMaterial();
    this.flagMat = flagMaterial();
    this.list = [];
    this.flagData = [];      // { pos:[x,y,z], rotY, scale, flag }
    for (const p of islands.ports) {
      try { this.list.push(this._buildTown(p)); } catch (e) { console.warn('town build failed', p.id, e); }
    }
    for (const v of islands.villages || []) {   // fishing villages: huts, jetty, nets (village3d.js)
      try { this.list.push(buildVillage(this, v)); } catch (e) { console.warn('village build failed', v.id, e); }
    }
    this._buildFlags();
    this._buildGlows();
    try { this.life = new HarbourLife(game, this); } catch (e) { console.warn('harbour life failed', e); }
    try { islands.vegetation?.addInstances({ palm: this.plantPalms || [], seagrape: this.plantBushes || [] }); } catch (e) { console.warn('town planting failed', e); }
  }

  // additive camera-facing glow quads at every lamp (one draw call), faded in at night
  _buildGlows() {
    const L = this.lampPos || []; if (!L.length) return;
    const n = L.length, pos = new Float32Array(n * 12), uv = new Float32Array(n * 8), ctr = new Float32Array(n * 12), idx = [];
    for (let i = 0; i < n; i++) {
      const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let k = 0; k < 4; k++) { ctr.set(L[i], i * 12 + k * 3); pos.set(L[i], i * 12 + k * 3); uv.set(c[k], i * 8 + k * 2); }
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aCorner', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeBoundingSphere();
    this.glowU = { uNight: { value: 0 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.glowU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec2 aCorner; varying vec2 vC; varying float vD; uniform float uNight;
        void main(){ vC = aCorner; vec4 mv = modelViewMatrix * vec4(position,1.0); float d = -mv.z; vD = d;
          float s = min(1.1 + d * 0.004, 4.0); mv.xy += aCorner * s; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec2 vC; varying float vD; uniform float uNight;
        void main(){ float r = length(vC); float a = 0.35*exp(-r*r*6.0) + 0.5*exp(-r*r*40.0);
          a *= uNight * (1.0 - smoothstep(1500.0, 4000.0, vD));
          gl_FragColor = vec4(vec3(1.0, 0.62, 0.30) * a * 0.9, 1.0); }`,
    });
    const mesh = this.glowMesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false; mesh.renderOrder = 5;
    this.game.scene.add(mesh);
    // a few real point lights would be too costly; one warm light per town near the plaza instead
  }

  ground(x, z) { return this.islands.shape.height(x, z); }

  _buildTown(port) {
    const rand = mulberry32(port.townSeed || 1);
    const st = STYLE[port.faction] || STYLE.english;
    const pick = (a) => a[Math.floor(rand() * a.length)];
    const B = new GeoBuilder(true), F = new GeoBuilder(false);
    const sx = port.seaward.x, sz = port.seaward.z, lx = port.lateral.x, lz = port.lateral.z;
    const q = port.quay, hw = port.extent.hw, depth = port.extent.depth;
    // local frame: a = inland distance from quay, b = lateral
    const W = (a, b) => [q.x - sx * a + lx * b, q.z - sz * a + lz * b];
    const rotFace = Math.atan2(sx, sz);          // rotY that makes local +z face seaward
    const g = (x, z) => this.ground(x, z);
    const both = (fn) => { fn(B, true); fn(F, false); };

    // ---- quay wall + waterfront promenade ----
    {
      const [cx, cz] = W(-1.5, 0);
      both((b) => { b.ground = -1; b.block(cx, -3, cz, hw * 1.8, 5.4, 6, '#9a8f80', M.STONE, rotFace); });
    }
    // ---- piers ----
    const nP = port.size === 'small' ? 1 : 2;
    const piers = [];
    for (let i = 0; i < nP; i++) {
      const b = (nP === 1 ? 0 : (i / (nP - 1) - 0.5) * hw * 1.1) + (rand() - 0.5) * 20;
      const len = 32 + rand() * 18;
      piers.push({ b, len });
      const [cx, cz] = W(-len / 2 - 3, b);
      both((bb, det) => {
        bb.ground = -0.5; bb.aoH = 2.5;
        bb.block(cx, 1.55, cz, 9, 0.35, len + 6, '#9a7a52', M.WOOD, rotFace);          // deck planks
        { const [tx, tz] = W(-len - 3, b); bb.block(tx, 1.55, tz, 24, 0.35, 9, '#94744c', M.WOOD, rotFace); bb.block(tx, 1.0, tz, 24.4, 0.55, 9.4, '#4e3a28', M.WOOD, rotFace);
          if (det) for (const o of [-11, -4, 4, 11]) { const [bx, bz] = W(-len - 7.2, b + o); bb.cyl(bx, 1.7, bz, 0.32, 0.28, 0.8, 7, '#2a2420', M.IRON); }
          for (let o = -11; o <= 11; o += det ? 3 : 6) for (const e of [-1.5, -7.3]) { const [px, pz] = W(-len + e + 1, b + o); const sea = Math.min(-1, this.ground(px, pz)); bb.cyl(px, sea - 0.5, pz, 0.3, 0.26, 2.3 - sea, det ? 6 : 4, '#3e2c1e', M.WOOD); } }
        bb.block(cx, 1.0, cz, 9.4, 0.55, len + 6, '#4e3a28', M.WOOD, rotFace);         // dark fascia beam
        const step = det ? 3 : 9;
        for (let k = 0; k <= len + 2; k += step) for (const s2 of [-4.4, 4.4]) {
          const [px, pz] = W(-k, b + s2);
          const sea = Math.min(-1, this.ground(px, pz));
          bb.cyl(px, sea - 0.5, pz, 0.3, 0.26, 2.4 - sea + (det && k % 10 === 0 ? 0.9 : 0), det ? 6 : 4, '#3e2c1e', M.WOOD);
        }
        if (det) for (let k = 0; k <= len; k += 6) { const [px, pz] = W(-k, b); bb.block(px, 0.3, pz, 9, 0.3, 0.3, '#3e2c1e', M.WOOD, rotFace); }
      });
      // crates & barrels on pier
      for (let k = 0; k < 5; k++) {
        const [px, pz] = W(-8 - rand() * (len - 6), b + (rand() - 0.5) * 6);
        if (rand() < 0.5) B.block(px, 1.72, pz, 1.4, 1.2, 1.4, pick(['#a07a4a', '#8a6038', '#b08a58']), M.WOOD, rand() * 3);
        else B.cyl(px, 1.72, pz, 0.55, 0.55, 1.3, 7, '#7a5232', M.WOOD);
      }
      // lantern post at pier head
      const [hx, hz] = W(-len - 1, b + 3);
      this._lantern(B, hx, 1.72, hz, 3.2);
    }
    port.piers = piers;

    // ---- vessels riding at anchor off the piers: merged static hulls + bare masts and furled yards.
    // From the offing the forest of masts is what says "harbour" before any house can be read.
    {
      const nV = port.size === 'large' ? 6 : port.size === 'medium' ? 4 : 2;
      const spots = [];
      for (let t = 0; t < nV * 12 && spots.length < nV; t++) {
        const a = -(45 + rand() * 110), bq = (rand() - 0.5) * hw * 1.9;
        const [x, z] = W(a, bq);
        if (this.ground(x, z) > -5 || this.ground(x + sx * 20, z + sz * 20) > -4) continue;
        if (!spots.every(o => Math.hypot(o[0] - x, o[1] - z) > 34)) continue;
        if (piers.some(pp => Math.abs(pp.b - bq) < 12 && -a < pp.len + 14)) continue;
        spots.push([x, z]);
      }
      // real procedural ship model (merged static copies, sails furled onto their yards, faction pennants):
      // reads as the same fleet the player sails, not as blocks. Near LOD only; the far LOD keeps bare masts.
      const hulls = [];
      for (const [x, z] of spots) {
        const big = rand() < 0.45;
        const type = big ? pick(['merchantman', 'frigate', 'brig']) : pick(['sloop', 'schooner', 'brig']);
        const parts = getShipStaticParts(type, port.faction);
        const r = rotFace + Math.PI / 2 + (rand() - 0.5) * 0.7;
        // moored hulls sat on the mean surface and read as hovering — sink them to the live ships' waterline
        // (ship.js SINK 0.55 + a little for the swell) with a slight list, and give each a waterline foam skirt
        const mtx = new THREE.Matrix4().makeRotationY(r + Math.PI).premultiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(Math.cos(r), 0, -Math.sin(r)), Math.sin(x * 12.9 + z * 7.1) * 0.02)   /* not rand(): keep the town's RNG stream (layout) unchanged */).setPosition(x, -0.75, z);
        hulls.push(this._shipCopy(parts.hullGeoFar || parts.hullGeo, mtx, parts.spec.length));   // far LOD hull (guns run in, no rails/beads/ratlines, coarse skin)
        if (parts.foamGeo) { const fg = this._shipCopy(parts.foamGeo, new THREE.Matrix4().makeRotationY(r + Math.PI).setPosition(x, -0.2, z)); (port._mooredFoam ||= []).push(fg); }
        this._furledSails(B, parts.sailGeo, mtx);
        const top = parts.tops[Math.min(1, parts.tops.length - 1)];
        if (top) { const tp = top.clone().applyMatrix4(mtx); this.flagData.push({ pos: [tp.x, tp.y + 0.6, tp.z], scale: 0.9 + parts.spec.length * 0.02, flag: FLAG_INDEX[port.faction], port: port.id }); }
        const L = parts.spec.length;
        // far LOD: bare dark masts + hull silhouette (cheap)
        const cs = Math.cos(r), sn = Math.sin(r);
        F.ground = -40; F.block(x, -1.2, z, L * 0.27, 3.6, L * 0.85, '#3a2618', M.WOOD, r);
        for (const m of (big ? [0.28, 0.0, -0.27] : [0.15, -0.18])) F.cyl(x + sn * L * m, 2, z + cs * L * m, 0.42, 0.22, L * 0.95, 4, '#5a4028', M.WOOD);
      }
      port._mooredHulls = hulls;
    }

    // ---- street grid & buildings ----
    const occupied = [];
    const free = (x, z, r) => occupied.every(o => (o[0] - x) ** 2 + (o[1] - z) ** 2 > (o[2] + r) ** 2);
    const place = (x, z, r) => occupied.push([x, z, r]);
    // plaza
    const plazaA = depth * 0.33, plazaB = (rand() - 0.5) * hw * 0.4;
    const [plx, plz] = W(plazaA, plazaB);
    const plY = g(plx, plz);
    both((b) => { b.ground = plY; b.block(plx, plY - 0.6, plz, 34, 0.75, 34, '#b8aa90', M.COBBLE, rotFace); });
    place(plx, plz, 20);
    // plaza: well + market stalls with striped awnings
    B.ground = plY; B.cyl(plx, plY, plz, 1.4, 1.4, 1.0, 12, '#a99c84', M.STONE); B.cyl(plx, plY + 1, plz, 0.1, 0.1, 2.2, 4, '#3a2a1a', M.WOOD); B.block(plx, plY + 3.1, plz, 2.8, 0.25, 0.4, '#3a2a1a', M.WOOD, rotFace);
    for (let k = 0; k < 6; k++) {
      const ang = k / 6 * Math.PI * 2 + 0.3, sx3 = plx + Math.cos(ang) * 10, sz3 = plz + Math.sin(ang) * 10;
      B.block(sx3, plY, sz3, 2.6, 0.9, 1.6, '#7a5a3a', M.WOOD, -ang);
      for (const [ox, oz] of [[-1.2, -0.7], [1.2, -0.7], [-1.2, 0.7], [1.2, 0.7]]) B.cyl(sx3 + ox * Math.cos(-ang) + oz * Math.sin(-ang), plY, sz3 - ox * Math.sin(-ang) + oz * Math.cos(-ang), 0.06, 0.06, 2.3, 4, '#3a2a1a', M.WOOD);
      B.gable(sx3, plY + 2.3, sz3, 2.8, 1.9, 0.5, ['#b8402e', '#e8dcc0', '#3a6a8a', '#d8a040'][k % 4], M.CLOTH, -ang, 0.15);
      for (let c2 = 0; c2 < 3; c2++) B.cyl(sx3 + (rand() - 0.5) * 2, plY + 0.9, sz3 + (rand() - 0.5), 0.25, 0.25, 0.35, 6, ['#c8a050', '#8a4a2a', '#5a7a3a'][c2], M.WOOD);
    }
    // church
    {
      const [cx, cz] = W(plazaA + 30, plazaB);
      const y = g(cx, cz) - 0.5;
      both((b, det) => {
        b.ground = y; b.aoH = 4;
        const wc = port.faction === 'english' || port.faction === 'dutch' ? '#b9b0a0' : '#f2ead8';
        const wm = port.faction === 'english' || port.faction === 'dutch' ? M.STONE : M.PLASTER;
        b.block(cx, y, cz, 14, 13, 28, wc, wm, rotFace);
        b.gable(cx, y + 13, cz, 28, 14, 6, pick(st.roof), st.roofMat, rotFace + Math.PI / 2, 0.6, wc, wm);
        if (det) for (let k = -2; k <= 2; k++) for (const sd of [-1, 1]) {
          const [bx, bz] = W(plazaA + 30 + k * 5.5, plazaB + sd * 7.4);
          b.block(bx, y, bz, 1.2, 9, 1.4, wc, wm, rotFace);
          b.block(bx, y + 4, bz - 0.0, 1.0, 1.4, 0.15, '#1c2430', M.WINDOW, rotFace + Math.PI / 2);
        }
        if (det) { const [rx3, rz3] = W(plazaA + 42, plazaB); b.cyl(rx3, y, rz3, 6.5, 6.5, 11, 10, wc, wm); b.dome(rx3, y + 11, rz3, 6.6, pick(st.roof), st.roofMat, 10); }
        const [tx, tz] = W(plazaA + 16, plazaB + 5);
        b.block(tx, y, tz, 7, 24, 7, wc, wm, rotFace);
        if (port.faction === 'spanish' || port.faction === 'french') { b.block(tx, y + 24, tz, 5.2, 5, 5.2, wc, wm, rotFace); b.dome(tx, y + 29, tz, 3, '#c0623a', M.TILE, det ? 10 : 6); }
        else b.spire(tx, y + 24, tz, 5, 12, 4, '#4a5260', M.SLATE, rotFace + Math.PI / 4);
        if (det) { const [dx, dz] = W(plazaA + 15.9, plazaB); b.block(dx, y, dz, 3, 5, 0.3, '#3a2616', M.DARK, rotFace); b.block(tx - sx * 3.6, y + 18, tz - sz * 3.6, 2, 3, 0.3, '#2a1a10', M.DARK, rotFace); }
      });
      place(cx, cz, 18);
    }
    // governor's mansion at the back
    {
      const [cx, cz] = W(depth * 0.72, -plazaB * 0.5);
      const y = g(cx, cz) - 0.4;
      both((b, det) => {
        b.ground = y; b.aoH = 4;
        const wc = port.faction === 'english' ? '#e6dccb' : '#f3ead8';
        b.block(cx, y, cz, 26, 11, 15, wc, M.PLASTER, rotFace);
        b.hip(cx, y + 11, cz, 26, 15, 5, pick(st.roof), st.roofMat, rotFace, 0.8);
        if (det) {
          for (let k = -2; k <= 2; k++) {
            const [cx2, cz2] = W(depth * 0.72 - 8.2, -plazaB * 0.5 + k * 4.6);
            b.cyl(cx2, y, cz2, 0.45, 0.4, 9, 8, '#f6f0e2', M.PLASTER);
            for (const fl of [2.5, 7]) b.block(cx2 - lx * 0 + sx * 0.05, y + fl, cz2 + sz * 0.05, 1.3, 2, 0.15, '#2a3a4a', M.WINDOW, rotFace);
          }
          const [px, pz] = W(depth * 0.72 - 8.6, -plazaB * 0.5);
          b.block(px, y + 9, pz, 22, 0.6, 3, '#f6f0e2', M.PLASTER, rotFace);
        }
      });
      const [fx, fz] = W(depth * 0.72, -plazaB * 0.5);
      this.flagData.push({ pos: [fx, g(fx, fz) + 22, fz], scale: 1.2, flag: FLAG_INDEX[port.faction], pole: true, port: port.id });
      B.cyl(fx, g(fx, fz) + 15, fz, 0.12, 0.08, 9, 5, '#3a2a1a', M.WOOD);
      place(cx, cz, 18);
    }
    // warehouses along the waterfront
    for (let i = 0; i < (port.size === 'small' ? 2 : 4); i++) {
      const b0 = (rand() - 0.5) * hw * 1.6, a0 = 14 + rand() * 6;
      const [cx, cz] = W(a0, b0);
      if (!free(cx, cz, 13)) continue;
      const y = g(cx, cz) - 0.4, L = 18 + rand() * 8, D = 10;
      both((b, det) => {
        b.ground = y; b.aoH = 3;
        b.block(cx, y, cz, L, 7, D, pick(['#8a6a48', '#9a7a52', '#a99a82']), port.faction === 'pirate' ? M.WOOD : M.STONE, rotFace);
        b.gable(cx, y + 7, cz, L, D, 3.4, pick(st.roof), st.roofMat, rotFace, 0.5, '#8a6a48', M.WOOD);
        if (det) { const [dx, dz] = W(a0 - D / 2 - 0.05, b0); b.block(dx, y, dz, 4, 4.5, 0.2, '#3a2616', M.DARK, rotFace); }
      });
      place(cx, cz, 13);
      // crates outside
      for (let k = 0; k < 4; k++) { const [px, pz] = W(a0 - 8 - rand() * 3, b0 + (rand() - 0.5) * L); B.block(px, g(px, pz) - 0.1, pz, 1.4, 1.2, 1.4, '#a07a4a', M.WOOD, rand() * 3); }
    }
    // houses along streets
    const nH = port.size === 'large' ? 185 : port.size === 'medium' ? 120 : 65;   // denser: towns read as a packed hillside of roofs from the offing
    let tries = 0, built = 0;
    const streetsA = [], streetsB = [];
    for (let a = 30; a < depth * 0.95; a += 26 + rand() * 6) streetsA.push(a);
    for (let b = -hw; b <= hw; b += 30 + rand() * 8) streetsB.push(b);
    while (built < nH && tries++ < nH * 30) {
      let a, b, rot = rotFace;
      if (rand() < 0.6) { a = pick(streetsA) + (rand() < 0.5 ? -8 : 8); b = (rand() - 0.5) * 2 * hw * 0.95; }
      else { b = pick(streetsB) + (rand() < 0.5 ? -8 : 8); a = 25 + rand() * depth * 0.9; rot = rotFace + Math.PI / 2; }
      // round-ish town edge
      const e = Math.hypot(b / hw, (a - depth * 0.45) / (depth * 0.55));
      if (e > 1 + rand() * 0.15) continue;
      const [cx, cz] = W(a, b);
      const w0 = 7 + rand() * 6, d0 = 6 + rand() * 4;
      const r = Math.max(w0, d0) * 0.5;
      if (!free(cx, cz, r)) continue;
      // reject steep sites
      const hs = [g(cx - 4, cz), g(cx + 4, cz), g(cx, cz - 4), g(cx, cz + 4)];
      const lo = Math.min(...hs), hi = Math.max(...hs);
      if (hi - lo > 8.5 || lo < 0.8) continue;   // terraced up the slope: towns climb the hillside instead of a single waterfront row
      place(cx, cz, r);
      built++;
      // 1-3 storeys (taller near the plaza / waterfront), per-house tint jitter, arcades and balconies
      const fr = rand(), big3 = port.size === 'large' ? 0.22 : port.size === 'medium' ? 0.12 : 0.04;
      const floors = fr < big3 * (a < depth * 0.5 ? 1.6 : 0.6) ? 3 : fr < (port.size === 'large' ? 0.62 : 0.45) ? 2 : 1;
      const wallH = floors * 3.6 + 0.8;
      const y = lo - 0.6;
      const wcol = new THREE.Color(pick(st.wall)); wcol.offsetHSL((rand() - 0.5) * 0.04, (rand() - 0.5) * 0.12, (rand() - 0.5) * 0.1);
      const wc = '#' + wcol.getHexString(), rc = pick(st.roof), trim = st.trims ? pick(st.trims) : st.trim;
      const arcade = port.faction !== 'pirate' && floors >= 2 && a < depth * 0.55 && rand() < (port.faction === 'english' ? 0.2 : 0.45);
      const pitch = st.pitch * (0.85 + rand() * 0.3);
      const Lshape = rand() < 0.3;
      both((bb, det) => {
        bb.ground = y + 0.6; bb.aoH = 2.5;
        bb.block(cx, y, cz, w0, wallH + 0.6, d0, wc, st.wallMat, rot);
        if (det) {
          // darker weathered lower wall (splash/dirt band) + plinth, and a dark eave-shadow band under the roof overhang
          const dk = '#' + new THREE.Color(wc).multiplyScalar(0.68).getHexString();
          bb.block(cx, y, cz, w0 + 0.12, 2.0, d0 + 0.12, dk, st.wallMat, rot);
          bb.block(cx, y, cz, w0 + 0.3, 1.0, d0 + 0.3, '#7a6c58', M.STONE, rot);
          bb.block(cx, y + wallH + 0.1, cz, w0 + 1.7, 0.18, d0 + 1.7, '#2a1e16', M.DARK, rot);
          bb.block(cx, y + wallH - 0.4, cz, w0 + 0.08, 0.9, d0 + 0.08, '#' + new THREE.Color(wc).multiplyScalar(0.55).getHexString(), st.wallMat, rot);
        }
        if (Lshape) { const ox = cx + Math.cos(rot) * (w0 * 0.3) - Math.sin(rot) * (d0 * 0.75), oz = cz - Math.sin(rot) * (w0 * 0.3) - Math.cos(rot) * (d0 * 0.75);
          bb.block(ox, y, oz, w0 * 0.4, wallH - 1.2, d0 * 0.6, wc, st.wallMat, rot);
          bb.gable(ox, y + wallH - 1.2, oz, d0 * 0.6, w0 * 0.4, w0 * 0.2 * pitch, rc, st.roofMat, rot + Math.PI / 2, 0.35, wc, st.wallMat); }
        const ry = y + wallH + 0.6;
        if (st.roofKind === 'hip' || rand() < 0.15) bb.hip(cx, ry, cz, w0, d0, d0 * 0.5 * pitch, rc, st.roofMat, rot, det ? 0.95 : 0.6);
        else if (port.faction === 'dutch' && det) {
          // stepped Dutch gable facing the street
          bb.gable(cx, ry, cz, d0, w0, w0 * 0.5 * pitch, rc, st.roofMat, rot + Math.PI / 2, 0.3, wc, st.wallMat);
          for (let s = 0; s < 3; s++) bb.block(cx + Math.sin(rot) * (d0 / 2), ry + s * 1.2, cz + Math.cos(rot) * (d0 / 2), w0 * (0.9 - s * 0.28), 1.2, 0.4, wc, st.wallMat, rot);
        } else bb.gable(cx, ry, cz, w0, d0, d0 * 0.5 * pitch, rc, st.roofMat, rot, det ? 0.95 : 0.6, wc, st.wallMat);
        if (det) {
          const fs = Math.sin(rot), fc = Math.cos(rot);
          // windows & door on both long faces
          for (const side of [1, -1]) {
            const ox = fs * (d0 / 2 + 0.06) * side, oz = fc * (d0 / 2 + 0.06) * side;
            const nWin = Math.max(1, Math.floor(w0 / 2.8));
            for (let f = 0; f < floors; f++) for (let k = 0; k < nWin; k++) {
              const t = (k + 0.5) / nWin - 0.5;
              const px = cx + ox + Math.cos(rot) * t * w0 * 0.8, pz = cz + oz - Math.sin(rot) * t * w0 * 0.8;
              if (f === 0 && k === (nWin >> 1) && side === 1) { bb.block(px, y + 0.6, pz, 1.5, 2.6, 0.16, trim, M.WOOD, rot); continue; }
              bb.block(px, y + 1.7 + f * 3.6, pz, 1.2, 1.8, 0.14, '#1c2430', M.WINDOW, rot);
              if (port.faction !== 'pirate') { bb.block(px - Math.cos(rot) * 0.95, y + 1.7 + f * 3.6, pz + Math.sin(rot) * 0.95, 0.6, 1.9, 0.18, trim, M.WOOD, rot); bb.block(px + Math.cos(rot) * 0.95, y + 1.7 + f * 3.6, pz - Math.sin(rot) * 0.95, 0.6, 1.9, 0.18, trim, M.WOOD, rot); }
            }
          }
          if (floors >= 2 && port.faction !== 'pirate' && rand() < (port.faction === 'english' ? 0.3 : 0.7)) {
            // balcony on an upper floor: deck, rail, posts (wooden galleries for English/Dutch, iron for the others)
            const fl = 1 + Math.floor(rand() * (floors - 1));
            const bx = cx + fs * (d0 / 2 + 0.7), bz = cz + fc * (d0 / 2 + 0.7), by = y + 0.7 + fl * 3.6;
            const wood = port.faction === 'english' || port.faction === 'dutch';
            const bw = w0 * (0.45 + rand() * 0.4);
            bb.block(bx, by, bz, bw, 0.25, 1.4, '#5a3a22', M.WOOD, rot);
            bb.block(bx + fs * 0.62, by + 0.25, bz + fc * 0.62, bw, 0.9, 0.1, wood ? trim : '#2a221c', wood ? M.WOOD : M.IRON, rot);
            for (const e2 of [-0.5, 0.5]) bb.block(bx + fs * 0.62 + Math.cos(rot) * e2 * bw, by - 0.5, bz + fc * 0.62 - Math.sin(rot) * e2 * bw, 0.14, 0.5, 0.14, '#3a2a1a', M.WOOD, rot);
          }
          if (arcade) {
            // ground-floor arcade: a row of piers carrying the upper storeys' front + a shaded slab behind
            const ax2 = cx + fs * (d0 / 2 + 1.3), az2 = cz + fc * (d0 / 2 + 1.3);
            const nP = Math.max(3, Math.round(w0 / 2.6));
            for (let k = 0; k <= nP; k++) {
              const t = k / nP - 0.5;
              bb.block(ax2 + Math.cos(rot) * t * w0 * 0.96, y + 0.6, az2 - Math.sin(rot) * t * w0 * 0.96, 0.55, 3.0, 0.55, '#' + wcol.clone().multiplyScalar(0.92).getHexString(), st.wallMat, rot);
            }
            bb.block(ax2, y + 3.6, az2, w0 + 0.3, 0.75, 0.75, wc, st.wallMat, rot);
            bb.block(ax2 - fs * 0.9, y + 0.6, az2 - fc * 0.9, w0 * 0.98, 3.2, 0.1, '#1e1812', M.DARK, rot);
            bb.block(ax2 - fs * 0.5, y + 4.25, az2 - fc * 0.5, w0 + 0.3, 0.12, 1.9, rc, st.roofMat, rot);
          }
          // corner trim / quoins
          for (const sx2 of [-1, 1]) for (const sz2 of [-1, 1]) {
            const ox = cx + Math.cos(rot) * sx2 * (w0 / 2) + Math.sin(rot) * sz2 * (d0 / 2), oz = cz - Math.sin(rot) * sx2 * (w0 / 2) + Math.cos(rot) * sz2 * (d0 / 2);
            bb.block(ox, y + 0.6, oz, 0.45, wallH, 0.45, port.faction === 'english' || port.faction === 'pirate' ? '#4a3424' : '#d8ccb4', port.faction === 'english' || port.faction === 'pirate' ? M.WOOD : M.STONE, rot);
          }
          // eaves cornice band
          bb.block(cx, y + wallH + 0.25, cz, w0 + 0.25, 0.35, d0 + 0.25, port.faction === 'spanish' ? '#f2ead8' : trim, port.faction === 'spanish' ? M.PLASTER : M.WOOD, rot);
          if ((port.faction !== 'spanish' && rand() < 0.75) || rand() < 0.2) {
            const off = (rand() - 0.5) * w0 * 0.6;
            bb.block(cx + Math.cos(rot) * off, y + wallH, cz - Math.sin(rot) * off, 0.9, d0 * 0.5 * pitch + 2.4, 0.9, '#8a5a44', M.BRICK, rot);
            bb.block(cx + Math.cos(rot) * off, y + wallH + d0 * 0.5 * pitch + 2.4, cz - Math.sin(rot) * off, 1.15, 0.3, 1.15, '#6a5a4a', M.STONE, rot);
            (port._chimneys ||= []).push([cx + Math.cos(rot) * off, y + wallH + d0 * 0.5 * pitch + 2.8, cz - Math.sin(rot) * off]);
          }
        }
      });
    }
    // planted greenery inside the town (instanced by the vegetation system): palms along the waterfront promenade,
    // a ring round the plaza, and palms / shrubs in the gaps between houses and around the town edge
    {
      const palms = this.plantPalms ||= [], bushes = this.plantBushes ||= [];
      const palm = (x, z, s = 1) => { const y = g(x, z); if (y < 0.6) return; palms.push([x, y - 0.2, z, rand() * 6.28, (0.95 + rand() * 0.5) * s, 0, rand(), Math.floor(rand() * 3)]); place(x, z, 2.5); };
      for (let b = -hw * 0.95; b <= hw * 0.95; b += 11 + rand() * 9) { const [x, z] = W(5 + rand() * 4, b); if (free(x, z, 2.2)) palm(x, z); }
      for (let k = 0; k < 8; k++) { const ang = k / 8 * Math.PI * 2 + 0.2, x = plx + Math.cos(ang) * 18.5, z = plz + Math.sin(ang) * 18.5; if (free(x, z, 1.5)) palm(x, z, 0.9); }
      for (let t2 = 0; t2 < 260; t2++) {
        const a = 18 + rand() * depth * 1.05, b = (rand() - 0.5) * 2 * hw * 1.1, e = Math.hypot(b / hw, (a - depth * 0.45) / (depth * 0.55));
        if (e > 1.2) continue;
        const [x, z] = W(a, b); if (!free(x, z, 2.6)) continue;
        const y = g(x, z); if (y < 0.8) continue;
        if (rand() < 0.55 || e > 0.95) palm(x, z);
        else { bushes.push([x, y - 0.1, z, rand() * 6.28, 0.9 + rand() * 0.8, 0, rand(), 0]); place(x, z, 1.8); }
      }
    }
    // lanterns around the plaza and along the waterfront
    for (let k = 0; k < 4; k++) { const ang = k / 4 * Math.PI * 2 + 0.6; this._lantern(B, plx + Math.cos(ang) * 15, plY, plz + Math.sin(ang) * 15, 3.4); }
    for (let k = -2; k <= 2; k++) { const [x, z] = W(2.5, k * hw * 0.38); this._lantern(B, x, Math.max(2, g(x, z)), z, 3.2); }

    // boats pulled up on the sand either side of the quay, with drying nets (merged, no extra draw calls)
    // search the shore either side of the quay for real sand (0.15-3 m, sloping down to the sea), keep spaced picks
    const sandSpots = [];
    for (let bq = hw * 0.75; bq < hw * 2.2 && sandSpots.length < 10; bq += 7) for (const sd of [-1, 1]) for (let aq = 12; aq > -25; aq -= 2) {
      const [x, z] = W(aq, sd * bq), y = g(x, z);
      if (y < 0.15 || y > 3) continue;
      const [x2, z2] = W(aq - 6, sd * bq);
      if (g(x2, z2) > y - 0.2) continue;                       // must slope toward the water
      if (this.islands.excluded?.(x, z)) break;
      if (sandSpots.every(s2 => Math.hypot(s2[0] - x, s2[1] - z) > 9) && free(x, z, 3)) sandSpots.push([x, z]);
      break;
    }
    for (let k = 0; k < Math.min(10, sandSpots.length); k++) {
      const [x, z] = sandSpots[k]; const y = g(x, z);
      const r = rotFace + (rand() - 0.5) * 1.2, cs = Math.cos(r), sn = Math.sin(r), tilt = (rand() - 0.5) * 0.3;
      const hull = pick(['#c8442e', '#2e6a8a', '#e8dcc0', '#3e7a4a', '#d8a040']);
      B.ground = y; B.aoH = 0.8;
      B.block(x, y - 0.15, z, 1.2, 0.5, 4.6, '#3a2a1c', M.WOOD, r);
      B.block(x, y + 0.2, z, 1.7, 0.55, 4.2, hull, M.WOOD, r);
      B.block(x, y + 0.72, z, 1.8, 0.12, 4.3, '#d8c8a4', M.WOOD, r);
      B.block(x, y + 0.45, z, 1.3, 0.3, 3.6, '#3a2818', M.DARK, r);
      B.spire(x + sn * 2.5, y + 0.1, z + cs * 2.5, 0.8, 0.85, 4, hull, M.WOOD, r + Math.PI / 4);
      B.block(x + sn * 0.6, y + 0.55, z + cs * 0.6, 1.6, 0.12, 0.35, '#8a6a48', M.WOOD, r);
      if (rand() < 0.6) { const ox = x + cs * 2.2, oz = z - sn * 2.2; B.block(ox, y + 0.05, oz, 0.25, 0.08, 3.2, '#b09a72', M.WOOD, r + 0.4 + tilt); }
      if (rand() < 0.5) { const nx = x - cs * 4, nz = z + sn * 4; const ny = g(nx, nz);
        B.cyl(nx - sn * 2, ny, nz - cs * 2, 0.08, 0.07, 2.2, 4, '#3a2a1a', M.WOOD); B.cyl(nx + sn * 2, ny, nz + cs * 2, 0.08, 0.07, 2.2, 4, '#3a2a1a', M.WOOD);
        B.gable(nx, ny + 1.0, nz, 0.4, 4.0, 1.1, '#6a6450', M.CLOTH, r, 0); }
    }
    // ---- fort ----
    this._buildFort(B, F, port, st, rand);

    // near town: split into TOWN_CHUNK_M cells rather than a single merged mesh (see the comment of buildChunks()
    // in builder.js) — same rendering, but the shadow map can skip the cells outside its box instead of
    // rasterising the whole town as soon as one cell enters it.
    const chunkGeos = B.buildChunks(TOWN_CHUNK_M), geoF = F.build();
    const oc = port.townCenter; for (const cg of chunkGeos) cg.translate(-oc.x, 0, -oc.z); geoF.translate(-oc.x, 0, -oc.z);
    const near = new THREE.Group();
    for (const cg of chunkGeos) { const cm = new THREE.Mesh(cg, this.material); cm.castShadow = cm.receiveShadow = true; cm.userData.chunk = true; near.add(cm); }
    const far = new THREE.Mesh(geoF, this.material); far.receiveShadow = true;
    const lod = new THREE.LOD();
    lod.addLevel(near, 0); lod.addLevel(far, 1500);
    lod.position.set(port.townCenter.x, 0, port.townCenter.z);
    lod.autoUpdate = true;
    if (port._mooredHulls?.length) {
      const hg = mergeGeometries(port._mooredHulls, false); port._mooredHulls.forEach(g2 => g2.dispose()); delete port._mooredHulls;
      if (hg) { hg.translate(-oc.x, 0, -oc.z); hg.computeBoundingSphere();
        const hm = new THREE.Mesh(hg, this.hullMat ||= makeHullMaterial()); hm.castShadow = false; hm.receiveShadow = true;   // the merged moored hulls span the harbour (r ~300 m) and drew whole into every shadow map (~90 k tris at Havana) for shadows rarely inside the ±90 m shadow box
        hm.customDepthMaterial = this.hullMat.userData.depth; near.add(hm); }
    }
    if (port._mooredFoam?.length) {
      const fg = mergeGeometries(port._mooredFoam, false); port._mooredFoam.forEach(g2 => g2.dispose()); delete port._mooredFoam;
      if (fg) { fg.translate(-oc.x, 0, -oc.z); fg.computeBoundingSphere();
        const fm = new THREE.Mesh(fg, this.mooredFoamMat ||= makeFoamMaterial()); fm.renderOrder = 2; near.add(fm); }
    }
    this.game.scene.add(lod);
    return { port, lod, near, far, tris: B.triCount };
  }

  // transformed copy of a cached ship hull geometry (non-indexed, attribute set kept for the hull material)
  _shipCopy(src, mtx, L = 0) {
    const g = src.index ? src.toNonIndexed() : src.clone();
    if (L) {
      // in harbour the jibboom is run in — compress everything forward of the stem (bowsprit, jibboom and the
      // stays/bowlines ending there) so the headstays no longer reach across the quay. Endpoints move together, so the
      // rope segments stay attached and straight.
      const P = g.attributes.position, z0 = -L * 0.55;
      for (let i = 0; i < P.count; i++) { const z = P.getZ(i); if (z < z0) P.setZ(i, z0 + (z - z0) * 0.45); }
      P.needsUpdate = true;
    }
    g.applyMatrix4(mtx);
    return g;
  }
  // sail cloth baked in its furled state (as the sail shader does at uSet = 0): every vertex gathered onto its
  // yard/boom anchor with a small roll radius -> tight cream bundles along the yards, merged into the town mesh.
  _furledSails(B, sg, mtx) {
    const P = sg.attributes.aAnchor, S = sg.attributes.aSail, idx = sg.index;
    if (!P || !S) return;
    const v = new THREE.Vector3();
    const vert = (i) => {
      const fu = S.getX(i), fv = S.getY(i), kind = S.getW(i), ang = fv * 23 + fu * 3;
      const rr = 0.2 * (1 - 0.5 * fv) * (0.6 + 0.4 * Math.sin(fu * Math.PI));
      const ax = kind < 0.5 ? [0, 1, 0] : [1, 0, 0], bx = kind < 0.5 ? [0, 0, 1] : [0, 1, 0];
      v.set(P.getX(i) + (ax[0] * Math.cos(ang) + bx[0] * Math.sin(ang)) * rr,
        P.getY(i) + (ax[1] * Math.cos(ang) + bx[1] * Math.sin(ang)) * rr + (kind < 0.5 ? 0.16 : 0),
        P.getZ(i) + (ax[2] * Math.cos(ang) + bx[2] * Math.sin(ang)) * rr).applyMatrix4(mtx);
      return [v.x, v.y, v.z];
    };
    const n = idx ? idx.count : P.count;
    B.ground = -40; B.aoH = 1;
    for (let k = 0; k < n; k += 3) {
      const a = idx ? idx.getX(k) : k, b = idx ? idx.getX(k + 1) : k + 1, c = idx ? idx.getX(k + 2) : k + 2;
      B.tri(vert(a), vert(b), vert(c), '#e6dcc2', M.CLOTH);
    }
  }

  _lantern(B, x, y, z, h) {
    B.ground = y; B.aoH = 0.01;
    B.cyl(x, y, z, 0.1, 0.08, h, 5, '#2a2018', M.IRON);
    B.block(x, y + h, z, 0.55, 0.7, 0.55, '#ffd890', M.LAMP);
    B.spire(x, y + h + 0.7, z, 0.45, 0.4, 4, '#2a2018', M.IRON);
    (this.lampPos ||= []).push([x, y + h + 0.35, z]);
  }

  _buildFort(B, F, port, st, rand) {
    const f = port.fort, sx = port.seaward.x, sz = port.seaward.z;
    const rot = Math.atan2(sx, sz);
    const R = 30, y = f.y - 0.5, wallH = 9;
    const stone = port.faction === 'pirate' ? '#6e6252' : '#8a7e6a';
    const both = (fn) => { fn(B, true); fn(F, false); };
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const L = (a, b) => [f.x + a * cs + b * sn, f.z - a * sn + b * cs];
    both((b, det) => {
      b.ground = y - 3; b.aoH = 6;
      // outer walls (square with 4 bastions), battered base
      const walls = [[0, R, 2 * R, 3], [0, -R, 2 * R, 3], [R, 0, 3, 2 * R], [-R, 0, 3, 2 * R]];
      for (const [a, c, wx, wz] of walls) {
        const [x, z] = L(a, c);
        b.block(x, y - 6, z, wx + 1.6, 6, wz + 1.6, '#958a78', M.STONE, rot);
        if (det) {
          // battered glacis: sloped apron around the base
          const ext = 7, cs2 = Math.cos(rot), sn2 = Math.sin(rot);
          const ux = a !== 0 ? Math.sign(a) : 0, uz = c !== 0 ? Math.sign(c) : 0;      // outward axis (local)
          const L2 = (la, lc, yy) => [f.x + la * cs2 + lc * sn2, yy, f.z - la * sn2 + lc * cs2];
          const half = (ux ? wz : wx) / 2 + 1;
          const p0 = ux ? [a + ux * 0.8, -half] : [-half, c + uz * 0.8], p1 = ux ? [a + ux * 0.8, half] : [half, c + uz * 0.8];
          const q0 = ux ? [a + ux * (0.8 + ext), -half - ext] : [-half - ext, c + uz * (0.8 + ext)], q1 = ux ? [a + ux * (0.8 + ext), half + ext] : [half + ext, c + uz * (0.8 + ext)];
          const A0 = L2(p0[0], p0[1], y + 0.5), A1 = L2(p1[0], p1[1], y + 0.5), B0 = L2(q0[0], q0[1], y - 5), B1 = L2(q1[0], q1[1], y - 5);
          if ((ux || uz) > 0) b.quad(A0, B0, B1, A1, '#9c9078', M.STONE); else b.quad(A0, A1, B1, B0, '#9c9078', M.STONE);
          // string course (torus moulding) just below the parapet
          b.block(x, y + wallH - 2.2, z, wx + 0.6, 0.45, wz + 0.6, '#cfc3a8', M.STONE, rot);
        }
        b.block(x, y, z, wx, wallH, wz, stone, M.STONE, rot);
        b.block(x, y + wallH - 0.5, z, wx + 0.5, 0.5, wz + 0.5, '#d6ccb4', M.STONE, rot);
        b.block(x, y - 6, z, wx + 1.8, 2.2, wz + 1.8, '#5d6a48', M.STONE, rot);
      }
      // bastions at corners (diamond)
      for (const [a, c] of [[R, R], [R, -R], [-R, R], [-R, -R]]) {
        const [x, z] = L(a, c);
        b.block(x, y - 6, z, 13, 6 + wallH + 1, 13, stone, M.STONE, rot + Math.PI / 4);
        if (det) for (let k = 0; k < 8; k++) {
          const ang = rot + Math.PI / 4 + k / 8 * Math.PI * 2;
          if (k % 2 === 0) b.block(x + Math.cos(ang) * 6.3, y + wallH + 1, z + Math.sin(ang) * 6.3, 1.0, 1.0, 0.8, stone, M.STONE, -ang);
        }
        // sentry box
        if (det) { const [ox, oz] = L(a * 1.2, c * 1.2); b.cyl(ox, y + wallH, oz, 1.1, 1.1, 2.6, 8, stone, M.STONE); b.dome(ox, y + wallH + 2.6, oz, 1.2, stone, M.STONE, 8); }
      }
      // crenellations on the walls
      if (det) for (const [a, c, alongA] of [[0, R, true], [0, -R, true], [R, 0, false], [-R, 0, false]]) {
        for (let t = -R + 6; t <= R - 6; t += 2.2) {
          const [x, z] = alongA ? L(t, c + Math.sign(c) * 1.1) : L(a + Math.sign(a) * 1.1, t);
          b.block(x, y + wallH, z, alongA ? 1.1 : 0.8, 1.1, alongA ? 0.8 : 1.1, stone, M.STONE, rot);
        }
      }
      if (det) for (const [a, c, wx, wz] of walls) { const [x, z] = L(a * 0.9, c * 0.9); b.block(x, y + wallH - 2.4, z, wx === 3 ? 4 : wx - 4, 0.4, wz === 3 ? 4 : wz - 4, '#8a7e6a', M.STONE, rot); }
      // gun embrasures: dark splayed ports on every curtain wall's outer face, under the parapet
      if (det) for (const [a, c, alongA] of [[0, R, true], [0, -R, true], [R, 0, false], [-R, 0, false]]) {
        for (let t = -R + 9; t <= R - 9; t += 7) {
          const [x, z] = alongA ? L(t, c + Math.sign(c) * 1.62) : L(a + Math.sign(a) * 1.62, t);
          b.block(x, y + wallH - 3.6, z, alongA ? 1.6 : 0.12, 1.3, alongA ? 0.12 : 1.6, '#1e1a16', M.DARK, rot);
          const [x2, z2] = alongA ? L(t, c + Math.sign(c) * 1.7) : L(a + Math.sign(a) * 1.7, t);
          b.block(x2, y + wallH - 3.85, z2, alongA ? 2.4 : 0.14, 0.25, alongA ? 0.14 : 2.4, '#d6ccb4', M.STONE, rot);
        }
      }
      // keep / barracks
      const [kx, kz] = L(-6, -8);
      b.block(kx, y, kz, 18, 13, 12, '#b8ad98', M.STONE, rot);
      b.hip(kx, y + 13, kz, 18, 12, 4, port.faction === 'pirate' ? '#8c7448' : st.roof[0], st.roofMat, rot, 0.4);
      // tower
      const [tx, tz] = L(8, -10);
      b.cyl(tx, y, tz, 5, 4.5, 18, det ? 12 : 6, stone, M.STONE);
      if (det) for (let k = 0; k < 10; k++) { const ang = k / 10 * Math.PI * 2; b.block(tx + Math.cos(ang) * 4.6, y + 18, tz + Math.sin(ang) * 4.6, 1.3, 1.3, 1.3, stone, M.STONE, -ang); }
      // parade ground
      b.block(f.x, y, f.z, 2 * R - 2, 0.4, 2 * R - 2, '#a99c84', M.COBBLE, rot);
      // cannons on seaward wall
      if (det) for (let k = -3; k <= 3; k++) {
        const [cx, cz] = L(k * 7, R - 2.5);
        // carriage: two cheeks + axles + four wheels, barrel through an embrasure
        const fx2 = sn, fz2 = cs, rx2 = cs, rz2 = -sn;
        for (const sd of [-0.45, 0.45]) b.block(cx + rx2 * sd, y + wallH - 1.6, cz + rz2 * sd, 0.18, 0.75, 2.2, '#5a3e28', M.WOOD, rot);
        for (const fw of [-0.7, 0.7]) for (const sd of [-0.62, 0.62]) b.cyl(cx + rx2 * sd + fx2 * fw, y + wallH - 1.95, cz + rz2 * sd + fz2 * fw, 0.32, 0.32, 0.16, 8, '#3a2a1c', M.WOOD, 0, rot, Math.PI / 2);
        b.cyl(cx + fx2 * 0.9, y + wallH - 1.05, cz + fz2 * 0.9, 0.3, 0.19, 3.0, 10, '#222326', M.IRON, Math.PI / 2 - 0.06, rot, 0);
        b.dome(cx - fx2 * 0.55, y + wallH - 1.05, cz - fz2 * 0.55, 0.3, '#222326', M.IRON, 6);
      }
    });
    // flag on tower
    const [tx, tz] = L(8, -10);
    B.cyl(tx, y + 18, tz, 0.16, 0.1, 12, 5, '#3a2a1a', M.WOOD);
    this.flagData.push({ pos: [tx, y + 29.5, tz], scale: 2.2, flag: FLAG_INDEX[port.faction], port: port.id });
    this._lantern(B, ...L(-R + 3, R - 3).flatMap((v, i) => i === 0 ? [v, y + wallH] : [v]), 2.2);
  }

  _buildFlags() {
    const n = this.flagData.length;
    const base = new THREE.PlaneGeometry(1, 0.62, 12, 4);
    base.translate(0.5, -0.31, 0);
    const parts = [];
    const aFlag = [], aPhase = [];
    for (const f of this.flagData) {
      const g = base.clone();
      g.scale(f.scale * 3, f.scale * 3, 1);
      g.translate(...f.pos);
      parts.push(g);
      f.v0 = aFlag.length; f.vn = g.attributes.position.count;   // vertex range, for setPortFaction()
      for (let i = 0; i < g.attributes.position.count; i++) { aFlag.push(f.flag); aPhase.push(f.pos[0] * 0.13); }
    }
    if (!n) return;
    // merge manually
    let total = 0; for (const p of parts) total += p.attributes.position.count;
    const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), uv = new Float32Array(total * 2), idx = [];
    let o = 0;
    for (const p of parts) {
      pos.set(p.attributes.position.array, o * 3); nrm.set(p.attributes.normal.array, o * 3); uv.set(p.attributes.uv.array, o * 2);
      for (const i of p.index.array) idx.push(i + o);
      o += p.attributes.position.count;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aFlag', new THREE.Float32BufferAttribute(aFlag, 1));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(aPhase, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = this.flagMesh = new THREE.Mesh(g, this.flagMat);
    m.frustumCulled = false; m.castShadow = true;
    this.game.scene.add(m);
  }

  // A conquered town hoists its new nation's colours: rewrite the atlas index of every flag of that port (fort tower,
  // plaza pole, pennants of the moored ships). The buildings keep their style: the town changed hands, not builders.
  setPortFaction(port) {
    const a = this.flagMesh?.geometry.getAttribute('aFlag'), id = FLAG_INDEX[port?.faction];
    if (!a || id == null) return 0;
    let n = 0;
    for (const f of this.flagData) {
      if (f.port !== port.id || f.vn == null || f.flag === id) continue;
      f.flag = id; n++;
      for (let i = 0; i < f.vn; i++) a.array[f.v0 + i] = id;
    }
    if (n) a.needsUpdate = true;
    return n;
  }

  update(dt, t) {
    this.flagMat.userData.uniforms.uTime.value = t;
    const tod = this.game.sky?.timeOfDay ?? 12;
    const night = tod < 6.3 || tod > 18.6 ? 1 : tod < 7 ? (7 - tod) / 0.7 : tod > 17.8 ? (tod - 17.8) / 0.8 : 0;
    this.material.userData.uniforms.uNight.value = Math.min(1, Math.max(0, night));
    this.life?.update(dt, t, night);
    if (this.glowU) { this.glowU.uNight.value = Math.min(1, Math.max(0, night)); this.glowMesh.visible = night > 0.01; }
    // flags orient to the wind (whole mesh shares one direction; fine for readability)
    const w = this.game.wind;
    if (w && this.flagMesh) { /* flags are world-baked; wind direction affects only phase speed */ }
  }
}
