// DuelSystem — the real-time 3D sword duel between two captains on a ship's deck.
//
// API (game.duel):
//   duel.start({ opponent, setting, onEnd, player, difficulty, crewPlayer, crewEnemy, intro = true }) -> Promise<result>
//     opponent  { name, faction, difficulty 0..1, look:{coat,trim,hat,...} } (all optional)
//     setting   a Ship (fight on her deck) | 'port' / { x, z, heading, type } (a docked hull is built with buildShipModel)
//               | { scene: 'tavern' | 'rampart', faction } : an off-deck stage (duelStages.js), its own scene
//               rendered through game.renderOverride (tavern common room, town rampart at night)
//     onEnd(result)   result = { winner:'player'|'enemy', reason:'wounds'|'pressed'|'yield', time, stats }
//   duel.active   bool;   duel.sim  DuelSim;   duel.abort()
//   duel.frameShot(view) for showcases: 'action' | 'parry' | 'finish'
// Controls (while active, physical positions — labels follow the layout via core/keys.js): A/D or ←/→ step back / forward, W/S or ↑/↓ choose the high / low line (none = mid),
//   J slash, K parry (hold), Space dodge (side; + A back, + W jump over a low cut, + S duck under a high cut),
//   L taunt (stuns if it lands), Y (held 1 s) yield. Before the fight: weapon choice (1/2/3, ←/→, Enter / J).
//   First duel: contextual tutorial (state.tutorials.duel), first two enemy wind-ups in slow motion.
// Emits: 'duel:start' {opponent}, 'duel:hit' {who}, 'duel:parry' {who, perfect}, 'duel:end' {result}.
// game.mode is 'duel' while active; the HUD is hidden and the player's ship controller is suspended.
import * as THREE from 'three';
import { kc } from '../../core/keys.js';
import { DuelSim, TIMING, WEAPONS, STAMINA, DUEL_DIFFICULTY } from './sim.js';
import { CaptainFigure, FIGURE_RIM, DETAIL_EXTRA, setFigureFill } from './figure.js';
import { deckTex } from './textures.js';
import { FencerAnimator } from './animator.js';
import { GlbCaptain, wantGLBCaptain, loadCaptainAsset, captainAsset } from './glbCaptain.js';   // A/B: ?captain=glb
import { buildDuelStage, buildDeckDressing, DUEL_STAGES } from './duelStages.js';
import { buildShipModel } from '../../ships/shipModel.js';
import { FACTIONS } from '../../core/constants.js';
import { nationName, ofName } from '../../core/i18n.js';
import { mulberry32 } from '../../core/rng.js';
import './duel.css';
import { deckSampler } from './deckSampler.js';   // deck height without ray casting
import { precompile, canPrecompile } from '../../core/precompile.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FACTION_LOOK = {
  english: { coat: '#8c1c1f', trim: '#e2bc62', lapel: '#1f2a4a', hat: 'tricorn', breeches: '#d9cba6' },
  spanish: { coat: '#262a33', trim: '#d9b25c', lapel: '#8a1e1e', hat: 'bicorne', plume: '#e8d9b0', breeches: '#3a2a20' },
  french:  { coat: '#22396e', trim: '#e8d394', lapel: '#c8bfa8', hat: 'tricorn', breeches: '#e8e0cc' },
  dutch:   { coat: '#3b2a1c', trim: '#e07a24', lapel: '#d8cfb8', hat: 'tricorn', breeches: '#2c2620' },
  pirate:  { coat: '#3a1a14', trim: '#b38b4a', lapel: '#5b1a1a', hat: 'bandana', bandana: '#8e1b1b', breeches: '#4a3a2a', beard: true },
};
const LINE_TEXT = { high: 'high', mid: 'middle', low: 'low' };
const ARMS = [
  { id: 'rapier', name: 'Rapier', desc: 'Quick, good reach, but little impact: barely pushes back and barely wears down the enemy’s guard.' },
  { id: 'cutlass', name: 'Cutlass', desc: 'Balanced. The seafarer’s blade.' },
  { id: 'longsword', name: 'Longsword', desc: 'Slow and hungry for breath, but it wounds more, drives back far and breaks guards.' },
];
let _tutSeen = false;   // session fallback when there is no career state (showcases)
const SHIRTS = ['#e9e1cc', '#d8cfb8', '#7a2a22', '#3a4d6e', '#c8b48a', '#efe9dc', '#5a6b3a', '#a54a2a'];

// the duel line's painted deck strip (fades into the hull's own deck) and the soft contact shadows under the fighters;
// also built by warmupDeck (perf 24/10) so their programs exist before the first boarding
function deckOverlayMaterial() {
  const mat = new THREE.MeshStandardMaterial({ map: deckTex(), roughness: 0.82, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFade; varying float vFade;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFade;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vFade;');
  };
  mat.customProgramCacheKey = () => 'duelDeckOverlay1';
  return mat;
}
const blobMaterial = map => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

export class DuelSystem {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.sim = null;
    this.timeScaleTarget = 1;
    this._shake = 0; this._shakeT = 0;
    this._buildTrailMats();
    this._buildHUD();
    if (wantGLBCaptain(game)) this.preloadModel();
  }

  // A/B: GLB captains (?captain=glb / settings.duelModel='glb'); resolves when the model is parsed (no-op otherwise)
  // the duellists' ink contour is a program of its own; compile it with the world at load time
  // (game.warmup) so the first boarding does not stall on it. Off-deck stages compile behind the caller's fade.
  warmup() {
    if (this._warm) return; this._warm = true;
    const g = this.game;
    try {
      const f = new CaptainFigure({ ...FACTION_LOOK.english, outline: true, headScale: 1.26, seed: 1 });
      f.group.position.copy(g.camera.position).add(new THREE.Vector3(0, -2, -6).applyQuaternion(g.camera.quaternion));
      g.scene.add(f.group); g.renderer.compile(g.scene, g.camera); g.scene.remove(f.group); f.dispose();
    } catch (e) { console.warn('warmup duel', e); }
  }

  // First boarding without compilation: on a warm-up ship (game._shipWarmPool), the duel deck (layer, carved
  // dressing), each kind of deck dressing and one sailor of the crowd, compiled in the sea's target
  // (game.warmupRare sets the target); their programs stay alive (game._pinPrograms)
  warmupDeck(model) {
    if (this._warmDeck || !model) return;
    this._warmDeck = true;
    const g = this.game, vis = model.group.visible, parts = [];
    try {
      model.group.visible = true;
      model.setDuelMode?.(true);
      const hb = (model.beam || 8) / 2, dh = model.deckHeight || 3;
      for (const kind of ['merchant', 'war', 'pirate']) { const d = buildDeckDressing(kind, { sample: () => dh, zA: -4, zB: 4, zC: 0, hb, seed: 3 }); model.group.add(d.group); parts.push(d); }
      const f = new CaptainFigure({ sailor: true, fists: true, cutlass: true, sword: true, outline: true, outlineW: 0.0055, detail: DETAIL_EXTRA, seed: 2, hat: 'bandana', vest: '#5a3a24', stripes: true, jacket: true, sash: '#8e1b1b' });
      model.group.add(f.group);
      // deck strip, soft shadows, blade trails
      const pg = new THREE.PlaneGeometry(1, 1), bt = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1); bt.needsUpdate = true;
      const extra = [new THREE.Mesh(pg, deckOverlayMaterial()), new THREE.Mesh(pg, blobMaterial(bt)), new THREE.Mesh(pg, this.trailMat)];
      extra[0].receiveShadow = true;
      for (const e of extra) model.group.add(e);
      g.renderer.compile(g.scene, g.camera);
      model.group.remove(f.group); f.dispose();
      for (const e of extra) { model.group.remove(e); if (e.material !== this.trailMat) e.material.dispose(); }
      pg.dispose(); bt.dispose();
    } catch (e) { console.warn('warmup deck', e); }
    for (const d of parts) { d.group.parent?.remove(d.group); d.dispose(); }
    model.setDuelMode?.(false);
    model.group.visible = vis;
  }

  preloadModel() {
    if (!wantGLBCaptain(this.game)) return Promise.resolve(null);
    return loadCaptainAsset().catch(err => { console.error('[duel] GLB captain failed to load, using procedural', err); return null; });
  }

  // ------------------------------------------------------------------ public
  start(o = {}) {
    if (this.active) this._teardown();
    const g = this.game;
    const rand = this.rand = mulberry32((o.seed ?? Math.floor(Math.random() * 1e9)) >>> 0);
    this.opts = o;
    this.onEnd = o.onEnd || null;
    const opp = this.opponent = { name: 'Enemy captain', faction: 'spanish', difficulty: 0.5, ...(o.opponent || {}) };
    const pf = g.player?.faction || 'english';
    this.playerFaction = o.playerFaction || pf;

    // ---- the stage: a ship's deck, or an off-deck set (tavern / rampart) ----
    let ship = null, model;
    const sk = o.setting && !o.setting.model && typeof o.setting === 'object' ? o.setting.scene : null;
    this.stage = null;
    if (sk && DUEL_STAGES.includes(sk)) {
      const st = this.stage = buildDuelStage(sk, { game: g, faction: o.setting.faction || opp.faction, seed: o.seed ?? 7 });
      model = { group: st.root, length: 24, beam: st.halfW * 2, isStage: true };
      this._ownModel = null;
    } else if (o.setting && o.setting.model) { ship = o.setting; model = ship.model; this._ownModel = null; }
    else {
      const s = typeof o.setting === 'object' ? o.setting : {};
      const p = g.player?.position || { x: 0, z: 0 };
      model = buildShipModel(s.type || 'brig', { faction: opp.faction, name: opp.name, seed: 11 });
      model.group.position.set(s.x ?? p.x + 60, 0, s.z ?? p.z + 60);
      model.group.rotation.y = -(s.heading ?? 0);
      g.scene.add(model.group);
      model.update(0, g.time, { sailSetting: 0, windRel: Math.PI * 0.7 });
      this._ownModel = model;
    }
    this.ship = ship; this.model = model;
    model.setDuelMode?.(true);   // ship-art: carved & gilded duel deck dressing
    model.group.updateMatrixWorld(true);
    if (this.stage) this._layoutStage(); else this._layoutDeck();

    // ---- fighters ----
    const dd = DUEL_DIFFICULTY[g.state?.difficulty] || DUEL_DIFFICULTY.mate;
    const diff = o.difficulty ?? opp.difficulty;
    const wE = opp.weapon || (opp.faction === 'pirate' ? 'cutlass' : opp.faction === 'spanish' || opp.faction === 'french' ? 'rapier' : diff >= 0.7 ? 'longsword' : 'cutlass');
    const wP = o.weapon || g.state?.duelWeapon || 'cutlass';
    const sim = this.sim = new DuelSim({ rand, difficulty: diff, crewPlayer: o.crewPlayer ?? g.player?.crew ?? 60, crewEnemy: o.crewEnemy ?? ship?.crew ?? 40, length: this.lineLen,
      weaponPlayer: wP, weaponEnemy: wE, aiPace: dd.pace, aiRead: dd.read });
    if (!o.autoplay) g.fortune?.applyDuel?.(sim);   // sword, pistol, armour, age
    this.root = new THREE.Group(); this.root.name = 'duel';
    model.group.add(this.root);
    { const cap = this.hud?.querySelector?.('.dh-rail-cap'); if (cap) cap.textContent = this.stage?.railLabel || 'The deck'; }
    const pl = { ...FACTION_LOOK[this.playerFaction] || FACTION_LOOK.english, ...(o.playerLook || {}), coat: (o.playerLook?.coat) || '#7c1a1a', trim: '#e6c06a', lapel: '#1c2a48', hat: 'tricorn', plume: null, hatColor: '#17110d', hair: '#3a2416', skin: '#d29a6e', epaulette: true, headScale: 1.26, outline: g.params?.get?.('outline') !== '0' };
    const el = { ...(FACTION_LOOK[opp.faction] || FACTION_LOOK.spanish), ...(opp.look || {}), skin: '#b98258', hair: '#141010', epaulette: opp.faction !== 'pirate', beard: (opp.look?.beard) ?? (opp.faction === 'pirate' || opp.faction === 'spanish') };
    const glb = wantGLBCaptain(g) ? captainAsset() : null;
    if (glb) {   // A/B: rigged GLB captains driven by the same sim (player keeps the model's burgundy coat)
      this.figP = new GlbCaptain(glb, { height: 1.0 });
      this.figE = new GlbCaptain(glb, { height: 1.03, lefty: true, coat: el.coat });
      this.animP = this.figP.anim; this.animE = this.figE.anim;
    } else {
    this._lookP = pl;
    this.figP = new CaptainFigure({ ...pl, seed: 3, height: 1.0, blade: wP });
    this.figE = new CaptainFigure({ ...el, seed: 9, height: 1.03, blade: wE, lefty: true, headScale: 1.26, outline: pl.outline });   // bigger faces, ink contour
    this.animP = new FencerAnimator(this.figP);
    this.animE = new FencerAnimator(this.figE, { lefty: true });   // a left-hander: both blades face the camera
    }
    this.root.add(this.figP.group, this.figE.group);
    if (this.stage) this._stageSteel();
    this._buildCrowd();
    this._buildTrails();
    this._buildStage();

    // ---- freeze the sea action ----
    this._prev = { mode: g.mode, hud: g.hud?.visible, ctl: g.player?.controller, timeScale: g.timeScale, rigFixed: g.cameraRig?.fixed, rigMode: g.cameraRig?.mode };
    if (g.player) { g.player.controller = null; g.player.sailSetting = 0; g.player.rudder = 0; }
    if (ship) { this._shipCtl = ship.controller; ship.controller = null; ship.sailSetting = 0; ship.rudder = 0; }
    this._crewMeshes = [];
    if (!this.stage) model.group.traverse(c => { if (c.isInstancedMesh) { this._crewMeshes.push([c, c.layers.mask]); c.layers.set(31); } });   // the hull's own crew sprites (their LOD toggles .visible) are replaced by our figures
    // hide the other hulls alongside (the boarding ship sits between the camera and the deck otherwise)
    this._hiddenShips = [];
    const dp = model.group.getWorldPosition(new THREE.Vector3());
    if (this.stage) this._enterStage();
    else for (const s of g.ships) {
      const grp = s.model?.group; if (!grp || s === ship || !grp.visible) continue;
      if (Math.hypot(s.position.x - dp.x, s.position.z - dp.z) < 90) { grp.visible = false; this._hiddenShips.push(grp); }
    }
    g.hud?.show?.(false);
    g.mode = 'duel';
    g.events.emit('state:change', { from: this._prev.mode, to: 'duel' });
    this.active = true;
    this.ended = false; this.endT = 0; this.slowT = 0;
    this._ended2 = false;   // must reset per duel, or every duel after the first never completes
    this.realT = 0;
    this.camState = null;
    this.introT = o.intro === false ? 9 : 0;
    this._yieldT = 0;
    this.hud.classList.add('on');
    // weapon choice before the fight (live duels only), then the contextual tutorial on the first duel
    const live = !o.autoplay && !o.noInput;
    this._arming = live && !o.weapon && o.arms !== false;
    this._armSel = Math.max(0, ARMS.findIndex(a => a.id === wP));
    this._tut = live && o.tutorial !== false && !(g.state?.tutorials?.duel) && !_tutSeen ? { step: -1, t: 0, slow: 0 } : null;
    this._tellE = null;
    this._renderHUD(true);
    if (this._arming) this._showArms(); else this._tutNext(0);
    g.events.emit('duel:start', { opponent: opp });
    this.promise = new Promise(res => { this._resolve = res; });
    this._sync(0);
    if (this.stage) this._compileStage();
    return this.promise;
  }

  abort() { if (this.active) this._finish({ winner: 'enemy', reason: 'yield' }); this._teardown(); }

  // ------------------------------------------------------------------ deck layout
  _layoutDeck() {
    const model = this.model, L = model.length;
    // deck height profile by raycasting the hull (upward-facing surfaces only)
    const ray = new THREE.Raycaster(); ray.far = 30;
    const meshes = [];
    model.group.traverse(c => { if (c.isMesh && !c.isInstancedMesh && !c.isSkinnedMesh) meshes.push(c); });
    const top = (model.deckHeight || 3) + 4;
    const inv = new THREE.Matrix4().copy(model.group.matrixWorld).invert();
    const sampleRay = (x, z) => {
      _v.set(x, top, z).applyMatrix4(model.group.matrixWorld);
      ray.set(_v, _v2.set(0, -1, 0).transformDirection(model.group.matrixWorld));
      const hits = ray.intersectObjects(meshes, false);
      for (const h of hits) {
        const n = h.face?.normal; if (!n) continue;
        _v3.copy(n).transformDirection(h.object.matrixWorld).transformDirection(inv);
        // upward faces well below the deck line (keelson, hold floor) are not the deck: skip them
        if (_v3.y > 0.8) { const y = h.point.applyMatrix4(inv).y; if (y > (model.deckHeight || 3) - 1.5) return y; }
      }
      return model.deckHeight || 3;
    };
    // same answer as sampleRay (kept for comparison, this._deckSampleRay), without casting ~350 rays over the
    // whole hull at every boarding: upward faces are binned once in a grid (deckSampler.js)
    const fast = deckSampler(meshes, model.group.matrixWorld, (model.deckHeight || 3) - 1.5, top);
    const sample = (x, z) => fast(x, z) ?? (model.deckHeight || 3);
    this._deckSampleRay = sampleRay;
    // candidate limits: masts (z of each mast top), bow / stern ends
    const masts = model.mastTops.map(o => o.position.z).sort((a, b) => a - b);
    const ends = [-L * 0.36, ...masts, L * 0.3];
    let best = null;
    for (let i = 0; i < ends.length - 1; i++) {
      const a = ends[i] + 0.7, b = ends[i + 1] - 0.7, len = b - a;
      let flat = 0; const y0 = sample(0, a);
      for (let k = 1; k <= 6; k++) flat = Math.max(flat, Math.abs(sample(0, a + len * k / 6) - y0));
      const score = -Math.abs(len - 9) + (len >= 6 ? 3 : 0) - flat * 2;
      if (len > 4 && (!best || score > best.score)) best = { a, b, len, score };
    }
    if (masts.length >= 2) { const a = masts[0] + 0.9, b = masts[1] - 0.9; if (b - a > 4) best = { a, b, len: b - a }; }
    if (!best) best = { a: -4, b: 4, len: 8 };
    if (best.len > 11) { const c = (best.a + best.b) / 2; best.a = c - 5.5; best.b = c + 5.5; best.len = 11; }
    this.zA = best.a; this.zB = best.b; this.lineLen = best.len; this.zC = (best.a + best.b) / 2;
    this.deckSample = sample;
    this.lineX = model.beam * 0.5 * 0.36;
    const N = 48; this.deckZ0 = -L * 0.5; this.deckDz = L / N; this.deckProfile = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) this.deckProfile[i] = sample(this.lineX, this.deckZ0 + i * this.deckDz);
    // smooth out spikes (gratings / hatches)
    const p = this.deckProfile, q = Float32Array.from(p);
    for (let i = 1; i < N; i++) q[i] = [p[i - 1], p[i], p[i + 1]].sort((a, b) => a - b)[1];
    this.deckProfile = q;
    this.halfBeam = model.beam * 0.5;
  }
  deckY(z) {
    const f = clamp((z - this.deckZ0) / this.deckDz, 0, this.deckProfile.length - 1.001), i = Math.floor(f), u = f - i;
    return this.deckProfile[i] * (1 - u) + this.deckProfile[i + 1] * u;
  }
  // sim x -> deck z (player at zB end, the enemy toward zA)
  zOf(x) { return this.zC - x; }

  // ------------------------------------------------------------------ off-deck stages (duelStages.js)
  // the line runs along z at x = 0 on a flat floor; same frame as a deck so crowd, camera and blobs are shared
  _layoutStage() {
    const st = this.stage, L = st.lineLen;
    this.zA = -L / 2; this.zB = L / 2; this.lineLen = L; this.zC = 0; this.lineX = 0;
    const N = 48; this.deckZ0 = -24; this.deckDz = 48 / N; this.deckProfile = new Float32Array(N + 1);
    this.deckSample = () => 0;
    this.halfBeam = st.halfW;
  }
  // stage scene takes over the frame: sparks (shared FX pool) move in with it, the world is not drawn
  _enterStage() {
    const g = this.game, st = this.stage;
    const ps = g.fx?.glowPS?.mesh;
    if (ps) { this._psParent = ps.parent; st.scene.add(ps); }
    this._prevOverride = g.renderOverride || null;
    g.renderOverride = () => this._renderStage();
  }
  // compile the stage's programs once the figures are in (the callers fade to black around duel.start)
  _compileStage() {
    const g = this.game, st = this.stage; if (!st) return;
    // in parallel when the driver allows it (the set only shows once ready, under the fade)
    if (canPrecompile(g.renderer)) { st.ready = false; precompile(g.renderer, st.scene, g.camera, { shadows: true }).then(() => { st.ready = true; }); return; }
    try { const r = g.renderer, sh = r.shadowMap.enabled; r.shadowMap.enabled = true; r.compile(st.scene, g.camera); r.shadowMap.enabled = sh; } catch (e) { console.warn('duel stage compile', e); }
  }
  // night / indoor sets: the blades catch the lanterns and the fire (stronger reflections on steel) so cuts read
  _stageSteel() {
    for (const f of [this.figP, this.figE]) {
      const m = f?.steelMesh?.material; if (!m) continue;
      m.envMapIntensity = 2.2; m.metalness = 0.6; m.roughness = 0.26;   // less mirror, more lit by the lanterns
      m.userData.em0 = new THREE.Color(0.09, 0.1, 0.12); m.emissive.copy(m.userData.em0);   // a faint sheen: the blade stays a light line at night
    }
  }
  _renderStage() {
    const st = this.stage, g = this.game; if (!st || st.ready === false) return;
    st.render(g.renderer, g.camera);
  }
  _leaveStage() {
    const g = this.game, st = this.stage; if (!st) return;
    const ps = g.fx?.glowPS?.mesh;
    if (ps && this._psParent) this._psParent.add(ps);
    this._psParent = null;
    if (this._prevOverride) g.renderOverride = this._prevOverride; else if (g.renderOverride) g.renderOverride = null;
    this._prevOverride = null;
    st.dispose();
    this.stage = null;
  }

  // ------------------------------------------------------------------ crowd
  _buildCrowd() {
    const r = this.rand, hb = this.halfBeam;
    this.crowd = [];
    if (this.stage) return this._buildStageCrowd();
    const pFac = this.playerFaction, eFac = this.opponent.faction;
    const mk = (fac, side, z, x, pose) => {
      const look = {
        sailor: true, sword: pose === 'fight', cutlass: true, coat: SHIRTS[Math.floor(r() * SHIRTS.length)], stripes: r() < 0.3,
        shirt: '#e8dfc8', breeches: ['#5a4a38', '#6b5a44', '#3a3a44', '#2c3550', '#c8b48a'][Math.floor(r() * 5)], boot: '#2a1a10',
        vest: r() < 0.4 ? ['#5a3a24', '#2c3550', '#6e1414', '#3a4a2a', '#4a3a2a'][Math.floor(r() * 5)] : null, fists: true,
        hat: ['bandana', 'tricorn', 'none', 'bandana', 'cap', 'tricorn'][Math.floor(r() * 6)], bandana: [FACTIONS[fac]?.color || '#6e1414', '#6e1414', '#2a3a58', '#c8b48a', '#3a3028'][Math.floor(r() * 5)],
        skin: ['#c98d62', '#a86e48', '#e0ab84', '#7a4a2c'][Math.floor(r() * 4)], hair: ['#2b1d14', '#141010', '#6b4a2a'][Math.floor(r() * 3)],
        hatColor: '#2a221c', beard: r() < 0.4, moustache: r() < 0.5, jacket: r() < 0.25, sash: r() < 0.5 ? '#8e1b1b' : null, seed: Math.floor(r() * 1e6),
        bulk: 0.9 + r() * 0.25, height: 0.92 + r() * 0.1, longHair: r() < 0.4, detail: DETAIL_EXTRA, headScale: 1.24 + r() * 0.08, outline: true, outlineW: 0.0055,   // lighter crowd; big readable heads, outline like the duellists
      };
      const fig = new CaptainFigure(look);
      const an = new FencerAnimator(fig, { lefty: false });
      this.root.add(fig.group);
      const c = { fig, an, side, x, z, pose, phase: r() * 10, fac, style: Math.floor(r() * 5), dy: 0 };
      this.crowd.push(c);
      return c;
    };
    // no one stands in a step of the deck (break of the quarterdeck, a hatch coaming): slide toward the middle
    const clear = (x, z, dir) => {
      for (let k = 0; k < 6; k++) {
        const y0 = this.deckSample(x, z);
        if (Math.abs(this.deckSample(x, z + 0.4) - y0) < 0.18 && Math.abs(this.deckSample(x, z - 0.4) - y0) < 0.18 && Math.abs(y0 - this.deckY(z)) < 0.25) return z;
        z += dir * 0.5;
      }
      return z;
    };
    // spectators: each crew along its own end of the line, facing the fight, in two staggered rows; one or two climb on
    // a gun carriage by the rail to see over the others (round 11: a crowd in depth, not a single file)
    for (const [fac, side] of [[pFac, 1], [eFac, -1]]) for (let i = 0; i < 5; i++) {
      const row = i % 2, x = -(hb * 0.5 + row * 0.6), z0 = this.zC + side * (0.6 + i * 1.0 + r() * 0.3);
      mk(fac, side, clear(x, z0, -side), x, 'cheer');
    }
    for (const side of [1, -1]) {
      const x = -(hb * 0.5 + 1.15);
      if (x > -(hb - 0.3)) continue;
      const c = mk(side > 0 ? pFac : eFac, side, clear(x, this.zC + side * (2.1 + r() * 1.4), -side), x, 'cheer');
      c.dy = 0.3; c.style = 1;
    }
    // background brawls: pairs fighting beyond each end of the duel line (kept off the centre line and its masts)
    this.brawls = [];
    const L = this.model.length;
    const spots = [[this.zA - 2.4, -hb * 0.5], [this.zA - 2.0, hb * 0.45]];
    for (const [z, x] of spots) {
      if (z < -L * 0.42 || z > L * 0.38) continue;
      const a = mk(pFac, 1, z, x, 'fight'), b = mk(eFac, -1, z, x, 'fight');
      const sim = new DuelSim({ rand: this.rand, difficulty: 0.4, length: 3.6, playerHp: 99, enemyHp: 99 });
      sim.player.x = -1.05; sim.enemy.x = 1.05;
      const ai2 = new (sim.ai.constructor)(sim, sim.player, 0.35);
      this.brawls.push({ a, b, sim, ai2, z, x, yaw: (r() - 0.5) * 1.2 });
    }
  }

  // off-deck stage: the set places its spectators (guests, patrons, the watch) and an optional background brawl
  _buildStageCrowd() {
    const st = this.stage;
    this.brawls = [];
    for (const c of st.crowd) {
      const fig = new CaptainFigure({ detail: DETAIL_EXTRA, headScale: c.look.dress ? 1.16 : 1.26, outline: true, outlineW: 0.0055, ...c.look });
      const an = new FencerAnimator(fig, { lefty: false });
      this.root.add(fig.group);
      this.crowd.push({ fig, an, side: c.side, x: c.x, z: c.z, pose: 'cheer', calm: !!c.calm, phase: this.rand() * 10 });
    }
    const pf = this.playerFaction, ef = this.opponent.faction, r = this.rand;
    for (const b of st.brawls || []) {
      const mk = (side) => {
        const fig = new CaptainFigure({ sailor: true, sword: true, cutlass: true, coat: ['#e9e1cc', '#7a2a22', '#3a4d6e', '#c8b48a'][Math.floor(r() * 4)], shirt: '#e8dfc8', breeches: '#6b5a44', hat: r() < 0.5 ? 'bandana' : 'none', bandana: '#6e1414', skin: ['#c98d62', '#a86e48', '#e0ab84'][Math.floor(r() * 3)], beard: r() < 0.5, seed: Math.floor(r() * 1e6), height: 0.95 + r() * 0.08, detail: DETAIL_EXTRA, headScale: 1.26, outline: true, outlineW: 0.0055 });
        const an = new FencerAnimator(fig, { lefty: false }); this.root.add(fig.group);
        const c = { fig, an, side, x: b.x, z: b.z, pose: 'fight', phase: 0, fac: side > 0 ? pf : ef }; this.crowd.push(c); return c;
      };
      const a = mk(1), bb = mk(-1);
      const sim = new DuelSim({ rand: this.rand, difficulty: 0.4, length: 3.6, playerHp: 99, enemyHp: 99 });
      sim.player.x = -1.05; sim.enemy.x = 1.05;
      const ai2 = new (sim.ai.constructor)(sim, sim.player, 0.35);
      this.brawls.push({ a, b: bb, sim, ai2, z: b.z, x: b.x, yaw: b.yaw || 0 });
    }
  }

  // ------------------------------------------------------------------ stage: painted deck planks, soft contact shadows, rim light
  _buildStage() {
    if (this.stage) {   // off-deck: the set has its own floor; keep the soft contact shadows and set the rim to its light
      this._buildBlobs();
      this._rimPrev = FIGURE_RIM.value.clone();
      FIGURE_RIM.value.copy(this.stage.rim || new THREE.Color(0.95, 0.72, 0.48));
      this._fillPrev = setFigureFill(this.stage.fill ?? 0.22);   // faces readable in the lantern light
      return;
    }
    const L = this.model.length, hb = this.halfBeam;
    const z0 = Math.max(-L * 0.4, this.zA - 1.2), z1 = Math.min(L * 0.36, this.zB + 1.2);
    const NX = 8, NZ = Math.max(8, Math.round((z1 - z0) * 1.5));
    const xs = -hb * 0.66, xe = hb * 0.66;
    const geo = new THREE.PlaneGeometry(1, 1, NX, NZ);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) + 0.5, v = pos.getY(i) + 0.5;
      const x = xs + (xe - xs) * u, z = z0 + (z1 - z0) * v;
      // follow the deck's camber, but never drape over hatches / gratings the raycast finds (stay on the line profile)
      const yl = this.deckY(clamp(z, this.zA, this.zB)), ys = this.deckSample(x, z);
      pos.setXYZ(i, x, (Math.abs(ys - yl) < 0.08 ? ys : yl) + 0.012, z);
      uv.setXY(i, u * (xe - xs) / 1.9, v * (z1 - z0) / 7.5);
    }
    geo.computeVertexNormals();
    // fade the strip's edges into the hull's own deck so it never reads as a rug
    const al = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) { const u = uv.getX(i) / ((xe - xs) / 1.9), v = uv.getY(i) / ((z1 - z0) / 7.5); al[i] = Math.min(1, Math.min(u, 1 - u) * 7, Math.min(v, 1 - v) * 9); }
    geo.setAttribute('aFade', new THREE.BufferAttribute(al, 1));
    const mat = deckOverlayMaterial();
    const deck = new THREE.Mesh(geo, mat); deck.receiveShadow = true; deck.renderOrder = 1;
    this.root.add(deck);
    this._buildBlobs();
    // stage lighting: a stronger warm rim on the figures for a contrasted key/rim read against the sky
    this._rimPrev = FIGURE_RIM.value.clone();
    FIGURE_RIM.value.setRGB(0.95, 0.72, 0.48);
    // the figures' own lamp — the enemy's face sits in his hat's shadow and the crowd stands against the sun
    { const h = this.game.sky?.timeOfDay ?? 12, night = h < 5.5 || h > 19.8, low = !night && (h < 8.5 || h > 16.5);
      this._fillPrev = setFigureFill(night ? 0.3 : low ? 0.26 : 0.17, night ? '#ffd9b0' : '#ffeedd'); }
    // the deck tells which ship this is (point 3): cargo on a merchantman, shot and powder on a man-of-war, plunder
    // on a pirate; beyond the ends of the line, against the far bulwark. Not on the player's own deck (mutiny).
    const role = this.ship ? this.ship.role : this._ownModel ? 'merchant' : null;
    const kind = !role || this.ship === this.game.player ? null : role === 'merchant' ? 'merchant' : role === 'pirate' ? 'pirate' : 'war';
    if (kind) try {
      this._dressing = buildDeckDressing(kind, { sample: this.deckSample, zA: this.zA, zB: this.zB, zC: this.zC, hb: this.halfBeam, seed: Math.floor(this.rand() * 1000) });
      this.root.add(this._dressing.group);
    } catch (e) { console.warn('deck dressing', e); }
  }
  // soft contact shadows under the two duellists (the PCF shadow map stays hard-edged at this distance)
  _buildBlobs() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d'), gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(20,10,4,0.62)'); gr.addColorStop(0.45, 'rgba(20,10,4,0.32)'); gr.addColorStop(1, 'rgba(20,10,4,0)');
    c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
    const st = new THREE.CanvasTexture(cv);
    const sm = blobMaterial(st);
    const sg = new THREE.PlaneGeometry(1.5, 1.05).rotateX(-Math.PI / 2);
    this.blobs = [0, 1].map(() => { const m = new THREE.Mesh(sg, sm); m.renderOrder = 2; this.root.add(m); return m; });
  }

  // ------------------------------------------------------------------ trails
  _buildTrailMats() {
    this.trailMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(1.0, 0.92, 0.78) } },
      vertexShader: `attribute float aA; attribute float aE; varying float vA; varying float vE; void main(){ vA=aA; vE=aE; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; varying float vE; void main(){ float edge = smoothstep(0.0, 1.0, vE); float a = vA*vA*(0.25+0.75*edge); gl_FragColor=vec4(uColor*a*1.6, a); }`,
    });
  }
  _buildTrails() {
    const N = 26;
    this.trails = [this.figP, this.figE].map(fig => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(N * 2 * 3), aA = new Float32Array(N * 2), aE = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) { aE[i * 2] = 0.15; aE[i * 2 + 1] = 1; }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aA', new THREE.BufferAttribute(aA, 1));
      geo.setAttribute('aE', new THREE.BufferAttribute(aE, 1));
      const idx = []; for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, this.trailMat); mesh.frustumCulled = false; mesh.renderOrder = 20;
      (this.stage?.scene || this.game.scene).add(mesh);
      return { fig, mesh, N, hist: [], heat: 0 };
    });
  }
  _updateTrail(tr, swing, dt) {
    const fig = tr.fig;
    fig.hilt.getWorldPosition(_v); fig.tip.getWorldPosition(_v2);
    // interpolate extra samples so fast arcs stay smooth
    const last = tr.hist[0];
    tr.heat = swing > 0.05 ? Math.max(swing, tr.heat) : Math.max(0, tr.heat - dt * 5);
    if (dt > 0 || !last) {
      if (last) {
        const steps = 2;
        for (let s = 1; s <= steps; s++) {
          const k = s / steps;
          tr.hist.unshift({ h: last.h.clone().lerp(_v, k), t: last.t.clone().lerp(_v2, k), a: tr.heat });
        }
      } else tr.hist.unshift({ h: _v.clone(), t: _v2.clone(), a: tr.heat });
      while (tr.hist.length > tr.N) tr.hist.pop();
    }
    const pos = tr.mesh.geometry.attributes.position.array, aA = tr.mesh.geometry.attributes.aA.array;
    for (let i = 0; i < tr.N; i++) {
      const e = tr.hist[Math.min(i, tr.hist.length - 1)];
      // tighten toward the tip: trail is the outer 70% of the blade
      _v3.copy(e.h).lerp(e.t, 0.2);
      pos.set([_v3.x, _v3.y, _v3.z], i * 6); pos.set([e.t.x, e.t.y, e.t.z], i * 6 + 3);
      const fade = Math.pow(1 - i / (tr.N - 1), 0.8) * e.a;
      aA[i * 2] = fade; aA[i * 2 + 1] = fade;
    }
    tr.mesh.geometry.attributes.position.needsUpdate = true; tr.mesh.geometry.attributes.aA.needsUpdate = true;
  }

  // ------------------------------------------------------------------ input
  _readInput(real = 1 / 60) {
    const inp = this.game.input, sim = this.sim, p = sim.player;
    if (!inp || this.ended || this.introT < 1.0 || this.opts.autoplay || this.opts.noInput) return;
    const up = inp.down('KeyW') || inp.down('ArrowUp'), dn = inp.down('KeyS') || inp.down('ArrowDown');
    const line = up ? 'high' : dn ? 'low' : 'mid';
    this._line = line;
    const back = inp.down('KeyA') || inp.down('ArrowLeft');
    if (inp.pressed('Space')) this._buffer = { dodge: up ? 'jump' : dn ? 'duck' : back ? 'back' : 'side', t: 0.22 };
    else if (inp.pressed('KeyJ')) this._buffer = { attack: line, t: 0.25 };
    else if (inp.pressed('KeyL')) this._buffer = { taunt: true, t: 0.25 };
    else if (inp.pressed('KeyD') || inp.pressed('ArrowRight')) this._buffer = { step: 1, t: 0.2 };
    else if (inp.pressed('KeyA') || inp.pressed('ArrowLeft')) this._buffer = { step: -1, t: 0.2 };
    if (this._buffer) {
      const b = this._buffer;
      if (!p.busy) { const { t, ...it } = b; void t; p.intent = it; this._buffer = null; }
    } else if (inp.down('KeyK')) p.intent = { parry: line };
    else if (!p.busy) p.intent = null;
    if (inp.down('KeyY')) { this._yieldT += real; if (this._yieldT > 1) sim.yieldDuel('player'); } else this._yieldT = 0;
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    if (!this.active) return;
    const g = this.game;
    const real = g.timeScale > 0 ? dt / g.timeScale : dt;
    this.realT += real;
    if (this._arming) { this._armsInput(); this._sync(0, 0); return; }
    this.introT += real;
    this._tutUpdate(real);
    if (this._buffer) { this._buffer.t -= real; if (this._buffer.t <= 0) this._buffer = null; }
    this._readInput(real);   // real seconds: holding Y yields after one second at any frame rate
    const sim = this.sim;
    if (this._freezeSim) { this._sync(0, 0); return; }   // showcase: hold the composed instant
    // hitstop: a few frames of frozen action on blade contact / a touch (real time), then resume
    if (this._hitStop > 0) { this._hitStop -= real; this._sync(0, 0); return; }
    if (dt > 0 && this.introT > 0.9) {
      const evs = sim.step(dt);
      for (const e of evs) this._onEvent(e);
      // a yield (Y held, sim.yieldDuel) ends the sim between two steps: its 'end' event is cleared by the next
      // step, so the duel used to hang on the frozen pose. Play the ending from the result instead.
      if (sim.over && !this.ended && sim.result) this._onEvent({ type: 'end', winner: sim.result.winner, reason: sim.result.reason });
    }
    if (dt > 0) for (const b of this.brawls) {
      if (!b.sim.over) { b.ai2.update(dt); b.sim.step(dt); }
      if (b.sim.over || Math.abs(b.sim.player.x) > 1.7 || Math.abs(b.sim.enemy.x) > 1.7) {
        // a brawl resolves: reset the pair a little apart
        const s = b.sim; s.over = false; s.result = null; s.player.hp = s.enemy.hp = 99;
        s.player.x = -1.05; s.enemy.x = 1.05; s.player.state = s.enemy.state = 'idle';
      }
    }
    // slow motion on the finishing blow
    if (this.ended) {
      this.endT += real;
      const slow = this.endT < 1.3 ? 0.22 : Math.min(1, 0.22 + (this.endT - 1.3) * 1.5);
      g.timeScale = slow;
      if (this.endT > 3.2 && !this._ended2) { this._ended2 = true; this._complete(); }
    }
    this._sync(dt, real);
  }

  // called from Game.step after ships have moved (hook in core/game.js)
  lateUpdate(dt) { if (this.active) this._camera(dt); }

  _sync(dt, real = dt) {
    const sim = this.sim, p = sim.player, e = sim.enemy;
    const place = (fig, f, x0 = this.lineX, yaw = 0, z0 = 0, flip = false) => {
      const z = (z0 || this.zC) - (flip ? -f.x : f.x);
      fig.group.position.set(x0, this.deckY(z), z);
      fig.group.rotation.set(0, (f.face > 0) !== flip ? Math.PI + yaw : yaw, 0);
    };
    place(this.figP, p); place(this.figE, e);
    if (this.blobs) for (const [b, fig] of [[this.blobs[0], this.figP], [this.blobs[1], this.figE]]) {
      const gp = fig.group.position; b.position.set(gp.x + 0.12, this.deckY(gp.z) + 0.035, gp.z + 0.1);
    }
    this.root.updateMatrixWorld(true);
    this.animP.fromFighter(p, dt, { pressure: sim.pressure(p), result: sim.result });
    this.animE.fromFighter(e, dt, { pressure: sim.pressure(e), result: sim.result });
    // hit flashes
    for (const [fig, f] of [[this.figP, p], [this.figE, e]]) fig.setExpression?.(f.state === 'hit' || f.state === 'stagger' || f.state === 'down' ? 'hurt' : f.state === 'victory' ? 'joy' : (f.state === 'windup' || f.state === 'strike') ? 'attack' : f.state === 'parry' ? 'strain' : f.state === 'taunt' ? 'joy' : 'neutral', real);
    for (const [fig, f] of [[this.figP, p], [this.figE, e]]) fig.flash(Math.max(0, 1 - (sim.time - f.lastHitT) / 0.2) * 0.14);
    // crowd
    const t = this.realT;
    for (const c of this.crowd) {
      if (c.pose !== 'cheer') continue;
      const z = c.z;
      c.fig.group.position.set(c.x, this.deckY(z) + (c.dy || 0), z);
      // face the duel
      const tz = this.zC - (p.x + e.x) * 0.5;
      c.fig.group.rotation.set(0, Math.atan2(-c.x, tz - z), 0);
      c.fig.group.updateMatrixWorld(true);
      const excite = this._excite || 0;
      const ph = t * (3.2 + excite * 3) + c.phase;
      const bob = Math.abs(Math.sin(ph)) * (0.08 + excite * 0.18);
      // the winning side's men jump & wave, the losers deflate
      const mood = this.ended ? ((this.sim.result.winner === 'player') === (c.side > 0) ? 1 : -1) : 0;
      if (mood < 0) c.an.fromPose('rest', real, { crouch: 0.06, lean: 0.2, leftHand: _v.set(0.25, 0.85, 0.05) });
      else if (c.calm && mood === 0) c.an.fromPose('rest', real, { bob: bob * 0.25, crouch: 0.02, lean: -0.04 + excite * 0.06, leftHand: _v.set(0.12 + excite * 0.2, 1.05 + excite * 0.35, 0.22) });   // guests / the watch: hands joined, a start at each touch
      else if (mood > 0 || c.style === 0 || c.style === undefined) c.an.fromPose(Math.sin(c.phase * 3) > -0.2 ? 'cheer' : 'rest', real, { bob: bob + (mood > 0 ? Math.abs(Math.sin(ph * 1.6)) * 0.25 : 0), crouch: 0.04 - bob * 0.4, leftHand: _v.set(0.32, 1.55 + Math.sin(ph + 1.3) * 0.25 + (mood > 0 ? 0.3 : 0), 0.2) });
      // each man his own attitude — both fists pumping, hands on the hips (a fist up when it gets hot),
      // pointing at the fight, shouting through a cupped hand
      else if (c.style === 1) c.an.fromPose('cheer', real, { bob, crouch: 0.04 - bob * 0.4, leftHand: _v.set(0.3, 1.8 + Math.sin(ph + 2.1) * 0.22, 0.16) });
      else if (c.style === 2) c.an.fromPose(excite > 0.35 && Math.sin(ph * 0.7) > 0 ? 'cheer' : 'akimbo', real, { bob: bob * 0.4, crouch: 0.02, lean: -0.06, leftHand: _v.set(0.27, 1.02, -0.02) });
      else if (c.style === 3) c.an.fromPose('point', real, { bob: bob * 0.6, crouch: 0.05, lean: 0.12, leftHand: _v.set(0.27, 1.02 + Math.max(0, Math.sin(ph)) * 0.5, 0.0) });
      else c.an.fromPose('shout', real, { bob: bob * 0.5, crouch: 0.04, lean: 0.08 + Math.sin(ph * 0.5) * 0.05, leftHand: _v.set(0.3, 1.5 + Math.sin(ph + 0.7) * 0.3, 0.25) });
    }
    for (const b of this.brawls) {
      const s = b.sim;
      const fx = (f) => f.x;
      for (const [c, f] of [[b.a, s.player], [b.b, s.enemy]]) {
        const z = b.z - Math.cos(b.yaw) * fx(f), x = b.x - Math.sin(b.yaw) * fx(f);
        c.fig.group.position.set(x, this.deckY(z), z);
        c.fig.group.rotation.set(0, (f.face > 0 ? Math.PI : 0) + b.yaw, 0);
        c.fig.group.updateMatrixWorld(true);
        c.an.fromFighter(f, dt);
      }
    }
    this._excite = Math.max(0, (this._excite || 0) - real * 0.6);
    if (this.trails) { this._updateTrail(this.trails[0], this.animP.swingK, real); this._updateTrail(this.trails[1], this.animE.swingK, real); }
    this._renderHUD();
  }

  // ------------------------------------------------------------------ events / juice
  _onEvent(e) {
    const g = this.game;
    const contact = () => {
      // midpoint of the two blades
      this.figP.mid.getWorldPosition(_v); this.figE.mid.getWorldPosition(_v2);
      return _v.lerp(_v2, 0.5).clone();
    };
    switch (e.type) {
      case 'parry': case 'clash': {
        const pt = contact();
        this._sparks(pt, e.type === 'clash' || e.perfect ? 26 : 14);
        if (this.stage) this.stage.pop(pt, e.perfect ? 30 : 16); else g.fx?.lightPop?.(pt, e.perfect ? 30 : 16, 0.12, 0xffd9a0, 8);
        this.shake(e.perfect || e.type === 'clash' ? 0.32 : 0.16);
        this._clang(e.perfect ? 1.25 : 1);
        this._hitStop = e.perfect || e.type === 'clash' ? 0.075 : 0.045;
        this._excite = Math.min(1, (this._excite || 0) + 0.35);
        if (e.type === 'parry' && e.b === this.sim.player) {
          this._guardFx(e.perfect ? 'perfect' : 'block');
          this._toast(e.perfect ? 'Perfect parry! Riposte!' : 'Parried', e.perfect ? 'good' : 'info');
          if (this._tut && this._tut.step <= 1) this._tutNext(2);
        } else if (e.type === 'parry' && e.perfect) this._toast('Parried! He ripostes', 'bad');
        if (e.b === this.sim.player || e.a === this.sim.player) this._tellE = null;
        g.events.emit('duel:parry', { who: e.b.id, perfect: !!e.perfect });
        break;
      }
      case 'hit': {
        const fig = e.b === this.sim.player ? this.figP : this.figE;
        fig.j.chest.getWorldPosition(_v);
        this._sparks(_v, 6, true);
        this.shake(0.5 + (e.dmg > 1 ? 0.3 : 0));
        this._thud();
        this._excite = 1;
        this._hitStop = 0.09;
        if (e.dmg > 1) this._toast('A hit!', e.a === this.sim.player ? 'good' : 'bad');
        else if (e.b === this.sim.player && e.wrongGuard) this._toast(`Wrong guard: he was aiming at the ${LINE_TEXT[e.height]} line`, 'bad');
        else if (e.b === this.sim.player && e.evadeFail) this._toast(e.evadeFail === 'jump' ? 'Jumping only avoids low cuts' : 'Ducking only avoids high cuts', 'bad');
        if (e.b === this.sim.player) this._tellE = null;
        g.events.emit('duel:hit', { who: e.b.id, dmg: e.dmg });
        break;
      }
      case 'whiff': this._swish(0.6); break;
      case 'windup':
        if (e.a === this.sim.enemy) {
          this._tellE = { h: e.height, t: 0, dur: e.dur };
          if (this._tut) { if (this._tut.step <= 0) this._tutNext(1); if (this._tut && this._tut.slow < 2) { this._tut.slow++; this._tutSlow = true; } }
        } else if (this._tut && this._tut.step === 2) this._tutNext(3);
        break;
      case 'feint': if (e.a === this.sim.enemy && this._tellE) { this._tellE.h = e.height; this._tellE.feint = true; } break;
      case 'evade': {
        this._swish(1.2); this._hitStop = 0.05; this._excite = Math.min(1, (this._excite || 0) + 0.3);
        this._toast(e.b === this.sim.player ? 'Dodged! He is open' : 'He dodges', e.b === this.sim.player ? 'good' : 'bad');
        if (e.b === this.sim.player) this._tellE = null;
        break;
      }
      case 'dodge': if (e.a === this.sim.player) { this._swish(0.5); if (this._tut && this._tut.step === 3) this._tutNext(4); } break;
      case 'tired': if (e.a === this.sim.player) this._toast('Out of breath!', 'bad'); break;
      case 'guardbreak': {
        this.figP.mid.getWorldPosition(_v); this.figE.mid.getWorldPosition(_v2);
        this._sparks(_v.lerp(_v2, 0.5).clone(), 20); this.shake(0.45); this._clang(0.72); this._hitStop = 0.08;
        this._toast(e.b === this.sim.player ? 'Guard broken! Get your breath back' : 'His guard gives way!', e.b === this.sim.player ? 'bad' : 'good');
        if (e.b === this.sim.player) { this._guardFx('break'); this._tellE = null; }
        break;
      }
      case 'tauntDone':
        if (e.stun) { this._toast(e.a === this.sim.player ? 'He staggers, stung to the quick!' : 'Stung to the quick, you stagger!', e.a === this.sim.player ? 'good' : 'bad'); this._excite = 1; }
        break;
      case 'strike': this._swish(1); if (e.a === this.sim.enemy) { if (this._tellE) this._tellE.strike = true; this._tutSlow = false; } break;
      case 'taunt': if (e.a === this.sim.player) this._toast(['“Is that all, señor?”', '“Come on, show me your blade!”', '“My grandmother fences better than that!”'][Math.floor(this.rand() * 3)], 'info'); else this._toast(['“You’ll swing from my yardarm!”', '“Your ship is mine, dog!”', '“Pray, little captain!”'][Math.floor(this.rand() * 3)], 'bad'); break;
      case 'end': {
        this.ended = true; this.endT = 0;
        this.shake(0.9);
        const win = e.winner === 'player';
        const pr = this.stage?.pressed;
        const why = e.reason === 'pressed' ? (pr ? (win ? pr.win : pr.lose) : win ? 'Backed against the rail, he throws down his sword!' : 'Pinned against the mast, you surrender!') : e.reason === 'yield' ? 'You lower your blade and surrender.' : win ? 'The enemy captain collapses!' : 'Run through, you collapse!';
        this._banner(win ? 'Victory' : 'Defeat', why, win);
        break;
      }
    }
  }

  _sparks(pos, n, blood = false) {
    const P = this.game.fx?.glowPS; if (!P) return;
    const p = P.p, r = this.rand;
    for (let i = 0; i < n; i++) {
      p.reset(); p.x = pos.x; p.y = pos.y; p.z = pos.z;
      const sp = blood ? 2 + r() * 2 : 4 + r() * 7;
      const a = r() * Math.PI * 2, el = (r() - 0.3) * 1.6;
      p.vx = Math.cos(a) * Math.cos(el) * sp; p.vy = Math.sin(el) * sp + 1.5; p.vz = Math.sin(a) * Math.cos(el) * sp;
      p.accel = -9.8; p.drag = 1.2; p.frame = 3; p.life = 0.18 + r() * 0.35; p.s0 = blood ? 0.16 : 0.12 + r() * 0.08; p.s1 = 0.04;
      if (blood) { p.r = 1; p.g = 0.45; p.b = 0.3; p.r1 = 0.6; p.g1 = 0.05; p.b1 = 0.02; p.emis = 1.5; }
      else { p.r = 1; p.g = 0.88; p.b = 0.6; p.r1 = 1; p.g1 = 0.4; p.b1 = 0.08; p.emis = 9; }
      p.a = 1; p.fadeIn = 0; p.stretch = 0.035;
      P.emit();
    }
    // a bright flash star at the contact
    if (!blood) { p.reset(); p.x = pos.x; p.y = pos.y; p.z = pos.z; p.frame = 3; p.life = 0.16; p.s0 = 1.4; p.s1 = 0.4; p.r = 1; p.g = 0.92; p.b = 0.7; p.emis = 6; p.a = 1; p.fadeIn = 0; P.emit(); }
  }

  shake(a) { this._shake = Math.min(1.2, this._shake + a); }

  // ------------------------------------------------------------------ camera
  _camera(dt) {
    const g = this.game, cam = g.camera, sim = this.sim;
    const real = g.timeScale > 0 ? dt / g.timeScale : dt;
    const p = sim.player, e = sim.enemy;
    const mx = (p.x + e.x) / 2, gap = Math.abs(e.x - p.x);
    const zMid = this.zOf(mx);
    const deck = this.deckY(zMid);
    // side-on from the near (starboard) quarter, a touch behind the player, low and close
    const view = this._view || 'action';
    // a more open frame (further back and higher, wider lens): the deck, both crews and the gilt screen read
    // same camera place, a longer lens (45° -> 41°): the duellists and their faces fill more of the frame
    let side = 1, dist = 5.3 + gap * 0.45, h = 2.7, lookH = 1.05, along = 1.2, fov = 41;
    if (view === 'parry') { dist = 4.9 + gap * 0.45; h = 2.5; along = 1.0; lookH = 1.12; fov = 39; }
    if (view === 'finish') { dist = 6.2 + gap * 0.45; h = 3.2; along = 0.7; lookH = 1.15; fov = 40; }
    const sc = this.stage?.cam; if (sc) { dist += sc.dist || 0; h += sc.h || 0; lookH += sc.lookH || 0; fov += sc.fov || 0; along += sc.along || 0; }
    if (this.ended) { const k = Math.min(1, this.endT / 1.2); dist -= 0.5 * k; h -= 0.2 * k; fov -= 3 * k; }
    // intro: swoop from high and wide (a short dolly on an indoor / walled stage)
    const ik = clamp(this.introT / 2.2, 0, 1), ie = 1 - Math.pow(1 - ik, 3), sw = this.stage ? this.stage.introK ?? 0.12 : 1;
    dist += (1 - ie) * 26 * sw; h += (1 - ie) * 16 * sw; along += (1 - ie) * 10 * sw;
    const local = _v.set(this.lineX + side * dist, deck + h, zMid + along);
    const look = _v2.set(this.lineX - 0.4, deck + lookH, zMid - 0.15);
    this.model.group.localToWorld(local); this.model.group.localToWorld(look);
    // keep camera above the water, smooth (real time)
    const k = this.camState && real > 0 ? 1 - Math.exp(-real * 5) : 1;
    if (!this.camState) this.camState = { pos: local.clone(), look: look.clone(), fov };
    const cs = this.camState;
    cs.pos.lerp(local, k); cs.look.lerp(look, k); cs.fov += (fov - cs.fov) * k;
    cam.position.copy(cs.pos);
    const wy = this.stage ? -1e9 : g.ocean?.getHeight?.(cam.position.x, cam.position.z) ?? 0;
    if (cam.position.y < wy + 1.2) cam.position.y = wy + 1.2;
    // shake (real time)
    if (real > 0) { this._shake = Math.max(0, this._shake - real * 2.2); this._shakeT += real * 38; }
    const sA = this._shake * this._shake * 0.09;
    cam.position.x += Math.sin(this._shakeT * 1.13) * sA; cam.position.y += Math.sin(this._shakeT * 1.71 + 1) * sA; cam.position.z += Math.sin(this._shakeT * 0.91 + 2) * sA;
    cam.up.set(0, 1, 0);
    cam.lookAt(cs.look);
    cam.rotateZ(Math.sin(this._shakeT * 0.7) * sA * 0.3);
    if (Math.abs(cam.fov - cs.fov) > 0.01) { cam.fov = cs.fov; cam.updateProjectionMatrix(); }
    if (g.cameraRig) { g.cameraRig.target.copy(cs.look); g.cameraRig.fixed = true; g.cameraRig.mode = 'shot'; }
  }

  // ------------------------------------------------------------------ end
  _finish(result) {
    if (this._finished) return; this._finished = true;
    const r = { ...result, stats: { player: this.sim?.player.stats, enemy: this.sim?.enemy.stats } };
    this.result = r;
    this.game.events.emit('duel:end', { result: r });
    try { this.onEnd?.(r); } catch (err) { console.error(err); }
    this._resolve?.(r);
  }
  _complete() {
    const res = this.sim.result;
    this._teardown();
    this._finish(res);
  }
  _teardown() {
    const g = this.game;
    if (!this.active) return;
    this.active = false;
    this.root?.parent?.remove(this.root);
    this.root?.traverse(o => { if (o.isMesh) { o.geometry.dispose(); } });
    for (const t of this.trails || []) { t.mesh.parent?.remove(t.mesh); t.mesh.geometry.dispose(); }
    for (const f of [this.figP, this.figE, ...(this.crowd || []).map(c => c.fig)]) if (f instanceof CaptainFigure) f.dispose();   // per-figure materials
    if (this.stage) this._leaveStage();
    this._dressing?.dispose(); this._dressing = null;
    if (this._rimPrev) { FIGURE_RIM.value.copy(this._rimPrev); this._rimPrev = null; }
    if (this._fillPrev) { setFigureFill(1, this._fillPrev); this._fillPrev = null; }
    this.blobs = null;
    for (const [c, m] of this._crewMeshes || []) c.layers.mask = m;
    for (const grp of this._hiddenShips || []) grp.visible = true;
    this._hiddenShips = [];
    if (this.model && !this._ownModel) this.model.setDuelMode?.(false);
    if (this._ownModel) { g.scene.remove(this._ownModel.group); this._ownModel.dispose?.(); this._ownModel = null; }
    if (this.ship && this._shipCtl !== undefined) this.ship.controller = this._shipCtl;
    const pr = this._prev || {};
    if (g.player && pr.ctl) g.player.controller = pr.ctl;
    g.timeScale = pr.timeScale || 1;
    if (g.cameraRig && g.player) g.cameraRig.follow(g.player);
    g.hud?.show?.(pr.hud !== false);
    g.mode = pr.mode === 'duel' ? 'sail' : (pr.mode || 'sail');
    g.events.emit('state:change', { from: 'duel', to: g.mode });
    this.hud.classList.remove('on');
    this._bannerEl.classList.remove('on');
    this._armsEl?.classList.remove('on'); this._arming = false;
    this._tutEl?.classList.remove('on'); this._tut = null; this._tutSlow = false;
    this._finished = false;
  }

  // ------------------------------------------------------------------ HUD (DOM)
  _buildHUD() {
    const root = this.game.uiRoot || document.body;
    const el = this.hud = document.createElement('div');
    el.className = 'duel-hud';
    const sabre = '<svg viewBox="0 0 24 24" class="pip"><path d="M3 21 L5 19 M6 18 L19 5 Q21 3 21.5 2.5 Q21 5 19 7 L7.5 19.5 Z M4.5 16.5 L8 20 M3.5 20.5 l1 -1" fill="currentColor" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>';
    el.innerHTML = `
      <div class="dh-top">
        <div class="dh-plate me"><div class="dh-name sc"></div><div class="dh-sub"></div><div class="dh-pips"></div><div class="dh-stam"><i></i><span class="sc">Breath</span></div></div>
        <div class="dh-rail"><div class="dh-rail-bar"><i class="mast a"></i><i class="mast b"></i><div class="dh-mark me"></div><div class="dh-mark foe"></div></div><div class="dh-rail-cap sc">The deck</div><div class="dh-crew"></div></div>
        <div class="dh-plate foe"><div class="dh-name sc"></div><div class="dh-sub"></div><div class="dh-pips"></div><div class="dh-stam"><i></i><span class="sc">Breath</span></div></div>
      </div>
      <div class="dh-adv"><div class="dh-adv-crew me"></div><div class="dh-adv-bar"><div class="dh-adv-fill"></div><i class="dh-adv-mid"></i><div class="dh-adv-knob"></div></div><div class="dh-adv-crew foe"></div><div class="dh-adv-cap sc">Advantage</div></div>
      <div class="dh-toasts"></div>
      <div class="dh-tell foe"><b class="g"></b><span class="sc"></span><i class="k"></i></div>
      <div class="dh-tell me"><b class="g"></b><span class="sc"></span></div>
      <div class="dh-tut"><div class="dt-text"></div></div>
      <div class="dh-keys">
        <div class="kgroup">${kc('KeyA', 'key')}${kc('KeyD', 'key')}<span class="lbl">Fall back / advance</span></div>
        <div class="kgroup">${kc('KeyW', 'key')}${kc('KeyS', 'key')}<span class="lbl">High / low line</span></div>
        <div class="kgroup">${kc('KeyJ', 'key big')}<span class="lbl">Cut</span></div>
        <div class="kgroup">${kc('KeyK', 'key big')}<span class="lbl">Parry <i>(hold)</i></span></div>
        <div class="kgroup">${kc('Space', 'key')}<span class="lbl">Dodge <i>(+${kc('KeyA', 'kc')} back off, +${kc('KeyW', 'kc')} jump, +${kc('KeyS', 'kc')} duck)</i></span></div>
        <div class="kgroup">${kc('KeyL', 'key big')}<span class="lbl">Taunt</span></div>
        <div class="kgroup">${kc('KeyY', 'key')}<span class="lbl"><i>hold to surrender</i></span></div>
        <div class="dh-line sc"><span data-l="high">High</span><span data-l="mid">Middle</span><span data-l="low">Low</span></div>
      </div>`;
    this._sabre = sabre;
    root.appendChild(el);
    const b = this._bannerEl = document.createElement('div');
    b.className = 'duel-banner';
    b.innerHTML = '<div class="db-inner"><div class="db-title sc"></div><div class="db-sub"></div></div>';
    root.appendChild(b);
    // weapon choice (before the fight)
    const a = this._armsEl = document.createElement('div');
    a.className = 'duel-arms';
    const bar = (v) => `<span class="bar"><i style="width:${Math.round(Math.max(0.08, Math.min(1, v)) * 100)}%"></i></span>`;
    a.innerHTML = `<div class="da-inner"><div class="da-title sc">Choose your blade</div><div class="da-cards">${ARMS.map((w, i) => {
      const W = WEAPONS[w.id];
      return `<div class="da-card" data-i="${i}"><div class="da-num sc">${i + 1}</div><div class="da-name sc">${w.name}</div><div class="da-desc">${w.desc}</div>
        <div class="da-stats"><div>Speed ${bar(0.78 / W.windup)}</div><div>Impact ${bar(W.dmg * W.push / 2.3)}</div><div>Breath ${bar(0.8 / W.stamina)}</div></div></div>`;
    }).join('')}</div><div class="da-hint">← → or ${kc('KeyA', 'kc')} ${kc('KeyD', 'kc')} to choose · Enter or ${kc('KeyJ', 'kc')} to cross swords</div></div>`;
    for (const c of a.querySelectorAll('.da-card')) {
      c.addEventListener('mouseenter', () => { this._armSel = +c.dataset.i; this._armsMark(); });
      c.addEventListener('click', () => { this._armSel = +c.dataset.i; this._chooseArms(); });
    }
    root.appendChild(a);
    this._tutEl = el.querySelector('.dh-tut');
    this._q = s => el.querySelector(s);
  }
  _renderHUD(force) {
    if (!this.sim) return;
    const s = this.sim, q = this._q;
    const key = [s.player.hp, s.enemy.hp, s.player.momentum, s.enemy.momentum, this._line].join();
    if (force) {
      q('.dh-plate.me .dh-name').textContent = this.game.state?.name && this.game.state.name !== 'Captain' ? `Capt. ${this.game.state.name}` : 'Your captain';
      q('.dh-plate.me .dh-sub').textContent = this.game.player?.name ? ofName(this.game.player.name) : '';
      q('.dh-plate.foe .dh-name').textContent = this.opponent.name;
      const diff = this.opponent.difficulty ?? 0.5;
      const r = s.crewRatio ?? 1, cr = q('.dh-crew');
      cr.textContent = `Crew ${Math.round(s.crewPlayer)} against ${Math.round(s.crewEnemy)}`;
      cr.className = 'dh-crew' + (r > 1.1 ? ' good' : r < 0.9 ? ' bad' : '');
      q('.dh-adv-crew.me').innerHTML = `<b>${Math.round(s.crewPlayer)}</b> men`;
      q('.dh-adv-crew.foe').innerHTML = `<b>${Math.round(s.crewEnemy)}</b> men`;
      for (const el of [cr, q('.dh-adv-crew.me'), q('.dh-adv-crew.foe')]) el.style.visibility = this.stage ? 'hidden' : '';   // off deck: no crews
      q('.dh-plate.me .dh-sub').textContent = [this.game.player?.name ? ofName(this.game.player.name) : '', s.player.weapon.name].filter(Boolean).join(' · ');
      q('.dh-plate.foe .dh-sub').textContent = `${s.enemy.weapon.name} · ${this.opponent.faction === 'pirate' ? 'Pirate' : nationName(this.opponent.faction)} · ${diff < 0.3 ? 'clumsy swordsman' : diff < 0.6 ? 'honest blade' : diff < 0.85 ? 'seasoned duellist' : 'master of arms'}`;
    }
    if (key !== this._hudKey || force) {
      this._hudKey = key;
      const pips = (f) => Array.from({ length: f.maxHp }, (_, i) => `<span class="${i < f.hp ? 'full' : 'lost'}">${this._sabre}</span>`).join('') + (f.momentum ? '<b class="fury sc">Fury</b>' : '');
      q('.dh-plate.me .dh-pips').innerHTML = pips(s.player);
      q('.dh-plate.foe .dh-pips').innerHTML = pips(s.enemy);
      for (const sp of this.hud.querySelectorAll('.dh-line span')) sp.classList.toggle('on', sp.dataset.l === (this._line || 'mid'));
    }
    const half = s.length / 2;
    const pct = x => ((x + half) / (2 * half) * 100).toFixed(1) + '%';
    q('.dh-mark.me').style.left = pct(s.player.x);
    q('.dh-mark.foe').style.left = pct(s.enemy.x);
    q('.dh-rail').classList.toggle('danger', s.pressure(s.player) > 0.7);
    // advantage gauge: touches left (half) + ground held (half), eased; -1 = the enemy dominates, +1 = we do
    const hpD = s.player.hp / s.player.maxHp - s.enemy.hp / s.enemy.maxHp;
    const adv = Math.max(-1, Math.min(1, hpD * 0.6 + (s.pressure(s.enemy) - s.pressure(s.player)) * 0.4 + (s.player.momentum ? 0.1 : 0) - (s.enemy.momentum ? 0.1 : 0)));
    this._adv = (this._adv ?? adv) + (adv - (this._adv ?? adv)) * 0.12;
    const ap = (50 + this._adv * 50).toFixed(1) + '%';
    q('.dh-adv-fill').style.width = ap; q('.dh-adv-knob').style.left = ap;
    q('.dh-adv').classList.toggle('win', this._adv > 0.25); q('.dh-adv').classList.toggle('lose', this._adv < -0.25);
    // stamina (souffle)
    for (const [sel, f] of [['.dh-plate.me .dh-stam', s.player], ['.dh-plate.foe .dh-stam', s.enemy]]) {
      const st = q(sel), k = f.stamina / STAMINA.max;
      st.firstElementChild.style.width = (k * 100).toFixed(1) + '%';
      st.classList.toggle('low', k < 0.25);
    }
    this._renderTells();
  }
  // the tell: a discreet chip over the enemy's head while he winds up (line aimed + a fill for the time left),
  // and the player's own guard / cut over his head
  _renderTells() {
    const s = this.sim, cam = this.game.camera, q = this._q;
    const W = this.hud.clientWidth || innerWidth, H = this.hud.clientHeight || innerHeight;
    const place = (el, fig, show, line, label, k) => {
      if (!show || this.ended || this.introT < 1) { el.classList.remove('on'); return; }
      (fig.j?.head || fig.group).getWorldPosition(_v3); _v3.y += fig.j?.head ? 0.42 : 2.3;
      _v3.project(cam);
      if (_v3.z > 1) { el.classList.remove('on'); return; }
      el.style.transform = `translate(${((_v3.x + 1) / 2 * W).toFixed(0)}px, ${((1 - _v3.y) / 2 * H).toFixed(0)}px) translate(-50%, -100%)`;
      el.classList.add('on');
      el.dataset.l = line;
      const g = el.querySelector('.g'), sp = el.querySelector('span');
      g.textContent = line === 'high' ? '▲' : line === 'low' ? '▼' : '◆';
      sp.textContent = label;
      const ki = el.querySelector('.k'); if (ki) ki.style.width = (Math.min(1, k) * 100).toFixed(0) + '%';
    };
    const e = s.enemy, p = s.player;
    const eAtk = e.state === 'windup' || e.state === 'strike';
    place(q('.dh-tell.foe'), this.figE, eAtk, e.height, `Cut · ${LINE_TEXT[e.height]}`, e.state === 'windup' ? e.t / e.dur : 1);
    q('.dh-tell.foe').classList.toggle('feint', !!this._tellE?.feint && eAtk);
    const pShow = p.state === 'parry' || p.state === 'windup' || (p.state === 'dodge');
    const pLbl = p.state === 'parry' ? `Guard · ${LINE_TEXT[p.height]}` : p.state === 'windup' ? `Cut · ${LINE_TEXT[p.height]}` : p.dodgeKind === 'jump' ? 'Jump' : p.dodgeKind === 'duck' ? 'Ducked' : 'Dodge';
    place(q('.dh-tell.me'), this.figP, pShow, p.state === 'dodge' ? (p.dodgeKind === 'jump' ? 'high' : p.dodgeKind === 'duck' ? 'low' : 'mid') : p.height, pLbl, 1);
    q('.dh-tell.me').classList.toggle('dodge', p.state === 'dodge');
  }
  _guardFx(kind) {
    const el = this._q('.dh-tell.me');
    el.classList.remove('block', 'perfect', 'break'); void el.offsetWidth; el.classList.add(kind);
    const ln = this._q('.dh-line'); ln.classList.remove('block', 'perfect', 'break'); void ln.offsetWidth; ln.classList.add(kind);
  }

  // ------------------------------------------------------------------ weapon choice
  _showArms() { this._armsMark(); this._armsEl.classList.add('on'); this.hud.classList.add('arming'); }
  _armsMark() { for (const c of this._armsEl.querySelectorAll('.da-card')) c.classList.toggle('sel', +c.dataset.i === this._armSel); }
  _armsInput() {
    const inp = this.game.input; if (!inp) return;
    const n = ARMS.length;
    if (inp.pressed('ArrowLeft') || inp.pressed('KeyA')) { this._armSel = (this._armSel + n - 1) % n; this._armsMark(); }
    if (inp.pressed('ArrowRight') || inp.pressed('KeyD')) { this._armSel = (this._armSel + 1) % n; this._armsMark(); }
    for (let i = 0; i < n; i++) if (inp.pressed('Digit' + (i + 1)) || inp.pressed('Numpad' + (i + 1))) { this._armSel = i; this._chooseArms(); return; }
    if (inp.pressed('Enter') || inp.pressed('NumpadEnter') || inp.pressed('KeyJ') || inp.pressed('Space')) this._chooseArms();
  }
  _chooseArms() {
    if (!this._arming) return;
    const id = ARMS[this._armSel].id;
    this._arming = false;
    this._armsEl.classList.remove('on'); this.hud.classList.remove('arming');
    this.sim.player.setWeapon(id);
    if (this.game.state) this.game.state.duelWeapon = id;
    this._setPlayerBlade(id);
    this._renderHUD(true);
    this._tutNext(0);
  }
  _setPlayerBlade(id) {
    const old = this.figP;
    if (!(old instanceof CaptainFigure) || old.o.blade === id) return;
    const fig = new CaptainFigure({ ...this._lookP, seed: 3, height: 1.0, blade: id });
    this.root.remove(old.group); old.dispose?.();
    this.root.add(fig.group);
    this.figP = fig; this.animP = new FencerAnimator(fig);
    if (this.stage) this._stageSteel();
    if (this.trails) { this.trails[0].fig = fig; this.trails[0].hist = []; }
    this._sync(0, 0);
  }

  // ------------------------------------------------------------------ first-duel tutorial (contextual hints)
  _tutNext(step) {
    const T = this._tut; if (!T || step <= T.step) return;
    T.step = step; T.t = 0;
    const K = (c) => kc(c, 'kc');
    const txt = [
      'Read your opponent: when he winds up his cut, a sign above his head shows the line he aims at (▲ high, ◆ middle, ▼ low).',
      `Parry: hold ${K('KeyK')}, with ${K('KeyW')} for the high line or ${K('KeyS')} for the low one (nothing = middle).`,
      `A parry raised at the last moment is perfect: he staggers. Riposte at once with ${K('KeyJ')}!`,
      `${K('Space')}: dodge aside. ${K('KeyA')} + ${K('Space')} backs off, ${K('KeyW')} + ${K('Space')} jumps a low cut, ${K('KeyS')} + ${K('Space')} ducks under a high cut. Every dodge costs breath.`,
      `${K('KeyL')}: taunt. If he does not strike you meanwhile, he staggers for a moment and your next blow hits twice as hard.`,
    ][step];
    if (!txt) { this._tutDone(); return; }
    this._tutEl.querySelector('.dt-text').innerHTML = txt;
    this._tutEl.classList.remove('on'); void this._tutEl.offsetWidth; this._tutEl.classList.add('on');
  }
  _tutUpdate(real) {
    const T = this._tut;
    if (!this.ended) this.game.timeScale = this._tutSlow ? 0.45 : 1;   // the first two enemy wind-ups in slow motion
    if (!T || T.step < 0) return;
    T.t += real;
    const limit = [12, 10, 7, 9, 8][T.step] ?? 8;
    if (T.t > limit) { if (T.step === 0) return; this._tutNext(T.step + 1); }
  }
  _tutDone() {
    _tutSeen = true;
    const st = this.game.state; if (st) (st.tutorials ||= {}).duel = true;
    this._tut = null; this._tutSlow = false;
    this._tutEl.classList.remove('on');
  }
  _toast(text, kind = 'info') {
    const box = this._q('.dh-toasts');
    const d = document.createElement('div'); d.className = 'dh-toast ' + kind; d.textContent = text;
    box.prepend(d);
    while (box.children.length > 3) box.lastElementChild.remove();
    setTimeout(() => d.classList.add('out'), 1600);
    setTimeout(() => d.remove(), 2300);
  }
  _banner(title, sub, win) {
    const b = this._bannerEl;
    b.querySelector('.db-title').textContent = title; b.querySelector('.db-sub').textContent = sub;
    b.classList.toggle('lose', !win); b.classList.add('on');
  }

  // ------------------------------------------------------------------ sound (tiny WebAudio synth)
  _ac() { const a = this.game.audio; return a?.ctx ? { ctx: a.ctx, out: a.duck || a.out || a.ctx.destination } : null; }
  _clang(k = 1) {
    const A = this._ac(); if (!A) return;
    const { ctx, out } = A, t = ctx.currentTime;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 * k, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    g.connect(out);
    for (const f of [1780, 2630, 3910, 5270]) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * (0.97 + Math.random() * 0.06) * k; o.connect(g); o.start(t); o.stop(t + 0.62); }
  }
  _swish(k = 1) {
    const A = this._ac(); if (!A) return;
    const { ctx, out } = A, t = ctx.currentTime;
    const n = ctx.createBufferSource(), buf = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / d.length);
    n.buffer = buf; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.2); f.Q.value = 1.5;
    const g = ctx.createGain(); g.gain.value = 0.18 * k; n.connect(f); f.connect(g); g.connect(out); n.start(t);
  }
  _thud() {
    const A = this._ac(); if (!A) return;
    const { ctx, out } = A, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.18);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.26);
  }
}
export { TIMING };
