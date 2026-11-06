// Floating ship nameplates (parchment + brass), shown over ships in the tactical view and in combat framings.
// API: new Nameplates(game); update(dt); show(bool) (master switch); forced (bool) show regardless of camera mode.
// Visible when: forced, or cameraRig.mode === 'tactical', or a fixed/shot camera with ≥2 ships near its target.
// Per ship: faction flag swatch, name, type, guns · crew, hull and sails bars; hostile ships get a red rim.
// One DOM element per ship (pooled), positioned by projecting a point above the masthead; culled off-screen/far.
// Sea tiers: class pill (I–V) coloured by threat (prey, even match, tough, out of your class).
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
.tof-plate:after{content:'';position:absolute;left:50%;bottom:-.55em;margin-left:-.45em;border:.45em solid transparent;border-top-color:#8a6424;border-bottom:0}
.tof-plate .hd{display:flex;align-items:center;gap:.35em;font-family:'IM Fell English SC',serif;font-size:1.05em}
.tof-plate .fl{width:1.1em;height:.75em;border:.06em solid #2a1c10;flex:none}
.tof-plate .sub{font-style:italic;color:#5a4128;font-size:.9em;margin:.05em 0 .2em}
.tof-plate .bar{height:.32em;background:#3a2716;border-radius:.2em;margin-top:.15em;overflow:hidden}
.tof-plate .bar i{display:block;height:100%}
.tof-plate .h i{background:linear-gradient(90deg,#8e1b1b,#d9763a)} .tof-plate .s i{background:linear-gradient(90deg,#bfae86,#f5ecd2)}
.tof-plate .cl{margin-left:auto;padding:0 .4em;border-radius:.7em;background:#3a2716;color:#f5e9c9;font-size:max(.82em,11px);letter-spacing:.04em}
.tof-plate .cl.prey{background:#46703a}.tof-plate .cl.tough{background:#a8661a}.tof-plate .cl.over{background:#8e1b1b}
`;

export class Nameplates {
  constructor(game) {
    this.game = game; this.enabled = true; this.forced = !!game.params?.get('plates');
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    { const host = game.uiRoot || document.body; host.insertBefore(this.root, host.firstChild); }   // below the HUD: a nameplate never hides the minimap or the target sheet
    const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);
    this.pool = new Map();
  }
  show(on) { this.enabled = on; this.root.style.display = on ? '' : 'none'; }

  _active() {
    const g = this.game, rig = g.cameraRig;
    if (this.forced) return true;
    if (g.mode !== 'sail' && g.mode !== 'map') return false;   // no plates over menus, port, duel, capture sheet
    if (!rig) return false;
    if (rig.mode === 'tactical') return true;
    if (rig.mode === 'shot' || rig.mode === 'path') {
      let n = 0;
      for (const s of g.ships) if (s.alive !== false && s.position.distanceToSquared(rig.target) < 450 * 450) n++;
      return n >= 2;
    }
    return false;
  }

  _el(s) {
    let e = this.pool.get(s);
    if (e) return e;
    const d = document.createElement('div'); d.className = 'tof-plate';
    d.innerHTML = '<div class="hd"><span class="fl"></span><span class="nm"></span><span class="cl"></span></div><div class="sub"></div><div class="bar h"><i></i></div><div class="bar s"><i></i></div>';
    this.root.appendChild(d);
    e = { d, fl: d.querySelector('.fl'), nm: d.querySelector('.nm'), cl: d.querySelector('.cl'), sub: d.querySelector('.sub'), h: d.querySelector('.h i'), s: d.querySelector('.s i'), key: '' };
    this.pool.set(s, e);
    return e;
  }

  update() {
    const g = this.game, cam = g.camera;
    if (!this.enabled) return;
    const on = this._active();
    this.active = on;   // read by the HUD: target card folds while plates already label the ships
    // the canvas covers the window (game.resize) — reading clientWidth here forced a layout every frame
    const W = innerWidth, H = innerHeight;
    const seen = new Set();
    // longue-vue (lot 4, game.fortune.fx.viewMul ×1,25 / ×1,5): ships are identified farther away too
    const R = 1400 * (g.fortune?.fx?.viewMul ?? 1), fade0 = R - 300;
    if (on) {
      cam.updateMatrixWorld();
      for (const s of g.ships) {
        if (s.alive === false || s.sunk) continue;
        const dist = s.position.distanceTo(cam.position);
        if (dist > R) continue;
        _p.copy(s.position); _p.y += (s.length || 30) * 1.05;
        _p.project(cam);
        if (_p.z > 1 || Math.abs(_p.x) > 1.1 || Math.abs(_p.y) > 1.1) continue;
        const e = this._el(s); seen.add(s);
        const ctrl = g.player?.controller;
        const hostile = s !== g.player && (ctrl?.isEnemy ? ctrl.isEnemy(s) : s.hostile === true);
        const key = s.name + s.type + s.faction + s.crew + s.guns + hostile + (s.struck ? 1 : 0);
        if (key !== e.key) {
          e.key = key;
          e.fl.style.background = FACTIONS[s.faction]?.color || '#777';
          e.nm.textContent = s.name || 'Unknown';
          e.sub.textContent = `${shipDesc(s.faction, s.type, true)}${s.struck ? ' · colours struck' : ''} · ${s.guns ?? '?'} guns · ${Math.round(s.crew ?? 0)} men`;
          e.d.classList.toggle('hostile', !!hostile);
        }
        // sea tiers: class, tinted by threat (refreshed with the bars)
        const th = s !== g.player && !s.struck ? threatOf(s, g.player) : null;
        const ck = th ? `${th.roman}|${th.key}` : CLASS_NAMES[powerClass(livePower(s)) - 1];
        if (ck !== e.ck) { e.ck = ck; e.cl.textContent = th ? th.roman : ck; e.cl.className = `cl${th ? ' ' + th.key : ''}`; e.cl.title = th ? th.label : ''; }
        // only write the style when it changes (each write invalidates the page's style)
        const hw = Math.max(0, Math.min(100, 100 * s.hull / (s.hullMax || 1))).toFixed(0) + '%', sw = Math.max(0, Math.min(100, 100 * (s.sails ?? 1))).toFixed(0) + '%';
        if (hw !== e.hw) { e.hw = hw; e.h.style.width = hw; }
        if (sw !== e.sw) { e.sw = sw; e.s.style.width = sw; }
        const x = (_p.x * 0.5 + 0.5) * W, y = (-_p.y * 0.5 + 0.5) * H;
        const tf = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`, op = dist > fade0 ? ((R - dist) / 300).toFixed(2) : '1';
        if (tf !== e.tf) { e.tf = tf; e.d.style.transform = tf; }
        if (op !== e.op) { e.op = op; e.d.style.opacity = op; }
      }
    }
    for (const [s, e] of this.pool) if (!seen.has(s)) { if (!g.ships.includes(s)) { e.d.remove(); this.pool.delete(s); } else if (e.op !== '0') { e.op = '0'; e.d.style.opacity = '0'; } }
  }
}
