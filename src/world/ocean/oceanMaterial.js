// createOceanMaterial(shared) -> THREE.ShaderMaterial for the camera-following ocean surface.
// Uses three's light/shadow/fog chunks (lights: true, fog: true) so the surface receives ship shadows and the
// the aerial-perspective fog patched in by src/world/sky/atmosphere.js; everything else (depth colour, Fresnel sky/env reflection, sun specular
// + glitter, crest SSS glow, Jacobian crest foam, shoreline foam bands, wake foam, two scrolling detail normal layers,
// moonlight) is custom.
import * as THREE from 'three';
import { GLSL_WAVES } from './waves.js';

const vert = /* glsl */`
${GLSL_WAVES}
uniform vec2 uOrigin;          // world xz of mesh origin (camera xz)
uniform float uAngRes;         // radial cell size / r (cell size ≈ r * uAngRes * oceanLod(r))
uniform vec2 uLodR;            // LOD band radii R1, R2 (see ocean.js oceanLodFactor)
uniform sampler2D uDepthTex; uniform vec3 uDepthBounds; uniform float uHasDepth;
uniform sampler2D uWakeTex; uniform vec2 uWakeCenter; uniform float uWakeExtent;
varying vec2 vP0; varying vec3 vWorld; varying float vAtt; varying float vTerrain; varying float vDispY;
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
float shallowAtt( float terrain ) { return mix( 0.3, 1.0, smoothstep( 2.0, 25.0, -terrain ) ); }
void main() {
  vec2 p0 = position.xz;
  float r = length( p0 );
  float lodF = 1.0 + smoothstep( uLodR.x, uLodR.x * 1.6, r ) + 2.0 * smoothstep( uLodR.y, uLodR.y * 1.6, r );
  float spacing = max( r * uAngRes * lodF, 0.25 );
  vec2 wxz = p0 + uOrigin;
  float terrain = -200.0;
  if ( uHasDepth > 0.5 ) {
    vec2 duv = ( wxz - uDepthBounds.xy ) / uDepthBounds.z;
    terrain = texture2D( uDepthTex, duv ).r;
    if ( duv.x < 0.0 || duv.y < 0.0 || duv.x > 1.0 || duv.y > 1.0 ) terrain = -200.0;
  }
  float att = shallowAtt( terrain );
  vec3 d = gerstnerDisp( p0, spacing, att );
  // wake waves (visual only)
  vec2 wuv = ( wxz - uWakeCenter ) / uWakeExtent + 0.5;
  if ( wuv.x > 0.0 && wuv.y > 0.0 && wuv.x < 1.0 && wuv.y < 1.0 ) {
    vec4 wk = texture2D( uWakeTex, wuv );
    float edge = smoothstep( 0.0, 0.08, min( min( wuv.x, wuv.y ), min( 1.0 - wuv.x, 1.0 - wuv.y ) ) );
    d.y += wk.g * edge;
  }
  vec3 transformed = vec3( p0.x + d.x, d.y, p0.y + d.z );
  vP0 = p0; vAtt = att; vTerrain = terrain; vDispY = d.y;
  vec4 worldPosition = modelMatrix * vec4( transformed, 1.0 );
  vWorld = worldPosition.xyz;
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <shadowmap_vertex>
  #include <fog_vertex>
}
`;

const frag = /* glsl */`
${GLSL_WAVES}
uniform vec2 uOrigin; uniform vec2 uGlitOff;
uniform vec2 uOffA, uOffB, uOffC; uniform vec4 uOffF; uniform vec2 uOffP;
uniform float uTime, uSeaState;
uniform vec2 uWindDir; uniform float uWindSpeed;
uniform vec3 uLightDir; uniform vec3 uLightCol; uniform float uIsMoon;
uniform vec3 uSunDir;
uniform vec3 uAmbient; uniform vec3 uSkyZenith; uniform vec3 uSkyHorizon;
uniform vec3 uDeep, uTeal, uTurq, uSand, uFoamCol;
uniform sampler2D uDetail; uniform sampler2D uFoamTex;
uniform sampler2D uWakeTex; uniform vec2 uWakeCenter; uniform float uWakeExtent;
uniform sampler2D uSplashTex; uniform vec2 uSplashCenter;
uniform float uHasEnv; uniform float uEnvIntensity;
uniform sampler2D uDepthTex; uniform vec3 uDepthBounds; uniform float uHasDepth;
uniform vec3 uHzBand, uHzGlow; uniform vec2 uHzParams;   // dome horizon replica: band colour, Mie glow colour, (haze, overcast)
varying vec2 vP0; varying vec3 vWorld; varying float vAtt; varying float vTerrain; varying float vDispY;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
#include <logdepthbuf_pars_fragment>
// material.envMap = PMREM texture  => three adds USE_ENVMAP / ENVMAP_TYPE_CUBE_UV / CUBEUV_* defines
#ifdef ENVMAP_TYPE_CUBE_UV
  uniform sampler2D envMap;
  #include <cube_uv_reflection_fragment>
#endif

float hash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }

// anti-tiling: two lookups of a tiled texture at incommensurate scales/rotations, blended by a slow mask,
// so the 9 m / 31 m foam tiles never print a repeating motif (seen as a "u"-shaped reef pattern from above).
vec4 foamNT( vec2 p, float scale, vec2 off ) {
  vec2 q = vec2( p.x * 0.8 - p.y * 0.6, p.x * 0.6 + p.y * 0.8 ) * 1.37;
  vec4 a = texture2D( uFoamTex, p / scale + off );
  vec4 b = texture2D( uFoamTex, q / scale + off.yx + 0.37 );
  float m = smoothstep( 0.3, 0.7, texture2D( uFoamTex, p / ( scale * 13.7 ) + 0.21 ).a );
  return mix( a, b, m );
}
float terrainFrag( vec2 wxz ) {
  if ( uHasDepth < 0.5 ) return -200.0;
  vec2 duv = ( wxz - uDepthBounds.xy ) / uDepthBounds.z;
  if ( duv.x < 0.0 || duv.y < 0.0 || duv.x > 1.0 || duv.y > 1.0 ) return -200.0;
  return texture2D( uDepthTex, duv ).r;
}
// colour of the sky dome at elevation 0 toward direction v (same terms as skyDome.js: band, haze, Mie glow)
vec3 domeHorizon( vec3 v, vec3 sd ) {
  vec3 vh = normalize( vec3( v.x, 0.0, v.z ) + 1e-4 );
  float muH = dot( vh, normalize( vec3( sd.x, 0.0, sd.z ) + 1e-4 ) );
  float low = 1.0 - smoothstep( 0.0, 0.5, sd.y );
  float bandShape = pow( max( muH * 0.5 + 0.5, 0.0 ), mix( 2.0, 5.0, low ) );
  vec3 col = mix( uSkyHorizon, uHzBand, clamp( bandShape * ( 0.35 + 0.65 * low ), 0.0, 1.0 ) * smoothstep( -0.35, -0.02, sd.y ) );
  col = mix( col, uSkyHorizon * 1.08, 0.55 * uHzParams.x );
  float mu = dot( vh, sd ), m = max( mu, 0.0 );
  float hg = ( 1.0 - 0.5776 ) / pow( 1.0 + 0.5776 - 1.52 * mu, 1.5 );
  col += uHzGlow * ( hg * 0.022 + pow( m, 5.0 ) * 0.22 * low + pow( m, 48.0 ) * 0.3 ) * smoothstep( -0.25, 0.1, sd.y ) * mix( 1.0, 0.35, uHzParams.y );
  return col;
}

vec3 skyReflect( vec3 R, float rough, float smoothF ) {
  vec3 r = R; r.y = abs( r.y );
  vec3 grad = mix( uSkyHorizon, uSkyZenith, pow( clamp( r.y, 0.0, 1.0 ), 0.42 ) );
  #ifdef ENVMAP_TYPE_CUBE_UV
    vec3 env = textureCubeUV( envMap, r, rough ).rgb * uEnvIntensity;
    // at range the env's cloud blobs reflect as big pale patches that read teal over the blue sea (they followed the
    // view like wedges); blend toward the clean analytic sky gradient there
    return mix( env, grad, smoothF );
  #else
    return grad;
  #endif
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 toCam = cameraPosition - vWorld;
  float dist = length( toCam );
  vec3 V = toCam / dist;
  float footprint = max( length( fwidth( vP0 ) ), 0.02 );
  float alt = smoothstep( 25.0, 220.0, cameraPosition.y );   // 0 at deck height, 1 at tactical/aerial altitude
  float altF = max( alt, smoothstep( 14.0, 85.0, cameraPosition.y ) );   // earlier ramp for the Fresnel/reflection flattening (mid-height combat cameras)

  // ---- macro normal from Gerstner waves (exact derivatives, footprint-filtered) ----
  float jac;
  vec3 N = gerstnerNormal( vP0, footprint, vAtt, jac );
  // round 6 moire: from altitude the far swell normals (wavelength ~ a few pixels) beat against the pixel grid and the
  // polar mesh, printing bands parallel to the horizon; fade them to flat with range x camera height x footprint
  float farFlat = alt * smoothstep( 300.0, 1300.0, dist ) * 0.85 + smoothstep( 1.5, 6.0, footprint ) * 0.6;
  N = normalize( mix( N, vec3( 0.0, 1.0, 0.0 ), clamp( farFlat, 0.0, 0.9 ) ) );

  // ---- detail normals: two scrolling layers along the wind + a cross layer ----
  // detail fades with distance and at grazing angles (where it would only alias into bright sky streaks)
  // round 6: the near/mid water read as pasted-over ("DoF" look) — detail now holds ~30 % further and from altitude
  float detFade = ( 1.0 - smoothstep( 40.0, 420.0, dist ) ) * mix( 0.3, 1.0, smoothstep( 0.04, 0.3, V.y ) ) * ( 1.0 - smoothstep( 0.1, 0.6, footprint ) ) * mix( 1.0, 0.5, alt );
  float rough = mix( 0.12, 1.0, smoothstep( 0.0, 0.7, uSeaState ) );
  // texture coords: local position * scale + per-layer offset (offset = world origin + scroll, wrapped on the CPU in doubles)
  vec2 wd = uWindDir, wp = vec2( -wd.y, wd.x );
  vec2 pr = vec2( dot( vP0, wd ), dot( vP0, wp ) );      // wind-aligned coords
  vec2 prB = vec2( pr.y, -pr.x ) * 0.8 + pr * 0.6;
  // anti-tiling: each of the two big layers blends with a rotated, offset copy under a slow (~300 m) mask so the
  // 23 m / 7 m detail tiles never print a visible lattice across the sea (seen on the left of the sailing view)
  vec2 prR = vec2( pr.x * 0.8 - pr.y * 0.6, pr.x * 0.6 + pr.y * 0.8 );
  float tileM = smoothstep( 0.25, 0.75, texture2D( uFoamTex, vP0 / 311.0 + 0.43 ).g );
  vec3 dA = mix( texture2D( uDetail, pr / 23.0 + uOffA ).xyz, texture2D( uDetail, prR / 19.3 + uOffA.yx + 0.31 ).xyz, tileM ) * 2.0 - 1.0;
  vec3 dB = mix( texture2D( uDetail, prB / 7.13 + uOffB ).xyz, texture2D( uDetail, prR / 8.41 + uOffB.yx + 0.57 ).xyz, 1.0 - tileM ) * 2.0 - 1.0;
  vec3 dC = texture2D( uDetail, pr / 3.7 + uOffC ).xyz * 2.0 - 1.0;
  float closeF = 1.0 - smoothstep( 15.0, 160.0, dist );
  vec2 dn = ( dA.xy * 0.4 + dB.xy * 0.5 + dC.xy * 0.35 * closeF ) * detFade * rough * 0.42;
  dn = dn.x * wd + dn.y * wp;     // back to world xz
  // far away: replace lost detail with a broad, gently varying roughness
  vec3 Nmacro = N;
  N = normalize( N + vec3( dn.x, 0.0, dn.y ) );

  // ---- water depth & colour ----
  // seabed sampled per fragment: the vertex value was interpolated across far polar-grid triangles (100+ m),
  // smearing shallow colour into long radial turquoise bands over deep water
  float terrainF = terrainFrag( vWorld.xz );
  float waterDepth = max( vWorld.y - terrainF, 0.0 );
  vec4 fN = texture2D( uFoamTex, vP0 / 397.0 + uOffP );     // big painterly patches
  float patchv = fN.a - 0.5;
  // open-ocean colour: view-dependent (looking straight down shows the deep colour)
  float down = clamp( V.y, 0.0, 1.0 );
  // open sea: deep blue looking down, a touch of teal at grazing angles; large painterly patches
  // (grazing tint kept close to the deep hue: a strong teal here printed turquoise bands along every swell face)
  vec3 openCol = mix( mix( uDeep, uTeal, 0.12 ), mix( uDeep * 0.95, vec3( 0.02, 0.16, 0.42 ), 0.35 ), smoothstep( 0.05, 0.5, down ) );
  openCol *= 1.0 + patchv * 0.15;
  float sh0 = smoothstep( 38.0, 12.0, waterDepth );   // deep → teal (mid-depth banks no longer glow turquoise)
  float sh1 = smoothstep( 16.0, 3.0, waterDepth );    // teal → turquoise
  float sh2 = smoothstep( 5.0, 0.8, waterDepth );     // turquoise → sand-lit
  vec3 bodyCol = mix( openCol, uTeal, sh0 * 0.75 );
  bodyCol = mix( bodyCol, uTurq, sh1 * 0.9 );
  bodyCol = mix( bodyCol, uSand, sh2 * 0.85 );
  float shallowGlow = 1.0 + ( sh1 * 0.5 + sh2 * 0.6 ) * alt;   // luminous shallows from altitude
  // lot 0 — shoals readable from the chase camera: at deck height the turquoise was swamped by the Fresnel sky, so
  // reef-depth water (≈1–9 m) gets a lighter, more saturated turquoise that does not depend on altitude
  float reefD = smoothstep( 10.0, 4.0, waterDepth ) * ( 1.0 - smoothstep( 0.9, 0.3, waterDepth ) * 0.5 );
  bodyCol = mix( bodyCol, uTurq * 1.18 + vec3( 0.02, 0.05, 0.04 ), reefD * ( 1.0 - alt ) * 0.55 );
  shallowGlow += reefD * ( 1.0 - alt ) * 0.55;
  // light reaching the water body: ambient sky + direct key light
  float NdotL = max( dot( N, uLightDir ), 0.0 );
  float lightUp = smoothstep( -0.03, 0.12, uLightDir.y );
  float shadow = 1.0;
  #if defined( USE_SHADOWMAP )
    shadow = mix( getShadowMask(), 1.0, alt * 0.85 );   // no hard shadow-frustum quads from above
  #endif
  float rFar0 = smoothstep( 80.0, 400.0, dist );
  // ---- ship contact shadow + mirrored hull/sail reflection (from the wake pass's hull mask, alpha channel) ----
  // March from this water point toward the sun (shadow) and away from the camera (reflection): a ray leaving the water
  // at elevation e reaches height d*tan(e) after d metres, so hitting the hull footprint at a low height = hull, higher =
  // the sails standing over it. Cheap (6+6 taps, only inside the wake window), and the ship stops floating above the sea.
  float shipSh = 0.0, reflHull = 0.0, reflSail = 0.0;
  {
    vec2 wuv0 = ( vWorld.xz - uWakeCenter ) / uWakeExtent + 0.5;
    if ( wuv0.x > 0.02 && wuv0.y > 0.02 && wuv0.x < 0.98 && wuv0.y < 0.98 && dist < 900.0 ) {
      vec2 sd = uLightDir.xz; float sl = length( sd );
      float tanS = uLightDir.y / max( sl, 1e-3 );
      sd = sl > 1e-3 ? sd / sl : vec2( 0.0, 1.0 );
      vec2 jit = N.xz * 1.5;
      for ( int i = 0; i < 6; i++ ) {
        float d = 1.0 + float( i * i ) * 1.6 + float( i ) * 1.5;     // 1 .. 48 m
        float h = d * tanS;
        if ( h > 34.0 ) break;
        float m = texture2D( uWakeTex, wuv0 + ( sd * d + jit ) / uWakeExtent ).a;
        shipSh = max( shipSh, m * ( h < 5.5 ? 1.0 : 0.45 * ( 1.0 - smoothstep( 20.0, 34.0, h ) ) ) );
      }
      vec2 vd = -toCam.xz; float vl = length( vd );
      vd = vl > 1e-3 ? vd / vl : vec2( 0.0, 1.0 );
      float tanE = toCam.y / max( vl, 1.0 );
      #ifdef OCEAN_ULTRA
        vec2 rj = N.xz * mix( 2.6, 1.0, rFar0 );
      #else
        vec2 rj = N.xz * mix( 4.0, 1.5, rFar0 );
      #endif
      // march up to the rig's height; dithered start + continuous weights so the mirrored shape has no stair steps
      float dMax = min( 30.0 / max( tanE, 0.05 ), 80.0 );
      float dj = hash12( floor( vWorld.xz * 3.0 ) ) ;
      #ifdef OCEAN_ULTRA
        #define REFL_STEPS 18   // ultra: finer march, crisper mirrored hull/sails
      #else
        #define REFL_STEPS 10
      #endif
      for ( int i = 0; i < REFL_STEPS; i++ ) {
        float d = ( float( i ) + dj ) / float( REFL_STEPS ) * dMax;
        float h = d * tanE;
        float m = texture2D( uWakeTex, wuv0 + ( vd * d + rj ) / uWakeExtent ).a;
        reflHull = max( reflHull, m * ( 1.0 - smoothstep( 3.5, 6.0, h ) ) );
        reflSail = max( reflSail, m * smoothstep( 4.0, 7.0, h ) * ( 1.0 - smoothstep( 14.0, 30.0, h ) ) );
      }
      float rFade = 1.0 - altF * 0.6;
      reflHull *= rFade; reflSail *= rFade;
      shipSh *= lightUp;
    }
  }
  shadow = min( shadow, 1.0 - shipSh * 0.85 );
  vec3 keyLight = uLightCol * lightUp;
  vec3 waterLight = uAmbient * 0.45 + keyLight * ( 0.12 + 0.1 * NdotL ) * mix( 0.55, 1.0, shadow );
  vec3 col = bodyCol * waterLight * shallowGlow;

  // ---- subsurface glow through crests (light travelling through thin wave tops) ----
  vec2 Lh = normalize( uLightDir.xz + 1e-4 );
  float back = pow( clamp( dot( -V.xz / max( length( V.xz ), 1e-3 ), -Lh ) * 0.5 + 0.5, 0.0, 1.0 ), 3.0 );
  float crestH = clamp( vDispY / ( 0.6 + 2.2 * uSeaState ) + 0.25, 0.0, 1.5 );
  float sss = crestH * crestH * ( 0.55 + 0.45 * back ) * ( 1.0 - down * 0.7 );
  vec3 sssCol = mix( uTeal, uTurq, 0.5 );
  // crest glow only close to a low camera: from mid/high cameras whole swell crests (100+ m long) lit up teal and
  // printed big soft turquoise blotches over the deep sea (the other half of the 'nappes' seen in tactical/combat views)
  float altS = 1.0 - altF;
  sss = smoothstep( 0.0, 1.2, sss ) * 0.8 * ( 1.0 - smoothstep( 0.25, 0.6, down ) ) * altS * altS * ( 1.0 - smoothstep( 90.0, 420.0, dist ) );
  col += sssCol * sss * keyLight * 0.1 * vAtt * mix( 0.6, 1.0, shadow ) * ( 1.0 - uIsMoon * 0.7 );
  col += sssCol * sss * uAmbient * 0.05;

  // ---- reflection ----
  // reflection uses a normal whose ripple/short-wave content is faded with range, pixel footprint and camera height:
  // the sky gradient near the horizon is steep, so sub-pixel ripple normals aliased into parallel white lines (corduroy)
  float rFar = max( max( smoothstep( 80.0, 400.0, dist ), smoothstep( 0.1, 0.6, footprint ) ), alt * 0.7 );
  vec3 NR = normalize( mix( N, mix( Nmacro, vec3( 0.0, 1.0, 0.0 ), rFar * 0.6 ), rFar ) );
  vec3 R = reflect( -V, NR );
  // Fresnel from a variance-filtered normal: the per-pixel normal at grazing angles flips between facets the pixel
  // cannot resolve, and the steep 5th-power Fresnel turned that into long white horizon-reflection streaks
  // from altitude the long swells' faces tilt the Fresnel term by several percent over hundreds of metres: with the
  // teal horizon in the reflection this printed broad, straight-edged turquoise 'nappes' (often right behind the ships,
  // where the eye looks) -> flatten the Fresnel normal with camera height
  float nVar = clamp( footprint * 0.12 + ( 1.0 - smoothstep( 0.03, 0.25, V.y ) ) * 0.5 + altF * 0.55, 0.0, 0.85 );
  vec3 NF = normalize( mix( NR, vec3( 0.0, 1.0, 0.0 ), nVar ) );
  float NdotV = max( dot( NF, V ), 0.0 );
  float F = 0.02 + 0.98 * pow( 1.0 - NdotV, 5.0 );
  F = min( F, mix( 0.75, 0.55, nVar ) );
  #ifdef OCEAN_ULTRA
    // ultra: sharper sky/cloud reflection at mid range (SMAA + supersampling absorb the extra contrast)
    float reflRough = clamp( 0.03 + footprint * 0.003 + uSeaState * 0.05 + smoothstep( 120.0, 1200.0, dist ) * 0.24, 0.0, 0.5 );
    vec3 refl = skyReflect( R, reflRough, rFar * 0.6 );
  #else
    float reflRough = clamp( 0.04 + footprint * 0.004 + uSeaState * 0.06 + smoothstep( 80.0, 800.0, dist ) * 0.35, 0.0, 0.6 );
    vec3 refl = skyReflect( R, reflRough, rFar * 0.75 );
  #endif
  // grazing reflections of the bright horizon haze otherwise stack into a white strip before fog
  // painted seas reflect a slightly darker, greyer sky: keeps foam the only near-white on the water
  refl = min( refl, uSkyHorizon * 0.82 + uLightCol * 0.01 );
  // from altitude the sky reflection is flattened toward its mean: ripple-scale reflection contrast read as stripes
  // (less flattening re-printed ripple-scale cloud reflections as stripes from the battle camera: keep 0.75)
  refl = mix( refl, mix( uSkyHorizon, uSkyZenith, 0.6 ) * 0.8, altF * 0.75 );
  // mirrored ship: dark wet hull just below the waterline, pale canvas further out (rippled by the surface normal)
  refl = mix( refl, vec3( 0.06, 0.035, 0.02 ) * ( uAmbient + uLightCol * 0.3 ), reflHull * 0.85 );
  refl = mix( refl, vec3( 0.8, 0.74, 0.62 ) * ( uAmbient * 0.6 + uLightCol * 0.4 ), reflSail * ( 1.0 - reflHull ) * 0.45 );
  col = mix( col, refl, max( F, reflHull * 0.3 + reflSail * 0.1 ) );
  col *= 1.0 - shipSh * 0.28;   // shaded water under the ship's shadow (ambient as well, painterly)

  // ---- sun / moon specular + glitter ----
  vec3 H = normalize( uLightDir + V );
  // round 6: from altitude the swell faces printed the sun path as parallel bright stripes; light them with a flattened
  // normal and a wider lobe there (the path stays as a soft sheet + glitter)
  float NdotH = max( dot( normalize( mix( N, vec3( 0.0, 1.0, 0.0 ), altF * 0.6 ) ), H ), 0.0 );
  // normal variance the pixel cannot resolve widens the lobe (otherwise sub-pixel facets alias into white streaks)
  float a0 = mix( 0.035, 0.09, uSeaState );
  float a = sqrt( a0 * a0 + min( footprint * 0.02, 0.09 ) + ( 1.0 - detFade ) * 0.004 + altF * 0.012 );
  float a2 = a * a;
  float dd = NdotH * NdotH * ( a2 - 1.0 ) + 1.0;
  float D = a2 / ( PI * dd * dd );
  float spec = D * F * 0.25 / max( NdotV, 0.15 ) * NdotL;
  // broad warm sheen: the low sun's path on the water
  float a3 = 0.22 + 0.1 * uSeaState;
  float dd2 = NdotH * NdotH * ( a3 * a3 - 1.0 ) + 1.0;
  float sheen = a3 * a3 / ( PI * dd2 * dd2 ) * F * NdotL * 0.2;
  // glitter: sparse facets catching the light, shimmering in time
  // glitter cells grow in octaves with the pixel footprint so the sparkle stays legible from the battle camera
  float gS = exp2( floor( log2( max( 1.0, footprint * 5.0 ) ) ) );
  vec2 gcell = floor( ( vP0 * 2.0 + uGlitOff + dn * 2.0 ) / gS );
  float gh = hash12( gcell );
  float tw = 0.5 + 0.5 * sin( uTime * ( 3.0 + gh * 8.0 ) + gh * 60.0 );
  // round flecks (square hash cells read as square dots from the high camera): circular mask inside the cell, jittered
  vec2 gloc = fract( ( vP0 * 2.0 + uGlitOff + dn * 2.0 ) / gS ) - 0.5 - ( hash12( gcell + 7.1 ) - 0.5 ) * 0.4;
  float gl = smoothstep( mix( 0.86, 0.975, alt ), 1.0, gh * tw ) * smoothstep( 0.42, 0.12, length( gloc ) );
  float glitterLobe = pow( NdotH, mix( 150.0, 50.0, smoothstep( 50.0, 900.0, dist ) ) );
  float subPix = 1.0 - smoothstep( 0.12, 0.45, footprint / gS ) * 0.85;   // glitter cells: fade once they go sub-pixel
  float glitter = gl * glitterLobe * 7.5 * subPix * ( 1.0 - smoothstep( 300.0, 2500.0, dist ) ) * smoothstep( 0.0, 0.25, 1.0 - down );
  vec3 specCol = uLightCol * mix( vec3( 1.0 ), vec3( 1.0, 0.96, 0.84 ), 0.6 );
  // low-sun column: a vertically stretched lobe around the mirror direction of the sun (golden path on the water)
  float lowSun = 1.0 - smoothstep( 0.02, 0.35, uLightDir.y );
  // the moon lays its path at any elevation it reaches (shorter and narrower the higher it rides): the night sea's one
  // bright feature, a broken silver road of flecks toward the moon
  float pathK = max( lowSun, uIsMoon * ( 1.0 - smoothstep( 0.35, 0.85, uLightDir.y ) ) );
  vec3 Rv = reflect( -V, normalize( mix( vec3( 0.0, 1.0, 0.0 ), N, 0.7 ) ) );
  float az = dot( normalize( Rv.xz + 1e-4 ), normalize( uLightDir.xz + 1e-4 ) );
  float colAz = pow( max( az, 0.0 ), 600.0 * ( 1.0 - pathK * 0.6 ) );
  float colEl = exp( -abs( Rv.y - uLightDir.y ) * mix( 30.0, 4.5, pathK ) );   // gfx-ultra: longer golden path at sunset
  float column = colAz * colEl * pathK * ( 0.6 + 2.5 * smoothstep( 0.82, 1.0, NdotH ) ) * ( 1.0 - uIsMoon * 0.5 );
  // sparkling flecks inside the column (warm white by day, silver under the moon), stretched toward the viewer
  float fl = hash12( floor( vec2( vP0.x * 1.3, vP0.y * 1.3 ) + uGlitOff * 0.65 + dn * 6.0 ) + floor( uTime * 6.0 ) * 0.37 );
  float flecks = smoothstep( 0.8, 1.0, fl ) * subPix * colAz * pathK * mix( 6.0, 9.0, uIsMoon ) * ( 1.0 - smoothstep( 200.0, 3000.0, dist ) );
  // HDR highlights are capped: an unbounded GGX peak (D ~ 1/(pi a^2) ~ 260) times a bright key light feeds the bloom
  // with single-pixel spikes that smear into streaks; the cap keeps a strong but bounded sun path
  // the broad sheen lobe is capped separately and low: it covers a large solid angle, so with a high sun it washed the
  // whole near sea white at water level facing the sun
  // facing the sun from deck height the capped lobe still covered a wide band of near-white water at the waterline:
  // lower the cap at grazing view angles (the sun path stays, as flecks/glitter rather than a white sheet)
  float graze = 1.0 - smoothstep( 0.04, 0.3, V.y );
  float hl = min( spec + glitter * F * 6.0 + column * ( 3.0 + 2.0 * pathK ), mix( 4.0, 1.6 + 0.8 * pathK, graze ) ) + min( sheen, mix( 0.25, 0.1, graze ) );
  col += specCol * hl * shadow * lightUp;
  col += mix( vec3( 1.0, 0.957, 0.84 ), vec3( 0.86, 0.93, 1.0 ), uIsMoon ) * uLightCol * min( flecks, 3.0 ) * lightUp;

  // ---- foam ----
  float storm = uSeaState;
  // crest foam from the Jacobian (horizontal compression) — whitecaps only appear when the sea is up
  // jac ranges ~ (1 - sum k*QA) .. 1; foam where the surface is most compressed (crest tops)
  float jt = mix( 0.2, 0.75, smoothstep( 0.1, 1.0, storm ) );
  float crest = smoothstep( jt, jt - 0.2, jac ) * smoothstep( 0.15, 0.5, storm );
  // whitecap patches: breaking happens in groups, gated by a slowly drifting noise
  float capN = texture2D( uFoamTex, vP0 / 61.0 + uOffF.zw * 0.5 ).r;
  float capGate = smoothstep( 0.6 - storm * 0.25, 0.85 - storm * 0.2, fN.a * 0.6 + capN * 0.6 );
  crest *= capGate;   // whitecaps only inside noise-gated patches, never along every crest line
  crest += smoothstep( 0.7, 1.3, crestH ) * capGate * smoothstep( 0.4, 0.9, storm ) * 0.6;
  // gale: most wave tops break, in broad white caps spilling down the lee face (a storm sea must read white-flecked
  // from the deck, not as a dark rippled lake)
  crest += smoothstep( 0.8, 1.25, crestH ) * smoothstep( 0.45, 0.75, fN.a * 0.45 + capN * 0.75 ) * smoothstep( 0.65, 1.0, storm ) * 0.75;
  // fair-weather crest foam: thin lacy caps on the highest crests even in a moderate sea (painted seas always carry a
  // few white flecks), patch-gated so it never traces every crest line
  float fairGate = smoothstep( 0.48, 0.8, fN.a * 0.55 + texture2D( uFoamTex, vP0 / 47.0 + uOffF.xy * 0.7 ).r * 0.65 );
  // (gfx-ultra: lower threshold, wider gate and longer reach so the caps read from the chase camera, 60-400 m)
  crest += smoothstep( 0.62, 1.05, crestH ) * max( fairGate, smoothstep( 0.4, 0.7, fN.a ) * 0.6 * ( 1.0 - altF ) ) * 0.95 * ( 1.0 - smoothstep( 0.6, 0.95, storm ) ) * ( 1.0 - smoothstep( 320.0, 1100.0, dist ) ) * ( 1.0 - altF * 0.7 );   // high cameras: as before (patches read as blots from above)
  // wind-driven foam streaks (Beaufort 7+): long thin lines along the wind
  float streakN = texture2D( uFoamTex, vec2( pr.x / 140.0, pr.y / 11.0 ) + uOffP * 3.0 ).b;
  float streakM = texture2D( uFoamTex, vP0 / 173.0 + uOffP ).r;
  crest += smoothstep( 0.62, 0.86, streakN ) * smoothstep( 0.4, 0.75, streakM ) * smoothstep( 0.6, 1.0, storm ) * 0.55;
  vec4 f1 = foamNT( vP0, 9.0, uOffF.xy );
  vec4 f2 = foamNT( vP0, 31.0, uOffF.zw );
  float foamTex = clamp( f1.g * 0.65 + f2.r * 0.55, 0.0, 1.0 );
  // shoreline: animated surf bands rolling toward the beach + a solid swash line
  float shore = 0.0;
  if ( terrainF > -12.0 ) {
    float sd = waterDepth;
    // surf lines roll in toward the beach (phase decreases with depth), wobbling along the coast
    float wob = fN.a * 9.0 + texture2D( uFoamTex, vP0 / 151.0 + uOffP * 2.63 ).r * 4.0;   // 397 m / 151 m: no visible repeat
    float band = sin( sd * 1.6 + uTime * 1.3 + wob );
    shore = smoothstep( 0.68, 0.97, band ) * smoothstep( 8.0, 1.0, sd );
    // swash: the white water at the waterline surges up the shelf and drains back on the swell's rhythm, leaving a
    // thin lace line at its high-water mark
    float surge = 0.5 + 0.5 * sin( uTime * 0.55 + wob * 0.7 );
    float reach = mix( 0.35, 1.1, surge );
    shore += smoothstep( reach, reach * 0.15, sd ) * 1.0;
    shore += exp( -pow( ( sd - 1.15 ) / 0.12, 2.0 ) ) * ( 1.0 - surge ) * 0.55;
    shore += smoothstep( 2.2, 0.3, sd ) * 0.3;
  }
  // lot 0 — breakers on reef edges: where the seabed rises steeply to within ~4 m, broken white water rolls
  // over the lip (pulsing with the swell), so a submerged reef reads as a foam line even from the chase camera
  float reefBreak = 0.0;
  if ( waterDepth > 0.0 && waterDepth < 7.0 ) {
    float slope = fwidth( terrainF ) / max( length( fwidth( vWorld.xz ) ), 1e-3 );
    float lip = smoothstep( 6.8, 3.2, waterDepth ) * smoothstep( 0.4, 1.6, waterDepth ) * smoothstep( 0.025, 0.12, slope );
    float roll = sin( uTime * 0.9 + fN.a * 11.0 + waterDepth * 1.1 ) * 0.5 + 0.5;
    // gfx-ultra: brighter, wider broken water that stays visible farther (was easy to miss from the chase camera)
    reefBreak = lip * ( 0.6 + 0.6 * roll ) * ( 1.0 - smoothstep( 600.0, 1600.0, dist ) );
  }
  shore = max( shore, min( reefBreak, 1.0 ) );
  // wakes
  float wakeFoam = 0.0, churn = 0.0, splashF = 0.0;
  vec2 wuv = ( vWorld.xz - uWakeCenter ) / uWakeExtent + 0.5;
  if ( wuv.x > 0.0 && wuv.y > 0.0 && wuv.x < 1.0 && wuv.y < 1.0 ) {
    vec4 wk = texture2D( uWakeTex, wuv );
    float edge = smoothstep( 0.0, 0.06, min( min( wuv.x, wuv.y ), min( 1.0 - wuv.x, 1.0 - wuv.y ) ) );
    wakeFoam = wk.r * edge; churn = wk.b * edge;
    vec4 sp = texture2D( uSplashTex, ( vWorld.xz - uSplashCenter ) / uWakeExtent + 0.5 );
    splashF = sp.r * edge; churn += sp.b;   // round 6: splash foam kept separate (lacy, see below), no solid disc
  }
  // wake foam density -> lace: the bubble-wall lattice is thresholded by the density, so a dense wake is near-solid
  // white with small holes, a thinning one keeps only the cell walls and its fringe breaks into marbled strands.
  // The lattice scale steps from the 4.5 m to the 31 m tile with the pixel footprint (cells stay a few pixels wide),
  // and once even those go sub-pixel the lace resolves to its mean coverage, a continuous stroke that never dots.
  float wk1 = clamp( wakeFoam, 0.0, 1.4 );
  float wCov = smoothstep( 0.04, 1.0, wk1 );
  float laceN = foamNT( vP0, 4.5, uOffF.xy * 2.0 ).g;
  float lace = mix( mix( laceN * 0.6 + f1.g * 0.5, f1.g * 0.55 + f2.g * 0.5, smoothstep( 0.05, 0.22, footprint ) ), f2.g, smoothstep( 0.3, 0.9, footprint ) );
  float lt = 1.0 - wCov * 1.05;
  float wakeLace = smoothstep( lt, lt + 0.38, lace ) * smoothstep( 0.0, 0.25, wCov );
  // a faint veil under the lace keeps thin Kelvin arms reading as one feathered line rather than dotted specks
  wakeLace = max( wakeLace, wCov * 0.3 );
  wakeLace = max( wakeLace, smoothstep( 1.1, 1.4, wk1 ) );     // churned white right behind the stern
  float wakeBody = mix( wakeLace, wCov * 0.85, smoothstep( 0.9, 2.5, footprint ) );
  // churned (aerated) water under the trail: a lighter, greener turquoise that shows through the holes of the lace
  // (kept close to the body colour: a strong turquoise churn read as a glowing cyan slick under and behind every hull)
  float churnK = clamp( churn, 0.0, 1.0 ) * ( 0.14 + 0.16 * ( 1.0 - altF ) );
  col = mix( col, mix( bodyCol, mix( uTeal, uTurq, 0.35 ), 0.55 ) * waterLight * 1.15 + refl * F * 0.5, churnK );
  float foamAmt = crest * 0.9 + wakeFoam * 0.35;
  // shore foam: fine lacy texture so surf reads as lines of spume, not blobs
  // (from range the lace mips to its mean and greyed the surf into a flat pale stripe: the lines stay solid there)
  float shoreFoam = clamp( shore * mix( smoothstep( 0.15, 0.75, f1.g * 0.8 + shore * 0.45 ), 0.9, smoothstep( 0.12, 0.5, footprint ) ), 0.0, 1.0 );
  float fbreak = smoothstep( 0.0, 1.0, foamTex * 1.25 - ( 1.0 - min( foamAmt, 1.4 ) ) * 0.9 );
  float foam = clamp( fbreak * min( foamAmt * 1.5, 1.0 ), 0.0, 1.0 );
  foam = max( foam, clamp( wakeBody, 0.0, 1.0 ) * 0.92 );
  // splash foam: broken lace that thins outward as it decays (the continuous wake body printed opaque white discs)
  foam = max( foam, smoothstep( 0.5, 0.95, foamTex * 0.85 + min( splashF, 1.0 ) * 0.5 ) * min( splashF * 1.3, 1.0 ) * 0.85 );
  // filter foam detail at distance so it reads as a soft wash instead of aliasing
  // (whitecaps only: wake foam must not become a pale wash at range)
  foam = mix( foam, clamp( crest * 0.4 * ( 0.6 + foamTex * 0.6 ), 0.0, 0.6 ), smoothstep( 250.0, 1200.0, dist ) );
  vec3 foamLit = uFoamCol * ( uAmbient * mix( 0.75, 0.4, uIsMoon ) + keyLight * ( 0.35 + 0.4 * NdotL ) * mix( 0.5, 1.0, shadow ) * 0.3 );
  // under an overcast the dim key light left foam a dull grey: keep it at least as bright as the horizon sky
  foamLit = max( foamLit, uFoamCol * uSkyHorizon * 0.95 * smoothstep( 0.5, 0.9, storm ) * ( 1.0 - uIsMoon * 0.6 ) );
  foam = max( foam, shoreFoam );
  col = mix( col, foamLit, foam );

  #ifdef OCEAN_DEBUG
    if ( OCEAN_DEBUG == 1 ) col = N * 0.5 + 0.5;
    if ( OCEAN_DEBUG == 2 ) col = vec3( F );
    if ( OCEAN_DEBUG == 3 ) col = refl;
    if ( OCEAN_DEBUG == 4 ) col = bodyCol * waterLight;
    if ( OCEAN_DEBUG == 5 ) col = vec3( foam, wakeFoam, crest );
  #endif
  // ---- horizon: blend far water into the sky's horizon colour (same value the dome uses at y = 0) so the
  // sea-sky seam is a soft haze gradient, not a bright razor line; keep the sun's glow toward the sun
  // (applied after fog, toward the exact colour the dome paints at elevation 0, so no seam/white line remains)
  float hz = 1.0 - exp( -pow( dist / 6000.0, 2.0 ) );
  gl_FragColor = vec4( col, 1.0 );
  #ifndef OCEAN_DEBUG
  #include <fog_fragment>
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, domeHorizon( -V, normalize( uSunDir ) ), hz );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createOceanMaterial(shared) {
  const lin = (h) => new THREE.Color(h);   // Color() from hex is converted to linear working space
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog]);
  // re-attach shared (by-reference) fog extras that merge() may have cloned
  for (const k of ['fogSunDir', 'fogSunGlow', 'fogAtmos']) if (THREE.UniformsLib.fog[k]) uniforms[k] = THREE.UniformsLib.fog[k];
  Object.assign(uniforms, shared, {
    uTime: { value: 0 }, uSeaState: { value: 0.5 },
    uWindDir: { value: new THREE.Vector2(1, 0) }, uWindSpeed: { value: 8 },
    uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uLightCol: { value: new THREE.Color(3, 3, 3) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uIsMoon: { value: 0 },
    uAmbient: { value: new THREE.Color(0.6, 0.75, 0.9) },
    uSkyZenith: { value: new THREE.Color(0x3a7fc4) }, uSkyHorizon: { value: new THREE.Color(0xcfe6ef) },
    uDeep: { value: lin(0x0b4a6e) }, uTeal: { value: lin(0x12708a) }, uTurq: { value: lin(0x39c4c0) },
    uSand: { value: lin(0x8fe3c9) }, uFoamCol: { value: lin(0xf4fbf8) },
    uOffA: { value: new THREE.Vector2() }, uOffB: { value: new THREE.Vector2() }, uOffC: { value: new THREE.Vector2() },
    uOffF: { value: new THREE.Vector4() }, uOffP: { value: new THREE.Vector2() }, uGlitOff: { value: new THREE.Vector2() },
    uHzBand: { value: new THREE.Color(0xffd9a0) }, uHzGlow: { value: new THREE.Color(0, 0, 0) }, uHzParams: { value: new THREE.Vector2(1, 0) },
    uHasEnv: { value: 0 }, uEnvIntensity: { value: 1 }, envMap: { value: null },
  });
  const m = new THREE.ShaderMaterial({
    uniforms, vertexShader: vert, fragmentShader: frag,
    lights: true, fog: true,
  });
  return m;
}
