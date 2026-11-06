// Circular parchment-chart minimap (north-up), drawn on a canvas inside an engraved brass bezel.
// Shows: island coastlines (sampled from islands.getTerrainHeight when available, else circles), port markers
// with faction-tinted pennants, ships as faction-coloured hull glyphs, player ship, wind arrow, range rings.
// API: new Minimap(parentEl, game) ; minimap.draw() ; minimap.range (metres radius shown) ;
//      minimap.toggleExpanded() (M key: large chart with 3x range) ; minimap.expanded
// Sea tiers: boundary of the guarded waters dotted in green, perilous seas hatched in red; the legend under the
// minimap names the ship's sea tier (data-tier 1–3).
import { factionColor } from './flags.js';

const TAU = Math.PI * 2;

export class Minimap {
  constructor(parent, game) {
    this.game = game;
    this.range = 1200;
    this.el = document.createElement('div');
    this.el.className = 'chart';
    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);
    const id = 'mm' + Math.floor(Math.random() * 1e6);
    this.el.insertAdjacentHTML('beforeend', `<svg class="bezel" viewBox="-110 -110 220 220">
      <defs><linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b5"/><stop offset="0.25" stop-color="#d9b55a"/><stop offset="0.5" stop-color="#7d5a1f"/><stop offset="0.72" stop-color="#d2ab55"/><stop offset="1" stop-color="#5e4210"/></linearGradient>
      <linearGradient id="${id}c" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1d488"/><stop offset="0.5" stop-color="#8a6424"/><stop offset="1" stop-color="#e9c97a"/></linearGradient>
      <mask id="${id}m"><rect x="-120" y="-120" width="240" height="240" fill="#fff"/><circle r="96" fill="#000"/></mask></defs>
      <g mask="url(#${id}m)"><circle r="108" fill="#1b0f06"/><circle r="106" fill="url(#${id}b)"/><circle r="101" fill="url(#${id}c)"/><circle r="97.5" fill="#2a1a08"/></g>
      ${Array.from({ length: 72 }, (_, i) => { const a = i * TAU / 72, r0 = 102.5, r1 = i % 18 === 0 ? 98 : 100; return `<line x1="${Math.sin(a) * r0}" y1="${-Math.cos(a) * r0}" x2="${Math.sin(a) * r1}" y2="${-Math.cos(a) * r1}" stroke="#3a2608" stroke-width="${i % 18 === 0 ? 1.2 : 0.5}"/>`; }).join('')}
      <g font-family="'IM Fell English SC', Georgia, serif" font-size="9" fill="#2a1a06" text-anchor="middle" dominant-baseline="central">
        <circle cx="0" cy="-103.5" r="6.8" fill="#8e1b1b" stroke="#3a0606" stroke-width="0.8"/><text x="0" y="-103" fill="#f6e3c4" font-size="8.5">N</text>
      </g>
      <circle r="96" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="2"/>
    </svg><div class="legend"><span class="zn">Chart</span> · <span class="rng"></span></div>`);
    parent.appendChild(this.el);
    this.rngEl = this.el.querySelector('.rng');
    this.znEl = this.el.querySelector('.zn'); this.legendEl = this.el.querySelector('.legend');
    this._coast = new Map();     // island id -> {pts:[[x,z]...]}
    this._bg = null; this._size = 0;
    this.expanded = false; this.baseRange = this.range;
  }

  toggleExpanded(v = !this.expanded) {
    this.expanded = v;
    this.el.classList.toggle('big', v);
    this.range = v ? this.baseRange * 3.5 : this.baseRange;
    this._rect = null;
    // canvas size changes once the CSS transition settles
    setTimeout(() => this.draw(), 480);
  }

  _ensureSize() {
    // size cached (ResizeObserver, enlarging, window) — getBoundingClientRect on every draw (10 times a second)
    // forced a layout right after the HUD's writes
    if (!this._sizeWatch) {
      this._sizeWatch = true;
      const drop = () => { this._rect = null; };
      try { new ResizeObserver(drop).observe(this.canvas); } catch { /* without ResizeObserver: re-read on every resize */ }
      addEventListener('resize', drop);
    }
    const r = this._rect && this._rect.width ? this._rect : (this._rect = this.canvas.getBoundingClientRect());
    this._dpr = Math.min(2, devicePixelRatio || 1);
    const s = Math.max(64, Math.round(Math.min(r.width, r.height) * this._dpr));
    if (s !== this._size) {
      this._size = s; this.canvas.width = this.canvas.height = s;
      this._bg = this._makeBackground(s);
    }
    return s;
  }

  _makeBackground(s) {
    const c = document.createElement('canvas'); c.width = c.height = s;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(s * 0.45, s * 0.4, s * 0.05, s / 2, s / 2, s * 0.55);
    g.addColorStop(0, '#efdfb6'); g.addColorStop(0.75, '#dcc391'); g.addColorStop(1, '#a98450');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    // blotches
    for (let i = 0; i < 40; i++) {
      const px = Math.random() * s, py = Math.random() * s, r = s * (0.03 + Math.random() * 0.12);
      const gg = x.createRadialGradient(px, py, 0, px, py, r);
      gg.addColorStop(0, `rgba(140,95,40,${0.04 + Math.random() * 0.06})`); gg.addColorStop(1, 'rgba(140,95,40,0)');
      x.fillStyle = gg; x.fillRect(px - r, py - r, r * 2, r * 2);
    }
    // grain
    const im = x.getImageData(0, 0, s, s);
    for (let i = 0; i < im.data.length; i += 4) { const n = (Math.random() - 0.5) * 16; im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n * 0.8; }
    x.putImageData(im, 0, 0);
    return c;
  }

  // sea tiers (game.seaZones): guarded waters = dotted green circle and light wash, perilous seas = hatching
  _drawZones(ctx, s, R, k, cx, cz, W) {
    const zd = this.game.seaZones?.data; if (!zd) return;
    const lw = Math.max(1.2, s / 150), rng = this.range;
    ctx.save();
    for (const z of zd.perilous) {
      const path = new Path2D();
      if (z.rx != null) { const [x, y] = W(z.x, z.z); path.ellipse(x, y, z.rx * k, z.rz * k, 0, 0, Math.PI * 2); }
      else { if (z.x1 < cx - rng || z.x0 > cx + rng || z.z1 < cz - rng || z.z0 > cz + rng) continue; const [x0, y0] = W(z.x0, z.z0), [x1, y1] = W(z.x1, z.z1); path.rect(x0, y0, x1 - x0, y1 - y0); }
      ctx.save(); ctx.clip(path);
      ctx.fillStyle = 'rgba(160,60,30,0.10)'; ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = 'rgba(150,45,25,0.38)'; ctx.lineWidth = Math.max(1, s / 260);
      const gap = s / 26; ctx.beginPath();
      for (let d = -s; d < s * 2; d += gap) { ctx.moveTo(d, 0); ctx.lineTo(d - s, s); }
      ctx.stroke(); ctx.restore();
      ctx.setLineDash([s / 45, s / 70]); ctx.strokeStyle = 'rgba(140,40,20,0.75)'; ctx.lineWidth = lw; ctx.stroke(path); ctx.setLineDash([]);
    }
    for (const z of zd.guarded) {
      if (Math.hypot(z.x - cx, z.z - cz) > rng + z.r) continue;
      const [x, y] = W(z.x, z.z), r = z.r * k;
      ctx.fillStyle = 'rgba(120,170,110,0.13)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(30,85,45,0.85)'; ctx.lineWidth = lw * 1.15; ctx.setLineDash([s / 40, s / 60]);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
    // legend: the ship's sea tier
    const cur = this.game.seaZones.current || this.game.seaZones.at(cx, cz);
    const tag = cur.tier === 1 ? 'Guarded waters' : cur.tier === 3 ? 'Perilous seas' : 'Trade routes';
    if (this._zn !== tag) { this._zn = tag; this.znEl.textContent = tag; this.legendEl.dataset.tier = cur.tier; this.legendEl.title = cur.name; }
  }

  _coastFor(isl) {
    let c = this._coast.get(isl.id ?? isl.name);
    if (c) return c;
    const isls = this.game.islands, N = 48, pts = [];
    const R = isl.radius || 200;
    const hasTerrain = typeof isls?.getTerrainHeight === 'function';
    for (let i = 0; i < N; i++) {
      const a = i / N * TAU, dx = Math.sin(a), dz = -Math.cos(a);
      let r = R;
      if (hasTerrain) {
        // march outwards from centre to find the shoreline (first point below sea level)
        let lo = 0, hi = R * 1.8, found = false;
        for (let k = 1; k <= 24; k++) {
          const t = hi * k / 24;
          if (isls.getTerrainHeight(isl.x + dx * t, isl.z + dz * t) < 0) { hi = t; lo = hi - R * 1.8 / 24; found = true; break; }
        }
        if (found) { for (let k = 0; k < 5; k++) { const m = (lo + hi) / 2; if (isls.getTerrainHeight(isl.x + dx * m, isl.z + dz * m) < 0) hi = m; else lo = m; } r = (lo + hi) / 2; }
      }
      pts.push([isl.x + dx * r, isl.z + dz * r]);
    }
    c = { pts };
    this._coast.set(isl.id ?? isl.name, c);
    return c;
  }

  draw() {
    const g = this.game, p = g.player;
    const s = this._ensureSize(); if (!s) return;
    const ctx = this.canvas.getContext('2d');
    const R = s / 2, k = R / this.range;
    const cx = p?.position?.x ?? 0, cz = p?.position?.z ?? 0;
    const W = (x, z) => [R + (x - cx) * k, R + (z - cz) * k];
    ctx.save();
    ctx.clearRect(0, 0, s, s);
    ctx.beginPath(); ctx.arc(R, R, R, 0, TAU); ctx.clip();
    ctx.drawImage(this._bg, 0, 0);

    // chart grid (fixed world graticule every 500 m)
    ctx.strokeStyle = 'rgba(90,60,30,0.22)'; ctx.lineWidth = Math.max(1, s / 400);
    const step = 500, x0 = Math.floor((cx - this.range) / step) * step, z0 = Math.floor((cz - this.range) / step) * step;
    ctx.beginPath();
    for (let x = x0; x <= cx + this.range; x += step) { const [sx] = W(x, 0); ctx.moveTo(sx, 0); ctx.lineTo(sx, s); }
    for (let z = z0; z <= cz + this.range; z += step) { const [, sz] = W(0, z); ctx.moveTo(0, sz); ctx.lineTo(s, sz); }
    ctx.stroke();
    // rhumb lines from centre
    ctx.strokeStyle = 'rgba(90,60,30,0.14)';
    ctx.beginPath();
    for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; ctx.moveTo(R, R); ctx.lineTo(R + Math.sin(a) * R, R - Math.cos(a) * R); }
    ctx.stroke();

    this._drawZones(ctx, s, R, k, cx, cz, W);

    // islands
    const list = g.islands?.list || [];
    ctx.lineJoin = 'round';
    for (const isl of list) {
      const rr = (isl.radius || 200) * 1.8;
      if (Math.abs(isl.x - cx) > this.range + rr || Math.abs(isl.z - cz) > this.range + rr) continue;
      const { pts } = this._coastFor(isl);
      const path = new Path2D();
      pts.forEach(([x, z], i) => { const [sx, sz] = W(x, z); i ? path.lineTo(sx, sz) : path.moveTo(sx, sz); });
      path.closePath();
      // shallows: soft sea-green wash plus engraved offset coast lines (old-chart "water lining")
      ctx.save();
      ctx.strokeStyle = 'rgba(70,140,140,0.22)'; ctx.lineWidth = s / 28; ctx.stroke(path);
      ctx.strokeStyle = 'rgba(70,140,140,0.18)'; ctx.lineWidth = s / 16; ctx.stroke(path);
      ctx.strokeStyle = 'rgba(40,70,80,0.35)'; ctx.lineWidth = Math.max(0.8, s / 420);
      for (const sc of [1.06, 1.13, 1.22]) {
        const [icx, icz] = W(isl.x, isl.z);
        ctx.save(); ctx.translate(icx, icz); ctx.scale(sc, sc); ctx.translate(-icx, -icz);
        ctx.lineWidth = Math.max(0.6, s / 480) / sc; ctx.globalAlpha = 1.25 - sc; ctx.stroke(path); ctx.restore();
      }
      ctx.restore();
      ctx.fillStyle = '#c8b27a'; ctx.fill(path);
      ctx.save(); ctx.clip(path);
      const [icx, icz] = W(isl.x, isl.z);
      const gr = ctx.createRadialGradient(icx, icz, 0, icx, icz, (isl.radius || 200) * k);
      gr.addColorStop(0, 'rgba(95,120,60,0.75)'); gr.addColorStop(0.7, 'rgba(120,140,70,0.45)'); gr.addColorStop(1, 'rgba(200,170,100,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, s, s);
      // hachure strokes for relief
      ctx.strokeStyle = 'rgba(60,40,20,0.35)'; ctx.lineWidth = Math.max(0.8, s / 500);
      const rad = (isl.radius || 200) * k;
      for (let i = 0; i < 18; i++) { const a = i / 18 * TAU; ctx.beginPath(); ctx.moveTo(icx + Math.sin(a) * rad * 0.18, icz - Math.cos(a) * rad * 0.18); ctx.lineTo(icx + Math.sin(a) * rad * 0.42, icz - Math.cos(a) * rad * 0.42); ctx.stroke(); }
      ctx.restore();
      ctx.strokeStyle = '#3a2814'; ctx.lineWidth = Math.max(1.2, s / 260); ctx.stroke(path);
      // name
      if (isl.name && this.expanded && (isl.radius || 200) * k > s * 0.03) {
        ctx.font = `italic ${Math.max(Math.round(13 * this._dpr), Math.round(s / 22))}px 'IM Fell English', Georgia, serif`;
        ctx.fillStyle = 'rgba(42,28,16,0.85)'; ctx.textAlign = 'center';
        ctx.fillText(isl.name, icx, icz + (isl.radius || 200) * k + s / 20);
      }
    }

    // ports
    for (const port of g.islands?.ports || []) {
      const [sx, sz] = W(port.x, port.z);
      if ((sx - R) ** 2 + (sz - R) ** 2 > R * R) continue;
      const u = s / (this.expanded ? 120 : 55);
      ctx.fillStyle = '#efe4cf'; ctx.strokeStyle = '#2a1c10'; ctx.lineWidth = Math.max(1, s / 300);
      ctx.beginPath(); ctx.rect(sx - u * 1.4, sz - u * 0.6, u * 2.8, u * 1.8); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx - u * 1.6, sz - u * 0.6); ctx.lineTo(sx, sz - u * 1.8); ctx.lineTo(sx + u * 1.6, sz - u * 0.6); ctx.closePath();
      ctx.fillStyle = '#c0623a'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx, sz - u * 1.8); ctx.lineTo(sx, sz - u * 3.6); ctx.stroke();
      ctx.fillStyle = factionColor(port.faction);
      ctx.beginPath(); ctx.moveTo(sx, sz - u * 3.6); ctx.lineTo(sx + u * 1.8, sz - u * 3.1); ctx.lineTo(sx, sz - u * 2.6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.font = `${Math.max(Math.round(13 * this._dpr), Math.round(s / (this.expanded ? 34 : 15)))}px 'IM Fell English SC', Georgia, serif`; ctx.textAlign = 'center';
      ctx.lineWidth = s / 90; ctx.strokeStyle = 'rgba(239,223,182,0.9)'; ctx.strokeText(port.name, sx, sz + u * 3.4);
      ctx.fillStyle = '#2a1c10'; ctx.fillText(port.name, sx, sz + u * 3.4);
    }

    // fishing villages: palm-roofed hut, no flag
    for (const v of g.islands?.villages || []) {
      const [sx, sz] = W(v.x, v.z);
      if ((sx - R) ** 2 + (sz - R) ** 2 > R * R) continue;
      const u = s / (this.expanded ? 140 : 70);
      ctx.fillStyle = '#c8a46a'; ctx.strokeStyle = '#2a1c10'; ctx.lineWidth = Math.max(1, s / 320);
      ctx.beginPath(); ctx.rect(sx - u * 1.1, sz - u * 0.2, u * 2.2, u * 1.3); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx - u * 1.6, sz - u * 0.2); ctx.lineTo(sx, sz - u * 1.7); ctx.lineTo(sx + u * 1.6, sz - u * 0.2); ctx.closePath();
      ctx.fillStyle = '#7a5a2a'; ctx.fill(); ctx.stroke();
      ctx.font = `italic ${Math.max(Math.round(12 * this._dpr), Math.round(s / (this.expanded ? 38 : 17)))}px 'IM Fell English', Georgia, serif`; ctx.textAlign = 'center';
      ctx.lineWidth = s / 90; ctx.strokeStyle = 'rgba(239,223,182,0.9)'; ctx.strokeText(v.name, sx, sz + u * 3.2);
      ctx.fillStyle = '#3a2a1a'; ctx.fillText(v.name, sx, sz + u * 3.2);
    }

    // ships
    for (const sh of g.ships || []) {
      if (sh === p || sh.alive === false) continue;
      const [sx, sz] = W(sh.position.x, sh.position.z);
      if ((sx - R) ** 2 + (sz - R) ** 2 > (R * 0.96) ** 2) continue;
      this._shipGlyph(ctx, sx, sz, sh.heading, s / (this.expanded ? 45 : 19), factionColor(sh.faction), sh.struck);
    }

    // locked/near target ring
    const tg = g.hud?.target;
    if (tg && tg.alive !== false) {
      const [tx, tz] = W(tg.position.x, tg.position.z);
      ctx.save(); ctx.strokeStyle = '#8e1b1b'; ctx.lineWidth = Math.max(1.5, s / 130); ctx.setLineDash([s / 50, s / 80]);
      ctx.beginPath(); ctx.arc(tx, tz, s / 13, 0, TAU); ctx.stroke(); ctx.restore();
    }
    // player: course line + glyph
    if (p) {
      ctx.save(); ctx.setLineDash([s / 60, s / 90]); ctx.strokeStyle = 'rgba(142,27,27,0.75)'; ctx.lineWidth = Math.max(1, s / 260);
      ctx.beginPath(); ctx.moveTo(R, R); ctx.lineTo(R + Math.sin(p.heading) * R * 0.8, R - Math.cos(p.heading) * R * 0.8); ctx.stroke(); ctx.restore();
      this._shipGlyph(ctx, R, R, p.heading, s / (this.expanded ? 36 : 15), '#f6ecd2', false, true);
    }

    // wind arrow (upper-left quadrant, flows across the chart)
    const wa = g.wind?.angle ?? 0, ws = g.wind?.speed ?? 0;
    const ax = R - R * 0.5, ay = R - R * 0.48, L = s * 0.11;
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(wa);
    ctx.strokeStyle = '#1f4a5a'; ctx.fillStyle = '#1f4a5a'; ctx.lineWidth = Math.max(1.4, s / 170); ctx.lineCap = 'round';
    for (const off of [-s / 70, s / 70]) { ctx.beginPath(); ctx.moveTo(off, L * 0.6); ctx.bezierCurveTo(off + s / 80, L * 0.2, off - s / 80, -L * 0.1, off, -L * 0.45); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0, -L * 0.85); ctx.lineTo(-s / 36, -L * 0.35); ctx.lineTo(s / 36, -L * 0.35); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.font = `italic ${Math.max(Math.round(12 * this._dpr), Math.round(s / 19))}px 'Spectral', Georgia, serif`; ctx.fillStyle = 'rgba(31,74,90,0.95)'; ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(ws * 1.944)} kn`, ax, ay + L * 0.95);

    // small printed compass rose (lower-left)
    {
      const rx = R - R * 0.48, ry = R + R * 0.5, rr = s * 0.075;
      ctx.save(); ctx.translate(rx, ry); ctx.globalAlpha = 0.75;
      ctx.strokeStyle = '#3a2814'; ctx.lineWidth = Math.max(0.8, s / 380);
      ctx.beginPath(); ctx.arc(0, 0, rr * 0.75, 0, TAU); ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, L2 = i % 2 ? rr * 0.6 : rr, w = rr * (i % 2 ? 0.12 : 0.2);
        ctx.save(); ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(0, -L2); ctx.lineTo(w, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fillStyle = i === 0 ? '#8e1b1b' : '#3a2814'; ctx.fill();
        ctx.beginPath(); ctx.moveTo(0, -L2); ctx.lineTo(-w, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fillStyle = '#e9d8ae'; ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
    // edge burn
    const vg = ctx.createRadialGradient(R, R, R * 0.7, R, R, R);
    vg.addColorStop(0, 'rgba(90,50,10,0)'); vg.addColorStop(1, 'rgba(90,50,10,0.45)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, s, s);
    ctx.restore();
    const lbl = this.range >= 1000 ? `${(this.range * 2 / 1852).toFixed(1)} miles` : `${this.range * 2} m`;   // sea tiers: the sea tier comes first, short legend
    if (this._lbl !== lbl) { this._lbl = lbl; this.rngEl.textContent = lbl; }
  }

  _shipGlyph(ctx, x, y, h, size, color, struck, player) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(h);
    ctx.beginPath();
    ctx.moveTo(0, -size); ctx.bezierCurveTo(size * 0.55, -size * 0.4, size * 0.5, size * 0.5, size * 0.32, size * 0.8);
    ctx.lineTo(-size * 0.32, size * 0.8); ctx.bezierCurveTo(-size * 0.5, size * 0.5, -size * 0.55, -size * 0.4, 0, -size);
    ctx.fillStyle = color; ctx.globalAlpha = struck ? 0.5 : 1; ctx.fill();
    ctx.lineWidth = Math.max(1, size / 5); ctx.strokeStyle = player ? '#8e1b1b' : '#1c120a'; ctx.stroke();
    if (player) { ctx.beginPath(); ctx.arc(0, 0, size * 0.18, 0, TAU); ctx.fillStyle = '#8e1b1b'; ctx.fill(); }
    ctx.restore();
  }
}
