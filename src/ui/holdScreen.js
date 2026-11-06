// The hold (I key, at sea, even in the thick of a fight): cargo and provisions aboard, thrown overboard by 1, 10
// or all to lighten the ship (LOAD overload in career.js, ship.loadSpeedF). DOM sheet over the frozen world, like
// the Registry (L): game.frozen, mode 'map' (M, J, L, F, V keys and guns inert), HUD hidden.
// Pure logic: src/game/transship.js — makeManifest(cargo, food, {}, cap), move(m, k, 'out', n) to the
// “overboard” pile (m.prize), takeBack(), applyHold(), jettisonPhrase().
// “Throw overboard” (Enter) applies and closes; “Cancel”, I or Escape close without throwing anything.
// Keyboard: ↑ ↓ good · → throw · ← take back · Shift ×10 · Ctrl all.
// Opening: PlayerController (input.pressedKey('i'), only when the ship can manoeuvre in 'sail' mode).
// API: new HoldScreen(game) · open() → bool · close() · apply() → bool · isOpen · manifest
// Event: 'hold:jettison' { lots, guns }; 'notify' message “20 hogsheads of sugar overboard” (log J).
// “Guns” row (by 2): withGuns/moveGuns/applyGuns (transship.js) accumulate state.upgrades.gunsLost,
// applyUpgrades() (save.js) derives ship.guns (smaller broadside, combat.fireBroadside) and the speed gain; guns
// replaced at the refit (PortSystem.rearm). Barrels floating behind the ship: fx.flotsam() (wreck mesh).
import './hold.css';
import { isKey } from '../core/keys.js';
import { GOODS } from '../data/world.js';
import { GOOD_ICON } from './port/art.js';
import { holdCapacity } from '../game/economy.js';
import { loadFactor } from '../game/career.js';
import { makeManifest, move, takeBack, bulkOf, valueOf, rows, applyHold, jettisonPhrase, withGuns, moveGuns, applyGuns, gunSpeedF, gunsPhrase, GUN_JETTISON } from '../game/transship.js';
import { applyUpgrades } from '../game/save.js';
import { ICONS } from './icons.js';
import { fmtInt, ofShip } from '../core/i18n.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = f => `${Math.round(f * 100)}%`;

export class HoldScreen {
  constructor(game) {
    this.game = game; this.isOpen = false; this.manifest = null; this.row = 0; this._keys = [];
    this.el = document.createElement('div'); this.el.className = 'board-screen hold-screen';
    (game.uiRoot || document.body).appendChild(this.el);
    addEventListener('keydown', e => this._key(e), true);
    this.el.addEventListener('click', e => this._click(e));
  }

  canOpen() {
    const g = this.game, p = g.player;
    return !this.isOpen && !!g.state && g.mode === 'sail' && !!p && p.alive && !p.sinking && !p.struck
      && !g.hud?.menu?.isOpen && !g.boarding?.active;
  }
  open() {
    if (!this.canOpen()) return false;
    const g = this.game, st = g.state;
    this.manifest = makeManifest(st.cargo, st.food, {}, holdCapacity(g));
    withGuns(this.manifest, g.player.guns ?? 0, g.player.spec?.guns ?? g.player.guns ?? 0);
    this.row = 0;
    this.isOpen = true; this._prevFrozen = g.frozen; g.frozen = true; g.mode = 'map';
    g.hud?.show?.(false);
    this.render();
    this.el.classList.add('on');
    g.audio?.play?.('ui:page');
    g.events.emit('ui:pause', { paused: true });
    return true;
  }
  close() {
    if (!this.isOpen) return;
    const g = this.game;
    this.isOpen = false; this.manifest = null;
    g.frozen = this._prevFrozen && g.params.get('frozen') ? true : false; g.mode = 'sail';
    g.hud?.show?.(true);
    this.el.classList.remove('on');
    g.audio?.play?.('ui:back');
    g.events.emit('ui:pause', { paused: false });
  }
  // throw the “overboard” pile into the sea: state.cargo / state.food, speed at once, journal + toast
  apply() {
    const g = this.game, m = this.manifest;
    if (!this.isOpen || !m) return false;
    const lots = { ...m.prize }, guns = m.guns?.out || 0;
    if (!Object.keys(lots).length && !guns) { this.close(); return false; }
    applyHold(g.state, m);
    const p = g.player, used = bulkOf(m.own);
    if (p) p.loadSpeedF = loadFactor(used, m.cap);   // career re-checks every second; no lag after the throw
    if (guns && p) { g.state.upgrades = g.state.upgrades || {}; applyGuns(g.state.upgrades, m); applyUpgrades(p, g.state.upgrades); }
    this.close();
    const goods = jettisonPhrase(lots);
    const text = guns ? (goods ? `${gunsPhrase(guns)} and ${goods[0].toLowerCase()}${goods.slice(1)}` : `${gunsPhrase(guns)} overboard`) : goods;
    g.events.emit('notify', { text, kind: 'info', topic: 'crew' });
    g.events.emit('hold:jettison', { lots, guns });
    if (p) {
      g.audio?.play?.('splash', { position: p.position, volume: 0.7 });
      const r = p.right(), f = p.forward(), side = (p.windRel ?? 1) >= 0 ? -1 : 1, half = (p.length || 30) * 0.5;
      for (let i = 0; i < 3; i++) {   // splashes along the lee side (pooled smoke particles, already warmed up)
        const a = (i - 1) * half * 0.45, o = (p.spec?.beam || 8) * 0.5 + 1.2;
        g.fx?.splash?.({ x: p.position.x + r.x * o * side + f.x * a, y: 0, z: p.position.z + r.z * o * side + f.z * a }, 0.45);
      }
      // barrels and bales floating along the leeward side, then left behind the ship, where they sink
      const units = Object.values(lots).reduce((a, q) => a + q, 0);
      if (units > 0) g.fx?.flotsam?.({ x: p.position.x + r.x * ((p.spec?.beam || 8) * 0.5 + 2) * side, z: p.position.z + r.z * ((p.spec?.beam || 8) * 0.5 + 2) * side },
        Math.max(2, Math.min(9, Math.round(units / 6))), { fx: f.x, fz: f.z, len: half * 1.4, sx: r.x * side, sz: r.z * side });
    }
    return true;
  }

  render() {
    const g = this.game, m = this.manifest;
    if (!m) return;
    const ks = this._keys = rows(m);
    this.row = Math.max(0, Math.min(this.row, ks.length - 1));
    const used = bulkOf(m.own), cap = m.cap, f0 = loadFactor(m.used0, cap), f1 = loadFactor(used, cap);
    const G = m.guns || { own: 0, out: 0, max: 0 }, hasGuns = G.max > 0 && (G.own + G.out) > 0;
    const thrown = Object.keys(m.prize).length > 0 || G.out > 0;
    if (hasGuns) ks.push('__guns');
    this.row = Math.max(0, Math.min(this.row, ks.length - 1));
    const unit = (k, q) => (q > 1 ? GOODS[k]?.unitPl : GOODS[k]?.unit) || '';
    const side = (k, q) => q > 0 ? `<b>${fmtInt(q)}</b> <i>${unit(k, q)}</i><em>${fmtInt(valueOf(k, q))} g</em>` : '<span class="nil">—</span>';
    const tot = o => Object.entries(o).reduce((a, [k, q]) => a + valueOf(k, q), 0);
    const btn = (k, dir, n, lbl, t, off) => `<button data-mv="${dir}" data-k="${k}" data-n="${n}" title="${t}"${off ? ' disabled' : ''}>${lbl}</button>`;
    const speed = f0 >= 1 && f1 >= 1 ? `<span>No overload: the ship sails at full speed.</span>`
      : f1 > f0 + 1e-3 ? `<span>Overload: speed <b class="dn">${pct(f0)}</b> → <b class="${f1 >= 1 ? 'up' : 'dn'}">${pct(f1)}</b>${f1 >= 1 ? ', the overload is gone.' : '.'}</span>`
        : `<span>Overload: the ship makes only <b class="dn">${pct(f1)}</b> of her speed.</span>`;
    const p = g.player, lost0 = (g.state.upgrades?.gunsLost || 0);
    const gf0 = gunSpeedF(lost0, G.max), gf1 = gunSpeedF(lost0 + G.out, G.max);
    const gunLine = G.out > 0 ? `<span class="h-guns">${gunsPhrase(G.out)} into the sea: speed <b class="up">+${Math.round((gf1 / gf0 - 1) * 100)}%</b>, a broadside of <b class="dn">${Math.ceil(G.own / 2)}</b> gun${Math.ceil(G.own / 2) > 1 ? 's' : ''} per side.</span>` : '';
    const goodsRows = ks.filter(k => k !== '__guns');
    const gunsRow = hasGuns ? `<tr data-row="${ks.length - 1}" data-k="__guns" class="guns${this.row === ks.length - 1 ? ' sel' : ''}" title="Jettisoned guns can be bought back at the shipyard (repairs): ${GUN_JETTISON.price} gold each"><td class="g"><span class="gico">${ICONS.cannon || ''}</span><span>Guns</span></td>
        <td class="q">${G.own > 0 ? `<b>${fmtInt(G.own)}</b> <i>gun${G.own > 1 ? 's' : ''}</i><em>of ${G.max}</em>` : '<span class="nil">—</span>'}</td>
        <td class="mv">${btn('__guns', 'gback', 1e9, '↺', 'Take all back aboard', !G.out)}<s></s>${btn('__guns', 'gout', GUN_JETTISON.step, String(GUN_JETTISON.step), `Throw ${GUN_JETTISON.step} guns overboard (one per side)`, !G.own)}${btn('__guns', 'gout', 10, '10', 'Throw 10 guns overboard', G.own < 3)}${btn('__guns', 'gout', 1e9, 'All', 'Throw all the guns overboard', !G.own)}</td>
        <td class="q out">${G.out > 0 ? `<b>${fmtInt(G.out)}</b> <i>gun${G.out > 1 ? 's' : ''}</i>` : '<span class="nil">—</span>'}</td></tr>` : '';
    const body = ks.length ? `
      <table class="ts-t"><tr class="hd"><td></td><td>Aboard</td><td class="mv">Throw</td><td>Overboard</td></tr>
      ${goodsRows.map((k, i) => { const own = m.own[k] || 0, out = m.prize[k] || 0; return `<tr data-row="${i}" data-k="${k}" class="${i === this.row ? 'sel' : ''}"><td class="g">${GOOD_ICON(k)}<span>${GOODS[k]?.name || k}</span></td>
        <td class="q">${side(k, own)}</td>
        <td class="mv">${btn(k, 'back', 1e9, '↺', 'Take all back aboard', !out)}<s></s>${btn(k, 'out', 1, '1', 'Throw 1', !own)}${btn(k, 'out', 10, '10', 'Throw 10', !own)}${btn(k, 'out', 1e9, 'All', 'Throw all', !own)}</td>
        <td class="q out">${side(k, out)}</td></tr>`; }).join('')}
      ${gunsRow}
      <tr class="tot"><td>Estimated value</td><td class="q"><em>${fmtInt(tot(m.own))} g</em></td><td></td><td class="q out"><em>${fmtInt(tot(m.prize))} g</em></td></tr></table>`
      : `<p class="h-empty">The hold is empty, captain: nothing to throw.</p>`;
    this.el.innerHTML = `<div class="board-sheet capture hold">
      <h2>The hold${p ? ' ' + esc(ofShip(p)) : ''}</h2>
      <div class="sub">What goes overboard is lost; a lighter hold gives the ship back her speed.</div>
      <div class="ts">
        <div class="ts-hd"><div class="ts-gauge ${used > cap ? 'over' : ''}"><span>Hold</span><div class="hbar"><i style="width:${Math.min(100, used / Math.max(1, cap) * 100).toFixed(1)}%"></i></div><b>${fmtInt(used)}/${fmtInt(cap)}</b></div></div>
        <div class="h-speed">${speed}${gunLine}</div>
        ${body}
        <div class="ts-help"><span>↑ ↓ goods</span> · <span>→ throw · ← take back</span> · <span>Shift ×10 · Ctrl all</span> · <span>Enter confirm</span> · <span><span class="kc">I</span> or Esc cancel</span></div>
      </div>
      <div class="choices">
        <button data-act="apply" class="${thrown ? 'sel' : ''}"${thrown ? '' : ' disabled'}>Throw overboard</button>
        <button data-act="cancel">Cancel</button>
      </div>
      <button class="h-x" data-act="cancel" aria-label="Close" title="Close without throwing anything">×</button>
    </div>`;
    this.el.querySelectorAll('tr[data-row]').forEach(r => r.onmouseenter = () => {
      if (this.row === +r.dataset.row) return;
      this.row = +r.dataset.row; this.el.querySelectorAll('tr[data-row]').forEach(x => x.classList.toggle('sel', x === r));
    });
  }

  _click(e) {
    const b = e.target.closest?.('button');
    if (!b || b.disabled || !this.isOpen) return;
    e.stopPropagation();
    const act = b.dataset.act, m = this.manifest;
    if (act === 'cancel') return this.close();
    if (act === 'apply') return this.apply();
    const k = b.dataset.k;
    if (!k || !m) return;
    this.row = this._keys.indexOf(k);
    if (b.dataset.mv === 'out') move(m, k, 'out', +b.dataset.n); else if (b.dataset.mv === 'back') takeBack(m, k, +b.dataset.n);
    else if (b.dataset.mv === 'gout') moveGuns(m, +b.dataset.n); else if (b.dataset.mv === 'gback') moveGuns(m, -(+b.dataset.n));
    this.game.audio?.play?.('ui:select');
    this.render();
  }

  _key(e) {
    if (!this.isOpen || e.target?.tagName === 'INPUT') return;
    const m = this.manifest, ks = this._keys, n = e.ctrlKey || e.metaKey ? 1e9 : e.shiftKey ? 10 : 1;
    if (e.code === 'Escape' || (isKey(e, 'i') && !e.repeat)) this.close();
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') this.apply();
    else if ((e.code === 'ArrowUp' || e.code === 'ArrowDown') && ks.length) { this.row = (this.row + (e.code === 'ArrowUp' ? -1 : 1) + ks.length) % ks.length; this.render(); }
    else if ((e.code === 'ArrowRight' || e.code === 'ArrowLeft') && ks.length && m) {
      const k = ks[this.row];
      if (k === '__guns') moveGuns(m, (e.code === 'ArrowRight' ? 1 : -1) * (n === 1 ? GUN_JETTISON.step : n));
      else if (e.code === 'ArrowRight') move(m, k, 'out', n); else takeBack(m, k, n);
      this.render();
    } else return;
    // handled here: the pause menu, the map and the helm must not see it
    e.preventDefault(); e.stopImmediatePropagation();
  }
}
