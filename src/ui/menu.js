// Title screen, captain sheet, settings, controls and pause menu,
// drawn over the live 3D scene.
// API: new Menu(game, hud) ; open(screen) ; close() ; back() ; isOpen ; screen
//   screens: 'title' | 'captain' | 'settings' | 'controls' | 'pause' | 'firststeps' (“First steps”)
// New Game → captain sheet → "Set Sail": writes game.state.{name, nationality, difficulty, skill, shipName, epoch},
//   starting reputation, epoch (game.living.startEpoch: date, diplomacy, ships — src/data/creation.js), respawns the
//   player ship under the chosen flag in front of the nation's start port (startPortFor / startPose), emits
//   'game:new' {} (onboarding: hints reset, guided goals) then 'state:change' {from:'menu', to:'sail'}
//   and hides the menu.
// While the title is open: game.mode = 'menu' and the camera slowly circles the player's ship (cameraRig.setShotPath).
// Pause: freezes the simulation (game.frozen) and restores it on resume; emits 'ui:pause' {paused}.
import { flagSVG } from './flags.js';
import { ICONS, RULE } from './icons.js';
import { ensureSettings, saveSettings } from './settings.js';
import { kc } from '../core/keys.js';
import { QUALITY_UI_ORDER, QUALITY_UI_LABELS, QUALITY_UI_GROUP } from '../core/constants.js';
import { FIRST_STEPS, FIRST_KEYS } from '../data/hints.js';   // onboarding: “First steps” screen
import { SKILLS as SKILL_DEFS, SKILL_IDS, EPOCHS, EPOCH_IDS, DEFAULT_EPOCH, epochOf, START_PORT, startPortFor, startPose, startReputation } from '../data/creation.js';   // character creation
import { RELATIONS } from '../combat/factions.js';
import { nationPeople, ofName } from '../core/i18n.js';
import { GAME_MODES } from '../data/assist.js';   // “Assisted” game mode

// character creation: the line under each flag gives the starting port and the wars of the chosen epoch
const NATIONS = [
  ['english', 'England', ''],
  ['spanish', 'Spain', ''],
  ['french', 'France', ''],
  ['dutch', 'United Provinces', ''],
];
const DIFFS = [
  ['apprentice', 'Cabin boy', 'Forgiving enemy gunners and swordsmen'],
  ['mate', 'Mate', 'A fair fight (recommended)'],
  ['captain', 'Captain', 'Skilful gunners and swordsmen'],
  ['admiral', 'Admiral', 'No quarter'],
];
const SKILLS = SKILL_IDS.map(id => [id, SKILL_DEFS[id].name, SKILL_DEFS[id].effect]);
const EPOCH_CHOICES = EPOCH_IDS.map(id => [id, `${EPOCHS[id].year} · ${EPOCHS[id].name}`, EPOCHS[id].short]);
const BASE_REL = JSON.parse(JSON.stringify(RELATIONS));   // default relations (golden age), before any game
const PORT_NAMES = { portroyal: 'Port Royal', havana: 'Havana', fortroyal: 'Fort Royal', willemstad: 'Willemstad' };
// “Port Royal · at war: Spanish, Dutch” depending on the epoch
function nationNote(nat, epoch, ports) {
  const ep = epochOf(epoch), rel = n => { const r = (ep.rel || []).find(([a, b]) => (a === nat && b === n) || (a === n && b === nat)); return r ? r[2] : BASE_REL[nat]?.[n] ?? 0; };
  const others = NATIONS.map(n => n[0]).filter(n => n !== nat);
  const war = others.filter(n => rel(n) < 0).map(nationPeople), ally = others.filter(n => rel(n) > 0).map(nationPeople);
  const port = startPortFor(ports || [], nat)?.name || PORT_NAMES[START_PORT[nat]] || '';
  return `Sets out from ${port}<br>${war.length ? `At war: ${war.join(', ')}` : 'At peace with all'}${ally.length ? `<br>Allied: ${ally.join(', ')}` : ''}`;
}
const SHIP_NAMES = ['Merry Wren', 'Saltwhistle', 'Gilded Heron', 'Lantern Maid', 'Copper Gull', 'Restless Tide'];

const choice = (group, [id, t, d], extra = '') => `<button class="choice" data-g="${group}" data-v="${id}">${extra}<span class="t">${t}</span><span class="d">${d}</span></button>`;

export class Menu {
  constructor(game, hud) {
    this.game = game; this.hud = hud;
    this.isOpen = false; this.screen = null; this.stack = [];
    this.sheet = {
      name: game.state?.name && game.state.name !== 'Captain' ? game.state.name : 'Elias Thorne',
      nationality: game.state?.nationality || 'english', difficulty: game.state?.difficulty || 'mate',
      skill: game.state?.skill || 'navigation', shipName: game.player?.name && game.player.name !== 'Unnamed' ? game.player.name : SHIP_NAMES[0],
      epoch: EPOCHS[game.state?.epoch] ? game.state.epoch : DEFAULT_EPOCH,
      mode: game.state?.assist ? 'assist' : 'classic',   // game mode: game.state.assist
    };
    const el = this.el = document.createElement('div');
    el.className = 'menu-layer';
    el.innerHTML = `<div class="shade"></div><div class="screen"></div><div class="fade-black"></div>`;
    game.uiRoot.appendChild(el);
    this.scr = el.querySelector('.screen');
    this.fade = el.querySelector('.fade-black');
    el.addEventListener('click', e => this._click(e));
    el.addEventListener('input', e => this._input(e));
    el.addEventListener('keydown', e => { if (e.code === 'Enter' && e.target.tagName === 'INPUT') this._start(); });
    addEventListener('keydown', e => this._nav(e));
    el.addEventListener('mouseover', e => {
      const b = e.target.closest?.('.mi, .choice, .btn');
      if (b && !b.disabled && b !== this._hov) {
        this._hov = b; game.audio?.play?.('ui:hover');
        if (b.classList.contains('mi')) { this.scr.querySelectorAll('.mi.focus').forEach(x => x.classList.remove('focus')); b.classList.add('focus'); }
      }
    });
  }

  // ---------------- API ----------------
  open(screen = 'title') {
    const g = this.game;
    if (!this.isOpen) {
      this._prevMode = g.mode; this._prevFrozen = g.frozen;
      this.isOpen = true;
    }
    this.screen = screen;
    if (screen === 'title' || screen === 'captain') {
      if (g.mode !== 'menu') { const from = g.mode; g.mode = 'menu'; if (from) g.events.emit('state:change', { from, to: 'menu' }); }
      this._titleCamera();
      this.hud.show(false);
    }
    if (screen === 'pause') {
      if (!g.params.get('frozen')) g.frozen = true;
      g.events.emit('ui:pause', { paused: true });
    }
    this.stack = this._root(screen);
    this._render();
  }

  close() {
    if (!this.isOpen) return;
    const g = this.game;
    this.isOpen = false; this.screen = null;
    this.el.classList.remove('show', 'dim');
    if (this._paused) { g.frozen = this._prevFrozen ?? false; this._paused = false; g.events.emit('ui:pause', { paused: false }); }
    this.hud.show(true);
  }

  back() {
    if (!this.isOpen) return;
    this.game.audio?.play?.('ui:back');
    if (this.screen === 'pause') return this.close();
    if (this.screen === 'title') return;
    this.screen = this.stack.length > 1 ? this.stack[this.stack.length - 2] : 'title';
    this.stack.pop();
    this._render();
  }

  update() {
    // keep the menu camera orbit alive if another system re-targets the camera (no-op otherwise)
  }

  // ---------------- internals ----------------
  _root(screen) { return screen === 'pause' ? ['pause'] : screen === 'title' ? ['title'] : ['title', screen]; }

  _go(screen) { this.screen = screen; this.stack.push(screen); this.game.audio?.play?.('ui:page'); this._render(); }

  _titleCamera() {
    const g = this.game, p = g.player, rig = g.cameraRig;
    if (!p || !rig?.setShotPath || g.params.get('shot')) return;
    // slow, wide orbit around the ship: local frame x = starboard, y = up, z = astern
    const keys = [];
    for (let i = 0; i <= 8; i++) {
      const a = i / 8 * Math.PI * 2 + 0.6, r = 95 + 25 * Math.sin(i * 1.3);
      keys.push({ position: [Math.sin(a) * r, 16 + 6 * Math.cos(i * 0.9), Math.cos(a) * r], lookAt: [0, 12, 0], fov: 50 });
    }
    rig.setShotPath(keys, { duration: 90, loop: true, relativeTo: p, ease: false });
  }

  _render() {
    const s = this.screen;
    this._paused = s === 'pause' || (this._paused && this.stack[0] === 'pause');
    this.el.classList.add('show');
    this.el.classList.toggle('dim', this.stack[0] === 'pause' || s !== 'title');
    let html = '';
    if (s === 'title') html = this._title();
    else if (s === 'captain') html = this._captain();
    else if (s === 'settings') html = this._settings();
    else if (s === 'controls') html = this._controls();
    else if (s === 'pause') html = this._pause();
    else if (s === 'firststeps') html = this._firstSteps();
    this.scr.innerHTML = html;
    if (s === 'captain') this._syncChoices();
    if (s === 'settings') this._syncSettings();
    // focus first item for keyboard users
    this.scr.querySelector('.mi:not(:disabled)')?.classList.add('focus');
  }

  _title() {
    return `<div class="title-block">
        <div class="pre">A chronicle of the Spanish Main</div>
        <h1>Tides <span class="of">of</span> Fortune</h1>
        <svg class="flourish" viewBox="0 0 600 60" aria-hidden="true"><g fill="none" stroke="#f1d488" stroke-width="1.6" stroke-linecap="round">
          <path d="M40 30 H232"/><path d="M368 30 H560"/>
          <path d="M232 30 C252 8 276 8 290 22 C298 30 302 30 310 22 C324 8 348 8 368 30"/>
          <path d="M232 30 C252 52 276 52 290 38 C298 30 302 30 310 38 C324 52 348 52 368 30"/>
          <path d="M40 30 C26 22 18 26 14 30 C18 34 26 38 40 30Z" fill="#f1d488"/><path d="M560 30 C574 22 582 26 586 30 C582 34 574 38 560 30Z" fill="#f1d488"/>
          <circle cx="300" cy="30" r="4.5" fill="#f1d488"/><circle cx="200" cy="30" r="2.4" fill="#f1d488"/><circle cx="400" cy="30" r="2.4" fill="#f1d488"/>
          <path d="M120 30 L128 24 L136 30 L128 36 Z" fill="#f1d488"/><path d="M464 30 L472 24 L480 30 L472 36 Z" fill="#f1d488"/></g></svg>
        <div class="flagrow">${['english', 'spanish', 'french', 'dutch'].map(f => `<span class="fl">${flagSVG(f, { w: 42, h: 28 })}</span>`).join('<i class="dia"></i>')}</div>
        <div class="sub">Privateers, plunder and the high seas, anno 1660</div>
      </div>
      <div class="main-menu">
        <button class="mi" data-act="new">New game</button>
        <button class="mi" data-act="continue" disabled>Continue<span class="note">no voyage logged</span></button>
        <button class="mi" data-act="settings">Options</button>
        <button class="mi" data-act="controls">Controls</button>
        <button class="mi" data-act="firststeps">First steps</button>
      </div>
      <div class="menu-foot"><span>Press <b>Enter</b> to weigh anchor</span><span>v0.1 · an original voyage</span></div>`;
  }

  _captain() {
    const sh = this.sheet;
    return `<div class="sheet-wrap"><div class="sheet tof-parch captain-sheet" style="width:52em">
      <h2>Articles of command</h2>
      <div class="lede">Record your name, your flag and your talents, captain.</div>
      ${RULE}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.4em">
        <div class="field"><label for="cap-name">Captain’s name</label><input id="cap-name" type="text" maxlength="28" value="${sh.name.replace(/"/g, '&quot;')}" spellcheck="false" autocomplete="off"/></div>
        <div class="field"><label for="ship-name">Ship’s name</label><input id="ship-name" type="text" maxlength="24" value="${sh.shipName.replace(/"/g, '&quot;')}" spellcheck="false" autocomplete="off"/></div>
      </div>
      <div class="field"><span class="flabel">Era</span><div class="choices" style="grid-template-columns:repeat(3,1fr)">${EPOCH_CHOICES.map(e => choice('epoch', e)).join('')}</div></div>
      <div class="field"><span class="flabel">Sail under the colours of</span><div class="choices n4">
        ${NATIONS.map(n => choice('nationality', n, flagSVG(n[0], { w: 60, h: 40 }))).join('')}</div></div>
      <div class="field"><span class="flabel">Difficulty</span><div class="choices n4">${DIFFS.map(d => choice('difficulty', d)).join('')}</div></div>
      <div class="field"><span class="flabel">Game mode</span><div class="choices mode-choices">${GAME_MODES.map(m => choice('mode', m)).join('')}</div></div>
      <div class="field"><span class="flabel">Special talent</span><div class="choices n5">
        ${SKILLS.map(k => choice('skill', k, (ICONS[k[0]] || '').replace('<svg ', '<svg class="skill" '))).join('')}</div></div>
      <div class="actions"><button class="btn ghost" data-act="back">Back</button><button class="btn" data-act="start">Set sail</button></div>
    </div></div>`;
  }

  _settings() {
    const st = ensureSettings(this.game);
    const sl = (k, label, min = 0, max = 1, stp = 0.01) => `<div class="srow"><span class="sl">${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${stp}" value="${st[k]}"/><span class="sv" data-v="${k}"></span></div>`;
    return `<div class="sheet-wrap"><div class="sheet tof-parch" style="width:34em">
      <h2>Options</h2><div class="lede">Trim the ship to your liking.</div>${RULE}
      ${sl('master', 'Master volume')}${sl('music', 'Music')}${sl('sfx', 'Effects')}
      ${sl('mouseSensitivity', 'Mouse', 0.2, 2, 0.05)}
      <div class="srow"><span class="sl">Graphics</span><span class="seg">${QUALITY_UI_ORDER.map(q => `<button data-q="${q}" class="${QUALITY_UI_GROUP[st.quality] === q ? 'sel' : ''}">${QUALITY_UI_LABELS[q]}</button>`).join('')}</span></div>
      <div class="lede" style="font-family:var(--txt);font-size:.85em">Ultra needs a recent desktop graphics card. A change of level takes effect at the next load.</div>
      <div class="srow"><span class="sl">Combat camera</span><span class="seg cam-seg">${[['auto', 'Automatic'], ['manual', 'Manual']].map(([v, l]) => `<button data-cam="${v}" class="${(st.combatCam === 'manual') === (v === 'manual') ? 'sel' : ''}">${l}</button>`).join('')}</span></div>
      <div class="lede" style="font-family:var(--txt);font-size:.85em">Automatic: the camera frames your ship and the enemy from the first cannon shot. <span class="kc">C</span> recentres it on your ship at any time.</div>
      ${this._paused ? `<div class="srow"><span class="sl">Game mode</span><span class="seg assist-seg">${GAME_MODES.map(([v, l]) => `<button data-assist="${v}" class="${(!!this.game.state?.assist) === (v === 'assist') ? 'sel' : ''}">${l}</button>`).join('')}</span></div>
      <div class="lede" style="font-family:var(--txt);font-size:.85em">Assisted: your gunners fire on their own at the enemy that attacks you or that you have hit (<span class="kc">G</span> makes them cease fire), and your boardings are carried without a duel. Other ships attack you as usual.</div>` : ''}
      <div class="srow"><span class="sl">Tips</span><span class="seg hints-seg">${[['1', 'On'], ['0', 'Off']].map(([v, l]) => `<button data-hints="${v}" class="${(st.hints !== false) === (v === '1') ? 'sel' : ''}">${l}</button>`).join('')}</span></div>
      <div class="srow hints-reset-row"><span class="sl"></span><button class="btn ghost" data-act="hints-reset"${this.game.state?.tutorials ? '' : ' disabled'}>Show the tips again</button></div>
      <div class="srow"><span class="sl">Statistics</span><span class="seg stats-seg">${[['1', 'On'], ['0', 'Off']].map(([v, l]) => `<button data-stats="${v}" class="${(st.stats !== false) === (v === '1') ? 'sel' : ''}">${l}</button>`).join('')}</span></div>
      <div class="lede" style="font-family:var(--txt);font-size:.85em">Counted by Vercel, with no account and no cookie, to improve the game: visits, milestones reached, smoothness. When off, nothing is counted any more.</div>
      <div class="actions"><button class="btn ghost" data-act="back">Back</button><button class="btn" data-act="back">Done</button></div>
    </div></div>`;
  }

  _controls() {
    const row = (keys, what) => `<span class="k">${keys.map(k => /^(Key|Digit)/.test(k) ? kc(k) : `<span class="kc">${k}</span>`).join('')}</span><span class="what">${what}</span>`;
    return `<div class="sheet-wrap"><div class="sheet tof-parch controls-sheet">
      <h2>Ship’s orders</h2><div class="lede">How to handle her, captain.</div>${RULE}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 2em">
      <div class="keys">
        ${row(['KeyW', 'KeyS'], 'Make or shorten sail')}${row(['KeyA', 'KeyD'], 'Put the helm over')}
        ${row(['KeyQ', 'KeyE'], 'Port / starboard broadside')}${row(['Space'], 'Fire at the nearest enemy')}
        ${row(['Digit1', 'Digit2', 'Digit3'], 'Round shot, chain shot or grapeshot')}
        ${row(['R'], 'Emergency repairs: heave to, work while stopped (sail or a broadside interrupts them)')}${row(['I'], 'Hold: throw goods overboard')}${row(['X', 'X'], 'Strike the colours (twice)')}
        ${row(['C'], 'Change view · in combat: recentre on the ship')}${row(['T'], 'Speed up time')}
        ${row(['G'], 'Assisted mode: fire at will or cease fire')}
      </div><div class="keys">
        ${row(['B'], 'Board a weakened enemy alongside')}${row(['F'], 'Enter port · dig at the treasure mark')}${row(['M'], 'Unroll the map')}${row(['L'], 'Ledger: Top 10, officers, items')}${row(['J'], 'Journal: latest messages')}${row(['V'], 'Attack the town · organise an attack')}${row(['KeyW', 'KeyA', 'KeyS', 'KeyD'], 'Infiltration: move (Shift run, Space pick a lock, R ×2 surrender)')}
        ${row(['Esc'], 'Pause and options')}
      </div></div>
      <div class="lede" style="margin-top:.6em">In a duel</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 2em">
      <div class="keys">
        ${row(['KeyA', 'KeyD'], 'Fall back / advance')}${row(['KeyW', 'KeyS'], 'High / low line (nothing = middle)')}
        ${row(['KeyJ'], 'Cut on the chosen line')}${row(['KeyK'], 'Parry on the line (hold)')}
      </div><div class="keys">
        ${row(['Space'], 'Dodge aside (+ back off, jump or duck with the direction)')}
        ${row(['KeyL'], 'Taunt (may stun)')}${row(['KeyY'], 'Surrender (hold)')}
      </div></div>
      <div class="lede" style="margin-top:.6em">Town assault (V near a foreign port or at the haven)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 2em">
      <div class="keys">
        ${row(['L-click'], 'Select a company (drag: box)')}${row(['R-click'], 'March, or charge the company under the cursor')}
        ${row(['KeyW', 'KeyA', 'KeyS', 'KeyD'], 'Move the camera')}${row(['KeyQ', 'KeyE'], 'Rotate (wheel: zoom)')}
      </div><div class="keys">
        ${row(['T'], 'All companies')}${row(['Digit1', 'Digit6'], 'One company')}${row(['H'], 'Halt')}
        ${row(['Space'], 'Pause')}${row(['R', 'R'], 'Sound the retreat')}
      </div></div>
      <div class="actions"><span></span><button class="btn" data-act="back">Understood</button></div>
    </div></div>`;
  }

  // onboarding: the game loop in six lines and the main keys (the layout's real letters)
  _firstSteps() {
    const key = k => /^(Key|Digit)/.test(k) ? kc(k) : `<span class="kc">${k}</span>`;
    return `<div class="sheet-wrap"><div class="sheet tof-parch firststeps-sheet">
      <h2>First steps</h2><div class="lede">A captain’s life, in a few lines.</div>${RULE}
      <div class="fs-grid">
        <ol class="fs-loop">${FIRST_STEPS.map(([t, d], i) => `<li><span class="fs-n">${i + 1}</span><div><b>${t}</b><span>${d}</span></div></li>`).join('')}</ol>
        <div class="fs-side"><div class="fs-h">The main keys</div>
          <div class="keys fs-keys">${FIRST_KEYS.map(([ks, what]) => `<span class="k">${ks.map(key).join('')}</span><span class="what">${what}</span>`).join('')}</div></div>
      </div>
      <div class="actions"><button class="btn ghost" data-act="controls">All the controls</button><button class="btn" data-act="back">Understood</button></div>
    </div></div>`;
  }

  _pause() {
    return `<div class="sheet-wrap"><div class="sheet tof-parch" style="width:24em;text-align:center">
      <h2>Ship at rest</h2><div class="lede">${this.game.state?.name || 'Captain'} · ${this.game.player?.name || ''}</div>${RULE}
      <div class="pause-menu">
        <button class="mi" data-act="resume">Resume</button>
        <button class="mi" data-act="save">Save</button>
        <button class="mi" data-act="firststeps">First steps</button>
        <button class="mi" data-act="settings">Options</button>
        <button class="mi" data-act="controls">Controls</button>
        <button class="mi" data-act="quit">Back to title</button>
      </div>
    </div></div>`;
  }

  // keyboard navigation: ↑/↓ (or W/S) between menu items, Enter to activate
  _nav(e) {
    if (!this.isOpen || e.target?.tagName === 'INPUT') return;
    const items = [...this.scr.querySelectorAll('.mi:not(:disabled)')];
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      if (this.screen === 'captain') { this._start(); e.preventDefault(); return; }
      const f = this.scr.querySelector('.mi.focus') || this.scr.querySelector('.btn:not(.ghost)');
      f?.click(); e.preventDefault(); return;
    }
    const dir = (e.code === 'ArrowDown' || e.code === 'KeyS') ? 1 : (e.code === 'ArrowUp' || e.code === 'KeyW') ? -1 : 0;
    if (!dir || !items.length) return;
    const i = items.findIndex(b => b.classList.contains('focus'));
    items.forEach(b => b.classList.remove('focus'));
    items[(i + dir + items.length) % items.length].classList.add('focus');
    this.game.audio?.play?.('ui:hover');
    e.preventDefault();
  }

  _syncChoices() {
    for (const b of this.scr.querySelectorAll('.choice')) b.classList.toggle('sel', this.sheet[b.dataset.g] === b.dataset.v);
    // character creation: starting port and the epoch's wars under each flag
    for (const b of this.scr.querySelectorAll('.choice[data-g="nationality"] .d')) b.innerHTML = nationNote(b.parentElement.dataset.v, this.sheet.epoch, this.game.islands?.ports);
  }
  _syncSettings() {
    const st = ensureSettings(this.game);
    for (const sv of this.scr.querySelectorAll('.sv')) {
      const k = sv.dataset.v, v = st[k];
      sv.textContent = k === 'mouseSensitivity' ? `×${(+v).toFixed(2)}` : `${Math.round(v * 100)}`;
    }
  }

  _input(e) {
    const t = e.target;
    if (t.id === 'cap-name') this.sheet.name = t.value;
    if (t.id === 'ship-name') this.sheet.shipName = t.value;
    if (t.dataset?.k) {
      saveSettings(this.game, { [t.dataset.k]: parseFloat(t.value) });
      this._syncSettings();
    }
  }

  _click(e) {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const a = this.game.audio;
    if (b.classList.contains('choice')) { this.sheet[b.dataset.g] = b.dataset.v; this._syncChoices(); a?.play?.('ui:select'); return; }
    if (b.dataset.cam) { saveSettings(this.game, { combatCam: b.dataset.cam }); this.scr.querySelectorAll('.cam-seg button').forEach(x => x.classList.toggle('sel', x === b)); a?.play?.('ui:select'); return; }
    if (b.dataset.assist) {   // game mode: game in progress and captain sheet
      if (this.game.state) this.game.state.assist = b.dataset.assist === 'assist';
      this.sheet.mode = b.dataset.assist;
      this.scr.querySelectorAll('.assist-seg button').forEach(x => x.classList.toggle('sel', x === b)); a?.play?.('ui:select'); return;
    }
    if (b.dataset.hints) { saveSettings(this.game, { hints: b.dataset.hints === '1' }); this.scr.querySelectorAll('.hints-seg button').forEach(x => x.classList.toggle('sel', x === b)); a?.play?.('ui:select'); return; }
    if (b.dataset.stats) { saveSettings(this.game, { stats: b.dataset.stats === '1' }); this.scr.querySelectorAll('.stats-seg button').forEach(x => x.classList.toggle('sel', x === b)); a?.play?.('ui:select'); return; }   // usage statistics (src/core/telemetry.js)
    if (b.dataset.q) { saveSettings(this.game, { quality: b.dataset.q }); this.scr.querySelectorAll('.seg button[data-q]').forEach(x => x.classList.toggle('sel', x === b)); a?.play?.('ui:select'); return; }
    const act = b.dataset.act;
    a?.play?.('ui:select');
    if (act === 'new') this._go('captain');
    else if (act === 'settings' || act === 'controls' || act === 'firststeps') this._go(act);
    else if (act === 'hints-reset') {   // onboarding: hints shown again (and turned back on)
      this.game.hud?.hints?.reset?.(); saveSettings(this.game, { hints: true });
      this.scr.querySelectorAll('.hints-seg button').forEach(x => x.classList.toggle('sel', x.dataset.hints === '1'));
      b.textContent = 'Tips shown again ✓'; b.disabled = true;
    }
    else if (act === 'back') this.back();
    else if (act === 'start') this._start();
    else if (act === 'resume') this.close();
    else if (act === 'save') {
      const busy = this.game.duel?.active || this.game.boarding?.active || this.game.mode !== 'sail';
      const ok = !busy && this.game.ports?.save?.();
      this.game.events.emit('notify', { text: ok ? 'Game saved.' : 'Cannot save now (at sea, away from close combat).', kind: ok ? 'good' : 'bad' });
      if (ok) b.textContent = 'Saved ✓';
    }
    else if (act === 'quit') {
      // integration: quitting autosaves (Continue resumes here) and reloads to a clean title, so a later
      // New Game starts from fresh career/world state instead of inheriting this voyage's gold, fleet and missions
      if (this.game.ports?.save && !this.game.duel?.active && !this.game.boarding?.active) this.game.ports.save();
      this.fade.classList.add('on'); setTimeout(() => (this.game.leaveGuard ? this.game.leaveGuard.reload() : location.reload()), 500);   // leave guard: no browser confirmation
    }
  }

  _start() {
    const g = this.game, sh = this.sheet;
    const name = (sh.name || '').trim() || 'Elias Thorne', shipName = (sh.shipName || '').trim() || SHIP_NAMES[0];
    const nat = NATIONS.some(n => n[0] === sh.nationality) ? sh.nationality : 'english', ep = epochOf(sh.epoch);
    Object.assign(g.state, { name, nationality: nat, difficulty: sh.difficulty, skill: sh.skill, shipName, epoch: ep.id });
    g.state.assist = sh.mode === 'assist';   // “Assisted” game mode (src/data/assist.js)
    g.state.ammoUnlocked = { chain: false, grape: false };   // round shot only, chain/grape bought at a shipyard
    // character creation: good reputation with one's own nation only; epoch (date, diplomacy, ships) — src/data/creation.js
    Object.assign(g.state.reputation ||= {}, startReputation(nat, NATIONS.map(n => n[0])));
    if (g.living?.startEpoch) g.living.startEpoch(ep.id); else g.state.date = { year: ep.year, month: 6, day: 1 };
    if (g.player) g.player.ammo = 'round';
    this.fade.classList.add('on');
    g.audio?.play?.('ui:start');
    setTimeout(() => {
      let p = g.player;
      // character creation: in the roads of a port of one's nation, bow seaward (under the fade to black)
      const pose = startPose(startPortFor(g.islands?.ports || [], nat));
      const move = !!p && Math.hypot(p.position.x - pose.x, p.position.z - pose.z) > 60;
      if (p && (p.faction !== nat || p.name !== shipName || move)) {
        const C = p.controller?.constructor;
        const np = g.spawnShip({ type: p.type, faction: nat, isPlayer: true, x: move ? pose.x : p.position.x, z: move ? pose.z : p.position.z, heading: move ? pose.heading : p.heading, sailSetting: p.sailSetting, name: shipName });
        if (C) np.controller = new C(g, np);
        g.removeShip(p); g.player = p = np;
        if (move && g.state.mapTrack) g.state.mapTrack.length = 0;   // chart track: nothing before departure
      }
      if (p) g.cameraRig?.follow?.(p);
      g.mode = 'sail';
      g.events.emit('game:new', {});   // onboarding: hints reset, guided goals (src/ui/hints.js)
      g.events.emit('state:change', { from: 'menu', to: 'sail' });
      this.close();
      this.hud.notify(`Captain ${name} takes command ${ofName(shipName)}.`, 'good');
      requestAnimationFrame(() => this.fade.classList.remove('on'));
    }, 900);
  }
}
