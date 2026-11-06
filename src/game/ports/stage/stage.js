// PortStage: shows one location stage at a time by taking over the frame's render via game.renderOverride
// (additive hook in Game.frame). show(kind) builds the stage (disposing the previous one) and returns a promise
// resolved once its shader programs are compiled (perf 24/10 : rendered from then on); show(null) hands
// rendering back to the world (the harbour vista). Uses real time for animation, so it plays while the sim is frozen.
import { setFigureFill } from '../../duel/figure.js';
import { Kit } from './kit.js';
import { BUILDERS } from './scenes.js';
import { precompile } from '../../../core/precompile.js';

export class PortStage {
  constructor(game) { this.game = game; this.cur = null; this.kind = null; }

  show(kind, port) {
    if (kind === this.kind && this.cur) return;
    this.clear();
    const B = BUILDERS[kind];
    if (!B) return;
    const kit = new Kit(1000 + (port?.id?.length || 0) * 31 + kind.length);
    const st = B({ kit, port, game: this.game });
    st.kit = kit; st.t0 = performance.now(); st.last = st.t0;
    st.base = st.camera.position.clone();
    this._shadows(st);
    this.cur = st; this.kind = kind;
    const g = this.game, r = g.renderer;
    this._exp = r.toneMappingExposure;
    g.renderOverride = () => this._render();
    // the set's programs compile in parallel before its first render; the previous image stays on screen
    // (under ports.goto's fade, which waits for this promise) instead of a freeze on first render
    st.ready = false;
    return (this.ready = precompile(r, st.scene, st.camera, { shadows: !!st.shadows }).then(() => { st.ready = true; }));
  }

  // compiles a set without showing it (game.warmupRare, during the title screen); its programs stay alive
  // (game._pinPrograms): the first visit to the market, the tavern… compiles nothing any more
  static warmup(game, kind, port = game.islands?.ports?.find(p => !p.haven)) {
    if (!BUILDERS[kind] || !port) return;
    const ps = new PortStage(game), r = game.renderer, ro = game.renderOverride, rt0 = r.getRenderTarget(), exp = r.toneMappingExposure;
    try {
      ps.show(kind, port);
      const st = ps.cur;
      if (st) { const sh = r.shadowMap.enabled; r.shadowMap.enabled = !!st.shadows; r.setRenderTarget(null); r.compile(st.scene, st.camera); r.shadowMap.enabled = sh; }
    } catch (e) { console.warn('warmup stage', kind, e); }
    try { ps.clear(); } catch (e) { console.warn('warmup stage clear', kind, e); }
    game.renderOverride = ro; r.setRenderTarget(rt0); r.toneMappingExposure = exp;
  }

  // soft key-light shadows: strongest directional light casts a high-res PCF shadow (wide radius = soft edge,
  // no stair-stepping), framed tightly around the subject; every opaque standard mesh casts and receives
  _shadows(st) {
    let key = null;
    st.scene.traverse(o => { if (o.isDirectionalLight && (!key || o.intensity > key.intensity)) key = o; });
    if (!key) return;
    key.castShadow = true;
    const sh = key.shadow; sh.mapSize.set(2048, 2048); sh.radius = 6; sh.blurSamples = 16; sh.bias = -0.0004; sh.normalBias = 0.04;
    key.target.position.copy(st.look); st.scene.add(key.target);
    const R = st.shadowR ?? 22, c = sh.camera; c.left = c.bottom = -R; c.right = c.top = R; c.near = 0.5;
    c.far = key.position.distanceTo(st.look) + R * 2; c.updateProjectionMatrix();
    st.scene.traverse(o => { if (o.isMesh && !o.isInstancedMesh && o.material && !o.material.transparent && !o.material.isMeshBasicMaterial) { o.castShadow = o.castShadow || o.geometry.type !== 'PlaneGeometry'; o.receiveShadow = true; }
      else if ((o.isInstancedMesh || o.isSkinnedMesh) && !o.userData.noCast) { o.castShadow = true; o.receiveShadow = true; } });   // noCast: the characters' ink outline
    st.shadows = true;
  }

  _render() {
    const st = this.cur, g = this.game, r = g.renderer;
    if (!st || st.ready === false) return;
    const now = performance.now(), t = (now - st.t0) / 1000, dt = Math.min(0.1, (now - st.last) / 1000); st.last = now;
    const W = innerWidth, H = innerHeight, cam = st.camera;
    if (cam.aspect !== W / H || st._w !== W) {
      cam.aspect = W / H; st._w = W;
      // push the subject into the left part of the frame (UI column sits on the right)
      cam.setViewOffset(W, H, W * 0.17, 0, W, H);
      cam.updateProjectionMatrix();
      st.refit?.();   // the shipyard re-frames its ship for the new aspect
    }
    cam.position.set(st.base.x + Math.sin(t * 0.11) * st.sway, st.base.y + Math.sin(t * 0.07) * st.sway * 0.25, st.base.z + Math.cos(t * 0.09) * st.sway * 0.5);
    cam.lookAt(st.look);
    for (const u of st.kit.updaters) u(t, dt);
    r.toneMappingExposure = st.exposure ?? 1;
    const sh = r.shadowMap.enabled; r.shadowMap.enabled = !!st.shadows; if (st.shadows) r.shadowMap.needsUpdate = true;
    const fp = setFigureFill(st.fill ?? 0.13);   // the extras' lamp, faces out of the shadow
    r.render(st.scene, cam);
    setFigureFill(1, fp);
    r.shadowMap.enabled = sh;
  }

  clear() {
    const g = this.game;
    if (this.cur) {
      this.cur.kit.dispose();
      this.cur.scene.traverse(o => { if (o.isLight && o.dispose) o.dispose(); });
      this.cur = null;
      if (this._exp != null) g.renderer.toneMappingExposure = this._exp;
    }
    this.kind = null;
    if (g.renderOverride) g.renderOverride = null;
  }
}
