// Medallions of the port's speakers painted from the game's 3D characters (CaptainFigure), instead of vector faces:
// same modelling, same clothes as the extras of the scenes.
//   portraitURL(game, role, seed, nation) -> data:image/png (three-quarter bust, transparent background) or null
//   portraitLook(role, seed, nation)      -> the role's CaptainFigure options (governor, tavern keeper, armourer…)
// Rendered once per (role, seed, nation) then cached: two passes in the game's renderer (HDR target at 4× MSAA,
// then ACES + sRGB into an 8-bit target) and one pixel readback. Without a renderer (node, tests): null, and
// PORTRAIT() keeps its vector drawing.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CaptainFigure, LOOKS, setFigureFill } from '../../game/duel/figure.js';
import { mulberry32 } from '../../core/rng.js';

const SIZE = 256;
const cache = new Map();
let R = null;

const COATS = { english: '#8e1b1b', spanish: '#2a2a3a', french: '#2e4a8a', dutch: '#3a3a3a', pirate: '#3a2a1a' };
export function portraitLook(role, seed = 1, nation = 'english') {
  const r = mulberry32((seed >>> 0) || 1), pick = a => a[Math.floor(r() * a.length)];
  const skin = pick(['#e6b994', '#cf9a74', '#b07a52', '#8a5636', '#ecc6a4']), hair = pick(['#2a1a10', '#4a2a14', '#7a5a30', '#9a948a', '#1a1410']);
  const base = { seed: (seed >>> 0) % 1e6, skin, hair, sword: false };
  switch (role) {
    case 'governor': return { ...LOOKS.governor, ...base, skin: '#e8c0a0', coat: COATS[nation] || '#4a1a3a', moustache: nation === 'spanish', expr: 'calm' };
    case 'council': return { ...LOOKS.pirate, ...base, hat: 'tricorn', hatColor: '#1e1612', expr: 'stern', beard: true };
    case 'tavern': return { ...LOOKS.tavern, ...base, vest: '#8e3a2a', beard: true, moustache: true, expr: 'smile' };
    case 'tavernw': return { ...LOOKS.woman, ...base, hair: pick(['#4a2414', '#2a1a10', '#7a5a30']), skin: pick(['#e8c0a0', '#d8a888', '#c99272']), dress: '#a8543a', bodice: '#5a2a3a', expr: 'smile' };
    case 'shipyard': return { ...base, sailor: true, sleeves: 'rolled', coat: '#e8dcc0', vest: '#4a2e18', hat: 'cap', hatColor: '#8e3a24', beard: true, moustache: true, expr: 'calm', boots: true };
    case 'bank': return { ...LOOKS.clerk, ...base, skin: '#e8c0a0', expr: 'calm' };
    case 'sailor': return { ...base, sailor: true, coat: pick(['#e9e1cc', '#d8cfb8', '#7a2a22', '#3a4d6e', '#c8b48a', '#5a6b3a']), stripes: r() < 0.3,
      vest: r() < 0.35 ? pick(['#5a3a24', '#2c3550', '#6e1414']) : null, hat: pick(['bandana', 'none', 'cap', 'tricorn', 'bandana']), bandana: pick(['#8e1b1b', '#2a3a58', '#c8b48a', '#3a3028']),
      hatColor: pick(['#2a221c', '#3a4d6e', '#6a2a1a']), beard: r() < 0.45, moustache: r() < 0.6, longHair: r() < 0.4, expr: pick(['smile', 'calm', 'fierce']) };
    // the governor's hall: oil portraits of an ancestor in a wig or a lady in her finery (paintedBust)
    case 'noble': return { ...LOOKS.governor, ...base, skin: pick(['#e8c0a0', '#e0b090']), coat: pick(['#2a2a3a', '#4a1a2a', '#1e2e4a', '#2a3a2a']), wig: pick(['#e9e4da', '#c8bfae', '#8a6a4a']), moustache: r() < 0.4, expr: 'stern' };
    case 'lady': return { ...LOOKS.woman, ...base, hat: 'none', apron: false, skin: pick(['#ecc6a4', '#e8c0a0']), hair: pick(['#2a1a10', '#4a2414', '#7a5a30', '#c8a060']), dress: pick(['#1e2e5a', '#5a1a2a', '#2a4a3a']), bodice: pick(['#1e2e5a', '#5a1a2a', '#2a4a3a']), ribbon: '#e8dcc0', expr: 'calm' };
    case 'guard': return { ...LOOKS.guard, ...base, coat: nation === 'spanish' ? '#a88a3a' : COATS[nation] || '#8a2222', tool: null, expr: 'stern' };
    default: return { ...LOOKS.merchant, ...base, hat: 'wide', hatColor: '#5a3a1c', moustache: true, expr: 'smile' };
  }
}

function rig(renderer) {
  if (R) return R;
  const hdr = new THREE.WebGLRenderTarget(SIZE, SIZE, { samples: 4, type: THREE.HalfFloatType });
  const ldr = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.UnsignedByteType });
  const scene = new THREE.Scene();
  // a soft studio environment so brass, steel and the guard's morion reflect something (black otherwise)
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45; pm.dispose();
  // chiaroscuro of a state portrait — warm key light high at 45° (triangle of light on the shadow cheek), weak cool
  // fill, cool rim behind the shoulder; little ambient light
  scene.add(new THREE.HemisphereLight('#e8ecf4', '#4a3424', 0.62));
  const key = new THREE.DirectionalLight('#ffe8cc', 3.1); key.position.set(-2.6, 2.7, 2.1); scene.add(key);
  const fill = new THREE.DirectionalLight('#8ea6d4', 0.38); fill.position.set(3, 0.8, 2.2); scene.add(fill);
  const rim = new THREE.DirectionalLight('#c8d8ff', 2.0); rim.position.set(2.2, 2.2, -2.6); scene.add(rim);
  const cam = new THREE.PerspectiveCamera(18, 1, 0.05, 20);
  // second pass: un-premultiply, ACES (same fit as three.js) at the game's exposure, sRGB
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: hdr.texture }, uExposure: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tSrc; uniform float uExposure; varying vec2 vUv;
      vec3 fit(vec3 v) { return (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081); }
      vec3 aces(vec3 c) {
        const mat3 A = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
        const mat3 B = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
        return clamp(B * fit(A * (c * uExposure / 0.6)), 0.0, 1.0);
      }
      vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
      void main() { vec4 t = texture2D(tSrc, vUv); vec3 c = t.a > 0.0 ? t.rgb / t.a : vec3(0.0); gl_FragColor = vec4(srgb(aces(c)), t.a); }`,
    depthTest: false, depthWrite: false,
  }));
  const qScene = new THREE.Scene(); qScene.add(quad);
  const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  R = { hdr, ldr, scene, cam, quad, qScene, qCam, buf: new Uint8Array(SIZE * SIZE * 4) };
  return R;
}

// small = vignette of ~40 px (recruits, crew): bigger, brighter face in the frame, otherwise a dark blot
function render(renderer, look, small = false) {
  const { hdr, ldr, scene, cam, quad, qScene, qCam, buf } = rig(renderer);
  const fig = new CaptainFigure({ ...look });
  // three-quarter bust: head turned a little toward the viewer, shoulders squared, arms at rest
  fig.j.head.rotation.y = 0.22; fig.j.neck.rotation.y = 0.08; fig.j.chest.rotation.y = -0.1;
  fig.setExpression?.('neutral', 1e3);
  scene.add(fig.group); fig.group.updateMatrixWorld(true);
  // the figure's eyes sit near 1.83 m (heroic proportions); a tall hat raises the frame a little
  const tall = ['tricorn', 'bicorne', 'morion', 'wide'].includes(look.hat);   // (a wig is not a hat: keep the face large)
  const y = tall ? 1.84 : 1.77;
  const dist = small ? 1.62 : tall ? 2.5 : 2.2;   // the whole hat inside the round frame
  cam.position.set(0.6 * dist / 2.1, y + 0.08, dist); cam.lookAt(0.02, y + (small ? 0.03 : 0), 0); cam.updateMatrixWorld();
  const prevT = renderer.getRenderTarget(), prevC = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha(), prevSh = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  const fp = setFigureFill(0);   // the studio has its own lights
  try {
    renderer.setRenderTarget(hdr); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, cam);
    quad.material.uniforms.uExposure.value = (renderer.toneMappingExposure || 1) * (small ? 1.2 : 0.95);
    renderer.setRenderTarget(ldr); renderer.clear(); renderer.render(qScene, qCam);
    renderer.readRenderTargetPixels(ldr, 0, 0, SIZE, SIZE, buf);
  } finally {
    renderer.setRenderTarget(prevT); renderer.setClearColor(prevC, prevA); renderer.shadowMap.autoUpdate = prevSh; setFigureFill(1, fp);
    scene.remove(fig.group); fig.dispose();
  }
  const c = document.createElement('canvas'); c.width = c.height = SIZE;
  const ctx = c.getContext('2d'), img = ctx.createImageData(SIZE, SIZE), row = SIZE * 4;
  for (let y = 0; y < SIZE; y++) img.data.set(buf.subarray((SIZE - 1 - y) * row, (SIZE - y) * row), y * row);   // flip Y
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

export const portraitKey = (role, seed, nation) => `${role}:${seed >>> 0}:${nation || ''}`;
export function portraitURL(game, role, seed, nation) {
  const key = portraitKey(role, seed, nation);
  if (cache.has(key)) return cache.get(key);
  const renderer = game?.renderer;
  if (!renderer || typeof document === 'undefined' || game?.params?.get?.('portraits') === '0') return null;
  let url = null;
  try { url = render(renderer, portraitLook(role, seed, nation), role === 'sailor'); } catch (e) { console.warn('portrait3d', e); }
  cache.set(key, url);
  // ~100 KB per image: we keep the last 120 (recruits and crews change at every call; a forgotten image is simply
  // repainted if it comes back)
  if (cache.size > 120) cache.delete(cache.keys().next().value);
  return url;
}

// paintedBust(seed): a bust (ancestor in a wig, or a lady) for the paintings of the governor's hall;
// the current game is remembered by warmupPortraits (null in tools and tests: the painting keeps its drawing)
let lastGame = null;
export function paintedBust(seed, game = lastGame) { return game ? portraitURL(game, seed % 2 ? 'lady' : 'noble', seed, 'hall') : null; }

// game.warmup(): a first medallion at load compiles the HDR target's programs (studio lights, ACES pass) so the
// opening of the first port doesn't hitch
export function warmupPortraits(game, { render = true } = {}) { lastGame = game; if (render) portraitURL(game, 'governor', 1, 'english'); }   // render false = only remember the game (the medallion is painted later, game.warmupRare)

// portraitLazy(game, role, seed, nation, toHtml) -> the image if already painted, otherwise null: the render is queued
// (one per frame, off the screen-building path) and every [data-pkey="key"] element still in the page is replaced by
// toHtml(url) when ready. For the small faces (tavern recruits, crew at the share-out).
const queue = [];
let pumping = false;
export function portraitLazy(game, role, seed, nation, toHtml) {
  const key = portraitKey(role, seed, nation);
  if (cache.has(key)) return cache.get(key);
  if (!game?.renderer || typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined' || game?.params?.get?.('portraits') === '0') return null;
  if (!queue.some(q => q.key === key)) queue.push({ key, game, role, seed, nation, toHtml });
  if (!pumping) { pumping = true; requestAnimationFrame(pump); }
  return null;
}
function pump() {
  const q = queue.shift();
  if (q) {
    const url = portraitURL(q.game, q.role, q.seed, q.nation);
    if (url) for (const el of document.querySelectorAll(`[data-pkey="${q.key}"]`)) el.outerHTML = q.toHtml(url);
  }
  if (queue.length) requestAnimationFrame(pump); else pumping = false;
}
