// Duel sets away from the deck: a tavern (smoky room) and a rampart (night, torches). Each set is a separate
// three.js scene, rendered through game.renderOverride during the duel (like the port stages): the world stays out
// of shot, the lighting is controlled, and the duel's figures and camera are those of the deck duel (duelScene.js).
//   buildDuelStage(kind, { game, faction, seed }) -> stage
//     stage.scene     THREE.Scene; stage.root: Group where the duel line is placed
//     frame: duel line along z at x = 0 (ground y = 0), camera on the +x side, set dressing on the −x side
//     stage.lineLen   length of the line (m); stage.crowd [{ x, z, look, side, calm }]; stage.brawls [{ x, z, yaw }]
//     stage.rim (Color, figures' rim light); stage.exposure; stage.railLabel; stage.pressed { win, lose }
//     stage.cam { dist, h, lookH, fov, along } (optional offsets); stage.introK (extent of the opening dolly)
//     stage.pop(pos, k) contact flash (the scene's point light); stage.update(t, dt); stage.render(r, cam)
//     stage.info() { calls, tris } after a render; stage.dispose()
// Static set merged per material (bakeStatic): ~30 to 60 draw calls per set, ~150 with the figures.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Kit } from '../ports/stage/kit.js';
import { frame, painting } from '../ports/stage/scenes.js';
import { LOOKS } from './figure.js';
import { FACTIONS, QUALITY } from '../../core/constants.js';

export const DUEL_STAGES = ['tavern', 'rampart'];
const P = Math.PI, TAU = P * 2;

// ---------------------------------------------------------------- helpers
function cv(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }

// moonlit sea seen from the rampart: dark swell with glints
function seaCanvas(r) {
  return cv(256, 256, (c, S) => {
    const g = c.createLinearGradient(0, 0, 0, S); g.addColorStop(0, '#0e1a30'); g.addColorStop(1, '#08101e'); c.fillStyle = g; c.fillRect(0, 0, S, S);
    for (let i = 0; i < 700; i++) { const x = r() * S, y = r() * S, w = 4 + r() * 16; c.strokeStyle = `rgba(${60 + r() * 60},${90 + r() * 60},${140 + r() * 60},${0.12 + r() * 0.2})`; c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + w / 2, y - 1.5, x + w, y); c.stroke(); }
  });
}
// moon glitter on water (additive): short bright dashes thinning out toward the edges
function glitterCanvas(r) {
  return cv(128, 512, (c, W, H) => {
    for (let i = 0; i < 900; i++) { const y = r() * H, sp = 0.15 + 0.85 * (y / H); const x = W / 2 + (r() - 0.5) * W * sp * (0.4 + r() * 0.6);
      const a = (1 - Math.abs(x - W / 2) / (W / 2)) * (0.25 + r() * 0.6); c.fillStyle = `rgba(220,230,255,${a})`; c.fillRect(x, y, 2 + r() * 8 * sp, 1 + r() * 1.5); }
  });
}

// fuse every static mesh of `group` sharing a material into one mesh (draw calls ÷ 10 on the decor)
function bakeStatic(k, group, { cast = true } = {}) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert(), m4 = new THREE.Matrix4();
  const by = new Map(), drop = [];
  group.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.userData.keep || Array.isArray(o.material)) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.clearGroups();
    m4.multiplyMatrices(inv, o.matrixWorld); g.applyMatrix4(m4);
    const key = o.material.uuid + (o.userData.noCast ? '|n' : '');
    if (!by.has(key)) by.set(key, { mat: o.material, geos: [], noCast: !!o.userData.noCast });
    by.get(key).geos.push(g); drop.push(o);
  });
  for (const o of drop) o.parent.remove(o);
  for (const { mat, geos, noCast } of by.values()) {
    const geo = k._track(mergeGeometries(geos, false)); for (const g of geos) g.dispose();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true; m.castShadow = cast && !noCast && !mat.transparent && !mat.isMeshBasicMaterial;
    group.add(m);
  }
}

// key light with soft PCF shadows framed on the duel line
function keyLight(s, color, intensity, pos, R = 9) {
  const key = new THREE.DirectionalLight(color, intensity); key.position.copy(pos); s.add(key);
  key.castShadow = true;
  const S = QUALITY.shadowMapSize || 2048;   // 1024 low, 2048, 4096 ultra
  const sh = key.shadow; sh.mapSize.set(S, S); sh.radius = 3; sh.bias = -0.0005; sh.normalBias = 0.035;
  key.target.position.set(0, 0.8, 0); s.add(key.target);
  const c = sh.camera; c.left = c.bottom = -R; c.right = c.top = R; c.near = 0.5; c.far = pos.length() + R * 2.5; c.updateProjectionMatrix();
  return key;
}

function stars(k, s, n, r, seed = 3) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = r() * TAU, el = Math.asin(0.08 + r() * 0.92) ;
    const R = 380; pos[i * 3] = Math.cos(el) * Math.cos(a) * R; pos[i * 3 + 1] = Math.sin(el) * R; pos[i * 3 + 2] = Math.cos(el) * Math.sin(a) * R;
    const b = 0.45 + r() * 0.55, warm = r() < 0.2; col[i * 3] = b * (warm ? 1 : 0.85); col[i * 3 + 1] = b * 0.9; col[i * 3 + 2] = b * (warm ? 0.75 : 1);
  }
  void seed;
  const g = k._track(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = k._track(new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, depthWrite: false }));
  const p = new THREE.Points(g, m); p.renderOrder = -1; s.add(p); return p;
}

function moon(k, s, dir) {
  const p = dir.clone().normalize().multiplyScalar(360);
  const disc = k.mesh(new THREE.CircleGeometry(9, 28), k.basic('#f3f0dc', { fog: false }), p.x, p.y, p.z, s); disc.lookAt(0, 0, 0); disc.userData.keep = true;
  k.glow('#9fb6ff', 120, p.x * 0.98, p.y * 0.98, p.z * 0.98, s, 0.28).material.fog = false;
  return disc;
}

// spectators: looks for the crowd figures (FencerAnimator 'cheer' / calm 'rest')
const pick = (r, a) => a[Math.floor(r() * a.length)];
function ladyLook(r) {
  return { ...LOOKS.woman, dress: pick(r, ['#2a4a7a', '#6a3a7a', '#3a6a4a', '#8a2a3a', '#b86a4a', '#d8c8a8']), bodice: pick(r, ['#e8dcc0', '#3a2a20', '#c9a24a']),
    hat: 'none', hair: pick(r, ['#4a2414', '#2a1a10', '#7a5a30', '#c8a060']), skin: pick(r, ['#e8c0a0', '#d8a888', '#c99272']), expr: pick(r, ['smile', 'calm']),
    seed: Math.floor(r() * 1e6), height: 0.92 + r() * 0.05 };
}
const SHIRTS = ['#e9e1cc', '#d8cfb8', '#7a2a22', '#3a4d6e', '#c8b48a', '#efe9dc', '#5a6b3a', '#a54a2a'];
function sailorLook(r, fac) {
  // darker breeches and, on some, a waistcoat, so a crowd is not a row of white shirts; cheering fists
  return { sailor: true, sword: false, cutlass: true, coat: pick(r, SHIRTS), stripes: r() < 0.3, shirt: '#e8dfc8', breeches: pick(r, ['#5a4a38', '#6b5a44', '#3a3a44', '#2c3550', '#c8b48a']), boot: '#2a1a10',
    vest: r() < 0.4 ? pick(r, ['#5a3a24', '#2c3550', '#6e1414', '#3a4a2a', '#4a3a2a']) : null, fists: true,
    hat: pick(r, ['bandana', 'none', 'cap', 'tricorn', 'none']), bandana: pick(r, [FACTIONS[fac]?.color || '#6e1414', '#6e1414', '#2a3a58', '#c8b48a', '#3a3028']),
    skin: pick(r, ['#c98d62', '#a86e48', '#e0ab84', '#7a4a2c']), hair: pick(r, ['#2b1d14', '#141010', '#6b4a2a']), hatColor: '#2a221c', beard: r() < 0.45, moustache: r() < 0.5,
    jacket: r() < 0.3, sash: r() < 0.4 ? '#8e1b1b' : null, seed: Math.floor(r() * 1e6), bulk: 0.92 + r() * 0.25, height: 0.92 + r() * 0.1, longHair: r() < 0.4, expr: pick(r, ['smile', 'calm', 'fierce']) };
}
function guardLook(r, fac) {
  const nat = LOOKS[fac] || LOOKS.english;
  return { ...LOOKS.guard, coat: nat.coat || LOOKS.guard.coat, sword: false, seed: Math.floor(r() * 1e6), skin: pick(r, ['#e0b090', '#c99272', '#a8704e']), height: 0.97 + r() * 0.05, beard: r() < 0.3 };
}

// ---------------------------------------------------------------- tavern (smoky common room)
function tavern(k, s, st, o) {
  const r = k.r;
  // the hour sets the windows (point 3): daylight through the panes with sun shafts, a red dusk, or the night
  const h = o.hour ?? 22, day = h >= 7 && h < 18.3, dusk = !day && h >= 5.5 && h < 20.3;
  s.background = new THREE.Color('#120a05'); s.fog = new THREE.Fog(day ? '#2a1c10' : '#1c1008', 12, 30);
  s.add(new THREE.HemisphereLight(day ? '#b0b4c8' : '#8a7a8a', '#3a2010', day ? 0.78 : 0.6));
  if (day || dusk) keyLight(s, day ? '#ffeccc' : '#ffb27a', day ? 1.25 : 0.9, new THREE.Vector3(-8, 7.5, 2.5), 10);   // sun through the back windows
  else keyLight(s, '#ffd6a0', 0.75, new THREE.Vector3(5, 9, 3), 10);                // light from the candle wheels
  const fill = new THREE.PointLight('#ffb070', 8, 14, 1.6); fill.position.set(4, 2.8, 0.5); s.add(fill);
  const deco = new THREE.Group(); s.add(deco);
  const live = new THREE.Group(); s.add(live);
  const W = 26, X0 = -6, X1 = 11, H = 4.1, D = X1 - X0;
  // floor of worn boards, plastered walls between dark timbers, beamed ceiling
  const fl = k.mesh(new THREE.PlaneGeometry(D, W), k.mat('#ffffff', { map: k.tiled(k.tex.planks, D / 1.5, W / 1.5), rough: 0.85 }), (X0 + X1) / 2, 0, 0, s); fl.rotation.x = -P / 2; fl.receiveShadow = true;
  const wallM = k.mat('#c8ab80', { map: k.tiled(k.tex.plaster, W / 4, H / 4) });
  const back = k.mesh(new THREE.PlaneGeometry(W, H), wallM, X0, H / 2, 0, deco); back.rotation.y = P / 2; back.userData.noCast = true;
  const sideM = k.mat('#c8ab80', { map: k.tiled(k.tex.plaster, D / 4, H / 4) });
  for (const z of [-W / 2, W / 2]) { const w = k.mesh(new THREE.PlaneGeometry(D, H), sideM, (X0 + X1) / 2, H / 2, z, deco); w.rotation.y = z < 0 ? 0 : P; w.userData.noCast = true; }
  const ceil = k.mesh(new THREE.PlaneGeometry(D, W), k.mat('#5a3a20', { map: k.tiled(k.tex.darkPlanks, D / 3, W / 3) }), (X0 + X1) / 2, H, 0, deco); ceil.rotation.x = P / 2; ceil.userData.noCast = true;
  const bm = k.mat('#4a2e18', { map: k.tex.darkPlanks });
  for (let z = -W / 2 + 1.3; z < W / 2; z += 2.6) k.box(D, 0.3, 0.26, bm, (X0 + X1) / 2, H - 0.15, z, deco);   // joists toward the camera
  for (let z = -W / 2 + 0.2; z <= W / 2; z += 3.1) k.box(0.22, H, 0.26, bm, X0 + 0.12, H / 2, z, deco);    // timber posts on the back wall
  k.box(0.2, 0.24, W, bm, X0 + 0.1, 2.55, 0, deco);
  // the bar along the back wall (behind the player), bottle shelves and casks
  const bw = k.mat('#6a3e1e', { map: k.tex.darkPlanks }), top = k.mat('#8a5a32', { map: k.tex.planks, rough: 0.45 });
  k.box(0.9, 1.1, 6.2, bw, X0 + 1.7, 0.55, 5.4, deco); k.box(1.05, 0.08, 6.4, top, X0 + 1.7, 1.14, 5.4, deco);
  for (let i = 0; i < 5; i++) k.mug(X0 + 1.55, 1.18, 3.0 + i * 1.1, deco);
  for (const y of [1.6, 2.15]) { k.box(0.4, 0.06, 5.2, bw, X0 + 0.25, y, 5.2, deco); for (let i = 0; i < 13; i++) k.bottle(X0 + 0.25, y + 0.03, 2.8 + i * 0.38, deco, k.pick(['#2f5a2a', '#5a2a1a', '#3a3020', '#6a5020'])); }
  for (let i = 0; i < 3; i++) k.barrel(X0 + 0.6, 9.2 + i * 0.95, deco, { lying: true });
  k.barrel(X0 + 0.7, 9.7, deco, { lying: true, y: 0.72 });
  // hearth on the back wall (behind the enemy): stone jambs, a log fire, a kettle on its hook
  const stM = k.mat('#9a8a78', { map: k.tex.stone });
  const hz = -5.2;
  k.box(0.6, 1.5, 0.55, stM, X0 + 0.35, 0.75, hz - 1.3, deco); k.box(0.6, 1.5, 0.55, stM, X0 + 0.35, 0.75, hz + 1.3, deco);
  k.box(0.7, 0.35, 3.2, k.mat('#3a2414', { map: k.tex.darkPlanks }), X0 + 0.4, 1.65, hz, deco);
  k.box(0.3, 1.5, 2.1, k.mat('#1a120c'), X0 + 0.1, 0.75, hz, deco);
  const hood = k.mesh(new THREE.CylinderGeometry(0.6, 1.3, 1.5, 4, 1), k.mat('#b09878', { map: k.tex.plaster }), X0 + 0.3, 2.6, hz, deco); hood.rotation.y = P / 4; hood.scale.set(0.55, 1, 1.4);
  k.fire(X0 + 0.55, 0.06, hz, live, { light: 26, scale: 0.9 });
  const pot = k.sph(0.24, k.mat('#1a1614', { metal: 0.5, rough: 0.5 }), X0 + 0.55, 0.8, hz, deco, 10, 6); pot.scale.y = 0.8;
  for (let i = 0; i < 3; i++) k.mug(X0 + 0.5, 1.84, hz - 0.9 + i * 0.6, deco);
  // windows on the back wall (night: deep blue panes; day: bright sky with sun shafts on the floor) and a painting
  const pane = day ? k.mat('#e4eeff', { emissive: '#c8dcff', ei: 1.5 }) : dusk ? k.mat('#f0b070', { emissive: '#d87a3a', ei: 1.3 }) : k.mat('#22324e', { emissive: '#14223e', ei: 1.0 });
  const sash = k.mat('#2a1a10');
  for (const z of [-10.4, 0.2]) { k.box(0.06, 1.0, 1.2, pane, X0 + 0.02, 2.1, z, deco); k.box(0.08, 0.06, 1.3, sash, X0 + 0.05, 2.1, z, deco); k.box(0.08, 1.1, 0.06, sash, X0 + 0.05, 2.1, z, deco); }
  if (day || dusk) {
    const sc = cv(32, 128, (c, W, H) => { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(255,240,210,0.9)'); g.addColorStop(1, 'rgba(255,240,210,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
      const e = c.createLinearGradient(0, 0, W, 0); e.addColorStop(0, 'rgba(0,0,0,1)'); e.addColorStop(0.3, 'rgba(0,0,0,0)'); e.addColorStop(0.7, 'rgba(0,0,0,0)'); e.addColorStop(1, 'rgba(0,0,0,1)');
      c.globalCompositeOperation = 'destination-out'; c.fillStyle = e; c.fillRect(0, 0, W, H); });
    const shaftM = k.basic(day ? '#fff2d8' : '#ffb070', { map: k._ctex(sc, false), transparent: true, opacity: day ? 0.2 : 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const len = Math.hypot(4.2, 2.0), Y = new THREE.Vector3(-4.2, 2.0, 0).normalize(), X = new THREE.Vector3(0, 0, 1);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, new THREE.Vector3().crossVectors(X, Y)));
    for (const z of [-10.4, 0.2]) {
      // a slanting shaft from the pane to the floor: local y (texture v, bright end) points up to the window
      const m = k.mesh(new THREE.PlaneGeometry(1.25, len), shaftM, X0 + 2.1, 1.1, z, live); m.quaternion.copy(q); m.renderOrder = 6;
      const pool = k.mesh(new THREE.PlaneGeometry(1.6, 1.3), k.basic(day ? '#ffe8c0' : '#ff9a50', { map: k.tex.glow, transparent: true, opacity: day ? 0.35 : 0.25, depthWrite: false, blending: THREE.AdditiveBlending }), X0 + 4.3, 0.02, z, live);
      pool.rotation.x = -P / 2;
    }
  }
  frame(k, X0 + 0.06, 2.4, -1.9, 0.9, 0.7, deco, '#5a3a20', null, painting(k, 'sea', (o.seed | 0) + 5)).rotation.y = P / 2;
  if (o.faction) k.banner(o.faction, 0.9, 1.3, X0 + 0.08, 2.75, 1.8, deco).rotation.y = P / 2;
  // tables shoved aside for the fight, a stool knocked over on the line's edge
  const T = [[-3.3, -9.2], [-3.4, 9.6], [2.6, -8.6], [2.8, 9.4]];
  for (const [x, z] of T) { k.table(x, z, deco, { r: 0.65 }); k.mug(x + 0.2, 0.78, z + 0.1, deco); k.candle(x - 0.15, 0.78, z - 0.1, deco); }
  for (const [x, z] of [[-2.6, -7.8], [-4.1, 8.6]]) k.stool(x, z, deco);
  const tipped = k.stool(1.8, -5.4, deco); tipped.rotation.set(P / 2, 0, 0.4); tipped.position.y = 0.2;
  k.barrel(-3.9, -2.9, deco, { s: 0.85 }); k.crate(-4.2, 0, 2.6, 0.55, deco, 0.3);
  // wagon-wheel candle chandeliers + lanterns
  for (const z of [-3.2, 3.2]) {
    const wheel = k.mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 20), bm, -1.4, 3.05, z, deco); wheel.rotation.x = P / 2;
    k.cyl(0.012, 0.012, 1.0, k.mat('#6a5a40'), -1.4, 3.55, z, deco, 4);
    for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; k.candle(-1.4 + Math.cos(a) * 0.55, 3.07, z + Math.sin(a) * 0.55, deco); }
  }
  for (const z of [-3.2, 3.2]) { const pl = new THREE.PointLight('#ffb466', 7, 10, 1.7); pl.position.set(-1.4, 2.85, z); s.add(pl); }
  k.lantern(-4.4, 2.75, -9.4, live, { rope: 1.0 }); k.lantern(-4.4, 2.75, 9.4, live, { rope: 1.0 });
  bakeStatic(k, deco);
  // the house watches: barkeeper behind the bar, patrons along the walls, a barmaid with her tray
  k.place(k.npc({ pose: 'lean', hat: null, apron: true, coat: '#e0d4b8', vest: '#8e3a2a', moustache: true, beard: true }), X0 + 0.95, 5.6, P / 2, live);
  st.crowd = [
    { x: -2.5, z: 2.8, look: sailorLook(r, o.faction), side: 1 }, { x: -3.1, z: 3.7, look: sailorLook(r, o.faction), side: 1 }, { x: -2.4, z: 6.4, look: ladyLook(r), side: 1, calm: true },
    { x: -2.5, z: -2.8, look: sailorLook(r, o.faction), side: -1 }, { x: -3.0, z: -3.8, look: sailorLook(r, o.faction), side: -1 }, { x: -2.2, z: -6.6, look: sailorLook(r, o.faction), side: -1 },
  ];
  st.brawls = [{ x: -3.6, z: -10.6, yaw: 0.6 }];
  Object.assign(st, { rim: new THREE.Color(0.95, 0.7, 0.45), exposure: day ? 1.12 : 1.25, railLabel: 'The taproom', introK: 0.06,
    pressed: { win: 'Backed against the counter, he throws down his weapon!', lose: 'Backed against the wall, you lay down your arms!' } });
  return st;
}

// ---------------------------------------------------------------- rampart (night, torches, the sea below)
function rampart(k, s, st, o) {
  const r = k.r;
  s.background = new THREE.Color('#0a1022'); s.fog = new THREE.Fog('#0f1830', 30, 260);
  k.skyDome('#03071a', '#16204a', '#34345a', s);
  stars(k, s, 480, r);
  const mdir = new THREE.Vector3(-0.85, 0.3, -0.42);
  moon(k, s, mdir);
  s.add(new THREE.HemisphereLight('#5a6aa6', '#2a2024', 0.75));
  keyLight(s, '#aebef4', 1.1, new THREE.Vector3(-8, 10, -4));
  const fill = new THREE.PointLight('#ffae66', 8, 16, 1.6); fill.position.set(4.4, 3.0, 0.6); s.add(fill);
  const deco = new THREE.Group(); s.add(deco);
  const live = new THREE.Group(); s.add(live);
  // stone scaled per piece (blocks ~0.35 m) so merlons, parapet and tower read as one masonry
  const st1 = (w, h, col = '#a49a8a') => k.mat(col, { map: k.tiled(k.tex.stone, Math.max(1, w / 2.4), Math.max(0.5, h / 2.2)), rough: 0.88, ns: 1.1 });
  // wall-walk paving (small setts), outer parapet with merlons, the wall face plunging to the sea
  const walk = k.mesh(new THREE.PlaneGeometry(9, 46), k.mat('#9c968c', { map: k.tiled(k.tex.stone, 9 / 2.2, 46 / 2.2), rough: 0.88, ns: 1.0 }), 1.6, 0, 0, s); walk.rotation.x = -P / 2; walk.receiveShadow = true;
  const PX = -2.8;
  k.box(0.9, 1.0, 46, st1(46, 1, '#8e8678'), PX, 0.5, 0, deco);
  k.box(1.1, 0.1, 46, st1(46, 0.5, '#b4ab9a'), PX, 1.03, 0, deco);
  const mer = st1(1.05, 1.1), cap = st1(1.12, 0.3, '#b8ae9c');
  for (let z = -22.6; z <= 22.6; z += 1.7) { if (Math.abs(z - 4.6) < 0.3) continue; k.box(0.92, 1.05, 1.05, mer, PX, 1.6, z, deco); k.box(1.0, 0.08, 1.12, cap, PX, 2.16, z, deco); }
  k.box(1.2, 16, 46, st1(46, 16, '#6e665a'), PX - 0.6, -7.9, 0, deco);
  // a round bastion tower beyond the parapet (its crenellated top against the stars), the flag of the town on it
  const tx = -11, tz = -10.5;
  k.mesh(new THREE.CylinderGeometry(3.0, 3.4, 19, 22), k.mat('#968c7c', { map: k.tiled(k.tex.stone, 7, 7), rough: 0.9, ns: 1.1 }), tx, -5.5, tz, deco);
  k.cyl(3.25, 3.25, 0.25, cap, tx, 4.1, tz, deco, 22);
  for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; k.box(0.75, 0.9, 0.55, mer, tx + Math.cos(a) * 3.0, 4.65, tz + Math.sin(a) * 3.0, deco).rotation.y = -a; }
  for (const [y, a] of [[0.4, 0.2], [2.6, -0.5]]) k.box(0.2, 0.8, 0.3, k.mat('#141418'), tx + Math.cos(a) * 3.15, y, tz + Math.sin(a) * 3.15, deco).rotation.y = -a;   // arrow slits
  k.cyl(0.05, 0.06, 4, k.mat('#3a2a1a'), tx, 6.1, tz, deco, 6);
  if (o.faction) { const b = k.banner(o.faction, 1.6, 1.1, tx + 0.85, 7.4, tz, live); b.rotation.y = P / 2; }
  k.fire(tx + 2.4, 5.2, tz + 1.6, live, { light: 3, scale: 0.22 });   // a brazier glowing on the bastion
  // a sentry box on our end, a gun in the embrasure, round shot stacked beside it
  const sb = new THREE.Group(); sb.position.set(-1.25, 0, 7.4); sb.rotation.y = 0.2; deco.add(sb);
  k.box(1.4, 2.3, 1.4, k.mat('#6a4a2a', { map: k.tex.planks }), 0, 1.15, 0, sb);
  k.box(0.9, 1.7, 0.05, k.mat('#1a120c'), 0.71, 1.0, 0, sb).rotation.y = P / 2;
  const roof = k.mesh(new THREE.ConeGeometry(1.15, 0.8, 4), k.mat('#5a2a1a', { map: k.tex.roof }), 0, 2.7, 0, sb); roof.rotation.y = P / 4;
  const iron = k.mat('#2a2826', { metal: 0.6, rough: 0.45 }), wood = k.mat('#5a3a1c', { map: k.tex.darkPlanks });
  const gun = new THREE.Group(); gun.position.set(-1.55, 0, 4.6); deco.add(gun);
  k.box(1.3, 0.35, 0.7, wood, 0, 0.35, 0, gun); for (const [dx, dz] of [[-0.45, -0.38], [-0.45, 0.38], [0.45, -0.38], [0.45, 0.38]]) { const w = k.cyl(0.2, 0.2, 0.08, wood, dx, 0.2, dz, gun, 12); w.rotation.x = P / 2; }
  const brl = k.cyl(0.16, 0.21, 2.0, iron, -0.45, 0.72, 0, gun, 14); brl.rotation.z = P / 2 - 0.05;
  for (let i = 0; i < 6; i++) k.sph(0.09, iron, -1.0 + (i % 3) * 0.19 + (i > 2 ? 0.1 : 0), 0.09 + (i > 2 ? 0.15 : 0), 5.75 + (i > 2 ? 0.1 : 0), deco, 8, 6);
  // torches on the parapet (warm key on the duellists)
  for (const z of [-3.9, 2.9]) {
    k.box(0.08, 0.5, 0.08, iron, PX + 0.55, 1.75, z, deco);
    k.cyl(0.05, 0.03, 0.4, wood, PX + 0.6, 2.1, z, deco, 6);
    k.fire(PX + 0.6, 2.28, z, live, { light: 10, scale: 0.28 });
  }
  // the sea far below, moon glitter, a ship riding at anchor with her lantern lit
  const sea = k.mesh(new THREE.PlaneGeometry(1600, 1600), k.mat('#ffffff', { map: k.tiled(k._ctex(seaCanvas(r)), 80, 80), rough: 0.3, metal: 0.2 }), -400, -15, 0, s); sea.rotation.x = -P / 2;
  const gl = k.mesh(new THREE.PlaneGeometry(60, 340), k.basic('#ffffff', { map: k._ctex(glitterCanvas(r), false), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 }), 0, -14.9, 0, s);
  gl.rotation.x = -P / 2; gl.rotation.z = Math.atan2(-mdir.x, -mdir.z); gl.position.set(mdir.x * 200, -14.9, mdir.z * 200);
  const hm = k.mat('#0c0c12', { rough: 1 });
  const ship = new THREE.Group(); ship.position.set(-150, -15, 40); ship.rotation.y = 0.4; deco.add(ship);
  k.box(4, 2.2, 16, hm, 0, 0.8, 0, ship); for (const [z, h] of [[-4, 14], [1.5, 17], [6, 12]]) { k.cyl(0.15, 0.2, h, hm, 0, h / 2, z, ship, 5); k.box(0.2, h * 0.45, 4.2, k.mat('#1a1c26', { rough: 1 }), 0, h * 0.62, z, ship); }
  k.glow('#ffc070', 4, 0, 3, -8, ship, 0.9);
  const head = k.mesh(new THREE.SphereGeometry(60, 16, 8, 0, TAU, 0, P / 2), hm, -500, -15, -240, s); head.scale.set(3, 0.6, 1.2);
  bakeStatic(k, deco);
  // the night watch gathers at the tower end
  st.crowd = [
    { x: -1.5, z: -6.0, look: guardLook(r, o.faction), side: -1, calm: true }, { x: -0.4, z: -6.9, look: guardLook(r, o.faction), side: -1 },
    { x: -1.6, z: 6.1, look: guardLook(r, o.faction), side: -1, calm: true },
  ];
  Object.assign(st, { rim: new THREE.Color(0.58, 0.66, 1.0), exposure: 1.45, railLabel: 'The rampart',
    pressed: { win: 'Backed against the parapet, he throws down his sword!', lose: 'Backed against the parapet, you lay down your arms!' } });
  return st;
}

const BUILD = { tavern, rampart };

export function buildDuelStage(kind, { game, faction = 'english', seed = 7, hour = null } = {}) {
  const B = BUILD[kind]; if (!B) return null;
  const k = new Kit(9100 + kind.length * 37 + (seed % 97));
  const s = new THREE.Scene();
  const root = new THREE.Group(); root.name = 'duelStage'; s.add(root);
  const st = { kind, kit: k, scene: s, root, lineLen: 9, halfW: 4, crowd: [], brawls: [], introK: 0.12, cam: { h: -0.35, lookH: 0.03 } };
  B(k, s, st, { faction, seed, game, hour: hour ?? game?.sky?.timeOfDay ?? 22 });
  // image-based light baked from the set itself (lanterns, fire, night sky): steel and brass reflect the place
  // instead of turning black, and the bounce light ties the figures into it. Done before the duel root is filled.
  const r = game?.renderer;
  if (r) try {
    const pm = new THREE.PMREMGenerator(r), sh = r.shadowMap.enabled; r.shadowMap.enabled = true;
    const rt = pm.fromScene(s, 0.04, 0.1, 600, { size: 128, position: new THREE.Vector3(2.5, 1.7, 0) });
    r.shadowMap.enabled = sh; pm.dispose();
    s.environment = rt.texture; s.environmentIntensity = st.envI ?? 0.9; k._track(rt);
  } catch (e) { console.warn('duel stage env', e); }
  // contact flash: one point light kept in the scene (fixed light count: no program rebuild)
  const pop = new THREE.PointLight('#ffd9a0', 0, 9, 2); s.add(pop);
  let popT = 0, popI = 0;
  st.pop = (pos, i = 16) => { pop.position.copy(pos); popI = i * 0.35; popT = 0.12; };
  const t0 = performance.now(); let last = t0;
  st.update = (tt, dt) => {
    for (const u of k.updaters) u(tt, dt);
    popT = Math.max(0, popT - dt); pop.intensity = popT > 0 ? popI * popT / 0.12 : 0;
  };
  st.render = (r, cam) => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    st.update((now - t0) / 1000, dt);
    const ex = r.toneMappingExposure, sh = r.shadowMap.enabled;
    r.toneMappingExposure = st.exposure ?? 1.2; r.shadowMap.enabled = true; r.shadowMap.needsUpdate = true;
    r.render(s, cam);
    r.toneMappingExposure = ex; r.shadowMap.enabled = sh;
  };
  st.dispose = () => {
    k.dispose();
    s.traverse(o => { if (o.isLight) { o.shadow?.map?.dispose?.(); o.dispose?.(); } });
  };
  return st;
}

// ---------------------------------------------------------------- deck dressing by ship (point 3)
// Cargo lashed on a merchantman's deck, shot and powder on a man-of-war's, plunder on a pirate's. Placed beyond the
// two ends of the duel line, against the far bulwark (never between the camera and the duellists), in the hull's
// local frame (heights from the deck raycast `sample(x, z)`). Static: fused by material (~6 draw calls).
//   buildDeckDressing(kind: 'merchant' | 'war' | 'pirate', { sample, zA, zB, zC, hb, seed }) -> { group, dispose() }
export function buildDeckDressing(kind, { sample, zA, zB, zC, hb, seed = 3 }) {
  const k = new Kit(7700 + seed), g = new THREE.Group(); g.name = 'deckDressing';
  const y = (x, z) => sample(x, z) + 0.005;
  const iron = k.mat('#2a2826', { metal: 0.6, rough: 0.45 }), rope = k.mat('#a08a5c', { map: k.tex.cloth, rough: 1 });
  const coil = (x, z) => { const t = k.mesh(new THREE.TorusGeometry(0.28, 0.06, 6, 16), rope, x, y(x, z) + 0.06, z, g); t.rotation.x = P / 2; k.mesh(new THREE.TorusGeometry(0.18, 0.055, 6, 14), rope, x, y(x, z) + 0.15, z, g).rotation.x = P / 2; };
  const zP = Math.max(zB, zC + 4.6) + 0.9, zE = Math.min(zA, zC - 4.6) - 3.6;   // beyond the player's crowd / beyond the brawls
  const xr = -hb * 0.7, xm = -hb * 0.4, xb = -hb * 0.84;                        // xb: a row behind the crews, against the far rail
  const zb = [zC + 2.3, zC - 2.5];
  if (kind === 'merchant') {
    for (const [dx, dz, s, rot] of [[0, 0, 0.62, 0.1], [0, 0.66, 0.6, -0.05], [0.66, 0.3, 0.58, 0.2], [0.05, 0.33, 0.5, 0.4]]) {
      const x = xr + dx, z = zP + dz; k.crate(x, y(x, z) + (s === 0.5 ? 0.6 : 0), z, s, g, rot);
    }
    for (const [dx, dz] of [[0.9, 1.5], [0.25, 1.75], [1.4, 1.05]]) { const x = xr + dx, z = zP + dz; k.barrel(x, z, g, { y: y(x, z), s: 0.9 }); }
    for (const [dx, dz, c] of [[1.2, 0.0, '#cdb488'], [1.55, 0.35, '#bfa478'], [1.35, 0.25, '#d8c49a']]) { const x = xr + dx, z = zP + dz; k.sack(x, y(x, z), z, g, c); }
    k.barrel(xr + 0.2, zE, g, { y: y(xr + 0.2, zE), lying: true, s: 0.9 }); k.crate(xr + 0.2, y(xr + 0.2, zE - 0.9), zE - 0.9, 0.6, g, 0.3);
    coil(xm + 0.6, zP + 0.4);
    k.crate(xb, y(xb, zb[0]), zb[0], 0.7, g, 0.15); k.crate(xb, y(xb, zb[0]) + 0.7, zb[0] + 0.05, 0.55, g, -0.2); k.sack(xb + 0.1, y(xb, zb[0] + 0.7), zb[0] + 0.7, g, '#cdb488');
    k.barrel(xb, zb[1], g, { y: y(xb, zb[1]), s: 0.95 }); k.barrel(xb + 0.05, zb[1] - 0.75, g, { y: y(xb, zb[1] - 0.75), s: 0.95 });
  } else if (kind === 'war') {
    const shotPile = (x0, z0) => {   // a pyramid of round shot in its rack
      k.box(0.9, 0.08, 0.9, k.mat('#5a3a1c', { map: k.tex.darkPlanks }), x0, y(x0, z0) + 0.04, z0, g);
      let lvl = 0; for (const n of [3, 2, 1]) { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) k.sph(0.12, iron, x0 + (i - (n - 1) / 2) * 0.24, y(x0, z0) + 0.2 + lvl * 0.2, z0 + (j - (n - 1) / 2) * 0.24, g, 10, 7); lvl++; }
    };
    shotPile(xr + 0.2, zP + 0.2); shotPile(xr + 0.25, zE); shotPile(xb, zb[0]); shotPile(xb, zb[1]);
    const keg = k.mat('#3a2a1a', { map: k.tex.darkPlanks });
    for (const [dx, dz] of [[1.0, 0.1], [1.0, 0.75], [1.5, 0.45]]) { const x = xr + dx, z = zP + dz; const b = k.barrel(x, z, g, { y: y(x, z), s: 0.62 }); b.traverse(o => { if (o.isMesh && o.material !== iron && o.geometry.type === 'LatheGeometry') o.material = keg; }); }
    for (const [dx, a] of [[0.0, 0.12], [0.25, -0.1]]) {   // rammer and sponge leaning on the bulwark
      const x = -hb * 0.86 + dx * 0.2, z = zP + 1.3 + dx; const st = k.cyl(0.025, 0.025, 2.6, k.mat('#8a6a42', { map: k.tex.planks }), x, y(x, z) + 1.25, z, g, 6); st.rotation.z = -0.32; st.rotation.x = a;
      k.cyl(0.07, 0.07, 0.22, a > 0 ? k.mat('#3a3020', { map: k.tex.cloth }) : k.mat('#6a4a2a', { map: k.tex.darkPlanks }), x - 0.45, y(x, z) + 2.48, z + a * 1.2, g, 8).rotation.z = -0.32;
    }
    const x = xm + 0.7, z = zP + 0.9; k.cyl(0.16, 0.13, 0.3, k.mat('#6a4a2a', { map: k.tex.darkPlanks }), x, y(x, z) + 0.15, z, g, 10);   // match tub
  } else if (kind === 'pirate') {
    const x = xr + 0.3, z = zP + 0.3;   // a looted chest, brass-bound, lid ajar, with a rum keg and a spilt sack
    k.box(0.8, 0.45, 0.5, k.mat('#6a3e1e', { map: k.tex.darkPlanks }), x, y(x, z) + 0.23, z, g).rotation.y = 0.25;
    const lid = k.box(0.82, 0.08, 0.52, k.mat('#6a3e1e', { map: k.tex.darkPlanks }), x - 0.06, y(x, z) + 0.62, z - 0.2, g); lid.rotation.set(-0.9, 0.25, 0);
    k.box(0.84, 0.05, 0.06, k.mat('#c9a24a', { metal: 0.7, rough: 0.35 }), x, y(x, z) + 0.3, z + 0.02, g).rotation.y = 0.25;
    for (let i = 0; i < 9; i++) k.cyl(0.04, 0.04, 0.012, k.mat('#e8c060', { metal: 0.9, rough: 0.25 }), x + 0.5 + (k.r() - 0.5) * 0.5, y(x, z) + 0.01, z + 0.3 + (k.r() - 0.5) * 0.5, g, 10);
    k.barrel(xr + 1.1, zP + 1.2, g, { y: y(xr + 1.1, zP + 1.2), s: 0.85 }); k.barrel(xr + 0.3, zE, g, { y: y(xr + 0.3, zE), s: 0.85 });
    k.sack(xr + 1.3, y(xr + 1.3, zP + 0.2), zP + 0.2, g, '#bfa478');
    coil(xm + 0.6, zE + 0.5);
    k.barrel(xb, zb[0], g, { y: y(xb, zb[0]), s: 0.9 }); k.barrel(xb, zb[1], g, { y: y(xb, zb[1]), lying: true, s: 0.9 });
  }
  bakeStatic(k, g);
  return { group: g, dispose: () => k.dispose() };
}
