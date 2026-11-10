// Cloud shadows drifting over the islands: a soft noise field (same drift as the cumulus layer) that dims the DIRECT
// light only (sun / moon), so shaded slopes keep their sky fill and read as passing cloud cover, not as darker paint.
// Shared uniforms (driven by Sky every frame) + a GLSL snippet for MeshStandardMaterial.onBeforeCompile patches.
// API:
//   CLOUD_SHADOW.uniforms          { uCsOff (vec2, metres, wrapped), uCsAmt (0..1 strength), uCsCov (0..1 coverage), uCsNoise }
//   CLOUD_SHADOW.update(windOff, coverage, sunUp, overcast)   called by Sky
//   cloudShadowPars                GLSL: uniforms + float cloudShadow(vec3 worldPos)  (1 = lit, < 1 = under a cloud)
//   cloudShadowApply(posExpr)      GLSL to insert after <lights_fragment_end>: scales reflectedLight.direct*
import * as THREE from 'three';
import { getNoiseTexture } from './noise.js';

const TILE = 6000;   // metres per noise tile (two octaves at x1 and x3: both wrap exactly, so the offset can wrap too)

export const CLOUD_SHADOW = {
  uniforms: {
    uCsOff: { value: new THREE.Vector2() },
    uCsAmt: { value: 0 },
    uCsCov: { value: 0.5 },
    uCsNoise: { value: getNoiseTexture() },
  },
  update(windOff, coverage, sunUp, overcast) {
    const u = this.uniforms;
    u.uCsOff.value.set(((windOff.x % TILE) + TILE) % TILE, ((windOff.y % TILE) + TILE) % TILE);
    u.uCsCov.value = coverage;
    // daylight only; a full overcast deck already flattens the light (no distinct cloud shapes on the ground)
    u.uCsAmt.value = 0.5 * sunUp * (1 - Math.min(1, overcast * 1.2));
  },
};

export const cloudShadowPars = /* glsl */`
uniform vec2 uCsOff; uniform float uCsAmt, uCsCov; uniform sampler2D uCsNoise;
float cloudShadow( vec3 wp ) {
  if ( uCsAmt < 0.005 ) return 1.0;
  vec2 uv = ( wp.xz - uCsOff ) * ${(1 / TILE).toFixed(8)};
  float n = texture2D( uCsNoise, uv ).r * 0.7 + texture2D( uCsNoise, uv * 3.0 + 0.37 ).g * 0.3;
  float t = 0.76 - uCsCov * 0.38;   // ~30 % of the ground shaded under fair-weather cumulus, ~60 % when cloudy
  return 1.0 - uCsAmt * smoothstep( t - 0.035, t + 0.05, n );
}
`;

export const cloudShadowApply = (pos) => /* glsl */`
  {
    float csK = cloudShadow( ${pos} );
    reflectedLight.directDiffuse *= csK;
    reflectedLight.directSpecular *= csK;
  }
`;
