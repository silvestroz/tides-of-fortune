// Painterly display-space grade, run AFTER OutputPass (ACES + sRGB) so its controls behave like a colourist's:
//   lift/gamma/gain, saturation (with skin/neutral-protecting vibrance), warm-highlight / cool-shadow split tone,
//   subtle paper/canvas texture modulation, vignette, film grain. Then FXAA follows.
// Uniforms exposed on pass.uniforms (PostFX tweaks them per time-of-day / weather).
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export const GradeShader = {
  name: 'TofGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uLift: { value: new THREE.Vector3(0.012, 0.018, 0.035) },
    uGamma: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
    uGain: { value: new THREE.Vector3(1.02, 1.0, 0.97) },
    uSat: { value: 1.12 },
    uVibrance: { value: 0.18 },
    uSplitShadow: { value: new THREE.Color(0.2, 0.42, 0.62) },
    uSplitHigh: { value: new THREE.Color(1.0, 0.78, 0.5) },
    uSplitAmt: { value: 0.12 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.028 },
    uCanvas: { value: 0.025 },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec3 uLift, uGamma, uGain, uSplitShadow, uSplitHigh;
    uniform float uSat, uVibrance, uSplitAmt, uVignette, uGrain, uCanvas, uTime;
    uniform vec2 uRes;
    varying vec2 vUv;
    float h12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
    float vnoise( vec2 p ) {
      vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
      return mix( mix( h12( i ), h12( i + vec2( 1, 0 ) ), f.x ), mix( h12( i + vec2( 0, 1 ) ), h12( i + vec2( 1, 1 ) ), f.x ), f.y );
    }
    void main() {
      vec4 src = texture2D( tDiffuse, vUv );
      vec3 c = clamp( src.rgb, 0.0, 1.0 );
      // lift / gamma / gain (ASC-CDL-ish)
      c = c * uGain + uLift * ( 1.0 - c );
      c = pow( max( c, 0.0 ), 1.0 / uGamma );
      float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
      // saturation + vibrance (boost muted colours more than saturated ones)
      float mx = max( c.r, max( c.g, c.b ) ), mn = min( c.r, min( c.g, c.b ) );
      float s = mx - mn;
      c = mix( vec3( l ), c, uSat + uVibrance * ( 1.0 - s ) );
      // split tone: cool shadows, warm highlights (soft-light style, luminance preserving-ish)
      float hw = smoothstep( 0.35, 0.95, l ), sw = 1.0 - smoothstep( 0.05, 0.5, l );
      vec3 tone = uSplitShadow * sw + uSplitHigh * hw;
      c = mix( c, c * ( 0.6 + 0.8 * tone ), uSplitAmt * ( sw + hw ) );
      // painterly canvas: low-freq brush mottling + fine weave, tied to screen (like paint on canvas)
      vec2 px = vUv * uRes;
      float mott = vnoise( px / 90.0 ) * 0.6 + vnoise( px / 23.0 ) * 0.4;
      float weave = ( sin( px.x * 1.9 ) * sin( px.y * 1.9 ) ) * 0.5;
      c *= 1.0 + ( mott - 0.5 ) * uCanvas * 2.0 + weave * uCanvas * 0.25;
      // vignette (elliptical, slightly warm-dark)
      vec2 d = ( vUv - 0.5 ) * vec2( uRes.x / uRes.y, 1.0 ) * 0.9;
      float vig = smoothstep( 0.35, 1.05, length( d ) );
      c *= 1.0 - vig * uVignette * vec3( 0.95, 1.0, 1.05 );
      // film grain (luma-weighted, stronger in mids)
      float gn = h12( px + fract( uTime * 7.13 ) * 517.0 ) - 0.5;
      c += gn * uGrain * ( 0.4 + 0.6 * ( 1.0 - abs( l - 0.5 ) * 2.0 ) );
      gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), 1.0 );
    }`,
};

export function createGradePass() {
  return new ShaderPass(GradeShader);
}
