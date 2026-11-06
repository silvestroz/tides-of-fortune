// Procedural kit for the port location stages: canvas textures, props (barrels, crates, tables, lanterns, fire),
// and stylized period NPCs with idle animation. Everything is built into a Kit that tracks its resources so a
// whole stage can be disposed in one call.
// API: const k = new Kit(seed); k.tex.planks/cobble/plaster/...; k.mat(color, opts); k.box/cyl/...; k.npc(opts) -> { group, update(t) }
//      k.glow(color, size), k.lantern(opts), k.fire(), k.barrel(), k.crate(), k.table(), k.stool(), k.mug(), k.bottle()
//      k.updaters (array of fn(t, dt)); k.dispose()
import * as THREE from 'three';
import { mulberry32 } from '../../../core/rng.js';
import { CaptainFigure, LOOKS } from '../../duel/figure.js';

const TAU = Math.PI * 2;

function canvas(size, draw, h = size) {
  const c = document.createElement('canvas'); c.width = size; c.height = h;
  draw(c.getContext('2d'), size, h);
  return c;
}

export class Kit {
  constructor(seed = 7) {
    this.r = mulberry32(seed);
    this._res = new Set();
    this.updaters = [];
    this._mats = new Map();
    const tex = this.tex = {};
    const lazy = (k, fn) => Object.defineProperty(tex, k, { get: () => (tex['_' + k] ||= this._track(fn())), configurable: true });
    lazy('planks', () => this._ctex(this._planks('#6b4423', 6)));
    lazy('darkPlanks', () => this._ctex(this._planks('#3e2614', 7)));
    lazy('cobble', () => this._ctex(this._cobble()));
    lazy('plaster', () => this._ctex(this._plaster('#e2d2ae')));
    lazy('marble', () => this._ctex(this._marble()));
    lazy('stripes', () => this._ctex(this._stripes('#b8332a', '#efe2c0')));
    lazy('stripesB', () => this._ctex(this._stripes('#2f5a8a', '#efe2c0')));
    lazy('cloth', () => this._ctex(this._noise(128, 200, 255)));
    lazy('rug', () => this._ctex(this._rug(), false));
    lazy('roof', () => this._ctex(this._roof()));
    lazy('glow', () => this._ctex(this._radial(), false));
    lazy('flame', () => this._ctex(this._flame(), false));
    lazy('ledger', () => this._ctex(this._ledger(), false));
    lazy('stone', () => this._ctex(this._stone()));
  }

  // ------------- resources -------------
  _track(o) { this._res.add(o); return o; }
  _ctex(c, rep = true) {
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    if (rep) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      // procedural normal map from the painted luminance (joints and grain read in relief under the key light)
      const n = new THREE.CanvasTexture(this._normalFrom(c)); n.wrapS = n.wrapT = THREE.RepeatWrapping; n.anisotropy = 4;
      t.userData.normal = this._track(n);
    }
    return t;
  }
  _normalFrom(src, k = 2.2) {
    const w = src.width, h = src.height, d = src.getContext('2d').getImageData(0, 0, w, h).data;
    const L = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) L[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.55 + d[i * 4 + 2] * 0.15) / 255;
    return canvas(w, (c) => {
      const img = c.createImageData(w, h), o = img.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const at = (xx, yy) => L[((yy + h) % h) * w + ((xx + w) % w)];
        const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) * k;
        const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) * k;
        const il = 1 / Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
        o[i] = (-dx * il * 0.5 + 0.5) * 255; o[i + 1] = (dy * il * 0.5 + 0.5) * 255; o[i + 2] = (il * 0.5 + 0.5) * 255; o[i + 3] = 255;
      }
      c.putImageData(img, 0, 0);
    }, h);
  }
  tiled(base, rx, ry) {
    const t = base.clone(); t.repeat.set(rx, ry); t.needsUpdate = true;
    if (base.userData.normal) { const n = base.userData.normal.clone(); n.repeat.set(rx, ry); n.needsUpdate = true; t.userData = { normal: this._track(n) }; }
    return this._track(t);
  }
  mat(color, o = {}) {
    // build the key by hand: JSON.stringify would call Texture.toJSON() (canvas -> data URL) before any replacer, ~minutes on software GL
    let key = String(color);
    for (const k in o) { const v = o[k]; key += '|' + k + ':' + (v && v.isTexture ? v.uuid : v); }
    if (this._mats.has(key)) return this._mats.get(key);
    const m = this._track(new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0, map: o.map || null,
      emissive: o.emissive || 0x000000, emissiveIntensity: o.ei ?? 1, side: o.side ?? THREE.FrontSide, transparent: !!o.transparent, opacity: o.opacity ?? 1, flatShading: !!o.flat }));
    const nm = o.map?.userData?.normal; if (nm && o.normal !== false) { m.normalMap = nm; m.normalScale.setScalar(o.ns ?? 0.85); }
    this._mats.set(key, m); return m;
  }
  basic(color, o = {}) { return this._track(new THREE.MeshBasicMaterial({ color, map: o.map || null, transparent: !!o.transparent, opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide, fog: o.fog ?? true, depthWrite: o.depthWrite ?? true, blending: o.blending ?? THREE.NormalBlending })); }
  geo(g) { return this._track(g); }
  mesh(g, m, x = 0, y = 0, z = 0, parent) { const me = new THREE.Mesh(this.geo(g), m); me.position.set(x, y, z); parent?.add(me); return me; }
  box(w, h, d, m, x, y, z, parent) { return this.mesh(new THREE.BoxGeometry(w, h, d), m, x, y, z, parent); }
  cyl(rt, rb, h, m, x, y, z, parent, seg = 12) { return this.mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y, z, parent); }
  sph(r, m, x, y, z, parent, ws = 12, hs = 9) { return this.mesh(new THREE.SphereGeometry(r, ws, hs), m, x, y, z, parent); }
  rnd(a = 0, b = 1) { return a + (b - a) * this.r(); }
  pick(a) { return a[Math.floor(this.r() * a.length)]; }

  dispose() {
    for (const o of this._res) o.dispose?.();
    this._res.clear(); this._mats.clear(); this.updaters.length = 0;
  }

  // ------------- canvas painters -------------
  _planks(base, n) {
    const r = this.r;
    return canvas(256, (c, S) => {
      const bh = S / n;
      for (let i = 0; i < n; i++) {
        const col = new THREE.Color(base).offsetHSL((r() - 0.5) * 0.02, (r() - 0.5) * 0.1, (r() - 0.5) * 0.08);
        c.fillStyle = '#' + col.getHexString(); c.fillRect(0, i * bh, S, bh);
        for (let k = 0; k < 26; k++) {
          c.strokeStyle = `rgba(${r() < 0.5 ? '20,10,4' : '255,220,170'},${0.05 + r() * 0.12})`; c.lineWidth = 0.5 + r() * 1.5;
          const y = i * bh + r() * bh; c.beginPath(); c.moveTo(0, y);
          for (let x = 0; x <= S; x += 32) c.lineTo(x, y + Math.sin(x * 0.03 + k) * 1.5 * r());
          c.stroke();
        }
        c.fillStyle = 'rgba(10,5,2,0.75)'; c.fillRect(0, i * bh, S, 2);
        const cut = r() * S; c.fillRect(cut, i * bh, 2, bh);
        c.fillStyle = 'rgba(20,12,6,0.8)'; c.beginPath(); c.arc(cut + 6, i * bh + 6, 1.5, 0, TAU); c.arc(cut - 6, i * bh + bh - 6, 1.5, 0, TAU); c.fill();
      }
    });
  }
  _cobble() {
    const r = this.r;
    return canvas(256, (c, S) => {
      c.fillStyle = '#2e2924'; c.fillRect(0, 0, S, S);
      for (let i = 0; i < 140; i++) {
        const x = r() * S, y = r() * S, rr = 9 + r() * 10;
        for (const [dx, dy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
          const g = c.createRadialGradient(x + dx - rr * 0.3, y + dy - rr * 0.4, 1, x + dx, y + dy, rr);
          const v = 95 + r() * 50, t = r() * 20;
          g.addColorStop(0, `rgb(${v + 30 + t},${v + 22},${v + 10})`); g.addColorStop(1, `rgb(${v * 0.55 + t},${v * 0.5},${v * 0.45})`);
          c.fillStyle = g; c.beginPath(); c.ellipse(x + dx, y + dy, rr, rr * (0.7 + r() * 0.3), r() * 3, 0, TAU); c.fill();
        }
      }
      // weathering: warm/cool tint patches, moss in the joints, a couple of dark wet puddles
      for (let i = 0; i < 26; i++) { const x = r() * S, y = r() * S, rr = 20 + r() * 50;
        const g = c.createRadialGradient(x, y, 0, x, y, rr); const warm = r() < 0.5;
        g.addColorStop(0, warm ? 'rgba(150,100,50,0.16)' : 'rgba(60,70,80,0.16)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x - rr, y - rr, rr * 2, rr * 2); }
      c.globalCompositeOperation = 'darken';
      for (let i = 0; i < 300; i++) { c.fillStyle = `rgba(${60 + r() * 30},${80 + r() * 30},${40},${0.25 + r() * 0.3})`; c.fillRect(r() * S, r() * S, 2 + r() * 3, 2 + r() * 3); }
      c.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 2; i++) { const x = r() * S, y = r() * S, rr = 18 + r() * 16;
        const g = c.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, 'rgba(20,24,30,0.45)'); g.addColorStop(0.7, 'rgba(20,24,30,0.3)'); g.addColorStop(1, 'rgba(20,24,30,0)');
        c.fillStyle = g; c.beginPath(); c.ellipse(x, y, rr * 1.4, rr * 0.8, r() * 3, 0, TAU); c.fill(); }
    });
  }
  _stone() {
    const r = this.r;
    return canvas(256, (c, S) => {
      c.fillStyle = '#5a5048'; c.fillRect(0, 0, S, S);
      const rows = 8, h = S / rows;
      for (let j = 0; j < rows; j++) for (let x = (j % 2) * -20; x < S; ) {
        const w = 30 + r() * 30, v = 120 + r() * 50;
        c.fillStyle = `rgb(${v},${v * 0.92},${v * 0.82})`; c.fillRect(x + 2, j * h + 2, w - 4, h - 4);
        c.fillStyle = 'rgba(255,240,220,0.15)'; c.fillRect(x + 2, j * h + 2, w - 4, 3);
        x += w;
      }
    });
  }
  _plaster(base) {
    const r = this.r;
    return canvas(256, (c, S) => {
      c.fillStyle = base; c.fillRect(0, 0, S, S);
      for (let i = 0; i < 260; i++) {
        const x = r() * S, y = r() * S, rr = 4 + r() * 30;
        c.fillStyle = r() < 0.6 ? `rgba(120,90,50,${r() * 0.07})` : `rgba(255,250,235,${r() * 0.1})`;
        c.beginPath(); c.arc(x, y, rr, 0, TAU); c.fill();
      }
      const g = c.createLinearGradient(0, S * 0.75, 0, S); g.addColorStop(0, 'rgba(80,55,25,0)'); g.addColorStop(1, 'rgba(80,55,25,0.3)');
      c.fillStyle = g; c.fillRect(0, 0, S, S);
      // rain streaks running down from the top, hairline cracks, flaked patches showing the stone beneath
      for (let i = 0; i < 40; i++) { const x = r() * S, len = 20 + r() * 120, sg = c.createLinearGradient(0, 0, 0, len);
        sg.addColorStop(0, `rgba(70,50,30,${0.08 + r() * 0.1})`); sg.addColorStop(1, 'rgba(70,50,30,0)'); c.fillStyle = sg; c.fillRect(x, 0, 1 + r() * 4, len); }
      c.strokeStyle = 'rgba(60,40,20,0.35)'; c.lineWidth = 0.8;
      for (let i = 0; i < 7; i++) { let x = r() * S, y = r() * S; c.beginPath(); c.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 18; y += 4 + r() * 10; c.lineTo(x, y); } c.stroke(); }
      for (let i = 0; i < 4; i++) { const x = r() * S, y = r() * S, w = 14 + r() * 26, hh = 8 + r() * 14;
        c.fillStyle = 'rgba(120,96,70,0.55)'; c.fillRect(x, y, w, hh);
        c.strokeStyle = 'rgba(60,40,20,0.5)'; c.lineWidth = 1; c.strokeRect(x + 1, y + 1, w * 0.5, hh * 0.5); c.strokeRect(x + w * 0.5, y + hh * 0.5, w * 0.5 - 1, hh * 0.5 - 1); }
    });
  }
  _marble() {
    const r = this.r;
    return canvas(256, (c, S) => {
      const h = S / 2;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        c.fillStyle = (i + j) % 2 ? '#e8dfcc' : '#5a2a22'; c.fillRect(i * h, j * h, h, h);
        for (let k = 0; k < 6; k++) {
          c.strokeStyle = (i + j) % 2 ? 'rgba(120,100,80,0.25)' : 'rgba(230,200,180,0.18)'; c.lineWidth = 0.6 + r();
          c.beginPath(); let x = i * h + r() * h, y = j * h; c.moveTo(x, y);
          for (let s = 0; s < 8; s++) { x += (r() - 0.5) * 30; y += h / 8; c.lineTo(Math.max(i * h, Math.min(i * h + h, x)), y); }
          c.stroke();
        }
        c.strokeStyle = 'rgba(30,20,10,0.5)'; c.lineWidth = 2; c.strokeRect(i * h, j * h, h, h);
      }
    });
  }
  _stripes(a, b) {
    return canvas(256, (c, S) => {
      const n = 8;
      for (let i = 0; i < n; i++) { c.fillStyle = i % 2 ? b : a; c.fillRect(i * S / n, 0, S / n, S); }
      const g = c.createLinearGradient(0, 0, 0, S); g.addColorStop(0, 'rgba(0,0,0,0.15)'); g.addColorStop(0.5, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.25)');
      c.fillStyle = g; c.fillRect(0, 0, S, S);
      for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(60,30,10,${Math.random() * 0.06})`; c.fillRect(Math.random() * S, Math.random() * S, 3, 3); }
    });
  }
  _noise(S, lo, hi) {
    const r = this.r;
    return canvas(S, (c) => {
      const img = c.createImageData(S, S);
      for (let i = 0; i < S * S; i++) { const v = lo + r() * (hi - lo); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
      c.putImageData(img, 0, 0);
    });
  }
  _rug() {
    return canvas(256, (c, S) => {
      c.fillStyle = '#7a1c18'; c.beginPath(); c.ellipse(S / 2, S / 2, S / 2 - 2, S / 2 - 2, 0, 0, TAU); c.fill();
      c.strokeStyle = '#d9a64a'; c.lineWidth = 6; c.beginPath(); c.ellipse(S / 2, S / 2, S / 2 - 16, S / 2 - 16, 0, 0, TAU); c.stroke();
      c.strokeStyle = '#2a120c'; c.lineWidth = 3; c.beginPath(); c.ellipse(S / 2, S / 2, S / 2 - 26, S / 2 - 26, 0, 0, TAU); c.stroke();
      c.fillStyle = '#d9a64a';
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; c.beginPath(); c.ellipse(S / 2 + Math.cos(a) * 60, S / 2 + Math.sin(a) * 60, 16, 7, a, 0, TAU); c.fill(); }
      c.fillStyle = '#e9d8ae'; c.beginPath(); c.arc(S / 2, S / 2, 22, 0, TAU); c.fill();
      c.fillStyle = '#7a1c18'; c.beginPath(); c.arc(S / 2, S / 2, 12, 0, TAU); c.fill();
    });
  }
  _roof() {
    return canvas(128, (c, S) => {
      c.fillStyle = '#6a2a14'; c.fillRect(0, 0, S, S);
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
        const v = 160 + Math.random() * 50;
        c.fillStyle = `rgb(${v},${v * 0.45},${v * 0.25})`;
        c.beginPath(); c.ellipse(i * 16 + (j % 2) * 8 + 8, j * 16 + 10, 7, 9, 0, 0, Math.PI); c.fill();
      }
    });
  }
  _radial() {
    return canvas(64, (c, S) => {
      const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, S, S);
    });
  }
  _flame() {
    return canvas(64, (c, S) => {
      const g = c.createRadialGradient(S / 2, S * 0.7, 0, S / 2, S * 0.6, S / 2);
      g.addColorStop(0, 'rgba(255,250,210,1)'); g.addColorStop(0.3, 'rgba(255,190,70,0.9)'); g.addColorStop(0.65, 'rgba(230,80,20,0.5)'); g.addColorStop(1, 'rgba(120,20,0,0)');
      c.fillStyle = g; c.beginPath(); c.moveTo(S / 2, 0); c.quadraticCurveTo(S, S * 0.65, S / 2, S); c.quadraticCurveTo(0, S * 0.65, S / 2, 0); c.fill();
    });
  }
  _ledger() {
    return canvas(256, (c, S) => {
      c.fillStyle = '#efe2bf'; c.fillRect(0, 0, S, S / 1.5);
      c.strokeStyle = 'rgba(42,28,16,0.5)';
      for (let y = 18; y < S / 1.5; y += 11) { c.beginPath(); c.moveTo(12, y); c.lineTo(S / 2 - 12, y); c.moveTo(S / 2 + 12, y); c.lineTo(S - 12, y); c.stroke(); }
      c.strokeStyle = 'rgba(142,27,27,0.5)'; c.beginPath(); c.moveTo(S / 2 - 40, 10); c.lineTo(S / 2 - 40, S / 1.5 - 10); c.moveTo(S - 40, 10); c.lineTo(S - 40, S / 1.5 - 10); c.stroke();
      c.fillStyle = 'rgba(42,28,16,0.75)';
      for (let y = 16; y < S / 1.5 - 8; y += 11) { c.fillRect(14, y - 6, 40 + Math.random() * 50, 2); c.fillRect(S / 2 + 14, y - 6, 30 + Math.random() * 60, 2); c.fillRect(S / 2 - 36, y - 6, 18, 2); c.fillRect(S - 36, y - 6, 18, 2); }
      c.fillStyle = 'rgba(80,50,20,0.35)'; c.fillRect(S / 2 - 3, 0, 6, S / 1.5);
    }, 256 / 1.5);
  }

  // ------------- props -------------
  glow(color, size, x, y, z, parent, opacity = 0.9) {
    const s = new THREE.Sprite(this._track(new THREE.SpriteMaterial({ map: this.tex.glow, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })));
    s.scale.set(size, size, 1); s.position.set(x, y, z); parent?.add(s); return s;
  }

  barrel(x, z, parent, { y = 0, lying = false, s = 1 } = {}) {
    const pts = []; for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector2(0.3 + 0.07 * Math.sin(t * Math.PI), t * 0.9)); }
    const g = new THREE.Group();
    this.mesh(new THREE.LatheGeometry(pts, 14), this.mat('#b08458', { map: this.tex.darkPlanks }), 0, 0, 0, g).rotation.z = 0;
    this.cyl(0.3, 0.3, 0.02, this.mat('#4a2e16'), 0, 0.9, 0, g);   // lid
    const hoop = this.mat('#2a2420', { metal: 0.6, rough: 0.5 });
    for (const hy of [0.12, 0.78]) { const t = this.mesh(new THREE.TorusGeometry(0.33, 0.018, 6, 18), hoop, 0, hy, 0, g); t.rotation.x = Math.PI / 2; }
    g.scale.setScalar(s);
    if (lying) { g.rotation.z = Math.PI / 2; g.position.set(x + 0.45 * s, y + 0.36 * s, z); } else g.position.set(x, y, z);
    parent?.add(g); return g;
  }
  crate(x, y, z, s = 0.6, parent, rot = 0) {
    const c = this.box(s, s, s, this.mat('#c79a62', { map: this.tex.planks }), x, y + s / 2, z, parent); c.rotation.y = rot; return c;
  }
  sack(x, y, z, parent, col = '#cdb488') {
    const s = this.sph(0.28, this.mat(col, { map: this.tex.cloth }), x, y + 0.24, z, parent, 10, 8); s.scale.set(1, 0.85, 0.85); return s;
  }
  table(x, z, parent, { r = 0.7, h = 0.75, round = true } = {}) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const wood = this.mat('#8a5a32', { map: this.tex.planks });
    if (round) this.cyl(r, r, 0.06, wood, 0, h, 0, g, 18); else this.box(r * 2, 0.06, r * 1.1, wood, 0, h, 0, g);
    this.cyl(0.07, 0.1, h, this.mat('#3e2614'), 0, h / 2, 0, g, 8);
    this.cyl(0.3, 0.35, 0.05, this.mat('#3e2614'), 0, 0.03, 0, g, 10);
    parent?.add(g); return g;
  }
  stool(x, z, parent) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    this.cyl(0.2, 0.2, 0.05, this.mat('#7a4a28', { map: this.tex.planks }), 0, 0.46, 0, g, 12);
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; const l = this.cyl(0.025, 0.03, 0.46, this.mat('#3e2614'), Math.cos(a) * 0.13, 0.23, Math.sin(a) * 0.13, g, 6); l.rotation.set(Math.sin(a) * 0.15, 0, -Math.cos(a) * 0.15); }
    parent?.add(g); return g;
  }
  mug(x, y, z, parent) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    this.cyl(0.05, 0.055, 0.13, this.mat('#7a5a3a', { rough: 0.6 }), 0, 0.065, 0, g, 10);
    this.cyl(0.046, 0.046, 0.01, this.mat('#e8dcc0'), 0, 0.13, 0, g, 10);
    const hd = this.mesh(new THREE.TorusGeometry(0.035, 0.01, 5, 8, Math.PI), this.mat('#7a5a3a'), 0.055, 0.065, 0, g); hd.rotation.z = -Math.PI / 2;
    parent?.add(g); return g;
  }
  bottle(x, y, z, parent, col = '#2f5a2a') {
    const pts = [[0, 0], [0.05, 0], [0.05, 0.16], [0.02, 0.22], [0.015, 0.3], [0, 0.3]].map(([a, b]) => new THREE.Vector2(a, b));
    return this.mesh(new THREE.LatheGeometry(pts, 10), this.mat(col, { rough: 0.2, metal: 0.1 }), x, y, z, parent);
  }
  candle(x, y, z, parent, light = false) {
    this.cyl(0.02, 0.022, 0.16, this.mat('#efe6cf'), x, y + 0.08, z, parent, 8);
    const f = this.glow('#ffb050', 0.35, x, y + 0.2, z, parent, 0.95);
    const ph = this.r() * 10;
    this.updaters.push(t => { const k = 0.85 + 0.15 * Math.sin(t * 13 + ph) * Math.sin(t * 7.3 + ph); f.scale.set(0.35 * k, 0.4 * k, 1); });
    return f;
  }

  lantern(x, y, z, parent, { rope = 0, light = 0, color = '#ffc070', distance = 9 } = {}) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    const iron = this.mat('#1e1a16', { metal: 0.5, rough: 0.6 });
    this.cyl(0.13, 0.16, 0.04, iron, 0, 0, 0, g, 6);
    this.cyl(0.04, 0.16, 0.14, iron, 0, 0.42, 0, g, 6);
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + Math.PI / 4; this.box(0.02, 0.36, 0.02, iron, Math.cos(a) * 0.13, 0.2, Math.sin(a) * 0.13, g); }
    this.cyl(0.11, 0.13, 0.34, this.mat('#ffe0a0', { emissive: '#ffb54a', ei: 2.2, transparent: true, opacity: 0.9 }), 0, 0.2, 0, g, 6);
    this.mesh(new THREE.TorusGeometry(0.05, 0.012, 5, 10), iron, 0, 0.53, 0, g);
    if (rope) this.cyl(0.012, 0.012, rope, this.mat('#6a5a40'), 0, 0.55 + rope / 2, 0, g, 4);
    const glow = this.glow(color, 2.6, 0, 0.2, 0, g, 0.75);
    let pl = null;
    if (light) { pl = new THREE.PointLight(color, light, distance, 2); pl.position.set(0, 0.1, 0); g.add(pl); }
    const ph = this.r() * 10;
    this.updaters.push(t => {
      const k = 0.92 + 0.08 * Math.sin(t * 9 + ph) * Math.sin(t * 5.1 + ph * 2);
      glow.material.opacity = 0.75 * k; if (pl) pl.intensity = light * k;
      g.rotation.z = Math.sin(t * 0.7 + ph) * 0.02;
    });
    parent?.add(g); return g;
  }

  fire(x, y, z, parent, { light = 40, scale = 1 } = {}) {
    const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(scale);
    const logM = this.mat('#2a1a10', { emissive: '#601800', ei: 0.6 });
    for (let i = 0; i < 4; i++) { const l = this.cyl(0.07, 0.08, 0.9, logM, 0, 0.08 + (i > 1 ? 0.1 : 0), 0, g, 7); l.rotation.set(Math.PI / 2, i * 0.8, 0); }
    this.sph(0.3, this.mat('#ff7a20', { emissive: '#ff5a10', ei: 2.5 }), 0, 0.02, 0, g, 10, 5).scale.set(1.2, 0.25, 0.8);
    const flames = [];
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(this._track(new THREE.SpriteMaterial({ map: this.tex.flame, color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
      s.position.set((this.r() - 0.5) * 0.6, 0.35, (this.r() - 0.5) * 0.3); g.add(s);
      flames.push({ s, ph: this.r() * 10, sp: 2 + this.r() * 3, h: 0.6 + this.r() * 0.5, x0: s.position.x });
    }
    const glow = this.glow('#ff8a30', 3.2, 0, 0.6, 0, g, 0.6);
    const pl = new THREE.PointLight('#ff8a3a', light, 16, 2); pl.position.set(0.3, 0.8, 0); g.add(pl);
    this.updaters.push(t => {
      for (const f of flames) {
        const k = (t * f.sp * 0.5 + f.ph) % 1;
        f.s.position.y = 0.15 + k * f.h; f.s.position.x = f.x0 + Math.sin(t * 6 + f.ph) * 0.05;
        const sz = (0.55 - k * 0.35) * (0.9 + 0.2 * Math.sin(t * 11 + f.ph));
        f.s.scale.set(sz, sz * 1.5, 1); f.s.material.opacity = 1 - k * k;
      }
      const fl = 0.8 + 0.12 * Math.sin(t * 13) + 0.08 * Math.sin(t * 23.7) + 0.06 * Math.sin(t * 5.3);
      pl.intensity = light * fl; glow.material.opacity = 0.5 * fl;
    });
    parent?.add(g); return g;
  }

  // simple 3-colour pennant / banner painted in canvas
  banner(faction, w, h, x, y, z, parent) {
    const colors = { english: ['#b8242c', '#f1e8d2'], spanish: ['#f1e2b8', '#a5201f'], french: ['#2e5aa8', '#e7c25a'], dutch: ['#e07a24', '#2a4f8f'], pirate: ['#151515', '#e9e1cc'] }[faction] || ['#6b5a44', '#e9d8ae'];
    const c = canvas(128, (ctx, S) => {
      ctx.fillStyle = colors[0]; ctx.fillRect(0, 0, S, S * 1.5);
      ctx.strokeStyle = colors[1]; ctx.lineWidth = 12;
      if (faction === 'spanish') { ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(S - 10, S * 1.5 - 30); ctx.moveTo(S - 10, 10); ctx.lineTo(10, S * 1.5 - 30); ctx.stroke(); }
      else if (faction === 'english') { ctx.fillStyle = colors[1]; ctx.fillRect(S / 2 - 14, 0, 28, S * 1.5); ctx.fillRect(0, S * 0.55, S, 28); ctx.fillStyle = colors[0]; ctx.fillRect(S / 2 - 8, 0, 16, S * 1.5); ctx.fillRect(0, S * 0.55 + 6, S, 16); }
      else if (faction === 'dutch') { ctx.fillStyle = '#f1e8d2'; ctx.fillRect(0, S * 0.5, S, S * 0.5); ctx.fillStyle = colors[1]; ctx.fillRect(0, S, S, S * 0.5); }
      else { ctx.fillStyle = colors[1]; for (const [a, b] of [[0.3, 0.4], [0.7, 0.4], [0.5, 0.85]]) { ctx.beginPath(); ctx.arc(a * S, b * S, 12, 0, TAU); ctx.fill(); } }
      ctx.fillStyle = '#c9a24a'; ctx.fillRect(0, 0, S, 6);
      ctx.beginPath(); ctx.moveTo(0, S * 1.5); ctx.lineTo(0, S * 1.5 - 30); ctx.lineTo(S / 2, S * 1.5 - 10); ctx.lineTo(S, S * 1.5 - 30); ctx.lineTo(S, S * 1.5); ctx.fillStyle = 'rgba(0,0,0,1)'; ctx.globalCompositeOperation = 'destination-out'; ctx.fill();
    }, 192);
    const t = this._track(this._ctex(c, false));
    const geo = new THREE.PlaneGeometry(w, h, 6, 8);
    const pos = geo.attributes.position; for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 4) * 0.04);
    geo.computeVertexNormals();
    const m = this.mesh(geo, this.mat('#ffffff', { map: t, transparent: true, side: THREE.DoubleSide }), x, y, z, parent);
    this.box(w + 0.15, 0.05, 0.05, this.mat('#c9a24a', { metal: 0.7, rough: 0.35 }), 0, h / 2, 0.02, m);
    return m;
  }

  skyDome(top, mid, bottom, parent) {
    const c = canvas(8, (ctx, S, H) => { const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, top); g.addColorStop(0.5, mid); g.addColorStop(0.62, bottom); g.addColorStop(1, bottom); ctx.fillStyle = g; ctx.fillRect(0, 0, S, H); }, 256);
    const t = this._track(this._ctex(c, false));
    const m = this.mesh(new THREE.SphereGeometry(400, 24, 16), this.basic('#ffffff', { map: t, side: THREE.BackSide, fog: false }), 0, 0, 0, parent);
    return m;
  }

  // ------------- NPCs -------------
  // opts: coat, vest, pants, skin, hair, hat:'tricorn'|'bandana'|'cap'|'wig'|'bonnet'|'morion'|null, beard, dress, apron,
  //       pose:'stand'|'sit'|'lean'|'gesture'|'drink'|'arms', s (scale), mug (holds a mug)
  npc(o = {}) {
    // the shared sculpted character (src/game/duel/figure.js), posed by joints, idling in real time
    const r = this.r, k = this;
    const hat = o.hat === undefined ? k.pick(['tricorn', 'bandana', 'cap', null]) : o.hat;
    const role = o.dress ? LOOKS.woman : hat === 'morion' ? LOOKS.guard : hat === 'wig' ? LOOKS.governor : o.apron ? (o.pose === 'lean' ? LOOKS.tavern : LOOKS.merchant) : {};
    const look = {
      ...role, sword: false, seed: Math.floor(r() * 1e6),
      skin: o.skin || k.pick(['#e0b090', '#c99272', '#a8704e', '#7a4a30', '#e8c0a0']),
      coat: o.coat || role.coat || k.pick(['#6a2a22', '#2c3d5a', '#3e4a2a', '#5a4030', '#7a6040']),
      waistcoat: o.vest || role.waistcoat || k.pick(['#e8dcc0', '#c9a24a', '#8e3a2a', '#d9cdb0']),
      lapel: o.vest || role.lapel || '#c9a24a', trim: role.trim || '#c9a24a',
      breeches: o.pants || role.breeches || k.pick(['#4a3a2a', '#d9cdb0', '#3a3a40', '#6a5a40']),
      hair: o.hair || k.pick(['#2a1a10', '#4a2a14', '#1a1410', '#7a5a30', '#8a8a80']),
      hat: hat || 'none', hatColor: o.hatColor, bandana: o.hatColor, plume: o.plume, beard: !!o.beard, moustache: !!o.moustache,
      dress: o.dress, bodice: o.bodice, apron: o.apron, tool: o.tool, mug: o.mug, expr: o.expr || role.expr || k.pick(['smile', 'calm', 'stern']),
      longHair: o.dress ? true : r() < 0.4,
      outline: true, outlineW: 0.0055,   // thin ink outline, like the duellists (reads in dark rooms)
      detail: o.detail ?? 0.65, headScale: o.dress ? 1.16 : 1.22,   // slightly bigger heads (read at a distance); extras at 65 % of the segments (heads, limbs, hands): ~10 k triangles
    };
    if (o.apron && o.coat && o.coat.toLowerCase() > '#d') Object.assign(look, { sailor: true, sleeves: 'rolled', boots: true, vest: look.waistcoat });   // shirt-sleeved tavern keeper, waistcoat over the shirt
    const fig = new CaptainFigure(look);
    k._track({ dispose: () => fig.dispose() });
    const root = new THREE.Group(); root.add(fig.group);
    const j = fig.j;
    const pose = o.pose || 'stand';
    const sit = pose === 'sit';
    const A = [{ sh: j.rShoulder, el: j.rElbow, sx: -1 }, { sh: j.lShoulder, el: j.lElbow, sx: 1 }];
    const base = () => {
      for (const a of A) { a.sh.rotation.set(0, 0, a.sx * 0.12); a.el.rotation.set(-0.12, 0, 0); }
      if (pose === 'lean') { j.hips.rotation.x = 0.18; A.forEach(a => { a.sh.rotation.x = -0.9; a.el.rotation.x = -0.9; a.sh.rotation.z = a.sx * 0.35; }); }
      if (pose === 'arms') { A.forEach(a => { a.sh.rotation.set(-0.5, 0, a.sx * 0.28); a.el.rotation.set(-1.75, a.sx * -0.5, 0); }); }
      if (sit) { j.hips.position.y = 0.56; for (const [h, kn] of [[j.rHip, j.rKnee], [j.lHip, j.lKnee]]) { h.rotation.x = -Math.PI / 2 + 0.1; kn.rotation.x = Math.PI / 2 - 0.1; } A.forEach(a => { a.sh.rotation.x = -0.7; a.el.rotation.x = -0.6; }); }
      if (pose === 'hips') { A.forEach(a => { a.sh.rotation.z = a.sx * 0.6; a.el.rotation.z = -a.sx * 1.4; a.el.rotation.x = -0.3; }); }
      if (!sit) { j.rHip.rotation.z = -0.04; j.lHip.rotation.z = 0.06; j.lHip.rotation.x = -0.08; j.lKnee.rotation.x = 0.12; }   // contrapposto
    };
    base();
    const sh = k.mesh(new THREE.CircleGeometry(0.42, 16), k.basic('#000000', { transparent: true, opacity: 0.35, depthWrite: false }), 0, 0.012, sit ? 0.15 : 0, root);
    sh.rotation.x = -Math.PI / 2;
    root.scale.setScalar(o.s || 1);

    const ph = r() * 20, sp = 0.8 + r() * 0.5;
    const update = (t) => {
      const b = Math.sin(t * 1.6 * sp + ph);
      j.chest.rotation.x = b * 0.015;
      j.head.rotation.y = Math.sin(t * 0.37 * sp + ph) * 0.35 + (o.look || 0);
      j.head.rotation.x = Math.sin(t * 0.23 + ph) * 0.06;
      if (pose === 'gesture') {
        const g = Math.max(0, Math.sin(t * 1.1 * sp + ph));
        A[1].sh.rotation.x = -0.4 - g * 0.9; A[1].el.rotation.x = -0.6 - g * 0.6; A[1].sh.rotation.z = 0.25;
        A[0].sh.rotation.x = -0.2 - Math.max(0, Math.sin(t * 0.9 + ph + 2)) * 0.5; A[0].el.rotation.x = -0.4;
        j.spine.rotation.y = Math.sin(t * 0.6 + ph) * 0.12;
      } else if (pose === 'drink' || o.mug) {
        const d = Math.max(0, Math.sin(t * 0.45 * sp + ph)) ** 6;
        A[1].sh.rotation.x = (sit ? -0.7 : -0.3) - d * 1.0; A[1].el.rotation.x = -0.9 - d * 1.0; A[1].sh.rotation.z = 0.15;
        j.head.rotation.x -= d * 0.35;
      } else if (pose === 'stand') {
        A.forEach(a => { a.sh.rotation.x = Math.sin(t * 0.8 + ph + a.sx) * 0.05; });
      }
      if (o.tool === 'hammer') { const h = (t * 1.3 + ph) % 1; A[1].sh.rotation.x = -1.2 + (h < 0.25 ? h * 4 : 1 - (h - 0.25) / 0.75) * -0.6; }
    };
    return { group: root, update, figure: fig };
  }

  place(npc, x, z, rotY = 0, parent, y = 0) { npc.group.position.set(x, y, z); npc.group.rotation.y = rotY; parent?.add(npc.group); this.updaters.push(npc.update); return npc; }
}
