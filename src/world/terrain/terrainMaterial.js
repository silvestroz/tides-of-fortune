// Painterly splat terrain material (MeshStandardMaterial + onBeforeCompile so lights/shadows/fog stay standard).
// Layers by height + slope + baked moisture/curvature: seabed sand, coral, wet sand, dry sand, grass, jungle,
// dry scrub, rock, cliff (triplanar). Uses one shared tileable detail texture for all brush/grain detail.
import * as THREE from 'three';
import { getDetailTexture } from './textures.js';

export function createTerrainMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  const uniforms = {
    uDetail: { value: getDetailTexture() },
    uTime: { value: 0 },
    uNight: { value: 0 },
    uTowns: { value: Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, 0, 0)) },
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aTerr;
        varying vec4 vTerr;
        varying vec3 vWPos;
        varying vec3 vWNrm;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vTerr = aTerr;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uDetail;
        uniform float uTime; uniform float uNight; uniform vec4 uTowns[16];
        varying vec4 vTerr;
        varying vec3 vWPos;
        varying vec3 vWNrm;
        float vTerrRock = 0.0; vec3 vBumpW = vec3(0.0);
        vec3 srgb(vec3 c){ return pow(c, vec3(2.2)); }
        vec4 tri(vec3 p, vec3 n, float s){
          vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
          return texture2D(uDetail, p.zy * s) * w.x + texture2D(uDetail, p.xz * s) * w.y + texture2D(uDetail, p.xy * s) * w.z;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 P = vWPos; vec3 N = normalize(vWNrm);
          float h = P.y;
          float slope = 1.0 - N.y;                    // 0 flat .. 1 vertical
          float ao = vTerr.x, moist = vTerr.y, curv = vTerr.z, dryness = min(vTerr.w, 1.0);
          float bare = step(1.5, vTerr.w);   // gfx-mer: bare sea stack (terrainMesh writes dryness 2)
          // multi-scale detail (distance-faded high frequencies)
          float dist = length(cameraPosition - P);
          vec4 dL = texture2D(uDetail, P.xz * 0.0011);
          vec4 dM = texture2D(uDetail, P.xz * 0.0071);
          vec4 dS = texture2D(uDetail, P.xz * 0.043);
          float hiF = 1.0 - smoothstep(150.0, 900.0, dist);
          float big = dL.r;                           // large patches
          float mid = dM.r;
          float fine = mix(0.5, dS.a, hiF);
          float brush = mix(0.5, texture2D(uDetail, P.zx * 0.0063 + 0.41).r, 0.8);   // isotropic (G channel = x-aligned streaks -> contour stripes on hills)
          // palette
          vec3 cDeep   = srgb(vec3(0.62, 0.66, 0.52));
          vec3 cSeaSand= srgb(vec3(0.93, 0.86, 0.66));
          vec3 cCoral  = srgb(vec3(0.70, 0.52, 0.44));
          vec3 cCoral2 = srgb(vec3(0.52, 0.56, 0.40));
          vec3 cWet    = srgb(vec3(0.76, 0.64, 0.44));
          vec3 cSand   = srgb(vec3(0.93, 0.84, 0.62));
          vec3 cSandHi = srgb(vec3(0.98, 0.92, 0.76));
          vec3 cGrass  = srgb(vec3(0.47, 0.60, 0.27));
          vec3 cGrass2 = srgb(vec3(0.31, 0.47, 0.20));
          vec3 cJungle = srgb(vec3(0.16, 0.31, 0.13));
          vec3 cDry    = srgb(vec3(0.66, 0.60, 0.38));
          vec3 cDry2   = srgb(vec3(0.55, 0.45, 0.30));
          vec3 cRock   = srgb(vec3(0.54, 0.51, 0.47));
          vec3 cRock2  = srgb(vec3(0.42, 0.37, 0.33));
          vec3 cCliff  = srgb(vec3(0.66, 0.58, 0.48));
          vec3 cVolc   = srgb(vec3(0.30, 0.27, 0.26));

          // --- vegetation colour (above beach) ---
          float lush = clamp(moist + (big - 0.5) * 0.7 + (mid - 0.5) * 0.35, 0.0, 1.0);
          vec3 veg = mix(cGrass, cGrass2, smoothstep(0.35, 0.7, mid + (brush - 0.5) * 0.5));
          veg = mix(veg, cJungle, smoothstep(0.55, 0.9, lush) * (0.75 + 0.25 * smoothstep(-0.2, 0.3, -curv)));
          vec3 dryC = mix(cDry, cDry2, smoothstep(0.3, 0.7, mid));
          veg = mix(veg, dryC, clamp(dryness * 1.1 - 0.15 + (0.5 - lush) * 0.4, 0.0, 1.0));
          // upper slopes go a bit cooler/darker; peaks lighten to grass/rock
          veg = mix(veg, veg * vec3(0.85, 0.95, 1.0), smoothstep(80.0, 300.0, h));
          // canopy texture: clumped crowns (light tops, dark gaps) on lush ground, scale-blended
          float crowns = mix(texture2D(uDetail, P.xz * 0.019).b, texture2D(uDetail, P.xz * 0.0047).b, smoothstep(300.0, 1500.0, dist));
          float canopyAmt = smoothstep(0.45, 0.8, lush) * (1.0 - dryness);
          veg = mix(veg, veg * mix(0.55, 1.35, crowns) + vec3(0.02, 0.035, 0.0) * crowns, canopyAmt * 0.85);
          // --- sand band ---
          float bn = (mid - 0.5) * 1.6 + (fine - 0.5) * 0.4;
          float beachTop = 2.2 + bn + 1.4 * (1.0 - moist);
          vec3 sand = mix(cSand, cSandHi, smoothstep(0.4, 0.8, dM.b * 0.5 + fine * 0.5));
          sand = mix(cWet * 0.8, sand, smoothstep(0.15, 1.3, h + (fine - 0.5) * 0.3));
          sand = mix(sand, sand * 0.82, smoothstep(0.55, 0.45, abs(h - 0.9) / 0.9) * 0.0);
          // underwater: sand, coral patches, seagrass, darkening with depth
          float coral = smoothstep(0.55, 0.75, dM.b * 0.6 + big * 0.6) * smoothstep(-0.2, -1.5, h) * (1.0 - smoothstep(-6.0, -12.0, h));
          vec3 sea = mix(cSeaSand, mix(cCoral, cCoral2, dS.r), coral * 0.75);
          sea = mix(sea, cGrass2 * 0.55, smoothstep(0.62, 0.8, big) * smoothstep(-1.0, -3.0, h) * 0.6);
          sea = mix(sea, cDeep * 0.6, smoothstep(-8.0, -45.0, h));
          sea *= mix(0.85, 1.08, fine);

          float beachTop0 = 2.2 + 1.4 * (1.0 - moist);
          // cleared farmland / bare earth around towns (fields in strips, roads)
          float field = 0.0;
          for (int i = 0; i < 16; i++) {
            vec4 T = uTowns[i]; if (T.w <= 0.0) continue;
            float d = length(P.xz - T.xy);
            field = max(field, smoothstep(T.w * 2.6, T.w * 1.2, d + (big - 0.5) * 300.0));
          }
          field *= smoothstep(0.2, 0.1, slope) * smoothstep(beachTop0 + 2.0, beachTop0 + 5.0, h) * (1.0 - smoothstep(45.0, 75.0, h + (big - 0.5) * 30.0));
          if (field > 0.0) {
            vec2 fc = floor(P.xz / 60.0 + vec2(dL.g, dL.r) * 2.0);
            float rnd = fract(sin(dot(fc, vec2(12.9898, 78.233))) * 43758.5);
            vec3 fcol = rnd < 0.33 ? srgb(vec3(0.62, 0.66, 0.30)) : rnd < 0.66 ? srgb(vec3(0.72, 0.62, 0.38)) : srgb(vec3(0.44, 0.58, 0.26));
            fcol *= 0.85 + 0.25 * step(0.5, fract((P.x + P.z) * 0.18));       // furrows
            veg = mix(veg, fcol, field * step(0.25, rnd + 0.2));
            // hedgerow / plot borders
            vec2 fe = abs(fract(P.xz / 60.0 + vec2(dL.g, dL.r) * 2.0) - 0.5);
            veg = mix(veg, cJungle, field * smoothstep(0.46, 0.49, max(fe.x, fe.y)) * 0.8);
          }
          vec3 col = veg;
          col = mix(sand, col, smoothstep(beachTop - 0.4, beachTop + 0.7, h));
          col = mix(sea, col, smoothstep(-0.6, 0.15, h));
          // --- rock by slope (with triplanar for steep) ---
          vec4 tr = tri(P, N, 0.021);
          vec4 tr2 = tri(P, N, 0.0061);
          float strata = smoothstep(0.3, 0.9, 0.5 + 0.5 * sin(P.y * 0.35 + tr2.r * 14.0 + tr.g * 3.0)) * tr2.g;
          vec3 rock = mix(cRock, cRock2, smoothstep(0.35, 0.7, tr.r * 0.6 + tr2.r * 0.4));
          rock = mix(rock, cCliff, smoothstep(0.4, 0.9, strata) * 0.15 * smoothstep(0.45, 0.7, slope));
          rock = mix(rock, cVolc, smoothstep(220.0, 380.0, h) * 0.6);
          rock *= 0.82 + 0.36 * tr.b;
          // round 6: stratified rock — ~9 m beds with dark undercut ledges and alternating warm/cool layers
          float bed = fract(P.y * 0.11 + tr2.r * 1.6 + tr.g * 0.35);
          rock *= mix(0.7, 1.08, smoothstep(0.0, 0.16, bed)) * mix(1.0, 0.92, smoothstep(0.7, 1.0, bed));
          rock = mix(rock, rock * vec3(1.14, 1.0, 0.84), step(0.5, fract(P.y * 0.052 + tr2.g * 0.8)) * 0.55);
          rock = mix(rock, cCliff, smoothstep(0.4, 0.9, strata) * 0.2 * smoothstep(0.45, 0.7, slope));
          float rockMask = smoothstep(0.45 - smoothstep(50.0, 220.0, h) * 0.24, 0.7, slope + (tr.r - 0.5) * 0.25 + (brush - 0.5) * 0.12 - moist * 0.12);
          rockMask = max(rockMask, smoothstep(400.0, 520.0, h + (big - 0.5) * 80.0) * 0.7);
          rockMask = max(rockMask, smoothstep(0.72, 0.85, tr2.b * 0.6 + big * 0.5) * smoothstep(0.18, 0.35, slope) * smoothstep(15.0, 40.0, h));
          // exposed rock ribs / scree streaks running down the upper slopes
          // domain-warped fbm stretched down-slope: painterly gullies/streaks, never periodic
          // fixed world axes, triplanar-blended (a per-pixel slope-aligned frame at |P|~1e4 m turned tiny normal
          // changes into huge UV jumps -> contour stripes)
          vec3 tw = pow(abs(N), vec3(3.0)); tw.y = 0.0; tw /= (tw.x + tw.z + 1e-4);
          vec2 qx = vec2(P.z * 0.0045, P.y * 0.0016), qz = vec2(P.x * 0.0045, P.y * 0.0016);
          vec2 wpx = vec2(texture2D(uDetail, qx * 0.7 + 0.31).r, texture2D(uDetail, qx * 0.7 + 0.67).r) - 0.5;
          vec2 wpz = vec2(texture2D(uDetail, qz * 0.7 + 0.31).r, texture2D(uDetail, qz * 0.7 + 0.67).r) - 0.5;
          qx += wpx * 0.35; qz += wpz * 0.35;
          float fbmX = texture2D(uDetail, qx).r * 0.6 + texture2D(uDetail, qx * 2.13 + 0.17).r * 0.25 + texture2D(uDetail, qx * 4.7 + 0.53).b * 0.15;
          float fbmZ = texture2D(uDetail, qz).r * 0.6 + texture2D(uDetail, qz * 2.13 + 0.17).r * 0.25 + texture2D(uDetail, qz * 4.7 + 0.53).b * 0.15;
          float fbm = fbmX * tw.x + fbmZ * tw.z;
          float ribs = smoothstep(0.42, 0.58, fbm + (tr.r - 0.5) * 0.15);
          rockMask = max(rockMask, ribs * smoothstep(0.06, 0.2, slope) * smoothstep(30.0, 100.0, h) * 0.95);
          // scree / talus fans gathering at slope feet below rocky ground
          float scree = smoothstep(0.45, 0.65, fbm + (dM.b - 0.5) * 0.4) * smoothstep(0.04, 0.14, slope) * (1.0 - smoothstep(0.22, 0.32, slope)) * smoothstep(40.0, 90.0, h);
          // vegetation clings to the top of each bed (ledges) unless the face is sheer
          rockMask *= 1.0 - smoothstep(0.8, 0.95, bed) * (1.0 - smoothstep(0.55, 0.85, slope)) * smoothstep(20.0, 60.0, h) * 0.85;
          rockMask *= smoothstep(-2.5, 0.8, h); scree *= smoothstep(-2.5, 0.8, h);
          vTerrRock = rockMask;   // underwater keeps sand-ish tone
          col = mix(col, rock, rockMask);
          col = mix(col, mix(srgb(vec3(0.62, 0.56, 0.45)), srgb(vec3(0.50, 0.47, 0.42)), fine) * (0.85 + 0.3 * brush), scree * 0.55 * (1.0 - rockMask));
          // gfx-mer: bare sea stacks — dark volcanic rock down to the waterline (no sand, no green), guano whitening the
          // flat tops and ledges and running down the faces in streaks, a dark wet band where the swell washes
          if (bare > 0.5) {
            vec3 basalt = mix(srgb(vec3(0.34, 0.32, 0.3)), srgb(vec3(0.52, 0.48, 0.43)), smoothstep(0.3, 0.75, tr.r * 0.6 + tr2.r * 0.4));
            basalt = mix(basalt, srgb(vec3(0.58, 0.5, 0.38)), smoothstep(0.62, 0.8, tr2.b * 0.6 + big * 0.5) * 0.45);   // rusty weathering
            basalt *= mix(0.62, 1.12, smoothstep(0.0, 0.16, bed)) * (0.85 + 0.3 * tr.b);
            float flatTop = smoothstep(0.7, 0.9, N.y) * smoothstep(0.3, 0.6, tr.b * 0.7 + big * 0.5);
            float streak = smoothstep(0.5, 0.7, fbm + (tr.g - 0.5) * 0.35) * smoothstep(0.25, 0.7, slope);
            float guano = clamp(flatTop * smoothstep(6.0, 14.0, h) + streak * smoothstep(7.0, 18.0, h) * 0.7, 0.0, 1.0);
            vec3 bc = mix(basalt, srgb(vec3(0.88, 0.86, 0.79)) * (0.9 + 0.15 * fine), guano * 0.75);
            bc = mix(bc, bc * vec3(0.5, 0.52, 0.55), smoothstep(2.6, 0.4, h));   // wet wash band
            float aboveW = smoothstep(-1.2, 0.2, h);
            col = mix(col, bc, aboveW);
            rockMask = max(rockMask, aboveW); vTerrRock = rockMask;
          }
          // altitude colour bands: warm ochre lower hills, cool blue-green highlands (painted aerial depth)
          col = mix(col, col * vec3(1.06, 0.98, 0.86), smoothstep(8.0, 40.0, h) * (1.0 - smoothstep(60.0, 140.0, h)) * 0.6 * (1.0 - rockMask));
          col = mix(col, col * vec3(0.84, 0.94, 1.05), smoothstep(60.0, 220.0, h) * 0.7);
          // wet sand + lapping foam line at the waterline
          float wl = h + (fine - 0.5) * 0.25 + (mid - 0.5) * 0.3;
          col = mix(col, col * vec3(0.72, 0.68, 0.62), smoothstep(1.1, 0.35, wl) * smoothstep(-0.2, 0.2, wl) * (1.0 - rockMask) * 0.8);
          col = mix(col, srgb(vec3(0.97, 0.97, 0.93)), smoothstep(0.22, 0.0, abs(wl - 0.12)) * 0.75);
          // painterly brush modulation + fine grain
          col *= 0.88 + 0.24 * brush;
          col *= 0.94 + 0.12 * fine;
          // convex edges catch light, concave get dark (painted edge highlight)
          col *= 1.0 + clamp(curv, -0.5, 0.6) * 0.35;
          // baked AO (multi-bounce tint)
          float aoT = mix(0.35, 1.0, ao);
          col *= mix(vec3(aoT * 0.8, aoT * 0.9, aoT), vec3(aoT), aoT);
          diffuseColor.rgb = col;
          vBumpW = vec3(tr.r - 0.5, 0.0, tr.b - 0.5) * (0.35 + 0.9 * rockMask) + vec3(dM.r - 0.5, 0.0, dM.b - 0.5) * 0.25 * hiF;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(normal + (viewMatrix * vec4(vBumpW, 0.0)).xyz * 0.9);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vec3(0.05, 0.075, 0.13) * uNight;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.55, 0.95, smoothstep(0.0, 1.2, vWPos.y));`);
  };
  mat.customProgramCacheKey = () => 'terrain-v8';
  return mat;
}
