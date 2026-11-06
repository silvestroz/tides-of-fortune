// buildShipModel(type, { faction, seed, name, sailSetting?, jack? }) -> ShipModel   (jack: false = no bow jack)
//   type: 'sloop' | 'schooner' | 'brig' | 'frigate' | 'galleon' | 'merchantman'
// ShipModel:
//   group        THREE.Group, origin at waterline centre, bow pointing -Z, +Y up
//   length, beam, draft   metres
//   cannonPorts  { port: [THREE.Object3D], starboard: [THREE.Object3D] }  muzzle anchors (local); port = left (-X), starboard = right (+X)
//   mastTops     [THREE.Object3D]   (for lookout cameras / smoke anchors)
//   update(dt, t, { sailSetting 0..1, windRel (radians, wind relative to bow), speed, damage {hull,sails} 0..1, heel })
//   setDamage({hull, sails})  visual damage (holes in sails, scorch)
//   dispose()
// Extensions:
//   deckHeight            main-deck height above the waterline (model-local, midships)
//   cannonPorts[i]        each anchor sits just outside the muzzle; its local -Z... no: anchor.userData.dir = outward unit Vector3 (local);
//                         anchor.quaternion orients its local +Z along the barrel (outward)
//   sternLanterns         [THREE.Object3D] lantern centres (local)  ;  bowAnchor (Object3D at the bowsprit tip)
//   ensignAnchor          Object3D at the ensign staff top (for strike/surrender FX)
//   setFlag(faction)      repaint ensign/jack/pennants (e.g. a pirate running false colours then hoisting the black)
//   strikeFlag()          lowers the ensign (surrender); setFlag() re-hoists
//   setDuelMode(bool)     carved/gilded duel set dressing on (hides ship's boat, hatches, barrels)
//   setSailColor(hex)     re-tint canvas (e.g. black sails for a pirate flagship)
//   update() also accepts: luff 0..1 (from ship.js), rudder -1..1 (turns the rudder blade? — visual only, small)
//   Draw calls per ship: hull+spars+rigging (1), sails (1), flags (1), crew (1, instanced), lantern glow points (1).
//   model.lodFar          true while the hull draws its far LOD geometry (gfx-mer, LOD_FAR_M / LOD_NEAR_M)
import * as THREE from 'three';
import { SHIP_DESIGNS, FACTION_PAINT, FACTION_TRIM } from './art/configs.js';
import { HullShape } from './art/hullShape.js';
import { GeoBuilder } from './art/builder.js';
import { buildHullGeometry } from './art/hull.js';
import { buildRig } from './art/rig.js';
import { makeHullMaterial, makeSailMaterial, makeFlagMaterial, updateGlobals } from './art/materials.js';
import { buildFlagGeometry, getCrewGeometry, getCrewMaterial, getGlowMaterial, buildFoamGeometry, makeFoamMaterial } from './art/extras.js';
import { getFlagTex, EMBLEM_INDEX } from './art/textures.js';
import { mulberry32 } from './art/noise.js';
import { QUALITY } from '../core/constants.js';
import { buildDuelDressing } from './art/duelDeck.js';
import { SHIP_TYPES } from '../data/shipTypes.js';

export const SHIP_SPECS = {
  sloop:       { length: 18, beam: 5.5, draft: 2.2, guns: 8,  maxSpeed: 14, turn: 0.55, hull: 60,  crewMax: 75 },
  schooner:    { length: 24, beam: 6.5, draft: 2.6, guns: 10, maxSpeed: 13.5, turn: 0.48, hull: 80, crewMax: 90 },
  brig:        { length: 30, beam: 8,   draft: 3.2, guns: 14, maxSpeed: 12, turn: 0.40, hull: 120, crewMax: 120 },
  merchantman: { length: 32, beam: 9.5, draft: 3.8, guns: 8,  maxSpeed: 9.5, turn: 0.30, hull: 140, crewMax: 60 },
  frigate:     { length: 42, beam: 11,  draft: 4.5, guns: 28, maxSpeed: 11.5, turn: 0.30, hull: 220, crewMax: 220 },
  galleon:     { length: 48, beam: 13,  draft: 5.5, guns: 36, maxSpeed: 9,  turn: 0.22, hull: 300, crewMax: 300 },
};

// the 21 derived types (src/data/shipTypes.js) reuse a base design scaled by `scale`, with small mods.
// spec.navDraft = gameplay draft (shoals); spec.draft stays the visual hull draft. spec.base = base design id.
function deriveDesign(bd, t) {
  const k = t.scale, a = t.art || {};
  const d = structuredClone(bd);
  d.fb *= k; d.paintFrom *= k; d.wales = d.wales.map(w => w * k);
  const cs = (a.castles ?? 1) * k;
  for (const c of Object.keys(d.castles)) if (d.castles[c]) d.castles[c] = { ...d.castles[c], h: d.castles[c].h * cs };
  d.ports = d.ports.map((r, i) => ({ ...r, ...(a.portRows?.[i] || {}), y: (a.portRows?.[i]?.y ?? r.y) * k, n: a.ports?.[i] ?? r.n }));
  // extra tiers of gunports (three-decker), same units as the base design (y scaled by k)
  if (a.addPorts) for (const r of a.addPorts) d.ports.push({ ...r, y: r.y * k });
  if (a.masts && a.masts < d.masts.length) d.masts = d.masts.slice(0, a.masts);
  if (a.mastH) d.masts = d.masts.map((m, i) => ({ ...m, h: m.h * (a.mastH[i] ?? 1) }));
  if (a.mastRig) d.masts = d.masts.map((m, i) => a.mastRig[i] ? { ...m, ...a.mastRig[i] } : m);
  if (a.mizzen === 'square') d.masts = d.masts.map((m, i) => i === 2 && m.rig === 'lateen' ? { ...m, rig: 'square', tiers: 2, yard: 0.72, spanker: true } : m);
  if (a.headsails != null) d.headsails = a.headsails;
  if (a.head) d.head = a.head;
  if (a.stern) d.stern = { ...d.stern, ...a.stern };
  if (a.crew) d.crew = a.crew;
  return d;
}
for (const [id, t] of Object.entries(SHIP_TYPES)) {
  const b = SHIP_SPECS[t.base];
  if (!SHIP_SPECS[id]) {
    SHIP_SPECS[id] = { length: +(b.length * t.scale).toFixed(1), beam: +(b.beam * t.scale).toFixed(2), draft: +(b.draft * t.scale).toFixed(2),
      guns: t.guns, maxSpeed: t.speed, turn: t.turn, hull: t.hull, crewMax: t.crew };
    SHIP_DESIGNS[id] = deriveDesign(SHIP_DESIGNS[t.base], t);
  }
  SHIP_SPECS[id].navDraft = t.draft; SHIP_SPECS[id].base = t.base;
}

// hull geometry LOD switch distances (metres, scaled by the camera's zoom): far beyond LOD_FAR_M, back to the
// full model under LOD_NEAR_M. The shader already flattens the hull's fine detail from 120 to 250 m (farF).
// Ultra spends its spare GPU budget here: full-detail hulls (guns, rails, beads, ratlines) stay up
// longer — QUALITY.shipLodFarM/shipLodNearM override the defaults when set (ultra only; read live, not frozen at
// import time, since QUALITY.tier is applied by Game after this module loads).
export const LOD_FAR_M = 250, LOD_NEAR_M = 220;
function lodFarM() { return QUALITY.shipLodFarM ?? LOD_FAR_M; }
function lodNearM() { return QUALITY.shipLodNearM ?? LOD_NEAR_M; }

// ------------------------------------------------------------------ geometry cache (per type)
// Geometry depends only on type + paint colours (baked into vertex colours) -> cache by type|faction.
const _geoCache = new Map();
const _skinByType = new Map();   // type -> () => hull planking texture (lazy, shared by the nations)
const SAIL_COLOR = '#f4ead6';

function getTypeGeo(type, faction) {
  const key = type + '|' + faction;
  if (_geoCache.has(key)) return _geoCache.get(key);
  const spec = SHIP_SPECS[type], d = SHIP_DESIGNS[type];
  const H = new HullShape(spec, d);
  const gb = new GeoBuilder();
  const rnd = mulberry32(type.length * 977 + 13);
  const colors = { paint: new THREE.Color(FACTION_PAINT[faction] || FACTION_PAINT.english), trim: new THREE.Color(FACTION_TRIM[faction] || FACTION_TRIM.english) };
  const info = buildHullGeometry(gb, H, d, colors, rnd);
  // one planking texture per type, painted for the first real ship (not for moored hulls)
  let skin = _skinByType.get(type);
  if (!skin) { const paint = Object.getOwnPropertyDescriptor(info, 'skinTex').get; let t; skin = () => (t === undefined ? (t = paint()) : t); _skinByType.set(type, skin); }
  Object.defineProperty(info, 'skinTex', { enumerable: true, configurable: true, get: skin });
  const rig = buildRig(gb, H, d, info, mulberry32(type.length * 31 + 7), SAIL_COLOR);
  const hullGeo = gb.build();
  // far LOD = same vertex buffers, index without fine detail and with a coarse skin (art/builder.js tags)
  const hullGeoFar = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(hullGeo.attributes)) hullGeoFar.setAttribute(k, a);
  hullGeoFar.setIndex(new THREE.BufferAttribute(hullGeo.userData.farIndex, 1));
  hullGeoFar.boundingSphere = hullGeo.boundingSphere.clone(); hullGeoFar.boundingBox = hullGeo.boundingBox.clone();
  const res = { H, d, info, rig, hullGeo, hullGeoFar, sailGeo: rig.sailGeo, foamGeo: buildFoamGeometry(H) };
  _geoCache.set(key, res);
  return res;
}

// crew placement spots per type (local positions on decks)
function crewSpots(H, d, info, rnd, n) {
  const spots = [];
  const sx = [0.18, 0.3, 0.42, 0.55, 0.62, 0.72, 0.8, 0.88];
  for (let i = 0; i < n; i++) {
    let s = 0.12 + rnd() * 0.8;
    if (i === 0 && info.wheelPos) { spots.push({ p: info.wheelPos.clone().add(new THREE.Vector3(0, 0, 0.55)), yaw: 0, pose: 2 }); continue; }
    if (d.masts.some(m => Math.abs(m.s - s) < 0.025)) s += 0.04;
    const y = H.deckLevel(s), hw = Math.max(0.3, H.hw(s, y) - 0.7);
    const x = (rnd() * 2 - 1) * hw * (rnd() < 0.6 ? 0.95 : 0.5);
    spots.push({ p: new THREE.Vector3(x, y, H.z(s, y)), yaw: rnd() * Math.PI * 2, pose: Math.floor(rnd() * 3) });
  }
  void sx;
  return spots;
}

export function buildShipModel(type, opts = {}) {
  if (!SHIP_SPECS[type]) type = 'brig';
  const spec = SHIP_SPECS[type];
  let faction = opts.faction || 'english';
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  const rnd = mulberry32(seed | 0);
  const T = getTypeGeo(type, faction);
  const { H, d, info, rig } = T;

  const group = new THREE.Group();
  group.name = 'ship:' + type;

  // hull material per ship (carries damage + yard bracing uniforms); program shared
  const hullMat = makeHullMaterial(info.skinTex, info.skinRange);
  const hull = new THREE.Mesh(T.hullGeo, hullMat);
  hull.castShadow = true; hull.receiveShadow = true;
  hull.customDepthMaterial = hullMat.userData.depth;
  group.add(hull);

  const sailMat = makeSailMaterial(SAIL_COLOR);
  sailMat.userData.u.uPiv.value = hullMat.userData.u.uPiv.value;     // shared bracing state
  const sails = new THREE.Mesh(T.sailGeo, sailMat);
  sails.castShadow = true; sails.receiveShadow = true;   // half-tone, holed and tattered like the cloth (sail depth material)
  sails.customDepthMaterial = sailMat.userData.depth;
  sails.frustumCulled = false;
  group.add(sails);

  // flags
  const hoists = [];
  const ens = info.ensignStaff;
  const eL = (3.6 + spec.length * 0.16) * (faction === 'pirate' ? 1.12 : 1), eH = eL * 0.62;
  const staffTop = ens.clone().add(new THREE.Vector3(0, 2.4 + spec.length * 0.05, 0.9));
  hoists.push({ pos: staffTop, kind: 0, L: eL, H: eH });
  for (const p of rig.pennants) hoists.push({ pos: p.clone().add(new THREE.Vector3(0, -0.05, 0)), kind: 1, L: 5 + spec.length * 0.18, H: 0.8 + spec.length * 0.014 });
  // main-mast ensign for big ships (flag at a masthead)
  {
    const mi = Math.min(rig.pennants.length - 1, d.masts.length > 2 ? 1 : 0);
    const p = rig.pennants[mi];
    hoists[1 + mi] = { pos: p.clone().add(new THREE.Vector3(0, -0.1, 0)), kind: 0, L: eL * 0.72, H: eH * 0.72 };
  }
  if (rig.jbTip && info.jackHoist && opts.jack !== false) hoists.push({ pos: info.jackHoist.clone(), kind: 0, L: eL * 0.45, H: eH * 0.45 });   // opts.jack false: no bow jack (shipyard)
  const flagGeo = buildFlagGeometry(hoists);
  const flagMat = makeFlagMaterial(getFlagTex(faction));
  flagMat.userData.u.uDrop.value = staffTop.y - ens.y - 0.4;
  const flags = new THREE.Mesh(flagGeo, flagMat);
  flags.castShadow = false; flags.customDepthMaterial = flagMat.userData.depth; flags.frustumCulled = false;
  group.add(flags);
  // ensign staff (separate tiny line in hull geo would need cache split per type; build a thin cylinder mesh instead -> merged into flags group via shared material)
  {
    const g = new THREE.CylinderGeometry(0.05, 0.07, staffTop.y - ens.y + 0.6, 5);
    g.translate(0, (staffTop.y + ens.y) / 2 - 0.3 + 0.0, 0);
    g.translate(0, 0, staffTop.z);
    const staff = new THREE.Mesh(g, _getStaffMat());
    staff.castShadow = true;
    group.add(staff);
    group.userData.staffGeo = g;
  }

  // waterline foam skirt + stern wake (transparent, drawn after the sea)
  const foamMat = makeFoamMaterial();
  const foam = new THREE.Mesh(T.foamGeo, foamMat);
  foam.renderOrder = 2; foam.castShadow = false; foam.receiveShadow = false;
  group.add(foam);

  // crew (instanced)
  const nCrew = d.crew;
  const crewGeo = getCrewGeometry();
  const crew = new THREE.InstancedMesh(crewGeo, getCrewMaterial(), nCrew);
  crew.castShadow = true; crew.receiveShadow = true;
  const spots = crewSpots(H, d, info, rnd, nCrew);
  const shirtCols = ['#e9e1cc', '#d8cfb8', '#7a2a22', '#3a4d6e', '#c8b48a', '#efe9dc', '#5a6b3a', '#a54a2a'];
  const col = new THREE.Color();
  spots.forEach((sp, i) => {
    col.set(shirtCols[Math.floor(rnd() * shirtCols.length)]);
    col.r += rnd() * 0.001; col.g = Math.min(1, col.g + rnd() * 0.004);
    crew.setColorAt(i, col);
    sp.phase = rnd() * 10; sp.scale = 0.92 + rnd() * 0.14;
  });
  crew.instanceColor.needsUpdate = true;
  group.add(crew);
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  function poseCrew(t) {
    for (let i = 0; i < spots.length; i++) {
      const sp = spots[i];
      const ph = t + sp.phase;
      let yaw = sp.yaw, bob = 0, lean = 0;
      if (sp.pose === 0) { lean = Math.sin(ph * 0.7) * 0.06; yaw += Math.sin(ph * 0.23) * 0.5; }           // idle look-around
      else if (sp.pose === 1) { lean = 0.25 + Math.sin(ph * 2.2) * 0.2; bob = -Math.abs(Math.sin(ph * 2.2)) * 0.08; } // hauling/working
      else { lean = 0.05; yaw = sp.yaw; }                                                                     // helmsman / stood still
      _e.set(lean, yaw, 0, 'YXZ'); _q.setFromEuler(_e);
      _s.setScalar(sp.scale);
      _p.copy(sp.p); _p.y += bob;
      _m4.compose(_p, _q, _s);
      crew.setMatrixAt(i, _m4);
    }
    crew.instanceMatrix.needsUpdate = true;
  }
  poseCrew(0);
  crew.computeBoundingSphere();

  // lantern glow points
  const glowPos = [], glowSize = [];
  for (const l of info.sternLanterns) { glowPos.push(l.x, l.y, l.z); glowSize.push(0.9 + spec.length * 0.012); }
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
  glowGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(glowSize, 1));
  const glow = new THREE.Points(glowGeo, getGlowMaterial());
  glow.frustumCulled = false; glow.renderOrder = 5;
  group.add(glow);

  // anchors (API)
  const cannonPorts = { port: [], starboard: [] };
  const zAxis = new THREE.Vector3(0, 0, 1);
  for (const side of ['port', 'starboard']) for (const pp of info.ports[side]) {
    const o = new THREE.Object3D();
    o.position.copy(pp.pos);
    o.quaternion.setFromUnitVectors(zAxis, pp.dir);
    o.userData.dir = pp.dir.clone();
    o.name = 'muzzle';
    group.add(o); cannonPorts[side].push(o);
  }
  for (const side of ['port', 'starboard']) cannonPorts[side].sort((a, b) => a.position.z - b.position.z);
  const mastTops = rig.tops.map(p => { const o = new THREE.Object3D(); o.position.copy(p); o.name = 'masttop'; group.add(o); return o; });
  const sternLanterns = info.sternLanterns.map(p => { const o = new THREE.Object3D(); o.position.copy(p); group.add(o); return o; });
  const ensignAnchor = new THREE.Object3D(); ensignAnchor.position.copy(staffTop); group.add(ensignAnchor);
  const bowAnchor = new THREE.Object3D(); bowAnchor.position.copy(rig.jbTip || rig.bsTip); group.add(bowAnchor);

  // ---------------- state
  const FAC_SAIL = { english: '#b3262e', spanish: '#b0242a', french: '#2c55a0', dutch: '#d9701f', pirate: '#1a1515' };
  sailMat.userData.u.uFac.value.set(FAC_SAIL[faction] || '#b3262e');
  sailMat.userData.u.uEmbIdx.value = EMBLEM_INDEX[faction] ?? 0;
  const hu = hullMat.userData.u, su = sailMat.userData.u, fu = flagMat.userData.u;
  const piv = hu.uPiv.value;
  for (let i = 0; i < 8; i++) piv[i].copy(rig.pivots[i]);
  const st = { set: opts.sailSetting ?? 0.5, brace: 0, boom: 0, fill: 1, side: 1, luff: 0, strike: 0, strikeTarget: 0, flagYaw: 0, hullD: 0, sailD: 0, far: false };
  let damageOverride = null;

  const model = {
    group, length: spec.length, beam: spec.beam, draft: spec.draft,
    deckHeight: info.deckHeight,
    cannonPorts, mastTops, sternLanterns, ensignAnchor, bowAnchor,
    type, faction,
    get lodFar() { return st.far; },
    update(dt, t, o = {}) {
      updateGlobals(t);
      const snap = !st.init || dt === 0; st.init = true;
      const k = snap ? 1 : Math.min(1, dt * 2.5);
      const target = o.sailSetting ?? st.set;
      st.set += (target - st.set) * Math.min(1, dt * 1.2);
      if (dt === 0) st.set = target;
      // wind relative to bow: windRel = bearing wind comes FROM (0 = nose, +PI/2 starboard). Fallback: game wind.
      let wr = o.windRel;
      if (wr == null || !Number.isFinite(wr)) wr = Math.PI * 0.7;
      const off = Math.abs(wr);                      // 0 head-to-wind, PI dead astern
      const fromStbd = wr >= 0 ? 1 : -1;
      // yards brace round as the wind comes forward (max ~35 deg); fore-and-aft booms swing to leeward
      const braceT = -fromStbd * Math.max(0, Math.min(0.62, (Math.PI - off) * 0.42));
      const boomT = fromStbd * Math.max(0.12, Math.min(1.1, (off - 0.35) * 0.55));
      st.brace += (braceT - st.brace) * k * 0.5;
      st.boom += (boomT - st.boom) * k * 0.5;
      if (snap) { st.brace = braceT; st.boom = boomT; }
      // fill: square sails billow forward (toward -Z) when wind from aft half; aback when head to wind
      const luffIn = o.luff != null ? o.luff : Math.max(0, 1 - off / 0.7);
      st.luff += (luffIn - st.luff) * k;
      const fillT = (off > 1.0 ? 1 : off / 1.0) * (1 - st.luff * 0.9) - st.luff * 0.15;
      st.fill += (fillT - st.fill) * k;
      const sideT = -fromStbd * (1 - st.luff * 0.85);
      st.side += (sideT - st.side) * k;
      for (let i = 0; i < 3; i++) { piv[2 * i].z = st.brace; }
      for (let i = 0; i < 4; i++) {
        const md = d.masts[i]; if (!md) continue;
        if (md.rig === 'square' && !md.spanker) piv[2 * i + 1].z = st.brace;
        else piv[2 * i + 1].z = md.rig === 'lateen' ? st.boom * 0.55 : st.boom;
      }
      if (d.masts[3]) piv[6].z = 0;  // headsail pivot
      piv[6].z = st.boom * 0.35;
      su.uSet.value = st.set; su.uFill.value = st.fill; su.uSide.value = st.side; su.uLuff.value = st.luff;
      su.uGust.value = Math.min(1, (o.speed || 0) / 10);
      // flags stream downwind (in local frame); wind comes FROM wr, so flag points toward wr + PI
      const flyDir = wr + Math.PI;            // local heading of the fly
      let dy = flyDir - st.flagYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      st.flagYaw += snap ? dy : dy * k;
      // local yaw in flag shader: dirL = (sin yaw, 0, -cos yaw) with heading convention -> local heading
      fu.uYaw.value = st.flagYaw;
      fu.uWind.value = 1;
      st.strike += (st.strikeTarget - st.strike) * (snap ? 1 : Math.min(1, dt * 0.6));
      fu.uStrike.value = st.strike;
      { const sp = Math.abs(o.speed || 0); const fm = foamMat.userData.u.uSpeed; fm.value += (sp - fm.value) * (snap ? 1 : Math.min(1, dt * 1.5)); }
      const dmg = damageOverride || o.damage;
      if (dmg) this.setDamage(dmg);
      const cam = typeof window !== 'undefined' ? window.__game?.camera : null;
      const camD = cam ? cam.position.distanceTo(group.position) * (cam.fov || 52) / 52 : 0;   // zoom-aware range
      crew.visible = !cam || camD < 70;
      // hull LOD with hysteresis (far: no guns, rails, beads, ratlines or running rigging; coarse skin).
      // Only for models in the world scene: port stages (shipyard) render their own camera -> always the full model.
      let root = group; while (root.parent) root = root.parent;
      const far = !!cam && root === window.__game.scene && (st.far ? camD > lodNearM() : camD > lodFarM());
      if (far !== st.far) { st.far = far; hull.geometry = far ? T.hullGeoFar : T.hullGeo; }
      // sails are never frustum-culled (vertex-animated), so only ships near the camera (inside the ±90–150 m shadow
      // box around it) draw them into the shadow map
      sails.castShadow = !cam || camD < 170;
      if (crew.visible) poseCrew(t);
    },
    setDamage({ hull: h = 0, sails: s = 0 } = {}) {
      // spars that the shader hides at a damage threshold (rig.js aBreak 10.8 / 10.9 / 10.97) now break off
      // and fall: hand a falling-spar proxy to the FX when the sail damage crosses each threshold upward
      const prevS = hu.uSailDmg.value, ns = Math.max(0, Math.min(1, s));
      if (ns > prevS && !damageOverride?.silent) {
        const fxs = typeof window !== 'undefined' ? window.__game?.fx : null;
        if (fxs?.fallingSpar) rig.masts.forEach((M, i) => {
          if (!M.headL || !M.headG) return;
          const fall = i === rig.fallIdx;
          if (fall && prevS < 0.8 && ns >= 0.8) fxs.fallingSpar(group, M.headL, M.headG, M.r * 0.6);
          if (!fall && prevS < 0.9 && ns >= 0.9 && M.headT && M.headT !== M.headG) fxs.fallingSpar(group, M.headT, M.headG, M.r * 0.4);
          if (!fall && prevS < 0.97 && ns >= 0.97) fxs.fallingSpar(group, M.headL, M.headT || M.headG, M.r * 0.6);
        });
      }
      hu.uHullDmg.value = Math.max(0, Math.min(1, h));
      hu.uSailDmg.value = Math.max(0, Math.min(1, s));
      su.uSailDmg.value = hu.uSailDmg.value;
    },
    setFlag(f) {
      faction = f; model.faction = f;
      flagMat.map = getFlagTex(f); flagMat.needsUpdate = true; su.uFac.value.set(FAC_SAIL[f] || '#b3262e'); su.uEmbIdx.value = EMBLEM_INDEX[f] ?? 0;
      st.strikeTarget = 0;
    },
    strikeFlag() { st.strikeTarget = 1; },
    setSailColor(hex) { su.uColor.value.set(hex); },
    // close-up deck dressing for the sword duel: hides boat/hatches/clutter, adds carved & gilded set dressing
    setDuelMode(on = true) {
      hu.uDuel.value = on ? 1 : 0;
      if (on && !model._duelDeck) { model._duelDeck = buildDuelDressing(H, d, info, null); group.add(model._duelDeck); }
      if (model._duelDeck) model._duelDeck.visible = !!on;
    },
    // override the damage that ship.js passes in (showcase / debugging)
    forceDamage(dmg) { damageOverride = dmg; if (dmg) model.setDamage(dmg); },
    dispose() {
      hullMat.dispose(); hullMat.userData.depth.dispose();
      sailMat.dispose(); sailMat.userData.depth.dispose();
      flagMat.dispose(); flagMat.userData.depth.dispose(); foamMat.dispose();
      flagGeo.dispose(); glowGeo.dispose(); group.userData.staffGeo?.dispose();
      crew.dispose();
      model._duelDeck?.userData.dispose?.();
    },
  };
  model.update(0, 0, { sailSetting: st.set });
  return model;
}

let _staffMat = null;
function _getStaffMat() {
  if (!_staffMat) _staffMat = new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: 0.75 });
  return _staffMat;
}

// Moored / harbour LOD (used by src/world/towns/towns.js): raw cached geometry of a type, for static merged copies
// (sails are furled by the sail shader with uSet = 0; bracing pivots stay at rest).
export function getShipStaticParts(type, faction = 'english') {
  if (!SHIP_SPECS[type]) type = 'brig';
  const T = getTypeGeo(type, faction);
  return { hullGeo: T.hullGeo, hullGeoFar: T.hullGeoFar, sailGeo: T.sailGeo, foamGeo: T.foamGeo, tops: T.rig.tops, pennants: T.rig.pennants, spec: SHIP_SPECS[type] };
}
