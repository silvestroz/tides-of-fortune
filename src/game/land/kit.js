// Shared land art kit: painted, stylised scenery for the land scenes (town assault, town sneak), in the "painted
// adventure book" look of the sea world: soft gradients, vertex colours worked with brush noise, warm light.
// Everything is procedural: geometry carries vertex colours + a material id per vertex (aMat, ids in KM), merged
// per material with GeoBuilder (src/world/towns/builder.js) or drawn as InstancedMesh (vegetation, rocks, effects).
//
// Materials (a fresh set per scene: created when the scene is built, released with K.dispose() when it ends;
// nothing of the kit exists at sea or at the title screen):
//   kitMaterials() -> { paint, water, puff, flash, flag, dispose() }
//     paint  MeshStandardMaterial for every opaque prop and the ground; reads aMat (KM ids) for its brushwork
//            (worn plaster with brick showing through and grime at the foot, brick, barrel tiles, planks, ashlar,
//            cobbles, foliage, bark, rock strata) and, on the ground (KM.GROUND),
//            aGround = vec4(sand, paved, field, rock) blend weights over grass. Works on Mesh and InstancedMesh
//            (instance colour multiplies the vertex colour; KM.FOLIAGE sways in the wind when instanced).
//     water  painted sea: vertex colour = depth tint, aFoam (0–1) = shore foam; animated ripples
//     puff / flash  soft camera-facing billboards for PuffPool (normal / additive blending)
//     flag   nation flags from the shared flag atlas (clothGeo + flagUV)
//   kitTick(dt)   advances the shared time uniform (sway, ripples)
//   KM            material ids (builder.js ids + FOLIAGE BARK GROUND ROCK CLAY)
//   PALETTE       { walls, roofs, trims, stone, sand } colonial colours (ochre, salmon, white, pale blue...)
// Builders (append triangles to a GeoBuilder B; y = ground height at the footprint, rot = local +z facing direction):
//   house(B, { x, z, y, w, d, rot, floors, wall, roof, trim, hip, rand, dress })   footprint w × d, 1–3 floors, tiled
//            roof with ridge and overhang, door in its stone frame with a step, shuttered windows with flower boxes,
//            sometimes a balcony, a chimney, a hanging sign, an awning, pots and goods along the walls (dress: false =
//            bare); its walls lean and its ridge sags a little (lean)
//   church(B, { x, z, y, rot, wall, roof, spire }) -> { top: [x, y, z] }   nave + bell tower (dome or spire)
//   fort(B, { x, z, y, w, d, rot }) -> { flag: [x, y, z] }   low stone bastioned fort with guns and a flagpole
//   lowWall(B, x0, z0, x1, z1, ground, { h, color })          dry-stone wall following the ground
// Facade and street dressing (shared by both towns; face(x, z, nx, nz) = a wall plane through (x, z) facing (nx, nz),
// u along the wall, o out of it):
//   doorFrame(B, F, { u, y, w, h, step })   stone jambs, lintel, a worn step     balcony(B, F, { u, y, w, rand, trim })
//   hangingSign(B, F, { u, y, color })   awning(B, F, { u, y, w, color })   flowerBox(B, F, { u, y, w, rand })
//   pot(B, x, y, z, s, rand)   laundry(B, a [x, y, z], b, rand)   lean(parts, y0, h, rand) (warps a building's
//   vertices: walls lean, the ridge sags; nothing moves at the foot)
//   cart(B, { x, z, y, rot, load, rand })   crates(B, { x, z, y, rot, rand })   sacks(B, { x, z, y, rot, rand })
//   barrel(B, x, y, z, s)   well(B, { x, z, y, rot })   fountain(B, { x, z, y, r })
//   longboat(B, { x, z, y, rot, color })                       a ship's boat pulled up on the beach
//   anchoredShips(B, ships [{ type, x, z, rot }], faction) -> Mesh   ship hulls (sea-world models, a hull material of
//            its own: dispose mesh.geometry, mesh.material and mesh.customDepthMaterial with the scene) + their furled
//            sails merged into B
// Instanced props (unit geometry, base at y = 0, one set per scene): vegGeos() -> { broadleaf, palm, bush, rock, dispose() }
//   scatter(geo, material, items [{ x, y, z, s, r, tint }], { shadow }) -> InstancedMesh
// Ground: paintGround(geo, fn)   geo = a horizontal grid already displaced in y; fn(x, z, y) -> { color, sand, paved,
//   field, rock } (weights 0–1) writes the colour and aGround attributes and sets aMat = KM.GROUND
// Cloth: clothGeo(w, h, segW, segH) flag plane hanging from x = 0, flagUV(geo, faction) maps it onto that nation's
//   flag, waveCloth(geo, t, amp) waves it (CPU)
// Effects: new PuffPool(scene, K, max, { additive }) .spawn({ x, y, z, vx, vy, vz, size, grow, life, color, alpha, rise, fadeIn })
//   .update(dt) — smoke, dust and muzzle flashes, one draw call per pool
import * as THREE from 'three';
import { GeoBuilder, M } from '../../world/towns/builder.js';
import { getDetailTexture, getFlagAtlas, FLAG_INDEX } from '../../world/terrain/textures.js';
import { getShipStaticParts } from '../../ships/shipModel.js';
import { makeHullMaterial } from '../../ships/art/materials.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../core/rng.js';

export { GeoBuilder };
export const KM = { ...M, FOLIAGE: 14, BARK: 15, GROUND: 16, ROCK: 17, CLAY: 18 };   // CLAY: plain painted colour (pots, cloth goods)
export const PALETTE = {
  walls: ['#e8c27a', '#e3a46e', '#f1e7d2', '#d98f74', '#b9cfd6', '#efd9a8', '#f4efe2', '#d9b07a', '#c9dccf', '#e6b598'],
  roofs: ['#b4532f', '#a2482a', '#c2653e', '#93401f', '#cc7446', '#a85d37'],
  trims: ['#3f6a5a', '#6a3a24', '#2f5470', '#7a2a24', '#4d6b3a', '#5a4632'],
  stone: '#b8a988', sand: '#e2cf9c',
};

const TIME = { value: 0 };
export function kitTick(dt) { TIME.value += dt; }

// ------------------------------------------------------------------------------------------------ materials
const PAINT_FRAG = /* glsl */`
  float mid = floor(vMat + 0.5);
  vec3 P = vKW, N = normalize(vKN);
  vec3 c = diffuseColor.rgb;
  float u = abs(N.x) > abs(N.z) ? P.z : P.x;
  if (mid == 16.0) {
    vec4 d = texture2D(uDetail, P.xz * 0.09), dB = texture2D(uDetail, P.xz * 0.021), dL = texture2D(uDetail, P.xz * 0.0055);
    vec3 g = c * (0.84 + 0.3 * d.g) * (0.9 + 0.2 * dB.r);
    g = mix(g, g * vec3(1.14, 1.06, 0.74), smoothstep(0.45, 0.8, dL.r) * 0.55);              // sun-dried patches
    g = mix(g, g * vec3(0.78, 0.9, 0.82), smoothstep(0.55, 0.85, dL.g) * 0.35);               // cool shade patches
    vec3 s = c * (0.93 + 0.1 * d.a) * (0.95 + 0.06 * sin(P.x * 0.8 + P.z * 0.35 + dB.r * 6.0));
    float stone = texture2D(uDetail, P.xz * 0.13).b;
    vec3 pv = c * mix(0.6, 1.02, smoothstep(0.06, 0.32, stone)) * (0.88 + 0.18 * d.r);
    vec3 f = c * (0.78 + 0.3 * smoothstep(0.25, 0.75, abs(fract(P.x * 0.3 + dB.r * 0.5) - 0.5) * 2.0)) * (0.92 + 0.12 * d.g);
    vec3 r = c * (0.74 + 0.36 * d.r) * (0.86 + 0.18 * sin(P.y * 2.4 + d.g * 3.0));
    vec4 w = vGround; float wg = max(0.0, 1.0 - w.x - w.y - w.z - w.w);
    c = g * wg + s * w.x + pv * w.y + f * w.z + r * w.w;
  } else {
    vec4 d = triT(P, N, 0.11), dB = triT(P, N, 0.027);
    if (mid == 0.0 || mid == 1.0) {                                                                                  // plaster, brick
      float lum = dot(c, vec3(0.3, 0.59, 0.11)), hgt = P.y - vKGround;
      vec2 bq = vec2(u * 4.2, P.y * 8.4); bq.x += floor(bq.y) * 0.5;                                                  // bricks in running bond
      vec2 bf = fract(bq); float br = fract(sin(dot(floor(bq), vec2(12.9, 78.2))) * 437.5);
      float mort = smoothstep(0.0, 0.1, bf.y) * smoothstep(1.0, 0.9, bf.y) * smoothstep(0.0, 0.05, bf.x) * smoothstep(1.0, 0.95, bf.x);
      vec3 brick = mix(vec3(0.62, 0.56, 0.48), vec3(0.66, 0.33, 0.22) * (0.78 + 0.36 * br), mort) * (0.8 + 0.3 * d.r) * (0.55 + 0.6 * lum);
      if (mid == 1.0) c *= mix(0.6, 0.78 + 0.36 * br, mort) * (0.82 + 0.3 * d.r);
      else {
        c *= 0.84 + 0.26 * dB.r + 0.1 * d.a; c = mix(c, c * vec3(0.82, 0.76, 0.68), smoothstep(0.62, 0.9, triT(P, N, 0.009).r));
        if (abs(N.y) < 0.5) {
          vec2 wp = vec2(u, P.y);
          float wn = texture2D(uDetail, wp * 0.06 + 0.37).r * 0.7 + texture2D(uDetail, wp * 0.21 + 0.11).b * 0.3;
          float hole = smoothstep(0.585, 0.6, wn), rim = smoothstep(0.55, 0.585, wn) * (1.0 - hole);
          c = mix(c, c * vec3(0.7, 0.66, 0.6), rim * 0.7);                                                             // crumbled edge
          c = mix(c, brick, hole);                                                                                     // fallen plaster: the brick shows
          float streak = texture2D(uDetail, vec2(u * 0.4, P.y * 0.01)).g;
          c *= (0.9 + 0.14 * streak) * mix(0.66, 1.0, smoothstep(0.0, 1.5, hgt));                                      // rain streaks, grime at the foot
        }
      }
    }
    else if (mid == 2.0 || mid == 5.0) { vec2 t2 = vec2(u * 2.6, P.y * 3.0); t2.x += floor(t2.y) * 0.5;
      float cell = fract(sin(dot(floor(t2), vec2(12.9, 78.2))) * 437.5);
      c *= (0.62 + 0.42 * sin(fract(t2.x) * 3.14159)) * (0.74 + 0.26 * smoothstep(0.0, 0.3, fract(t2.y))) * (0.84 + 0.32 * cell);
      c = mix(c, c * vec3(0.72, 0.78, 0.55), smoothstep(0.62, 0.9, dB.r) * 0.5); }                                   // barrel tiles + lichen
    else if (mid == 3.0) { c *= (0.74 + 0.4 * d.g) * mix(0.72, 1.0, step(0.07, fract(u * 3.0 + P.y * 0.02))); }      // planks
    else if (mid == 4.0) { vec2 b = abs(N.y) > 0.6 ? P.xz * vec2(1.1, 2.2) : vec2(u * 1.3 + floor(P.y * 2.2) * 0.5, P.y * 2.2); vec2 fb = fract(b);
      float m = smoothstep(0.02, 0.08, fb.x) * smoothstep(0.98, 0.92, fb.x) * smoothstep(0.03, 0.11, fb.y) * smoothstep(0.97, 0.89, fb.y);
      float rnd = fract(sin(dot(floor(b), vec2(41.3, 17.7))) * 137.1);
      c *= mix(0.6, (0.78 + 0.32 * rnd) * (0.86 + 0.28 * d.r), m);
      c = mix(c, vec3(0.3, 0.36, 0.2), smoothstep(0.55, 0.95, dB.r) * smoothstep(2.5, 0.0, P.y - vKGround) * 0.5); }  // ashlar + moss at the foot
    else if (mid == 11.0) { float st = triT(P, N, 0.14).b; c *= mix(0.62, 1.0, smoothstep(0.06, 0.3, st)) * (0.86 + 0.2 * d.r); }   // cobbles
    else if (mid == 14.0) { c *= 0.72 + 0.52 * d.g * d.r + 0.18 * dB.r; c = mix(c, c * vec3(1.18, 1.12, 0.8), smoothstep(0.3, 0.95, N.y) * 0.45); }   // foliage
    else if (mid == 15.0) { c *= 0.7 + 0.4 * texture2D(uDetail, vec2(u * 0.5, P.y * 0.05)).g; }                        // bark
    else if (mid == 17.0) { c *= (0.76 + 0.34 * d.r) * (0.86 + 0.18 * sin(P.y * 2.6 + d.g * 4.0));
      c = mix(c, vec3(0.36, 0.42, 0.22), smoothstep(0.55, 0.95, N.y) * smoothstep(0.35, 0.7, dB.r) * 0.75); }       // rock strata + moss
    else if (mid == 10.0 || mid == 6.0) { c *= 0.86 + 0.22 * d.g; }                                                   // sail cloth, thatch
  }
  // painted light: warm on the faces turned to the sky, cooler on the sides
  c *= mix(vec3(0.94, 0.96, 1.03), vec3(1.05, 1.0, 0.93), clamp(N.y * 0.5 + 0.5, 0.0, 1.0));
  diffuseColor.rgb = c;`;

function paintMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uDetail = { value: getDetailTexture() }; sh.uniforms.uTime = TIME;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aMat; attribute vec4 aGround; uniform float uTime;
        varying float vMat; varying vec4 vGround; varying vec3 vKW; varying vec3 vKN; varying float vKGround;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vMat = aMat; vGround = aGround;
        #ifdef USE_INSTANCING
          if (abs(aMat - 14.0) < 0.5) {
            vec3 ip = instanceMatrix[3].xyz;
            float sw = sin(uTime * 1.1 + ip.x * 0.07 + ip.z * 0.05) * 0.045 + sin(uTime * 2.3 + ip.x * 0.31) * 0.012;
            float k = max(0.0, position.y - 1.0);
            transformed.x += sw * k; transformed.z += sw * 0.6 * k;
          }
        #endif`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        { vec4 kw = vec4(transformed, 1.0); vec3 kn = objectNormal; vec4 k0 = vec4(0.0, 0.0, 0.0, 1.0);
          #ifdef USE_INSTANCING
            kw = instanceMatrix * kw; kn = mat3(instanceMatrix) * kn; k0 = instanceMatrix * k0;
          #endif
          vKW = (modelMatrix * kw).xyz; vKN = normalize(mat3(modelMatrix) * kn); vKGround = (modelMatrix * k0).y; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uDetail; varying float vMat; varying vec4 vGround; varying vec3 vKW; varying vec3 vKN; varying float vKGround;
        vec4 triT(vec3 p, vec3 n, float s) { vec3 w = pow(abs(n), vec3(4.0)); w /= w.x + w.y + w.z;
          return texture2D(uDetail, p.zy * s) * w.x + texture2D(uDetail, p.xz * s) * w.y + texture2D(uDetail, p.xy * s) * w.z; }`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + PAINT_FRAG);
  };
  m.customProgramCacheKey = () => 'landKitPaint_v1';
  return m;
}

function waterMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uDetail = { value: getDetailTexture() }; sh.uniforms.uTime = TIME;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFoam; varying float vFoam; varying vec3 vWW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFoam = aFoam; vWW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail; uniform float uTime; varying float vFoam; varying vec3 vWW;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = vWW.xz;
        float r1 = texture2D(uDetail, p * 0.018 + vec2(uTime * 0.012, uTime * 0.007)).g;
        float r2 = texture2D(uDetail, p * 0.047 - vec2(uTime * 0.016, -uTime * 0.01)).r;
        vec3 c = diffuseColor.rgb * (0.88 + 0.24 * r1 * r2 * 1.6);
        c = mix(c, c * vec3(1.12, 1.16, 1.08), smoothstep(0.62, 0.8, r1 * 0.6 + r2 * 0.5) * 0.6);                 // light brush ripples
        float fb = vFoam * (0.6 + 0.4 * sin(uTime * 1.4 - vFoam * 5.0 + r2 * 4.0));
        float fm = smoothstep(0.35, 0.6, fb + texture2D(uDetail, p * 0.09 + uTime * 0.02).g * 0.45 * vFoam);
        diffuseColor.rgb = mix(c, vec3(0.95, 0.96, 0.9), fm * 0.85);`);
  };
  m.customProgramCacheKey = () => 'landKitWater_v1';
  return m;
}

// soft round puff with brush-noise edges; the instance colour tints it, aFade (0–1) sets its opacity
function puffMaterial(additive) {
  return new THREE.ShaderMaterial({
    uniforms: { uDetail: { value: getDetailTexture() } },
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */`
      attribute float aFade; varying vec2 vUv; varying float vFade; varying vec3 vCol; varying float vSeed;
      void main() {
        vUv = uv; vFade = aFade;
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.0);
        #endif
        vec3 ip = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float s = length(instanceMatrix[0].xyz);
        vSeed = fract(ip.x * 0.137 + ip.z * 0.291);
        vec4 mv = viewMatrix * vec4(ip, 1.0); mv.xy += position.xy * s;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uDetail; varying vec2 vUv; varying float vFade; varying vec3 vCol; varying float vSeed;
      void main() {
        vec2 q = vUv - 0.5; float r = length(q) * 2.0;
        float n = texture2D(uDetail, vUv * 0.35 + vSeed).r;
        float a = smoothstep(1.0, 0.35, r + (n - 0.5) * 0.5) * vFade;
        if (a < 0.01) discard;
        vec3 c = vCol * (0.86 + 0.24 * (1.0 - r) + 0.12 * n);
        gl_FragColor = vec4(c, a);
      }`,
  });
}

export function kitMaterials() {
  const K = { paint: paintMaterial(), water: waterMaterial(), puff: puffMaterial(false), flash: puffMaterial(true),
    flag: new THREE.MeshStandardMaterial({ map: getFlagAtlas(), side: THREE.DoubleSide, roughness: 0.9 }) };   // the atlas is the sea world's
  K.dispose = () => { for (const k of ['paint', 'water', 'puff', 'flash', 'flag']) K[k].dispose(); };
  return K;
}

// ------------------------------------------------------------------------------------------------ helpers
const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
// local frame of a footprint: lx along its width, lz toward its front (rot = direction of local +z)
const frame = (x, z, rot) => { const cs = Math.cos(rot), sn = Math.sin(rot); return (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs]; };
const pick = (r, a) => a[Math.floor(r() * a.length)];
// cylinder from point a to point b ([x, y, z]), radius r0 at a and r1 at b
const _ma = new THREE.Matrix4(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _one = new THREE.Vector3(1, 1, 1);
function rod(B, a, b, r0, r1, color, mat, seg = 7) {
  const va = new THREE.Vector3(...a), dir = new THREE.Vector3(...b).sub(va), len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg);
  _ma.compose(va.addScaledVector(dir, 0.5), _q.setFromUnitVectors(_up, dir.normalize()), _one);
  B.geo(g, _ma, color, mat); g.dispose();
}

// ------------------------------------------------------------------------------------------------ buildings
export function house(B, { x, z, y, w = 8, d = 7, rot = 0, floors = 1, wall, roof, trim, hip = false, rand = Math.random, dress = true }) {
  wall ||= pick(rand, PALETTE.walls); roof ||= pick(rand, PALETTE.roofs); trim ||= pick(rand, PALETTE.trims);
  const H = floors * 3.3 + 0.7, L = frame(x, z, rot), from = B.pos.length;
  B.ground = y; B.aoH = 3.2;
  B.block(x, y - 3, z, w + 0.5, 3.4, d + 0.5, '#8d8068', KM.STONE, rot);                         // plinth (absorbs the slope)
  B.block(x, y, z, w, H, d, wall, KM.PLASTER, rot);
  B.block(x, y, z, w + 0.08, 0.9, d + 0.08, shade(wall, 0.72), KM.PLASTER, rot);                // splash band
  B.block(x, y + H - 0.4, z, w + 0.1, 0.4, d + 0.1, shade(wall, 0.6), KM.PLASTER, rot);         // eave shadow
  if (floors >= 2) B.block(x, y + 3.25, z, w + 0.14, 0.16, d + 0.14, shade(wall, 0.85), KM.PLASTER, rot);   // string course
  const rh = d * (hip ? 0.36 : 0.44) * (0.9 + rand() * 0.2);
  if (hip) B.hip(x, y + H, z, w, d, rh, roof, KM.TILE, rot, 0.75);
  else {
    B.gable(x, y + H, z, w, d, rh, roof, KM.TILE, rot, 0.75, wall, KM.PLASTER);
    B.block(x, y + H + rh - 0.12, z, w + 1.6, 0.3, 0.42, shade(roof, 0.7), KM.TILE, rot);         // ridge tiles
  }
  if (rand() < 0.35) { const [cx, cz] = L(w * 0.28 * (rand() < 0.5 ? -1 : 1), -d * 0.12); B.block(cx, y + H, cz, 0.9, rh + 1.1, 0.9, shade(wall, 0.9), KM.PLASTER, rot); }   // chimney
  // front (+z) and back faces: door, shuttered windows on every floor, flower boxes
  const nWin = Math.max(1, Math.floor(w / 2.9)), sn = Math.sin(rot), cs = Math.cos(rot);
  const faces = { 1: face(...L(0, d / 2), sn, cs), [-1]: face(...L(0, -d / 2), -sn, -cs) };
  let doorU = 0;
  for (const side of [1, -1]) for (let f = 0; f < floors; f++) for (let k = 0; k < nWin; k++) {
    const t = (k + 0.5) / nWin - 0.5, lx = t * w * 0.82, F = faces[side], u = -side * lx;
    if (side === 1 && f === 0 && k === (nWin >> 1)) {
      const [dx, dz] = L(lx, d / 2 + 0.06);
      B.block(dx, y, dz, 1.7, 2.7, 0.14, '#3a2a1c', KM.DARK, rot);
      const [ex, ez] = L(lx, d / 2 + 0.12); B.block(ex, y, ez, 1.3, 2.4, 0.12, trim, KM.WOOD, rot);
      if (dress) doorFrame(B, F, { u, y, w: 1.7, h: 2.7 });
      doorU = u;
      continue;
    }
    const wy = y + 1.4 + f * 3.3;
    const [wx, wz] = L(lx, side * (d / 2 + 0.06));
    B.block(wx, wy, wz, 1.05, 1.5, 0.12, '#22262c', KM.WINDOW, rot);
    for (const s of [-1, 1]) { const [sx, sz] = L(lx + s * 0.88, side * (d / 2 + 0.1)); B.block(sx, wy - 0.05, sz, 0.58, 1.6, 0.1, trim, KM.WOOD, rot); }
    if (dress && rand() < (f ? 0.4 : 0.18)) flowerBox(B, F, { u, y: wy, w: 1.15, rand });
  }
  if (floors >= 2 && rand() < 0.45) {                                                            // wooden balcony
    const bw = w * (0.4 + rand() * 0.35);
    balcony(B, faces[1], { u: 0, y: y + 3.3 + 0.5, w: bw, rand, trim });
  }
  if (dress) {
    const F = faces[1], r = rand();
    if (r < 0.22) hangingSign(B, F, { u: doorU + (doorU > 0 ? -1.6 : 1.6), y: 2.6 + y, rand });
    else if (r < 0.5 && nWin > 1) awning(B, F, { u: doorU + (doorU > 0 ? -1 : 1) * w * 0.82 / nWin, y: y + 2.55, w: 1.9, rand });
    if (rand() < 0.55) for (const s of rand() < 0.5 ? [-1] : [-1, 1]) { const [px, pz] = F.at(doorU + s * 1.25, 0.32); pot(B, px, y, pz, 1.1, rand); }
    if (floors >= 2 && rand() < 0.22) { const ly = y + 3.3 + 2.3, [ax, az] = F.at(-w / 2 + 0.4, 0.55), [bx, bz] = F.at(w / 2 - 0.4, 0.55); laundry(B, [ax, ly, az], [bx, ly, bz], rand); }
    const g = rand();                                                                              // goods along a side wall
    if (g < 0.3) { const s = rand() < 0.5 ? -1 : 1, Fs = face(...L(s * w / 2, 0), s * cs, -s * sn);
      for (let q = 0; q < 2; q++) { const [bx, bz] = Fs.at((q - 0.5) * 1.3, 0.55); barrel(B, bx, y, bz, 0.85); } }
    else if (g < 0.42) { const [cx, cz] = L((rand() - 0.5) * w * 0.4, -d / 2 - 1.2); cart(B, { x: cx, z: cz, y, rot: rot + Math.PI / 2 + (rand() - 0.5) * 0.3, load: pick(rand, ['hay', 'sacks', 'barrels']), rand }); }   // behind the house
  }
  lean([[B.pos, from]], y, H, rand);
}

export function church(B, { x, z, y, rot = 0, wall = '#f2ead8', roof = '#b4532f', spire = false }) {
  const L = frame(x, z, rot), w = 11, d = 22, h = 11;
  B.ground = y; B.aoH = 4;
  B.block(x, y - 3, z, w + 0.8, 3.4, d + 0.8, '#8d8068', KM.STONE, rot);
  B.block(x, y, z, w, h, d, wall, KM.PLASTER, rot);
  B.block(x, y, z, w + 0.1, 1.1, d + 0.1, shade(wall, 0.75), KM.PLASTER, rot);
  B.gable(x, y + h, z, d, w, 4.6, roof, KM.TILE, rot + Math.PI / 2, 0.7, wall, KM.PLASTER);
  // façade (local +z): raised pediment, arched door, oculus
  const [fx, fz] = L(0, d / 2 + 0.3);
  B.block(fx, y, fz, w + 1.2, h + 2.6, 0.7, shade(wall, 1.02), KM.PLASTER, rot);
  B.gable(fx, y + h + 2.6, fz, w + 1.2, 0.7, 2.6, shade(wall, 0.95), KM.PLASTER, rot, 0.1);
  const [dx, dz] = L(0, d / 2 + 0.66), [ex, ez] = L(0, d / 2 + 0.8);
  B.block(dx, y, dz, 2.6, 4.4, 0.12, '#2e2014', KM.DARK, rot);
  rod(B, [dx, y + 4.4, dz], [ex, y + 4.4, ez], 1.3, 1.3, '#2e2014', KM.DARK, 10);               // arched door
  rod(B, [dx, y + 8.6, dz], [ex, y + 8.6, ez], 0.9, 0.9, '#1f2630', KM.WINDOW, 12);             // oculus
  for (let k = -2; k <= 2; k++) for (const s of [-1, 1]) {                                        // side buttresses and windows
    const [bx, bz] = L(s * (w / 2 + 0.35), k * 4.2); B.block(bx, y, bz, 0.7, h - 2, 1.1, shade(wall, 0.92), KM.PLASTER, rot);
    const [wx, wz] = L(s * (w / 2 + 0.06), k * 4.2 + 2.1); if (k < 2) B.block(wx, y + 4, wz, 0.12, 3, 1.1, '#1f2630', KM.WINDOW, rot);
  }
  // bell tower at the front corner
  const [tx, tz] = L(w / 2 + 2.6, d / 2 - 3), th = 23;
  B.block(tx, y - 3, tz, 6.4, th + 3, 6.4, wall, KM.PLASTER, rot);
  for (const lv of [8, 15.5]) B.block(tx, y + lv, tz, 6.7, 0.45, 6.7, shade(wall, 0.85), KM.PLASTER, rot);
  for (const s of [-1, 1]) for (const [ax, az] of [[0, 3.24], [3.24, 0]]) {                       // belfry openings
    const [ox, oz] = L(w / 2 + 2.6 + ax * s, d / 2 - 3 + az * s); B.block(ox, y + th - 5, oz, az ? 1.6 : 0.12, 3, az ? 0.12 : 1.6, '#1d1a18', KM.DARK, rot);
  }
  B.block(tx, y + th, tz, 7, 0.5, 7, shade(wall, 0.85), KM.PLASTER, rot);
  let top;
  if (spire) { B.spire(tx, y + th + 0.5, tz, 4.4, 11, 4, '#4a5260', KM.SLATE, rot + Math.PI / 4); top = [tx, y + th + 11.5, tz]; }
  else { B.block(tx, y + th + 0.5, tz, 4.6, 3.4, 4.6, wall, KM.PLASTER, rot); B.dome(tx, y + th + 3.9, tz, 2.6, roof, KM.TILE, 10); B.cyl(tx, y + th + 6.4, tz, 0.08, 0.08, 1.8, 4, '#2a2018', KM.IRON); top = [tx, y + th + 8.2, tz]; }
  return { top };
}

// bastioned fort: square curtain with a diamond bastion at each corner, parapet with embrasures, guns, a barrack
// block and a flagpole; footprint w × d (curtain), base at y
export function fort(B, { x, z, y, w = 46, d = 34, rot = 0 }) {
  const L = frame(x, z, rot), S = PALETTE.stone, h = 7, t = 3.2;
  B.ground = y; B.aoH = 5;
  const curtain = (lx, lz, len, along) => {
    const [cx, cz] = L(lx, lz), sx = along ? len : t, sz = along ? t : len;
    const nx = along ? 0 : Math.sign(lx), nz = along ? Math.sign(lz) : 0;                          // outward normal (local)
    B.block(cx, y - 12, cz, sx + 1.6, 13, sz + 1.6, shade(S, 0.82), KM.STONE, rot);               // battered footing
    B.block(cx, y, cz, sx, h, sz, S, KM.STONE, rot);
    B.block(cx, y + h, cz, sx + 0.3, 0.45, sz + 0.3, shade(S, 1.08), KM.STONE, rot);              // cordon
    const n = Math.floor(len / 4);
    for (let k = 0; k < n; k++) {                                                                  // merlons between embrasures, a gun in every other one
      const o = ((k + 0.5) / n - 0.5) * len, ax = along ? lx + o : lx + nx * (t / 2 - 0.4), az = along ? lz + nz * (t / 2 - 0.4) : lz + o;
      const [qx, qz] = L(ax, az);
      B.block(qx, y + h + 0.45, qz, along ? 2.4 : 0.8, 1.2, along ? 0.8 : 2.4, S, KM.STONE, rot);
      if (k % 2 === 0) { const gx = along ? lx + o + 2 : lx, gz = along ? lz : lz + o + 2, [x0, z0] = L(gx, gz), [x1, z1] = L(gx + nx * 3, gz + nz * 3);
        rod(B, [x0, y + h + 1.2, z0], [x1, y + h + 1.2, z1], 0.3, 0.24, '#26221e', KM.IRON); }
    }
  };
  curtain(0, d / 2, w, true); curtain(0, -d / 2, w, true); curtain(w / 2, 0, d, false); curtain(-w / 2, 0, d, false);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {                                   // corner bastions
    const [bx, bz] = L(sx * w / 2, sz * d / 2);
    B.block(bx, y - 12, bz, 11, 13, 11, shade(S, 0.82), KM.STONE, rot + Math.PI / 4);
    B.block(bx, y, bz, 9.5, h + 0.6, 9.5, shade(S, 0.97), KM.STONE, rot + Math.PI / 4);
    B.block(bx, y + h + 0.6, bz, 9.9, 0.45, 9.9, shade(S, 1.08), KM.STONE, rot + Math.PI / 4);
    const [g0x, g0z] = L(sx * (w / 2 + 1.5), sz * (d / 2 + 1.5)), [g1x, g1z] = L(sx * (w / 2 + 4), sz * (d / 2 + 4));
    rod(B, [g0x, y + h + 1.6, g0z], [g1x, y + h + 1.6, g1z], 0.34, 0.26, '#26221e', KM.IRON);
    const [wx, wz] = L(sx * (w / 2 + 3.4), sz * (d / 2 + 3.4)); B.cyl(wx, y + h + 1, wz, 0.9, 0.9, 2.6, 8, shade(S, 1.05), KM.STONE); B.dome(wx, y + h + 3.6, wz, 1.1, shade(S, 1.05), KM.STONE, 8);   // sentry box
  }
  B.block(x, y - 1, z, w - t, 1.4, d - t, '#b9a47e', KM.COBBLE, rot);                             // parade yard
  const [kx, kz] = L(-w * 0.18, -d * 0.12);
  B.block(kx, y, kz, w * 0.42, 6, d * 0.34, '#e8dcc0', KM.PLASTER, rot);                            // barrack
  B.hip(kx, y + 6, kz, w * 0.42, d * 0.34, 3, PALETTE.roofs[1], KM.TILE, rot, 0.6);
  const [gx, gz] = L(0, -d / 2 - 0.1); B.block(gx, y, gz, 3.4, 4.2, 0.4, '#3a2616', KM.DARK, rot);  // gate
  const [px, pz] = L(w * 0.22, d * 0.15);
  B.cyl(px, y, pz, 0.22, 0.14, 18, 6, '#4a3727', KM.WOOD);
  return { flag: [px, y + 17.6, pz] };
}

export function lowWall(B, x0, z0, x1, z1, ground, { h = 1.1, color = '#a89c84' } = {}) {
  const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(len / 2.5)), rot = Math.atan2(x1 - x0, z1 - z0);
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = ground(x, z);
    B.ground = y; B.aoH = h;
    B.block(x, y - 0.6, z, 0.7, h + 0.6, len / n + 0.1, color, KM.STONE, rot);
    B.block(x, y + h, z, 0.85, 0.18, len / n + 0.1, shade(color, 1.1), KM.STONE, rot);
  }
}

// ------------------------------------------------------------------------------------------------ facade and street dressing
// a wall plane through (x, z) facing (nx, nz): F.at(u, o) -> [x, z] (u along the wall, o out of it); F.rot turns a
// block's local +z out of the wall
export function face(x, z, nx, nz) {
  const tx = -nz, tz = nx;
  return { rot: Math.atan2(nx, nz), nx, nz, at: (u, o = 0) => [x + tx * u + nx * o, z + tz * u + nz * o] };
}
const IRON = '#2a2420', AWN = ['#b8402e', '#e8dcc0', '#3a6a8a', '#d8a040', '#5a7a3a', '#8a3a5a'], CLOTHES = ['#efe8d8', '#e6dcc2', '#9fb4c8', '#c86a4a', '#d8c070', '#7a8a5a'];
const FLOWERS = ['#d8443a', '#e87aa0', '#f2eedc', '#e8b030'];
// stone door frame: jambs, lintel, a worn step (all within 0.33 m of the wall)
export function doorFrame(B, F, { u = 0, y, w = 1.3, h = 2.4, step = true, color = '#b3a68c' }) {
  for (const s of [-1, 1]) { const [jx, jz] = F.at(u + s * (w / 2 + 0.13), 0.1); B.block(jx, y, jz, 0.26, h + 0.06, 0.2, color, KM.STONE, F.rot); }
  const [lx, lz] = F.at(u, 0.11); B.block(lx, y + h, lz, w + 0.62, 0.32, 0.24, shade(color, 1.06), KM.STONE, F.rot);
  if (step) { const [sx, sz] = F.at(u, 0.16); B.block(sx, y - 0.1, sz, w + 0.46, 0.24, 0.32, shade(color, 0.9), KM.STONE, F.rot); }
}
// terracotta pot with a leafy plant (and sometimes flowers), base at y
export function pot(B, x, y, z, s = 1, rand = Math.random) {
  B.cyl(x, y, z, 0.13 * s, 0.18 * s, 0.32 * s, 7, rand() < 0.5 ? '#b5603a' : '#a0522f', KM.CLAY);
  const g = blob(0.24 * s, 0, rand() * 9, 0.3, false), m = new THREE.Matrix4().makeTranslation(x, y + 0.42 * s, z);
  B.geo(g, m, rand() < 0.5 ? '#4f7a32' : '#5d8a3a', KM.FOLIAGE); g.dispose();
  if (rand() < 0.6) { const c = pick(rand, FLOWERS); for (let k = 0; k < 3; k++) { const a = k * 2.1 + rand(); B.block(x + Math.cos(a) * 0.14 * s, y + 0.5 * s, z + Math.sin(a) * 0.14 * s, 0.09 * s, 0.09 * s, 0.09 * s, c, KM.CLAY); } }
}
// flower box under a window (sill height y)
export function flowerBox(B, F, { u = 0, y, w = 1.0, rand = Math.random }) {
  const [bx, bz] = F.at(u, 0.16); B.block(bx, y - 0.24, bz, w, 0.24, 0.24, '#6a4a2e', KM.WOOD, F.rot);
  const c = pick(rand, FLOWERS), n = Math.max(2, Math.round(w / 0.28));
  for (let k = 0; k < n; k++) {
    const [px, pz] = F.at(u - w / 2 + (k + 0.5) * w / n, 0.16 + (rand() - 0.5) * 0.06), g = blob(0.15 + rand() * 0.05, 0, k + rand() * 5, 0.3, false);
    B.geo(g, new THREE.Matrix4().makeTranslation(px, y + 0.04, pz), rand() < 0.5 ? '#4a7530' : '#5a8638', KM.FOLIAGE); g.dispose();
    if (rand() < 0.7) B.block(px + (rand() - 0.5) * 0.1, y + 0.14, pz, 0.08, 0.08, 0.08, rand() < 0.75 ? c : '#f2eedc', KM.CLAY);
  }
}
// wooden balcony on brackets, its floor at y: railing, a pot or two, sometimes washing over the rail
export function balcony(B, F, { u = 0, y, w = 2.4, rand = Math.random, trim = '#5a4632' }) {
  const D = 1.0, wood = '#5a3a22';
  const [bx, bz] = F.at(u, D / 2); B.block(bx, y, bz, w, 0.15, D, wood, KM.WOOD, F.rot);
  for (const s of [-1, 1]) { const [kx, kz] = F.at(u + s * (w / 2 - 0.22), 0.32); B.block(kx, y - 0.5, kz, 0.1, 0.5, 0.62, wood, KM.WOOD, F.rot); }
  const n = Math.max(3, Math.round(w / 0.32));
  for (let k = 0; k <= n; k++) { const [px, pz] = F.at(u - w / 2 + 0.05 + k * (w - 0.1) / n, D - 0.06); B.block(px, y + 0.15, pz, 0.05, 0.75, 0.05, trim, KM.WOOD, F.rot); }
  const [rx, rz] = F.at(u, D - 0.06); B.block(rx, y + 0.88, rz, w, 0.07, 0.1, trim, KM.WOOD, F.rot);
  for (const s of [-1, 1]) { const [sx, sz] = F.at(u + s * (w / 2 - 0.05), D / 2); B.block(sx, y + 0.88, sz, 0.08, 0.07, D, trim, KM.WOOD, F.rot); B.block(sx, y + 0.15, sz, 0.05, 0.75, 0.05, trim, KM.WOOD, F.rot); }
  if (rand() < 0.75) { const [px, pz] = F.at(u + (rand() - 0.5) * (w - 0.8), D * 0.55); pot(B, px, y + 0.15, pz, 0.9, rand); }
  if (rand() < 0.4) { const [cx, cz] = F.at(u + (rand() - 0.5) * (w - 1.2), D + 0.0); B.block(cx, y + 0.35, cz, 0.9, 0.62, 0.04, pick(rand, CLOTHES), KM.CLOTH, F.rot); }
}
// tavern-style sign on an iron arm, the board across the street (perpendicular to the wall), bottom at y
export function hangingSign(B, F, { u = 0, y = 2.7, color = '#b8862c', rand = Math.random }) {
  const [ax, az] = F.at(u, 0.7); B.block(ax, y + 1.05, az, 0.07, 0.07, 1.4, IRON, KM.IRON, F.rot);
  const [qx, qz] = F.at(u, 0.3); B.block(qx, y + 0.62, qz, 0.05, 0.45, 0.05, IRON, KM.IRON, F.rot + 0.8);   // brace
  const [bx, bz] = F.at(u, 0.9);
  B.block(bx, y, bz, 0.05, 0.74, 1.06, '#3a2a1a', KM.WOOD, F.rot);
  B.block(bx, y + 0.06, bz, 0.08, 0.62, 0.92, color, KM.WOOD, F.rot);
  B.block(bx, y + 0.22, bz, 0.1, 0.3, 0.34, rand() < 0.5 ? '#2a2018' : '#e8d8a8', KM.CLAY, F.rot);           // painted emblem
  for (const s of [-0.38, 0.38]) { const [cx, cz] = F.at(u, 0.9 + s); B.block(cx, y + 0.74, cz, 0.03, 0.31, 0.03, IRON, KM.IRON, F.rot); }
}
// striped cloth awning sloping out from the wall over a door or a shop window, its front edge at height y
export function awning(B, F, { u = 0, y = 2.5, w = 2.2, depth = 1.15, color, rand = Math.random }) {
  color ||= pick(rand, AWN);
  const n = Math.max(3, Math.round(w / 0.36)), top = y + 0.62;
  for (let k = 0; k < n; k++) {
    const u0 = u - w / 2 + k * w / n, u1 = u0 + w / n, c = k % 2 ? '#efe6cf' : color;
    const [ax, az] = F.at(u0, 0.02), [bx, bz] = F.at(u1, 0.02), [cx, cz] = F.at(u1, depth), [dx, dz] = F.at(u0, depth);
    const A = [ax, top, az], Bq = [bx, top, bz], Cq = [cx, y, cz], D = [dx, y, dz];
    B.quad(A, Bq, Cq, D, c, KM.CLOTH); B.quad(D, Cq, Bq, A, shade(c, 0.7), KM.CLOTH);                        // top and underside
    const [vx, vz] = F.at((u0 + u1) / 2, depth); B.block(vx, y - 0.22, vz, w / n, 0.22, 0.03, c, KM.CLOTH, F.rot);   // valance
  }
  for (const s of [-1, 1]) { const [rx, rz] = F.at(u + s * w / 2, depth / 2); B.block(rx, y + 0.28, rz, 0.04, 0.04, depth, IRON, KM.IRON, F.rot); }
}
// washing line from a to b ([x, y, z]), sagging, with a few clothes pegged on it
export function laundry(B, a, b, rand = Math.random) {
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]), n = 6, sag = 0.25 + L * 0.04, P = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t];
  for (let k = 0; k < n; k++) rod(B, P(k / n), P((k + 1) / n), 0.02, 0.02, '#d8ceb4', KM.CLAY, 3);
  const dx = (b[0] - a[0]) / L, dz = (b[2] - a[2]) / L;
  for (let t = 0.12 + rand() * 0.1; t < 0.9; t += 0.14 + rand() * 0.12) {
    const p = P(t), hw = 0.25 + rand() * 0.2, hh = 0.45 + rand() * 0.4, c = pick(rand, CLOTHES);
    const q0 = [p[0] - dx * hw, p[1], p[2] - dz * hw], q1 = [p[0] + dx * hw, p[1], p[2] + dz * hw], q2 = [q1[0], p[1] - hh, q1[2]], q3 = [q0[0], p[1] - hh * (0.9 + rand() * 0.2), q0[2]];
    B.quad(q0, q1, q2, q3, c, KM.CLOTH); B.quad(q3, q2, q1, q0, shade(c, 0.85), KM.CLOTH);
  }
}
// walls lean and the ridge sags: warps the vertices of a building standing at y0 with walls h high, given as
// parts [[positions (flat x, y, z array), first index], ...] (e.g. [[B.pos, from]]: what was appended to B since
// `from`); every part is warped by the same function, so walls and a roof built apart stay joined; nothing moves at
// the foot
export function lean(parts, y0, h, rand = Math.random, { amt = 0.18, sag = 0.24 } = {}) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [p, from] of parts) for (let i = from; i < p.length; i += 3) { if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i]; if (p[i + 2] < z0) z0 = p[i + 2]; if (p[i + 2] > z1) z1 = p[i + 2]; }
  const a = rand() * 6.283, k = amt * (0.3 + rand() * 0.7), lx = Math.cos(a) * k, lz = Math.sin(a) * k, sg = sag * (0.3 + rand() * 0.7), alongX = x1 - x0 >= z1 - z0, ph = rand() * 6.283;
  for (const [p, from] of parts) for (let i = from; i < p.length; i += 3) {
    const t = (p[i + 1] - y0) / h; if (t <= 0) continue;
    const s = alongX ? (p[i] - x0) / (x1 - x0 || 1) : (p[i + 2] - z0) / (z1 - z0 || 1), w = Math.sin(Math.max(0, Math.min(1, s)) * Math.PI);
    const tt = Math.min(t, 1.6), bulge = Math.sin(tt * Math.PI * 0.8) * 0.035 * Math.sin(s * 7 + ph);
    p[i] += lx * tt * tt + bulge; p[i + 2] += lz * tt * tt + bulge;
    p[i + 1] -= sg * w * Math.max(0, Math.min(1, (t - 0.85) / 0.45));
  }
}
// cask with hoops (s = scale; 1 = 1.15 m)
export function barrel(B, x, y, z, s = 1, color = '#7a5a34') {
  B.cyl(x, y, z, 0.42 * s, 0.5 * s, 0.58 * s, 9, color, KM.WOOD); B.cyl(x, y + 0.58 * s, z, 0.5 * s, 0.42 * s, 0.57 * s, 9, color, KM.WOOD);
  for (const h of [0.2, 0.94]) B.cyl(x, y + h * s, z, 0.48 * s, 0.48 * s, 0.07 * s, 9, '#3a2c20', KM.IRON);
}
function sack(B, x, y, z, s, rot, rand) {
  const g = new THREE.SphereGeometry(0.42, 7, 5), m = new THREE.Matrix4().makeRotationY(rot).scale(new THREE.Vector3(0.9 * s, 0.62 * s, 0.7 * s)).setPosition(x, y + 0.24 * s, z);
  B.geo(g, m, rand() < 0.5 ? '#c8b48a' : '#a8956c', KM.CLOTH); g.dispose();
  B.block(x, y + 0.42 * s, z, 0.14 * s, 0.16 * s, 0.14 * s, '#8a7650', KM.CLOTH, rot);   // the tied neck
}
// pile of crates, a barrel or two (fits in a 4.4 m square around x, z)
export function crates(B, { x, z, y, rot = 0, rand = Math.random }) {
  const L = frame(x, z, rot), wood = ['#8f6c3e', '#7a5a34', '#9a7a4a'];
  for (const [lx, lz, s, h0] of [[-0.9, -0.6, 1.9, 0], [1.0, 0.8, 1.4, 0], [-0.7, -0.5, 1.2, 1.5], [0.9, -1.1, 1.1, 0]]) {
    if (rand() < 0.15) continue;
    const [cx, cz] = L(lx, lz), r = rot + (rand() - 0.5) * 0.5, c = pick(rand, wood);
    B.block(cx, y + h0, cz, s, s * 0.82, s, c, KM.WOOD, r);
    B.block(cx, y + h0 + s * 0.38, cz, s + 0.04, 0.1, s + 0.04, shade(c, 0.7), KM.WOOD, r);   // the band of planks
  }
  for (const [lx, lz] of [[1.4, -1.6], [-1.6, 1.3]]) { const [bx, bz] = L(lx, lz); barrel(B, bx, y, bz, 0.95); }
}
export function sacks(B, { x, z, y, rot = 0, rand = Math.random }) {
  const L = frame(x, z, rot);
  for (let k = 0; k < 7; k++) { const [sx, sz] = L((k % 3 - 1) * 0.85 + (rand() - 0.5) * 0.2, (Math.floor(k / 3) - 0.5) * 0.95), lay = k >= 6 ? 0.5 : 0; sack(B, sx, y + lay, sz, 1.1, rot + rand(), rand); }
  const [cx, cz] = L(0.4, 1.5); B.block(cx, y, cz, 1.3, 1.1, 1.3, '#8f6c3e', KM.WOOD, rot + 0.3);
  const [bx, bz] = L(-1.5, 1.4); barrel(B, bx, y, bz, 0.9);
}
// two-wheeled hand cart with its load ('hay' | 'sacks' | 'barrels'), shafts resting on the ground
export function cart(B, { x, z, y, rot = 0, load = 'sacks', rand = Math.random }) {
  const L = frame(x, z, rot), wood = '#6b4a2c', by = y + 0.78;
  B.block(x, by, z, 1.5, 0.12, 2.5, wood, KM.WOOD, rot);
  for (const s of [-1, 1]) { const [sx, sz] = L(s * 0.72, 0); B.block(sx, by + 0.12, sz, 0.08, 0.42, 2.5, wood, KM.WOOD, rot); }
  for (const s of [-1, 1]) { const [ex, ez] = L(0, s * 1.22); B.block(ex, by + 0.12, ez, 1.5, 0.42, 0.08, wood, KM.WOOD, rot); }
  for (const s of [-1, 1]) {
    const [wx, wz] = L(s * 0.86, 0.1);
    B.cyl(wx, y + 0.62, wz, 0.62, 0.62, 0.1, 12, '#5a3e24', KM.WOOD, 0, rot, Math.PI / 2);
    B.cyl(wx, y + 0.62, wz, 0.14, 0.14, 0.18, 6, '#3a2c20', KM.IRON, 0, rot, Math.PI / 2);
    const [a0x, a0z] = L(s * 0.5, 1.25), [a1x, a1z] = L(s * 0.45, 2.9); rod(B, [a0x, by + 0.05, a0z], [a1x, y + 0.08, a1z], 0.06, 0.05, wood, KM.WOOD, 5);   // shafts
  }
  if (load === 'hay') { const g = blob(1.0, 1, rand() * 9, 0.18), m = new THREE.Matrix4().makeRotationY(rot).scale(new THREE.Vector3(0.78, 0.62, 1.25)).setPosition(x, by + 0.62, z); B.geo(g, m, '#cfac52', KM.THATCH); g.dispose(); }
  else if (load === 'barrels') for (const lz of [-0.6, 0.6]) { const [bx, bz] = L(0, lz); barrel(B, bx, by + 0.12, bz, 0.8); }
  else for (let k = 0; k < 5; k++) { const [sx, sz] = L((k % 2 - 0.5) * 0.6, (Math.floor(k / 2) - 1) * 0.75), up = k === 4 ? 0.4 : 0; sack(B, sx, by + 0.12 + up, sz, 0.85, rot + rand() * 0.6, rand); }
}
// stone well with its little tiled roof, winch and bucket (≈ 2.6 m across, 3.3 m high)
export function well(B, { x, z, y, rot = 0 }) {
  const L = frame(x, z, rot);
  B.cyl(x, y, z, 1.15, 1.1, 0.95, 12, '#a99d86', KM.STONE);
  B.cyl(x, y + 0.95, z, 1.2, 1.2, 0.14, 12, '#bcb098', KM.STONE);
  B.cyl(x, y + 0.6, z, 0.85, 0.85, 0.5, 10, '#14110e', KM.DARK);
  for (const s of [-1, 1]) { const [px, pz] = L(s * 1.0, 0); B.block(px, y + 0.9, pz, 0.16, 1.9, 0.16, '#5a3e24', KM.WOOD, rot); }
  B.cyl(x, y + 2.35, z, 0.1, 0.1, 2.0, 6, '#6b4a2c', KM.WOOD, 0, rot, Math.PI / 2);                            // winch
  B.gable(x, y + 2.75, z, 2.6, 1.6, 0.55, '#a85d37', KM.TILE, rot, 0.15);
  B.cyl(x + 0.1, y + 1.1, z + 0.6, 0.18, 0.22, 0.3, 7, '#6b4a2c', KM.WOOD);                                     // bucket on the rim
}
// round fountain: stone basin, water, a column with a bowl and its jet (r = basin radius)
export function fountain(B, { x, z, y, r = 2.2 }) {
  B.cyl(x, y, z, r, r, 0.62, 16, '#b8ab90', KM.STONE);
  B.cyl(x, y + 0.62, z, r + 0.12, r + 0.12, 0.14, 16, '#cbbfa4', KM.STONE);
  B.cyl(x, y + 0.5, z, r - 0.18, r - 0.18, 0.2, 16, '#4f8a96', KM.CLAY);
  B.cyl(x, y, z, 0.32, 0.24, 1.9, 8, '#c2b59a', KM.STONE);
  B.cyl(x, y + 1.9, z, 0.3, 0.8, 0.32, 10, '#c2b59a', KM.STONE);
  B.cyl(x, y + 2.2, z, 0.1, 0.05, 0.6, 6, '#bfe0e6', KM.CLAY);
}

export function longboat(B, { x, z, y, rot = 0, color = '#7a5232' }) {
  const L = frame(x, z, rot), m = new THREE.Matrix4();
  B.ground = y; B.aoH = 1.2;
  const hull = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  m.makeRotationY(rot).scale(new THREE.Vector3(1.25, 0.85, 3.6)).setPosition(x, y + 0.75, z);
  B.geo(hull, m, color, KM.WOOD); hull.dispose();
  B.block(x, y + 0.72, z, 2.3, 0.14, 6.6, shade(color, 1.25), KM.WOOD, rot);                       // gunwale
  for (const o of [-1.6, 0, 1.6]) { const [tx, tz] = L(0, o); B.block(tx, y + 0.45, tz, 2.2, 0.12, 0.4, shade(color, 1.1), KM.WOOD, rot); }   // thwarts
  for (const s of [-1, 1]) { const [ox, oz] = L(s * 0.9, 0.4); B.block(ox, y + 0.8, oz, 0.12, 0.1, 4.6, '#c8b088', KM.WOOD, rot + s * 0.12); }    // shipped oars
}

// sea-world ship models at anchor: hulls (+ masts and rigging) in one Mesh with the ships' hull material, sails
// furled on their yards merged into B (KM.CLOTH)
export function anchoredShips(B, ships, faction = 'english') {
  const hulls = [];
  for (const s of ships) {
    const parts = getShipStaticParts(s.type, faction);
    const mtx = new THREE.Matrix4().makeRotationY(s.rot).premultiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(Math.cos(s.rot), 0, -Math.sin(s.rot)), 0.02)).setPosition(s.x, -0.75, s.z);
    const src = parts.hullGeoFar || parts.hullGeo, g = src.index ? src.toNonIndexed() : src.clone();
    g.applyMatrix4(mtx); hulls.push(g);
    furl(B, parts.sailGeo, mtx);
  }
  if (!hulls.length) return null;
  const geo = mergeGeometries(hulls, false); hulls.forEach(g => g.dispose());
  geo.computeBoundingSphere();
  const mat = makeHullMaterial(), mesh = new THREE.Mesh(geo, mat);
  mesh.customDepthMaterial = mat.userData.depth; mesh.receiveShadow = true;
  return mesh;
}
// sail cloth in its furled state: every vertex gathered onto its yard/boom anchor (as the sail shader does when furled)
function furl(B, sg, mtx) {
  const P = sg?.attributes.aAnchor, S = sg?.attributes.aSail, idx = sg?.index;
  if (!P || !S) return;
  const v = new THREE.Vector3();
  const vert = i => {
    const fu = S.getX(i), fv = S.getY(i), kind = S.getW(i), ang = fv * 23 + fu * 3;
    const rr = 0.2 * (1 - 0.5 * fv) * (0.6 + 0.4 * Math.sin(fu * Math.PI));
    const ax = kind < 0.5 ? [0, 1, 0] : [1, 0, 0], bx = kind < 0.5 ? [0, 0, 1] : [0, 1, 0];
    v.set(P.getX(i) + (ax[0] * Math.cos(ang) + bx[0] * Math.sin(ang)) * rr, P.getY(i) + (ax[1] * Math.cos(ang) + bx[1] * Math.sin(ang)) * rr + (kind < 0.5 ? 0.16 : 0),
      P.getZ(i) + (ax[2] * Math.cos(ang) + bx[2] * Math.sin(ang)) * rr).applyMatrix4(mtx);
    return [v.x, v.y, v.z];
  };
  const n = idx ? idx.count : P.count;
  B.ground = -40; B.aoH = 1;
  for (let k = 0; k < n; k += 3) {
    const a = idx ? idx.getX(k) : k, b = idx ? idx.getX(k + 1) : k + 1, c = idx ? idx.getX(k + 2) : k + 2;
    B.tri(vert(a), vert(b), vert(c), '#e6dcc2', KM.CLOTH);
  }
}

// ------------------------------------------------------------------------------------------------ vegetation, rocks
// organic blob: an icosphere whose vertices are pushed in and out by a smooth function of their position; soft
// (welded, smooth normals) for foliage, faceted for rocks
function blob(r, detail, seed, amp = 0.22, soft = true) {
  let g = new THREE.IcosahedronGeometry(r, detail);
  if (soft) { g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g); }
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + amp * (Math.sin(v.x * 1.7 + seed) * Math.cos(v.z * 1.9 - seed * 0.7) + 0.5 * Math.sin(v.y * 2.3 + seed * 1.3));
    p.setXYZ(i, v.x * k, v.y * k * 0.86, v.z * k);
  }
  g.computeVertexNormals();
  return g;
}
export function vegGeos() {
  const m = new THREE.Matrix4(), r = mulberry32(4242);
  // broadleaf: short leaning trunk, a crown of four foliage blobs (darker underneath)
  const bl = new GeoBuilder(); bl.ground = 0; bl.aoH = 8;
  bl.cyl(0, 0, 0, 0.42, 0.28, 4.2, 6, '#6b5038', KM.BARK, 0.06, 0, 0.05);
  bl.cyl(0.4, 2.8, 0.1, 0.18, 0.12, 2.2, 5, '#6b5038', KM.BARK, 0, 0, -0.7);
  for (const [x, y, z, s, c] of [[0, 5.6, 0, 2.7, '#4f7a32'], [1.5, 5.0, 0.6, 2.0, '#5a8436'], [-1.3, 5.2, -0.5, 2.1, '#47712e'], [0.2, 6.9, -0.3, 1.9, '#6a9440']]) {
    const g = blob(s, 1, x * 3 + z, 0.2); m.makeTranslation(x, y, z); bl.geo(g, m, c, KM.FOLIAGE); g.dispose();
  }
  // palm: curved ringed trunk, eight drooping fronds folded along their midrib, coconuts
  const pa = new GeoBuilder(); pa.ground = 0; pa.aoH = 9;
  const top = new THREE.Vector3();
  for (let k = 0; k < 8; k++) {
    const t0 = k / 8, t1 = (k + 1) / 8, bend = t => [Math.sin(t * 1.2) * 1.6, t * 9, 0];
    const [x0, y0] = bend(t0), [x1, y1] = bend(t1), len = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(x1 - x0, y1 - y0);
    const g = new THREE.CylinderGeometry(0.3 - t1 * 0.12, 0.33 - t0 * 0.12, len * 1.04, 7);
    m.makeRotationZ(-ang).setPosition((x0 + x1) / 2, (y0 + y1) / 2, 0);
    pa.geo(g, m, k % 2 ? '#7a6248' : '#8a7154', KM.BARK); g.dispose();
    if (k === 7) top.set(x1, y1, 0);
  }
  for (let f = 0; f < 8; f++) {
    const a = f / 8 * Math.PI * 2 + r() * 0.3, ca = Math.cos(a), sa = Math.sin(a), lenF = 4.2 + r() * 1.2, droop = 0.9 + r() * 0.4;
    const pt = s => { const d = s * lenF; return [top.x + ca * d, top.y + 0.6 + s * 1.4 - s * s * lenF * 0.42 * droop, top.z + sa * d]; };
    for (let s = 0; s < 5; s++) {
      const s0 = s / 5, s1 = (s + 1) / 5, w0 = 0.9 * Math.sin(Math.PI * (0.15 + s0 * 0.85)), w1 = 0.9 * Math.sin(Math.PI * (0.15 + s1 * 0.85));
      const p0 = pt(s0), p1 = pt(s1), col = s % 2 ? '#5f8a34' : '#6f9a3c';
      const side = (p, w, sg) => [p[0] - sa * w * sg, p[1] - w * 0.35, p[2] + ca * w * sg];
      for (const sg of [-1, 1]) {   // the upper face of each half-leaf (seen from above)
        const a0 = side(p0, w0, sg), a1 = side(p1, w1, sg), ux = p1[0] - p0[0], uz = p1[2] - p0[2], vx = a0[0] - p0[0], vz = a0[2] - p0[2];
        if (uz * vx - ux * vz > 0) pa.quad(p0, p1, a1, a0, col, KM.FOLIAGE); else pa.quad(a0, a1, p1, p0, col, KM.FOLIAGE);
      }
    }
  }
  for (let k = 0; k < 3; k++) { const g = new THREE.SphereGeometry(0.28, 6, 4); m.makeTranslation(top.x + Math.cos(k * 2.1) * 0.4, top.y - 0.2, Math.sin(k * 2.1) * 0.4); pa.geo(g, m, '#5a4026', KM.WOOD); g.dispose(); }
  // bush: three low blobs
  const bu = new GeoBuilder(); bu.ground = 0; bu.aoH = 2.4;
  for (const [x, y, z, s, c] of [[0, 0.8, 0, 1.4, '#486f2e'], [1.1, 0.6, 0.4, 1.0, '#557d35'], [-0.9, 0.6, -0.3, 1.1, '#41672a']]) {
    const g = blob(s, 1, x * 5 + 1, 0.25); m.makeTranslation(x, y, z); bu.geo(g, m, c, KM.FOLIAGE); g.dispose();
  }
  // rock: a squat, faceted boulder (moss is painted on its upper faces by the shader)
  const ro = new GeoBuilder(); ro.ground = -0.4; ro.aoH = 2;
  { const g = blob(1.6, 0, 3, 0.35, false); m.makeScale(1.2, 0.75, 1); ro.geo(g, m, '#958b7a', KM.ROCK); g.dispose();
    const g2 = blob(1.0, 0, 7, 0.3, false); m.makeScale(1, 0.8, 1).setPosition(1.5, -0.1, 0.6); ro.geo(g2, m, '#857c6c', KM.ROCK); g2.dispose(); }
  const V = { broadleaf: bl.build(), palm: pa.build(), bush: bu.build(), rock: ro.build() };
  V.dispose = () => { for (const k of ['broadleaf', 'palm', 'bush', 'rock']) V[k].dispose(); };
  return V;
}

const _d = new THREE.Object3D(), _c = new THREE.Color();
export function scatter(geo, material, items, { shadow = true } = {}) {
  const im = new THREE.InstancedMesh(geo, material, Math.max(1, items.length));
  items.forEach((p, k) => {
    _d.position.set(p.x, p.y, p.z); _d.rotation.set(0, p.r || 0, 0); _d.scale.setScalar(p.s || 1); _d.updateMatrix();
    im.setMatrixAt(k, _d.matrix); im.setColorAt(k, _c.set(p.tint ?? 0xffffff));
  });
  if (!items.length) im.setColorAt(0, _c.set(0xffffff));
  im.count = items.length; im.castShadow = shadow; im.receiveShadow = true;
  im.computeBoundingSphere();
  return im;
}

// ------------------------------------------------------------------------------------------------ ground, cloth
export function paintGround(geo, fn) {
  const p = geo.attributes.position, n = p.count, col = new Float32Array(n * 3), gw = new Float32Array(n * 4), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const o = fn(p.getX(i), p.getZ(i), p.getY(i));
    c.set(o.color); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    gw[i * 4] = o.sand || 0; gw[i * 4 + 1] = o.paved || 0; gw[i * 4 + 2] = o.field || 0; gw[i * 4 + 3] = o.rock || 0;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aGround', new THREE.BufferAttribute(gw, 4));
  geo.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(n).fill(KM.GROUND), 1));
  return geo;
}

// flag plane hanging from its hoist at x = 0 (fly toward +x)
export function clothGeo(w = 5, h = 3.2, segW = 8, segH = 2) {
  const g = new THREE.PlaneGeometry(w, h, segW, segH); g.translate(w / 2, 0, 0); g.userData.w = w;
  return g;
}
// maps a cloth onto a nation's flag in the shared flag atlas (kitMaterials().flag)
export function flagUV(g, faction) {
  const i = FLAG_INDEX[faction] ?? FLAG_INDEX.pirate, col = i % 4, row = Math.floor(i / 4), uv = g.attributes.uv, p = g.attributes.position;
  const w = g.userData.w || 1, h = g.parameters?.height || 1;
  for (let k = 0; k < uv.count; k++) { const u = p.getX(k) / w, v = p.getY(k) / h + 0.5; uv.setXY(k, (col + u) / 4, 1 - row * 0.5 - (1 - v) * 0.5); }
  uv.needsUpdate = true;
}
export function waveCloth(g, t, amp = 0.3) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, Math.sin(t * 4 + x * 1.2) * amp * x * 0.4 + Math.sin(t * 6.3 + x * 2.1) * amp * 0.12 * x); }
  p.needsUpdate = true; g.computeVertexNormals();
}

// ------------------------------------------------------------------------------------------------ effects
export class PuffPool {
  constructor(scene, K, max = 300, { additive = false } = {}) {
    const g = new THREE.PlaneGeometry(1, 1);
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(max), 1); this.fade.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aFade', this.fade);
    this.mesh = new THREE.InstancedMesh(g, additive ? K.flash : K.puff, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 3 : 2;
    this.mesh.setColorAt(0, new THREE.Color());
    scene.add(this.mesh);
    this.max = max; this.list = [];
  }
  // velocity v* (m/s, damped), size (m) growing by `grow` × over its life (s), rise (m/s), fadeIn (1/s)
  spawn({ x, y, z, vx = 0, vy = 0, vz = 0, size = 2, grow = 1, life = 2, color = 0xe9e2d2, alpha = 0.7, rise = 0, fadeIn = 12 }) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({ x, y, z, vx, vy, vz, size, grow, life, t: 0, color: new THREE.Color(color), alpha, rise, fadeIn });
  }
  update(dt) {
    const im = this.mesh;
    this.list = this.list.filter(p => (p.t += dt) < p.life);
    let i = 0;
    for (const p of this.list) {
      const k = p.t / p.life, drag = Math.exp(-p.t * 2.2);
      p.x += p.vx * drag * dt; p.y += (p.vy * drag + p.rise) * dt; p.z += p.vz * drag * dt;
      _d.position.set(p.x, p.y, p.z); _d.rotation.set(0, 0, 0); _d.scale.setScalar(p.size * (1 + k * p.grow)); _d.updateMatrix();
      im.setMatrixAt(i, _d.matrix); im.setColorAt(i, p.color);
      this.fade.array[i] = p.alpha * Math.min(1, p.t * p.fadeIn) * (1 - k) * (1 - k * 0.3);
      i++;
    }
    im.count = i; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; this.fade.needsUpdate = true;
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.dispose?.(); }
}
