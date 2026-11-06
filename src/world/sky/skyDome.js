// Painterly sky dome: zenith→horizon gradient with brush-noise variation, horizon haze, Mie halo + sun disc,
// sun-side horizon band, belt-of-Venus anti-twilight, cirrus streaks, storm overcast deck, stars, milky way, moon.
// createSkyUniforms() -> shared uniforms object; createSkyMaterial(uniforms, { env }) -> ShaderMaterial.
// The `env` variant (for PMREM capture) clamps the sun disc so reflections don't get fireflies.
import * as THREE from 'three';
import { getNoiseTexture } from './noise.js';

export function createSkyUniforms() {
  return {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uBand: { value: new THREE.Color() },
    uAnti: { value: new THREE.Color() },
    uSunColor: { value: new THREE.Color() },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uSunVis: { value: 1 },         // 0..1 sun disc visibility (storm hides it)
    uStars: { value: 0 },
    uCirrus: { value: 0.6 },
    uOvercast: { value: 0 },
    uFlash: { value: 0 },
    uFlashDir: { value: new THREE.Vector3(1, 0.2, 0) },
    uHaze: { value: 1 },
    uTime: { value: 0 },
    uWindOff: { value: new THREE.Vector2() },
    uNoise: { value: getNoiseTexture() },
  };
}

const vert = /* glsl */`
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vDir = wp.xyz - vec3( modelMatrix[3] );
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w; // pin to far plane
}
`;

const frag = /* glsl */`
uniform vec3 uZenith, uHorizon, uGlow, uBand, uAnti, uSunColor, uCloudLit, uCloudShade;
uniform vec3 uSunDir, uMoonDir, uFlashDir;
uniform float uSunVis, uStars, uCirrus, uOvercast, uFlash, uHaze, uTime;
uniform vec2 uWindOff;
uniform sampler2D uNoise;
varying vec3 vDir;

float hash13( vec3 p ) { p = fract( p * 0.1031 ); p += dot( p, p.zyx + 31.32 ); return fract( ( p.x + p.y ) * p.z ); }
float nz( vec2 uv ) { return texture2D( uNoise, uv ).r; }
float fbm( vec2 uv ) {
  return texture2D( uNoise, uv ).r * 0.5 + texture2D( uNoise, uv * 2.03 + 0.31 ).g * 0.3 + texture2D( uNoise, uv * 4.1 + 0.73 ).b * 0.2;
}

void main() {
  vec3 v = normalize( vDir );
  float y = v.y;
  float yh = max( y, 0.0 );
  vec3 sd = normalize( uSunDir );
  float mu = dot( v, sd );
  float muH = dot( normalize( vec3( v.x, 0.0, v.z ) + 1e-4 ), normalize( vec3( sd.x, 0.0, sd.z ) + 1e-4 ) ); // azimuthal closeness
  float sunUp = smoothstep( -0.25, 0.1, sd.y );

  // --- base gradient: horizon → zenith, painterly curve
  // golden hour: pull the zenith blue lower so a warm horizon and blue sky don't mix to lavender grey
  float warmSky = ( 1.0 - smoothstep( 0.05, 0.75, sd.y ) ) * sunUp;
  float g = pow( yh, 0.5 - 0.28 * warmSky );
  vec3 col = mix( uHorizon, uZenith, g );
  // brushy low-frequency variation (oil-paint feel, also kills banding)
  vec2 dirUV = v.xz / ( yh + 0.35 );
  float brush = fbm( dirUV * 0.18 + vec2( 0.13, 0.71 ) ) - 0.5;
  col *= 1.0 + brush * 0.07 * ( 1.0 - uOvercast );

  // --- sun-side horizon band (golden hour warmth), widens when sun is low
  float low = 1.0 - smoothstep( 0.0, 0.5, sd.y );
  float bandShape = exp( -yh * mix( 10.0, 5.5, low ) ) * pow( max( muH * 0.5 + 0.5, 0.0 ), mix( 2.0, 5.0, low ) );
  col = mix( col, uBand, clamp( bandShape * ( 0.35 + 0.65 * low ), 0.0, 1.0 ) * smoothstep( -0.35, -0.02, sd.y ) );

  // --- belt of Venus / earth shadow on the anti-solar side at twilight
  float twi = smoothstep( 0.25, 0.0, abs( sd.y + 0.02 ) );
  float anti = pow( max( -muH * 0.5 + 0.5, 0.0 ), 2.0 );
  col = mix( col, uAnti, twi * anti * smoothstep( 0.0, 0.08, yh ) * exp( -yh * 5.0 ) * 0.8 );

  // --- painted twilight (sun from -7° to +9°): a rose-violet veil laid over the mid sky above the warm
  // band (stronger away from the sun), and soft crepuscular rays fanning from the low sun across the sky
  float dusk = smoothstep( -0.12, -0.02, sd.y ) * ( 1.0 - smoothstep( 0.06, 0.16, sd.y ) ) * ( 1.0 - uOvercast );
  if ( dusk > 0.001 ) {
    float midSky = smoothstep( 0.03, 0.16, yh ) * ( 1.0 - smoothstep( 0.3, 0.75, yh ) );
    vec3 rose = mix( vec3( 0.62, 0.30, 0.42 ), vec3( 0.36, 0.25, 0.52 ), smoothstep( 0.1, 0.5, yh ) - muH * 0.25 );
    col = mix( col, rose * ( 0.75 + 0.25 * smoothstep( -0.1, 0.05, sd.y ) ), dusk * midSky * ( 0.42 - 0.18 * muH ) );
    // rays: azimuth around the sun, broken by noise, only on the sun side, fading up the dome
    vec3 rt = normalize( cross( sd, vec3( 0.0, 1.0, 0.0 ) ) + 1e-4 );
    vec3 ru = cross( rt, sd );
    float ang = atan( dot( v, ru ), dot( v, rt ) );
    float rays = smoothstep( 0.5, 0.8, texture2D( uNoise, vec2( ang * 0.9, 0.37 ) ).r * 0.65 + texture2D( uNoise, vec2( ang * 2.3, 0.71 ) ).g * 0.45 );
    float raySide = pow( max( mu, 0.0 ), 3.0 ) * smoothstep( 0.0, 0.05, yh ) * ( 1.0 - smoothstep( 0.2, 0.6, yh ) );
    col += uBand * rays * raySide * dusk * 0.22;
  }

  // --- horizon haze (thin bright line where sky meets sea)
  col = mix( col, uHorizon * 1.08, exp( -yh * 28.0 ) * 0.55 * uHaze );

  // --- Mie glow around the sun (Henyey-Greenstein-ish) and broad aureole
  float m = max( mu, 0.0 );
  float hg = ( 1.0 - 0.76 * 0.76 ) / pow( 1.0 + 0.76 * 0.76 - 2.0 * 0.76 * mu, 1.5 );
  vec3 glow = uGlow * ( hg * 0.022 + pow( m, 5.0 ) * 0.22 * low + pow( m, 48.0 ) * 0.3 ) * sunUp;
  col += glow * mix( 1.0, 0.35, uOvercast );

  // --- cirrus streaks (high, wind-sheared)
  vec2 cuv = v.xz / ( yh + 0.12 );
  vec2 cu = vec2( cuv.x * 0.06 + cuv.y * 0.02, cuv.y * 0.22 - cuv.x * 0.05 ) + uWindOff * 0.00002;
  float ci = fbm( cu * vec2( 0.6, 1.0 ) ) ;
  ci = ci * 0.7 + 0.3 * fbm( cu * vec2( 2.1, 6.0 ) + ci * 0.6 );
  float patchM = smoothstep( 0.45, 0.7, fbm( cu * 0.11 + 0.37 ) );
  float cirrus = smoothstep( 0.55, 0.82, ci ) * patchM * smoothstep( 0.04, 0.25, yh ) * uCirrus;
  vec3 cirrusCol = mix( uCloudLit, uGlow * 1.3, pow( m, 4.0 ) * low ) * 1.05 + uSunColor * pow( m, 12.0 ) * 0.5 * sunUp;
  col = mix( col, cirrusCol, cirrus * 0.55 );

  // --- storm overcast deck: rolling dark cloud base
  if ( uOvercast > 0.001 ) {
    // nimbostratus deck: broad soft billows (no domain warp → no marbling), darker underside overhead
    vec2 ouv = v.xz / ( yh + 0.1 ) * 0.035 + uWindOff * 0.00003;
    float o1 = fbm( ouv );
    float o2 = fbm( ouv * 2.7 + 0.5 );
    float o3 = texture2D( uNoise, ouv * 9.0 ).a;
    float d = o1 * 0.55 + o2 * 0.33 + o3 * 0.12;
    float billow = smoothstep( 0.32, 0.72, d );
    vec3 deck = mix( uCloudShade * 0.55, uCloudLit * 0.72, billow );
    deck *= mix( 0.75, 1.0, smoothstep( 0.0, 0.5, 1.0 - yh ) ); // heavier overhead
    // light leaking under the deck near the horizon
    deck = mix( deck, uHorizon * 1.08, exp( -yh * 9.0 ) * 0.75 );
    float cover = smoothstep( 0.0, 0.6, uOvercast ) * smoothstep( -0.02, 0.05, y );
    col = mix( col, deck, cover * 0.97 );
  }

  // --- stars & milky way
  if ( uStars > 0.001 ) {
    vec3 sp = v * 220.0;
    vec3 cell = floor( sp );
    float h = hash13( cell );
    float star = 0.0;
    if ( h > 0.985 ) {
      vec3 c = cell + 0.5 + ( vec3( hash13( cell + 7.1 ), hash13( cell + 3.7 ), hash13( cell + 1.3 ) ) - 0.5 ) * 0.6;
      float d = length( sp - c );
      float tw = 0.65 + 0.35 * sin( uTime * ( 2.0 + h * 9.0 ) + h * 80.0 );
      star = smoothstep( 0.22, 0.0, d ) * ( h - 0.985 ) * 66.0 * tw;
    }
    vec3 sc = mix( vec3( 0.75, 0.85, 1.0 ), vec3( 1.0, 0.85, 0.7 ), hash13( cell + 9.9 ) );
    // milky way: band along a tilted great circle
    vec3 mwN = normalize( vec3( 0.35, 0.25, 0.9 ) );
    float mwd = abs( dot( v, mwN ) );
    float mw = exp( -mwd * mwd * 30.0 ) * ( 0.4 + 0.9 * fbm( v.xy * 1.8 + v.z ) );
    float vis = uStars * smoothstep( 0.0, 0.18, y ) * ( 1.0 - uOvercast );
    col += ( sc * star * 2.2 + vec3( 0.16, 0.18, 0.28 ) * mw * 0.35 ) * vis;
  }

  // --- moon (disc with maria + halo)
  vec3 md = normalize( uMoonDir );
  float mm = dot( v, md );
  if ( md.y > -0.1 ) {
    float mvis = smoothstep( -0.05, 0.05, md.y ) * ( 1.0 - 0.85 * uOvercast ) * ( 1.0 - sunUp * 0.7 );
    float ang = acos( clamp( mm, -1.0, 1.0 ) );
    float R = 0.0145;
    vec3 mt = normalize( cross( md, vec3( 0.0, 1.0, 0.0 ) ) );
    vec3 mb = cross( mt, md );
    vec2 lp = vec2( dot( v, mt ), dot( v, mb ) ) / R;
    float maria = fbm( lp * 0.25 + 0.4 );
    float disc = smoothstep( R, R * 0.9, ang );
    vec3 mcol = vec3( 1.0, 0.97, 0.9 ) * ( 0.75 + 0.5 * smoothstep( 0.35, 0.6, maria ) ) * ( 1.0 - 0.25 * dot( lp, lp ) );
    col = mix( col, mcol * 1.5, disc * mvis );
    col += vec3( 0.55, 0.65, 0.9 ) * ( pow( max( mm, 0.0 ), 2000.0 ) * 0.4 + pow( max( mm, 0.0 ), 120.0 ) * 0.06 ) * mvis;
  }

  // --- sun disc with limb darkening
  float sAng = acos( clamp( mu, -1.0, 1.0 ) );
  float SR = 0.0115 * ( 1.0 + low * 0.35 );
  float disc = smoothstep( SR, SR * 0.82, sAng );
  float limb = 1.0 - 0.45 * ( sAng / SR ) * ( sAng / SR );
  #ifdef ENV_PASS
    float sunI = 4.0;
  #else
    float sunI = 14.0;
  #endif
  col += uSunColor * disc * limb * sunI * uSunVis * smoothstep( -0.03, 0.0, y );
  col += uSunColor * pow( m, 1500.0 ) * 1.5 * uSunVis;

  // --- lightning flash lighting up the deck
  if ( uFlash > 0.001 ) {
    float fd = max( dot( v, normalize( uFlashDir ) ), 0.0 );
    col += vec3( 0.6, 0.65, 0.85 ) * uFlash * ( 0.08 + 0.9 * pow( fd, 10.0 ) ) * smoothstep( -0.05, 0.1, y );
  }

  // below the horizon: fade into the haze colour (ocean normally covers this)
  col = mix( uHorizon * 0.92, col, smoothstep( -0.04, 0.0, y ) );
  gl_FragColor = vec4( max( col, 0.0 ), 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSkyMaterial(uniforms, { env = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    defines: env ? { ENV_PASS: 1 } : {},
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
}
