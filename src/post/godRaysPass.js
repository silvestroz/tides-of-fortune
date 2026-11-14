// Screen-space sun shafts. Operates on the LINEAR HDR scene buffer, at 1/div of its size:
//   mask = bright pixels near the sun's screen position (sky/sun/cloud edges; ships & clouds occlude naturally
//   because they are darker), radially blurred toward the sun (2 passes x 20 taps ≈ 400 effective taps).
// The shafts are not composited here: the bloom's bright pass and the grade pass add `texture * gain` to the scene
// themselves (src/post/bloomPass.js, src/post/gradePass.js), which saves a full-screen pass.
// API: const rays = new GodRaysPass({ div }); rays.setSize(w, h) (scene size); rays.sunScreen / tint / strength /
//      threshold (set by PostFX each frame); rays.enabled; rays.render(renderer, sceneTexture) (does nothing unless
//      the sun is in or just outside the view); rays.texture; rays.gain (vec3 to multiply the texture by, zero when
//      there are no shafts); rays.materials (programs to precompile); rays.dispose().
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

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

const vert = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

export class GodRaysPass {
  constructor({ div = 4 } = {}) {
    this.div = div;   // render-target divisor (screen size / div); ultra passes a smaller value for crisper shafts
    this.enabled = true;
    this.sunScreen = new THREE.Vector2(0.5, 0.5);
    this.tint = new THREE.Color(1, 0.9, 0.7);
    this.strength = 0;
    this.threshold = 0.9;
    this.gain = new THREE.Vector3();
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(4, 4, opts);
    this.rtB = new THREE.WebGLRenderTarget(4, 4, opts);
    this.texture = this.rtA.texture;
    this.maskMat = new THREE.ShaderMaterial({ name: 'GodRaysMask', vertexShader: vert, fragmentShader: maskFrag, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, uSun: { value: this.sunScreen }, uAspect: { value: 1 }, uThreshold: { value: 0.9 } } });
    this.blurMat = new THREE.ShaderMaterial({ name: 'GodRaysBlur', vertexShader: vert, fragmentShader: blurFrag, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, uSun: { value: this.sunScreen }, uStep: { value: 1 } } });
    this.materials = [this.maskMat, this.blurMat];
    this.quad = new FullScreenQuad(null);
  }
  setSize(w, h) {
    const qw = Math.max(4, Math.round(w / this.div)), qh = Math.max(4, Math.round(h / this.div));
    this.rtA.setSize(qw, qh); this.rtB.setSize(qw, qh);
    this.maskMat.uniforms.uAspect.value = w / h;
  }
  render(renderer, sceneTexture) {
    const active = this.enabled && this.strength > 0.002;
    this.gain.set(this.tint.r, this.tint.g, this.tint.b).multiplyScalar(active ? this.strength : 0);
    if (!active) return;
    this.maskMat.uniforms.tDiffuse.value = sceneTexture;
    this.maskMat.uniforms.uThreshold.value = this.threshold;
    this.quad.material = this.maskMat; renderer.setRenderTarget(this.rtA); this.quad.render(renderer);
    this.blurMat.uniforms.tDiffuse.value = this.rtA.texture; this.blurMat.uniforms.uStep.value = 0.55;
    this.quad.material = this.blurMat; renderer.setRenderTarget(this.rtB); this.quad.render(renderer);
    this.blurMat.uniforms.tDiffuse.value = this.rtB.texture; this.blurMat.uniforms.uStep.value = 0.16;
    renderer.setRenderTarget(this.rtA); this.quad.render(renderer);
  }
  dispose() { this.rtA.dispose(); this.rtB.dispose(); this.maskMat.dispose(); this.blurMat.dispose(); this.quad.dispose(); }
}
