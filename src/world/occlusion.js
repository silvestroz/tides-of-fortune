// Ships hidden behind islands are not drawn. API: new ShipOcclusion(game) (a system: update(dt) each step);
// occlusion.hidden (Set of the ships it hid); occlusion.stats -> { tested, hidden }. ?occlusion=0 disables.
// Steps: in sea mode only ('sail'), a few ships per frame (round robin, PER_FRAME), each farther than MIN_DIST from the
// camera and not the player's, are tested with four rays from the camera — to the mast tops at bow, midships and
// stern, and to the hull at the waterline — marched over the island heightfield (islands.shape.height) every STEP m.
// A ray is blocked when the ground rises MARGIN m above it somewhere (the rendered terrain LOD may sit a few metres
// off the grid). All blocked on two tests in a row -> model.group.visible = false; one clear ray -> shown again at
// once. Leaving sea mode (duel, port, map…) shows every ship it hid; a ship hidden by another system (duel deck) is
// left alone. A hidden ship still sails and fights; it casts no shadow (behind an island, out of the shadow box).
// What it saves is mostly draw calls (~5 per ship): ships that far are already on their light LOD.
import * as THREE from 'three';

const PER_FRAME = 6, MIN_DIST = 300, STEP = 30, MARGIN = 3;

export class ShipOcclusion {
  constructor(game) {
    this.game = game;
    this.enabled = game.params.get('occlusion') !== '0';
    this.hidden = new Set();
    this._i = 0;
    this.stats = { tested: 0, hidden: 0 };
  }

  update() {
    const g = this.game;
    if (!this.enabled || g.mode !== 'sail' || !g.islands?.shape) { this._showAll(); return; }
    const ships = g.ships, n = ships.length;
    if (!n) return;
    const cam = g.camera.position;
    for (let k = 0; k < Math.min(PER_FRAME, n); k++) {
      const s = ships[this._i++ % n];
      if (!s || s.isPlayer || !s.model?.group) continue;
      const grp = s.model.group;
      const dx = s.position.x - cam.x, dz = s.position.z - cam.z;
      if (dx * dx + dz * dz < MIN_DIST * MIN_DIST || s.sinking) { this._show(s); continue; }
      if (!grp.visible && !this.hidden.has(s)) continue;   // hidden by someone else: not ours
      this.stats.tested++;
      const top = s._occTop ??= this._topOf(s);
      // mast tops at bow, midships and stern (a bowsprit or mizzen peeks out before the main mast), hull at the waterline
      const P = s.position, hx = Math.sin(s.heading) * s.length * 0.5, hz = -Math.cos(s.heading) * s.length * 0.5;
      const blocked = this._blocked(cam, P.x, P.y + top, P.z) && this._blocked(cam, P.x + hx, P.y + top, P.z + hz)
        && this._blocked(cam, P.x - hx, P.y + top, P.z - hz) && this._blocked(cam, P.x, P.y + 1.5, P.z);
      if (!blocked) { s._occN = 0; this._show(s); continue; }
      s._occN = (s._occN || 0) + 1;
      if (s._occN >= 2 && grp.visible) { grp.visible = false; this.hidden.add(s); }
    }
    for (const s of this.hidden) if (!ships.includes(s)) this.hidden.delete(s);   // removed from the world
    this.stats.hidden = this.hidden.size;
  }

  // height of the masts above the ship's origin (model bounds, measured once)
  _topOf(s) {
    const box = new THREE.Box3().setFromObject(s.model.group);
    return Math.max(8, Math.min(70, box.max.y - s.position.y));
  }

  _blocked(c, x, y, z) {
    const h = this.game.islands.shape;
    const dx = x - c.x, dy = y - c.y, dz = z - c.z, L = Math.hypot(dx, dz);
    const steps = Math.min(80, Math.max(2, Math.ceil(L / STEP)));
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      if (f * L < 20 || (1 - f) * L < 25) continue;   // not right at the camera nor in the ship's own lee
      if (h.height(c.x + dx * f, c.z + dz * f) > c.y + dy * f + MARGIN) return true;
    }
    return false;
  }

  _show(s) { if (this.hidden.delete(s)) s.model.group.visible = true; }
  _showAll() { for (const s of this.hidden) s.model.group.visible = true; this.hidden.clear(); this.stats.hidden = 0; }
}
