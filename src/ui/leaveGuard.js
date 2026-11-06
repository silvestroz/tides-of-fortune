// Leave guard: the browser's right click and Back.
// - Right click: no more browser context menu anywhere in the page (`blockContextMenu()`, called at the very start
//   of main.js), except in a text field (copy / paste the captain's name). The game's own right clicks (port: buy
//   ×10, land battle) keep their own listeners, which run first.
// - Back (browser button, mouse "back" button, Alt+←, touchpad gesture) in a game: a "guard" history entry
//   (`history.state.tof = 'guard'`) is pushed at the first interaction (Chrome skips entries pushed without
//   interaction); Back returns to the base entry (popstate, same document) → in-game “Leave the game?” sheet,
//   simulation frozen. “Stay aboard” (Escape) puts the guard back; “Leave” saves when possible (like
//   “Back to title”) then goes back through the history. On the title screen (mode 'menu'), Back leaves without
//   asking. The browser's Forward while the sheet is open = stay.
// - Reload, closing the tab, another address: the browser's confirmation (beforeunload, text imposed by the
//   browser), in a game only.
// - Navigations the game wants: `game.leaveGuard.reload(url?)` (Retour au titre, end of career) — otherwise the
//   browser would ask for confirmation. Every new navigation of the game must go through it.
// - Stale entries: reloading on the "guard" entry leaves the old base entry below it, whose document no longer
//   exists (going back there would reload the game). `history.state.tofDepth` counts those entries; “Leave” skips them.
// Active in production; off in dev (frequent reloads), under automation and in ?shot= showcases;
// ?guard=1 forces it, ?guard=0 turns it off (`guardEnabled`, tested by tools/test-leave.mjs).
// API: game.leaveGuard = { enabled, isOpen, leaving, open(), close(), reload(url?), allow() }
import { RULE } from './icons.js';

const TEXT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const NO_SAVE_MODES = new Set(['menu', 'land', 'sneak']);

export function guardEnabled({ params, nav = {}, dev = false }) {
  const q = params.get('guard');
  if (q === '1') return true;
  return !(q === '0' || nav.webdriver || params.has('shot') || dev);
}

let ctxBlocked = false;
export function blockContextMenu() {
  if (ctxBlocked) return;
  ctxBlocked = true;
  addEventListener('contextmenu', e => {
    const t = e.target;
    if (t && (TEXT_TAGS.has(t.tagName) || t.isContentEditable)) return;
    e.preventDefault();
  });
}

export function installLeaveGuard(game) {
  blockContextMenu();
  const on = guardEnabled({ params: game.params, nav: navigator, dev: !!import.meta.env?.DEV });
  const api = game.leaveGuard = {
    enabled: on, isOpen: false, leaving: false,
    allow() { api.leaving = true; },
    reload(url) { api.leaving = true; if (url) location.href = url; else location.reload(); },
    open() {}, close() {},
  };
  if (!on) return api;

  const st = () => (history.state && typeof history.state === 'object' ? history.state : null);
  const depth = () => st()?.tofDepth | 0;
  const isGuard = () => st()?.tof === 'guard';
  const inGame = () => !!game.player && !!game.mode && game.mode !== 'menu';
  const canSave = () => {
    const p = game.player;
    return !!game.ports?.save && !game.duel?.active && !game.boarding?.active && !!p?.alive && !p.sinking && !NO_SAVE_MODES.has(game.mode);
  };

  // current entry = base entry; reloaded on the guard: the old base, below, is stale
  {
    const s = st();
    if (s?.tof === 'guard') history.replaceState({ ...s, tof: 'base', tofDepth: (s.tofDepth | 0) + 1 }, '');
    else if (s?.tof !== 'base') history.replaceState({ ...(s || {}), tof: 'base', tofDepth: 0 }, '');
  }

  // guard pushed during a user gesture, if there is a page to go back to
  const arm = () => {
    if (api.leaving || api.isOpen || isGuard() || history.length <= 1 + depth()) return;
    try { history.pushState({ tof: 'guard', tofDepth: depth() }, ''); } catch { /* never blocking */ }
  };
  addEventListener('pointerdown', arm, true);
  addEventListener('keydown', arm, true);

  // navigation the game wants: the URL replaces the current entry (no extra history entry)
  api.reload = url => {
    api.leaving = true;
    if (url) { try { history.replaceState(history.state, '', url); } catch { location.href = url; return; } }
    location.reload();
  };

  // ---------------- “Leave the game?” sheet
  const el = document.createElement('div');
  el.className = 'leave-layer interactive';
  (game.uiRoot || document.body).appendChild(el);
  let prevFrozen = false, timer = 0;

  api.open = () => {
    if (api.isOpen) return;
    api.isOpen = true;
    prevFrozen = game.frozen; game.frozen = true;
    game.input?.keys?.clear?.();
    if (document.pointerLockElement) document.exitPointerLock?.();
    const save = canSave();
    el.innerHTML = `<div class="shade"></div><div class="sheet-wrap"><div class="sheet tof-parch leave-sheet" role="dialog" aria-modal="true" aria-labelledby="leave-h">
      <h2 id="leave-h">Leave the game?</h2>
      <div class="lede">You asked for the previous page.</div>${RULE}
      <p class="leave-txt">${save
        ? `The game will be saved before leaving: “Continue” will pick it up here.`
        : `The game cannot be saved right now (duel, boarding, battle…): if you leave, you will resume from the last save.`}</p>
      <div class="actions"><button class="btn seal" data-act="leave">Leave</button><button class="btn" data-act="stay">Stay aboard</button></div>
    </div></div>`;
    el.classList.add('show');
    game.audio?.play?.('ui:page');
    el.querySelector('[data-act="stay"]')?.focus({ preventScroll: true });
  };

  api.close = () => {
    if (!api.isOpen) return;
    api.isOpen = false;
    el.classList.remove('show');
    game.frozen = prevFrozen;
  };

  const stay = () => { if (!api.isOpen) return; game.audio?.play?.('ui:back'); api.close(); arm(); };

  const leave = () => {
    api.leaving = true;
    if (canSave()) { try { game.ports.save(); } catch { /* leave anyway */ } }
    el.querySelectorAll('button').forEach(b => { b.disabled = true; });
    // from the base entry, over the stale entries; deferred: called during popstate (title), Chrome ignores a
    // history.go() until the current traversal has finished
    const n = 1 + depth();
    setTimeout(() => history.go(-n), 0);
    // no page to go back to (history too short): we stay, the guard will come back at the next interaction
    clearTimeout(timer);
    timer = setTimeout(() => { api.leaving = false; api.close(); }, 4000);
  };

  el.addEventListener('click', e => {
    const b = e.target.closest?.('button[data-act]');
    if (!b || b.disabled) return;
    if (b.dataset.act === 'stay') stay(); else leave();
  });

  // while the sheet is open, the game doesn't see the keyboard: Escape = stay, Enter = active button
  addEventListener('keydown', e => {
    if (!api.isOpen) return;
    e.stopImmediatePropagation();
    const btns = [...el.querySelectorAll('button')], cur = btns.indexOf(document.activeElement);
    if (e.code === 'Escape') { e.preventDefault(); stay(); }
    else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') { e.preventDefault(); (btns[cur] || btns[1])?.click(); }
    else if (e.code === 'Tab' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); btns[cur === 0 ? 1 : 0]?.focus({ preventScroll: true }); }
  }, true);

  addEventListener('popstate', () => {
    if (api.leaving) return;
    if (isGuard()) { if (api.isOpen) api.close(); return; }   // the browser's Forward: stay
    if (!inGame()) { leave(); return; }
    api.open();
  });

  addEventListener('beforeunload', e => {
    if (api.leaving || !inGame()) return;
    e.preventDefault(); e.returnValue = '';
  });

  // back from the browser's cache (page restored as is): start clean
  addEventListener('pageshow', e => { if (e.persisted) { clearTimeout(timer); api.leaving = false; api.close(); } });

  return api;
}
