// The people of the night town: the captain and the guards as articulated figures (lite CaptainFigures, one per
// look, cloned for every guard) moved by the locomotion animator. Built when a sneak scene starts, disposed with it.
//   const a = new SneakActors(scene, { coat, nation, maxGuards })
//   a.update(sim, dt, camera) -> torches [{ x, y, z, heading }] (the raised hands of the torch bearers)
//   a.throwStone()   (the captain's throwing arm)      a.stats() -> { tris, calls } per figure      a.dispose()
//   a.reactGuard(id, 'flinch' | 'point')   a guard's reaction (startled when he spots you, pointing when he gives the alarm)
// sim: { player: { x, z, heading, moving, run, picking, hidden }, guards: [{ x, z, heading, down, torch, state, wait, sus, kneelT }] }
// A guard kneels over a knocked-out comrade while kneelT > 0; he looks around when searching.
// Each figure: one skinned mesh (one material), its ink contour and its shadow: 3 draw calls.
import * as THREE from 'three';
import { CaptainFigure, LOOKS, liteFigureMaterials } from '../duel/figure.js';
import { GaitAnimator, cloneFigure } from '../duel/locomotion.js';

const SCALE = 1.9, CAP_SCALE = 1.95, DETAIL = 0.4;
// guards' facings and breeches by nation (the coat is the garrison's colour)
const NATION = {
  english: { trim: '#e2bc62', lapel: '#f0e6cc', breeches: '#e6dcc0' },
  spanish: { trim: '#8a1e1e', lapel: '#8a1e1e', breeches: '#3a2a20' },
  french:  { trim: '#e8d394', lapel: '#c8bfa8', breeches: '#e8e0cc' },
  dutch:   { trim: '#2c2620', lapel: '#d8cfb8', breeches: '#2c2620' },
  pirate:  { trim: '#b38b4a', lapel: '#5b1a1a', breeches: '#4a3a2a' },
};
const _sph = new THREE.Sphere(), _fr = new THREE.Frustum(), _pm = new THREE.Matrix4(), _h = new THREE.Vector3();
const angTo = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export class SneakActors {
  constructor(scene, { coat = '#555555', nation = 'spanish', maxGuards = 12 } = {}) {
    this.scene = scene; this.maxG = maxGuards;
    this.mats = liteFigureMaterials();
    const lite = this.mats, nl = NATION[nation] || NATION.spanish;
    const guard = (seed, extra) => new CaptainFigure({ coat, trim: nl.trim, lapel: nl.lapel, waistcoat: nl.lapel, breeches: nl.breeches, hat: 'morion', tool: 'musket', sword: false, fists: true,
      moustache: true, expr: 'stern', epaulette: false, headScale: 1.3, detail: DETAIL, lite, seed, ...extra });
    this.templates = [guard(11, { skin: '#c99272' }), guard(23, { skin: '#a8704e', beard: true, hair: '#1a1410', bulk: 1.08 })];
    this.capFig = new CaptainFigure({ ...LOOKS.player, sheathed: true, cutlass: true, headScale: 1.3, detail: DETAIL, lite, seed: 3 });
    const mk = (fig, scale, seed) => {
      const rig = cloneFigure(fig); rig.group.scale.setScalar(scale); scene.add(rig.group);
      return { rig, anim: new GaitAnimator(rig, { scale, seed }), x: null, z: null, speed: 0, h: null };
    };
    this.cap = mk(this.capFig, CAP_SCALE, 5);
    this.guards = [];
    for (let i = 0; i < maxGuards; i++) { const a = mk(this.templates[i % 2], SCALE * (0.97 + (i * 0.37 % 1) * 0.06), i + 1); a.rig.group.visible = false; this.guards.push(a); }
    this._torches = [];
  }

  throwStone() { this.cap.anim.throw(); }
  reactGuard(id, kind) { this.guards[id]?.anim.react(kind); }

  // triangles and draw calls of one figure (the guard's)
  stats() {
    let tris = 0, calls = 0;
    this.guards[0].rig.group.traverse(o => { if (o.isMesh) { const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; calls += 1 + (o.castShadow ? 1 : 0); } });
    return { tris: Math.round(tris / 2), calls };   // the contour shares the body's geometry
  }

  update(sim, dt, camera) {
    if (camera) { _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm); }
    const onScreen = (x, z) => !camera || _fr.intersectsSphere(_sph.set(_h.set(x, 2, z), 9));   // margin: the moon shadow
    // speed from the distance actually covered (no sliding feet); a jump (placed by a script) is no step
    const track = (a, x, z) => {
      let d = a.x == null ? 0 : Math.hypot(x - a.x, z - a.z); if (d > 3) d = 0;
      a.x = x; a.z = z;
      if (dt > 0) a.speed += (d / dt - a.speed) * (1 - Math.exp(-dt * 12));
      return d;
    };
    // the captain: sneaks, runs, crouches in his hiding spot (facing out of it), kneels at the lock
    const p = sim.player, c = this.cap, cg = c.rig.group;
    const dC = track(c, p.x, p.z);
    const face = p.hidden ? Math.atan2(-p.hidden.nx, -p.hidden.nz) : p.heading;
    c.h = c.h == null ? face : c.h + angTo(c.h, face) * (1 - Math.exp(-dt * 14));
    cg.position.set(p.x, 0, p.z); cg.rotation.y = c.h;
    cg.visible = onScreen(p.x, p.z);
    if (cg.visible) c.anim.update(dt, { speed: p.moving ? c.speed : 0, dist: p.moving ? dC : 0, gait: p.run ? 'run' : 'sneak', pose: p.hidden ? 'hide' : p.picking ? 'work' : 'stand', look: 'calm' });
    // guards
    const T = this._torches; T.length = 0;
    let n = 0;
    for (const g of sim.guards) {
      if (n >= this.maxG) break;
      const a = this.guards[n++], gg = a.rig.group;
      const d = track(a, g.x, g.z);
      gg.position.set(g.x, 0, g.z); gg.rotation.y = g.heading;
      gg.visible = onScreen(g.x, g.z);
      if (!gg.visible) continue;
      const chase = g.state === 'chase', moving = !g.down && a.speed > 0.3;
      const look = g.down ? 'calm' : (g.state === 'look' || g.state === 'investigate' || g.state === 'lured' || (chase && !moving)) ? 'search' : (!moving && (g.state === 'post' || g.wait > 0)) ? 'sentry' : 'calm';
      a.anim.update(dt, { speed: moving ? a.speed : 0, dist: moving ? d : 0, gait: chase && a.speed > 3 ? 'run' : 'walk', pose: g.down ? 'down' : g.kneelT > 0 ? 'kneel' : 'stand', look,
        carry: g.torch && !g.down ? 'torch' : chase ? 'port' : 'musket' });
      if (g.torch && !g.down) { const hp = a.anim.handPoint('r', _h); T.push({ x: hp.x, y: hp.y, z: hp.z, heading: g.heading }); }
    }
    for (let i = n; i < this.maxG; i++) this.guards[i].rig.group.visible = false;
    return T;
  }

  dispose() {
    for (const a of [this.cap, ...this.guards]) { this.scene.remove(a.rig.group); a.rig.group.traverse(o => { if (o.isSkinnedMesh) o.skeleton.dispose(); }); }
    // every geometry under the figures (outline shells, blade, scabbard, musket are not all in f.meshes)
    const geos = new Set();
    for (const f of [this.capFig, ...this.templates]) { f.group.traverse(o => { if (o.geometry) geos.add(o.geometry); }); f.dispose(); }
    for (const g of geos) g.dispose();
    this.mats.dispose();
  }
}
