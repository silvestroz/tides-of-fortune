// Ship materials. All are MeshStandardMaterial + onBeforeCompile so they get scene.environment reflections,
// shadows, fog and the renderer's tone mapping. Programs are shared (stable customProgramCacheKey); uniforms are
// per material instance (hull/sail/flag materials are per-ship where they carry per-ship state).
//
//   GLOBAL uniforms (shared by every ship, updated once per frame by updateGlobals): uTime, uNight, uSunView, uSunCol
//   makeHullMaterial()  -> material with .userData.u { uHullDmg, uSea, uLampA, uLampB }
//     uSea 1 = a ship sailing in the world scene (set by shipModel.update; 0 on port stages, the duel deck and moored
//     hulls, which keep their own look): day-dark stern glass, gilding glints, lantern light pools at night.
//     uLampA / uLampB = (local lantern position, reach in m), w = 0 off: warm light the lanterns throw at night.
//   makeSailMaterial(color) -> material with .userData.u { uSet, uFill, uSide, uLuff, uSailDmg, uColor, uSea, uLampA, uLampB } + .userData.depth
//   makeFlagMaterial(tex)  -> material with .userData.u { uYaw, uStrike, uWind, uSea } + .userData.depth
import * as THREE from 'three';
import { getWoodTex, getCanvasTex, getEmblemTex } from './textures.js';

export const GLOBAL = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uSunView: { value: new THREE.Vector3(0, 1, 0) },
  uSunCol: { value: new THREE.Color(1, 0.95, 0.85) },
  uSunWorld: { value: new THREE.Vector3(0, 1, 0) },
};
let _lastT = -1;
const _sunTmp = new THREE.Vector3();
export function updateGlobals(t) {
  if (t === _lastT) return; _lastT = t;
  GLOBAL.uTime.value = t;
  const g = typeof window !== 'undefined' ? window.__game : null;
  const sky = g?.sky;
  if (sky?.sunDir) {
    GLOBAL.uSunWorld.value.copy(sky.sunDir);
    const el = sky.sunDir.y;
    // 0 by day, 1 at night (lanterns lit from dusk)
    GLOBAL.uNight.value = 1 - THREE.MathUtils.smoothstep(el, -0.08, 0.16);
    if (sky.sunColor) GLOBAL.uSunCol.value.copy(sky.sunColor);
  }
  if (g?.camera) {
    _sunTmp.copy(GLOBAL.uSunWorld.value).transformDirection(g.camera.matrixWorldInverse);
    GLOBAL.uSunView.value.copy(_sunTmp);
  }
}

export const PIV_GLSL = /* glsl */`
uniform vec4 uPiv[8];
vec3 pivRot(vec3 p, vec2 pw, bool isDir) {
  if (pw.x < -0.5) return p;
  vec4 P = uPiv[int(pw.x + 0.5)];
  float a = P.z * pw.y;
  float zc = isDir ? 0.0 : P.x + p.y * P.y;
  vec2 d = vec2(p.x, p.z - zc);
  float c = cos(a), s = sin(a);
  return vec3(c * d.x - s * d.y, p.y, zc + s * d.x + c * d.y);
}`;
function pivUniform() { const a = []; for (let i = 0; i < 8; i++) a.push(new THREE.Vector4()); return { value: a }; }

const BUMP_FN = /* glsl */`
vec3 shipPerturb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
  vec3 vSigmaX = dFdx( surf_pos.xyz );
  vec3 vSigmaY = dFdy( surf_pos.xyz );
  if (dot(vSigmaX, vSigmaX) < 1e-14 || dot(vSigmaY, vSigmaY) < 1e-14) return surf_norm;
  vSigmaX = normalize(vSigmaX); vSigmaY = normalize(vSigmaY);
  vec3 R1 = cross( vSigmaY, surf_norm );
  vec3 R2 = cross( surf_norm, vSigmaX );
  float fDet = dot( vSigmaX, R1 ) * faceDirection;
  vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
  vec3 r = abs( fDet ) * surf_norm - vGrad;
  return dot(r, r) > 1e-14 ? normalize(r) : surf_norm;
}`;

// ------------------------------------------------------------------ HULL
const HIDE_GLSL = `
{ float hb = aBreak < 2.5 ? step(aBreak, uHullDmg) : step(aBreak - 10.0, uSailDmg);
  if (abs(aBreak - 2.2) < 0.01) hb = step(0.5, uDuel);
  if (abs(aBreak - 2.3) < 0.01) hb = step(uSea, 0.5);
  if (hb > 0.5) transformed = vec3(0.0, -60.0, 0.0); }`;

// lantern light pools (night, sea only): vertex side passes the fragment->lamp vector in view space, fragment side
// turns it into a soft wrapped falloff. uLamp*.w = reach (m); 0 = no lamp.
const LAMP_VERT = /* glsl */`
uniform vec4 uLampA; uniform vec4 uLampB; varying vec3 vLampA; varying vec3 vLampB;`;
const LAMP_VERT_MAIN = /* glsl */`
{ vec3 mvp = (modelViewMatrix * vec4(transformed, 1.0)).xyz;
  vLampA = (modelViewMatrix * vec4(uLampA.xyz, 1.0)).xyz - mvp;
  vLampB = (modelViewMatrix * vec4(uLampB.xyz, 1.0)).xyz - mvp; }`;
const LAMP_FRAG = /* glsl */`
uniform vec4 uLampA; uniform vec4 uLampB; varying vec3 vLampA; varying vec3 vLampB;
float lampPool(vec3 d, float reach, vec3 n) {
  if (reach <= 0.0) return 0.0;
  float q = dot(d, d) / (reach * reach);
  float wrap = 0.35 + 0.65 * max(0.0, dot(n, normalize(d)));
  return wrap * (1.0 - smoothstep(0.35, 1.0, q)) / (1.0 + q * 9.0);
}`;
const LAMP_COL = 'vec3(1.0, 0.56, 0.22)';

let _greyTex = null;
function greyTex() {
  if (_greyTex) return _greyTex;
  _greyTex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); _greyTex.needsUpdate = true;
  return _greyTex;
}

// skinTex: per-design hull skin texture from buildHullGeometry (info.skinTex); optional
// skinRange: [ys0, ys1] sheer-relative heights of the skin's v = 20..21 (info.skinRange); without it (merged moored
// hulls, duel dressing) the analytic plank seams are off
export function makeHullMaterial(skinTex = null, skinRange = null) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, envMapIntensity: 0.5 });
  const u = { uHullDmg: { value: 0 }, uSailDmg: { value: 0 }, uDuel: { value: 0 }, uWood: { value: getWoodTex() }, uSkin: { value: skinTex || greyTex() }, uPiv: pivUniform(),
    uSea: { value: 0 }, uLampA: { value: new THREE.Vector4() }, uLampB: { value: new THREE.Vector4() },
    uSkinR: { value: new THREE.Vector2(skinRange?.[0] ?? 0, skinRange?.[1] ?? 0) } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { uNight: GLOBAL.uNight, uTime: GLOBAL.uTime, uSunView: GLOBAL.uSunView, uSunCol: GLOBAL.uSunCol });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
${LAMP_VERT}
attribute vec4 aSurf; attribute float aBreak; attribute vec2 aPiv;
uniform float uHullDmg; uniform float uSailDmg; uniform float uDuel; uniform float uSea;
${PIV_GLSL}
varying vec4 vSurf; varying vec2 vWUv; varying vec3 vLPos; varying float vWY; varying float vDist; varying float vNY;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
objectNormal = pivRot(objectNormal, aPiv, true);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vSurf = aSurf; vWUv = uv; vLPos = position;
transformed = pivRot(transformed, aPiv, false);
${HIDE_GLSL}
vNY = normal.y;
{ vec4 wp = modelMatrix * vec4(transformed, 1.0); vWY = wp.y; vDist = length(cameraPosition - wp.xyz);
  // rigging LOD: ratlines vanish past ~55 m, running rigging past ~120 m (prevents dotted-line aliasing)
  if (aSurf.y > 0.905 && aSurf.y < 0.915 && vDist > 55.0) transformed = vec3(0.0, -60.0, 0.0);
  if (aSurf.y > 0.915 && aSurf.y < 0.925 && vDist > 120.0) transformed = vec3(0.0, -60.0, 0.0);
  // standing rigging: widen with distance so it never drops below ~1 px
  if (aSurf.y > 0.895 && aSurf.y < 0.925) transformed += normal * clamp(vDist * 0.0009 - 0.02, 0.0, 0.12);
}
${LAMP_VERT_MAIN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uWood; uniform sampler2D uSkin; uniform float uHullDmg; uniform float uNight; uniform float uTime; uniform vec2 uSkinR;
uniform float uSea; uniform vec3 uSunView; uniform vec3 uSunCol;
${LAMP_FRAG}
varying vec4 vSurf; varying vec2 vWUv; varying vec3 vLPos; varying float vWY; varying float vDist; varying float vNY;
${BUMP_FN}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
// outer hull skin (v >= 20): own UVs into the per-design skin texture; wood detail sampled in local metres
float isSkin = step(15.0, vWUv.y);
vec2 skUv = vec2(vWUv.x, vWUv.y - 20.0);
vec4 wt = texture2D(uWood, mix(vWUv, vec2(vLPos.z / 6.0, vLPos.y / 2.24 + step(0.0, vLPos.x) * 0.37), isSkin));
// distance fade: fine detail gives way to flat, frank painted colour blocks (120-250 m)
float farF = smoothstep(120.0, 250.0, vDist);
float grain = vSurf.w;
float grainK = mix(1.0, 0.45, isSkin) * (1.0 - farF);
float wood = wt.r * 1.28;
// grain modulation (full on bare wood, faint brush texture on paint)
diffuseColor.rgb *= mix(1.0, wood, grain * grainK);
// paint: brush streaks + weathered chips revealing oak
float isPaint = step(0.35, grain) * step(grain, 0.6);
float chip = isPaint * smoothstep(0.80, 0.86, wt.b) * (1.0 - farF);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.27, 0.13) * wood, chip * 0.85);
diffuseColor.rgb *= 1.0 + (wt.a - 0.5) * 0.35 * (1.0 - vSurf.x);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3,0.59,0.11))), 0.03 * isPaint);
// salt-bleach/weathering toward the waterline and on high spots
float salt = smoothstep(0.55, 0.9, wt.b) * (1.0 - vSurf.x) * 0.12 * (1.0 - isPaint * 0.8);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.72, 0.64), salt * (1.0 - isPaint * 0.5));
// skin texture: strakes, wale relief, rust/salt runs, weed & bleaching (mipmapped; flattens with distance)
{ vec3 sk = texture2D(uSkin, skUv).rgb * 2.0;
  sk = mix(sk, vec3(1.0), farF * 0.75 * isSkin);
  diffuseColor.rgb *= mix(vec3(1.0), sk, isSkin);
  // far: push base colours toward clean, saturated flats that read on the sea
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  vec3 flatC = max(vec3(0.0), lum + (diffuseColor.rgb - lum) * 1.3) * (0.7 + 0.6 * smoothstep(0.04, 0.3, lum));
  diffuseColor.rgb = mix(diffuseColor.rgb, flatC, farF * isSkin); }
// gfx-mer: analytic plank seams on the planked skin bands. The texture's caulk lines are ~1 texel and vanish in its
// mips at 60-150 m (the side read as one flat colour): redrawn here at >= ~1 px with energy-conserving contrast,
// plus a light/shade ramp across each strake, both faded out before they alias (fwS ~0.3-0.6: 120-250 m)
float plank = isSkin * step(0.001, uSkinR.y - uSkinR.x) * (step(0.6, vSurf.w) + step(0.4, vSurf.w) * step(vSurf.w, 0.5));
float kS = mix(uSkinR.x, uSkinR.y, skUv.y) / 0.42 - 0.05;
float fwS = max(fwidth(kS), 1e-4);
float plankFade = plank * (1.0 - smoothstep(0.3, 0.6, fwS));
float dSeam = abs(fract(kS + 0.5) - 0.5);
{ float wE = max(0.05, fwS * 0.55);
  float cov = 1.0 - smoothstep(wE - fwS * 0.5, wE + fwS * 0.5, dSeam);
  float seam = cov * sqrt(0.05 / wE) * plankFade;
  float ramp = (smoothstep(0.05, 0.95, fract(kS)) - 0.5) * (1.0 - smoothstep(0.15, 0.45, fwS)) * plank;
  diffuseColor.rgb *= (1.0 - seam * 0.42) * (1.0 + ramp * 0.16); }
// gfx-mer: heavy hull damage chars and greys the whole hull (paint scorched off, ash and soot) so a wreck reads from
// afar: patchy (two noise scales), creeping in from 45 % hull damage, near-total at 95 %
float burnAmt = 0.0;
{ float burnK = smoothstep(0.45, 0.95, uHullDmg) * (1.0 - vSurf.z);
  if (burnK > 0.0) {
    float bp = texture2D(uWood, vLPos.zy * vec2(0.017, 0.027) + vLPos.x * 0.009 + 0.43).b * 0.65 + texture2D(uWood, vLPos.zy * vec2(0.06, 0.09) + 0.71).a * 0.35;
    burnAmt = burnK * clamp(0.62 + (bp - 0.5) * 1.6 + burnK * 0.3, 0.0, 1.0);
    float lumB = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    vec3 ash = mix(vec3(0.045, 0.042, 0.04), vec3(0.21, 0.205, 0.195), smoothstep(0.28, 0.66, bp));   // charcoal .. ash grey (linear)
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(lumB), ash, 0.85), burnAmt);
  } }
// gilding: brushed variation
diffuseColor.rgb *= 1.0 + vSurf.x * (wt.a - 0.5) * 0.5 * (1.0 - burnAmt);
// scorch from hull damage
float sc = texture2D(uWood, vLPos.zy * vec2(0.031, 0.05) + vLPos.x * 0.013).b * 0.7 + texture2D(uWood, vLPos.xz * 0.043).a * 0.3;
float scorchD = min(uHullDmg, 0.72) * 0.62;   // gfx-mer: black scorch capped, the ash grey carries the heaviest damage
float scorch = smoothstep(1.02 - scorchD, 1.08 - scorchD, sc + 0.08);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.03, 0.025), scorch * 0.92 * (1.0 - vSurf.z));
// shot holes on the skin (large scale: readable at combat range): black hole, pale splinter rim, soot halo
float hole = 0.0;
{ vec2 hp = vec2(vLPos.z + step(0.0, vLPos.x) * 17.3, vLPos.y) / vec2(1.7, 1.25);
  vec2 hc = floor(hp), hf = fract(hp) - 0.5;
  float hr = fract(sin(dot(hc, vec2(12.9898, 78.233))) * 43758.5453);
  vec2 off = vec2(fract(hr * 13.7), fract(hr * 7.3)) - 0.5;
  vec2 dv = (hf - off * 0.4) * vec2(1.7, 1.25);
  // ragged outline (two angular harmonics), a charred lip, and a few pale splinters sprung outward along the grain
  float ang = atan(dv.y, dv.x);
  float hd = length(dv) - 0.03 * sin(ang * 5.0 + hr * 40.0) - 0.02 * sin(ang * 11.0 + hr * 17.0);
  float on = isSkin * step(hr, uHullDmg * 0.55) * step(0.9, vWY) * step(vSurf.x, 0.5);
  hole = on * smoothstep(0.21, 0.18, hd);
  float lip = on * smoothstep(0.32, 0.22, hd) * (1.0 - hole);
  float spl = lip * smoothstep(0.55, 0.85, 0.5 + 0.5 * sin(ang * 9.0 + hr * 23.0)) * smoothstep(0.6, 0.2, abs(dv.y) / max(0.05, length(dv)));
  float soot = on * smoothstep(0.85, 0.3, hd) * (1.0 - hole - lip);
  diffuseColor.rgb *= 1.0 - soot * 0.75;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.04, 0.025), lip * 0.8);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.45, 0.28), spl * 0.8);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.015, 0.01), hole); }
// ropes fade toward a light hazy tone with distance (less 'black dots')
float isRope = step(0.895, vSurf.y) * step(vSurf.y, 0.925) * step(vSurf.w, 0.05);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.37, 0.3), isRope * smoothstep(30.0, 160.0, vDist) * 0.75);
// waterline: wet darkening + thin foam contact line
float wet = 1.0 - smoothstep(-0.1, 0.3, vWY);
diffuseColor.rgb *= mix(1.0, 0.42, wet * (1.0 - vSurf.z));
float foamN = texture2D(uWood, vLPos.zx * 0.11 + uTime * 0.03).a;
float foamL = smoothstep(0.22, 0.02, abs(vWY - 0.05 - foamN * 0.12)) * step(-0.3, vWY);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.95, 0.95), foamL * 0.7);
// submerged hull: absorbed into the sea colour so the ship sits IN the water (no floating hull seen through clear water)
float subm = smoothstep(-0.02, -0.9, vWY);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.17, 0.24), subm * 0.88);
float ember = scorch * (1.0 - smoothstep(0.0, 0.012, abs(sc + 0.08 - (1.05 - scorchD)))) * 0.35;
// at sea by day the stern glass reads as dark glass between its gilded frames (lit from dusk); lanterns dim
float isGlass = 1.0 - step(0.06, abs(vSurf.z - 1.0)), isLamp = 1.0 - step(0.06, abs(vSurf.z - 1.6));
float dayK = uSea * (1.0 - uNight);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.045, 0.055), isGlass * dayK * 0.9);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.24, 0.15), isLamp * dayK * 0.6);   // unlit horn panes
float glowK = 1.0 - dayK * (isGlass * 0.85 + isLamp * 0.6);
float isGold = step(0.9, vSurf.x);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(vSurf.y * (0.85 + 0.3 * wt.a) + scorch * 0.2, 0.05, 1.0);
// varnished/painted skin above the waterline: slight sheen
roughnessFactor = mix(roughnessFactor, 0.5 + 0.2 * wt.a, isSkin * step(0.3, vWY) * (1.0 - scorch) * (1.0 - hole));
roughnessFactor = mix(roughnessFactor, 0.97, burnAmt);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = vSurf.x * (1.0 - burnAmt * 0.9);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  float hh = wt.g * (0.5 + 0.5 * grain) * (1.0 - farF);
  hh -= plankFade * (1.0 - smoothstep(0.0, 0.14, dSeam)) * 0.55;   // gfx-mer: soft caulked groove between strakes
  vec2 dH = vec2(dFdx(hh), dFdy(hh)) * 0.9 * (1.0 - vSurf.z);
  normal = shipPerturb(-vViewPosition, normal, dH, faceDirection);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float flick = 0.88 + 0.12 * sin(uTime * 9.0 + vLPos.z * 3.0) * sin(uTime * 5.3 + vLPos.x * 7.0);
  float glow = vSurf.z * mix(0.35, 3.2, uNight) * flick * glowK;
  totalEmissiveRadiance += vec3(1.0, 0.6, 0.24) * glow * (0.6 + 0.4 * wt.a);
  totalEmissiveRadiance += vec3(1.0, 0.35, 0.08) * ember * 1.5 * uHullDmg;
  // bluish reflected sea light on the lower hull skin
  totalEmissiveRadiance += vec3(0.03, 0.07, 0.1) * isSkin * smoothstep(1.1, 0.1, vWY) * step(-0.05, vWY) * (1.0 - uNight * 0.85) * (1.0 - hole);
  // sea bounce on down-facing surfaces (no flat black underside)
  totalEmissiveRadiance += diffuseColor.rgb * vec3(0.05, 0.12, 0.13) * max(0.0, -vNY) * 2.2 * (1.0 - uNight * 0.8) * step(0.0, vWY);
  // painterly warm bounce fill: keeps paint colours rich in shadow (sea/deck bounce)
  totalEmissiveRadiance += diffuseColor.rgb * vec3(0.08, 0.06, 0.04) * (1.0 - uNight * 0.85) * (1.0 - vSurf.x * 0.7) * (1.0 - isPaint * 0.6);
  if (uSea > 0.5) {
    vec3 Vd = normalize(vViewPosition);
    // gilding: deep at grazing angles, a hot glint where the carving turns to the sun (reads as gold, not yellow paint)
    float gk = isGold * (1.0 - burnAmt);
    diffuseColor.rgb *= 1.0 - gk * 0.45 * (1.0 - abs(dot(normal, Vd)));
    float glint = pow(max(0.0, dot(reflect(-Vd, normal), uSunView)), 18.0);
    totalEmissiveRadiance += uSunCol * diffuseColor.rgb * glint * 2.4 * gk * (1.0 - uNight);
    // lantern light pools at night (stern lanterns, deck lantern)
    float lp = (lampPool(vLampA, uLampA.w, normal) + 0.8 * lampPool(vLampB, uLampB.w, normal)) * uNight * (1.0 - hole);
    totalEmissiveRadiance += diffuseColor.rgb * ${LAMP_COL} * lp * 2.2;
  }
}`);
  };
  m.customProgramCacheKey = () => 'shipHull_v12';
  const dm = new THREE.MeshDepthMaterial();
  dm.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aBreak; attribute vec2 aPiv; uniform float uHullDmg; uniform float uSailDmg; uniform float uDuel; uniform float uSea;
${PIV_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed = pivRot(transformed, aPiv, false);
${HIDE_GLSL}`);
  };
  dm.customProgramCacheKey = () => 'shipHullDepth_v6';
  m.userData.depth = dm;
  return m;
}

// ------------------------------------------------------------------ SAILS
// attributes: aSail (u, v, group, kind), aDir (billow direction * depth), aAnchor (furl point), aTu, aTv (dP/du, dP/dv)
const SAIL_VERT_PARS = /* glsl */`
attribute vec4 aSail; attribute vec3 aDir; attribute vec3 aAnchor; attribute vec3 aTu; attribute vec3 aTv; attribute vec2 aPiv; attribute float aBreak;
uniform float uSailDmg;
${PIV_GLSL}
uniform float uSet; uniform float uFill; uniform float uSide; uniform float uLuff; uniform float uTime; uniform float uGust;
varying vec2 vSailUv; varying float vFurl; varying float vBill; varying vec2 vFV; varying vec2 vSU;
float sailFurl(float g) {
  if (g < 0.5) return 1.0 - smoothstep(0.62, 0.9, uSet);      // courses & topgallants: set only at full sail
  if (g < 1.5) return 1.0 - smoothstep(0.06, 0.36, uSet);     // topsails: battle sail
  return 1.0 - smoothstep(0.06, 0.36, uSet);                  // fore-and-aft
}
float sailShape(float u, float v, float kind) {
  if (kind < 0.5) {   // square: fixed at the yard (v=0), clews pulled to the corners of the foot
    float su = 1.0 - pow(abs(2.0 * u - 1.0), 2.2);
    float sv = sin(3.14159 * clamp(v * 0.82 + 0.06, 0.0, 1.0));
    return su * sv * (0.35 + 0.65 * smoothstep(0.0, 0.25, v));
  }
  // fore-and-aft: luff (u=0) on mast/stay, leech (u=1) free
  float su = sin(3.14159 * clamp(u * 0.9 + 0.05, 0.0, 1.0)) * (1.0 - 0.3 * u);
  float sv = sin(3.14159 * clamp(v * 0.9 + 0.05, 0.0, 1.0));
  return su * sv;
}
float sailDisp(float u, float v, float kind) {
  float b = sailShape(u, v, kind);
  float side = kind < 0.5 ? uFill : uSide;
  float gust = 1.0 + 0.06 * sin(uTime * 1.3 + u * 2.0) + uGust * 0.05 * sin(uTime * 3.1 + v * 4.0);
  float flap = uLuff * sin(u * 8.0 - uTime * 13.0 + v * 3.0) * (0.5 + 0.5 * u) * sin(3.14159 * v);
  float ripple = 0.025 * sin(u * 11.0 + v * 7.0 - uTime * 4.0) * (1.0 - abs(side));
  // torn ribbons flog in the wind near the foot once the sail is shot up
  float tat = smoothstep(0.35, 1.0, uSailDmg) * smoothstep(0.45, 1.0, v) * sin(uTime * 9.0 + u * 41.0 + v * 6.0) * 0.45;
  return b * side * gust * (1.0 - uLuff * 0.85) + flap * 0.55 + ripple + tat;
}`;
const SAIL_VERT_MAIN = /* glsl */`
float fu = aSail.x, fv = aSail.y, kind = aSail.w;
float furl = sailFurl(aSail.z);
vFurl = furl; vSailUv = uv; vFV = vec2(aSail.y, aSail.w); vSU = aSail.xy;
float dd = sailDisp(fu, fv, kind);
vBill = dd;
vec3 dn = aDir;
vec3 p = position + dn * dd;
// furled: gather onto the anchor (yard/boom/stay) as a rolled bundle
float ang = fv * 23.0 + fu * 3.0;
vec3 rollAxisA = kind < 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
vec3 rollAxisB = kind < 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 0.0, 1.0);
if (kind > 0.5) { rollAxisA = vec3(1.0, 0.0, 0.0); rollAxisB = vec3(0.0, 1.0, 0.0); }
float rr = 0.17 * (1.0 - 0.5 * fv) * (0.6 + 0.4 * sin(fu * 3.14159));
vec3 furled = aAnchor + (rollAxisA * cos(ang) + rollAxisB * sin(ang)) * rr + vec3(0.0, 0.16, 0.0) * (kind < 0.5 ? 1.0 : 0.0);
float fe = smoothstep(0.0, 1.0, furl);
// sail drops from top to bottom as it is set (clewed up from the foot)
float drop = smoothstep(fv - 0.25, fv + 0.05, 1.0 - furl * 1.05);
float g = max(fe, 1.0 - drop);
transformed = mix(p, furled, g);
transformed = pivRot(transformed, aPiv, false);
if (aBreak > 2.5 && aBreak - 10.0 < uSailDmg) transformed = vec3(0.0, -60.0, 0.0);
`;

export function makeSailMaterial(color) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.92, metalness: 0, envMapIntensity: 0.55 });
  const u = {
    uSet: { value: 1 }, uFill: { value: 1 }, uSide: { value: 1 }, uLuff: { value: 0 }, uGust: { value: 0.5 },
    uSailDmg: { value: 0 }, uColor: { value: new THREE.Color(color) }, uCanvas: { value: getCanvasTex() }, uPiv: pivUniform(), uFac: { value: new THREE.Color(1, 1, 1) }, uEmb: { value: getEmblemTex() }, uEmbIdx: { value: 0 },
    uSea: { value: 0 }, uLampA: { value: new THREE.Vector4() }, uLampB: { value: new THREE.Vector4() },
  };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { uSailDmg2: u.uSailDmg, uTime: GLOBAL.uTime, uSunView: GLOBAL.uSunView, uSunCol: GLOBAL.uSunCol, uNight: GLOBAL.uNight });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + SAIL_VERT_PARS + LAMP_VERT)
      .replace('#include <beginnormal_vertex>', `
float _fu = aSail.x, _fv = aSail.y, _k = aSail.w; float _e = 0.02;
float _d0 = sailDisp(_fu, _fv, _k);
float _du = (sailDisp(_fu + _e, _fv, _k) - _d0) / _e;
float _dv = (sailDisp(_fu, _fv + _e, _k) - _d0) / _e;
vec3 _tu = aTu + aDir * _du; vec3 _tv = aTv + aDir * _dv;
vec3 objectNormal = cross(_tu, _tv);
objectNormal = dot(objectNormal, objectNormal) > 1e-10 ? normalize(objectNormal) : normal;
if (dot(objectNormal, normal) < 0.0) objectNormal = -objectNormal;
float _f = smoothstep(0.0, 1.0, sailFurl(aSail.z));
objectNormal = normalize(mix(objectNormal, normalize(normal + vec3(0.0, 0.8, 0.0)), _f));
objectNormal = pivRot(objectNormal, aPiv, true);
#ifdef USE_TANGENT
vec3 objectTangent = vec3( tangent.xyz );
#endif`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SAIL_VERT_MAIN + LAMP_VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${LAMP_FRAG}
uniform float uSea;
uniform sampler2D uCanvas; uniform float uSailDmg2; uniform vec3 uColor; uniform vec3 uSunView; uniform vec3 uSunCol; uniform float uNight;
varying vec2 vSailUv; varying float vFurl; varying float vBill; varying vec2 vFV; uniform vec3 uFac; uniform sampler2D uEmb; uniform float uEmbIdx; varying vec2 vSU;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec4 ct = texture2D(uCanvas, vSailUv);
float hole = ct.a;
float th = uSailDmg2 > 0.02 ? mix(0.04, 0.46, sqrt(uSailDmg2)) : -1.0;   // shot holes and tears show from light damage on
if (uSailDmg2 > 0.02 && hole < th && vFurl < 0.5) discard;
float burnt = 1.0 - smoothstep(th, th + 0.08, hole);
// round 6: tattered canvas — past ~30 % sail damage the foot tears up into hanging ribbons (slits running up from the
// foot between cloths, a ragged hem), deeper as damage grows; torn edges darken with powder grime
if (uSailDmg2 > 0.3 && vFurl < 0.5) {
  float tear = smoothstep(0.3, 1.0, uSailDmg2);
  float sid = floor(vSU.x * 13.0), strip = fract(vSU.x * 13.0);
  float h1 = fract(sin(sid * 91.7 + 3.1) * 437.5), h2 = fract(sin(sid * 17.3 + 1.7) * 911.1);
  float cut = tear * (0.22 + 0.62 * h1);
  float hem = 1.0 - tear * 0.3 * (0.4 + h2) - 0.03 * sin(vSU.x * 71.0);
  if ((strip < 0.14 + 0.18 * h2 && vSU.y > 1.0 - cut) || vSU.y > hem) discard;
  burnt = max(burnt, (1.0 - smoothstep(0.0, 0.05, hem - vSU.y)) * 0.7);
}
diffuseColor.rgb *= uColor * ct.rgb;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.08, 0.05), burnt * step(0.02, uSailDmg2));
// battle grime: powder-smoke and soot stains spread over a shot-up sail (reads from afar before the holes do)
diffuseColor.rgb *= 1.0 - 0.38 * uSailDmg2 * smoothstep(0.62, 0.3, hole) * step(vFurl, 0.5);
// canvas construction that reads at gameplay range (texture seams vanish in the mips): vertical cloth seams,
// reef bands with reef points on square sails, tabling along the edges, the yard's shadow over the head, and a
// belly gradient (edges in the lee of the bolt-rope darker, the full belly brighter) so the cambered shape reads
float sailLay = 0.0;   // doubled canvas (seams, reef bands, tabling): blocks the sun when the sail is backlit
{
  float isSq = 1.0 - step(0.5, vFV.y);
  float nCl = 9.0;
  float cu = vSU.x * nCl;
  float fw = max(fwidth(cu), 1e-4);
  float seamL = 1.0 - smoothstep(0.0, fw * 1.5 + 0.035, abs(fract(cu + 0.5) - 0.5));
  float seamFade = 1.0 - smoothstep(0.35, 0.9, fw);         // seams fade before they alias
  diffuseColor.rgb *= 1.0 - seamL * 0.16 * seamFade;
  // reef bands (square sails: two bands in the upper half), with small dark reef-point dashes
  float rv = vSU.y * 5.0; float fwv = max(fwidth(rv), 1e-4);
  float reef = (1.0 - smoothstep(0.0, fwv * 1.5 + 0.04, abs(fract(rv) - 0.5))) * step(vSU.y, 0.45) * step(0.05, vSU.y) * isSq;
  float pts = step(0.5, fract(vSU.x * 26.0)) * reef;
  diffuseColor.rgb *= 1.0 - (reef * 0.08 + pts * 0.18) * (1.0 - smoothstep(0.3, 0.8, fwv));
  // tabling: doubled canvas along the edges
  float ed = min(min(vSU.x, 1.0 - vSU.x), min(vSU.y, 1.0 - vSU.y));
  float tab = 1.0 - smoothstep(0.015, 0.035, ed);
  diffuseColor.rgb *= 1.0 - 0.1 * tab;
  sailLay = max(max(seamL * seamFade, reef * (1.0 - smoothstep(0.3, 0.8, fwv))), tab);
  // yard shadow across the head of square sails
  diffuseColor.rgb *= 1.0 - 0.22 * isSq * (1.0 - smoothstep(0.0, 0.09, vSU.y));
  // belly gradient
  float bel = (1.0 - pow(abs(2.0 * vSU.x - 1.0), 2.0)) * sin(3.14159 * clamp(vSU.y, 0.0, 1.0));
  diffuseColor.rgb *= mix(mix(0.82, 1.06, bel), 1.0, vFurl);
}
// grime toward the foot, sun-bleach toward the head
diffuseColor.rgb *= 0.9 + 0.1 * (1.0 - vSailUv.y * 0.0) ;
diffuseColor.rgb *= mix(1.0, 0.82, vFurl);
// faction stripe across the upper square sails (painted, sun-faded)
float stripe = (1.0 - step(0.5, vFV.y)) * smoothstep(0.17, 0.19, vFV.x) * (1.0 - smoothstep(0.29, 0.31, vFV.x));
diffuseColor.rgb = mix(diffuseColor.rgb, uFac * ct.rgb, stripe * 0.75 * step(fract(vFV.y), 0.1));
// painted emblem on the main course / mainsail (kind fraction .25 marks it)
if (abs(fract(vFV.y) - 0.25) < 0.05) {
  vec2 eu = vec2((vSU.x - 0.5) * 1.25 + 0.5, (vSU.y - 0.52) * 1.25 + 0.5);
  if (vFV.y > 0.9) eu = vec2((vSU.x - 0.45) * 1.6 + 0.5, (vSU.y - 0.5) * 1.6 + 0.5);
  if (eu.x > 0.0 && eu.x < 1.0 && eu.y > 0.0 && eu.y < 1.0) {
    vec4 em = texture2D(uEmb, vec2((uEmbIdx + eu.x) / 5.0, 1.0 - eu.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, em.rgb * (0.85 + 0.15 * ct.rgb), em.a * 0.92);
  }
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  // thin-canvas translucency: sun shining through the back of the sail
  vec3 Vd = normalize(vViewPosition);
  vec3 Nn = normal;
  float ndl = dot(Nn, uSunView), ndv = dot(Nn, Vd);
  float through = smoothstep(0.0, -0.25, ndl * sign(ndv + 1e-4));
  float fwd = pow(max(0.0, dot(-Vd, uSunView)), 2.0);
  float tr = through * (0.35 + 1.4 * fwd) * (1.0 - vFurl) * (1.0 - uNight);
  // seams, reef bands and tabling print as darker lines against the sun (two layers of cloth); patches too (ct)
  tr *= 1.0 - uSea * (0.55 * sailLay + 0.6 * (1.0 - min(1.0, dot(ct.rgb, vec3(0.34)))));
  totalEmissiveRadiance += diffuseColor.rgb * uSunCol * tr * vec3(1.0, 0.9, 0.72) * 1.05;
  // lantern light on the lower canvas at night
  if (uSea > 0.5) {
    float lp = (lampPool(vLampA, uLampA.w, Nn) + 0.8 * lampPool(vLampB, uLampB.w, Nn)) * uNight * (1.0 - vFurl * 0.5);
    totalEmissiveRadiance += diffuseColor.rgb * ${LAMP_COL} * lp * 2.4;
  }
  float rim = pow(1.0 - abs(ndv), 3.0) * (1.0 - vFurl);
  totalEmissiveRadiance += diffuseColor.rgb * (vec3(0.16, 0.15, 0.2) + uSunCol * rim * 0.25) * (1.0 - uNight * 0.85);
}`);
  };
  m.customProgramCacheKey = () => 'shipSail_v9';
  // shadow caster with the same deformation. gfx-mer: shot holes and the tattered foot cut the shadow as they cut the
  // cloth, and set canvas casts a half-tone shadow (dithered, smoothed by the PCF): sails no longer print hard dark quads
  const dm = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  dm.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { uTime: GLOBAL.uTime });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + SAIL_VERT_PARS + '\nvarying vec2 vSailUv2;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SAIL_VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uCanvas; uniform float uSailDmg;
varying vec2 vSailUv; varying float vFurl; varying vec2 vSU;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (vFurl < 0.5) {
  float hole = texture2D(uCanvas, vSailUv).a;
  float th = uSailDmg > 0.02 ? mix(0.04, 0.46, sqrt(uSailDmg)) : -1.0;
  if (uSailDmg > 0.02 && hole < th) discard;
  if (uSailDmg > 0.3) {
    float tear = smoothstep(0.3, 1.0, uSailDmg);
    float sid = floor(vSU.x * 13.0), strip = fract(vSU.x * 13.0);
    float h1 = fract(sin(sid * 91.7 + 3.1) * 437.5), h2 = fract(sin(sid * 17.3 + 1.7) * 911.1);
    float cut = tear * (0.22 + 0.62 * h1);
    float hem = 1.0 - tear * 0.3 * (0.4 + h2) - 0.03 * sin(vSU.x * 71.0);
    if ((strip < 0.14 + 0.18 * h2 && vSU.y > 1.0 - cut) || vSU.y > hem) discard;
  }
  // thin canvas lets ~40 % of the sun through (interleaved-gradient dither)
  if (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) < 0.4) discard;
}`);
  };
  dm.customProgramCacheKey = () => 'shipSailDepth_v6';
  m.userData.depth = dm;
  return m;
}

// ------------------------------------------------------------------ FLAGS
// position = hoist point (local), aFlag = (u along fly 0..1, v down 0..1, length, height), aKind (0 ensign, 1 pennant)
const FLAG_VERT_PARS = /* glsl */`
attribute vec4 aFlag; attribute float aKind;
uniform float uYaw; uniform float uStrike; uniform float uWind; uniform float uTime; uniform float uDrop;
float flagWave(float u, float v, float k) {
  // travelling cloth waves: amplitude grows toward the fly, a diagonal second wave keeps it from reading as a flat card
  float a = (0.07 + 0.06 * k) * pow(u, 0.8) * (0.55 + 0.45 * uWind);
  float w = a * sin(u * 8.5 - uTime * (6.0 + 3.0 * k) + v * 1.6)
          + a * 0.45 * sin(u * 15.0 + v * 4.0 - uTime * 10.5)
          + a * 0.3 * sin(v * 6.3 - uTime * 4.0 + u * 3.0);
  return w;
}
vec3 flagPos(vec3 hoist, vec4 f, float k) {
  float u = f.x, v = f.y, L = f.z, H = f.w;
  float droop = (1.0 - uWind) * 0.7 + 0.1;
  vec3 dirL = vec3(sin(uYaw), 0.0, -cos(uYaw));
  vec3 side = vec3(cos(uYaw), 0.0, sin(uYaw));
  float w = flagWave(u, v, k) * L;
  // cloth bellies sideways (cupped across the hoist) and the fly shortens as it ripples
  float belly = sin(3.14159 * v) * u * 0.12 * H * (1.0 - k);
  float x = u * L * (1.0 - droop * 0.35) - abs(w) * 0.35;
  float y = -v * H - u * L * droop * 0.55 - u * u * H * 0.12;
  vec3 p = hoist + dirL * x + vec3(0.0, y, 0.0) + side * (w + belly);
  if (k < 0.5) p.y -= uStrike * uDrop;
  return p;
}`;

export function makeFlagMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.85, metalness: 0, envMapIntensity: 0.5 });
  const u = { uYaw: { value: 0 }, uStrike: { value: 0 }, uWind: { value: 1 }, uDrop: { value: 10 }, uSea: { value: 0 } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { uTime: GLOBAL.uTime, uNight: GLOBAL.uNight });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + FLAG_VERT_PARS + '\nvarying float vFold;')
      .replace('#include <beginnormal_vertex>', `
vec3 _p0 = flagPos(position, aFlag, aKind);
vec3 _pu = flagPos(position, aFlag + vec4(0.02, 0.0, 0.0, 0.0), aKind);
vec3 _pv = flagPos(position, aFlag + vec4(0.0, 0.02, 0.0, 0.0), aKind);
vec3 objectNormal = cross(_pu - _p0, _pv - _p0);
objectNormal = dot(objectNormal, objectNormal) > 1e-12 ? normalize(objectNormal) : vec3(1.0, 0.0, 0.0);`)
      .replace('#include <begin_vertex>', `vec3 transformed = flagPos(position, aFlag, aKind);
// fold slope across the travelling waves (painted light / shade bands, independent of the sun)
vFold = clamp((flagWave(aFlag.x + 0.04, aFlag.y, aKind) - flagWave(aFlag.x, aFlag.y, aKind)) / (0.36 * (0.07 + 0.06 * aKind)), -1.5, 1.5);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSea; uniform float uNight; varying float vFold;')
      .replace('#include <map_fragment>', `#include <map_fragment>
diffuseColor.rgb *= gl_FrontFacing ? 0.95 : 0.8;
// cloth folds: lit crests, shaded troughs; deeper toward the fly where the waves are biggest
diffuseColor.rgb *= 1.0 + uSea * clamp(vFold, -1.0, 1.0) * 0.38;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * 0.12 * (1.0 - uSea * uNight * 0.85);`);
  };
  m.customProgramCacheKey = () => 'shipFlag_v4';
  const dm = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  dm.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u, { uTime: GLOBAL.uTime });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + FLAG_VERT_PARS)
      .replace('#include <begin_vertex>', `vec3 transformed = flagPos(position, aFlag, aKind);`);
  };
  dm.customProgramCacheKey = () => 'shipFlagDepth_v3';
  m.userData.depth = dm;
  return m;
}

// ------------------------------------------------------------------ CREW
let _crewMat = null;
export function getCrewMaterial() {
  if (_crewMat) return _crewMat;
  _crewMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  return _crewMat;
}
