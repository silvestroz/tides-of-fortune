// Feedback of the sneak mode: what the player hears and sees of the guards' minds and of his own noise. Built when a
// sneak scene starts (after the HUD), disposed with it; DOM + one 2D canvas over the WebGL view (no WebGL resources).
//   const fx = new SneakFeedback(game, hudEl)
//   fx.event(e, sim, view)    a sim event ('guard' state change, 'alarm', 'body', 'calm', 'ko', 'stone', 'landed',
//                             'lock', 'caught', 'hide', 'unlocked')
//   fx.frame(dt, sim, view)   every frame (real dt): indicators, edge arrows, vignettes, ground rings, footsteps,
//                             night ambience
//   fx.timeScale              0.3..1: the short slow motion of the moment you are spotted (1 under automation)
//   fx.dispose()
// Shows: a “?” filling with a guard's suspicion and a “!” when he hunts you, an arrow at the rim of the screen (or
// around the captain) toward every guard who is watching you, a red vignette pulse when spotted, darkened edges when
// hidden (dimmer in deep shadow), the noise ring while running or picking a lock, the noise of a fallen stone, the
// ripples of the captain's footsteps, a burst on a knock-out, and the guards' barks in speech bubbles.
// Sounds (src/audio/town.js): footsteps on cobbles / planks / grass (soft sneaking, loud running), guards' boots and
// armour by distance and side, vocal cues of the barks, stone, knock-out, lock, alarm bell, crickets, surf, dogs, the
// tavern's murmur near the tavern.
// Also exports Bubbles: speech bubbles following a point of the world (used by the land battle too).
import * as THREE from 'three';
import { TownSounds } from '../../audio/town.js';
import { SNEAK } from '../../data/sneak.js';
import { C, cellIndex } from './sim.js';
import './feedback.css';

const BARKS = {
  look: ['Who goes there?', 'Hm? Who’s there?', 'Something moved…'],
  investigate: ['I’ll take a look.', 'Show yourself!'],
  lured: ['What was that?', 'Did you hear that?'],
  calm: ['Must be the wind…', 'Just a cat.', 'Nothing… back to it.'],
  chase: ['There! Stop him!', 'Halt! You there!'],
  alarm: ['Sound the alarm!', 'Alarm! To arms!'],
  body: ['Over here! Man down!'],
  lost: ['He’s gone… back to your posts.'],
  caught: ['Got you!'],
};
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _v = new THREE.Vector3();

// speech bubbles: one per speaker, following a world point projected by proj(x, z, y) -> { x, y, behind }
export class Bubbles {
  constructor(parent, cls = 'tw-bubbles') {
    this.el = document.createElement('div'); this.el.className = cls; parent.appendChild(this.el);
    this.list = [];
  }
  say(key, text, at, { life = 2.4, kind = '' } = {}) {
    let b = this.list.find(q => q.key === key);
    if (!b) { const el = document.createElement('div'); this.el.appendChild(el); b = { key, el }; this.list.push(b); }
    b.el.className = `tw-bubble ${kind}`; b.el.textContent = text; b.at = at; b.t = 0; b.life = life;
    b.el.classList.remove('on'); void b.el.offsetWidth; b.el.classList.add('on');
    return b;
  }
  update(dt, proj) {
    for (const b of this.list) {
      b.t += dt;
      const a = typeof b.at === 'function' ? b.at() : b.at, p = a && proj(a.x, a.z, a.y ?? 4);
      if (!p || p.behind || b.t > b.life) { b.el.style.display = 'none'; continue; }
      b.el.style.display = ''; b.el.style.opacity = String(clamp((b.life - b.t) / 0.35, 0, 1));
      b.el.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px)`;
    }
    this.list = this.list.filter(b => b.t <= b.life || (b.el.remove(), false));
  }
  get count() { return this.list.length; }
  dispose() { this.el.remove(); this.list.length = 0; }
}

export class SneakFeedback {
  constructor(game, hud) {
    this.game = game;
    const el = this.el = document.createElement('div'); el.className = 'sn-fx';
    el.innerHTML = '<canvas class="sn-fx-cv"></canvas><div class="sn-vig"></div><div class="sn-spot"></div><div class="sn-inds"></div><div class="sn-edges"></div>';
    hud.prepend(el);
    this.cv = el.querySelector('canvas'); this.g2 = this.cv.getContext('2d');
    this.vig = el.querySelector('.sn-vig'); this.spot = el.querySelector('.sn-spot');
    this.inds = el.querySelector('.sn-inds'); this.edges = el.querySelector('.sn-edges');
    this.bubbles = new Bubbles(el);
    this.sounds = new TownSounds(game.audio, { night: true });
    this.timeScale = 1; this._slow = 0; this._spotT = -99; this._t = 0; this._barkT = -99; this._bellT = 0;
    this.slowmo = !navigator.webdriver;
    this.G = []; this.rings = []; this.cap = { x: null, z: null, d: 0, foot: 1 };
    this._hide = 0;
  }

  // ---- helpers ----
  _proj(view, x, z, y = 0) {
    _v.set(x, y, z).project(view.camera);
    return { x: (_v.x + 1) / 2 * innerWidth, y: (1 - _v.y) / 2 * innerHeight, behind: _v.z > 1 };
  }
  // positional sound around the captain: by distance, panned by the side of the screen
  _sp(sim, view, x, z, ref = 7, max = 48) {
    const p = sim.player, d = Math.hypot(x - p.x, z - p.z);
    if (d > max) return { gain: 0, pan: 0 };
    const s = this._proj(view, x, z), c = this._proj(view, p.x, p.z);
    return { gain: clamp(ref / (ref + Math.max(0, d - 2)), 0, 1) * (1 - d / max), pan: clamp((s.x - c.x) / (innerWidth * 0.4), -0.9, 0.9) };
  }
  _gs(id) { return this.G[id] ||= { barkT: -99, x: null, z: null, d: 0, n: 0, ind: null, edge: null, pop: 0 }; }
  _bark(sim, view, g, kind, { force = false } = {}) {
    const s = this._gs(g.id), p = sim.player;
    if (!force && (this._t - s.barkT < 3.2 || this._t - this._barkT < 0.5)) return;
    if (Math.hypot(g.x - p.x, g.z - p.z) > 46) return;
    s.barkT = this._barkT = this._t;
    const text = pick(BARKS[kind]), urgent = kind === 'chase' || kind === 'alarm' || kind === 'body' || kind === 'caught';
    this.bubbles.say('g' + g.id, text, () => ({ x: g.x, z: g.z, y: 7.4 }), { kind: urgent ? 'shout sn-bark' : 'sn-bark' });
    this.sounds.voice(text, this._sp(sim, view, g.x, g.z, 10, 60), { pitch: 0.85 + (g.id * 0.137 % 1) * 0.35, urgent });
  }
  _react(view, g, kind) { view.actors?.reactGuard?.(g.id, kind); }
  _spotted() {
    if (this._t - this._spotT < 8) return;
    this._spotT = this._t;
    this.spot.classList.remove('on'); void this.spot.offsetWidth; this.spot.classList.add('on');
    if (this.slowmo) this._slow = 0.7;
  }
  _ring(x, z, o) { this.rings.push({ x, z, t: 0, ...o }); }

  // ---- sim events ----
  event(e, sim, view) {
    const S = this.sounds, p = sim.player;
    switch (e.type) {
      case 'guard': {
        const g = e.guard, calmFrom = e.from === 'look' || e.from === 'investigate' || e.from === 'lured';
        if (e.to === 'chase' && !sim.alarm) { this._bark(sim, view, g, 'chase', { force: true }); this._react(view, g, 'flinch'); this._spotted(); }
        else if (e.to === 'look' && !sim.alarm) this._bark(sim, view, g, 'look');
        else if (e.to === 'investigate' && !sim.alarm) this._bark(sim, view, g, 'investigate');
        else if (e.to === 'lured') this._bark(sim, view, g, 'lured');
        else if (calmFrom && (e.to === 'patrol' || e.to === 'post' || e.to === 'follow')) this._bark(sim, view, g, 'calm');
        break;
      }
      case 'alarm':
        S.alarm(); this._bellT = 0;
        if (e.by && !e.by.tend) { this._bark(sim, view, e.by, 'alarm', { force: true }); this._react(view, e.by, 'point'); }
        if (e.by) this._spotted();
        break;
      case 'body': this._bark(sim, view, e.guard, 'body', { force: true }); break;
      case 'calm': {
        const g = sim.guards.filter(q => !q.down).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
        if (g) this._bark(sim, view, g, 'lost', { force: true });
        break;
      }
      case 'caught': this._bark(sim, view, e.guard, 'caught', { force: true }); break;
      case 'ko':
        S.ko(this._sp(sim, view, e.guard.x, e.guard.z));
        this._ring(e.guard.x, e.guard.z, { kind: 'ko', life: 0.5 });
        break;
      case 'landed':
        S.stone(this._sp(sim, view, e.x, e.z, 10, 60));
        this._ring(e.x, e.z, { kind: 'noise', r: SNEAK.tools.stoneNoise, life: 1.1 });
        break;
      case 'stone': S.swish({ gain: 1, pan: 0 }); break;
      case 'lock': S.lock(); break;
      case 'unlocked': S.lock(); S.ko({ gain: 0.25, pan: 0 }); break;
      case 'hide': S.step('grass', { gain: 1, pan: 0 }, { loud: 0.15 }); break;
    }
  }

  // ---- every frame ----
  frame(dt, sim, view) {
    if (!sim || !view?.camera) return;
    this._t += dt;
    // slow motion: a fast dip, held briefly, then eased back
    if (this._slow > 0) { this._slow -= dt; this.timeScale = this._slow > 0.35 ? 0.3 : 0.3 + 0.7 * (1 - this._slow / 0.35); }
    else this.timeScale = 1;
    const p = sim.player, L = SNEAK.levels, m = sim.map, W = innerWidth, H = innerHeight;
    const cp = this._proj(view, p.x, p.z, 1.6);
    // ---- the captain's footsteps: soft sneaking, loud running; ripples on the ground ----
    const c = this.cap;
    if (c.x != null) {
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < 3 && p.moving) {
        c.d += d;
        const len = p.run ? 1.45 : 0.85;
        if (c.d >= len) {
          c.d -= len; c.foot = -c.foot;
          const surf = this._surface(m, p.x, p.z), ox = Math.cos(p.heading) * 0.22 * c.foot, oz = -Math.sin(p.heading) * 0.22 * c.foot;
          this.sounds.step(surf, { gain: 1, pan: 0 }, { loud: p.run ? 1 : 0.08 });
          this._ring(p.x + ox, p.z + oz, { kind: 'step', r: p.run ? 2.4 : 0.8, life: p.run ? 0.7 : 0.5 });
        }
      }
    }
    c.x = p.x; c.z = p.z;
    // ---- guards: boots and armour, indicators, edge arrows ----
    let edges = 0;
    for (const g of sim.guards) {
      const s = this._gs(g.id);
      if (s.x != null && !g.down) {
        const d = Math.hypot(g.x - s.x, g.z - s.z);
        if (d < 3) {
          s.d += d;
          const len = g.state === 'chase' ? 1.35 : 0.9;
          if (s.d >= len) {
            s.d -= len; s.n++;
            const sp = this._sp(sim, view, g.x, g.z, 6, 34);
            if (sp.gain > 0.01) {
              this.sounds.step(this._surface(m, g.x, g.z), sp, { loud: g.state === 'chase' ? 0.85 : 0.4 });
              if (s.n % 2 === 0 && Math.random() < 0.7) this.sounds.clink(sp);
            }
          }
        }
      }
      s.x = g.x; s.z = g.z;
      // the “?” fills with suspicion up to the hunt; “!” when hunting (pops once)
      if (!s.ind) { s.ind = document.createElement('div'); s.ind.className = 'sn-ind'; s.ind.innerHTML = '<b>?</b><i>?</i>'; this.inds.appendChild(s.ind); }
      const hunt = !g.down && (sim.alarm || g.state === 'chase'), fill = clamp(g.sus / L[2], 0, 1);
      const gp = this._proj(view, g.x, g.z, 4.4);
      const show = !g.down && !gp.behind && (hunt || g.sus > 3) && gp.x > -40 && gp.x < W + 40 && gp.y > -40 && gp.y < H + 40;
      if (!show) { s.ind.style.display = 'none'; if (!hunt) s.pop = 0; }
      else {
        s.ind.style.display = '';
        if (hunt && !s.pop) { s.pop = 1; s.ind.classList.remove('spot'); void s.ind.offsetWidth; }
        if (!hunt) s.pop = 0;
        s.ind.classList.toggle('spot', hunt);
        const ch = hunt ? '!' : '?';
        if (s.ind.firstChild.textContent !== ch) s.ind.firstChild.textContent = s.ind.lastChild.textContent = ch;
        s.ind.lastChild.style.clipPath = `inset(${((1 - (hunt ? 1 : fill)) * 100).toFixed(0)}% 0 0 0)`;
        s.ind.style.transform = `translate(${gp.x.toFixed(0)}px, ${gp.y.toFixed(0)}px)`;
      }
      // edge arrow toward a guard who is watching you: around the captain, or at the rim of the screen if he is off it
      if (!s.edge) { s.edge = document.createElement('div'); s.edge.className = 'sn-edge'; this.edges.appendChild(s.edge); }
      const watching = !g.down && g.see > 0 && !p.hidden;
      if (!watching) { s.edge.style.display = 'none'; continue; }
      edges++;
      const bp = this._proj(view, g.x, g.z, 1.6), ang = Math.atan2(bp.y - cp.y, bp.x - cp.x);
      const off = bp.behind || bp.x < 30 || bp.x > W - 30 || bp.y < 30 || bp.y > H - 30;
      let x, y;
      if (off) {   // on the rim, along the line from the captain
        const dx = Math.cos(ang), dy = Math.sin(ang), tx = dx > 0 ? (W - 34 - cp.x) / dx : (34 - cp.x) / (dx || 1e-6), ty = dy > 0 ? (H - 34 - cp.y) / dy : (34 - cp.y) / (dy || 1e-6);
        const t = Math.max(0, Math.min(tx, ty)); x = cp.x + dx * t; y = cp.y + dy * t;
      } else { const r = 58; x = cp.x + Math.cos(ang) * r; y = cp.y + Math.sin(ang) * r; }
      const k = clamp(g.sus / 100, 0, 1);
      s.edge.style.display = '';
      s.edge.dataset.hot = hunt ? '2' : k > L[0] / 100 ? '1' : '0';
      s.edge.style.opacity = String(clamp(0.45 + g.see * 0.5, 0.45, 1));
      s.edge.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) rotate(${ang.toFixed(3)}rad)`;
    }
    this.edgeCount = edges;
    // ---- screen edges: dark when hidden, a little in deep shadow ----
    const ex = sim.exposure || {}, hideT = p.hidden ? 1 : ex.shade && ex.light < 0.1 ? 0.4 : 0;
    this._hide += (hideT - this._hide) * (1 - Math.exp(-dt * 5));
    this.vig.style.opacity = this._hide.toFixed(3);
    // ---- ground rings: noise while running / picking, stone noise, footprint ripples, knock-out burst ----
    this._draw(dt, sim, view);
    this.bubbles.update(dt, (x, z, y) => this._proj(view, x, z, y));
    // ---- night ambience and the alarm bell ----
    const tav = m.houses.find(h => h.role === 'tavern');
    const tx = tav ? (tav.i0 + tav.i1) / 2 * m.cell : 0, tz = tav ? (tav.j0 + tav.j1) / 2 * m.cell : 0;
    const tavern = tav ? Math.pow(clamp(1 - (Math.hypot(p.x - tx, p.z - tz) - 8) / 36, 0, 1), 1.5) : 0;
    this.sounds.update(dt, { surf: clamp(1 - (p.z - 15) / 60, 0, 1), tavern });
    if (sim.alarm) { this._bellT += dt; if (this._bellT > 7) { this._bellT = 0; this.sounds.alarm(3); } }
  }

  _surface(m, x, z) { const t = m.type[cellIndex(m, x, z)]; return t === C.QUAY ? 'plank' : t === C.YARD ? 'grass' : 'cobble'; }

  _draw(dt, sim, view) {
    const cv = this.cv, g2 = this.g2, W = innerWidth, H = innerHeight, p = sim.player;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    g2.clearRect(0, 0, W, H);
    const ellipse = (x, z, r, y = 0.15) => {
      g2.beginPath();
      for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 2, q = this._proj(view, x + Math.cos(a) * r, z + Math.sin(a) * r, y); i ? g2.lineTo(q.x, q.y) : g2.moveTo(q.x, q.y); }
      g2.closePath();
    };
    // the captain's own noise: what a guard within this ring would hear
    const nr = p.run ? SNEAK.noise.run : p.picking ? SNEAK.noise.lock : 0;
    this._nr = (this._nr || 0) + (nr - (this._nr || 0)) * (1 - Math.exp(-dt * 8));
    if (this._nr > 0.5) {
      const pulse = 0.5 + 0.5 * Math.sin(this._t * 9);
      ellipse(p.x, p.z, this._nr);
      g2.setLineDash([10, 8]); g2.lineDashOffset = -this._t * 30; g2.lineWidth = 2;
      g2.strokeStyle = `rgba(255, 196, 120, ${(0.3 + 0.25 * pulse) * Math.min(1, this._nr / 6)})`; g2.stroke();
      g2.fillStyle = `rgba(255, 170, 90, ${0.05 * Math.min(1, this._nr / 6)})`; g2.fill();
      g2.setLineDash([]);
    }
    this.rings = this.rings.filter(r => (r.t += dt) < r.life);
    for (const r of this.rings) {
      const u = r.t / r.life;
      if (r.kind === 'step') {
        ellipse(r.x, r.z, 0.15 + r.r * u); g2.lineWidth = 1.5; g2.strokeStyle = `rgba(220, 230, 255, ${0.45 * (1 - u)})`; g2.stroke();
      } else if (r.kind === 'noise') {
        ellipse(r.x, r.z, r.r * Math.min(1, u * 2.2)); g2.lineWidth = 2.5; g2.strokeStyle = `rgba(255, 220, 150, ${0.75 * (1 - u)})`; g2.stroke();
        g2.fillStyle = `rgba(255, 210, 140, ${0.08 * (1 - u)})`; g2.fill();
      } else if (r.kind === 'ko') {
        const q = this._proj(view, r.x, r.z, 1.4), k = 1 - u, R = 18 + 50 * Math.sqrt(u);
        g2.lineWidth = 3; g2.strokeStyle = `rgba(255, 245, 210, ${k})`;
        g2.beginPath(); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + 0.3; g2.moveTo(q.x + Math.cos(a) * R * 0.45, q.y + Math.sin(a) * R * 0.45); g2.lineTo(q.x + Math.cos(a) * R, q.y + Math.sin(a) * R); } g2.stroke();
        ellipse(r.x, r.z, 0.5 + 3 * u); g2.lineWidth = 2; g2.stroke();
      }
    }
  }

  get barks() { return this.bubbles.count; }

  dispose() {
    this.sounds.dispose(); this.bubbles.dispose(); this.el.remove();
    this.G.length = 0; this.rings.length = 0;
  }
}
