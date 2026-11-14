// FSR 1 upscaling (AMD FidelityFX Super Resolution 1.0: EASU edge-adaptive upsampling + RCAS sharpening), as the
// last pass of the post chain. The scene and every post pass run at the dynamic-resolution size (DynRes.scale); this
// pass turns that image into the canvas's full size, keeping edges (rigging, coastlines, sails) sharp where a plain
// stretch blurs them.
// API: const fsr = new FsrPass(); fsr.setSize(w, h) (input size); fsr.setOutput(w, h) (canvas drawing-buffer size);
//      fsr.render(renderer, inputTexture) draws to the screen (PostFX runs it only while fsr.enabled);
//      fsr.easu / fsr.rcas (programs to precompile, see PostFX.warm); fsr.sharpness (stops, 0 = max, default 0.35).
// Steps: EASU reads the 12 texels around each output pixel (texelFetch, no filtering), finds the local edge direction
//   and length from their luma, and blends them with a Lanczos-like kernel stretched along the edge, clamped to the
//   min/max of the 4 nearest texels (no ringing) -> an RGBA8 target at output size; RCAS then sharpens it with a
//   5-tap cross whose strength is limited per pixel so it never clips -> screen.
// Input is the anti-aliased, tone-mapped, sRGB-encoded image (FSR 1 expects perceptual space, after AA).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const vert = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

const easuFrag = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uIn, uOut;   // input / output sizes in pixels
ivec2 gMax;
vec3 tap( ivec2 p ) { return clamp( texelFetch( tDiffuse, clamp( p, ivec2( 0 ), gMax ), 0 ).rgb, 0.0, 1.0 ); }
float luma( vec3 c ) { return c.g + 0.5 * ( c.r + c.b ); }

void setF( inout vec2 dir, inout float len, float w, float lA, float lB, float lC, float lD, float lE ) {
  float lenX = max( abs( lD - lC ), abs( lC - lB ) );
  float dirX = lD - lB;
  dir.x += dirX * w;
  lenX = clamp( abs( dirX ) / max( lenX, 1e-5 ), 0.0, 1.0 ); lenX *= lenX;
  len += lenX * w;
  float lenY = max( abs( lE - lC ), abs( lC - lA ) );
  float dirY = lE - lA;
  dir.y += dirY * w;
  lenY = clamp( abs( dirY ) / max( lenY, 1e-5 ), 0.0, 1.0 ); lenY *= lenY;
  len += lenY * w;
}

void tapF( inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len, float lob, float clp, vec3 c ) {
  vec2 v = vec2( dot( off, dir ), dot( off, vec2( -dir.y, dir.x ) ) ) * len;
  float d2 = min( dot( v, v ), clp );
  float wB = 0.4 * d2 - 1.0, wA = lob * d2 - 1.0;
  wB *= wB; wA *= wA;
  wB = 1.5625 * wB - 0.5625;
  float w = wB * wA;
  aW += w; aC += w * c;
}

void main() {
  gMax = ivec2( uIn ) - 1;
  // output pixel centre -> input space, in texel-centre units
  vec2 pp = gl_FragCoord.xy * ( uIn / uOut ) - 0.5;
  vec2 fp = floor( pp ); pp -= fp;
  ivec2 o = ivec2( fp );
  //    b c
  //  e f g h
  //  i j k l
  //    n o
  vec3 bC = tap( o + ivec2( 0, -1 ) ), cC = tap( o + ivec2( 1, -1 ) );
  vec3 eC = tap( o + ivec2( -1, 0 ) ), fC = tap( o ), gC = tap( o + ivec2( 1, 0 ) ), hC = tap( o + ivec2( 2, 0 ) );
  vec3 iC = tap( o + ivec2( -1, 1 ) ), jC = tap( o + ivec2( 0, 1 ) ), kC = tap( o + ivec2( 1, 1 ) ), lC = tap( o + ivec2( 2, 1 ) );
  vec3 nC = tap( o + ivec2( 0, 2 ) ), oC = tap( o + ivec2( 1, 2 ) );
  float bL = luma( bC ), cL = luma( cC ), eL = luma( eC ), fL = luma( fC ), gL = luma( gC ), hL = luma( hC );
  float iL = luma( iC ), jL = luma( jC ), kL = luma( kC ), lL = luma( lC ), nL = luma( nC ), oL = luma( oC );
  vec2 dir = vec2( 0.0 ); float len = 0.0;
  setF( dir, len, ( 1.0 - pp.x ) * ( 1.0 - pp.y ), bL, eL, fL, gL, jL );
  setF( dir, len, pp.x * ( 1.0 - pp.y ), cL, fL, gL, hL, kL );
  setF( dir, len, ( 1.0 - pp.x ) * pp.y, fL, iL, jL, kL, nL );
  setF( dir, len, pp.x * pp.y, gL, jL, kL, lL, oL );
  vec2 dir2 = dir * dir;
  float dirR = dir2.x + dir2.y;
  bool zro = dirR < ( 1.0 / 32768.0 );
  dirR = zro ? 1.0 : inversesqrt( dirR );
  dir.x = zro ? 1.0 : dir.x;
  dir *= dirR;
  len = len * 0.5; len *= len;
  float stretch = dot( dir, dir ) / max( abs( dir.x ), abs( dir.y ) );
  vec2 len2 = vec2( 1.0 + ( stretch - 1.0 ) * len, 1.0 - 0.5 * len );
  float lob = 0.5 - 0.29 * len;
  float clp = 1.0 / lob;
  vec3 mn4 = min( min( fC, gC ), min( jC, kC ) );
  vec3 mx4 = max( max( fC, gC ), max( jC, kC ) );
  vec3 aC = vec3( 0.0 ); float aW = 0.0;
  tapF( aC, aW, vec2( 0.0, -1.0 ) - pp, dir, len2, lob, clp, bC );
  tapF( aC, aW, vec2( 1.0, -1.0 ) - pp, dir, len2, lob, clp, cC );
  tapF( aC, aW, vec2( -1.0, 1.0 ) - pp, dir, len2, lob, clp, iC );
  tapF( aC, aW, vec2( 0.0, 1.0 ) - pp, dir, len2, lob, clp, jC );
  tapF( aC, aW, vec2( 0.0, 0.0 ) - pp, dir, len2, lob, clp, fC );
  tapF( aC, aW, vec2( -1.0, 0.0 ) - pp, dir, len2, lob, clp, eC );
  tapF( aC, aW, vec2( 1.0, 1.0 ) - pp, dir, len2, lob, clp, kC );
  tapF( aC, aW, vec2( 2.0, 1.0 ) - pp, dir, len2, lob, clp, lC );
  tapF( aC, aW, vec2( 2.0, 0.0 ) - pp, dir, len2, lob, clp, hC );
  tapF( aC, aW, vec2( 1.0, 0.0 ) - pp, dir, len2, lob, clp, gC );
  tapF( aC, aW, vec2( 1.0, 2.0 ) - pp, dir, len2, lob, clp, oC );
  tapF( aC, aW, vec2( 0.0, 2.0 ) - pp, dir, len2, lob, clp, nC );
  vec3 c = aW > 1e-5 ? aC / aW : fC;
  gl_FragColor = vec4( min( mx4, max( mn4, c ) ), 1.0 );
}`;

const rcasFrag = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform float uSharp;     // exp2(-sharpness)
ivec2 gMax;
vec3 tap( ivec2 p ) { return texelFetch( tDiffuse, clamp( p, ivec2( 0 ), gMax ), 0 ).rgb; }
void main() {
  gMax = textureSize( tDiffuse, 0 ) - 1;
  ivec2 p = ivec2( gl_FragCoord.xy );
  vec3 b = tap( p + ivec2( 0, -1 ) ), d = tap( p + ivec2( -1, 0 ) ), e = tap( p ), f = tap( p + ivec2( 1, 0 ) ), h = tap( p + ivec2( 0, 1 ) );
  vec3 mn4 = min( min( b, d ), min( f, h ) ), mx4 = max( max( b, d ), max( f, h ) );
  // largest negative lobe that neither clips to black nor to white
  vec3 hitMin = min( mn4, e ) / max( 4.0 * mx4, vec3( 1e-4 ) );
  vec3 hitMax = ( 1.0 - max( mx4, e ) ) / min( 4.0 * min( mn4, e ) - 4.0, vec3( -1e-4 ) );
  vec3 lobeRGB = max( -hitMin, hitMax );
  float lobe = max( -( 0.25 - 1.0 / 16.0 ), min( max( lobeRGB.r, max( lobeRGB.g, lobeRGB.b ) ), 0.0 ) ) * uSharp;
  gl_FragColor = vec4( ( lobe * ( b + d + f + h ) + e ) / ( 4.0 * lobe + 1.0 ), 1.0 );
}`;

export class FsrPass {
  constructor({ sharpness = 0.35 } = {}) {
    this.enabled = true;
    this.sharpness = sharpness;
    this.easu = new THREE.ShaderMaterial({ name: 'FsrEasu', vertexShader: vert, fragmentShader: easuFrag,
      uniforms: { tDiffuse: { value: null }, uIn: { value: new THREE.Vector2(1, 1) }, uOut: { value: new THREE.Vector2(1, 1) } }, depthTest: false, depthWrite: false });
    this.rcas = new THREE.ShaderMaterial({ name: 'FsrRcas', vertexShader: vert, fragmentShader: rcasFrag,
      uniforms: { tDiffuse: { value: null }, uSharp: { value: 1 } }, depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.easu);
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    this._in = new THREE.Vector2(1, 1);
  }

  setSize(w, h) { this._in.set(w, h); }

  setOutput(w, h) {
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    this.easu.uniforms.uOut.value.set(w, h);
  }

  render(renderer, inputTexture) {
    const eu = this.easu.uniforms;
    eu.tDiffuse.value = inputTexture;
    eu.uIn.value.copy(this._in);
    renderer.setRenderTarget(this.target);
    this.quad.material = this.easu; this.quad.render(renderer);
    this.rcas.uniforms.tDiffuse.value = this.target.texture;
    this.rcas.uniforms.uSharp.value = Math.pow(2, -this.sharpness);
    renderer.setRenderTarget(null);
    this.quad.material = this.rcas; this.quad.render(renderer);
  }

  dispose() { this.easu.dispose(); this.rcas.dispose(); this.target.dispose(); this.quad.dispose(); }
}
