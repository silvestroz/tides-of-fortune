// Optional GLB captain for the duel: src/assets/models/tides_captain_rigged.glb (52-joint mixamorig skeleton,
// `weapon_sabre` on the right hand, 10 clips). A drop-in for CaptainFigure + FencerAnimator in DuelSystem:
//   wantGLBCaptain(game)          true for ?captain=glb or game.settings.duelModel === 'glb' (default: procedural)
//   loadCaptainAsset() -> Promise  parse once (GLTFLoader) + analyse clips (contact / parry-hold times)
//   captainAsset()                 the loaded asset or null
//   new GlbCaptain(asset, { coat, height, lefty, seed })
//     .group (feet y=0, faces +Z like CaptainFigure)  .hilt/.mid/.tip (on the GLB sabre)  .j.chest  .flash(k)
//     .anim  { fromFighter(f, dt, extra), swingK }   sim state -> AnimationMixer clips with crossfades
// Materials are cloned per captain and restyled toward the procedural cast: scene env, shadows, a warm fresnel rim
// and a slight warm grade; `coat` recolours the woven coat texture (luminance-preserving) for the enemy's faction.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
// The .glb is imported lazily (only when the toggle is on). In the published single-file build
// (__NO_GLB_CAPTAIN__ defined true by vite.config.js) the toggle is disabled and the asset is not bundled at all.
const NO_GLB = typeof __NO_GLB_CAPTAIN__ !== 'undefined' && __NO_GLB_CAPTAIN__;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function wantGLBCaptain(game) {
  if (NO_GLB) return false;
  const q = game?.params?.get?.('captain');
  if (q) return q === 'glb';
  return game?.settings?.duelModel === 'glb';
}

let _promise = null, _asset = null;
export function captainAsset() { return _asset; }
export function loadCaptainAsset() {
  if (NO_GLB) return Promise.resolve(null);
  if (!_promise) _promise = (NO_GLB ? Promise.resolve({ default: '' }) : import('../../assets/models/tides_captain_rigged.glb?url')).then(m => new GLTFLoader().loadAsync(m.default)).then(gltf => (_asset = analyse(gltf)));
  return _promise;
}

const findSabre = root => { let s = null; root.traverse(o => { if (!s && (o.name === 'weapon_sabre' || o.userData?.name === 'weapon_sabre')) s = o; }); return s; };
const findBone = (root, n) => { let b = null; root.traverse(o => { if (!b && o.isBone && (o.name === 'mixamorig' + n || o.name === 'mixamorig:' + n || o.userData?.name === 'mixamorig:' + n)) b = o; }); return b; };

// blade geometry -> tip / guard positions in the weapon_sabre frame; clip timing from the sampled tip path
function analyse(gltf) {
  const scene = gltf.scene, clips = {};
  for (const c of gltf.animations) clips[c.name] = c;
  const sabre = findSabre(scene);
  let blade = null, guard = null;
  sabre?.traverse(o => { if (o.isMesh && /blade/.test(o.name)) blade = o; if (o.isMesh && /guard/.test(o.name)) guard = o; });
  const tipLocal = new THREE.Vector3(0, 0.8, 0), hiltLocal = new THREE.Vector3();
  if (blade) {
    blade.geometry.computeBoundingBox();
    const bb = blade.geometry.boundingBox, c = bb.getCenter(new THREE.Vector3());
    let best = 0, ax = 1, sgn = 1;
    for (let i = 0; i < 3; i++) for (const s of [1, -1]) { const e = s > 0 ? bb.max.getComponent(i) : -bb.min.getComponent(i); if (e > best) { best = e; ax = i; sgn = s; } }
    tipLocal.copy(c).setComponent(ax, sgn > 0 ? bb.max.getComponent(ax) : bb.min.getComponent(ax)).applyMatrix4(blade.matrix);
  }
  if (guard) { guard.geometry.computeBoundingBox(); guard.geometry.boundingBox.getCenter(hiltLocal).applyMatrix4(guard.matrix); }
  // sample each clip on a scratch clone: tip speed per frame
  const probe = skeletonClone(scene), mixer = new THREE.AnimationMixer(probe), ps = findSabre(probe);
  const tipObj = new THREE.Object3D(); tipObj.position.copy(tipLocal); ps?.add(tipObj);
  const timing = {};
  for (const [name, clip] of Object.entries(clips)) {
    const a = mixer.clipAction(clip); a.play();
    const N = 48, dur = clip.duration, speed = [], pts = [];
    for (let i = 0; i <= N; i++) { a.time = dur * i / N; mixer.update(0); probe.updateMatrixWorld(true); pts.push(tipObj.getWorldPosition(new THREE.Vector3())); }
    for (let i = 1; i <= N; i++) speed.push(pts[i].distanceTo(pts[i - 1]) / (dur / N));
    let iMax = 0; speed.forEach((s, i) => { if (s > speed[iMax]) iMax = i; });
    // the held part of the parry: the slowest frame in the middle of the clip
    let iHold = Math.floor(N * 0.4); for (let i = Math.floor(N * 0.2); i < Math.floor(N * 0.7); i++) if (speed[i] < speed[iHold]) iHold = i;
    timing[name] = { dur, contact: dur * (iMax + 0.5) / N, hold: dur * (iHold + 0.5) / N, peakSpeed: speed[iMax] };
    a.stop();
  }
  mixer.uncacheRoot(probe);
  return { scene, clips, tipLocal, hiltLocal, timing };
}

// ---------------------------------------------------------------- materials
const _coatTex = new Map();
function recolourCoat(tex, hex) {
  const key = tex.uuid + hex;
  if (_coatTex.has(key)) return _coatTex.get(key);
  const img = tex.image, w = img.width, h = img.height;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, w, h), px = d.data;
  let mean = 0; for (let i = 0; i < px.length; i += 4) mean += px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
  mean /= px.length / 4;
  const c = new THREE.Color(hex);   // sRGB target, weave luminance modulates it
  const t = [c.r * 255, c.g * 255, c.b * 255];
  for (let i = 0; i < px.length; i += 4) {
    const l = (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) / mean;
    px[i] = clamp(t[0] * l, 0, 255); px[i + 1] = clamp(t[1] * l, 0, 255); px[i + 2] = clamp(t[2] * l, 0, 255);
  }
  cx.putImageData(d, 0, 0);
  const out = new THREE.CanvasTexture(cv);
  out.colorSpace = THREE.SRGBColorSpace; out.flipY = tex.flipY; out.wrapS = tex.wrapS; out.wrapT = tex.wrapT;
  out.channel = tex.channel; out.anisotropy = 4;
  _coatTex.set(key, out);
  return out;
}

const RIM = new THREE.Color(1.0, 0.72, 0.42);
function restyle(m) {
  m.envMapIntensity = 0.85;
  if (!m.map) m.color.multiply(new THREE.Color(1.06, 1.0, 0.93));   // warm grade (flat-colour parts)
  m.userData.rim = { value: RIM.clone().multiplyScalar(/steel|gold/i.test(m.name) ? 0.08 : 0.22) };
  m.onBeforeCompile = sh => {
    sh.uniforms.uRim = m.userData.rim;
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform vec3 uRim;\nvoid main() {')
      .replace('#include <opaque_fragment>', `{ float rimF = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
  outgoingLight += uRim * rimF * (0.35 + 0.65 * diffuseColor.rgb); }
#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'glbCaptainRim';
}

// ---------------------------------------------------------------- the captain
export class GlbCaptain {
  constructor(asset, o = {}) {
    this.asset = asset;
    const g = this.group = new THREE.Group(); g.name = 'glbCaptain';
    const inner = this.inner = new THREE.Group();
    const s = o.height || 1;
    inner.rotation.y = Math.PI;                       // GLB front -Z -> figure front +Z
    inner.scale.set(o.lefty ? -s : s, s, s);          // mirrored lefty keeps both blades toward the camera
    g.add(inner);
    const model = this.model = skeletonClone(asset.scene);
    inner.add(model);
    const mats = new Map(); this._mats = [];
    model.traverse(c => {
      if (!c.isMesh) return;
      c.castShadow = true; c.receiveShadow = true; c.frustumCulled = false;
      const src = c.material;
      if (!mats.has(src)) {
        const m = src.clone(); restyle(m);
        if (o.coat && /coat/i.test(m.name) && m.map) m.map = recolourCoat(m.map, o.coat);
        else if (o.coat && /coat/i.test(m.name)) m.color.set(o.coat);
        mats.set(src, m); this._mats.push(m);
      }
      c.material = mats.get(src);
    });
    const sabre = findSabre(model);
    const mk = p => { const ob = new THREE.Object3D(); ob.position.copy(p); (sabre || model).add(ob); return ob; };
    this.hilt = mk(asset.hiltLocal);
    this.tip = mk(asset.tipLocal);
    this.mid = mk(asset.hiltLocal.clone().lerp(asset.tipLocal, 0.6));
    this.j = { chest: findBone(model, 'Spine2') || model, head: findBone(model, 'Head') || model };
    this._flashK = 0;
    this.anim = new GlbAnimator(this);
  }
  flash(k) {
    if (Math.abs(k - this._flashK) < 0.01) return;
    this._flashK = k;
    for (const m of this._mats) m.emissive?.setRGB(k * 0.9, k * 0.3, k * 0.18);
  }
}

// sim Fighter -> clip + clip time. Combat timing is driven by the sim: clips are scrubbed (timeScale 0) so the
// contact frame of each attack clip lands exactly on the sim's strike instant; only the guard idle free-runs.
const ATTACK = { high: 'Attack_High', mid: 'Attack_High', low: 'Attack_Low' };
export class GlbAnimator {
  constructor(cap) {
    this.cap = cap;
    this.mixer = new THREE.AnimationMixer(cap.model);
    this.actions = {};
    for (const [n, clip] of Object.entries(cap.asset.clips)) { const a = this.mixer.clipAction(clip); a.setLoop(THREE.LoopRepeat, Infinity); this.actions[n] = a; }
    this.cur = null; this.swingK = 0;
    this._play('Idle_Guard', 0, true);
  }
  _play(name, fade, free = false) {
    const a = this.actions[name] || this.actions.Idle_Guard;
    a.setEffectiveTimeScale(free ? 1 : 0);
    if (this.cur === a) return a;
    a.reset(); a.setEffectiveTimeScale(free ? 1 : 0); a.setEffectiveWeight(1); a.play();
    if (this.cur && fade > 0) a.crossFadeFrom(this.cur, fade, false);
    else if (this.cur) this.cur.stop();
    this.cur = a; this.curName = name;
    return a;
  }
  _scrub(name, t, fade) {
    const a = this._play(name, fade);
    const d = a.getClip().duration;
    a.time = clamp(t, 0, d - 1e-3);
  }
  fromFighter(f, dt, extra = {}) {
    const T = this.cap.asset.timing;
    const k = f.dur > 0 ? clamp(f.t / f.dur, 0, 1) : 0;
    this.swingK = 0;
    switch (f.state) {
      case 'windup': case 'strike': case 'recover': {
        const name = f.momentum && f.height === 'mid' ? 'Attack_Thrust' : ATTACK[f.height] || 'Attack_High';
        const tm = T[name], s0 = Math.max(0.05, tm.contact - 0.07), s1 = Math.min(tm.dur - 0.02, tm.contact + 0.05);
        const t = f.state === 'windup' ? s0 * k : f.state === 'strike' ? s0 + (s1 - s0) * k : s1 + (tm.dur - s1) * k;
        this.swingK = f.state === 'strike' ? 1 : f.state === 'recover' ? 1 - k : k > 0.8 ? (k - 0.8) * 2 : 0;
        this._scrub(name, t, 0.1);
        break;
      }
      case 'parry': {
        const tm = T.Parry;
        this._scrub('Parry', Math.min(tm.hold, (f.parryAge || 0) * tm.hold / 0.1), 0.08);
        break;
      }
      case 'hit': case 'stagger': this._scrub('Hit_Reaction', k * T.Hit_Reaction.dur, 0.06); break;
      case 'step': {
        const n = f.stepDir > 0 ? 'Step_Forward' : 'Step_Back';
        this._scrub(n, k * T[n].dur * 0.5, 0.08);
        break;
      }
      case 'taunt': this._scrub('Taunt', k * T.Taunt.dur, 0.15); break;
      case 'down':
        if (!extra.result || extra.result.reason === 'wounds') this._scrub('Death', f.t, 0.12);
        else this._scrub('Hit_Reaction', Math.min(f.t, T.Hit_Reaction.contact + 0.15), 0.12);   // yields on his feet
        break;
      default: this._play('Idle_Guard', 0.18, true);
    }
    this.mixer.update(dt);
    this.cap.model.updateMatrixWorld(true);
  }
}
