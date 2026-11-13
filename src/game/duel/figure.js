// Procedural sculpted characters (duel captains, deck crews and port NPCs) with a joint hierarchy and a pose blender.
//   const f = new CaptainFigure({ coat:'#7a1e1e', trim:'#d8b05a', hat:'tricorn'|'bicorne'|'bandana'|'cap'|'wig'|'bonnet'|'morion'|'wide'|'none',
//                                 beard, skin, seed, scale, sailor, expr:'fierce'|'smile'|'stern'|'calm', eyes,
//                                 dress, bodice, apron, breastplate, sleeves:'rolled', tool:'halberd'|'hammer'|'quill'|'mug'|'musket', sword,
//                                 sheathed (sword in a scabbard at the left hip, both hands free), lite (see below),
//                                 v2 (second-generation captain: see figureV2.js; coated men only) })
//   f.group (feet at y=0, faces +Z, right hand = -X)       f.sword (blade mesh group) ; f.tip / f.hilt Object3Ds
//   f.apply(pose)  pose: { joint: [x,y,z] } radians, plus rootPos, hipsY     f.capture()     f.flash(k)   f.dispose()
//   f.j.prop: a bone in the left hand carrying the tool (only with o.tool / o.mug), so an animator can turn the tool
//   (a musket shouldered or at port arms) independently of the hand.
// Stylised "heroic" proportions: head ~1.16x, hands ~1.25x, V-shaped torso, sculpted folds. Each part bakes a painted
// ambient-occlusion ramp into a vertex attribute; the shared material adds a height gradient and a warm rim light.
// One SkinnedMesh per material kind (skin, cloth, coat, leather, metal, steel): ~6 draw calls per character.
// o.lite (figures seen from far above, e.g. the night town): one untextured vertex-coloured material for every part
// and no eyes, teeth or finger nails: one draw call (plus its ink contour and its shadow); the material is the
// caller's (liteFigureMaterials), shared by every lite figure of a scene and disposed with it.
import * as THREE from 'three';
import { mulberry32 } from '../../core/rng.js';
import { clothTex, coatTex, leatherTex, skinTex, steelTex, stripeTex } from './textures.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { coatV2, sashV2, cuffV2, bootTopV2, hairV2, moustacheV2, plumeV2 } from './figureV2.js';

const V2 = THREE.Vector2;

// painted look shared by every character material: AO attribute, figure-height gradient, rim light
export const FIGURE_RIM = { value: new THREE.Color(0.42, 0.34, 0.26) };
// a light of their own for the characters (a figure painter's lamp at the camera): lifts the faces out of the
// hat's shadow, a backlit crowd or a night deck. 0 = off; each scene sets it around its render (setFigureFill).
export const FIGURE_FILL = { value: new THREE.Color(0, 0, 0) };
export function setFigureFill(k, col = '#ffe9d2') { const prev = FIGURE_FILL.value.clone(); FIGURE_FILL.value.set(col).multiplyScalar(k); return prev; }
// wrapped diffuse with a warm terminator — light bleeding into the shadow side like flesh does,
// instead of the hard plastic falloff — and warm (not cool) painted cavities
const SKIN_LIGHT = THREE.ShaderChunk.lights_physical_pars_fragment.replace('vec3 irradiance = dotNL * directLight.color;', `
	float rawNL = dot( geometryNormal, directLight.direction );
	float wrapNL = saturate( ( rawNL + 0.42 ) / 1.42 );
	vec3 irradiance = mix( wrapNL * vec3( 1.0, 0.68, 0.58 ), vec3( wrapNL ), smoothstep( -0.25, 0.22, rawNL ) ) * directLight.color;`)
  // the wrap is for the diffuse only: the GGX lobe keeps the true N·L, or a backlit face (N·L ≈ 0, grazing view) gets a
  // huge specular — white bloom stars on the faces and fists of a crowd standing against the low sun
  .replace('reflectedLight.directSpecular += irradiance * specularBRDF', 'reflectedLight.directSpecular += dotNL * directLight.color * specularBRDF');
function painterly(m, kind = '') {
  const skinK = kind === 'skin';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = FIGURE_RIM; sh.uniforms.uFill = FIGURE_FILL;
    if (skinK) sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', SKIN_LIGHT);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float ao;\nvarying float vAO;\nvarying float vH;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAO = ao; vH = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;\nuniform vec3 uFill;\nvarying float vAO;\nvarying float vH;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        // painted AO + a soft dark-to-light ramp from the boots to the shoulders, cool in the cavities
        float hg = mix(0.74, 1.06, smoothstep(0.05, 1.65, vH));
        diffuseColor.rgb *= vAO * hg;
        diffuseColor.rgb = mix(diffuseColor.rgb * ${skinK ? 'vec3(1.04, 0.84, 0.8)' : 'vec3(0.86, 0.9, 1.06)'}, diffuseColor.rgb, smoothstep(0.55, 0.95, vAO));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fr = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
        totalEmissiveRadiance += uRim * pow(fr, 2.6) * (0.25 + diffuseColor.rgb) * smoothstep(0.6, 1.0, vAO);
        // the figures' own lamp, from the camera: strongest on what faces the viewer (faces, chests), never in the folds
        totalEmissiveRadiance += uFill * diffuseColor.rgb * (0.35 + 0.65 * saturate(normal.z)) * smoothstep(0.45, 0.9, vAO);`);
  };
  m.customProgramCacheKey = () => 'figure-painterly-5' + (skinK ? '-skin' : '');
  return m;
}

// inverted-hull ink contour for skinned figures: back faces pushed out along the skinned normal (per-vertex weight olw)
// far: seen from far above (lite figures of the night town): the width keeps growing with the distance, never fades
function outlineMaterial(color, width, far = false) {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uOl = { value: width };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float olw;\nuniform float uOl;')
      // about the same width on screen near or far (×1 at 4,5 m, up to ×2.2), fading out past 20 m
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
        float olDz = -(modelViewMatrix * vec4(transformed, 1.0)).z;
        transformed += normalize(objectNormal) * uOl * olw * ${far ? 'max(olDz / 4.5, 0.6)' : 'clamp(olDz / 4.5, 0.6, 2.2) * (1.0 - smoothstep(20.0, 32.0, olDz))'};`);
  };
  m.customProgramCacheKey = () => 'figure-outline-2' + (far ? '-far' : '');
  return m;
}

// the shared materials of lite figures (o.lite = this object): painted vertex colours, one ink contour.
// The caller owns them: dispose() when its scene goes.
export function liteFigureMaterials({ outline = '#1c120a', outlineW = 0.0022, roughness = 0.82 } = {}) {
  const mat = painterly(new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0 }), 'lite');
  const ol = outline ? outlineMaterial(outline, outlineW, true) : null;
  return { mat, outline: ol, dispose() { mat.dispose(); ol?.dispose(); } };
}

// level of detail of the figure being built (o.detail, 0.4–1): every segment count below scales with it. Close
// figures (duellists, portraits) keep 1; crowds and port extras use DETAIL_EXTRA.
export const DETAIL_EXTRA = 0.55;
let DET = 1;
const dq = (n, min) => Math.max(min, Math.round(n * DET));
const sphere = (r, w = 32, h = 16, ...a) => new THREE.SphereGeometry(r, dq(w, 6), dq(h, 4), ...a);
const torus = (r, t, rs = 12, ts = 48, ...a) => new THREE.TorusGeometry(r, t, dq(rs, 4), dq(ts, 6), ...a);

function lathe(profile, seg = 14, { sx = 1, sz = 1, phi0 = 0, phiLen = Math.PI * 2 } = {}) {
  const pts = profile.map(([y, r]) => new V2(Math.max(0.001, r), y));
  const g = new THREE.LatheGeometry(pts, dq(seg, phiLen < Math.PI ? 3 : 8), phi0, phiLen);
  if (sx !== 1 || sz !== 1) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { p.setX(i, p.getX(i) * sx); p.setZ(i, p.getZ(i) * sz); } }
  g.computeVertexNormals();
  return g;
}
// a limb hanging from its joint (y = 0) down to -len. radii: [[f, r]…], f = 0 at the joint, 1 at the far end.
// the profile is resampled into `rings` smooth rings (it used to be 4–5), with rounded caps, so the limb
// bends without kinks under the blended joint skinning (part option sk, see _bake) and reads as cloth over a limb.
function limb(len, radii, seg = 10, sq = [1, 1], rings = 14) {
  const prof = [];
  rings = dq(rings, 7);
  for (let i = 0; i <= rings; i++) {
    const f = i / rings;
    let k = 0; while (k < radii.length - 2 && radii[k + 1][0] < f) k++;
    const [f0, r0] = radii[k], [f1, r1] = radii[k + 1];
    const t = Math.min(1, Math.max(0, (f - f0) / Math.max(1e-6, f1 - f0))), tt = t * t * (3 - 2 * t);
    prof.push([-f * len, r0 + (r1 - r0) * tt]);
  }
  const r0 = radii[0][1], r1 = radii[radii.length - 1][1];
  prof.unshift([r0 * 0.42, r0 * 0.72], [r0 * 0.6, 0.001]);
  prof.push([-len - r1 * 0.42, r1 * 0.72], [-len - r1 * 0.6, 0.001]);
  // lathe wants the profile from bottom to top
  prof.sort((p, q) => p[0] - q[0]);
  return lathe(prof, seg, { sx: sq[0], sz: sq[1] });
}
const _sv = new THREE.Vector3();
function sculpt(g, fn) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { _sv.fromBufferAttribute(p, i); fn(_sv); p.setXYZ(i, _sv.x, _sv.y, _sv.z); }
  g.computeVertexNormals();
  return g;
}
// hair cap cut along a hairline: below h(angle) a vertex is lifted onto the line (front = forehead, side = temples,
// back = nape; y relative to the cap's centre, sphere radius R)
// (rows are remapped, not clamped: no collapsed vertices, so no degenerate triangles or NaN normals)
function hairline(R, front, side, back, thetaMax) {
  return v => {
    const r = Math.hypot(v.x, v.z), a = Math.atan2(v.x, v.z), c = Math.cos(a), h = side + ((c > 0 ? front : back) - side) * c * c;
    const th = Math.acos(Math.max(-1, Math.min(1, v.y / R))), cut = Math.acos(Math.max(-1, Math.min(1, h / R)));
    const t2 = th * cut / thetaMax, dx = r > 1e-6 ? v.x / r : Math.sin(a), dz = r > 1e-6 ? v.z / r : Math.cos(a);
    v.set(R * Math.sin(t2) * dx, R * Math.cos(t2), R * Math.sin(t2) * dz);
  };
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const bump = (x, c, w) => Math.exp(-((x - c) * (x - c)) / (w * w));

// fabric folds around a lathe: radial ridges growing with depth below `y0`, plus their painted AO
const folds = (n, amp, y0, y1, ph = 0) => ({
  shape: v => { const t = smooth(y0, y1, -v.y + y0 * 0 ); const a = Math.atan2(v.x, v.z); const k = 1 + amp * t * Math.sin(a * n + ph + Math.sin(a * 3) * 0.6); v.x *= k; v.z *= k; },
  ao: v => { const t = smooth(y0, y1, -v.y); const a = Math.atan2(v.x, v.z); return 1 - 0.22 * t * (0.5 - 0.5 * Math.sin(a * n + ph + Math.sin(a * 3) * 0.6)); },
});

export class CaptainFigure {
  constructor(o = {}) {
    const rnd = mulberry32(o.seed || 7);
    this.o = o;
    DET = Math.min(1, Math.max(0.4, o.detail ?? 1));
    const S = o.scale || 1;
    const g = this.group = new THREE.Group();
    const M = (color, { kind = 'cloth' } = {}) => ({ kind, color: new THREE.Color(color) });
    const skinHex = o.skin || '#c98d62';
    const skin = M(skinHex, { kind: 'skin' });
    const rosy = M(new THREE.Color(skinHex).lerp(new THREE.Color('#c0503c'), 0.22), { kind: 'skin' });
    const shade = M(new THREE.Color(skinHex).multiplyScalar(0.62), { kind: 'skin' });
    const nailM = M(new THREE.Color(skinHex).lerp(new THREE.Color('#f6dcd2'), 0.6), { kind: 'skin' });   // finger nails
    const coat = { kind: 'coat', color: new THREE.Color(o.sailor ? (o.coat || '#e9e1cc') : o.lite ? (o.coat || '#7a1e1e') : '#ffffff') };   // the coat texture carries the colour (not on lite figures)
    const coatPlain = M(o.coat || '#7a1e1e');
    const shirt = M(o.shirt || '#e8dfc8');
    const breeches = M(o.breeches || '#c8b48a');
    const boot = M(o.boot || '#2a1a10', { kind: 'leather' });
    const belt = M('#3a2414', { kind: 'leather' });
    const brass = M(o.trim || '#d8b05a', { kind: 'metal' });
    const hatM = M(o.hatColor || '#1d1612');
    const hair = M(o.hair || '#2b1d14');
    const steel = M('#ccd3db', { kind: 'steel' });
    // armour and tools (morion, breastplate, halberd): with the brass (kind metal), not with the blade — the night glow
    // given to blades (duelScene, em0) burnt the guards' breastplates white
    const iron = M('#7e858d', { kind: 'metal' });
    this._parts = [];
    // a part: geometry + material kind; `ao` = { lo (AO at the part's bottom), fn(v) per-vertex multiplier }
    let olOff = false;   // face features carry no ink contour (it would smudge the eyes and mouth)
    const mesh = (geo, m, parent, pos, ao) => { const x = new THREE.Object3D(); if (pos) x.position.set(...pos); parent.add(x); this._parts.push({ geo, m, node: x, ao, ol: olOff ? 0 : 1 }); return x; };
    const J = (name, parent, pos) => { const j = new THREE.Bone(); j.name = name; j.position.set(...pos); parent.add(j); this.j[name] = j; return j; };
    this.j = {};

    const bulk = o.bulk ?? (0.97 + rnd() * 0.14);
    const coated = !o.sailor || o.jacket;
    const dress = !!o.dress;
    const v2 = !!o.v2 && coated && !dress && !o.lite;
    // ---- skeleton (metres; a 1.78 m captain). Joint lengths are what the fencing IK expects: keep them. ----
    const root = J('root', g, [0, 0, 0]);
    const hips = J('hips', root, [0, 0.98, 0]);
    const spine = J('spine', hips, [0, 0.1, 0]);
    const chest = J('chest', spine, [0, 0.24, 0]);
    const neck = J('neck', chest, [0, 0.27, 0.01]);
    const head = J('head', neck, [0, o.dress ? 0.076 : 0.09, 0.01]);   // a shorter neck on the ladies
    const shW = (dress ? 0.18 : 0.205) * bulk;
    const rSh = J('rShoulder', chest, [-shW, 0.2, 0]);
    const rEl = J('rElbow', rSh, [0, -0.29, 0]);
    const rWr = J('rWrist', rEl, [0, -0.26, 0]);
    const lSh = J('lShoulder', chest, [shW, 0.2, 0]);
    const lEl = J('lElbow', lSh, [0, -0.29, 0]);
    const lWr = J('lWrist', lEl, [0, -0.25, 0]);
    const rHip = J('rHip', hips, [-0.1, -0.02, 0]);
    const rKn = J('rKnee', rHip, [0, -0.45, 0]);
    const rAn = J('rAnkle', rKn, [0, -0.45, 0]);
    const lHip = J('lHip', hips, [0.1, -0.02, 0]);
    const lKn = J('lKnee', lHip, [0, -0.45, 0]);
    const lAn = J('lAnkle', lKn, [0, -0.45, 0]);

    // heroic V torso: wide at the shoulders, narrow waist, pectorals and shoulder blades
    const torsoShape = (k = 1) => v => {
      const y = v.y, a = Math.atan2(v.x, v.z), front = Math.cos(a);
      const w = 0.9 + 0.26 * smooth(0.05, 0.42, y) - 0.08 * smooth(0.46, 0.56, y);
      v.x *= w * (dress ? 0.92 : 1);
      if (!dress) v.z *= 1 + k * 0.09 * bump(y, 0.36, 0.08) * Math.max(0, front) * (0.6 + 0.4 * Math.abs(Math.sin(a * 2)));   // pecs
      else v.z *= 1 + 0.12 * bump(y, 0.34, 0.07) * Math.max(0, front);
      v.z *= 1 + 0.05 * bump(y, 0.36, 0.1) * Math.max(0, -front);                                                      // blades
      v.z *= 1 - 0.06 * bump(y, 0.1, 0.08);                                                                             // waist
    };
    const K = v2 ? { mesh, M, o, bulk, torsoShape, lathe, sculpt, sphere, torus, smooth, bump, folds, j: this.j, mats: {
      shirt, coatPlain, belt, boot, brass, iron, hair, lapel: M(o.lapel || o.trim || '#d8b05a'), waistcoat: M(o.waistcoat || o.lapel || '#c8a868'),
      wood: M('#5a3a1c', { kind: 'leather' }), sash: M(o.sash || '#b08a3c'), plume: M(o.plume || '#efe6d2') } } : null;
    // ---- pelvis / breeches seat ----
    // (round 11: rounder and shorter below — the old seat hung between the thighs in a flat triangle, a nappy; a lady's
    // stays inside her bodice and skirt, or it showed as a band at the waist)
    if (dress) mesh(lathe([[-0.06, 0.001], [-0.05, 0.11], [0.02, 0.122], [0.12, 0.115]], 14, { sz: 0.74 }), M(o.dress), hips, null, { lo: 0.7 });
    else mesh(lathe([[-0.075, 0.001], [-0.065, 0.12], [-0.03, 0.155], [0.02, 0.166], [0.12, 0.155], [0.2, 0.15]], 16, { sx: bulk, sz: 0.8 }), breeches, hips, null, { lo: 0.7 });
    // ---- shirt / waistcoat core ----
    if (!dress) mesh(sculpt(lathe([[-0.02, 0.15], [0.12, 0.152], [0.28, 0.172], [0.42, 0.186], [0.5, 0.165], [0.54, 0.09], [0.555, 0.001]], 30, { sx: bulk * 1.02, sz: 0.72 }), torsoShape()),
      shirt, spine, [0, -0.02, 0], { lo: 0.78 });
    else {
      // a laced bodice — corseted waist, a bust, a low square-ish neckline over bare shoulders and throat —
      // instead of the men's V torso painted in the dress colour
      // the bodice runs down to a point in front over the skirt (a stomacher), so no band shows at the waist
      const bod = v => {
        const a = Math.atan2(v.x, v.z), fr = Math.max(0, Math.cos(a));
        v.z *= 1 + 0.16 * bump(v.y, 0.33, 0.06) * fr; v.x *= 0.94;
        if (v.y < 0.0) v.y -= 0.075 * Math.pow(fr, 3);
      };
      mesh(sculpt(lathe([[-0.05, 0.142], [-0.02, 0.137], [0.08, 0.128], [0.2, 0.146], [0.3, 0.165], [0.37, 0.168], [0.415, 0.16], [0.425, 0.12]], 30, { sz: 0.76 }), bod),
        M(o.bodice || '#5a2a3a'), spine, [0, -0.02, 0], { lo: 0.78 });
      mesh(sculpt(lathe([[0.36, 0.152], [0.43, 0.152], [0.48, 0.14], [0.53, 0.1], [0.56, 0.045], [0.565, 0.001]], 30, { sx: 1.0, sz: 0.7 }), v => { v.x *= 1 + 0.12 * smooth(0.45, 0.52, v.y); }),
        skin, spine, [0, -0.02, 0], { lo: 0.9, col: () => [1.02, 0.95, 0.94] });
      // chemise lace along the neckline, a ribbon at the breast
      mesh(sculpt(torus(0.152, 0.011, 6, 40).rotateX(Math.PI / 2).scale(0.95, 1, 0.75), v => { v.y += 0.004 * Math.sin(Math.atan2(v.x, v.z) * 26); }), shirt, spine, [0, 0.405, 0], { lo: 0.9 });
      mesh(sphere(0.018, 10, 8).scale(1.4, 0.8, 0.6), M(o.ribbon || o.trim || '#c9a24a'), spine, [0, 0.39, 0.118]);
    }
    if (o.breastplate) {
      mesh(sculpt(lathe([[0.02, 0.17], [0.16, 0.18], [0.3, 0.195], [0.42, 0.2], [0.5, 0.17]], 18, { sx: bulk * 1.06, sz: 0.8 }), torsoShape(1.3)), iron, spine, [0, -0.01, 0], { lo: 0.7 });
    }
    if (dress) {
      // the gown on its own bone. A lady (no apron) wears a petticoat of
      // another colour under an open robe: the robe parts in front in an inverted V, its edges turned back in a light
      // trim, over side hoops that square the hips; deep folds fall from the waist. A working woman keeps one skirt.
      const gown = J('gown', hips, [0, 0.06, 0]);
      const fancy = !o.apron;
      const dc = new THREE.Color(o.dress);
      const pcol = o.petticoat || '#' + dc.clone().lerp(new THREE.Color('#efe2c4'), 0.62).getHexString();
      const prof = fancy
        ? [[-0.99, 0.47], [-0.8, 0.44], [-0.55, 0.4], [-0.3, 0.36], [-0.15, 0.31], [-0.06, 0.22], [0.0, 0.16], [0.04, 0.138]]
        : [[-0.99, 0.43], [-0.75, 0.37], [-0.45, 0.28], [-0.2, 0.2], [-0.04, 0.16], [0.04, 0.14]];
      const fp = folds(fancy ? 18 : 12, fancy ? 0.022 : 0.06, 0.08, 0.9, 0.4);
      const sway = v => { v.z *= 0.94; };
      // (round 11: under a robe the petticoat is a little narrower and 1 cm shorter, or its folds poke through the robe's)
      const pprof = fancy ? prof.map(([y, r]) => [y < -0.95 ? y + 0.01 : y, r - 0.034 * smooth(0.0, -0.5, y)]) : prof;
      mesh(sculpt(lathe(pprof, 44), v => { fp.shape(v); sway(v); }), fancy ? M(pcol) : M(o.dress), gown, [0, -0.06, 0], { lo: 0.66,
        fn: v => fp.ao(v) * (1 - 0.1 * bump(v.y, -0.9, 0.03)) });                                       // a flounce line near the hem
      if (fancy) {
        const fr2 = folds(13, 0.06, 0.1, 0.95, 1.3), trimC = new THREE.Color(o.bodice || '#e8dcc0');
        const gap = y => 0.16 + 0.42 * smooth(0.0, -0.95, y);       // half-angle of the opening, waist → hem
        const robe = sculpt(lathe(prof.map(([y, r]) => [y + 0.005, r + 0.014 + 0.012 * smooth(-0.1, -0.8, y)]), 52), v => {
          fr2.shape(v); sway(v);
          const r = Math.hypot(v.x, v.z), a = Math.atan2(v.x, v.z), g = gap(v.y);
          const na = Math.sign(a || 1) * (g + (Math.abs(a) / Math.PI) * (Math.PI - g));
          v.x = r * Math.sin(na); v.z = r * Math.cos(na);
        });
        mesh(robe, M(o.dress), gown, [0, -0.06, 0], { lo: 0.62, fn: fr2.ao,
          // turned-back edge in the trim colour (exact ratio per channel: a clamped one tinted a dark blue robe mint green)
          col: v => { const a = Math.abs(Math.atan2(v.x, v.z)), e = smooth(0.09, 0.0, a - gap(v.y)) * 0.85; return [1 + (trimC.r / Math.max(0.002, dc.r) - 1) * e, 1 + (trimC.g / Math.max(0.002, dc.g) - 1) * e, 1 + (trimC.b / Math.max(0.002, dc.b) - 1) * e]; } });
      }
    } else if (coated) {
      // coat chest shell (open front) + long frock skirts in two tails with folds and a back vent
      const front = Math.PI * 0.16;
      mesh(sculpt(lathe([[0.0, 0.172], [0.14, 0.19], [0.28, 0.203], [0.4, 0.205], [0.49, 0.175], [0.53, 0.1]], 30, { sx: bulk * 1.06, sz: 0.8, phi0: front, phiLen: Math.PI * 2 - front * 2 }), torsoShape(0.8)),
        coatPlain, spine, [0, -0.01, 0], { lo: 0.72 });
      const skirt = J('skirt', hips, [0, 0.06, 0]);
      // longer, flared tails, each on its own bone so they swing and flutter (animator coat spring)
      const skP = v2 ? [[-0.72, 0.3], [-0.55, 0.262], [-0.36, 0.222], [-0.16, 0.19], [0.0, 0.176]] : [[-0.64, 0.262], [-0.5, 0.236], [-0.33, 0.205], [-0.16, 0.18], [0.0, 0.17]];
      for (const [phi0, tn] of [[Math.PI * 0.33, 'tailL'], [Math.PI * 1.04, 'tailR']]) {
        const tail = J(tn, skirt, [0, 0, 0]);
        const f = folds(7, v2 ? 0.13 : 0.09, 0.04, 0.6, phi0 * 3);
        mesh(sculpt(lathe(skP, 14, { sx: bulk * 1.08, sz: 0.84, phi0, phiLen: Math.PI * 0.63 }), f.shape), coat, tail, null, { lo: 0.7, fn: f.ao });
        // turned-back facing along the hem (trim colour), reads as a heavy cloth edge
        mesh(lathe(v2 ? [[-0.725, 0.305], [-0.675, 0.294]] : [[-0.645, 0.266], [-0.6, 0.258]], 14, { sx: bulk * 1.09, sz: 0.85, phi0, phiLen: Math.PI * 0.63 }), M(o.lapel || o.trim || '#d8b05a'), tail, null, { lo: 0.8 });
      }
      if (v2) coatV2(K);
      else {
      const lap = new THREE.BoxGeometry(0.065, 0.36, 0.022);
      for (const s of [-1, 1]) { const l = mesh(lap, M(o.lapel || o.trim || '#d8b05a'), spine, [s * 0.078, 0.32, 0.137]); l.rotation.set(-0.12, 0, s * 0.18); }
      mesh(new THREE.BoxGeometry(0.15, 0.36, 0.02), M(o.waistcoat || o.lapel || '#c8a868'), spine, [0, 0.2, 0.128], { lo: 0.8 }).rotation.x = -0.08;
      }
      // pocket flaps sewn on the skirts (they used to float in front of the breeches, off the open coat)
      for (const [s, tn] of [[1, 'tailL'], [-1, 'tailR']]) {
        const phi = s > 0 ? Math.PI * 0.42 : Math.PI * 1.58, r = 0.19;
        const pf = mesh(sculpt(new THREE.BoxGeometry(0.15, 0.06, 0.016, 6, 2, 1), v => { v.z += 0.02 * (1 - (v.x / 0.075) ** 2) * 0.5; if (v.y < 0) v.x *= 1 - 0.1 * (-v.y / 0.03); }), coatPlain, this.j[tn],
          [Math.sin(phi) * r * bulk * 1.08 + s * 0.006, -0.2, Math.cos(phi) * r * 0.84 + 0.006], { lo: 0.8 });
        pf.rotation.set(0.08, phi, 0);
      }
      const bt = sphere(0.013, 6, 4);
      if (!v2) for (let i = 0; i < 5; i++) for (const s of [-1, 1]) mesh(bt, brass, spine, [s * 0.112, 0.1 + i * 0.07, 0.142]);
      // collar standing at the back of the neck
      if (!v2) mesh(lathe([[0.0, 0.11], [0.06, 0.1]], 14, { sz: 0.85, phi0: Math.PI * 0.6, phiLen: Math.PI * 0.8 }), coatPlain, chest, [0, 0.24, -0.01]);
    } else {
      mesh(sculpt(lathe([[0.0, 0.16], [0.2, 0.182], [0.42, 0.194], [0.52, 0.12]], 28, { sx: bulk * 1.02, sz: 0.76 }), torsoShape(0.9)), coat, spine, [0, -0.01, 0], { lo: 0.74 });
      // open shirt neck: a skin vee
      mesh(new THREE.BoxGeometry(0.07, 0.1, 0.01), skin, spine, [0, 0.47, 0.13]).rotation.x = -0.35;
      // an open sleeveless waistcoat over the shirt (crews, tavern folk) so a white shirt is not the whole figure
      if (o.vest) mesh(sculpt(lathe([[0.0, 0.172], [0.14, 0.19], [0.28, 0.201], [0.4, 0.2], [0.47, 0.175]], 28, { sx: bulk * 1.05, sz: 0.79, phi0: Math.PI * 0.15, phiLen: Math.PI * 1.7 }), torsoShape(0.8)), M(o.vest), spine, [0, -0.01, 0], { lo: 0.72 });
    }
    if (o.apron) {
      const ap = M('#e8e0cc');
      const f = folds(5, 0.0, 0, 1);
      mesh(sculpt(new THREE.CylinderGeometry(0.2, 0.25, 0.62, 10, 4, true, -0.9, 1.8).translate(0, -0.3, 0), v => { v.z *= 0.9; }), ap, hips, [0, 0.12, 0.01], { lo: 0.75, fn: f.ao });
      mesh(new THREE.BoxGeometry(0.22, 0.26, 0.015), ap, spine, [0, 0.16, 0.15], { lo: 0.85 }).rotation.x = -0.12;
    }
    // belt + buckle, baldric for swordsmen, sash for sailors
    if (v2) sashV2(K);
    else if (!dress) {
      mesh(torus(0.165, 0.026, 6, 22).scale(bulk, 1, 0.78).rotateX(Math.PI / 2), belt, hips, [0, 0.12, 0]);
      mesh(new THREE.BoxGeometry(0.075, 0.065, 0.03), brass, hips, [0, 0.12, 0.137]);
    }
    if (v2) { /* baldric: coatV2 */ } else if (!o.sailor && !dress && o.sword !== false) {
      const bald = mesh(torus(0.245, 0.024, 5, 24, Math.PI).scale(1, 1.25, 0.64), belt, chest, [0.01, -0.06, 0.0]);
      bald.rotation.set(0, 0, -0.55);
    } else if (o.sash) {
      mesh(torus(0.17, 0.042, 6, 18).scale(bulk, 1, 0.8).rotateX(Math.PI / 2), M(o.sash), hips, [0, 0.16, 0]);
      mesh(new THREE.CapsuleGeometry(0.03, 0.18, 3, 6).translate(0, -0.1, 0), M(o.sash), hips, [0.12, 0.13, 0.1], { lo: 0.75 }).rotation.z = 0.2;
    }
    // shoulders: deltoid mass, epaulettes with fringe, guard's pauldrons
    const sleeve = dress ? M(o.bodice || '#5a2a3a') : (o.sailor && !o.jacket ? (o.stripes ? coat : shirt) : coatPlain);
    for (const [sh, s] of [[rSh, -1], [lSh, 1]]) {
      // a shoulder cap that slopes into the chest (half-skinned to it) rather than a ball; dresses keep a puff
      if (dress) mesh(sculpt(sphere(0.072, 18, 12).scale(1.08, 0.92, 1.04), v => { const a = Math.atan2(v.x, v.z), k = 1 + 0.03 * Math.sin(a * 8); v.x *= k; v.z *= k; }), sleeve, sh, [s * 0.01, -0.035, 0], { lo: 0.85, sk: { up: 0.06 } });
      else mesh(sculpt(sphere(v2 ? 0.09 : 0.082, 18, 12).scale(1.08, 0.82, 1.02), v => { if (v.y > 0) v.x -= s * v.y * 0.35; }), sleeve, sh, [s * 0.006, -0.03, 0], { lo: 0.85, sk: { up: 0.07 } });
      if (o.epaulette) {
        const e = mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.024, 12), brass, sh, [s * 0.02, 0.05, 0]); e.rotation.z = s * 0.4;
        mesh(new THREE.CylinderGeometry(0.08, 0.085, 0.05, 12, 1, true), brass, sh, [s * 0.03, 0.02, 0], { lo: 0.6 }).rotation.z = s * 0.4;
      }
      if (o.breastplate) mesh(sphere(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1.1, 0.7, 1.05), iron, sh, [s * 0.02, 0.0, 0]);
    }

    // ---- arms ----
    const swordWr = o.sword !== false && !o.tool && !o.sheathed ? (o.lefty ? lWr : rWr) : null;
    const rolled = o.sleeves === 'rolled' || (o.sailor && !o.jacket) || dress;   // dresses: elbow sleeves, lace, bare forearms
    for (const [sh, el, wr, s] of [[rSh, rEl, rWr, -1], [lSh, lEl, lWr, 1]]) {
      // sleeves are cloth over an arm: a fuller upper sleeve (shoulder cap, bicep) gathering into soft
      // creases at the inner elbow, and the elbow skinned half-way into both bones so the arm bends as one piece
      const elbowAO = { lo: 0.78, fn: v => 1 - 0.18 * bump(v.y, -0.27, 0.05) - 0.12 * bump(v.y, -0.25, 0.04) * Math.max(0, v.z) * 12, sk: { dn: [el, 0.29, 0.075] } };
      mesh(sculpt(limb(0.29, [[0, 0.082], [0.18, 0.08], [0.45, 0.074], [0.8, 0.064], [1, 0.06]], 14), v => {
        const f = -v.y / 0.29, a = Math.atan2(v.x, v.z);
        const k = 1 + 0.07 * bump(f, 0.45, 0.22) * Math.max(0, Math.cos(a))                                    // bicep / full sleeve front
          + 0.035 * bump(f, 0.86, 0.1) * Math.sin(a * 5 + f * 9) * (0.5 + 0.5 * Math.cos(a));                  // creases at the inner elbow
        v.x *= k; v.z *= k;
      }), sleeve, sh, null, elbowAO);
      if (rolled) {
        mesh(limb(0.26, [[0, 0.052], [0.22, 0.058], [0.7, 0.045], [1, 0.037]], 12), skin, el, null, { lo: 0.86, sk: { up: 0.075 } });
        if (dress) mesh(sculpt(lathe([[-0.07, 0.072], [-0.04, 0.074], [0.0, 0.07], [0.04, 0.064]], 20), v => { const a = Math.atan2(v.x, v.z), k = 1 + 0.08 * Math.sin(a * 12) * smooth(-0.02, -0.07, v.y); v.x *= k; v.z *= k; }), shirt, el, null, { lo: 0.8, sk: { up: 0.075 } });   // lace engageante
        else mesh(lathe([[-0.03, 0.062], [0.0, 0.069], [0.02, 0.07], [0.05, 0.06]], 14), sleeve, el, null, { lo: 0.7, sk: { up: 0.075 } });
      } else {
        mesh(limb(0.26, [[0, 0.056], [0.2, 0.06], [0.65, 0.052], [1, 0.05]], 14), sleeve, el, null, { lo: 0.82, fn: v => 1 - 0.14 * bump(v.y, -0.02, 0.05), sk: { up: 0.075 } });
        if (v2) cuffV2(K, el, s);
        else {
        if (coated && !dress) mesh(lathe([[-0.245, 0.06], [-0.16, 0.066], [-0.13, 0.052]], 14), M(o.lapel || o.trim || '#d8b05a'), el, null, { lo: 0.75 });
        mesh(lathe([[-0.275, 0.032], [-0.255, 0.054], [-0.235, 0.036]], 10), shirt, el);
        }
      }
      // hands rebuilt. The sword hand is a fist closed round the grip (the grip runs along the wrist's +Z,
      // 8.5 cm below it): four finger rings stacked along the grip, the back of the hand on top, the thumb over the
      // guard. Other hands hang relaxed: palm toward the body, fingers in two-joint curls, thumb forward. Chunky
      // (stylised) so they read at the duel camera's distance.
      const hn = new THREE.Object3D(); hn.scale.setScalar(1.25); wr.add(hn);
      if (wr === swordWr || o.fists) buildFist(wr, s, skin, rosy, mesh, wr === swordWr);
      else buildOpenHand(wr, s, skin, rosy, mesh, o.lite ? null : nailM);
      if (coated && !dress && !o.sailor && o.sword !== false) mesh(lathe([[-0.02, 0.05], [0.03, 0.058], [0.075, 0.078]], 16, { sz: 0.85 }), belt, hn, [0, 0.02, 0], { lo: 0.6 });   // swordsmen only
    }

    // ---- legs ----
    if (!dress) for (const [hp, kn, an] of [[rHip, rKn, rAn], [lHip, lKn, lAn]]) {
      // a thigh with mass (full at the top, quadriceps in front, tapering to the knee), breeches gathered at
      // the knee band, and hip / knee skinned across both bones so a lunge bends the leg instead of hinging two sticks
      mesh(sculpt(limb(0.46, [[0, 0.104], [0.2, 0.102], [0.55, 0.087], [0.85, 0.069], [1, 0.064]], 14, [1, 1.05]), v => {
        const f = -v.y / 0.46, a = Math.atan2(v.x, v.z);
        const k = 1 + 0.06 * bump(f, 0.4, 0.25) * Math.max(0, Math.cos(a))                                     // quadriceps
          + 0.03 * bump(f, 0.15, 0.15) * Math.max(0, -Math.cos(a))                                              // seat / hamstring
          + 0.03 * bump(f, 0.9, 0.06) * Math.sin(a * 6);                                                       // breeches gathered at the knee
        v.x *= k; v.z *= k;
      }), breeches, hp, null, { lo: 0.8, fn: v => 1 - 0.15 * bump(v.y, -0.44, 0.05), sk: { up: 0.08, dn: [kn, 0.46, 0.085] } });
      if (o.sailor && !o.boots) {
        mesh(sculpt(limb(0.42, [[0, 0.058], [0.28, 0.064], [0.75, 0.046], [1, 0.04]], 12), v => { const f = -v.y / 0.42; if (v.z < 0) v.z *= 1 + 0.12 * bump(f, 0.3, 0.18); }), M(o.stocking || '#e6dcc4'), kn, null, { lo: 0.7, sk: { up: 0.085 } });   // calf
        mesh(lathe([[-0.02, 0.064], [0.0, 0.07], [0.04, 0.068]], 12), breeches, kn, null, { sk: { up: 0.085 } });
      } else {
        // jackboot: shin with a calf, folded-down cuff, heel
        mesh(sculpt(lathe([[-0.47, 0.054], [-0.38, 0.058], [-0.3, 0.065], [-0.2, 0.07], [-0.12, 0.068], [0.0, 0.075], [0.06, 0.09], [0.11, 0.092]], 16), v => { if (v.z < 0) v.z *= 1 + 0.12 * bump(v.y, -0.22, 0.09); }), boot, kn, null, { lo: 0.62, sk: { up: 0.085 } });
        if (v2) bootTopV2(K, kn);
        else mesh(lathe([[0.04, 0.097], [0.08, 0.102], [0.12, 0.101]], 16), boot, kn, null, { lo: 0.6, sk: { up: 0.085 } });
      }
      // a shaped shoe — instep rising to the ankle, a squared toe, a sole only a few millimetres proud of the
      // upper and a stacked heel (the old flat plank of a sole read as flippers); buckle and tongue on a shoe
      const shoe = !!(o.sailor && !o.boots);
      mesh(sculpt(sphere(0.05, 14, 10).scale(0.98, 0.78, 2.3), v => {
        if (v.y < 0) v.y *= 0.35;                                                   // flat underneath
        const fz = smooth(0.04, 0.11, v.z); v.x *= 1 + 0.12 * fz; v.y *= 1 - 0.35 * fz;   // squared, lower toe
        v.y += 0.018 * smooth(0.02, -0.08, v.z) * (v.y > 0 ? 1 : 0);                // instep rising to the ankle
      }).translate(0, -0.055, 0.075), boot, an, null, { lo: 0.55 });
      mesh(sculpt(new THREE.CapsuleGeometry(0.05, 0.16, 3, 10).rotateX(Math.PI / 2), v => { if (v.z > 0.07) v.x *= 1.08; }).scale(1.02, 0.12, 1.02).translate(0, -0.077, 0.068), belt, an, null, { lo: 0.4 });   // sole
      mesh(new THREE.BoxGeometry(0.068, 0.036, 0.06).translate(0, -0.064, -0.045), belt, an, null, { lo: 0.5 });                 // heel
      if (shoe) {
        mesh(new THREE.BoxGeometry(0.05, 0.05, 0.012).translate(0, -0.02, 0.0).rotateX(-0.5), boot, an, [0, 0, 0.06], { lo: 0.6 });   // tongue
        mesh(new THREE.BoxGeometry(0.046, 0.03, 0.01), brass, an, [0, -0.032, 0.085], { lo: 0.8 }).rotation.x = -0.75;      // buckle
      }
      if (!(o.sailor && !o.boots)) mesh(torus(0.06, 0.012, 5, 12).rotateX(Math.PI / 2).scale(1, 1, 0.8), brass, an, [0, 0.02, 0.07], { lo: 0.7 });   // spur strap buckle
    } else {
      for (const an of [rAn, lAn]) mesh(new THREE.CapsuleGeometry(0.04, 0.12, 3, 8).rotateX(Math.PI / 2).scale(1, 0.7, 1).translate(0, -0.03, 0.06), boot, an, null, { lo: 0.6 });
    }

    // ---- head (sculpted, 1.16x: faces read at duel distance) ----
    const neckR = dress ? 0.048 : 0.058;
    mesh(lathe([[-0.02, neckR], [0.05, neckR * 0.92], [dress ? 0.105 : 0.12, neckR * 0.88]], 12, { sz: 0.92 }), skin, neck, null, { lo: 0.6 });
    if (!dress && !(o.sailor && !o.jacket)) mesh(lathe([[-0.03, 0.078], [0.02, 0.068], [0.075, 0.062]], 12, { sz: 0.9 }), shirt, neck, null, { lo: 0.8 });
    if (!o.sailor && !dress && !v2) { const jb = mesh(new THREE.ConeGeometry(0.055, 0.14, 8, 1, true).scale(1, 1, 0.45).translate(0, -0.065, 0), shirt, neck, [0, 0.0, 0.074], { lo: 0.8 }); jb.rotation.x = 0.28; }
    const hd = new THREE.Object3D(); hd.scale.setScalar(o.headScale || (dress ? 1.1 : v2 ? 1.12 : 1.16)); hd.position.y = -0.01; head.add(hd);
    const eyeY = 0.135, eyeX = 0.04, eyeZ = 0.09;
    // one sculpted head instead of a sphere studded with balls (cheeks, chin, nose, brow bar): cheekbones,
    // chin, brow and jaw are pushed out of a denser sphere, and the colour is painted per vertex (blush, lips, nose
    // tip, under-eye shade, stubble, women's lids) so the face reads as modelled flesh, not a potato head.
    const hg = sphere(0.11, v2 ? 64 : 40, v2 ? 48 : 30);
    // every face its own — nose size, hook or snub, brow ridge, chin, cheekbones, jaw length and, with age,
    // jowls, hollow temples and deeper folds; drawn from a generator of their own so the other picks don't shift.
    // Ladies: a shorter lower face, a small pointed chin, fuller cheeks and lips.
    const fr = mulberry32((((o.seed || 7) * 7919) + 13) >>> 0);
    const grey = /^#(8|9|a|b|c|d|e)[0-9a-f]{5}$/i.test(o.hair || '') && !dress;
    const age = o.age ?? (grey ? 0.75 + fr() * 0.25 : o.hat === 'wig' ? 0.3 + fr() * 0.5 : fr() * fr() * 0.7);
    const F = dress
      ? { nose: 0.82 + fr() * 0.12, hook: 0, snub: 0.25 + fr() * 0.5, brow: 0.4, cheek: 1.25 + fr() * 0.35, chin: 0.55 + fr() * 0.25, chinW: 0.72, jaw: 0.84, age: 0 }
      : { nose: 0.9 + fr() * 0.42, hook: fr() < 0.35 ? 0.5 + fr() * 0.7 : 0, snub: fr() < 0.22 ? 0.4 + fr() * 0.6 : 0, brow: 0.6 + fr() * 0.9,
          cheek: 0.6 + fr() * 0.9, chin: 0.6 + fr() * 0.9, chinW: 0.85 + fr() * 0.6, jaw: 0.92 + fr() * 0.14, age };
    const headAO = v => {   // eye sockets, under the brow, beside the nose, under the jaw
      let k = 1;
      for (const s of [-1, 1]) k -= 0.26 * bump(Math.hypot(v.x - s * eyeX, v.y - eyeY), 0, 0.028) * (v.z > 0.05 ? 1 : 0);
      for (const s of [-1, 1]) k -= (0.1 + 0.12 * F.age) * bump(Math.hypot(v.x - s * 0.026, v.y - 0.075), 0, 0.016) * (v.z > 0.07 ? 1 : 0);   // nasolabial fold, deeper with age
      if (v.y < 0.05) k -= 0.2 * smooth(0.05, -0.02, v.y) * (v.z < 0.06 ? 1 : 0.3);
      return k;
    };
    const g3 = (v, x, y, z, w) => Math.exp(-((v.x - x) ** 2 + (v.y - y) ** 2 + (v.z - z) ** 2) / (w * w));
    const stubble = o.stubble ?? (!dress && !o.beard && (o.sailor || o.hat === 'bandana') && rnd() < 0.6);
    const sk0 = new THREE.Color(skinHex), hc0 = new THREE.Color(o.hair || '#2b1d14');
    const beardTint = [hc0.r / Math.max(0.002, sk0.r), hc0.g / Math.max(0.002, sk0.g), hc0.b / Math.max(0.002, sk0.b)];
    const faceCol = v => {
      let r = 1, gg = 1, b = 1;
      const mixc = (k, c) => { r += (c[0] - r) * k; gg += (c[1] - gg) * k; b += (c[2] - b) * k; };
      mixc(Math.max(g3(v, -0.06, 0.092, 0.074, 0.028), g3(v, 0.06, 0.092, 0.074, 0.028)) * (dress ? 0.6 : 0.42), [1.05, 0.78, 0.74]);   // cheeks
      mixc(g3(v, 0, 0.1, 0.12, 0.018) * 0.35, [1.04, 0.8, 0.76]);                                                                         // nose tip
      mixc(Math.max(g3(v, -eyeX, eyeY - 0.022, 0.094, 0.016), g3(v, eyeX, eyeY - 0.022, 0.094, 0.016)) * (0.22 + 0.2 * F.age), [0.86, 0.8, 0.86]);   // under the eyes
      mixc(g3(v, 0, 0.058, 0.1, 0.016) * (dress ? 0.7 : 0.45), dress ? [0.92, 0.5, 0.5] : [0.9, 0.62, 0.58]);                             // lips
      if (dress) mixc(Math.max(g3(v, -eyeX, eyeY + 0.014, 0.096, 0.015), g3(v, eyeX, eyeY + 0.014, 0.096, 0.015)) * 0.3, [0.86, 0.76, 0.84]);   // lids
      if (dress) mixc(g3(v, 0, 0.026, 0.1, 0.024) * 0.3, [1.07, 1.0, 0.96]);                                                              // a light on the chin
      if (v2) {   // weathered: sun on the nose and cheekbones, deeper sockets, a paler brow under the hat
        mixc(Math.max(g3(v, -0.056, 0.1, 0.08, 0.03), g3(v, 0.056, 0.1, 0.08, 0.03)) * 0.22 + g3(v, 0, 0.11, 0.11, 0.03) * 0.25, [1.08, 0.74, 0.68]);
        mixc(Math.max(g3(v, -eyeX, eyeY + 0.004, 0.09, 0.02), g3(v, eyeX, eyeY + 0.004, 0.09, 0.02)) * 0.3, [0.8, 0.7, 0.72]);
        mixc(g3(v, 0, 0.185, 0.09, 0.04) * 0.2, [1.06, 1.02, 0.98]);
      }
      if (stubble && v.z > -0.02) mixc(smooth(0.08, 0.035, v.y) * 0.34 * (1 - g3(v, 0, 0.058, 0.1, 0.016)), [0.74, 0.74, 0.78]);          // a day's beard
      if (o.beard && v.z > 0) mixc(smooth(0.052, 0.04, v.y) * 0.85, beardTint);                                                            // under a beard: its colour, never a patch of skin
      return [r, gg, b];
    };
    sculpt(hg, v => {
      const y = v.y / 0.11, zf = v.z / 0.11, xf = v.x / 0.11;
      let sx = 0.86, sy = 1.12, sz = 0.98;
      if (y < -0.2) { const k = (-0.2 - y); sx *= 1 - k * (dress ? 0.42 : 0.26); sz *= 1 - k * 0.1 * (zf < 0 ? 2 : 0.4); }       // jaw (square on the men)
      if (zf > 0.5 && y > 0.1 && y < 0.45) sz *= 1 + 0.05 * F.brow;                                                           // brow ridge
      if (zf > 0.55 && Math.abs(y - 0.18) < 0.2 && Math.abs(Math.abs(xf) - 0.36) < 0.18) sz *= 0.95;                      // eye sockets
      if (zf < -0.3) sz *= 0.93;
      if (y < -0.3) sx *= 1 + 0.07 * F.age * smooth(-0.3, -0.75, y) * (zf > -0.2 ? 1 : 0.5);                                // jowls
      v.set(v.x * sx, v.y * sy, v.z * sz);
      if (v.y < -0.055) v.y = -0.055 + (v.y + 0.055) * F.jaw;                                                                 // length of the lower face
      // cheekbones, chin and a temple hollow, as smooth bulges of the one surface
      const ax = Math.abs(v.x), front = smooth(0.0, 0.07, v.z);
      const cheek = Math.exp(-(((ax - 0.056) / 0.026) ** 2 + ((v.y + 0.012) / 0.024) ** 2)) * front;
      v.x += Math.sign(v.x) * cheek * 0.005 * F.cheek; v.z += cheek * 0.006 * F.cheek;
      const cy = -0.055 - 0.03 * F.jaw;
      const chin = Math.exp(-((v.x / (0.026 * F.chinW)) ** 2 + ((v.y - cy) / 0.02) ** 2)) * front;
      v.z += chin * 0.011 * F.chin; v.y -= chin * 0.003;
      const temple = Math.exp(-(((ax - 0.085) / 0.02) ** 2 + ((v.y - 0.04) / 0.03) ** 2)) * smooth(-0.02, 0.04, v.z);
      v.x -= Math.sign(v.x) * temple * (0.004 + 0.004 * F.age);
      if (dress) v.z += 0.0028 * Math.exp(-((v.x / 0.02) ** 2 + ((v.y + 0.05) / 0.009) ** 2)) * front;                       // fuller lips
      if (v2) {
        // set eyes, a brow that overhangs them, a muzzle under the nose and a hollow under the cheekbone
        v.z -= 0.0065 * Math.exp(-(((ax - 0.041) / 0.019) ** 2 + ((v.y - 0.026) / 0.013) ** 2)) * front;
        v.z += 0.004 * F.brow * Math.exp(-(((v.y - 0.05) / 0.011) ** 2)) * front * smooth(0.085, 0.03, ax);
        v.z += 0.005 * Math.exp(-((v.x / 0.034) ** 2 + ((v.y + 0.05) / 0.024) ** 2)) * front;
        v.x -= Math.sign(v.x) * 0.0045 * Math.exp(-(((ax - 0.058) / 0.018) ** 2 + ((v.y + 0.052) / 0.022) ** 2)) * front;
      }
    });
    // painterly face normals: the lower face (narrowed jaw, chin) turned down and caught almost no light from a high key,
    // a grey-brown muzzle that read as a beard on the ladies. Front normals are pulled toward the radial direction from a
    // point behind the mouth, so the face shades as one rounded mask, lit from above but never dark under the nose.
    { const P = hg.attributes.position, N = hg.attributes.normal, n = new THREE.Vector3(), d = new THREE.Vector3();
      for (let i = 0; i < P.count; i++) {
        const w = 0.65 * smooth(0.0, 0.06, P.getZ(i)) * smooth(0.06, -0.02, P.getY(i));
        if (w <= 0) continue;
        d.set(P.getX(i), P.getY(i) + 0.035, P.getZ(i) + 0.05).normalize();
        n.fromBufferAttribute(N, i).lerp(d, w).normalize(); N.setXYZ(i, n.x, n.y, n.z);
      } }
    mesh(hg.translate(0, 0.11, 0), skin, hd, null, { lo: 0.94, fn: headAO, col: faceCol });   // (lo 0.82 browned the chin: a beard shadow on the ladies)
    olOff = true;
    // nose: one sculpted piece (bridge, rounded tip, flared wings) seated in the face
    const ng = sculpt(sphere(1, 18, 14), v => {
      const t = (1 - v.y) / 2;                       // 0 at the bridge, 1 at the base
      let x = v.x * (0.0085 + 0.007 * t * t) * (0.6 + 0.4 * F.nose), z = v.z * 0.016, y = v.y * 0.034 * (0.75 + 0.25 * F.nose);
      z += (0.004 + 0.012 * t * t) * F.nose;         // the tip stands out from the bridge
      if (v.z > 0) z += F.hook * 0.0045 * Math.sin(Math.PI * Math.min(1, t * 1.4));          // aquiline bump on the bridge
      if (t > 0.6) { y += F.snub * 0.004 * (t - 0.6) * 2.5; z -= F.snub * 0.002 * (t - 0.6); }   // a turned-up tip
      if (t > 0.72) x *= 1 + 1.1 * (t - 0.72) * (v.z < 0.3 ? 1 : 0.6);   // wings
      if (t > 0.9 && v.z > 0.2) z -= (t - 0.9) * 0.05;                    // under the tip
      v.set(x, y, z);
      if (v2) { v.x *= 1.22; v.y *= 1.1; v.z *= 1.2; }   // a nose with some character
    });
    mesh(ng, skin, hd, [0, 0.108, 0.1], { lo: 0.86, col: v => { const k = smooth(-0.005, -0.03, v.y) * 0.35; return [1 + 0.04 * k, 1 - 0.2 * k, 1 - 0.24 * k]; } });
    for (const s of [-1, 1]) mesh(sculpt(sphere(0.027, 10, 8).scale(0.42, 1, 0.66), v => { if (v.x * s < 0) v.x *= 0.5; }), skin, hd, [s * 0.1, 0.112, -0.004], { lo: 0.72, col: () => [1.03, 0.86, 0.82] });     // ears
    // mouth: a curved dark line + lips; the expression bends it and angles the brows
    const expr = o.expr || (o.sailor ? (rnd() < 0.5 ? 'smile' : 'calm') : 'fierce');
    const curve = expr === 'smile' ? 0.35 : expr === 'fierce' ? -0.12 : expr === 'stern' ? -0.25 : 0;
    // expression rig: mouth / jaw / brows hang on small bones so the duel can change the face live
    const mouthB = J('mouth', hd, [0, 0.06, 0.1]);
    const jawB = J('jaw', hd, [0, 0.052, 0.098]);
    const mq = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.034, 0.3 * 0.014, -0.003), new THREE.Vector3(0, -0.3 * 0.016, 0.009), new THREE.Vector3(0.034, 0.3 * 0.014, -0.003));
    mesh(new THREE.TubeGeometry(mq, 8, o.headScale ? 0.0068 : 0.0055, 4), shade, mouthB);
    const teethB = J('teeth', jawB, [0, -0.004, 0.002]);   // teeth on their own bone, scaled to nothing until the mouth opens
    if (!o.lite) mesh(new THREE.BoxGeometry(0.03, 0.009, 0.006), M('#f1e9da', { kind: 'skin' }), teethB, null);
    // open-mouth cavity: dark ellipse under the upper lip, scaled shut at rest
    if (!o.lite) mesh(sphere(0.02, 10, 6).scale(1.3, 1, 0.35).translate(0, -0.016, 0), M('#3a1410', { kind: 'skin' }), jawB);
    mesh(new THREE.CapsuleGeometry(0.0085, 0.028, 2, 6).rotateZ(Math.PI / 2).translate(0, -0.03, 0.002), M(new THREE.Color(skinHex).lerp(new THREE.Color('#9a3a30'), 0.45), { kind: 'skin' }), jawB);
    this._exprRest = { curve, browAng: expr === 'fierce' ? 0.42 : expr === 'stern' ? 0.25 : expr === 'smile' ? -0.12 : 0.05 };
    this._exprS = { curve, brow: 0, browY: 0, jaw: 0, wide: 1 };
    // eyes: white, coloured iris, pupil, catch-light, dark upper lid line
    const eyeW = M('#f2ebdf', { kind: 'skin' }), iris = M(o.eyes || ['#3a2614', '#2e4a5e', '#4a3a1a', '#2a3a2a'][Math.floor(rnd() * 4)], { kind: 'skin' });
    const pupil = M('#0c0806', { kind: 'skin' }), glint = M('#ffffff', { kind: 'skin' }), lash = M(new THREE.Color(o.hair || '#2b1d14').multiplyScalar(0.5), { kind: 'skin' });
    const limbal = M(new THREE.Color(iris.color).multiplyScalar(0.35), { kind: 'skin' });
    const browAng = expr === 'fierce' ? 0.42 : expr === 'stern' ? 0.25 : expr === 'smile' ? -0.12 : 0.05;
    const browM = M(new THREE.Color(o.hair || '#2b1d14').multiplyScalar(0.55));
    const browV2 = M(new THREE.Color(o.hair || '#2b1d14').multiplyScalar(0.8));
    for (const s of [-1, 1]) {
      const ek = dress ? 1.08 : v2 ? 1.14 : 1;   // the ladies' eyes a little larger
      if (o.lite) mesh(sphere(0.014, 6, 4).scale(1.1, 0.9, 0.6), pupil, hd, [s * eyeX, eyeY, eyeZ + 0.006]);   // a dark eye, seen from afar
      else {
      mesh(sphere(0.0175 * ek, 10, 8).scale(1.15, 0.9, 0.7), eyeW, hd, [s * eyeX, eyeY, eyeZ]);
      if (v2) mesh(sphere(0.0136 * ek, 12, 8).scale(1, 1, 0.5), limbal, hd, [s * (eyeX - 0.002), eyeY - 0.001, eyeZ + 0.0096 * ek]);   // dark rim of the iris
      mesh(sphere(0.0118 * ek, 12, 8).scale(1, 1, 0.5), iris, hd, [s * (eyeX - 0.002), eyeY - 0.001, eyeZ + 0.0112 * ek]);
      mesh(sphere(0.0062 * ek, 8, 6).scale(1, 1, 0.5), pupil, hd, [s * (eyeX - 0.002), eyeY - 0.001, eyeZ + 0.0155 * ek]);
      mesh(sphere(0.0028, 4, 3), glint, hd, [s * (eyeX - 0.002) + 0.004, eyeY + 0.004, eyeZ + 0.017 * ek]);
      mesh(sphere(0.0195 * ek, 10, 4, 0, Math.PI * 2, 0, Math.PI * 0.42).scale(1.18, 0.75, 0.8), skin, hd, [s * eyeX, eyeY + 0.004, eyeZ + 0.001]);   // upper lid
      mesh(torus(0.019 * ek, o.headScale || DET < 0.8 || dress ? 0.0042 : 0.0032, 3, 10, Math.PI).scale(1.15, 0.6, 1), lash, hd, [s * eyeX, eyeY + 0.002, eyeZ + 0.007 * ek]);   // lid line
      if (v2) mesh(torus(0.0195 * ek, 0.0036, 4, 10, Math.PI).rotateZ(Math.PI).scale(1.12, 0.52, 1), rosy, hd, [s * eyeX, eyeY - 0.0015, eyeZ + 0.0045 * ek]);   // lower lid
      }
      const brow = J(s < 0 ? 'browR' : 'browL', hd, [s * 0.042, 0.166 - (expr === 'fierce' ? 0.004 : 0), 0.103]);
      // brows: duellists (headScale) get heavier, darker brows so the expression reads at camera distance
      // tapered, slightly arched brows (thick at the nose, thin at the temple) instead of straight bars
      // a crowd figure (detail < 0.8) seen from afar gets thicker, darker brows: the face must still read at 15 px
      const far = DET < 0.8, bl = o.headScale ? 0.05 : 0.046, br = dress ? 0.0068 * (far ? 1.25 : 1) : o.headScale ? 0.0125 : far ? 0.0135 : 0.0105;
      mesh(sculpt(new THREE.CapsuleGeometry(br, bl, 3, 8).rotateZ(Math.PI / 2).scale(1, 1, 0.65), v => {
        const t = Math.min(1, Math.max(0, (v.x * s + bl / 2 + br) / (bl + 2 * br)));   // 0 at the inner end, 1 at the outer end
        v.y *= 1 - 0.5 * t; v.y += 0.0045 * (1 - (2 * t - 1) ** 2) - 0.003 * t; v.z -= 0.004 * t;
      }), v2 ? browV2 : (o.headScale || far) && !dress ? browM : hair, brow, null);
      brow.rotation.z = s * browAng;   // sign fixed — a positive angle knits the inner ends down (fierce), a negative one lifts them
    }
    olOff = false;
    // hair, queue, side locks
    if (o.hat !== 'wig' && dress) {
      // a woman's hair — centre parting swept to the sides with combed strands, a bun at the back and
      // ringlets over the ears (it used to be the men's cap and a queue)
      const cutW = hairline(0.121, 0.062, -0.03, -0.07, Math.PI * 0.62);
      mesh(sculpt(sculpt(sphere(0.121, 30, 18, 0, Math.PI * 2, 0, Math.PI * 0.62), cutW).scale(0.95, 1.03, 1.03), v => {
        const part = Math.exp(-((v.x / 0.012) ** 2)) * smooth(-0.04, 0.06, v.z);
        v.y -= part * 0.0025;   // (0.007 sank the parting into the scalp: a bald spot of skin at the crown)
        const a = Math.atan2(v.x, v.z), k = 1 + 0.02 * Math.sin(a * 16 + v.y * 30) * smooth(0.02, 0.1, v.y) * smooth(0.02, 0.07, Math.hypot(v.x, v.z));
        v.x *= k; v.z *= k;
      }), hair, hd, [0, 0.118, -0.012], { lo: 0.8, fn: v => (1 - 0.18 * Math.exp(-((v.x / 0.012) ** 2))) * (1 - 0.1 * (0.5 + 0.5 * Math.sin(Math.atan2(v.x, v.z) * 9 + v.y * 30)) * smooth(0.03, 0.08, Math.hypot(v.x, v.z))) });
      mesh(sculpt(sphere(0.056, 16, 12).scale(1.05, 0.9, 0.85), v => { const a = Math.atan2(v.x, v.y); const k = 1 + 0.06 * Math.sin(a * 7); v.x *= k; v.y *= k; }), hair, hd, [0, 0.175, -0.105], { lo: 0.72 });   // bun
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) mesh(sculpt(sphere(0.023 - i * 0.002, 12, 10).scale(1, 1.3, 1), v => { v.x += 0.004 * Math.sin(v.y * 160); }), hair, hd, [s * (0.106 + i * 0.004), 0.118 - i * 0.034, 0.016 - i * 0.012], { lo: 0.7 });   // ringlets
    } else if (v2 && o.hat !== 'wig') {
      hairV2(K, hd);
    } else if (o.hat !== 'wig') {
      const cutM = hairline(0.117, 0.066, -0.006, -0.03, Math.PI * 0.6);
      // (round 11: the ripples now fade at the crown and the cap sits 3 mm higher — the scalp poked through in a pale
      // stripe from the forehead to the crown)
      mesh(sculpt(sculpt(sphere(0.117, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.6), cutM).scale(0.93, 1.0, 1.0), v => { const a = Math.atan2(v.x, v.z), k = 1 + 0.018 * Math.sin(a * 13 + v.y * 25) * smooth(0.02, 0.07, Math.hypot(v.x, v.z)); v.x *= k; v.z *= k; }), hair, hd, [0, 0.123, -0.014], { lo: 0.8,
        fn: v => { const a = Math.atan2(v.x, v.z); return 1 - 0.12 * (0.5 + 0.5 * Math.sin(a * 7 + v.y * 30)) * smooth(0.03, 0.08, Math.hypot(v.x, v.z)); } });   // combed strands
      if (o.longHair !== false) mesh(new THREE.CapsuleGeometry(0.036, 0.16, 3, 8).translate(0, -0.06, 0), hair, hd, [0, 0.07, -0.1], { lo: 0.7 }).rotation.x = 0.35;
      for (const s of [-1, 1]) mesh(new THREE.CapsuleGeometry(0.02, 0.06, 3, 6), hair, hd, [s * 0.098, 0.12, -0.02], { lo: 0.75 });
    }
    if (o.beard) {
      // (round 11: pushed forward with the chin of this face — a strong chin poked through in a patch of skin)
      mesh(sculpt(sphere(0.074, 12, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55).scale(1.08, 1.2, 0.92 + 0.07 * Math.max(0, F.chin - 0.8)), v => { v.z += 0.012 * Math.sin(v.x * 140) * (v.y < 0 ? 1 : 0); }), hair, hd, [0, 0.07, 0.036], { lo: 0.7 });
    }
    if (v2 && o.moustache !== false) moustacheV2(K, hd);
    else if (o.moustache !== false && !dress) for (const s of [-1, 1]) { const m = mesh(new THREE.CapsuleGeometry(0.009, 0.045, 2, 5), hair, hd, [s * 0.022, 0.072, 0.109]); m.rotation.z = s * 1.15; }
    // hat
    const hatJ = J('hat', hd, [0, 0.2, -0.005]);
    const hat = o.hat === undefined ? 'tricorn' : o.hat;
    if (hat === 'tricorn' || hat === 'bicorne') { buildCockedHat(hatJ, hatM, brass, hat === 'bicorne', v2 ? null : o.plume, mesh, M); if (v2) plumeV2(K, hatJ); }
    else if (hat === 'wide') {
      mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.14, 16).translate(0, 0.04, 0), hatM, hatJ, null, { lo: 0.75 });
      mesh(sculpt(new THREE.CylinderGeometry(0.27, 0.27, 0.012, 28), v => { const r = Math.hypot(v.x, v.z); v.y += 0.03 * Math.max(0, r - 0.15) * 10 * (0.5 + 0.5 * Math.cos(Math.atan2(v.x, v.z) * 2)) * 0.3; }), hatM, hatJ, [0, -0.025, 0]);
      mesh(new THREE.CylinderGeometry(0.112, 0.112, 0.025, 16, 1, true), brass, hatJ, [0, -0.01, 0]);
    } else if (hat === 'bandana') {
      const bm = M(o.bandana || '#a3242a');
      mesh(sphere(0.122, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(0.95, 0.82, 1.02), bm, hatJ, [0, -0.06, 0], { lo: 0.8 });
      mesh(new THREE.ConeGeometry(0.04, 0.12, 6).rotateX(-1.9), bm, hatJ, [0, -0.06, -0.12]);
      for (const s of [-1, 1]) mesh(new THREE.CapsuleGeometry(0.014, 0.1, 2, 5), bm, hatJ, [s * 0.025, -0.12, -0.13], { lo: 0.7 }).rotation.set(0.5, 0, s * 0.3);
    } else if (hat === 'cap') {
      // a knitted cap sitting on the crown with a rolled band above the brows (it used to cover the eyes)
      const cm = M(o.bandana || o.hatColor || '#3a4d6e');
      mesh(sculpt(sphere(0.126, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(0.95, 0.9, 1.02), v => { const a = Math.atan2(v.x, v.z); const k = 1 + 0.012 * Math.sin(a * 18); v.x *= k; v.z *= k; if (v.y > 0.06) v.z -= (v.y - 0.06) * 0.25; }), cm, hatJ, [0, -0.045, -0.008], { lo: 0.75 });
      mesh(torus(0.118, 0.016, 7, 26).rotateX(Math.PI / 2).scale(0.95, 1, 1.02), cm, hatJ, [0, -0.04, -0.008], { lo: 0.7 });
    }
    else if (hat === 'wig') {
      // a full periwig — a curled crown with a centre parting, rolled sides and back (they used to be stacked balls)
      const wm = M(o.wig || '#e9e4da');
      mesh(sculpt(sphere(0.128, 20, 12).scale(1.02, 0.86, 1.04), v => {
        const a = Math.atan2(v.x, v.z), k = 1 + 0.035 * Math.abs(Math.sin(a * 6 + v.y * 40)) * smooth(0.0, 0.06, v.y + 0.03) - 0.03 * Math.exp(-((v.x / 0.01) ** 2)) * smooth(-0.02, 0.06, v.z);
        v.x *= k; v.z *= k; v.y *= 1 - 0.025 * Math.exp(-((v.x / 0.012) ** 2));
      }), wm, hd, [0, 0.172, -0.042], { lo: 0.8 });   // set back: the brows and forehead stay clear
      // side and back masses of the periwig: one rounded lobe each, carved into horizontal rolls (ridges and painted
      // grooves) — stacked capsules read as cotton puffs from the front (round 11 critique)
      const lobe = (rx, ry, rz, n) => sculpt(sphere(1, 18, 16).scale(rx, ry, rz), v => {
        const t = (v.y / ry + 1) / 2, ridge = Math.abs(Math.sin(t * Math.PI * n));
        const k = 1 + 0.09 * ridge * smooth(0.0, 0.35, 1 - Math.abs(v.y / ry)); v.x *= k; v.z *= k;
      });
      const groove = (ry, n) => v => 1 - 0.22 * (1 - Math.abs(Math.sin(((v.y / ry + 1) / 2) * Math.PI * n)));
      for (const s of [-1, 1]) mesh(lobe(0.05, 0.13, 0.075, 4).rotateZ(s * 0.08), wm, hd, [s * 0.112, 0.06, -0.045], { lo: 0.62, fn: groove(0.13, 4) });
      mesh(lobe(0.1, 0.13, 0.055, 4), wm, hd, [0, 0.04, -0.105], { lo: 0.6, fn: groove(0.13, 4) });
    } else if (hat === 'bonnet') {
      const bm = M('#f1ead8');
      // a lace cap set back on the head (the parted hair and ringlets show in front), frilled edge
      mesh(sculpt(sphere(0.118, 22, 12).scale(1, 0.86, 1.0), v => { const a = Math.atan2(v.x, v.z); const k = 1 + 0.05 * Math.sin(a * 14); v.x *= k; v.z *= k; }), bm, hd, [0, 0.18, -0.06], { lo: 0.8 });
      mesh(sculpt(torus(0.094, 0.011, 6, 30, Math.PI * 1.1).rotateZ(-Math.PI * 0.05).scale(1.05, 1, 0.7), v => { v.y += 0.003 * Math.sin(Math.atan2(v.y, v.x) * 22); }), bm, hd, [0, 0.148, -0.004]);
    } else if (hat === 'morion') {
      mesh(sculpt(sphere(0.135, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(0.95, 0.95, 1.05), v => v), iron, hatJ, [0, -0.05, 0], { lo: 0.7 });
      mesh(sculpt(new THREE.CylinderGeometry(0.26, 0.26, 0.015, 24), v => { v.y += 0.12 * Math.pow(v.z / 0.26, 2); v.x *= 0.68; }), iron, hatJ, [0, -0.05, 0]);
      mesh(new THREE.BoxGeometry(0.018, 0.08, 0.27), iron, hatJ, [0, 0.07, 0]);
    }

    // ---- sabre (in the right hand). Blade along +Z of the grip frame. ----
    // sheathed: hilt forward at the left hip, the scabbard slanting down and back
    const grip = this.grip = new THREE.Group();
    if (o.sheathed) { grip.position.set(0.22, 0.1, 0.07); grip.rotation.set(2.1, 0.12, 0); hips.add(grip); }
    else { grip.position.set(0, -0.085, 0.02); (o.lefty ? lWr : rWr).add(grip); }
    if (o.sword !== false && !o.tool) this._buildSabre(grip, steel, brass, belt, mesh, o.blade || (o.cutlass ? 'cutlass' : 'sabre'), !!o.sheathed);
    else this.tip = this.hilt = this.mid = grip;
    // props for NPCs, in the left (+X) hand, on a bone of their own
    const pg = o.tool || o.mug ? J('prop', lWr, [0, -0.1, 0.03]) : lWr;
    const wood = M('#5a3a1c', { kind: 'leather' });
    if (o.tool === 'halberd') { mesh(new THREE.CylinderGeometry(0.017, 0.017, 2.2, 6).translate(0, 0.4, 0), wood, pg); mesh(new THREE.BoxGeometry(0.02, 0.28, 0.18), iron, pg, [0, 1.45, 0.06]); mesh(new THREE.ConeGeometry(0.03, 0.22, 6), iron, pg, [0, 1.62, 0]); }
    if (o.tool === 'hammer') { const h = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.35, 5).rotateX(Math.PI / 2).translate(0, 0, 0.12), wood, pg); void h; mesh(new THREE.BoxGeometry(0.14, 0.06, 0.06), iron, pg, [0, 0, 0.3]); }
    if (o.tool === 'quill') mesh(new THREE.ConeGeometry(0.012, 0.22, 4).rotateX(0.4), M('#f5f0e6'), pg, [0, 0.02, 0.04]);
    if (o.tool === 'musket') {   // along +Y from the butt (y = 0) to the bayonet's point, lock side toward +X
      mesh(sculpt(new THREE.BoxGeometry(0.045, 0.5, 0.1, 1, 3, 1).translate(0, 0.25, 0), v => { const t = v.y / 0.5; v.z *= 1 - 0.45 * t; v.z += 0.02 * t; }), wood, pg);   // butt stock
      mesh(new THREE.BoxGeometry(0.036, 0.62, 0.045).translate(0, 0.79, 0.025), wood, pg);                                             // fore-stock
      mesh(new THREE.CylinderGeometry(0.011, 0.013, 1.0, 6).translate(0, 0.98, 0.035), iron, pg);                                      // barrel
      mesh(new THREE.BoxGeometry(0.03, 0.06, 0.03), iron, pg, [0.025, 0.47, 0.03]);                                                    // lock
      mesh(new THREE.ConeGeometry(0.008, 0.36, 4).translate(0, 1.66, 0.06), iron, pg);                                                 // bayonet
    }
    if (o.tool === 'mug' || o.mug) { mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.11, 10), wood, pg, [0, 0.02, 0.05], { lo: 0.7 }); mesh(torus(0.028, 0.008, 4, 8), wood, pg, [0.05, 0.02, 0.05]).rotation.y = Math.PI / 2; mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.01, 10), M('#e8dcc0'), pg, [0, 0.075, 0.05]); }

    this.lHand = lWr; this.rHand = rWr;
    this.scale = S;
    this._bake(o);
    DET = 1;
    this.setExpression('neutral', 1e3);
    g.scale.setScalar(S * (o.height || 1));
    this._flashK = 0;
    this.restPose = this.capture();
  }

  // kind: 'sabre' (default captain's sword), 'cutlass' (short broad), 'rapier' (long thin straight, cup hilt),
  // 'longsword' (long broad straight, cross guard)
  _buildSabre(grip, steel, brass, leather, mesh, kind = 'sabre', sheathed = false) {
    const cutlass = kind === 'cutlass', rapier = kind === 'rapier', long = kind === 'longsword';
    mesh(new THREE.CylinderGeometry(0.016, 0.018, long ? 0.2 : 0.12, 8).rotateX(Math.PI / 2).translate(0, 0, long ? -0.05 : -0.01), leather, grip);
    mesh(sphere(long ? 0.03 : 0.024, 8, 6), brass, grip, [0, 0, long ? -0.16 : -0.08]);
    if (rapier) {
      // cup hilt + quillons + a knuckle bow
      mesh(sphere(0.075, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.45).rotateX(Math.PI / 2), brass, grip, [0, 0, 0.09]);
      mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.26, 6).rotateZ(Math.PI / 2), brass, grip, [0, 0, 0.06]);
      const bow = mesh(torus(0.06, 0.006, 5, 14, Math.PI), brass, grip, [0, -0.04, 0.0]);
      bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
    } else if (long) {
      mesh(new THREE.BoxGeometry(0.3, 0.03, 0.03), brass, grip, [0, 0, 0.06]);
      for (const sx of [-1, 1]) mesh(sphere(0.024, 8, 6), brass, grip, [sx * 0.155, 0, 0.06]);
    } else {
      const bow = mesh(torus(0.06, 0.007, 5, 14, Math.PI), brass, grip, [0, -0.04, -0.01]);
      bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
      mesh(new THREE.BoxGeometry(0.03, 0.14, 0.012), brass, grip, [0, 0.0, 0.055]);
      mesh(sphere(0.05, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.4).rotateX(Math.PI / 2).scale(1, 1, 0.6), brass, grip, [0, 0, 0.04]);
    }
    const L = cutlass ? 0.94 : rapier ? 1.2 : long ? 1.3 : 1.12, W = cutlass ? 0.072 : rapier ? 0.034 : long ? 0.085 : 0.062;   // broader blades that read at duel distance
    if (sheathed) {   // the blade stays in its scabbard: leather, a brass throat and chape
      const Ls = L * 0.78;   // drawn a little short: a full-length scabbard hanging from the hip reads as a walking stick
      mesh(new THREE.CylinderGeometry(0.022, 0.034, Ls, 6, 1).rotateX(Math.PI / 2).scale(0.55, 1, 1).translate(0, 0, 0.07 + Ls / 2), leather, grip);
      mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.06, 6).rotateX(Math.PI / 2).scale(0.6, 1, 1).translate(0, 0, 0.09), brass, grip);
      mesh(new THREE.ConeGeometry(0.024, 0.08, 6).rotateX(Math.PI / 2).scale(0.6, 1, 1).translate(0, 0, Ls + 0.1), brass, grip);
      this.hilt = this.mid = this.tip = grip; this.bladeLen = Ls;
      return;
    }
    const sh = new THREE.Shape();
    const curve = z => (rapier || long ? 0 : 0.06) * (z / L) * (z / L);
    sh.moveTo(0, -W * 0.5);
    for (let i = 1; i <= 12; i++) { const z = (i / 12) * L; const w = W * (1 - 0.35 * (i / 12)) * (cutlass && i > 9 ? 1.25 : 1); sh.lineTo(z, curve(z) - w * 0.5); }
    sh.lineTo(L + 0.04, curve(L) + W * 0.25);
    for (let i = 12; i >= 0; i--) { const z = (i / 12) * L; sh.lineTo(z, curve(z) + W * 0.5); }
    const bg = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.007, bevelSegments: 1, steps: 1 });
    const p = bg.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setXYZ(i, z - 0.006, y, x + 0.06); }
    bg.computeVertexNormals();
    const blade = mesh(bg, steel, grip);
    this.blade = blade;
    this.hilt = new THREE.Object3D(); this.hilt.position.set(0, 0, 0.1); grip.add(this.hilt);
    this.tip = new THREE.Object3D(); this.tip.position.set(0, curve(L), L + 0.08); grip.add(this.tip);
    this.mid = new THREE.Object3D(); this.mid.position.set(0, curve(L * 0.6), L * 0.6 + 0.06); grip.add(this.mid);
    this.bladeLen = L;
  }

  _bake(o) {
    const g = this.group;
    g.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const bones = Object.values(this.j);
    const byKind = {};
    const m4 = new THREE.Matrix4(), v = new THREE.Vector3(), cv = new THREE.Vector3();
    for (const { geo, m, node, ao, ol } of this._parts) {
      let b = node; while (b && !b.isBone) b = b.parent;
      const bi = bones.indexOf(b);
      const gg = geo.index ? geo.toNonIndexed() : geo.clone();
      for (const k of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv'].includes(k)) gg.deleteAttribute(k);
      if (!gg.attributes.uv) gg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2));
      const n = gg.attributes.position.count, pos = gg.attributes.position;
      // smooth skinning across a joint. ao.sk = { up: w } blends the top of the part (its bone's joint, bone
      // frame y = 0) half-way into the parent bone, fading over w metres; ao.sk.dn = [childBone, depth, w] blends its
      // far end (bone frame y = -depth) half-way into that child bone. Elbows and knees then bend as one sleeve /
      // one leg instead of two tubes meeting at a ball.
      const sk = ao?.sk, sI = new Uint16Array(n * 4), sW = new Float32Array(n * 4);
      const pb = sk?.up && b.parent?.isBone ? bones.indexOf(b.parent) : -1, cb = sk?.dn ? bones.indexOf(sk.dn[0]) : -1;
      if (sk) m4.copy(b.matrixWorld).invert().multiply(node.matrixWorld);
      for (let i = 0; i < n; i++) {
        let wp = 0, wc = 0;
        if (sk) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m4);
          if (pb >= 0) wp = 0.5 * smooth(-sk.up, 0, v.y);
          if (cb >= 0) wc = 0.5 * (1 - smooth(0, sk.dn[2], v.y + sk.dn[1]));
        }
        sI[i * 4] = bi; sI[i * 4 + 1] = Math.max(0, pb); sI[i * 4 + 2] = Math.max(0, cb);
        sW[i * 4] = 1 - wp - wc; sW[i * 4 + 1] = wp; sW[i * 4 + 2] = wc;
      }
      // painted AO, in the part's own frame: darker toward its bottom (or `lo`), times the per-vertex fold term
      gg.computeBoundingBox();
      const y0 = gg.boundingBox.min.y, y1 = gg.boundingBox.max.y, lo = ao?.lo ?? 0.88;
      const aoA = new Float32Array(n), col = new Float32Array(n * 3), si = sI, sw = sW;
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pos, i);
        const t = y1 > y0 ? (v.y - y0) / (y1 - y0) : 1;
        aoA[i] = (lo + (1 - lo) * Math.sqrt(t)) * (ao?.fn ? ao.fn(v) : 1);
        // optional painted tint per vertex (part frame), e.g. the face: blush, lips, stubble, eye shadow
        const c = ao?.col ? ao.col(cv.copy(v)) : null;
        col[i * 3] = m.color.r * (c ? c[0] : 1); col[i * 3 + 1] = m.color.g * (c ? c[1] : 1); col[i * 3 + 2] = m.color.b * (c ? c[2] : 1);
      }
      m4.multiplyMatrices(inv, node.matrixWorld);
      gg.applyMatrix4(m4);
      // a degenerate triangle (pole, collapsed ring) leaves a zero normal: NaN in the lighting, a white star under bloom
      const nrm = gg.attributes.normal;
      for (let i = 0; i < nrm.count; i++) {
        const x = nrm.getX(i), y = nrm.getY(i), z = nrm.getZ(i), l = Math.hypot(x, y, z);
        if (!(l > 1e-6) || !Number.isFinite(l)) nrm.setXYZ(i, 0, 1, 0); else if (Math.abs(l - 1) > 1e-3) nrm.setXYZ(i, x / l, y / l, z / l);
      }
      gg.setAttribute('color', new THREE.BufferAttribute(col, 3));
      gg.setAttribute('ao', new THREE.BufferAttribute(aoA, 1));
      gg.setAttribute('olw', new THREE.BufferAttribute(new Float32Array(n).fill(ol ?? 1), 1));
      gg.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      gg.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      (byKind[m.kind] ||= []).push(gg);
      node.parent.remove(node);
      geo.dispose();
    }
    this._parts = null;
    const skeleton = this.skeleton = new THREE.Skeleton(bones);
    const coatCol = new THREE.Color(o.coat || '#7a1e1e'), trimCol = new THREE.Color(o.trim || '#d8b05a');
    const mats = this._flash = [];
    const mk = (kind) => {
      const base = { vertexColors: true, roughness: 0.86, metalness: 0 };
      if (kind === 'skin') Object.assign(base, { map: skinTex(), roughness: 0.55 });
      if (kind === 'cloth') Object.assign(base, { map: clothTex(), side: THREE.DoubleSide });
      if (kind === 'coat') Object.assign(base, { map: o.sailor ? (o.stripes ? stripeTex() : clothTex()) : coatTex([coatCol.r, coatCol.g, coatCol.b].map(c => Math.pow(c, 1 / 2.2)), [trimCol.r, trimCol.g, trimCol.b].map(c => Math.pow(c, 1 / 2.2))), side: THREE.DoubleSide });
      if (kind === 'leather') Object.assign(base, { map: leatherTex(), roughness: 0.48 });
      if (kind === 'metal') Object.assign(base, { roughness: 0.3, metalness: 0.85 });
      if (kind === 'steel') Object.assign(base, { map: steelTex(), roughness: 0.2, metalness: 0.95 });
      // broadcloth and wool get a soft sheen (velvety rim on the folds), skin its own lighting (SKIN_LIGHT)
      const cloth = kind === 'cloth' || kind === 'coat';
      if (cloth) Object.assign(base, { sheen: 1, sheenRoughness: 0.62, sheenColor: new THREE.Color(0.19, 0.18, 0.16) });
      const mt = painterly(cloth ? new THREE.MeshPhysicalMaterial(base) : new THREE.MeshStandardMaterial(base), kind);
      mats.push(mt);
      return mt;
    };
    this.meshes = [];
    // duellists (o.outline) get a thin painted ink contour (inverted hull, skinned) so the silhouette, the
    // arms and the legs read against a busy deck or a dark rampart; blades and brass stay bright (no contour).
    // the cloth, coat, skin and leather parts share one geometry (one group per material), so the contour is
    // a single draw call over that same geometry; it never casts a shadow (userData.noCast, see PortStage._shadows).
    const olMat = o.outline && !o.lite ? outlineMaterial(o.outline === true ? '#22160d' : o.outline, o.outlineW || 0.0075) : null;
    this.outlines = [];
    const add = (geo, mat) => {
      const sm = new THREE.SkinnedMesh(geo, mat);
      sm.castShadow = true; sm.receiveShadow = true; sm.frustumCulled = false;
      g.add(sm); sm.bind(skeleton, g.matrixWorld); this.meshes.push(sm);
      return sm;
    };
    if (o.lite) {   // every part in one geometry and one shared material (liteFigureMaterials)
      const geo = mergeGeometries(Object.values(byKind).flat());
      add(geo, o.lite.mat);
      if (o.lite.outline) {
        const om = new THREE.SkinnedMesh(geo, o.lite.outline); om.frustumCulled = false; om.castShadow = false; om.receiveShadow = false;
        om.userData.noCast = true;
        g.add(om); om.bind(skeleton, g.matrixWorld); this.outlines.push(om);
      }
      mats.length = 0;   // the shared material is not this figure's to flash or dispose
      return;
    }
    const soft = Object.keys(byKind).filter(k => k !== 'steel' && k !== 'metal');
    if (soft.length) {
      const geo = mergeGeometries(soft.map(k => mergeGeometries(byKind[k])), true);
      add(geo, soft.map(mk));
      if (olMat) {
        const om = new THREE.SkinnedMesh(geo, olMat); om.frustumCulled = false; om.castShadow = false; om.receiveShadow = false;
        om.userData.noCast = true;
        g.add(om); om.bind(skeleton, g.matrixWorld); this.outlines.push(om);
      }
    }
    for (const kind of ['metal', 'steel']) if (byKind[kind]) {
      const sm = add(mergeGeometries(byKind[kind]), mk(kind));
      if (kind === 'steel') this.steelMesh = sm;
    }
    this._olMat = olMat;
  }

  capture() { const p = {}; for (const k in this.j) { const r = this.j[k].rotation; p[k] = [r.x, r.y, r.z]; } p.rootPos = this.j.root.position.toArray(); p.hipsY = this.j.hips.position.y; return p; }

  apply(p) {
    const rest = this.restPose;
    for (const k in this.j) {
      const v = p[k] || rest[k];
      this.j[k].rotation.set(v[0], v[1], v[2]);
    }
    const rp = p.rootPos || rest.rootPos; this.j.root.position.set(rp[0], rp[1], rp[2]);
    this.j.hips.position.y = p.hipsY ?? rest.hipsY;
  }

  // live facial expression: 'neutral' | 'attack' | 'strain' | 'hurt' | 'joy'; eased in real time
  setExpression(name, dt = 0.016) {
    if (!this._exprS) return;
    const r = this._exprRest, e = this._exprS, j = this.j;
    // duellists (o.headScale) play the face bigger: brows knit harder, the mouth opens wider (a war cry on the cut,
    // gritted teeth on the parry, a gasp when hit) so it reads at the duel camera's distance
    // (not the ladies: they keep a closed smile, never a war cry)
    const X = this.o.headScale && !this.o.dress ? 1 : 0;
    const T = {
      neutral: [r.curve, 0, 0, 0.05, 1], attack: [-0.3 - 0.08 * X, 0.32 + 0.16 * X, -0.006 - 0.003 * X, 0.4 + 0.22 * X, 1.15 + 0.1 * X], strain: [-0.2 - 0.12 * X, 0.22 + 0.14 * X, -0.004 - 0.003 * X, 0.18 + 0.06 * X, 1.2 + 0.12 * X],
      hurt: [-0.35 - 0.1 * X, -0.5 - 0.15 * X, 0.01 + 0.004 * X, 0.85 + 0.2 * X, 0.9], joy: [0.45 + 0.12 * X, -0.2 - 0.06 * X, 0.006 + 0.002 * X, 0.5 + 0.1 * X, 1.15 + 0.1 * X],
    }[name] || [r.curve, 0, 0, 0.05, 1];
    if (this.o.dress && name === 'joy') T.splice(0, 5, 0.3, -0.16, 0.004, 0.32, 1.04);   // a lady's laugh: lips parted, not a grin
    const k = 1 - Math.exp(-(dt > 0 ? dt : 0.016) * 14);
    e.curve += (T[0] - e.curve) * k; e.brow += (T[1] - e.brow) * k; e.browY += (T[2] - e.browY) * k; e.jaw += (T[3] - e.jaw) * k; e.wide += (T[4] - e.wide) * k;
    const sy = Math.abs(e.curve) < 0.02 ? (e.curve < 0 ? -0.07 : 0.07) : e.curve / 0.3;
    j.mouth.scale.set(e.wide, sy, 1);
    const jk = this.o.dress ? 0.4 : 1;   // ladies smile and laugh with the mouth near closed (no shouting grin)
    j.jaw.scale.set(e.wide, 0.08 + e.jaw * 1.4 * jk, 1); j.jaw.position.y = 0.052 - e.jaw * 0.008 * jk;
    if (j.teeth) j.teeth.scale.setScalar(Math.min(1, Math.max(0.001, (e.jaw * jk - 0.12) / 0.3)));
    for (const [b, s] of [[j.browR, -1], [j.browL, 1]]) { b.rotation.z = s * (r.browAng + e.brow); b.position.y = (b.userData.y0 ??= b.position.y) + e.browY; }
  }

  flash(k) {
    if (Math.abs(k - this._flashK) < 0.01) return;
    this._flashK = k;
    for (const m of this._flash) { const e0 = m.userData.em0; m.emissive.setRGB(k * 0.9 + (e0?.r || 0), k * 0.3 + (e0?.g || 0), k * 0.18 + (e0?.b || 0)); }   // em0: base glow (night blades)
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
    for (const m of this._flash) m.dispose();   // canvas textures are shared (textures.js cache): keep them
    this._olMat?.dispose();
    this.skeleton.dispose();
  }
}

// Look presets: the player, enemy captains by nation, and port roles. Spread over an options object.
export const LOOKS = {
  player:   { coat: '#7c1a1a', trim: '#e6c06a', lapel: '#1c2a48', waistcoat: '#d9c08a', hat: 'tricorn', hatColor: '#17110d', hair: '#3a2416', skin: '#d29a6e', epaulette: true, expr: 'fierce', eyes: '#2e4a5e' },
  english:  { coat: '#8c1c1f', trim: '#e2bc62', lapel: '#1f2a4a', hat: 'tricorn', breeches: '#d9cba6', expr: 'stern' },
  spanish:  { coat: '#262a33', trim: '#d9b25c', lapel: '#8a1e1e', waistcoat: '#8a1e1e', hat: 'bicorne', plume: '#e8d9b0', breeches: '#3a2a20', expr: 'fierce' },
  french:   { coat: '#22396e', trim: '#e8d394', lapel: '#c8bfa8', waistcoat: '#e8e0cc', hat: 'tricorn', plume: '#f2ede0', breeches: '#e8e0cc', expr: 'stern', hair: '#5a3a20' },
  dutch:    { coat: '#3b2a1c', trim: '#e07a24', lapel: '#d8cfb8', waistcoat: '#e07a24', hat: 'wide', breeches: '#2c2620', expr: 'stern', hair: '#8a6a3a', beard: true },
  pirate:   { coat: '#3a1a14', trim: '#b38b4a', lapel: '#5b1a1a', waistcoat: '#6b4a2a', hat: 'bandana', bandana: '#8e1b1b', breeches: '#4a3a2a', beard: true, expr: 'fierce', sash: '#8e1b1b' },
  merchant: { coat: '#5a4030', lapel: '#8a6a3a', waistcoat: '#e8dcc0', hat: 'cap', hatColor: '#6a2a1a', apron: true, sword: false, expr: 'smile', breeches: '#4a3a2a', bulk: 1.12 },
  tavern:   { sailor: true, jacket: false, coat: '#e0d4b8', shirt: '#e8dfc8', sleeves: 'rolled', apron: true, sword: false, hat: 'none', beard: true, expr: 'smile', bulk: 1.15, boots: true, longHair: false },
  governor: { coat: '#4a1a3a', trim: '#e6c06a', lapel: '#e6c06a', waistcoat: '#c9a24a', hat: 'wig', breeches: '#e8dcc0', sword: false, expr: 'calm', skin: '#e8c0a0', moustache: false, epaulette: false },
  guard:    { coat: '#8a2222', trim: '#c9a24a', lapel: '#c9a24a', hat: 'morion', breastplate: true, tool: 'halberd', moustache: true, expr: 'stern', breeches: '#3a2a20' },
  clerk:    { coat: '#2a2a2a', trim: '#8a8a80', lapel: '#3a3a3a', waistcoat: '#e8dcc0', hat: 'wig', wig: '#d8d0c0', sword: false, expr: 'calm' },
  woman:    { dress: '#a8543a', bodice: '#3a2a20', hat: 'bonnet', skin: '#d8a888', hair: '#4a2414', sword: false, moustache: false, expr: 'smile', longHair: true },
};

// a finger: three phalanges — the curl `ang` is spent at the knuckles (30 / 40 / 30 %) instead of as one arc —
// with knuckle swellings, tapering to a rounded tip, and a nail on its back. From `p0` heading `dir`, curling toward
// `bend`; `nail` = material of the nail (null: none, e.g. inside a fist).
function fingerGeo(p0, dir, bend, len, ang, r, seg = 10, nail = null, mesh = null, parent = null) {
  const d = dir.clone().normalize(), b = bend.clone().addScaledVector(d, -bend.dot(d)).normalize();
  const segL = [0.44, 0.31, 0.25], segA = [0.3, 0.4, 0.3], pts = [p0.clone()];
  let p = p0.clone(), h = d.clone(), a = 0;
  for (let k = 0; k < 3; k++) {
    a += ang * segA[k];
    h = d.clone().multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
    const n = k === 0 ? 2 : 1;
    for (let j = 1; j <= n; j++) pts.push(p.clone().addScaledVector(h, len * segL[k] * j / n));
    p = pts[pts.length - 1].clone();
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const tub = dq(seg, 5), rad = dq(7, 5), ring = rad + 1;
  const g = new THREE.TubeGeometry(curve, tub, r, rad, false);
  const P = g.attributes.position, q = new THREE.Vector3(), cp = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {   // taper toward the tip, swell at the two inner knuckles
    const t = Math.floor(i / ring) / tub;
    curve.getPointAt(Math.min(1, t), cp);
    const k = (1 - 0.26 * t) * (1 + 0.13 * bump(t, 0.44, 0.08) + 0.09 * bump(t, 0.75, 0.07));
    q.fromBufferAttribute(P, i).sub(cp).multiplyScalar(k).add(cp);
    P.setXYZ(i, q.x, q.y, q.z);
  }
  g.computeVertexNormals();
  const tip = curve.getPointAt(1), tan = curve.getTangentAt(0.93);
  if (nail && mesh) {   // nail: a small lighter shell on the back of the last phalanx (opposite the curl)
    const back = b.clone().multiplyScalar(-1).addScaledVector(tan, -b.clone().multiplyScalar(-1).dot(tan)).normalize();
    const at = curve.getPointAt(0.9).addScaledVector(back, r * 0.62);
    const ng = sphere(r * 0.62, 6, 4).scale(0.9, 0.35, 1.25);
    const m4 = new THREE.Matrix4().lookAt(new THREE.Vector3(), tan, back);
    ng.applyMatrix4(m4).translate(at.x, at.y, at.z);
    mesh(ng, nail, parent, null, { lo: 1 });
  }
  return mergeGeometries([g, sphere(r * 0.74, 7, 5).translate(tip.x, tip.y, tip.z)]);
}
function buildFist(wr, s, skin, rosy, mesh, grip = true) {
  const gy = -0.085, Z = [0.026, 0.004, -0.018, -0.038], R = [0.0125, 0.013, 0.0122, 0.0108];
  for (let i = 0; i < 4; i++) {
    const t = torus(0.0285 - (i === 3 ? 0.002 : 0), R[i], 7, 12, Math.PI * 1.5).rotateZ(Math.PI * 0.75).translate(0, gy, Z[i]);
    mesh(t, i % 2 ? skin : rosy, wr, null, { lo: 0.78 });
  }
  // back of the hand (top, toward the wrist) and the heel of the palm
  mesh(sculpt(sphere(0.04, 12, 9).scale(0.82, 0.9, 1.22), v => { if (v.y < 0) v.y *= 0.7; }).translate(0, -0.052, -0.006), skin, wr, null, { lo: 0.85 });
  // knuckles: four bumps across the back of the fingers (one bar read as a mitten)
  for (let i = 0; i < 4; i++) mesh(sphere(0.0118 - (i === 3 ? 0.0015 : 0), 8, 6).scale(1, 0.85, 1).translate(s * 0.026, -0.07, Z[i] * 0.95), rosy, wr, null, { lo: 0.92 });
  // thumb: on a sword, over the top of the grip pointing at the guard; an empty fist lays it across the front of the
  // curled index and middle fingers, on the palm side (pointing up the grip it read as a thumbs-up on raised fists)
  if (grip) mesh(fingerGeo(new THREE.Vector3(-s * 0.02, -0.052, 0.02), new THREE.Vector3(0, -0.35, 1), new THREE.Vector3(s * 0.6, -1, 0), 0.055, 0.7, 0.0128), skin, wr, null, { lo: 0.85 });
  else mesh(fingerGeo(new THREE.Vector3(-s * 0.03, -0.062, 0.042), new THREE.Vector3(-s * 0.25, -0.5, -1), new THREE.Vector3(s, -0.2, 0), 0.05, 0.55, 0.0128), skin, wr, null, { lo: 0.85 });
}
function buildOpenHand(wr, s, skin, rosy, mesh, nail) {
  const hand = new THREE.Object3D(); hand.scale.setScalar(1.18); wr.add(hand);
  // palm: a flattened block toward the body (-s side), back of the hand outward, a fleshy mound under the thumb
  mesh(sculpt(sphere(0.042, 14, 10).scale(0.56, 1.1, 1.02), v => {
    if (v.x * -s > 0) v.x *= 0.82;
    v.x += -s * 0.006 * Math.exp(-(((v.y + 0.012) / 0.02) ** 2 + ((v.z - 0.022) / 0.016) ** 2));   // thenar mound
  }).translate(0, -0.046, 0), skin, hand, null, { lo: 0.85 });
  const L = [0.066, 0.074, 0.069, 0.056], RR = [0.0102, 0.0108, 0.0103, 0.0092];
  for (let f = 0; f < 4; f++) {   // relaxed fingers, each curling a little more than the last (index → little finger)
    const z = (1.5 - f) * 0.0176;
    mesh(fingerGeo(new THREE.Vector3(0, -0.08, z), new THREE.Vector3(-s * 0.08, -1, z * 0.3), new THREE.Vector3(-s, 0, 0), L[f], 0.75 + f * 0.17, RR[f], 10, nail, mesh, hand), f % 2 ? skin : rosy, hand, null, { lo: 0.8 });
  }
  // thumb: opposed, ~35° forward of the palm plane, its tip turned toward the index
  mesh(fingerGeo(new THREE.Vector3(-s * 0.014, -0.034, 0.03), new THREE.Vector3(-s * 0.45, -0.75, 0.55), new THREE.Vector3(-s * 0.2, 0, -1), 0.058, 0.55, 0.0118, 10, nail, mesh, hand), skin, hand, null, { lo: 0.85 });
}

function buildCockedHat(parent, hatM, brass, bicorne, plume, mesh, M) {
  mesh(new THREE.CylinderGeometry(0.097, 0.114, 0.1, 18).translate(0, 0.02, 0), hatM, parent, null, { lo: 0.75 });
  mesh(sphere(0.098, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 0.4, 1).translate(0, 0.07, 0), hatM, parent);
  const g = new THREE.RingGeometry(0.1, 0.245, 40, 4);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z), a = Math.atan2(x, z);
    const t = (r - 0.1) / 0.145;
    const up = bicorne ? Math.pow(Math.abs(Math.cos(a)), 0.5) : 0.5 + 0.5 * Math.cos(3 * a);
    const lift = t * t * (0.05 + 0.17 * up);
    const pull = 1 - t * 0.28 * up;
    p.setXYZ(i, x * pull * (bicorne ? 1.25 : 1), lift - 0.03, z * pull * (bicorne ? 0.7 : 1));
  }
  g.computeVertexNormals();
  mesh(g, hatM, parent, null, { lo: 0.7 });
  const e = torus(0.245, 0.0075, 4, 48); e.rotateX(Math.PI / 2);
  const ep = e.attributes.position;
  for (let i = 0; i < ep.count; i++) {
    const x = ep.getX(i), z = ep.getZ(i), a = Math.atan2(x, z);
    const up = bicorne ? Math.pow(Math.abs(Math.cos(a)), 0.5) : 0.5 + 0.5 * Math.cos(3 * a);
    const pull = 1 - 0.28 * up;
    ep.setXYZ(i, x * pull * (bicorne ? 1.25 : 1), ep.getY(i) + 0.05 + 0.17 * up - 0.03, z * pull * (bicorne ? 0.7 : 1));
  }
  e.computeVertexNormals();
  mesh(e, brass, parent);
  if (plume) {
    const pl = mesh(sculpt(new THREE.CapsuleGeometry(0.032, 0.24, 3, 10).scale(1, 1, 0.4), v => { v.x += 0.012 * Math.sin(v.y * 60); }), M(plume), parent, [0.09, 0.1, -0.02], { lo: 0.7 });
    pl.rotation.set(-0.5, 0, -0.9);
  }
  mesh(sphere(0.022, 8, 6), brass, parent, [0, 0.06, 0.19]);
}
