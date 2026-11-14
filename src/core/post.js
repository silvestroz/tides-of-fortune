// Post-processing pipeline. API: new PostFX(game); render(dt); resize(); warm().
// Chain (explicit, no EffectComposer; every full-screen draw at the render size is listed):
//   scene -> HDR target (linear, half float, MSAA, the only target with a depth buffer)
//   Ultra only: GTAOPass at half resolution, scene x AO -> second HDR target (half float)
//   GodRaysPass: sun-shaft texture at 1/4 size (1/2.5 in ultra), only when the sun is in view
//   BloomPass: thresholded bloom texture at half size (only sun, glitter, lanterns, muzzle flashes, lightning glow)
//   GradePass: scene + shafts + bloom, ACES + exposure + sRGB, grade (lift/gamma/gain, sat, split tone, canvas,
//     vignette, grain) in ONE draw -> display target (the picture is display-referred from here on)
//   FXAA (SMAA in ultra) -> screen
//   while the dynamic resolution renders below the canvas size (see setRenderSize): FXAA/SMAA -> a second display
//     target, then FsrPass (FSR 1 upscale to the canvas size + sharpening) -> screen.
// Only the scene target is multisampled and has a depth buffer: a full-screen draw into an MSAA target pays the
// samples and a resolve for nothing. The display targets stay half float: anti-aliasing and FSR take edge decisions
// on thresholds, and rounding their input to 8 bits moves some of them (?ldr=8 makes these targets 8-bit, to
// measure what the format costs).
// Extended API:
//   post.enabled (bool; false = plain renderer.render)   post.grade (GradePass; .uniforms)
//   post.bloom (BloomPass), post.godRays (GodRaysPass), post.aa (FXAAPass | SMAAPass): each has .enabled
//   post.setQuality('low'|'medium'|'high')   ?post=0 disables, ?quality=low forces low.
//   post.setRenderSize(w, h | null)  size of the scene and every pass (DynRes); null = the canvas drawing buffer.
//     Smaller than the canvas -> the FSR pass upsamples to the canvas (post.fsr.enabled). ?fsr=0 keeps the old path.
//   post.warm()  compiles every program of the chain, each for the kind of target it draws to (game.warmup).
// Follows game.settings.quality when present ('settings:change' event).
// The sea scene's layered aerial perspective (ATMOS.params.w, see world/sky/atmosphere.js) is switched on only around
// this chain's render: port, duel and land scenes (game.renderOverride) keep plain fog.
import * as THREE from 'three';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { QUALITY } from './constants.js';
import { GodRaysPass } from '../post/godRaysPass.js';
import { BloomPass } from '../post/bloomPass.js';
import { GradePass } from '../post/gradePass.js';
import { FsrPass } from '../post/fsrPass.js';
import { ATMOS } from '../world/sky/atmosphere.js';

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
    // Its depth is used while the scene is drawn and never read afterwards: neither resolved nor stored.
    const lowQ = (game.quality || game.params.get('quality') || game.settings?.quality) === 'low';
    this.sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: lowQ ? 0 : this._msaa(game.quality),
      resolveDepthBuffer: false, storeMultisampledDepthBuffer: false });
    // display-referred targets: the graded image, and the anti-aliased one handed to FSR (sized only while FSR is on)
    const ldr = { type: game.params.get('ldr') === '8' ? THREE.UnsignedByteType : THREE.HalfFloatType, depthBuffer: false };
    this.ldrRT = new THREE.WebGLRenderTarget(size.x, size.y, ldr);
    this.aaRT = new THREE.WebGLRenderTarget(1, 1, ldr);
    // ultra: sharper sun shafts (smaller divisor = more texels in the 1/div-res mask/blur target)
    this.godRays = new GodRaysPass({ div: QUALITY.godRayDiv || 4 });
    this.bloom = new BloomPass(new THREE.Vector2(size.x, size.y), 0.4, 0.32, 1.4);
    this.grade = new GradePass();
    // ultra: ground-truth AO right after the scene pass (ships, quays, trunks, rocks anchored), SMAA
    // instead of FXAA. Built only in ultra; switching tier in Options applies after reload like the other systems.
    this.ao = null; this.aoRT = null;
    if (QUALITY.ao) {
      this.ao = this._makeAO(game, size);
      this.aoRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthBuffer: false });
    }
    this.aa = QUALITY.smaa ? new SMAAPass() : new FXAAPass();
    this._aaMaterials = QUALITY.smaa ? [this.aa._materialEdges, this.aa._materialWeights, this.aa._materialBlend] : [this.aa.material];
    this.fsr = new FsrPass(); this.fsr.enabled = false;
    this._renderSize = null;
    this.time = 0;
    this.quality = 'high';
    const q = game.quality || game.params.get('quality') || game.settings?.quality;
    if (q) this.setQuality(q);
    game.events?.on?.('settings:change', ({ settings }) => settings?.quality && this.setQuality(settings.quality));
    this.resize();
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
    if (this.sceneRT.samples !== ns) { this.sceneRT.samples = ns; this.sceneRT.dispose(); }
    this.godRays.enabled = q !== 'low';
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
    // shadows: teal by day, violet at golden hour (a teal split against the warm haze turned shaded cloud bellies olive)
    gu.uSplitShadow.value.setRGB(0.2 + golden * 0.18 - storm * 0.02, 0.42 - golden * 0.12 + storm * 0.05, 0.62 + golden * 0.04);
    // low sun: slightly deeper mid-tones so the warm haze doesn't flatten the frame
    gu.uGamma.value.setScalar(this.game.mode === 'duel' ? 1 : 1 - golden * 0.07 * (1 - storm));
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
    // low sun: distinct shafts, but a threshold high enough that sunlit canvas and the sea glare don't feed them
    // (a lower one veiled the whole frame and washed the back-lit ships out of their silhouettes)
    const lowBoost = 0.25 + 0.6 * golden;
    this.godRays.strength = onScreen * (sky.sunVisibility ?? 1) * lowBoost * 2.2 * (duel ? 0.3 : 1);
    this.godRays.threshold = 0.65 + (1 - golden) * 0.4;
    // layered haze on distant land: full by day, lighter at night and in a storm (already grey and close)
    this._layerHaze = duel ? 0 : 1.0 * (1 - night * 0.5) * (1 - storm * 0.5);
    this.godRays.tint.copy(sky.sunColor);
  }

  render(dt) {
    const g = this.game, r = g.renderer;
    if (!this.enabled) { r.render(g.scene, g.camera); return; }
    this._updateParams(dt);
    const rt0 = r.getRenderTarget();
    ATMOS.params.w = this._layerHaze || 0;
    r.setRenderTarget(this.sceneRT);
    r.render(g.scene, g.camera);
    let hdr = this.sceneRT;
    if (this.ao) {
      const c = g.camera.position;
      this._aoBox.min.set(c.x - 450, -1.5, c.z - 450); this._aoBox.max.set(c.x + 450, 160, c.z + 450);
      this.ao.setSceneClipBox(this._aoBox);
      // menus/duel/mini-games keep AO too (port and duel scenes gain the most); off when the post chain is disabled
      this.ao.render(r, this.aoRT, this.sceneRT);
      hdr = this.aoRT;
    }
    ATMOS.params.w = 0;
    const rays = this.godRays, bloom = this.bloom, aa = this.aa, up = this.fsr.enabled;
    rays.render(r, hdr.texture);
    if (bloom.enabled) bloom.render(r, hdr.texture, rays.texture, rays.gain);
    // the last stage that is switched on draws to the screen
    this.grade.render(r, aa.enabled ? this.ldrRT : up ? this.aaRT : null, hdr.texture, rays.texture, rays.gain, bloom.enabled ? bloom.texture : null);
    if (aa.enabled) { aa.renderToScreen = !up; aa.render(r, this.aaRT, this.ldrRT); }
    if (up) this.fsr.render(r, this.aaRT.texture);
    r.setRenderTarget(rt0);
  }

  // Compiles every program of the chain without drawing. A program is keyed on the output it is built for: the
  // ones that end on the screen are compiled for the screen, and the anti-aliasing pass for both of its outputs
  // (screen, or the target FSR reads), so the first drop of the dynamic resolution builds nothing.
  warm() {
    const r = this.game.renderer, rt0 = r.getRenderTarget();
    const mesh = this._warmMesh ||= new THREE.Mesh(new THREE.BufferGeometry()
      .setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3))
      .setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2)));
    mesh.frustumCulled = false;
    const cam = this._warmCam ||= new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const compile = (materials, target) => {
      r.setRenderTarget(target);
      for (const m of materials) { mesh.material = m; r.compile(mesh, cam); }
    };
    const aa = this._aaMaterials, last = aa[aa.length - 1];
    compile([...this.godRays.materials, ...this.bloom.materials, this.grade.material, ...aa, this.fsr.easu], this.aaRT);
    compile([last, this.fsr.rcas], null);
    r.setRenderTarget(rt0);
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
    if (up) { this.fsr.setOutput(b.x, b.y); this.aaRT.setSize(w, h); }
    this.sceneRT.setSize(w, h);
    this.ldrRT.setSize(w, h);
    this.aoRT?.setSize(w, h);
    for (const p of [this.ao, this.godRays, this.bloom, this.aa, this.fsr]) p?.setSize(w, h);
    this.grade.uniforms.uRes.value.set(w, h);
  }
}
