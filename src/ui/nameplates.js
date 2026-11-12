// Floating ship nameplates (parchment + brass). At sea, one plate at a time: the ship under the mouse cursor
// (2026-11-12, no more automatic plates). Staged framings (boarding, showcase shots) still label every ship.
// API: new Nameplates(game); update(dt); show(bool) (master switch); forced (bool) show regardless of camera mode.
// Every plate at once when: forced, or a fixed/shot camera with ≥2 ships near its target. Otherwise the hovered ship
// only (hovered: read by tests; never the player's own ship, whose state is in the helm bar).
// Per ship: faction flag swatch, name, type, guns · crew, hull and sails bars; hostile ships get a red rim.
// One DOM element per ship (pooled), positioned by projecting a point above the masthead; culled off-screen/far.
// Sea tiers: class pill (I–V) coloured by threat (prey, even match, tough, out of your class).
// Decluttering (ui-read, 2026-11-10): a plate never sits on the fixed interface (toasts, objective line, minimap and
// its legend, target card, helm bar and its pills, hint card, prompts…) nor on another plate. Plates are placed by
// priority (player, HUD target, hostiles, then nearest); a plate in the way is nudged up (leader line to its
// masthead), sideways toward the centre, or down from a top-of-screen block, and hidden when none of that fits.
// Perf: the fixed rectangles are read once per change (Mutation/ResizeObserver, window resize, +0.6 s for the
// transitions), the plate sizes once per content change, never every frame.
import * as THREE from 'three';
import { FACTIONS } from '../core/constants.js';
import { shipDesc } from '../core/i18n.js';
import { threatOf, livePower } from '../data/seaZones.js';   // sea tiers: class and threat
import { powerClass, CLASS_NAMES } from '../data/shipTypes.js';

const _p = new THREE.Vector3();
const STYLE = `
.tof-plate{position:absolute;left:0;top:0;transform:translate(-50%,-100%);min-width:9.5em;padding:.3em .6em .4em;
 background:linear-gradient(180deg,#f5e9c9,#e2cd98);color:#2a1c10;border:.12em solid #8a6424;border-radius:.3em;
 box-shadow:0 0 0 .08em #f6e09a inset,0 .2em .5em rgba(0,0,0,.45);font-size:clamp(14px,.95vw,19px);line-height:1.15;white-space:nowrap;
 transition:opacity .25s;pointer-events:none}
.tof-plate.hostile{border-color:#8e1b1b;box-shadow:0 0 0 .08em #e8a0a0 inset,0 .2em .6em rgba(80,0,0,.5)}
.tof-plate:after{content:'';position:absolute;left:calc(50% + var(--ax,0px));bottom:-.55em;margin-left:-.45em;border:.45em solid transparent;border-top-color:#8a6424;border-bottom:0}
.tof-plate.hostile:after{border-top-color:#8e1b1b}
.tof-plate:before{content:'';position:absolute;left:calc(50% + var(--ax,0px));top:100%;width:.12em;margin-left:-.06em;height:var(--lead,0px);
 background:linear-gradient(#8a6424,rgba(138,100,36,.35));box-shadow:0 0 .15em rgba(0,0,0,.6)}
.tof-plate.hostile:before{background:linear-gradient(#8e1b1b,rgba(142,27,27,.35))}
.tof-plate.below:after,.tof-plate.below:before{display:none}
.tof-plate .hd{display:flex;align-items:center;gap:.35em;font-family:'IM Fell English SC',serif;font-size:1.05em}
.tof-plate .fl{width:1.1em;height:.75em;border:.06em solid #2a1c10;flex:none}
.tof-plate .sub{font-style:italic;color:#4a3420;font-size:max(.9em,13px);margin:.05em 0 .2em}
.tof-plate .bar{height:.32em;background:#3a2716;border-radius:.2em;margin-top:.15em;overflow:hidden}
.tof-plate .bar i{display:block;height:100%}
.tof-plate .h i{background:linear-gradient(90deg,#8e1b1b,#d9763a)} .tof-plate .s i{background:linear-gradient(90deg,#bfae86,#f5ecd2)}
.tof-plate .cl{margin-left:auto;padding:0 .4em;border-radius:.7em;background:#3a2716;color:#f5e9c9;font-size:max(.82em,12px);letter-spacing:.04em}
.tof-plate .cl.prey{background:#46703a}.tof-plate .cl.tough{background:#a8661a}.tof-plate .cl.over{background:#8e1b1b}
`;
// fixed interface that plates keep clear of (direct #hud children or their pills); [selector, 'top' = may push a plate down]
const OBSTACLES = [
  ['.ledger-strip', 1], ['.res-band', 1], ['.toasts .toast', 1], ['.goal-line', 1], ['.chart', 1], ['.chart .legend', 1], ['.target', 1],
  ['.shoal-alert', 1], ['.banner', 1], ['.prompt', 0], ['.helm .bar', 0], ['.helm .tacline', 0], ['.helm .cam-pill', 0],
  ['.hint-card', 0], ['.mate-guide', 0], ['.mission-brief', 0], ['.hint', 0],
];
const GAP = 5;   // px kept between a plate and anything else

export class Nameplates {
  constructor(game) {
    this.game = game; this.enabled = true; this.forced = !!game.params?.get('plates');
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    { const host = game.uiRoot || document.body; host.insertBefore(this.root, host.firstChild); }   // below the HUD: a nameplate never hides the minimap or the target sheet
    const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);
    this.pool = new Map();
    this.obst = []; this._dirty = true; this._again = 0; this._measure = true;
    addEventListener('resize', () => { this._dirty = true; this._measure = true; });
    // cursor: the last position over the 3D view (null over a panel, a menu, or outside the window)
    this.cursor = null; this.hovered = null;
    addEventListener('pointermove', e => { this.cursor = e.target instanceof HTMLCanvasElement ? { x: e.clientX, y: e.clientY } : null; }, true);
    document.addEventListener('pointerleave', () => { this.cursor = null; });
    addEventListener('blur', () => { this.cursor = null; });
  }
  show(on) { this.enabled = on; this.root.style.display = on ? '' : 'none'; }

  _active() {
    const g = this.game, rig = g.cameraRig;
    if (this.forced) return true;
    if (g.mode !== 'sail' && g.mode !== 'map') return false;   // no plates over menus, port, duel, capture sheet
    if (!rig) return false;
    if (rig.mode === 'shot' || rig.mode === 'path') {
      let n = 0;
      for (const s of g.ships) if (s.alive !== false && s.position.distanceToSquared(rig.target) < 450 * 450) n++;
      return n >= 2;
    }
    return false;
  }

  // the ship under the cursor: nearest projected hull within its apparent size (never smaller than a comfortable
  // target, so a distant sail stays catchable); the current one is kept until the cursor is clearly off it
  _hover(R) {
    const g = this.game, c = this.cursor, cam = g.camera;
    if (!c || g.mode !== 'sail' || !g.cameraRig || g.cameraRig.mode === 'shot' || g.cameraRig.mode === 'path') return null;
    const W = innerWidth, H = innerHeight, f = H / (2 * Math.tan((cam.fov || 52) * Math.PI / 360));
    let best = null, bd = Infinity;
    for (const s of g.ships) {
      if (s === g.player || s.alive === false || s.sunk) continue;
      const dist = s.position.distanceTo(cam.position);
      if (dist > R) continue;
      const L = s.length || 30;
      _p.copy(s.position); _p.y += L * 0.4; _p.project(cam);
      if (_p.z > 1) continue;
      const x = (_p.x * 0.5 + 0.5) * W, y = (-_p.y * 0.5 + 0.5) * H;
      const r = Math.max(34, Math.min(220, 0.62 * L * f / Math.max(1, dist))) * (s === this.hovered ? 1.35 : 1);
      const d = Math.hypot(x - c.x, y - c.y);
      if (d < r && d / r < bd) { bd = d / r; best = s; }
    }
    return best;
  }

  _el(s) {
    let e = this.pool.get(s);
    if (e) return e;
    const d = document.createElement('div'); d.className = 'tof-plate';
    d.innerHTML = '<div class="hd"><span class="fl"></span><span class="nm"></span><span class="cl"></span></div><div class="sub"></div><div class="bar h"><i></i></div><div class="bar s"><i></i></div>';
    this.root.appendChild(d);
    e = { d, fl: d.querySelector('.fl'), nm: d.querySelector('.nm'), cl: d.querySelector('.cl'), sub: d.querySelector('.sub'), h: d.querySelector('.h i'), s: d.querySelector('.s i'), key: '', w: 0, h0: 0 };
    this.pool.set(s, e);
    return e;
  }

  // observers on the fixed interface: any class / size / content change marks the rectangles stale
  _watch() {
    const hud = this.game.hud?.el || document.getElementById('hud');
    if (!hud || this._watched === hud) return;
    this._watched = hud;
    const dirty = () => { this._dirty = true; };
    // a class written again with the same value (the hint card rewrites its className every frame) is no change
    this._mo = new MutationObserver(list => { for (const m of list) if (m.type !== 'attributes' || m.oldValue !== m.target.getAttribute(m.attributeName)) { this._dirty = true; return; } });
    this._ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(dirty) : null;
    this._mo.observe(hud, { attributes: true, attributeFilter: ['class'], attributeOldValue: true, childList: true });   // #hud.hidden, new panels
    this._seen = new WeakSet();
  }
  _observe(el) {
    if (this._seen.has(el)) return;
    this._seen.add(el);
    this._mo.observe(el, { attributes: true, attributeFilter: ['class', 'hidden'], attributeOldValue: true, childList: el.classList.contains('toasts') });
    this._ro?.observe(el);   // size: new text, folded card, [hidden] (display: none)
  }
  // one layout read for every obstacle, only when something changed (and once more after the transitions)
  _readObstacles(now, first) {
    this._watch();
    const hud = this._watched, list = [];
    if (hud && !hud.classList.contains('hidden')) {
      for (const el of hud.querySelectorAll('.toasts')) this._observe(el);   // new toasts = childList
      for (const [sel, top] of OBSTACLES) for (const el of hud.querySelectorAll(sel)) {
        if (!sel.startsWith('.toasts')) this._observe(el);
        const c = el.classList;
        if (c.contains('off') || c.contains('held') || c.contains('await') || el.hidden) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.1) continue;
        list.push({ l: r.left, t: r.top, r: r.right, b: r.bottom, top: !!top });
      }
    }
    this.obst = list; this._dirty = false;
    this._again = first ? now + 0.6 : 0;   // re-read once the entry transitions (slide, fade) have settled
  }

  update() {
    const g = this.game, cam = g.camera;
    if (!this.enabled) return;
    const on = this._active();
    this.active = on;   // read by the HUD: target card folds while plates already label the ships (staged framings only)
    // the canvas covers the window (game.resize) — reading clientWidth here forced a layout every frame
    const W = innerWidth, H = innerHeight;
    const seen = new Set();
    // longue-vue (lot 4, game.fortune.fx.viewMul ×1,25 / ×1,5): ships are identified farther away too
    const R = 1400 * (g.fortune?.fx?.viewMul ?? 1), fade0 = R - 300;
    const hov = this.hovered = on ? null : this._hover(R);
    if (on || hov) {
      cam.updateMatrixWorld();
      const now = performance.now() / 1000;
      if (this._dirty) this._readObstacles(now, true);
      else if (this._again && now > this._again) this._readObstacles(now, false);
      const cand = [];
      const ctrl = g.player?.controller, tgt = g.hud?.target;
      for (const s of g.ships) {
        if (s.alive === false || s.sunk) continue;
        if (!on && s !== hov) continue;
        const dist = s.position.distanceTo(cam.position);
        if (dist > R) continue;
        _p.copy(s.position); _p.y += (s.length || 30) * 1.05;
        _p.project(cam);
        if (_p.z > 1 || Math.abs(_p.x) > 1.1 || Math.abs(_p.y) > 1.1) continue;
        const e = this._el(s); seen.add(s);
        const hostile = s !== g.player && (ctrl?.isEnemy ? ctrl.isEnemy(s) : s.hostile === true);
        const key = s.name + s.type + s.faction + s.crew + s.guns + hostile + (s.struck ? 1 : 0);
        if (key !== e.key) {
          e.key = key; e.w = 0;
          e.fl.style.background = FACTIONS[s.faction]?.color || '#777';
          e.nm.textContent = s.name || 'Unknown';
          e.sub.textContent = `${shipDesc(s.faction, s.type, true)}${s.struck ? ' · colours struck' : ''} · ${s.guns ?? '?'} guns · ${Math.round(s.crew ?? 0)} men`;
          e.d.classList.toggle('hostile', !!hostile);
        }
        // sea tiers: class, tinted by threat (refreshed with the bars)
        const th = s !== g.player && !s.struck ? threatOf(s, g.player) : null;
        const ck = th ? `${th.roman}|${th.key}` : CLASS_NAMES[powerClass(livePower(s)) - 1];
        if (ck !== e.ck) { e.ck = ck; e.cl.textContent = th ? th.roman : ck; e.cl.className = `cl${th ? ' ' + th.key : ''}`; e.cl.title = th ? th.label : ''; e.w = 0; }
        // only write the style when it changes (each write invalidates the page's style)
        const hw = Math.max(0, Math.min(100, 100 * s.hull / (s.hullMax || 1))).toFixed(0) + '%', sw = Math.max(0, Math.min(100, 100 * (s.sails ?? 1))).toFixed(0) + '%';
        if (hw !== e.hw) { e.hw = hw; e.h.style.width = hw; }
        if (sw !== e.sw) { e.sw = sw; e.s.style.width = sw; }
        // priority: our ship, the HUD's target, hostiles, then the nearest
        const pri = (s === g.player ? 4e6 : 0) + (s === tgt ? 2e6 : 0) + (hostile ? 1e6 : 0) - dist;
        cand.push({ s, e, x: (_p.x * 0.5 + 0.5) * W, y: (-_p.y * 0.5 + 0.5) * H, dist, pri, key: s === g.player || s === tgt });
      }
      // sizes: measured in one batch, only for plates whose content (or the window) changed
      for (const c of cand) if (!c.e.w || this._measure) { c.e.w = c.e.d.offsetWidth; c.e.h0 = c.e.d.offsetHeight; c.e.a = Math.round(c.e.h0 * 0.14); }
      this._measure = false;
      cand.sort((a, b) => b.pri - a.pri);
      const placed = [];
      for (const c of cand) {
        const { e } = c, w = e.w, h = e.h0, a = e.a;   // a: the arrow under the plate (≈ .55em)
        const pos = this._place(c.x, c.y, w, h, a, placed, W, H, c.key);
        let op = c.dist > fade0 ? ((R - c.dist) / 300).toFixed(2) : '1';
        if (!pos) op = '0';
        else placed.push({ l: pos.x - w / 2, t: pos.y - h, r: pos.x + w / 2, b: pos.y + a, plate: true });
        const px = pos ? pos.x : c.x, py = pos ? pos.y : c.y;
        const tf = `translate(${px.toFixed(1)}px,${py.toFixed(1)}px) translate(-50%,-100%)`;
        if (tf !== e.tf) { e.tf = tf; e.d.style.transform = tf; }
        if (op !== e.op) { e.op = op; e.d.style.opacity = op; }
        // nudged plate: a leader line down to the masthead, the arrow over the ship; below a top block: no arrow
        const lead = pos && pos.y < c.y - 2 ? Math.round(c.y - pos.y) : 0, below = !!pos && pos.y > c.y + 1;
        const ax = pos ? Math.round(Math.max(-w / 2 + 10, Math.min(w / 2 - 10, c.x - pos.x))) : 0;
        if (lead !== e.lead) { e.lead = lead; e.d.style.setProperty('--lead', lead + 'px'); }
        if (ax !== e.ax) { e.ax = ax; e.d.style.setProperty('--ax', ax + 'px'); }
        if (below !== e.below) { e.below = below; e.d.classList.toggle('below', below); }
      }
    }
    for (const [s, e] of this.pool) if (!seen.has(s)) { if (!g.ships.includes(s)) { e.d.remove(); this.pool.delete(s); } else if (e.op !== '0') { e.op = '0'; e.d.style.opacity = '0'; } }
  }

  // free spot for a w×h plate (arrow a) whose bottom-centre wants to be (x, y): returns the bottom-centre {x, y} or null.
  // Candidates: the wanted spot, then every spot flush against a nearby obstacle (above it, below a block at the top of
  // the screen, to its left or right), and their combinations; the cheapest free one wins (going up is cheapest: the
  // leader line keeps the plate tied to its ship). Our ship and the target: 2.2 plate heights up or down, one width
  // sideways; the others only move while their arrow still stands over the ship (up, or less than half a width aside),
  // and stay hidden while their masthead is off the window.
  _place(x, y, w, h, a, placed, W, H, key) {
    if (!key && (x < 0 || x > W || y < 0 || y > H)) return null;
    const maxUp = h * 2.2 + 8, maxDown = key ? h * 2.2 + 40 : 0, maxSide = key ? w * 1.05 : w / 2 - 12;
    const near = [];
    const L = x - w / 2 - maxSide, R = x + w / 2 + maxSide, T = y - h - maxUp, B = y + a + maxDown;
    for (const q of this.obst) if (q.r > L && q.l < R && q.b > T && q.t < B) near.push(q);
    for (const q of placed) if (q.r > L && q.l < R && q.b > T && q.t < B) near.push(q);
    const free = (cx, cy) => {
      const l = cx - w / 2, t = cy - h, r = cx + w / 2, b = cy + a;
      if (l < 2 || r > W - 2 || t < 2 || b > H - 2) return false;
      for (const q of near) if (l < q.r + GAP && r > q.l - GAP && t < q.b + GAP && b > q.t - GAP) return false;
      return true;
    };
    if (free(x, y)) return { x, y };
    // inside the window first
    const x0 = Math.max(w / 2 + 3, Math.min(W - w / 2 - 3, x)), y0 = Math.max(h + 3, Math.min(H - a - 3, y));
    const xs = [x0], ys = [y0];
    for (const q of near) {
      xs.push(q.l - GAP - w / 2 - 1, q.r + GAP + w / 2 + 1);
      ys.push(q.t - GAP - a - 1);
      if (q.top) ys.push(q.b + GAP + h + 1);
    }
    let best = null, bc = Infinity;
    for (const cx of xs) {
      const dx = Math.abs(cx - x);
      if (dx > maxSide + Math.abs(x0 - x)) continue;
      for (const cy of ys) {
        const dy = cy - y;
        if (-dy > maxUp || dy > maxDown) continue;
        const cost = dx * 1.3 + (dy < 0 ? -dy : dy * 1.8);
        if (cost < bc && free(cx, cy)) { bc = cost; best = { x: cx, y: cy }; }
      }
    }
    return best;
  }
}
