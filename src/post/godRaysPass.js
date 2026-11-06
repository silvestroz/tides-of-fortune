// Screen-space sun shafts. Operates on the LINEAR HDR scene buffer:
//  1) at 1/4 res: mask = bright pixels near the sun's screen position (sky/sun/cloud edges; ships & clouds occlude
//     naturally because they are darker), radially blurred toward the sun (2 passes x 20 taps ≈ 400 effective taps)
//  2) additive composite onto the scene, tinted by the sun colour.
// Only runs when the sun is in (or just outside) view: pass.sunScreen / strength set by PostFX each frame.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const maskFrag = /* glsl */`
uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uAspect, uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D( tDiffuse, vUv ).rgb;
  if ( any( isnan( c ) ) || any( isinf( c ) ) ) c = vec3( 0.0 );   // a NaN pixel must not smear along the shafts
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec2 d = ( vUv - uSun ) * vec2( uAspect, 1.0 );
  float fall = exp( -dot( d, d ) * 2.2 );
  // sky / cloud-edge brightness feeds the shafts; dark occluders (ships, cloud cores, islands) cut them
  float m = smoothstep( uThreshold, uThreshold * 2.0, l );
  // stylised crepuscular breakup: angular bands around the sun so the radial blur forms distinct shafts
  float ang = atan( d.y, d.x );
  float bands = 0.35 + 0.65 * pow( 0.5 + 0.5 * sin( ang * 23.0 + sin( ang * 7.0 ) * 2.0 ) * sin( ang * 11.0 + 1.3 ), 2.0 );
  gl_FragColor = vec4( min( c, vec3( 4.0 ) ) * m * fall * bands, 1.0 );
}`;

const blurFrag = /* glsl */`
uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uStep;
varying vec2 vUv;
const int N = 20;
void main() {
  vec2 dir = ( uSun - vUv ) * uStep / float( N );
  vec2 uv = vUv;
  vec3 acc = vec3( 0.0 ); float w = 1.0, ws = 0.0;
  for ( int i = 0; i < N; i++ ) {
    acc += texture2D( tDiffuse, uv ).rgb * w; ws += w;
    w *= 0.965; uv += dir;
  }
  gl_FragColor = vec4( acc / ws, 1.0 );
}`;

const compFrag = /* glsl */`
uniform sampler2D tDiffuse, tRays; uniform vec3 uTint; uniform float uStrength;
varying vec2 vUv;
void main() {
  vec3 c = texture2D( tDiffuse, vUv ).rgb;
  vec3 r = texture2D( tRays, vUv ).rgb;
  gl_FragColor = vec4( c + r * uTint * uStrength, 1.0 );
}`;

const vert = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

export class GodRaysPass extends Pass {
  constructor({ div = 4 } = {}) {
    super();
    this.div = div;   // render-target divisor (screen size / div); ultra passes a smaller value for crisper shafts
    this.sunScreen = new THREE.Vector2(0.5, 0.5);
    this.tint = new THREE.Color(1, 0.9, 0.7);
    this.strength = 0;
    this.threshold = 0.9;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rtB = new THREE.WebGLRenderTarget(4, 4, opts);
    this.maskMat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: maskFrag, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, uSun: { value: this.sunScreen }, uAspect: { value: 1 }, uThreshold: { value: 0.9 } } });
    this.blurMat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: blurFrag, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, uSun: { value: this.sunScreen }, uStep: { value: 1 } } });
    this.compMat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: compFrag, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, tRays: { value: this.rtA.texture }, uTint: { value: this.tint }, uStrength: { value: 0 } } });
    this.quad = new FullScreenQuad(null);
  }
  setSize(w, h) {
    const qw = Math.max(4, Math.round(w / this.div)), qh = Math.max(4, Math.round(h / this.div));
    this.rtA.setSize(qw, qh); this.rtB.setSize(qw, qh);
    this.maskMat.uniforms.uAspect.value = w / h;
  }
  render(renderer, writeBuffer, readBuffer) {
    const active = this.strength > 0.002;
    if (active) {
      this.maskMat.uniforms.tDiffuse.value = readBuffer.texture;
      this.maskMat.uniforms.uThreshold.value = this.threshold;
      this.quad.material = this.maskMat; renderer.setRenderTarget(this.rtA); this.quad.render(renderer);
      this.blurMat.uniforms.tDiffuse.value = this.rtA.texture; this.blurMat.uniforms.uStep.value = 0.55;
      this.quad.material = this.blurMat; renderer.setRenderTarget(this.rtB); this.quad.render(renderer);
      this.blurMat.uniforms.tDiffuse.value = this.rtB.texture; this.blurMat.uniforms.uStep.value = 0.16;
      renderer.setRenderTarget(this.rtA); this.quad.render(renderer);
    }
    this.compMat.uniforms.tDiffuse.value = readBuffer.texture;
    this.compMat.uniforms.uStrength.value = active ? this.strength : 0;
    this.quad.material = this.compMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.rtA.dispose(); this.rtB.dispose(); this.maskMat.dispose(); this.blurMat.dispose(); this.compMat.dispose(); this.quad.dispose(); }
}
