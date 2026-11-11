// The first mate's panel: the prologue's guide (offer, four orders, farewell), at the bottom left of the HUD, in place
// of the hint card and the goal line while the prologue lasts (a single place to read).
// Portrait: the game's own 3D character (portrait3d.js, roles 'mate' | 'mate:pleased' | 'mate:worried'), painted once
// per new game at the player's nation by prepare() — called on 'game:new', under the fade to black — then cached
// (three data URLs: no rendering at sea). Without a renderer (tests in node, ?portraits=0): the medallion's vector
// drawing (PORTRAIT).
// Driven by src/ui/hints.js (hints.mate): show(view) re-renders only when the content changes; hold(true) hides it
// behind screens (menu, port, duel, boarding, chart…); the Begin / Skip buttons carry data-pro (hints._proAct).
// view = { mode: 'offer'|'order'|'bye', mood: 'neutral'|'pleased'|'worried', text (HTML), todo: [[html, done]],
//          order: 'Order 2 of 4' | '', step, acts: 'offer'|'skip'|'' }
import { portraitURL } from './port/portrait3d.js';
import { PORTRAIT } from './port/art.js';
import { MATE } from '../data/hints.js';

const SEED = 1707;   // the mate's fixed figure (skin, hair: see portraitLook 'mate')
const ROLE = { neutral: 'mate', pleased: 'mate:pleased', worried: 'mate:worried' };

export class MateGuide {
  constructor(game, hudEl, onAct) {
    this.game = game; this.faces = {}; this.nation = null; this._html = ''; this.visible = false;
    if (typeof document === 'undefined' || !hudEl) return;
    const el = this.el = document.createElement('div');
    el.className = 'mate-guide tof-parch interactive off';
    el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.addEventListener('click', e => { const b = e.target.closest?.('[data-pro]'); if (b) { e.stopPropagation(); onAct?.(b.dataset.pro); } });
    hudEl.appendChild(el);
  }

  // paints the three faces (one render each, ~1 ms on a GPU after the studio warm-up; shader programs shared with the
  // port medallions); called once per new game, under the fade
  prepare(nation) {
    this.nation = nation || 'english';
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    for (const [mood, role] of Object.entries(ROLE)) this.faces[mood] = portraitURL(this.game, role, SEED, this.nation);
    this.prepMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  }
  face(mood = 'neutral') {
    if (!this.nation) this.prepare(this.game.state?.nationality || this.game.player?.faction);
    return this.faces[mood] || this.faces.neutral || null;
  }

  // returns true when the panel's content changed (the caller re-measures it)
  show(v) {
    if (!this.el) return false;
    const todo = v.todo?.length ? `<ul class="mg-todo">${v.todo.map(([t, ok]) => `<li class="${ok ? 'ok' : ''}"><i></i><span>${t}</span></li>`).join('')}</ul>` : '';
    const acts = v.acts === 'offer'
      ? `<div class="mg-acts"><button class="btn" data-pro="start">${MATE.offer.start}</button><button class="btn ghost" data-pro="skip">${MATE.offer.skip}</button></div>`
      : v.acts === 'skip' ? `<button class="mg-skip" data-pro="skip">${MATE.skip}</button>` : '';
    const img = this.face(v.mood);
    const html = `<div class="mg-face" data-mood="${v.mood || 'neutral'}">${PORTRAIT('mate', SEED, { img })}</div>
      <div class="mg-body"><div class="mg-head"><span class="mg-name">${MATE.name}</span><span class="mg-role">${MATE.role}</span>${v.order ? `<span class="mg-order">${v.order}</span>` : ''}</div>
      <div class="mg-txt">${v.text}</div>${todo}${acts}</div>`;
    const cls = `mate-guide tof-parch interactive ${v.mode || 'order'}`;
    if (html !== this._html) {
      const fresh = !this.visible || this.el.dataset.step !== (v.step || '');
      this._html = html; this.el.innerHTML = html;
      this.el.className = cls + (this._held ? ' held' : '');
      if (fresh) { void this.el.offsetWidth; this.el.classList.add('in'); }
      this.el.dataset.step = v.step || '';
      this.visible = true;
      return true;
    }
    return false;
  }
  hide() {
    if (!this.el || !this.visible) return;
    this.visible = false; this._html = '';
    this.el.className = 'mate-guide tof-parch interactive off'; delete this.el.dataset.step;
  }
  // returns true when it changed
  hold(on) { on = !!on; if (on === !!this._held) return false; this._held = on; this.el?.classList.toggle('held', on); return true; }
  // height of the panel (the hint card stacks above it), 0 when hidden
  height() { return this.el && this.visible && !this._held ? this.el.offsetHeight : 0; }
}
