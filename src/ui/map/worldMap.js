// WorldMap — full-screen engraved sea chart (M). Takes over the HUD's M key (game.mapKeyHandled = true) and pauses
// the simulation while open.
// API (game.worldMap):
//   open(), close(), toggle(), isOpen
//   focus(x, z, zoom)        centre the view on a world point
//   reveal(coveId)           mark a cove as known (also reads game.state.knownCoves = [ids])
//   track                    [{x,z}] the player's wake (sampled every ~40 m sailed); saved as state.mapTrack
//   update(dt)               (system) records the track and spotted ships
// Chart content: coastlines traced from islands.getTerrainHeight into a cached canvas at load (marching squares),
// engraved coastal water-lines (distance field), hill hachures, ports with faction flags + names, island names,
// known coves (rumours), the player's ship + heading + track, recently sighted ships, compass roses with rhumb
// lines, a sea serpent and a whale, a title cartouche, a scale of leagues, the wind rose, and a graduated border.
// Mouse: wheel zoom about the cursor, drag to pan; keys: M / Esc close, +/- zoom, 0 reset.
import { HALF_WORLD, WORLD_SIZE, FACTIONS } from '../../core/constants.js';
import { a as article, shipDesc, nationName, fmtInt, fmtNum } from '../../core/i18n.js';
import { relation } from '../../combat/factions.js';
import { isKey } from '../../core/keys.js';
import { flagSVG } from '../flags.js';
import { mulberry32 } from '../../core/rng.js';
import { ZONE_TEXT } from '../../data/seaZones.js';   // sea tiers (“Waters and dangers” layer)
import './map.css';

const INK = '#2a1c10', INK2 = 'rgba(42,28,16,', SEA_TINT = [86, 126, 120];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NNBSP = '\u202f';
// layer filters (legend toggles), remembered per viewer
const LAYERS = [
  ['ports', 'Ports and nations'], ['villages', 'Fishing villages'], ['zones', 'Waters and dangers'], ['missions', 'Missions under way'], ['towns', 'State of the towns'], ['lords', 'Top 10 lairs'], ['treasure', 'Treasure and coves'],
  ['convoys', 'Announced convoys'], ['weather', 'Squalls and storms'], ['ships', 'Ships sighted'], ['track', 'Our course'], ['labels', 'Island names'],
];
const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const LEG_ICON = {
  ports: '<svg viewBox="0 0 24 24"><path d="M4 11l3-3 3 3 3-3 3 3v8H4z" fill="#c0623a" stroke="#2a1c10" stroke-width="1.3"/><path d="M18 19V4" stroke="#2a1c10" stroke-width="1.2"/><path d="M18 4h5v4h-5z" fill="#b8242c" stroke="#2a1c10" stroke-width=".8"/></svg>',
  villages: '<svg viewBox="0 0 24 24"><path d="M3 13l6-6 6 6v7H3z" fill="#b8925a" stroke="#2a1c10" stroke-width="1.2"/><path d="M2 13.5L9 6.5l7 7" fill="none" stroke="#6b4a1e" stroke-width="2"/><path d="M14 20q3-6 8-7M16 20q2-4 6-5M18 20q1-2.5 4-3" fill="none" stroke="#2f5a6e" stroke-width="1.1"/><path d="M7 20v-3.5h3V20" fill="#5a3a18"/></svg>',
  zones: '<svg viewBox="0 0 24 24"><defs><clipPath id="wlzc"><path d="M12 2h10v20H12z"/></clipPath></defs><g clip-path="url(#wlzc)"><path d="M10 26L26 10M6 26L26 6M14 26L26 14M2 26L26 2M18 26l8-8" stroke="#963a1e" stroke-width="1.4"/></g><path d="M12 2v20" stroke="#8c2814" stroke-width="1.3" stroke-dasharray="2.4 2"/><circle cx="7" cy="12" r="5.6" fill="rgba(120,170,110,.3)" stroke="#1e552d" stroke-width="1.5" stroke-dasharray="2.6 1.8"/></svg>',
  missions: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="#8c1c22" stroke-width="1.6" stroke-dasharray="3 2.4"/><circle cx="12" cy="12" r="4.2" fill="#a3262a" stroke="#2a1c10" stroke-width="1"/><path d="M12 9.6v4.8M9.6 12h4.8" stroke="#f1dcb0" stroke-width="1.2"/></svg>',
  towns: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="2.6" fill="#c9a24a" stroke="#2a1c10"/><circle cx="12" cy="12" r="2.6" fill="#c9a24a" stroke="#2a1c10"/><circle cx="18" cy="12" r="2.6" fill="none" stroke="#2a1c10"/></svg>',
  lords: '<svg viewBox="0 0 24 24"><path d="M5 10a7 7 0 0 1 14 0c0 3-1.5 4.5-3 5v3H8v-3c-1.5-.5-3-2-3-5z" fill="#1e140c"/><circle cx="9.5" cy="10" r="1.8" fill="#e9d8ae"/><circle cx="14.5" cy="10" r="1.8" fill="#e9d8ae"/></svg>',
  treasure: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="#b01e14" stroke-width="3" stroke-linecap="round"/></svg>',
  convoys: '<svg viewBox="0 0 24 24"><path d="M2 16L22 8" stroke="#7a5014" stroke-width="2" stroke-dasharray="2 3"/><circle cx="12" cy="12" r="3" fill="#b8862a" stroke="#2a1c10"/></svg>',
  weather: '<svg viewBox="0 0 24 24"><path d="M7 15a4 4 0 0 1 1-8 5 5 0 0 1 10 2 3 3 0 0 1 0 6z" fill="#e8e2d2" stroke="#3c3228"/><path d="M9 17l-1 4M13 17l-1 4M17 17l-1 4" stroke="#3c465a" stroke-width="1.3"/></svg>',
  ships: '<svg viewBox="0 0 24 24"><path d="M12 3c3 4 3 12 2 17h-4C9 15 9 7 12 3z" fill="#2e5aa8" stroke="#2a1c10"/><path d="M7 11q5-4 10 0q-5-2-10 0" fill="#f4ead0" stroke="#2a1c10" stroke-width=".8"/></svg>',
  track: '<svg viewBox="0 0 24 24"><path d="M2 18c5-8 9 0 13-6s5-6 7-8" fill="none" stroke="#8e1b1b" stroke-width="2" stroke-dasharray="4 3"/></svg>',
  labels: '<svg viewBox="0 0 24 24"><text x="12" y="16" text-anchor="middle" font-family="Georgia" font-style="italic" font-size="12" fill="#3a2412">Aa</text></svg>',
};

export class WorldMap {
  constructor(game) {
    this.game = game;
    game.mapKeyHandled = true;
    this.isOpen = false;
    this.track = game.state?.mapTrack || (game.state ? (game.state.mapTrack = []) : []);
    this.sighted = new Map();     // ship -> { x, z, heading, faction, name, type, t }
    this.view = { cx: 0, cz: 0, zoom: 1 };
    this._flagImgs = {};
    this.layers = Object.fromEntries(LAYERS.map(([k]) => [k, true]));
    try { Object.assign(this.layers, JSON.parse(localStorage.getItem('tof.maplayers') || '{}')); } catch { /* storage blocked */ }
    this._labels = []; this._rects = []; this._hits = [];
    this._buildDOM();
    addEventListener('keydown', e => this._key(e), true);
    addEventListener('resize', () => { if (this.isOpen) this._resize(); });
    this._lastTrack = null;
    this._base = null;
  }

  // ------------------------------------------------------------------ DOM
  _buildDOM() {
    const root = this.game.uiRoot || document.body;
    const el = this.el = document.createElement('div');
    el.className = 'tof-worldmap';
    el.innerHTML = `<canvas></canvas>
      <div class="wm-legend tof-parch"><div class="wl-h" title="Fold or unfold the legend">Legend</div>${LAYERS.map(([k, n]) => `<button class="wl-row" data-l="${k}"><i>${LEG_ICON[k]}</i><span>${n}</span><b class="wl-chk"></b></button>`).join('')}
        <div class="wl-you"><i><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="#8e1b1b" stroke-width="1.6"/><path d="M12 4c2.5 3 2.5 11 1.6 15h-3.2C9.5 15 9.5 7 12 4z" fill="#c9a24a" stroke="#2a1c10"/></svg></i><span>Your ship and her heading</span></div>
        <button class="wl-center">Centre on the ship</button></div>
      <div class="wm-tip tof-parch off"></div>
      <div class="wm-hint"><span><b class="k">Wheel</b> zoom</span><span><b class="k">Drag</b> move</span><span><b class="k">Space</b> centre</span><span><b class="k">0</b> whole map</span><span><b class="k">M</b> close</span></div>`;
    root.appendChild(el);
    this.canvas = el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.tip = el.querySelector('.wm-tip');
    this.legend = el.querySelector('.wm-legend');
    this._syncLegend();
    try { if (localStorage.getItem('tof.maplegend') === 'min') this.legend.classList.add('min'); } catch { /* ignore */ }
    this.legend.addEventListener('click', e => {
      if (e.target.closest?.('.wl-h')) {   // fold / unfold the legend (it hides the bottom-left corner of the chart)
        const min = this.legend.classList.toggle('min');
        try { localStorage.setItem('tof.maplegend', min ? 'min' : 'open'); } catch { /* ignore */ }
        this.draw(); this.game.audio?.play?.('ui:click'); return;
      }
      const r = e.target.closest?.('.wl-row');
      if (r) { this.layers[r.dataset.l] = !this.layers[r.dataset.l]; this._syncLegend(); try { localStorage.setItem('tof.maplayers', JSON.stringify(this.layers)); } catch { /* ignore */ } this.draw(); this.game.audio?.play?.('ui:click'); }
      else if (e.target.closest?.('.wl-center')) this._centerPlayer();
    });
    this.legend.addEventListener('mousedown', e => e.stopPropagation());
    let drag = null;
    this.canvas.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz }; this.canvas.classList.add('drag'); });
    addEventListener('mouseup', () => { drag = null; this.canvas.classList.remove('drag'); });
    this.canvas.addEventListener('mouseleave', () => this._showTip(null));
    addEventListener('mousemove', e => {
      this._mouse = { x: e.clientX, y: e.clientY };
      if (!this.isOpen) return;
      if (!drag) { this._hover(e.clientX, e.clientY); return; }
      this._showTip(null);
      const s = this._scale();
      this.view.cx = drag.cx - (e.clientX - drag.x) / s; this.view.cz = drag.cz - (e.clientY - drag.y) / s;
      this._clampView(); this.draw();
    });
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault(); e.stopPropagation();
      this._zoomAt(e.clientX, e.clientY, Math.pow(1.22, -Math.sign(e.deltaY)), true);
    }, { passive: false });
  }

  _key(e) {
    if (e.target?.tagName === 'INPUT') return;
    const menuOpen = this.game.hud?.menu?.isOpen;
    if (isKey(e, 'm') && !menuOpen && (this.game.mode === 'sail' || this.isOpen)) { this.toggle(); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (this.isOpen && e.code === 'Escape') { this.close(); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (this.isOpen && (e.code === 'Equal' || e.code === 'NumpadAdd')) this._zoomAt(innerWidth / 2, innerHeight / 2, 1.25);
    else if (this.isOpen && (e.code === 'Minus' || e.code === 'NumpadSubtract')) this._zoomAt(innerWidth / 2, innerHeight / 2, 0.8);
    else if (this.isOpen && (e.code === 'Digit0' || e.code === 'Numpad0')) { this._fit(); this.draw(); }
    else if (this.isOpen && e.code === 'Space') { this._centerPlayer(); e.preventDefault(); }
  }

  toggle() { this.isOpen ? this.close() : this.open(); }
  open() {
    if (this.isOpen) return;
    const g = this.game;
    this.isOpen = true;
    this._prev = { frozen: g.frozen, mode: g.mode };
    g.frozen = true;
    g.mode = 'map';
    g.events.emit('state:change', { from: this._prev.mode, to: 'map' });
    g.events.emit('ui:pause', { paused: true });
    g.audio?.play?.('ui:page');
    this._ensureBase();
    this._resize();
    const p = g.player;
    if (!this._opened) { this._fit(); if (p) { this.view.zoom = 2.2; this.view.cx = p.position.x; this.view.cz = p.position.z; this._clampView(); } this._opened = true; }
    else if (p) { this.view.cx = p.position.x; this.view.cz = p.position.z; this._clampView(); }
    this.el.classList.add('on');
    this.draw();
  }
  close() {
    if (!this.isOpen) return;
    const g = this.game;
    this.isOpen = false;
    this.el.classList.remove('on');
    g.frozen = this._prev?.frozen ?? false;
    g.mode = this._prev?.mode && this._prev.mode !== 'map' ? this._prev.mode : 'sail';
    g.events.emit('state:change', { from: 'map', to: g.mode });
    g.events.emit('ui:pause', { paused: false });
    g.audio?.play?.('ui:page');
  }
  focus(x, z, zoom) { this.view.cx = x; this.view.cz = z; if (zoom) this.view.zoom = zoom; this._clampView(); if (this.isOpen) this.draw(); }
  reveal(id) { const st = this.game.state; if (!st) return; st.knownCoves = st.knownCoves || []; if (!st.knownCoves.includes(id)) st.knownCoves.push(id); }

  // ------------------------------------------------------------------ system update
  update() {
    const g = this.game, p = g.player;
    if (!p) return;
    const last = this._lastTrack;
    if (!last || Math.hypot(p.position.x - last.x, p.position.z - last.z) > 40) {
      const pt = { x: Math.round(p.position.x), z: Math.round(p.position.z) };
      // a teleport (towed / new game) starts a new leg
      if (last && Math.hypot(pt.x - last.x, pt.z - last.z) > 600) this.track.push(null);
      this.track.push(pt); this._lastTrack = pt;
      if (this.track.length > 4000) this.track.splice(0, this.track.length - 4000);
    }
    this._sightT = (this._sightT || 0) - 1;
    if (this._sightT <= 0) {
      this._sightT = 20;
      for (const s of g.ships) {
        if (s === p || !s.alive) continue;
        if (Math.hypot(s.position.x - p.position.x, s.position.z - p.position.z) < 2200)
          this.sighted.set(s, { x: s.position.x, z: s.position.z, heading: s.heading, faction: s.faction, name: s.name, type: s.type, struck: s.struck, t: g.time });
      }
      for (const [s] of this.sighted) if (!s.alive || !g.ships.includes(s)) this.sighted.delete(s);
    }
  }

  // ------------------------------------------------------------------ view
  _resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.dpr = dpr;
    this.canvas.width = Math.round(innerWidth * dpr); this.canvas.height = Math.round(innerHeight * dpr);
    this.canvas.style.width = innerWidth + 'px'; this.canvas.style.height = innerHeight + 'px';
    this._clampView();
  }
  _frame() { // inner chart rect (CSS px) inside the border
    const m = Math.round(Math.min(innerWidth, innerHeight) * 0.045);
    return { x: m, y: m, w: innerWidth - 2 * m, h: innerHeight - 2 * m };
  }
  _fitScale() { const f = this._frame(); return Math.min(f.w, f.h) / (this._ext.size); }
  _scale() { return this._fitScale() * this.view.zoom; }
  _fit() { this.view.zoom = 1; this.view.cx = this._ext.cx; this.view.cz = this._ext.cz; }
  _clampView() {
    if (!this._ext) return;
    this.view.zoom = clamp(this.view.zoom, 0.9, 9);
    const e = this._ext, f = this._frame(), s = this._scale();
    const hw = f.w / 2 / s, hh = f.h / 2 / s;
    const x0 = e.cx - e.size / 2, x1 = e.cx + e.size / 2, z0 = e.cz - e.size / 2, z1 = e.cz + e.size / 2;
    this.view.cx = hw * 2 >= e.size ? e.cx : clamp(this.view.cx, x0 + hw, x1 - hw);
    this.view.cz = hh * 2 >= e.size ? e.cz : clamp(this.view.cz, z0 + hh, z1 - hh);
  }
  // smooth: animates toward the target zoom, keeping the world point under the cursor fixed
  _zoomAt(sx, sy, k, smooth = false) {
    if (smooth && !this.game.params?.get('frozen')) {
      const z0 = this._zAnim?.target ?? this.view.zoom;
      this._zAnim = { target: clamp(z0 * k, 0.9, 9), sx, sy };
      if (!this._raf) { const step = () => { this._raf = 0; const a = this._zAnim; if (!a || !this.isOpen) return; const d = a.target / this.view.zoom; const kk = Math.abs(Math.log(d)) < 0.004 ? d : Math.pow(d, 0.28); this._zoomAt(a.sx, a.sy, kk); if (kk === d) this._zAnim = null; else this._raf = requestAnimationFrame(step); }; this._raf = requestAnimationFrame(step); }
      return;
    }
    const s0 = this._scale(), f = this._frame();
    const wx = this.view.cx + (sx - f.x - f.w / 2) / s0, wz = this.view.cz + (sy - f.y - f.h / 2) / s0;
    this.view.zoom *= k; this._clampView();
    const s1 = this._scale();
    this.view.cx = wx - (sx - f.x - f.w / 2) / s1; this.view.cz = wz - (sy - f.y - f.h / 2) / s1;
    this._clampView(); this.draw();
  }
  w2s(x, z) { const f = this._frame(), s = this._scale(); return [f.x + f.w / 2 + (x - this.view.cx) * s, f.y + f.h / 2 + (z - this.view.cz) * s]; }

  // ------------------------------------------------------------------ base chart (cached)
  _ensureBase() {
    if (this._base) return;
    const t0 = performance.now();
    const isl = this.game.islands;
    // chart extent: the archipelago's bounding box (+ margin), square
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const i of isl?.list || []) { x0 = Math.min(x0, i.x - i.radius); x1 = Math.max(x1, i.x + i.radius); z0 = Math.min(z0, i.z - i.radius); z1 = Math.max(z1, i.z + i.radius); }
    if (!isFinite(x0)) { x0 = z0 = -HALF_WORLD; x1 = z1 = HALF_WORLD; }
    const size = Math.min(WORLD_SIZE, Math.max(x1 - x0, z1 - z0) * 1.12);
    this._ext = { cx: clamp((x0 + x1) / 2, -HALF_WORLD + size / 2, HALF_WORLD - size / 2), cz: clamp((z0 + z1) / 2, -HALF_WORLD + size / 2, HALF_WORLD - size / 2), size };
    const E = this._ext;
    const N = 720, cell = E.size / N;
    const H = new Float32Array((N + 1) * (N + 1));
    const hf = isl?.getTerrainHeight ? (x, z) => isl.getTerrainHeight(x, z) : () => -50;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) H[j * (N + 1) + i] = hf(E.cx - E.size / 2 + i * cell, E.cz - E.size / 2 + j * cell);
    this._H = H; this._N = N; this._cell = cell;
    // distance (cells) from land: two-pass chamfer
    const M = N + 1, D = new Float32Array(M * M);
    for (let k = 0; k < D.length; k++) D[k] = H[k] > 0 ? 0 : 1e6;
    const a = 1, b = 1.414;
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const k = j * M + i; let d = D[k];
      if (i > 0) d = Math.min(d, D[k - 1] + a);
      if (j > 0) { d = Math.min(d, D[k - M] + a); if (i > 0) d = Math.min(d, D[k - M - 1] + b); if (i < M - 1) d = Math.min(d, D[k - M + 1] + b); }
      D[k] = d;
    }
    for (let j = M - 1; j >= 0; j--) for (let i = M - 1; i >= 0; i--) {
      const k = j * M + i; let d = D[k];
      if (i < M - 1) d = Math.min(d, D[k + 1] + a);
      if (j < M - 1) { d = Math.min(d, D[k + M] + a); if (i < M - 1) d = Math.min(d, D[k + M + 1] + b); if (i > 0) d = Math.min(d, D[k + M - 1] + b); }
      D[k] = d;
    }
    // ---- paint ----
    const S = 3072, c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d');
    const px = S / N;                       // canvas px per cell
    const rnd = mulberry32(9137);
    this._paintParchment(ctx, S, rnd);
    // sea wash: hand-tinted band hugging the coasts (blue-green watercolour), lighter in shallows
    {
      const img = ctx.getImageData(0, 0, S, S), d = img.data;
      const NN = N + 1;
      for (let y = 0; y < S; y++) {
        const fy = y / px, j = Math.min(N - 1, fy | 0), v = fy - j;
        for (let x = 0; x < S; x++) {
          const fx = x / px, i = Math.min(N - 1, fx | 0), u = fx - i, k = j * NN + i;
          const h = (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + NN] * (1 - u) + H[k + NN + 1] * u) * v;
          const o = (y * S + x) * 4;
          if (h > 0) continue;
          const dd = (D[k] * (1 - u) + D[k + 1] * u) * (1 - v) + (D[k + NN] * (1 - u) + D[k + NN + 1] * u) * v;
          let w = Math.exp(-dd / 9) * 0.5 + (h > -6 ? 0.2 : 0) + Math.exp(-dd / 40) * 0.12;
          w = Math.min(0.62, w);
          d[o] = d[o] + (SEA_TINT[0] - d[o]) * w; d[o + 1] = d[o + 1] + (SEA_TINT[1] - d[o + 1]) * w; d[o + 2] = d[o + 2] + (SEA_TINT[2] - d[o + 2]) * w;
          // reef / shoal: speckled pale
          if (h > -2.2 && h < 0 && ((x * 7 + y * 13) % 11 === 0)) { d[o] *= 0.75; d[o + 1] *= 0.75; d[o + 2] *= 0.72; }
        }
      }
      // land wash: ochre to green by height, darker edge
      for (let y = 0; y < S; y++) {
        const fy = y / px, j = Math.min(N - 1, fy | 0), v = fy - j;
        for (let x = 0; x < S; x++) {
          const fx = x / px, i = Math.min(N - 1, fx | 0), u = fx - i, k = j * NN + i;
          const h = (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + NN] * (1 - u) + H[k + NN + 1] * u) * v;
          if (h <= 0) continue;
          const o = (y * S + x) * 4;
          const t = clamp(h / 220, 0, 1);
          const sand = h < 3 ? 1 - h / 3 : 0;
          const col = [174 - 40 * t + 40 * sand, 168 - 22 * t + 30 * sand, 104 - 30 * t + 20 * sand];
          const n = 0.92 + 0.08 * Math.sin(x * 0.05 + Math.sin(y * 0.04) * 3) * Math.sin(y * 0.031);
          const w = 0.55;
          d[o] = d[o] * (1 - w) + col[0] * n * w; d[o + 1] = d[o + 1] * (1 - w) + col[1] * n * w; d[o + 2] = d[o + 2] * (1 - w) + col[2] * n * w;
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    // engraved coastal water-lines: contours of the distance field, fading out to sea
    const contour = (F, iso, style) => this._contour(ctx, F, N, px, iso, style);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const rings = [1.2, 2.4, 3.8, 5.6, 8, 11];
    rings.forEach((r, i) => contour(D, r, { stroke: INK2 + (0.5 - i * 0.07).toFixed(2) + ')', width: 1.4 - i * 0.12 }));
    // shoals: dotted
    ctx.setLineDash([2, 4]); contour(H, -4, { stroke: INK2 + '0.45)', width: 1.2 }); ctx.setLineDash([]);
    // relief: contour shading + hachures
    for (const [lv, a] of [[40, 0.18], [90, 0.22], [160, 0.26], [250, 0.3]]) contour(H, lv, { stroke: INK2 + a + ')', width: 1 });
    this._hachures(ctx, H, N, px, rnd);
    // the coast itself: a soft shadow line then the heavy ink line
    contour(H, 0, { stroke: 'rgba(60,40,20,0.25)', width: 7 });
    contour(H, 0, { stroke: INK, width: 2.6 });
    // stippled beaches just inside the coastline
    {
      ctx.fillStyle = INK2 + '0.5)';
      for (let k = 0; k < 90000; k++) {
        const i = rnd() * N, j = rnd() * N;
        const h = this._h(i, j);
        if (h > 0.3 && h < 6) ctx.fillRect(i * px, j * px, 1.6, 1.6);
      }
    }
    // tree clumps (little engraved bumps) on moist mid-lowlands
    this._trees(ctx, H, N, px, rnd);
    // rhumb lines + compass roses (chart space)
    this._rosesAndRhumbs(ctx, S, rnd, D, N, px);
    this._monsters(ctx, S, D, N, px);
    // feather the chart's square edges into the surrounding paper
    {
      const fw = S * 0.07;
      ctx.globalCompositeOperation = 'destination-out';
      for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [[0, 0, fw, 0, 0, 0, fw, S], [S, 0, S - fw, 0, S - fw, 0, fw, S], [0, 0, 0, fw, 0, 0, S, fw], [0, S, 0, S - fw, 0, S - fw, S, fw]]) {
        const gg = ctx.createLinearGradient(x0, y0, x1, y1); gg.addColorStop(0, 'rgba(0,0,0,1)'); gg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gg; ctx.fillRect(rx, ry, rw, rh);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    const paper = this._paper = document.createElement('canvas'); paper.width = 2048; paper.height = 1152;
    this._paintParchment(paper.getContext('2d'), 2048, mulberry32(4242), 1152);
    this._base = c;
    console.info(`[worldmap] base chart baked in ${(performance.now() - t0).toFixed(0)} ms`);
    // flags
    for (const f of Object.keys(FACTIONS)) {
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(flagSVG(f, { w: 60, h: 40 }).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
      img.onload = () => { if (this.isOpen) this.draw(); };
      this._flagImgs[f] = img;
    }
    document.fonts?.load?.("16px 'IM Fell English SC'").then(() => { if (this.isOpen) this.draw(); }).catch(() => {});
    document.fonts?.load?.("italic 16px 'IM Fell English'").then(() => { if (this.isOpen) this.draw(); }).catch(() => {});
    document.fonts?.load?.("italic 12px 'Spectral'").then(() => { if (this.isOpen) this.draw(); }).catch(() => {});   // annotations (convoys, lairs, treasure, towns)
  }
  _h(i, j) { const N = this._N, H = this._H; i = clamp(i, 0, N - 0.001); j = clamp(j, 0, N - 0.001); const a = i | 0, b = j | 0, u = i - a, v = j - b, M = N + 1, k = b * M + a; return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + M] * (1 - u) + H[k + M + 1] * u) * v; }

  _paintParchment(ctx, S, rnd, Hh = S) {
    const g = ctx.createRadialGradient(S / 2, Hh / 2, S * 0.1, S / 2, Hh / 2, S * 0.75);
    g.addColorStop(0, '#efe0b8'); g.addColorStop(0.7, '#e3cd98'); g.addColorStop(1, '#c9a868');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    // mottled stains + fibres
    for (let i = 0; i < 260; i++) {
      const x = rnd() * S, y = rnd() * S, r = 40 + rnd() * 260;
      const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = rnd() < 0.6;
      gg.addColorStop(0, dark ? 'rgba(120,80,30,0.07)' : 'rgba(255,245,215,0.10)'); gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.strokeStyle = 'rgba(110,80,40,0.06)'; ctx.lineWidth = 1;
    for (let i = 0; i < 3000; i++) { const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI, l = 6 + rnd() * 18; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke(); }
    // fold creases
    ctx.strokeStyle = 'rgba(90,60,30,0.10)'; ctx.lineWidth = 3;
    for (const f of [S / 3, (2 * S) / 3]) { ctx.beginPath(); ctx.moveTo(f + (rnd() - 0.5) * 8, 0); ctx.lineTo(f + (rnd() - 0.5) * 8, S); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0, S / 2); ctx.lineTo(S, S / 2 + 6); ctx.stroke();
  }

  // marching squares on grid F (N+1 squared) at iso; draws segments joined per cell
  _contour(ctx, F, N, px, iso, { stroke, width }) {
    const M = N + 1;
    ctx.strokeStyle = stroke; ctx.lineWidth = width;
    ctx.beginPath();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * M + i;
      const a = F[k] - iso, b = F[k + 1] - iso, c = F[k + M + 1] - iso, d = F[k + M] - iso;
      const code = (a > 0 ? 8 : 0) | (b > 0 ? 4 : 0) | (c > 0 ? 2 : 0) | (d > 0 ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const t = (p, q) => p / (p - q);
      const top = [i + t(a, b), j], right = [i + 1, j + t(b, c)], bot = [i + t(d, c), j + 1], left = [i, j + t(a, d)];
      const seg = (p, q) => { ctx.moveTo(p[0] * px, p[1] * px); ctx.lineTo(q[0] * px, q[1] * px); };
      switch (code) {
        case 1: case 14: seg(left, bot); break;
        case 2: case 13: seg(bot, right); break;
        case 3: case 12: seg(left, right); break;
        case 4: case 11: seg(top, right); break;
        case 5: seg(left, top); seg(bot, right); break;
        case 6: case 9: seg(top, bot); break;
        case 7: case 8: seg(left, top); break;
        case 10: seg(left, bot); seg(top, right); break;
      }
    }
    ctx.stroke();
  }

  _hachures(ctx, H, N, px, rnd) {
    ctx.strokeStyle = INK2 + '0.55)';
    for (let k = 0; k < 60000; k++) {
      const i = 1 + rnd() * (N - 2), j = 1 + rnd() * (N - 2);
      const h = this._h(i, j);
      if (h < 12) continue;
      const gx = this._h(i + 1, j) - this._h(i - 1, j), gz = this._h(i, j + 1) - this._h(i, j - 1);
      const gm = Math.hypot(gx, gz);
      if (gm < 6) continue;
      // light from the north-west: south-east facing slopes get heavier strokes
      const shade = clamp(0.4 + (gx + gz) / gm * 0.4, 0.15, 1);
      if (rnd() > shade) continue;
      const len = clamp(gm * 0.12, 1.2, 4.5) * px * 0.6;
      const ux = -gx / gm, uz = -gz / gm;     // downhill
      const x = i * px, y = j * px;
      ctx.lineWidth = 0.6 + shade * 0.9;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + ux * len, y + uz * len); ctx.stroke();
    }
    // peaks: little engraved mountain glyphs on high ground
    for (let k = 0; k < 9000; k++) {
      const i = 2 + rnd() * (N - 4), j = 2 + rnd() * (N - 4), h = this._h(i, j);
      if (h < 120) continue;
      if (this._h(i + 2, j) > h || this._h(i - 2, j) > h || this._h(i, j + 2) > h || this._h(i, j - 2) > h) continue;
      const x = i * px, y = j * px, s = 6 + Math.min(14, h / 25);
      ctx.fillStyle = 'rgba(240,226,190,0.9)'; ctx.strokeStyle = INK;
      ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(x - s, y + s * 0.5); ctx.quadraticCurveTo(x - s * 0.3, y - s * 0.4, x, y - s); ctx.quadraticCurveTo(x + s * 0.35, y - s * 0.3, x + s, y + s * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 0.8;
      for (let q = 0; q < 5; q++) { const qx = x + s * (0.1 + q * 0.16); ctx.beginPath(); ctx.moveTo(qx, y - s * (0.75 - q * 0.17)); ctx.lineTo(qx - s * 0.12, y + s * 0.45); ctx.stroke(); }
    }
  }

  _trees(ctx, H, N, px, rnd) {
    ctx.strokeStyle = INK2 + '0.6)'; ctx.lineWidth = 1;
    for (let k = 0; k < 16000; k++) {
      const i = rnd() * N, j = rnd() * N, h = this._h(i, j);
      if (h < 8 || h > 110) continue;
      if (rnd() > 0.5) continue;
      const x = i * px, y = j * px, r = 2.4 + rnd() * 1.6;
      ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + r * 0.9); ctx.stroke();
    }
  }

  // open sea far from land, used to place roses / monsters
  _openSea(D, N, minD, rnd, avoid = []) {
    let best = null;
    for (let k = 0; k < 800; k++) {
      const i = 0.08 * N + rnd() * N * 0.84, j = 0.08 * N + rnd() * N * 0.84;
      const d = D[(j | 0) * (N + 1) + (i | 0)];
      if (d < minD) continue;
      if (avoid.some(a => Math.hypot(a[0] - i, a[1] - j) < N * 0.22)) continue;
      if (!best || d > best[2]) best = [i, j, d];
    }
    return best;
  }

  _rosesAndRhumbs(ctx, S, rnd, D, N, px) {
    const r2 = mulberry32(51);
    const a = this._openSea(D, N, 28, r2) || [N * 0.5, N * 0.6, 0];
    const b = this._openSea(D, N, 22, r2, [a]) || [N * 0.2, N * 0.2, 0];
    this._roses = [a, b];
    // rhumb lines: 32 from the main rose across the whole chart, 16 from the secondary
    for (const [rose, n, alpha] of [[a, 32, 0.22], [b, 16, 0.16]]) {
      const cx = rose[0] * px, cy = rose[1] * px;
      for (let k = 0; k < n; k++) {
        const ang = k / n * Math.PI * 2;
        ctx.strokeStyle = k % 4 === 0 ? `rgba(42,28,16,${alpha + 0.08})` : k % 2 === 0 ? `rgba(110,40,30,${alpha})` : `rgba(40,80,60,${alpha})`;
        ctx.lineWidth = k % 4 === 0 ? 1.4 : 1;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(ang) * S * 1.5, cy - Math.cos(ang) * S * 1.5); ctx.stroke();
      }
    }
    this._drawRose(ctx, a[0] * px, a[1] * px, S * 0.075, true);
    this._drawRose(ctx, b[0] * px, b[1] * px, S * 0.045, false);
  }

  _drawRose(ctx, x, y, R, fancy) {
    ctx.save(); ctx.translate(x, y);
    // rings
    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(245,232,198,0.85)';
    ctx.beginPath(); ctx.arc(0, 0, R * 0.78, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, R * 0.72, 0, Math.PI * 2); ctx.stroke();
    // degree ticks
    for (let k = 0; k < 128; k++) {
      const a = k / 128 * Math.PI * 2, l = k % 4 === 0 ? 0.07 : 0.035;
      ctx.beginPath(); ctx.moveTo(Math.sin(a) * R * 0.72, -Math.cos(a) * R * 0.72); ctx.lineTo(Math.sin(a) * R * (0.72 + l * 0.85), -Math.cos(a) * R * (0.72 + l * 0.85)); ctx.stroke();
    }
    // points: 32 → 16 → 8 → 4 in decreasing length, half-shaded engraving style
    const pts = [[32, 0.42, 0.04, '#e8d6a8', '#7a6040'], [16, 0.55, 0.06, '#3a5a4a', '#e8d6a8'], [8, 0.7, 0.08, '#8e1b1b', '#e8d6a8'], [4, 0.98, 0.11, INK, '#f1e3bf']];
    for (const [n, len, wid, c1, c2] of pts) {
      for (let k = 0; k < n; k++) {
        const a = k / n * Math.PI * 2;
        if (n > 4 && k % (n / 4) === 0) continue;
        ctx.save(); ctx.rotate(a);
        const L = R * len, W = R * wid;
        ctx.fillStyle = c1; ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(W, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = c2; ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(-W, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(W, 0); ctx.lineTo(0, 0); ctx.lineTo(-W, 0); ctx.closePath(); ctx.stroke();
        ctx.restore();
      }
    }
    // fleur-de-lis-like north finial (original simple trefoil)
    ctx.fillStyle = '#8e1b1b'; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
    ctx.save(); ctx.translate(0, -R * 1.02);
    ctx.beginPath(); ctx.moveTo(0, -R * 0.16); ctx.bezierCurveTo(R * 0.06, -R * 0.1, R * 0.05, -R * 0.03, 0, 0); ctx.bezierCurveTo(-R * 0.05, -R * 0.03, -R * 0.06, -R * 0.1, 0, -R * 0.16); ctx.fill(); ctx.stroke();
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, -R * 0.02); ctx.bezierCurveTo(s * R * 0.1, -R * 0.12, s * R * 0.14, -R * 0.02, s * R * 0.08, R * 0.02); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = '#c9a24a'; ctx.beginPath(); ctx.arc(0, 0, R * 0.05, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (fancy) {
      ctx.fillStyle = INK; ctx.font = `${Math.round(R * 0.13)}px 'IM Fell English SC', Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lab = ['', 'E', 'S', 'W'];
      lab.forEach((l, k) => { if (!l) return; const a = k / 4 * Math.PI * 2; ctx.fillText(l, Math.sin(a) * R * 1.0, -Math.cos(a) * R * 1.0); });
    }
    ctx.restore();
  }

  _monsters(ctx, S, D, N, px) {
    const r = mulberry32(77);
    const used = this._roses.slice();
    const a = this._openSea(D, N, 30, r, used); if (a) used.push(a);
    const b = this._openSea(D, N, 24, r, used);
    if (a) this._serpent(ctx, a[0] * px, a[1] * px, S * 0.05);
    if (b) this._whale(ctx, b[0] * px, b[1] * px, S * 0.032);
  }

  _hatchFill(ctx, path, ang, gap, color = INK2 + '0.5)') {
    ctx.save(); ctx.clip(path);
    ctx.strokeStyle = color; ctx.lineWidth = 0.9;
    const R = 2000;
    ctx.beginPath();
    for (let d = -R; d < R; d += gap) { ctx.moveTo(Math.cos(ang) * d - Math.sin(ang) * R, Math.sin(ang) * d + Math.cos(ang) * R); ctx.lineTo(Math.cos(ang) * d + Math.sin(ang) * R, Math.sin(ang) * d - Math.cos(ang) * R); }
    ctx.stroke(); ctx.restore();
  }

  _serpent(ctx, x, y, R) {
    ctx.save(); ctx.translate(x, y);
    ctx.lineJoin = 'round';
    // three humps breaking the water, a head with a crest, a tail flick
    const humps = [[-0.9, 0.28], [-0.25, 0.34], [0.38, 0.26]];
    for (const [hx, hr] of humps) {
      const p = new Path2D();
      p.moveTo((hx - hr) * R, 0);
      p.bezierCurveTo((hx - hr) * R, -hr * 1.9 * R, (hx + hr) * R, -hr * 1.9 * R, (hx + hr) * R, 0);
      p.lineTo((hx + hr * 0.62) * R, 0);
      p.bezierCurveTo((hx + hr * 0.62) * R, -hr * 1.2 * R, (hx - hr * 0.62) * R, -hr * 1.2 * R, (hx - hr * 0.62) * R, 0);
      p.closePath();
      ctx.fillStyle = '#5e7a5a'; ctx.fill(p);
      this._hatchFill(ctx, p, 0.9, 3.2);
      ctx.strokeStyle = INK; ctx.lineWidth = 1.8; ctx.stroke(p);
      // scutes along the top
      ctx.fillStyle = '#d8c48e';
      for (let k = 1; k < 6; k++) { const t = k / 6, ax = (hx - hr) * R + t * hr * 2 * R, ay = -Math.sin(t * Math.PI) * hr * 1.45 * R; ctx.beginPath(); ctx.moveTo(ax - 4, ay); ctx.lineTo(ax, ay - 9); ctx.lineTo(ax + 4, ay); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    }
    // neck + head rising at the right
    const n = new Path2D();
    n.moveTo(0.78 * R, 0); n.bezierCurveTo(0.8 * R, -0.5 * R, 0.95 * R, -0.95 * R, 1.25 * R, -0.95 * R);
    n.bezierCurveTo(1.45 * R, -0.95 * R, 1.55 * R, -0.85 * R, 1.62 * R, -0.78 * R);
    n.lineTo(1.4 * R, -0.72 * R);
    n.bezierCurveTo(1.25 * R, -0.75 * R, 1.08 * R, -0.65 * R, 1.06 * R, -0.35 * R);
    n.bezierCurveTo(1.05 * R, -0.15 * R, 1.06 * R, -0.05 * R, 1.08 * R, 0);
    n.closePath();
    ctx.fillStyle = '#5e7a5a'; ctx.fill(n); this._hatchFill(ctx, n, 0.6, 3); ctx.strokeStyle = INK; ctx.lineWidth = 1.8; ctx.stroke(n);
    // jaw, eye, fin crest
    ctx.fillStyle = '#8e1b1b'; ctx.beginPath(); ctx.moveTo(1.42 * R, -0.74 * R); ctx.lineTo(1.66 * R, -0.66 * R); ctx.lineTo(1.4 * R, -0.66 * R); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f2e6c4'; ctx.beginPath(); ctx.arc(1.3 * R, -0.86 * R, R * 0.035, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(1.31 * R, -0.86 * R, R * 0.015, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b8a26a';
    const crest = new Path2D(); crest.moveTo(1.0 * R, -0.62 * R);
    for (let k = 0; k < 5; k++) { crest.lineTo((0.96 + k * 0.06) * R, (-1.05 - k * 0.02) * R); crest.lineTo((1.02 + k * 0.06) * R, (-0.9 - k * 0.01) * R); }
    crest.lineTo(1.28 * R, -0.95 * R); crest.closePath(); ctx.fill(crest); ctx.stroke(crest);
    // tail
    ctx.lineWidth = 1.8; ctx.fillStyle = '#5e7a5a';
    const t = new Path2D(); t.moveTo(-1.45 * R, 0); t.bezierCurveTo(-1.5 * R, -0.3 * R, -1.7 * R, -0.45 * R, -1.85 * R, -0.42 * R); t.lineTo(-1.7 * R, -0.3 * R); t.bezierCurveTo(-1.62 * R, -0.18 * R, -1.6 * R, -0.08 * R, -1.3 * R, 0); t.closePath();
    ctx.fill(t); ctx.stroke(t);
    // water ripples under the coils
    ctx.strokeStyle = INK2 + '0.7)'; ctx.lineWidth = 1.2;
    for (let k = 0; k < 4; k++) { ctx.beginPath(); for (let xx = -2 * R; xx < 1.9 * R; xx += 6) { const yy = 3 + k * 6 + Math.sin(xx * 0.09 + k) * 2; xx === -2 * R ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy); } ctx.globalAlpha = 1 - k * 0.22; ctx.stroke(); }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _whale(ctx, x, y, R) {
    ctx.save(); ctx.translate(x, y);
    const b = new Path2D();
    b.moveTo(-1.2 * R, 0);
    b.bezierCurveTo(-1.1 * R, -0.7 * R, 0.6 * R, -0.8 * R, 1.1 * R, -0.25 * R);
    b.bezierCurveTo(1.25 * R, -0.08 * R, 1.2 * R, 0.0, 1.05 * R, 0.05 * R);
    b.lineTo(-1.2 * R, 0.05 * R); b.closePath();
    ctx.fillStyle = '#6f7d86'; ctx.fill(b); this._hatchFill(ctx, b, -0.4, 3.2);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.7; ctx.stroke(b);
    // tail flukes behind
    const t = new Path2D(); t.moveTo(-1.15 * R, -0.05 * R); t.bezierCurveTo(-1.5 * R, -0.3 * R, -1.6 * R, -0.65 * R, -1.85 * R, -0.75 * R); t.bezierCurveTo(-1.6 * R, -0.45 * R, -1.45 * R, -0.42 * R, -1.3 * R, -0.5 * R);
    t.bezierCurveTo(-1.35 * R, -0.85 * R, -1.25 * R, -1.0 * R, -1.1 * R, -1.05 * R); t.bezierCurveTo(-1.25 * R, -0.6 * R, -1.2 * R, -0.3 * R, -1.0 * R, -0.05 * R); t.closePath();
    ctx.fillStyle = '#6f7d86'; ctx.fill(t); ctx.stroke(t);
    // eye, mouth line, spout
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(0.8 * R, -0.22 * R, R * 0.04, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(1.12 * R, -0.08 * R); ctx.quadraticCurveTo(0.8 * R, -0.05 * R, 0.6 * R, -0.12 * R); ctx.stroke();
    ctx.strokeStyle = 'rgba(40,80,110,0.8)';
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(0.45 * R, -0.62 * R); ctx.quadraticCurveTo((0.45 + s * 0.12 * (k + 1)) * R, -1.3 * R, (0.45 + s * 0.3 * (k + 1)) * R, (-1.0 + k * 0.12) * R); ctx.stroke(); }
    ctx.strokeStyle = INK2 + '0.7)'; ctx.lineWidth = 1.2;
    for (let k = 0; k < 3; k++) { ctx.beginPath(); for (let xx = -2 * R; xx < 1.5 * R; xx += 6) { const yy = 6 + k * 6 + Math.sin(xx * 0.1 + k) * 2; xx === -2 * R ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy); } ctx.stroke(); }
    ctx.restore();
  }

  // ------------------------------------------------------------------ per-frame draw
  draw() {
    if (!this._base) return;
    const ctx = this.ctx, dpr = this.dpr || 1, g = this.game;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = innerWidth, Hh = innerHeight, f = this._frame(), s = this._scale(), E = this._ext;
    // outside the neatline: dark wood table
    ctx.fillStyle = '#1e120a'; ctx.fillRect(0, 0, W, Hh);
    ctx.save();
    ctx.beginPath(); ctx.rect(f.x, f.y, f.w, f.h); ctx.clip();
    ctx.drawImage(this._paper, f.x, f.y, f.w, f.h);
    const [bx, by] = this.w2s(E.cx - E.size / 2, E.cz - E.size / 2);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this._base, bx, by, E.size * s, E.size * s);
    this._labels = []; this._rects = []; this._hits = [];
    // reserve the fixed furniture so labels never run under it
    this._reserveFurniture(f);
    if (this.layers.zones) this._drawZones(ctx, s);       // sea tiers: guarded waters, perilous seas
    if (this.layers.weather) this._drawWeather(ctx, s);   // squalls and storms
    if (this.layers.track) this._drawTrack(ctx);
    this._drawLabels(ctx, s);
    if (this.layers.missions) this._drawMissions(ctx, s);   // governor's missions under way (career.missionTargets)
    this._drawShips(ctx, s);
    this._flushLabels(ctx);
    this._drawCartouche(ctx, f);
    this._drawScale(ctx, f, s);
    this._drawWindRose(ctx, f);
    // vignette / burnt edge inside the frame
    const vg = ctx.createRadialGradient(f.x + f.w / 2, f.y + f.h / 2, Math.min(f.w, f.h) * 0.42, f.x + f.w / 2, f.y + f.h / 2, Math.max(f.w, f.h) * 0.75);
    vg.addColorStop(0, 'rgba(80,50,20,0)'); vg.addColorStop(1, 'rgba(80,50,20,0.4)');
    ctx.fillStyle = vg; ctx.fillRect(f.x, f.y, f.w, f.h);
    ctx.restore();
    this._drawBorder(ctx, f, s);
    void g;
  }

  // ---------------------------------------------------------------- labels (decluttered) & hover targets
  // label(text, x, y, { font, color, halo, prio, pos }) queues a label; pos = candidate anchors tried in order
  // ('r' right of the point, 'l', 't' above, 'b' below, 'c' centred). Higher prio is placed first; a label that
  // would overlap an already placed one (or the chart furniture) at every candidate is dropped.
  label(text, x, y, o = {}) { this._labels.push({ text, x, y, font: o.font || `13px 'IM Fell English SC', Georgia, serif`, color: o.color || INK, halo: o.halo ?? 'rgba(240,226,190,0.85)', prio: o.prio ?? 1, pos: o.pos || ['r', 'l', 't', 'b'], gap: o.gap ?? 6, hw: o.halfW || 0 }); }
  hit(x, y, r, html) { this._hits.push({ x, y, r, html }); }
  _reserveFurniture(f) {
    const cw = clamp(f.w * 0.3, 300, 470);
    this._rects.push([f.x + f.w - cw - 30, f.y + f.h - cw * 0.42 - 30, cw + 30, cw * 0.42 + 30]);   // cartouche
    const R = clamp(f.h * 0.075, 46, 80); this._rects.push([f.x + 20, f.y + 20, R * 2 + 40, R * 2 + 50]);   // wind rose
    this._rects.push([f.x, f.y + f.h - 60, 260, 60]);   // scale of leagues
    const lg = this.legend?.getBoundingClientRect?.(); if (lg?.width) this._rects.push([lg.left - 6, lg.top - 6, lg.width + 12, lg.height + 12]);
  }
  _flushLabels(ctx) {
    const L = this._labels.sort((a, b) => b.prio - a.prio), R = this._rects;
    const free = (x, y, w, h) => !R.some(r => x < r[0] + r[2] && x + w > r[0] && y < r[1] + r[3] && y + h > r[1]);
    ctx.save(); ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (const l of L) {
      ctx.font = l.font;
      const w = ctx.measureText(l.text).width, h = parseFloat(/(\d+(?:\.\d+)?)px/.exec(l.font)?.[1] || 13) * 1.05, g = l.gap + l.hw;
      for (const p of l.pos) {
        const x = p === 'r' ? l.x + g : p === 'l' ? l.x - g - w : l.x - w / 2;
        const yc = p === 't' ? l.y - g - h / 2 : p === 'b' ? l.y + g + h / 2 : l.y;
        if (!free(x - 2, yc - h / 2 - 1, w + 4, h + 2)) continue;
        R.push([x - 2, yc - h / 2 - 1, w + 4, h + 2]);
        ctx.textAlign = 'left';
        if (l.halo) { ctx.lineWidth = 3.5; ctx.strokeStyle = l.halo; ctx.strokeText(l.text, x, yc); }
        ctx.fillStyle = l.color; ctx.fillText(l.text, x, yc);
        break;
      }
    }
    ctx.restore();
  }
  _syncLegend() { for (const r of this.legend?.querySelectorAll('.wl-row') || []) r.classList.toggle('on', !!this.layers[r.dataset.l]); }
  _centerPlayer() {
    const p = this.game.player; if (!p) return;
    this.view.cx = p.position.x; this.view.cz = p.position.z; this.view.zoom = Math.max(this.view.zoom, 2.2); this._clampView(); this.draw();
  }
  _hover(mx, my) {
    let best = null, bd = Infinity;
    for (const h of this._hits) { const d = Math.hypot(h.x - mx, h.y - my); if (d < h.r && d < bd) { bd = d; best = h; } }
    this._showTip(best, mx, my);
  }
  _showTip(h, mx, my) {
    const t = this.tip; if (!t) return;
    if (!h) { if (!t.classList.contains('off')) t.classList.add('off'); this._tipH = null; return; }
    if (this._tipH !== h.html) { t.innerHTML = h.html; this._tipH = h.html; }
    t.classList.remove('off');
    const W = innerWidth, H = innerHeight, r = t.getBoundingClientRect();
    t.style.left = `${clamp(mx + 18, 8, W - r.width - 8)}px`; t.style.top = `${clamp(my + 14, 8, H - r.height - 8)}px`;
  }
  _bearing(x, z) {
    const p = this.game.player; if (!p) return '';
    const d = Math.hypot(x - p.position.x, z - p.position.z), a = Math.atan2(x - p.position.x, -(z - p.position.z));
    const pt = COMPASS16[Math.round(((a * 180 / Math.PI + 360) % 360) / 22.5) % 16];
    return d < 150 ? 'right here' : `${fmtNum(d / 1000, 1)}${NNBSP}km ${pt}`;
  }

  _drawLabels(ctx, s) {
    const g = this.game, isl = g.islands, L = this.layers;
    const z = this.view.zoom;
    // island names: italic, letter-spaced, sized by island size (lowest priority, centred on the island only)
    if (L.labels) for (const i of isl?.list || []) {
      const px = i.radius * s;
      if (px < 18 && z < 3) continue;
      const [x, y] = this.w2s(i.x, i.z);
      const fs = clamp(px * 0.22, 11, 30);
      this.label(i.name.toUpperCase().split('').join(' '), x, y, { font: `italic ${fs.toFixed(0)}px 'IM Fell English', Georgia, serif`, color: '#3a2412', halo: 'rgba(233,216,174,0.75)', prio: 2 + fs / 30, pos: ['c', 't', 'b'], gap: 0 });
    }
    // known coves
    if (L.treasure) {
      const known = new Set(g.state?.knownCoves || []);
      for (const c of isl?.coves || []) {
        if (!known.has(c.id)) continue;
        const [x, y] = this.w2s(c.x, c.z);
        ctx.strokeStyle = '#8e1b1b'; ctx.lineWidth = 2.4;
        const r = 6;
        ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
        this.label('a cove, so they say', x, y, { font: `italic 12px 'Spectral', Georgia, serif`, color: '#6b1a12', prio: 4, gap: 9 });
        this.hit(x, y, 14, `<b>Cove</b><span>A cove known only to smugglers, so they say.</span><em>${this._bearing(c.x, c.z)}</em>`);
      }
    }
    if (L.treasure || L.lords) g.fortune?.drawMap?.(ctx, this);   // treasure cross, pirate lairs (read map.layers)
    if (L.convoys || L.towns) g.living?.drawMap?.(ctx, this);     // rumoured convoy routes, town state
    if (L.villages) this._drawVillages(ctx, z);   // fishing villages (src/game/village.js)
    if (!L.ports) return;
    // ports: fortified-town glyph in the nation's colours, wealth pips, flag, name in small caps
    const pf = g.player?.faction;
    for (const p of isl?.ports || []) {
      const [x, y] = this.w2s(p.x, p.z);
      const big = p.size === 'large' ? 1.25 : p.size === 'medium' ? 1 : 0.85;
      const u = 7 * big;
      const fac = p.haven ? 'pirate' : p.faction;
      const fcol = FACTIONS[fac]?.color || '#c0623a';
      const rel = pf && !p.haven ? relation(pf, p.faction) : 0;
      const hostile = !p.haven && pf && pf !== p.faction && rel < 0;
      // nation roundel under the town
      ctx.beginPath(); ctx.arc(x, y + u * 0.1, u * 1.45, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(240,226,190,0.7)'; ctx.fill();
      ctx.lineWidth = 2.2; ctx.strokeStyle = fcol; ctx.stroke();
      if (hostile) { ctx.setLineDash([2.5, 2.5]); ctx.lineWidth = 1.2; ctx.strokeStyle = '#8e1b1b'; ctx.beginPath(); ctx.arc(x, y + u * 0.1, u * 1.8, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
      // fortified town glyph: bastioned square + church spire
      ctx.fillStyle = p.haven ? '#4a3a2a' : '#c0623a'; ctx.strokeStyle = INK; ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(x - u, y - u * 0.4); ctx.lineTo(x - u * 0.5, y - u * 0.8); ctx.lineTo(x, y - u * 0.4); ctx.lineTo(x + u * 0.5, y - u * 0.8); ctx.lineTo(x + u, y - u * 0.4);
      ctx.lineTo(x + u, y + u * 0.6); ctx.lineTo(x - u, y + u * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#efe4cf'; ctx.fillRect(x - u * 0.35, y - u * 0.1, u * 0.7, u * 0.7); ctx.strokeRect(x - u * 0.35, y - u * 0.1, u * 0.7, u * 0.7);
      ctx.beginPath(); ctx.moveTo(x, y - u * 1.6); ctx.lineTo(x + u * 0.22, y - u * 0.4); ctx.lineTo(x - u * 0.22, y - u * 0.4); ctx.closePath(); ctx.fillStyle = INK; ctx.fill();
      // flag on a staff
      const img = this._flagImgs[fac];
      ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x + u * 1.1, y + u * 0.6); ctx.lineTo(x + u * 1.1, y - u * 2.4); ctx.stroke();
      if (img?.complete && img.naturalWidth) ctx.drawImage(img, x + u * 1.1, y - u * 2.4, 22 * big, 15 * big);
      // wealth: gilt pips under the town (1–5)
      const wl = clamp(Math.round(g.living?.wealth?.(p) ?? (p.size === 'large' ? 4 : p.size === 'medium' ? 3 : 2)), 0, 5);
      if (z > 1.15 || big > 1) for (let k = 0; k < wl; k++) {
        const px = x + (k - (wl - 1) / 2) * 5.2, py = y + u * 1.25;
        ctx.beginPath(); ctx.arc(px, py, 2.1, 0, Math.PI * 2); ctx.fillStyle = '#d9b55a'; ctx.fill(); ctx.lineWidth = 0.8; ctx.strokeStyle = INK; ctx.stroke();
      }
      // name (decluttered: right of the flag, else left, above, below)
      const fs = clamp(12 + 2 * big + (z - 1) * 1.5, 12, 22);
      this.label(p.name, x, y - u * 0.6, { font: `${fs.toFixed(0)}px 'IM Fell English SC', Georgia, serif`, color: p.haven ? '#4a0e0e' : hostile ? '#6e1414' : INK, prio: 8 + big, halfW: u * 1.1 + 18 * big, gap: 4 });
      // hover card
      const t = g.state?.towns?.[p.id], gar = t?.garrison, pop = t?.pop ?? p.population;
      const note = g.living?.townNote?.(p);
      const stance = p.haven ? 'Pirate haven' : !pf ? nationName(p.faction) : p.faction === pf ? `${nationName(p.faction)} · your nation` : hostile ? `${nationName(p.faction)} · at war` : rel > 0 ? `${nationName(p.faction)} · allied` : `${nationName(p.faction)} · at peace`;
      this.hit(x, y, Math.max(16, u * 2), `<b>${esc(p.name)}</b><span class="${hostile ? 'bad' : ''}">${esc(stance)}</span>
        <span>${pop ? `${fmtInt(pop)} souls · ` : ''}wealth ${'●'.repeat(wl)}${'○'.repeat(5 - wl)}</span>${gar != null ? `<span>Garrison: ${fmtInt(gar)} men</span>` : ''}${note ? `<span class="bad">${esc(note)}</span>` : ''}<em>${this._bearing(p.x, p.z)}</em>`);
    }
  }

  // fishing villages: palm-roofed hut and a stretched net, no flag; name in smaller small caps
  _drawVillages(ctx, z) {
    for (const v of this.game.islands?.villages || []) {
      const [x, y] = this.w2s(v.x, v.z), u = 5.2;
      ctx.save(); ctx.lineJoin = 'round';
      ctx.fillStyle = 'rgba(240,226,190,0.75)'; ctx.beginPath(); ctx.arc(x, y, u * 1.7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = INK; ctx.lineWidth = 1.1; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#b8925a'; ctx.beginPath(); ctx.rect(x - u * 0.8, y - u * 0.1, u * 1.6, u * 0.9); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#7a5a2a'; ctx.beginPath(); ctx.moveTo(x - u * 1.15, y); ctx.lineTo(x, y - u * 1.1); ctx.lineTo(x + u * 1.15, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#2f5a6e'; ctx.lineWidth = 0.9;
      for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(x + u * 0.9, y + u * 0.8 - k * 1.6); ctx.quadraticCurveTo(x + u * 1.5, y + u * 0.2 - k * 1.6, x + u * 2.1, y + u * 0.6 - k * 1.6); ctx.stroke(); }
      ctx.restore();
      this.label(v.name, x, y, { font: `${clamp(11 + (z - 1) * 1.5, 11, 18).toFixed(0)}px 'IM Fell English SC', Georgia, serif`, color: '#3a2a1a', prio: 6, gap: u * 1.9 + 2 });
      const vt = this.game.seaZones?.at?.(v.harborPoint.x, v.harborPoint.z);
      this.hit(x, y, 16, `<b>${esc(v.name)}</b><span>Fishing village · no flag</span><span>Hull repairs up to 90%, barter, a few fishermen. Open to all.</span>${vt ? `<span class="${vt.tier === 3 ? 'bad' : vt.tier === 1 ? 'good' : ''}">${vt.tier === 1 ? 'Guarded waters' : vt.tier === 3 ? 'Perilous seas' : 'Trade routes'}</span>` : ''}<em>${this._bearing(v.x, v.z)}</em>`);
    }
  }

  // Missions under way: a wax seal and a dashed ring on the target (port, islet, quarry's cruising ground), an italic
  // Spectral note and a hover card with the objective and the deadline.
  _drawMissions(ctx, s) {
    const g = this.game, list = g.career?.missionTargets?.() || [];
    if (!list.length) return;
    const RED = '#8c1c22', z = this.view.zoom;
    const date = n => g.living?.dateLabel?.(n) || '';
    ctx.save();
    for (const t of list) {
      const [x, y] = this.w2s(t.x, t.z);
      if (t.r) {   // cruising ground: hatched disc
        const R = Math.max(10, t.r * s);
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(140,28,34,0.09)'; ctx.fill();
        ctx.setLineDash([5, 4]); ctx.lineWidth = 1.6; ctx.strokeStyle = RED; ctx.stroke(); ctx.setLineDash([]);
      } else if (t.port) {   // ring around the port glyph
        ctx.beginPath(); ctx.arc(x, y, 19 + Math.min(4, z), 0, Math.PI * 2);
        ctx.setLineDash([3, 3]); ctx.lineWidth = 1.8; ctx.strokeStyle = RED; ctx.stroke(); ctx.setLineDash([]);
      }
      // wax seal (offset from the port glyph, centred elsewhere)
      const sx = t.port ? x - 17 : x, sy = t.port ? y + 15 : y;
      ctx.beginPath(); ctx.arc(sx, sy, 5.2, 0, Math.PI * 2); ctx.fillStyle = '#a3262a'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = INK; ctx.stroke();
      ctx.strokeStyle = '#f1dcb0'; ctx.lineWidth = 1.2; ctx.beginPath();
      if (t.kind === 'quarry') { ctx.moveTo(sx - 2.6, sy - 2.6); ctx.lineTo(sx + 2.6, sy + 2.6); ctx.moveTo(sx + 2.6, sy - 2.6); ctx.lineTo(sx - 2.6, sy + 2.6); }
      else { ctx.moveTo(sx, sy - 2.8); ctx.lineTo(sx, sy + 2.8); ctx.moveTo(sx - 2.8, sy); ctx.lineTo(sx + 2.8, sy); }
      ctx.stroke();
      const when = t.deadline ? ` · before ${date(t.deadline)}` : '';
      this.label(`${t.label}${when}`, sx, sy, { font: `italic 12px 'Spectral', Georgia, serif`, color: '#6b1420', prio: 7.5, pos: t.port ? ['b', 'l', 'r', 't'] : ['r', 'l', 'b', 't'], gap: 8 });
      this.hit(sx, sy, t.r ? Math.max(16, Math.min(40, t.r * s)) : 16, `<b>${esc(t.title)}</b><span>${esc(t.tip)}</span>${t.deadline ? `<span>Before ${esc(date(t.deadline))}</span>` : ''}<em>${this._bearing(t.x, t.z)}</em>`);
    }
    ctx.restore();
  }

  _drawTrack(ctx) {
    const tr = this.track;
    if (tr.length < 2) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(142,27,27,0.85)'; ctx.lineWidth = 1.8; ctx.setLineDash([7, 5]); ctx.lineCap = 'round';
    ctx.beginPath();
    let pen = false;
    for (const p of tr) {
      if (!p) { pen = false; continue; }
      const [x, y] = this.w2s(p.x, p.z);
      if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
    }
    const pl = this.game.player;
    if (pl && pen) { const [x, y] = this.w2s(pl.position.x, pl.position.z); ctx.lineTo(x, y); }
    ctx.stroke(); ctx.restore();
  }

  _shipGlyph(ctx, x, y, heading, size, fill, own) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(heading);
    const L = size, B = size * 0.36;
    ctx.beginPath();
    ctx.moveTo(0, -L); ctx.bezierCurveTo(B, -L * 0.5, B, L * 0.5, B * 0.7, L * 0.8); ctx.lineTo(-B * 0.7, L * 0.8); ctx.bezierCurveTo(-B, L * 0.5, -B, -L * 0.5, 0, -L); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = own ? 1.8 : 1.2; ctx.stroke();
    // sail
    ctx.fillStyle = '#f4ead0'; ctx.beginPath(); ctx.moveTo(-B * 1.5, -L * 0.15); ctx.quadraticCurveTo(0, -L * 0.55, B * 1.5, -L * 0.15); ctx.quadraticCurveTo(0, -L * 0.3, -B * 1.5, -L * 0.15); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // weather cells (game.weatherZones) — squalls as inked cumulus with rain hatching, storms as a dark spiral
  // ---------------------------------------------------------------- sea tiers (src/data/seaZones.js)
  // Layer baked once at the chart's resolution, at sea only: perilous seas hatched in brick red under a dashed
  // boundary, guarded waters in a pale green wash edged with a green ink palisade. Names in IM Fell, notes in
  // Spectral italic, tooltips.
  _zoneLayer() {
    if (this._zl) return this._zl;
    const zd = this.game.seaZones?.data, E = this._ext; if (!zd || !E || !this._H) return null;
    const S = 1536, c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d'), k = S / E.size;
    const X = x => (x - (E.cx - E.size / 2)) * k, Y = z => (z - (E.cz - E.size / 2)) * k;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const z of zd.perilous) {
      const path = new Path2D();
      if (z.rx != null) path.ellipse(X(z.x), Y(z.z), z.rx * k, z.rz * k, 0, 0, Math.PI * 2);
      else path.rect(X(z.x0), Y(z.z0), (z.x1 - z.x0) * k, (z.z1 - z.z0) * k);
      ctx.save(); ctx.clip(path);
      ctx.fillStyle = 'rgba(176,82,48,0.13)'; ctx.fillRect(0, 0, S, S);
      ctx.strokeStyle = 'rgba(150,48,26,0.55)'; ctx.lineWidth = 1.8;
      ctx.beginPath(); for (let d = -S; d < 2 * S; d += 8) { ctx.moveTo(d, 0); ctx.lineTo(d + S, S); } ctx.stroke();
      ctx.restore();
      ctx.save(); ctx.setLineDash([10, 6]); ctx.strokeStyle = 'rgba(128,34,18,0.85)'; ctx.lineWidth = 2.6; ctx.stroke(path); ctx.restore();
    }
    for (const g of zd.guarded) {
      const x = X(g.x), y = Y(g.z), r = g.r * k;
      ctx.fillStyle = 'rgba(132,178,118,0.16)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      // washed edging in the manner of the territorial waters of old charts (no more "palisade", which looked like a
      // railway once the chart was enlarged): green band fading inward, solid line, dotted line
      const band = ctx.createRadialGradient(x, y, Math.max(0, r - 18), x, y, r);
      band.addColorStop(0, 'rgba(70,140,80,0)'); band.addColorStop(1, 'rgba(70,140,80,0.34)');
      ctx.fillStyle = band; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(28,78,42,0.85)'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.save(); ctx.setLineDash([2, 5]); ctx.lineWidth = 1.3; ctx.strokeStyle = 'rgba(28,78,42,0.6)'; ctx.beginPath(); ctx.arc(x, y, r - 6, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    // land stays clear of the layer (relief and towns readable)
    const img = ctx.getImageData(0, 0, S, S), d = img.data, N = this._N, M = N + 1, H = this._H, f = N / S;
    for (let y = 0; y < S; y++) { const j = Math.min(N, Math.round(y * f)) * M; for (let x = 0; x < S; x++) if (H[j + Math.min(N, Math.round(x * f))] > 0.5) d[(y * S + x) * 4 + 3] = 0; }
    ctx.putImageData(img, 0, 0);
    return (this._zl = c);
  }
  _drawZones(ctx, s) {
    const zd = this.game.seaZones?.data, zl = this._zoneLayer(); if (!zd || !zl) return;
    const E = this._ext, [bx, by] = this.w2s(E.cx - E.size / 2, E.cz - E.size / 2);
    ctx.drawImage(zl, bx, by, E.size * s, E.size * s);
    const z = this.view.zoom, tip = t => ZONE_TEXT[t].tip;
    for (const p of zd.perilous) {
      const [lx, lz] = p.label || [p.x ?? (p.x0 + p.x1) / 2, p.z ?? (p.z0 + p.z1) / 2];
      const [x, y] = this.w2s(lx, lz), fs = clamp(14 + (z - 1) * 2.5, 14, 24);
      this.label(p.name, x, y - fs * 0.45, { font: `italic ${fs.toFixed(0)}px 'IM Fell English', Georgia, serif`, color: '#6e1c10', halo: 'rgba(240,226,190,0.82)', prio: 5, pos: ['c', 't', 'b'], gap: 0 });
      this.label('perilous seas', x, y + fs * 0.62, { font: `italic ${Math.max(12, fs * 0.78).toFixed(0)}px 'Spectral', Georgia, serif`, color: '#7a2414', halo: 'rgba(240,226,190,0.8)', prio: 4.9, pos: ['c', 'b'], gap: 0 });
      this.hit(x, y, 46, `<b>${esc(p.name)}</b><span class="bad">Perilous seas</span><span>${tip(3)}</span><em>${this._bearing(lx, lz)}</em>`);
    }
    for (const g of zd.guarded) {
      const [x, y] = this.w2s(g.x, g.z - g.r), r = g.r * s;
      if (r < 18) continue;
      this.label('guarded waters', x, y, { font: `italic ${clamp(12 + (z - 1) * 1.5, 12, 18).toFixed(0)}px 'Spectral', Georgia, serif`, color: '#1e552d', halo: 'rgba(240,226,190,0.85)', prio: 4.8, pos: ['b', 't', 'c'], gap: 5 });
      this.hit(x, y + 10, 30, `<b>${esc(g.name)}</b><span class="good">Guarded waters</span><span>${tip(1)}</span>`);
    }
  }

  _drawWeather(ctx, s) {
    const zs = this.game.weatherZones?.zones; if (!zs) return;
    const t = this.game.time || 0;
    ctx.save();
    for (const zn of zs) {
      const [x, y] = this.w2s(zn.x, zn.z), R = zn.r * s;
      if (R < 2) continue;
      if (zn.kind === 'squall') {
        ctx.fillStyle = 'rgba(250,246,234,0.55)'; ctx.strokeStyle = 'rgba(60,50,40,0.55)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let k = 0; k < 5; k++) { const a = Math.PI * (1 + k / 4), rr = R * (0.32 + 0.12 * Math.sin(k * 2.3 + zn.seed)); ctx.moveTo(x + Math.cos(a) * R * 0.45 + rr, y + Math.sin(a) * R * 0.25); ctx.arc(x + Math.cos(a) * R * 0.45, y + Math.sin(a) * R * 0.25, rr, 0, Math.PI * 2); }
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(60,70,90,0.45)';
        for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(x + k * R * 0.14, y + R * 0.2); ctx.lineTo(x + k * R * 0.14 - R * 0.08, y + R * 0.62); ctx.stroke(); }
      } else {
        const g = ctx.createRadialGradient(x, y, R * 0.1, x, y, R);
        g.addColorStop(0, 'rgba(40,36,44,0.55)'); g.addColorStop(0.42, 'rgba(60,54,62,0.42)'); g.addColorStop(0.8, 'rgba(90,84,90,0.18)'); g.addColorStop(1, 'rgba(90,84,90,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(30,24,30,0.7)'; ctx.lineWidth = 1.4;
        for (let arm = 0; arm < 3; arm++) {
          ctx.beginPath();
          for (let k = 0; k <= 30; k++) { const u = k / 30, a = arm * 2.094 + u * 4.2 * zn.spin + t * 0.02 * zn.spin, rr = R * (0.12 + 0.85 * u); const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
          ctx.stroke();
        }
        ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(x, y, R * 0.42, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        if (this.view.zoom > 1.2) this.label('Storm', x, y - R, { font: `italic 11.5px 'Spectral', Georgia, serif`, color: 'rgba(40,30,30,0.9)', prio: 3, pos: ['t', 'c'], gap: 4 });
      }
      this.hit(x, y, Math.max(14, R * 0.8), zn.kind === 'squall' ? `<b>Squall</b><span>The breeze freshens under the squall: +28% speed.</span><em>${this._bearing(zn.x, zn.z)}</em>` : `<b>Storm</b><span>A fair wind at the edges, but the heart wrecks hull and sails.</span><em>${this._bearing(zn.x, zn.z)}</em>`);
    }
    ctx.restore();
  }

  _drawShips(ctx, s) {
    const g = this.game, z = this.view.zoom;
    const size = clamp(7 + z * 1.6, 8, 20);
    if (this.layers.ships) for (const [, v] of this.sighted) {
      const [x, y] = this.w2s(v.x, v.z);
      const col = FACTIONS[v.faction]?.color || '#6b5a44';
      ctx.globalAlpha = v.struck ? 0.45 : 0.85;
      this._shipGlyph(ctx, x, y, v.heading, size * 0.8, col, false);
      ctx.globalAlpha = 1;
      const nm = v.name && v.name !== 'Unnamed' ? v.name : article(shipDesc(v.faction, v.type));
      if (z > 2.5) this.label(nm, x, y, { font: `italic 12px 'IM Fell English', Georgia, serif`, prio: 3, halfW: size * 0.6, gap: 3, pos: ['r', 'l', 'b'] });
      const ago = Math.max(0, Math.round((g.time - (v.t || 0)) / 10));
      this.hit(x, y, Math.max(12, size), `<b>${esc(nm)}</b><span>${esc(shipDesc(v.faction, v.type, true))}${v.struck ? ' · colours struck' : ''}</span><em>seen ${ago < 1 ? 'just now' : `${ago}${NNBSP}d ago`} · ${this._bearing(v.x, v.z)}</em>`);
    }
    const p = g.player;
    if (p) {
      const [x, y] = this.w2s(p.position.x, p.position.z);
      const sh = Math.sin(p.heading), ch = Math.cos(p.heading);
      // heading: tapered brass arrow ahead of the ship
      ctx.save();
      ctx.strokeStyle = 'rgba(142,27,27,0.9)'; ctx.lineWidth = 1.4; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(x + sh * size * 1.9, y - ch * size * 1.9); ctx.lineTo(x + sh * size * 4.6, y - ch * size * 4.6); ctx.stroke(); ctx.setLineDash([]);
      ctx.translate(x + sh * size * 4.8, y - ch * size * 4.8); ctx.rotate(p.heading);
      ctx.beginPath(); ctx.moveTo(0, -size * 0.7); ctx.lineTo(size * 0.42, size * 0.2); ctx.lineTo(0, 0); ctx.lineTo(-size * 0.42, size * 0.2); ctx.closePath();
      ctx.fillStyle = '#8e1b1b'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 0.9; ctx.stroke();
      ctx.restore();
      // halo rings (graduated outer ring)
      ctx.fillStyle = 'rgba(246,224,154,0.35)'; ctx.beginPath(); ctx.arc(x, y, size * 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#8e1b1b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, size * 1.6, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, size * 1.9, 0, Math.PI * 2); ctx.stroke();
      for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, r0 = size * 1.9, r1 = r0 + (k % 4 ? 2.5 : 5); ctx.beginPath(); ctx.moveTo(x + Math.sin(a) * r0, y - Math.cos(a) * r0); ctx.lineTo(x + Math.sin(a) * r1, y - Math.cos(a) * r1); ctx.stroke(); }
      this._shipGlyph(ctx, x, y, p.heading, size * 1.1, '#c9a24a', true);
      this._rects.push([x - size * 2, y - size * 2, size * 4, size * 4]);
      const hdg = COMPASS16[Math.round(((p.heading * 180 / Math.PI) % 360 + 360) % 360 / 22.5) % 16];
      this.label(p.name || 'Your ship', x, y, { font: `${Math.round(14 + z)}px 'IM Fell English SC', Georgia, serif`, color: '#6b1a12', prio: 100, halfW: size * 2.1, gap: 2, pos: ['r', 'l', 'b', 't'] });
      const kn = p.knots ?? (p.speed || 0) * 1.94384;
      this.hit(x, y, size * 2, `<b>${esc(p.name || 'Your ship')}</b><span>Heading ${hdg} · ${fmtNum(Math.max(0, kn), 1)}${NNBSP}knots</span><span>Hull ${Math.round(100 * (p.hull ?? 0) / (p.hullMax || 1))}% · ${Math.round(p.crew ?? 0)} men</span>`);
    }
    void s;
  }

  _drawCartouche(ctx, f) {
    const w = clamp(f.w * 0.3, 300, 470), h = w * 0.42;
    const x = f.x + f.w - w - 26, y = f.y + f.h - h - 26;
    ctx.save();
    ctx.translate(x, y);
    // scroll: parchment banner with rolled ends + strapwork frame
    ctx.shadowColor = 'rgba(40,20,5,0.45)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
    const p = new Path2D();
    const r = h * 0.18;
    p.moveTo(r, 0); p.bezierCurveTo(w * 0.3, -h * 0.08, w * 0.7, h * 0.06, w - r, 0);
    p.quadraticCurveTo(w + r * 0.6, h * 0.5, w - r, h);
    p.bezierCurveTo(w * 0.7, h * 1.06, w * 0.3, h * 0.92, r, h);
    p.quadraticCurveTo(-r * 0.6, h * 0.5, r, 0); p.closePath();
    const gr = ctx.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#f6ebcd'); gr.addColorStop(1, '#dcc38c');
    ctx.fillStyle = gr; ctx.fill(p);
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke(p);
    ctx.save(); ctx.translate(w * 0.06, h * 0.12); ctx.scale(0.88, 0.76); ctx.lineWidth = 1; ctx.stroke(p); ctx.restore();
    // rolled scroll ends
    for (const sx of [r * 0.2, w - r * 0.2]) {
      ctx.fillStyle = '#cdb27a';
      ctx.beginPath(); ctx.ellipse(sx, h * 0.5, r * 0.55, h * 0.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(sx, h * 0.5, r * 0.28, h * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
    }
    // text
    ctx.textAlign = 'center'; ctx.fillStyle = INK; ctx.textBaseline = 'alphabetic';
    ctx.font = `italic ${Math.round(h * 0.11)}px 'IM Fell English', Georgia, serif`;
    ctx.fillText('A new and exact chart of the', w / 2, h * 0.27);
    ctx.font = `${Math.round(h * 0.2)}px 'IM Fell English SC', Georgia, serif`;
    ctx.fillStyle = '#5a1410';
    ctx.fillText('Windward Seas', w / 2, h * 0.5);
    ctx.fillStyle = INK;
    ctx.font = `italic ${Math.round(h * 0.095)}px 'IM Fell English', Georgia, serif`;
    ctx.fillText('with their islands, harbours and shoals,', w / 2, h * 0.67);
    const d = this.game.state?.date;
    ctx.fillText(`corrected by the captain’s own hand${d ? ', anno ' + d.year : ''}`, w / 2, h * 0.8);
    // small flourish
    ctx.strokeStyle = INK; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(w * 0.3, h * 0.88); ctx.bezierCurveTo(w * 0.4, h * 0.82, w * 0.45, h * 0.94, w * 0.5, h * 0.88); ctx.bezierCurveTo(w * 0.55, h * 0.82, w * 0.6, h * 0.94, w * 0.7, h * 0.88); ctx.stroke();
    ctx.restore();
  }

  _drawScale(ctx, f, s) {
    // a scale of leagues (1 league ≈ 5.5 km in our compressed world → we use 'sea leagues' of 500 m for readability)
    const LEAGUE = 500;
    let n = 4, unit = LEAGUE;
    while (unit * s * n > f.w * 0.22) unit /= 2;
    while (unit * s * n < f.w * 0.1) unit *= 2;
    const len = unit * s;
    const x = f.x + 30, y = f.y + f.h - 40;
    ctx.save();
    ctx.fillStyle = 'rgba(240,226,190,0.8)'; ctx.fillRect(x - 12, y - 30, len * n + 24, 48);
    ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.strokeRect(x - 12, y - 30, len * n + 24, 48);
    for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? '#f1e3bf' : INK; ctx.fillRect(x + i * len, y, len, 6); }
    ctx.strokeRect(x, y, len * n, 6);
    ctx.fillStyle = INK; ctx.font = `12px 'IM Fell English SC', Georgia, serif`; ctx.textAlign = 'center';
    for (let i = 0; i <= n; i++) ctx.fillText(String(Math.round(i * unit / LEAGUE * 10) / 10), x + i * len, y + 18);
    ctx.font = `italic 13px 'IM Fell English', Georgia, serif`;
    ctx.fillText('Scale of sea leagues', x + len * n / 2, y - 12);
    ctx.restore();
  }

  _drawWindRose(ctx, f) {
    const g = this.game, w = g.wind || { angle: 0, speed: 0 };
    const R = clamp(f.h * 0.075, 46, 80), x = f.x + R + 34, y = f.y + R + 40;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = 'rgba(240,226,190,0.85)'; ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(0, 0, R * 0.86, 0, Math.PI * 2); ctx.stroke();
    // eight wind heads as small puffs on the rim
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; ctx.beginPath(); ctx.arc(Math.sin(a) * R * 0.93, -Math.cos(a) * R * 0.93, R * 0.05, 0, Math.PI * 2); ctx.fillStyle = k % 2 ? '#e8d6a8' : '#c9a24a'; ctx.fill(); ctx.stroke(); }
    // arrow: blowing TOWARD w.angle
    const L = R * 0.72;
    ctx.rotate(w.angle);
    ctx.fillStyle = '#3a5a7a'; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(R * 0.16, -L * 0.45); ctx.lineTo(R * 0.05, -L * 0.5); ctx.lineTo(R * 0.05, L * 0.8); ctx.lineTo(-R * 0.05, L * 0.8); ctx.lineTo(-R * 0.05, -L * 0.5); ctx.lineTo(-R * 0.16, -L * 0.45); ctx.closePath(); ctx.fill(); ctx.stroke();
    // feathers
    for (let k = 0; k < 3; k++) { const yy = L * (0.45 + k * 0.13); ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(R * 0.14, yy + R * 0.1); ctx.moveTo(0, yy); ctx.lineTo(-R * 0.14, yy + R * 0.1); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = INK; ctx.textAlign = 'center';
    ctx.font = `13px 'IM Fell English SC', Georgia, serif`;
    ctx.fillText('N', x, y - R - 6);
    ctx.font = `italic 13px 'IM Fell English', Georgia, serif`;
    const kn = Math.round((w.speed || 0) * 1.94);
    const from = ((w.angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    ctx.fillText(`Wind from ${COMPASS16[Math.round(from / (Math.PI / 8)) % 16]}, ${kn} knots`, x, y + R + 18);
  }

  _drawBorder(ctx, f, s) {
    // graduated neatline: alternating bars + degree figures, brass outer frame
    ctx.save();
    const W = innerWidth, H = innerHeight, m = f.x;
    // brass/wood frame
    const gr = ctx.createLinearGradient(0, 0, W, H);
    gr.addColorStop(0, '#3a2414'); gr.addColorStop(0.5, '#24160c'); gr.addColorStop(1, '#3a2414');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, m); ctx.fillRect(0, H - m, W, m); ctx.fillRect(0, 0, m, H); ctx.fillRect(W - m, 0, m, H);
    ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 3; ctx.strokeRect(m * 0.3, m * 0.3, W - m * 0.6, H - m * 0.6);
    ctx.strokeStyle = '#6e4f1a'; ctx.lineWidth = 1; ctx.strokeRect(m * 0.3 + 4, m * 0.3 + 4, W - m * 0.6 - 8, H - m * 0.6 - 8);
    // graduation band just inside the chart
    const b = 9;
    ctx.fillStyle = '#f1e3bf'; ctx.fillRect(f.x, f.y, f.w, b); ctx.fillRect(f.x, f.y + f.h - b, f.w, b); ctx.fillRect(f.x, f.y, b, f.h); ctx.fillRect(f.x + f.w - b, f.y, b, f.h);
    const step = 250;   // world metres per bar
    const k0 = Math.floor((this.view.cx - f.w / 2 / s) / step), k1 = Math.ceil((this.view.cx + f.w / 2 / s) / step);
    ctx.fillStyle = INK;
    if (step * s > 3) for (let k = k0; k <= k1; k++) {
      if (k % 2) continue;
      const [x0] = this.w2s(k * step, 0), [x1] = this.w2s((k + 1) * step, 0);
      ctx.fillRect(x0, f.y, x1 - x0, b); ctx.fillRect(x0, f.y + f.h - b, x1 - x0, b);
    }
    const j0 = Math.floor((this.view.cz - f.h / 2 / s) / step), j1 = Math.ceil((this.view.cz + f.h / 2 / s) / step);
    if (step * s > 3) for (let k = j0; k <= j1; k++) {
      if (k % 2) continue;
      const [, y0] = this.w2s(0, k * step), [, y1] = this.w2s(0, (k + 1) * step);
      ctx.fillRect(f.x, y0, b, y1 - y0); ctx.fillRect(f.x + f.w - b, y0, b, y1 - y0);
    }
    ctx.strokeStyle = INK; ctx.lineWidth = 1.4; ctx.strokeRect(f.x, f.y, f.w, f.h); ctx.lineWidth = 0.8; ctx.strokeRect(f.x + b, f.y + b, f.w - 2 * b, f.h - 2 * b);
    // degree figures on the frame (fictional chart degrees: 1 deg per 2 km)
    ctx.fillStyle = '#e9d8ae'; ctx.font = `12px 'IM Fell English SC', Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const D = 2000;
    for (let k = Math.ceil((this.view.cx - f.w / 2 / s) / D); k * D <= this.view.cx + f.w / 2 / s; k++) {
      const [x] = this.w2s(k * D, 0); if (x < f.x + 20 || x > f.x + f.w - 20) continue;
      const lab = `${Math.abs(72 - k)}°`; ctx.fillText(lab, x, f.y - m * 0.35); ctx.fillText(lab, x, f.y + f.h + m * 0.35);
    }
    for (let k = Math.ceil((this.view.cz - f.h / 2 / s) / D); k * D <= this.view.cz + f.h / 2 / s; k++) {
      const [, y] = this.w2s(0, k * D); if (y < f.y + 20 || y > f.y + f.h - 20) continue;
      const lab = `${18 - k}°`; ctx.fillText(lab, f.x - m * 0.5, y); ctx.fillText(lab, f.x + f.w + m * 0.5, y);
    }
    // corner rosettes
    for (const [cx, cy] of [[f.x, f.y], [f.x + f.w, f.y], [f.x, f.y + f.h], [f.x + f.w, f.y + f.h]]) {
      ctx.fillStyle = '#c9a24a'; ctx.strokeStyle = '#3a2414'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, m * 0.32, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, m * 0.16, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
}
