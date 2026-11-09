// Post-processing pipeline. API: new PostFX(game); render(dt); resize(w,h).
// Chain (EffectComposer, HalfFloat HDR buffers):
//   RenderPass (linear HDR) → GTAOPass (Ultra only, at half resolution) → GodRaysPass (sun shafts, 1/4 res (1/2.5 in ultra), only when the sun is in view)
//   → UnrealBloomPass (thresholded: only sun, glitter, lanterns, muzzle flashes, lightning glow)
//   → OutputPass (ACES + exposure + sRGB) → GradePass (lift/gamma/gain, sat, split tone, canvas, vignette, grain)
//   → FXAA → FsrPass (FSR 1 upscale to the canvas size + sharpening, to screen; only while the dynamic resolution renders
//   below the canvas size, see setRenderSize).
// Extended API:
//   post.enabled (bool; false = plain renderer.render)   post.bloom (UnrealBloomPass)   post.grade (ShaderPass; .uniforms)
//   post.godRays (GodRaysPass)   post.setQuality('low'|'medium'|'high')   ?post=0 disables, ?quality=low forces low.
//   post.setRenderSize(w, h | null)  size of the scene and every pass (DynRes); null = the canvas drawing buffer.
//     Smaller than the canvas -> the FSR pass upsamples to the canvas (post.fsr.enabled). ?fsr=0 keeps the old path.
// Follows game.settings.quality when present ('settings:change' event).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { QUALITY } from './constants.js';
import { GodRaysPass } from '../post/godRaysPass.js';
import { createGradePass } from '../post/gradePass.js';
import { FsrPass } from '../post/fsrPass.js';

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export class PostFX {
  constructor(game) {
    this.game = game;
    const r = game.renderer;
    this.enabled = game.params.get('post') !== '0';
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    // 4x MSAA on the HDR scene buffer: thin rigging / ratlines resolve to soft lines instead of dotted noise
    // (FXAA alone cannot reconstruct sub-pixel geometry). ?quality=low drops to 0 samples.
    const lowQ = (game.quality || game.params.get('quality') || game.settings?.quality) === 'low';
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: lowQ ? 0 : this._msaa(game.quality) });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(game.scene, game.camera);
    // ultra: sharper sun shafts (smaller divisor = more texels in the 1/div-res mask/blur target)
    this.godRays = new GodRaysPass({ div: QUALITY.godRayDiv || 4 });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.4, 0.32, 1.4);
    // a single NaN/Inf pixel in the HDR scene (degenerate normal, 0/0 in a particle or wave term) was blurred by the
    // bloom mip chain over the whole frame and composited back as NaN: an all-black 3D view (seen intermittently in the
    // combat showcases). Sanitise and clamp what enters the bloom.
    { const hp = this.bloom.materialHighPassFilter;
      hp.fragmentShader = hp.fragmentShader.replace('vec4 texel = texture2D( tDiffuse, vUv );',
        'vec4 texel = texture2D( tDiffuse, vUv );\n\t\t\tif ( any( isnan( texel ) ) || any( isinf( texel ) ) ) texel = vec4( 0.0 );\n\t\t\ttexel = min( texel, vec4( 64.0 ) );');
      hp.needsUpdate = true; }
    this.output = new OutputPass();
    this.grade = createGradePass();
    this.fxaa = new FXAAPass();
    // ultra: ground-truth AO right after the scene pass (ships, quays, trunks, rocks anchored), SMAA
    // instead of FXAA. Built only in ultra; switching tier in Options applies after reload like the other systems.
    this.ao = null; this.smaa = null;
    if (QUALITY.ao) this.ao = this._makeAO(game, size);
    if (QUALITY.smaa) this.smaa = new SMAAPass();
    this.fsr = new FsrPass(); this.fsr.enabled = false;
    this._renderSize = null;
    const passes = [this.renderPass, this.ao, this.godRays, this.bloom, this.output, this.grade, this.smaa || this.fxaa, this.fsr].filter(Boolean);
    for (const p of passes) this.composer.addPass(p);
    this.time = 0;
    this.quality = 'high';
    const q = game.quality || game.params.get('quality') || game.settings?.quality;
    if (q) this.setQuality(q);
    game.events?.on?.('settings:change', ({ settings }) => settings?.quality && this.setQuality(settings.quality));
    this.resize(innerWidth, innerHeight);
  }

  // scene MSAA samples per tier: 0 low, 8 ultra (if the GPU allows it), 4 otherwise
  _msaa(q) {
    if (q === 'low') return 0;
    if (q !== 'ultra') return 4;
    const max = this.game.renderer.capabilities.maxSamples || 4;
    return Math.min(QUALITY.msaa || 4, max);
  }

  _makeAO(game, size) {
    const ao = new GTAOPass(game.scene, game.camera, size.x, size.y);
    ao.output = GTAOPass.OUTPUT.Default;
    ao.blendIntensity = 0.85;
    ao.updateGtaoMaterial({ radius: 2.2, distanceExponent: 1.4, thickness: 2.5, scale: 1.1, samples: 12, distanceFallOff: 0.6, screenSpaceRadius: false });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 12 });
    // the normal/depth pre-pass draws every mesh with MeshNormalMaterial: hide what it cannot represent (custom
    // ShaderMaterials such as ocean, sky, clouds, particles, smoke; alpha-tested leaf cards that would print as
    // solid quads; transparent meshes)
    const cache = ao._visibilityCache;
    ao._overrideVisibility = function () {
      this.scene.traverseVisible(o => {
        if (!o.visible) return;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (o.isPoints || o.isLine || o.isLine2 || o.isSprite || (m && (m.isShaderMaterial || m.transparent || m.alphaTest > 0 || m.alphaMap || m.userData?.noAO))) {
          o.visible = false; cache.push(o);
        }
      });
    };
    // half resolution: the normal/depth pre-pass, the AO and its denoise run at 1/2 x 1/2 (a quarter of the pixels);
    // the soft result is stretched back when blended over the full-size scene (?aohalf=0 = full size)
    const half = game.params.get('aohalf') !== '0', setSize = ao.setSize.bind(ao);
    ao.setSize = (w, h) => setSize(half ? Math.max(1, Math.round(w / 2)) : w, half ? Math.max(1, Math.round(h / 2)) : h);
    ao.setSize(size.x, size.y);
    // AO only inside a box around the camera (no work or haze on the far sea and sky)
    this._aoBox = new THREE.Box3();
    ao.setSceneClipBox(this._aoBox);
    return ao;
  }

  setQuality(q) {
    this.quality = q;
    const ns = this._msaa(q);
    for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) if (t.samples !== ns) { t.samples = ns; t.dispose(); }
    this.godRays.enabled = q !== 'low';
    this.bloom.enabled = true;
    this.fxaa.enabled = true;
  }

  _updateParams(dt) {
    const g = this.game, sky = g.sky, cam = g.camera;
    this.time += dt;
    const gu = this.grade.uniforms;
    gu.uTime.value = this.time;
    if (!sky) return;
    const el = sky.sunElevation ?? 30, storm = sky.storm || 0;
    const golden = Math.exp(-Math.pow((el - 4) / 12, 2));
    const night = THREE.MathUtils.smoothstep(-el, 2, 14);
    // grade per mood
    gu.uSat.value = 1.1 + golden * 0.08 - storm * 0.28 - night * 0.08;
    gu.uSplitAmt.value = 0.1 + golden * 0.08 + storm * 0.04;
    gu.uSplitHigh.value.setRGB(1.0, 0.78 - golden * 0.06, 0.5 - golden * 0.08);
    gu.uSplitShadow.value.setRGB(0.2 - storm * 0.02, 0.42 + storm * 0.05, 0.62);
    gu.uLift.value.set(0.012, 0.02, 0.04 + night * 0.02);
    gu.uGain.value.set(1.02 + golden * 0.02, 1.0, 0.97 - golden * 0.02);
    gu.uVignette.value = 0.3 + storm * 0.12 + night * 0.08;
    gu.uGrain.value = 0.022 + night * 0.02 + storm * 0.01;
    // bloom: a bit softer/stronger at golden hour and night (lanterns, moon)
    this.bloom.strength = 0.32 + golden * 0.06 + night * 0.1;
    this.bloom.threshold = night > 0.5 ? 0.9 : 1.4;
    // duel: a close-up of faces and blades, keep it crisp (bloom at ~30 %, no god-ray haze over the fighters)
    const duel = this.game.mode === 'duel';
    if (duel) { this.bloom.strength *= 0.3; this.bloom.threshold = Math.max(this.bloom.threshold, 1.8); }
    // god rays: sun on (or slightly off) screen and visible
    _v.copy(sky.sunDir).multiplyScalar(1000).add(cam.position).project(cam);
    cam.getWorldDirection(_fwd);
    const facing = _fwd.dot(sky.sunDir);
    const sx = _v.x * 0.5 + 0.5, sy = _v.y * 0.5 + 0.5;
    const edge = Math.max(Math.abs(_v.x), Math.abs(_v.y));
    const onScreen = facing > 0 ? 1 - THREE.MathUtils.smoothstep(edge, 0.9, 1.25) : 0;
    this.godRays.sunScreen.set(sx, sy);
    const lowBoost = 0.25 + 0.8 * golden;
    this.godRays.strength = onScreen * (sky.sunVisibility ?? 1) * lowBoost * 2.6 * (duel ? 0.3 : 1);
    this.godRays.threshold = 0.45 + (1 - golden) * 0.45;
    this.godRays.tint.copy(sky.sunColor);
  }

  render(dt) {
    const g = this.game;
    if (!this.enabled) { g.renderer.render(g.scene, g.camera); return; }
    this._updateParams(dt);
    if (this.ao) {
      const c = g.camera.position;
      this._aoBox.min.set(c.x - 450, -1.5, c.z - 450); this._aoBox.max.set(c.x + 450, 160, c.z + 450);
      this.ao.setSceneClipBox(this._aoBox);
      // menus/duel/mini-games keep AO too (port and duel scenes gain the most); off when the post chain is disabled
    }
    this.composer.render(dt);
  }

  setRenderSize(w, h) { this._renderSize = w ? { w, h } : null; this.resize(); }

  resize() {
    // size every target from integers: the render size given by DynRes when it is smaller than the canvas (FSR
    // upscales the result), else the canvas's drawing-buffer size (follows DynRes pixel-ratio changes; avoids
    // fractional w * pr target sizes at scales like 0.7)
    const b = this.game.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rs = this._renderSize, up = !!rs && rs.w < b.x - 1;
    const w = up ? rs.w : b.x, h = up ? rs.h : b.y;
    this.fsr.enabled = up;
    if (up) this.fsr.setOutput(b.x, b.y);
    this.composer.setPixelRatio(1);
    this.composer.setSize(w, h);
    this.grade.uniforms.uRes.value.set(w, h);
  }
}
