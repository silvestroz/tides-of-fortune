// Boarding — turns 'combat:board' {attacker, defender} into a cinematic transition, a sword duel on the
// defender's deck, and a capture / defeat screen.
//
// API (game.boarding):
//   boarding.begin(attacker, defender, { difficulty })   start a boarding by hand (also used by the shot scenes)
//   boarding.active   bool
// Events: 'boarding:start' { attacker, defender, enemy }
//         'boarding:end'   { result: 'captured'|'sunk'|'released'|'defeat', enemy, spoils?, penalty? }
// Outcome:
//   win  → capture screen: cargo + gold taken, prisoners freed, part of the enemy crew joins;
//          choose: take her into the fleet (state.fleet) | sink her | let her go (strike and drift).
//   lose → captured (same as striking the colours, below).
// Defeat (combat lot 1): the player strikes (X twice → combat.strike(player) → 'ship:struck') or loses the duel →
//   captivity sheet. Captor = the enemy. Pirates maroon the captain on the nearest cove with a small sloop and a
//   handful of men (ship, cargo and most gold lost); a nation throws him in prison (CAPTIVITY.prisonDays pass,
//   ransom = CAPTIVITY.prisonGold of the gold, cargo seized, the battered ship returned at the nearest friendly port).
//   Event 'player:captured' { kind: 'prison'|'marooned', captor, goldLost, days }. A sinking still ends on the
//   shipwreck sheet.
// The duel's crew ratio comes from the two ships' crews; the duel API is game.duel (src/game/duel/duelScene.js).
import { SNEAK as SNEAK_TUNING } from '../data/sneak.js';   // escape outcomes
import { boardingSpoils } from './duel/sim.js';
import { saveGame, NO_UPGRADES } from './save.js';
import { ensureFleet, FLEET } from './fleet.js';   // the old ship waits with the squadron
import { holdCapacity } from './economy.js';
import { makeManifest, bestFill, move as tsMove, bulkOf, valueOf, rows as tsRows, canValidate, limitOf } from './transship.js';
import { GOOD_ICON } from '../ui/port/art.js';
import { GOODS } from '../data/world.js';
import { SHIP_TYPES } from '../data/shipTypes.js';
import { a, fmtInt, theShip, shipDesc, theName, ofName } from '../core/i18n.js';
import { isKey } from '../core/keys.js';
import { SPECIALISTS } from '../data/fortune.js';
import { itemName } from './fortune.js';
import { isAssist } from '../data/assist.js';   // “Assisted” mode: boarding carried without a duel

export const CAPTIVITY = { prisonDays: [45, 90], prisonGold: 0.6, prisonCrew: 0.35, maroonGold: 0.8, maroonCrew: 12, maroonDays: 12 };
// After a shipwreck or captivity, the player may leave on a lugger — the fastest and handiest ship, which crosses
// reefs — to slip away from enemies that are too strong; the old ship waits with the squadron (shipyard: take back
// command of it). Marooned by pirates, it is this lugger that is pulled out of the wrecks. A new lugger goes unnoticed
// by hostile ships beyond discreetR metres for discreetS seconds at sea (1.5 days), until its first gunshot
// (ship.discreetUntil, read by ai._scan).
export const ESCAPE_SHIP = { type: 'lugger', discreetS: 360, discreetR: 380,
  names: ['Ferret', 'Weasel', 'Will-o’-the-Wisp', 'Swallow', 'Curlew', 'Teal', 'Swift'] };

const NAMES = {
  spanish: ['Don Rodrigo de Alcalá', 'Capitán Esteban Ruiz', 'Don Felipe Mendoza', 'Capitán Álvaro Sotomayor'],
  english: ['Captain Josiah Hale', 'Captain Edmund Crewe', 'Captain Thomas Blyth'],
  french: ['Capitaine Henri Valcourt', 'Capitaine Luc Marchand', 'Capitaine Armand Delisle'],
  dutch: ['Kapitein Pieter de Wael', 'Kapitein Joost van Hoorn', 'Kapitein Maarten Visscher'],
  pirate: ['"Red" Malachy Thorne', 'Black Isaac Rourke', 'Gentleman Ned Varley', 'Mad Sal Cutter'],
};

export class Boarding {
  constructor(game) {
    this.game = game;
    this.active = false;
    game.events.on('combat:board', ({ attacker, defender }) => {
      if (!attacker?.isPlayer && !defender?.isPlayer) return;
      if (this.active || game.duel?.active) return;
      const enemy = attacker.isPlayer ? defender : attacker;
      this.begin(game.player, enemy);
    });
    // player's ship went down: shipwreck sheet after a short beat, then rescue to a friendly port
    game.events.on('ship:sunk', ({ ship } = {}) => {
      if (!ship?.isPlayer || this._wrecked) return;
      this._wrecked = true;
      setTimeout(() => this._shipwreckScreen(ship), 1500);
    });
    // player struck her colours: the enemy takes possession after a short beat
    game.events.on('ship:struck', ({ ship } = {}) => {
      if (!ship?.isPlayer || this._captive) return;
      const captor = ship.controller?.nearestEnemy?.(1500) || ship.lastAttacker;
      this._captive = true;
      setTimeout(() => this._captivityScreen(ship, captor, { cause: 'struck' }), 1800);
    });
    const root = game.uiRoot || document.body;
    this.fadeEl = document.createElement('div'); this.fadeEl.className = 'board-fade'; root.appendChild(this.fadeEl);
    this.screen = document.createElement('div'); this.screen.className = 'board-screen'; root.appendChild(this.screen);
  }

  captainFor(enemy) {
    if (!enemy._captain) {
      const list = NAMES[enemy.faction] || NAMES.pirate;
      const role = enemy.role || 'merchant';
      const base = { merchant: 0.25, pirate: 0.6, patrol: 0.55, hunter: 0.75, navy: 0.6 }[role] ?? 0.45;
      const big = ({ frigate: 0.15, galleon: 0.1 }[enemy.type] ?? { fregate: 0.15, vaisseau: 0.2, galion: 0.1, corvette: 0.08 }[SHIP_TYPES[enemy.type]?.fam]) || 0;
      enemy._captain = { name: list[(enemy.id * 7) % list.length], faction: enemy.faction, difficulty: Math.min(1, base + big + ((enemy.id * 37) % 10) / 50) };
    }
    return enemy._captain;
  }

  // a failure anywhere in the boarding sequence (transition, duel, capture sheet) must never leave `active` set:
  // the player controller ignores helm and sail orders while it is (the ship would be stuck at sea for good)
  async begin(player, enemy, opts = {}) {
    if (this.active) return;
    try { await this._begin(player, enemy, opts); }
    catch (e) {
      console.error('[boarding] aborted', e);
      const g = this.game;
      removeEventListener('keydown', this._keyH);
      try { if (g.duel?.active) g.duel.abort?.(); } catch {}
      this.screen.classList.remove('on'); this.fadeEl.classList.remove('on');
      if (g.mode === 'menu' || g.frozen) this._pause(false);
      if (g.player && !g.player.controller && player?.controller) g.player.controller = player.controller;
      this.active = false; this.spoils = null; this.manifest = null;
      g.events.emit('notify', { text: 'The boarding party falls back to the ship.', kind: 'info' });
    }
  }

  async _begin(player, enemy, { difficulty } = {}) {
    const g = this.game;
    this.active = true;
    this.enemy = enemy;
    g.events.emit('boarding:start', { attacker: player, defender: enemy, enemy });
    const cap = this.captainFor(enemy);
    // remember the player's camera mode: the boarding/duel shots leave the rig in a shot/tactical state otherwise
    const rm = g.cameraRig?.mode; this._rigMode = rm === 'shot' || rm === 'path' ? (g.cameraRig.prevMode || 'chase') : (rm || 'chase');
    // ---- transition: camera swings low alongside, grapnels, fade ----
    const rig = g.cameraRig;
    if (rig && player && rig.setShotPath && !g.frozen) {
      const dx = enemy.position.x - player.position.x, dz = enemy.position.z - player.position.z;
      const mx = (player.position.x + enemy.position.x) / 2, mz = (player.position.z + enemy.position.z) / 2;
      const L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
      rig.setShotPath([
        { position: [mx + nx * 70, 34, mz + nz * 70], lookAt: [mx, 4, mz] },
        { position: [mx + nx * 30 + dx / L * 10, 12, mz + nz * 30 + dz / L * 10], lookAt: [enemy.position.x, 6, enemy.position.z] },
      ], { duration: 1.6 });
      g.notify?.('Throw the grapnels! Boarders, follow me!');
      g.events.emit('notify', { text: 'Throw the grapnels! Boarders, follow me!', kind: 'info' });
      await this._wait(1.2);
    }
    await this._fade(true);
    // “Assisted” mode: the crew carries the deck, no duel (reason 'assist' on the capture screen)
    if (isAssist(g.state)) {
      await this._wait(0.15);
      this._fade(false);
      this._captureScreen(player, enemy, { winner: 'player', reason: 'assist' });
      return;
    }
    const duelP = g.duel.start({
      opponent: { ...cap, difficulty: difficulty ?? cap.difficulty },
      setting: enemy, crewPlayer: player?.crew ?? g.state.crew, crewEnemy: enemy.crew,
    });
    await this._wait(0.15);
    this._fade(false);
    const res = await duelP;
    await this._fade(true, 0.35);
    this._fade(false);
    if (res.winner === 'player') this._captureScreen(player, enemy, res);
    else this._defeatScreen(player, enemy, res);
  }

  _wait(s) { return new Promise(r => setTimeout(r, s * 1000)); }
  _fade(on, s = 0.6) { this.fadeEl.style.transitionDuration = s + 's'; this.fadeEl.classList.toggle('on', on); return this._wait(on ? s : 0); }

  _pause(on) {
    const g = this.game;
    // integration: the HUD is hidden behind the capture / defeat sheet (mode 'menu' keeps Esc/M/F inert meanwhile)
    if (on) { this._prevFrozen = g.frozen; g.frozen = true; g.mode = 'menu'; g.hud?.show?.(false); }
    else {
      g.frozen = this._prevFrozen && g.params.get('frozen') ? true : false; g.mode = 'sail'; g.hud?.show?.(true);
      const rig = g.cameraRig; if (rig && g.player) { rig.follow(g.player); rig.mode = this._rigMode || 'chase'; rig.prevMode = rig.mode; }
    }
  }

  _captureScreen(player, enemy, res) {
    const g = this.game, st = g.state;
    const sp = this.spoils = boardingSpoils(enemy.type, Math.random, { crewEnemy: enemy.crew, crewPlayer: player?.crew, role: enemy.role });
    if (enemy.treasure && !sp._treasure) { sp._treasure = true; sp.gold += 4000 + Math.round(Math.random() * 4000); }   // treasure galleon
    const recruits = sp.recruits;
    const fleetFull = (st.fleet?.length || 0) >= 7;
    // transshipment: the player's hold vs the prize's, pre-filled with the legacy best fill (most valuable per bulk)
    this.manifest = bestFill(makeManifest(st.cargo, st.food, sp.cargo, holdCapacity(g)));
    this._tsRow = 0;
    const how = res.reason === 'pressed' ? 'Backed against the mast, he threw down his sword.' : res.reason === 'assist' ? 'Your men have carried the deck; her captain hands you his sword.' : 'Her captain lies bleeding on his own deck.';
    this._pause(true);
    this.screen.innerHTML = `<div class="board-sheet capture">
      <h2>${(s => s[0].toUpperCase() + s.slice(1))(theShip(enemy))} is taken!</h2>
      <div class="sub">${how} The ${shipDesc(enemy.faction, enemy.type)} strikes her colours to ${player?.name ? theName(player.name) : 'your ship'}.</div>
      <div class="rule"></div>
      <div class="cols">
        <div><h3>Plunder</h3><table>
          <tr><td>Gold from her strongbox</td><td class="n">${fmtInt(sp.gold)}</td></tr>
        </table></div>
        <div><h3>Men</h3><table>
          <tr><td>Sailors joining us</td><td class="n">${recruits}</td></tr>
          <tr><td>Prisoners freed from her hold</td><td class="n">${sp.prisoners}</td></tr>
          <tr><td>Her captain</td><td class="n">${this.captainFor(enemy).name}</td></tr>
        </table></div>
      </div>
      ${this._findsHtml(enemy)}
      <div class="ts" data-ts></div>
      <div class="sub">What shall we do with the prize? <span class="tsnote">What stays in her hold goes with her if you keep her; otherwise it is lost.</span></div>
      <div class="choices">
        <button data-c="captured" ${fleetFull ? 'disabled' : ''}>Keep her as a prize</button>
        <button data-c="sunk">Set her on fire</button>
        <button data-c="released">Let her go</button>
      </div>
      ${fleetFull ? '<div class="note">Your squadron has reached its limit of eight sail.</div>' : ''}
    </div>`;
    this.screen.classList.add('on');
    this.screen.querySelectorAll('button[data-c]').forEach(b => b.onclick = () => this._resolveCapture(player, enemy, b.dataset.c));
    const hb = this.screen.querySelector('[data-hire]');
    if (hb) hb.onclick = e => { e.stopPropagation(); this._hire(hb); };
    this._renderTs(fleetFull);
    this._keyH = e => {
      if (this._tsKey(e, fleetFull)) return;
      if (e.code === 'Digit4' && hb && !hb.disabled) return this._hire(hb); if (e.code === 'Digit1' && !fleetFull) this._resolveCapture(player, enemy, 'captured'); if (e.code === 'Digit2') this._resolveCapture(player, enemy, 'sunk'); if (e.code === 'Digit3') this._resolveCapture(player, enemy, 'released');
    };
    addEventListener('keydown', this._keyH);
  }

  _resolveCapture(player, enemy, choice) {
    const g = this.game, st = g.state, sp = this.spoils;
    if (!this.active || !sp) return;   // click + key (or double click) must not pay the spoils twice
    removeEventListener('keydown', this._keyH);
    g.fortune?.takeFinds?.(enemy._finds);   // map piece, item (the specialist is hired with his own button)
    st.gold = (st.gold || 0) + sp.gold;
    // the hold as set in the Transbordement panel (default: best fill); food is provisions (state.food)
    const m = this.manifest || bestFill(makeManifest(st.cargo, st.food, sp.cargo, holdCapacity(g)));
    if (!canValidate(m)) { addEventListener('keydown', this._keyH); return; }
    const own = { ...m.own }; st.food = own.food || 0; delete own.food;
    st.cargo = st.cargo || {};
    for (const k of Object.keys(st.cargo)) st.cargo[k] = 0;
    for (const [k, q] of Object.entries(own)) st.cargo[k] = q;
    const leftCargo = { ...m.prize }, left = Object.values(leftCargo).reduce((a, q) => a + q, 0);
    this.manifest = null;
    const joined = sp.recruits + sp.prisoners;
    if (player) { player.crew = Math.min(player.crewMax * 1.5, player.crew + joined); st.crew = Math.round(player.crew); }
    if (st.plunder != null) st.plunder += Math.round(sp.gold * 0.5);
    let text;
    if (choice === 'captured') {
      st.fleet = st.fleet || [];
      st.fleet.push({ type: enemy.type, name: enemy.name, hull: enemy.hull / enemy.hullMax, sails: Math.max(0, Math.min(1, enemy.sails ?? 1)), from: enemy.faction, crew: 0, upgrades: NO_UPGRADES(), ...(left > 0 ? { cargo: leftCargo } : {}) });   // crew, refits, sails (src/game/fleet.js)
      text = `${theShip(enemy, true)} joins your squadron. ${fmtInt(sp.gold)} gold and ${joined} men aboard.`;
      enemy.crew = 0; g.removeShip(enemy);
    } else if (choice === 'sunk') {
      text = `${theShip(enemy, true)} burns to the waterline. ${fmtInt(sp.gold)} gold seized.`;
      g.combat?.igniteAt?.(enemy, enemy.position.x, 6, enemy.position.z, 1);
      if (g.combat?.startSinking) g.combat.startSinking(enemy); else g.removeShip(enemy);
    } else {
      text = `You let ${theShip(enemy)} go, her hold empty. ${fmtInt(sp.gold)} gold seized.`;
      if (!enemy.struck) g.combat?.strike?.(enemy);
      enemy.crew = Math.max(4, Math.round(enemy.crew * 0.3));
      enemy._plundered = true;
    }
    this.screen.classList.remove('on');
    this._pause(false);
    this.active = false;
    if (left > 0) text += choice === 'captured' ? ` ${fmtInt(left)} lots of goods stay in her hold.` : ` ${fmtInt(left)} lots of goods lost with her.`;
    g.events.emit('notify', { text, kind: 'good' });
    g.events.emit('boarding:end', { result: choice, enemy, spoils: sp });
  }

  // --- Transbordement panel (capture screen) ------------------------------------------------------------------
  _renderTs(fleetFull) {
    const m = this.manifest, box = this.screen.querySelector('[data-ts]');
    if (!m || !box) return;
    const ks = tsRows(m); this._tsKeys = ks;
    this._tsRow = Math.max(0, Math.min(this._tsRow, ks.length - 1));
    const used = bulkOf(m.own), lim = limitOf(m), over = used > lim;
    const unit = (k, q) => (q > 1 ? GOODS[k]?.unitPl : GOODS[k]?.unit) || '';
    const side = (k, q) => q > 0 ? `<b>${fmtInt(q)}</b> <i>${unit(k, q)}</i><em>${fmtInt(valueOf(k, q))} g</em>` : '<span class="nil">—</span>';
    const tot = o => Object.entries(o).reduce((a, [k, q]) => a + valueOf(k, q), 0);
    const btn = (k, dir, n, lbl, t) => `<button data-mv="${dir}" data-k="${k}" data-n="${n}" title="${t}">${lbl}</button>`;
    box.innerHTML = `<div class="ts-hd"><h3>Transshipment</h3>
        <div class="ts-gauge ${over ? 'over' : ''}"><span>Hold</span><div class="hbar"><i style="width:${Math.min(100, used / Math.max(1, m.cap) * 100).toFixed(1)}%"></i></div><b>${fmtInt(used)}/${fmtInt(m.cap)}</b></div>
        <button data-fill title="Load the most valuable goods by volume first">Best fill <span class="kc">R</span></button></div>
      <table class="ts-t"><tr class="hd"><td></td><td>Your hold</td><td class="mv"></td><td>Prize’s hold</td></tr>
      ${ks.map((k, i) => `<tr data-row="${i}" class="${i === this._tsRow ? 'sel' : ''}"><td class="g">${GOOD_ICON(k)}<span>${GOODS[k]?.name || k}</span></td>
        <td class="q">${side(k, m.own[k] || 0)}</td>
        <td class="mv">${btn(k, 'in', 1e9, '«', 'Take all')}${btn(k, 'in', 10, '‹10', 'Take 10')}${btn(k, 'in', 1, '‹', 'Take 1')}<s></s>${btn(k, 'out', 1, '›', 'Leave 1')}${btn(k, 'out', 10, '10›', 'Leave 10')}${btn(k, 'out', 1e9, '»', 'Leave all')}</td>
        <td class="q">${side(k, m.prize[k] || 0)}</td></tr>`).join('')}
      <tr class="tot"><td>Estimated value</td><td class="q"><em>${fmtInt(tot(m.own))} g</em></td><td></td><td class="q"><em>${fmtInt(tot(m.prize))} g</em></td></tr></table>
      <div class="ts-help">↑ ↓ goods · ← take · → leave · Shift ×10 · Ctrl all · Enter confirm${over ? ' · <b class="dn">Hold too full: leave some goods behind to confirm.</b>' : ''}</div>`;
    box.querySelectorAll('[data-mv]').forEach(b => b.onclick = e => { e.stopPropagation(); this._tsRow = ks.indexOf(b.dataset.k); tsMove(m, b.dataset.k, b.dataset.mv, +b.dataset.n); this._renderTs(fleetFull); });
    box.querySelectorAll('tr[data-row]').forEach(r => r.onmouseenter = () => { if (this._tsRow !== +r.dataset.row) { this._tsRow = +r.dataset.row; box.querySelectorAll('tr[data-row]').forEach(x => x.classList.toggle('sel', x === r)); } });
    box.querySelector('[data-fill]').onclick = e => { e.stopPropagation(); bestFill(m); this._renderTs(fleetFull); };
    this.screen.querySelectorAll('button[data-c]').forEach(b => { b.disabled = (b.dataset.c === 'captured' && fleetFull) || over; b.classList.toggle('sel', b.dataset.c === (fleetFull ? 'sunk' : 'captured')); });
  }

  _tsKey(e, fleetFull) {
    const m = this.manifest, ks = this._tsKeys || [];
    if (!m) return false;
    const n = e.ctrlKey || e.metaKey ? 1e9 : e.shiftKey ? 10 : 1;
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') { this._tsRow = (this._tsRow + (e.code === 'ArrowUp' ? -1 : 1) + ks.length) % Math.max(1, ks.length); }
    else if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && ks.length) tsMove(m, ks[this._tsRow], e.code === 'ArrowLeft' ? 'in' : 'out', n);
    else if (isKey(e, 'r') && !e.ctrlKey) bestFill(m);
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); const b = this.screen.querySelector('button[data-c].sel'); if (b && !b.disabled) b.click(); return true; }
    else return false;
    e.preventDefault(); this._renderTs(fleetFull); return true;
  }

  // what the prize carries besides her spoils — a specialist offering his services, a map piece, an item
  _findsHtml(enemy) {
    const f = this.game.fortune?.captureFinds?.(enemy);
    if (!f || (!f.spec && !f.map && !f.item)) return '';
    const rows = [];
    if (f.spec) rows.push(`<div class="f"><span><b>${a(SPECIALISTS[f.spec].name.toLowerCase())}</b> offers his services · <em>${SPECIALISTS[f.spec].effect}</em></span><button data-hire="${f.spec}">Hire · 4</button></div>`);
    if (f.map) rows.push(`<div class="f"><span><b>A piece of a treasure map</b> in the captain’s chest</span></div>`);
    if (f.item) rows.push(`<div class="f"><span><b>${itemName(f.item.cat, f.item.lvl)}</b> in his cabin</span></div>`);
    return `<div class="rule"></div><h3>Aboard</h3><div class="finds">${rows.join('')}</div>`;
  }
  _hire(b) {
    if (this.game.fortune?.hire?.(b.dataset.hire)) { b.disabled = true; b.textContent = 'Hired'; }
  }

  _defeatScreen(player, enemy, res) {
    const how = res?.reason === 'pressed' ? 'Pinned against the mast, a blade at your throat, you surrender.' : res?.reason === 'yield' ? 'You throw down your sword and ask for quarter.' : 'You fall wounded on the deck.';
    this._captivityScreen(player, enemy, { cause: 'boarded', how, fromDuel: true });
  }

  // captivity after a surrender or a lost boarding: prison (nations) or marooning (pirates)
  _captivityScreen(player, captor, { cause = 'struck', how = '', fromDuel = false, noEscape = false } = {}) {
    const g = this.game, st = g.state;
    if (this.active && !fromDuel) { setTimeout(() => this._captivityScreen(player, captor, { cause, how, noEscape }), 500); return; }
    if (!player || player.sinking || player.sunk) { this._captive = false; return; }   // she went down: shipwreck sheet instead
    this.active = true; this._captive = true;
    const C = CAPTIVITY, pirate = !captor || captor.faction === 'pirate';
    const kind = pirate ? 'marooned' : 'prison';
    const capName = captor ? (captor._captain?.name || theShip(captor)) : 'the pirates';
    let days = pirate ? C.maroonDays : Math.round(C.prisonDays[0] + Math.random() * (C.prisonDays[1] - C.prisonDays[0]));
    let goldLost = Math.round((st.gold || 0) * (pirate ? C.maroonGold : C.prisonGold));
    // a nation's prison can be escaped (game.sneak, kind 'escape') in the nearest town of the captor's nation
    const jail = !pirate && g.sneak && !noEscape ? this._prisonTown(player, captor) : null;
    let escapeNote = null;
    const crewLeft = pirate ? Math.min(C.maroonCrew, Math.max(4, player.crew || 0)) : Math.max(6, Math.round((player.crew || 0) * C.prisonCrew));
    const near = pirate ? null : this._nearestFriendlyPort(player);
    const cove = pirate ? this._nearestCove(player) : null;
    const fast = !pirate && this._canEscapeBoat();   // leave prison on a fast lugger
    this._pause(true);
    const lede = cause === 'struck'
      ? `The flag comes down the halyard. ${captor ? (s => s[0].toUpperCase() + s.slice(1))(theShip(captor)) : 'The enemy'} comes alongside and takes possession ${player.name ? ofName(player.name) : 'of your ship'}.`
      : `${how} ${capName} takes possession ${player.name ? ofName(player.name) : 'of your ship'}.`;
    const rows = pirate ? `
        <tr><td>Ship, cargo and guns</td><td class="n">taken</td></tr>
        <tr><td>Gold carried off by the pirates</td><td class="n">${fmtInt(goldLost)}</td></tr>
        <tr><td>Men marooned with you</td><td class="n">${crewLeft}</td></tr>
        <tr><td>Days on the beach</td><td class="n">${days}</td></tr>`
      : `
        <tr><td>Ransom and fine</td><td class="n">${fmtInt(goldLost)}</td></tr>
        <tr><td>Cargo seized</td><td class="n">all</td></tr>
        <tr><td>Men freed with you</td><td class="n">${crewLeft}</td></tr>
        <tr><td>Days in the cells</td><td class="n">${days}</td></tr>`;
    const outro = pirate
      ? 'They put you ashore on a deserted beach with a cask of water and a longboat. From a few wrecks, your men pull out a lugger: small, but the fastest of ships, she crosses the reefs and slips between the hunters.'
      : `Once the ransom is paid, ${player.name ? theName(player.name) : 'your ship'} is handed back to you, plundered and half dismasted${near ? `, at anchor off ${near.name}` : ''}.${fast ? ' You may also leave her with the squadron and slip away on a lugger, the fastest of ships, discreet until her first gunshot.' : ''}`;
    this.screen.innerHTML = `<div class="board-sheet">
      <h2>${pirate ? 'Marooned on an island!' : 'Prisoner!'}</h2>
      <div class="sub">${lede}</div>
      <div class="rule"></div>
      <table>${rows}</table>
      <div class="rule"></div>
      <div class="sub">${outro}</div>
      <div class="choices">${fast ? '<button data-c="fast">Slip away on a lugger</button>' : ''}<button data-c="ok">${pirate ? 'Put to sea again' : 'Regain your freedom'}</button>${jail ? `<button data-c="escape" title="Infiltration: reach the quay unseen">Attempt an escape</button>` : ''}</div>
      ${jail ? `<div class="sub">${g.fortune?.fx?.lockpick ? `Your ${g.fortune.fx.lockpick >= 2 ? 'lockpicking kit' : 'skeleton key'} was not found when they searched you.` : 'A failed escape lengthens the sentence.'}</div>` : ''}
    </div>`;
    this.screen.classList.add('on');
    const done = (o = {}) => {
      if (!this.active) return;
      removeEventListener('keydown', this._keyH);
      if (o.days != null) days = o.days;
      if (o.goldLost != null) goldLost = o.goldLost;
      st.gold = Math.max(0, (st.gold || 0) - goldLost);
      if (st.cargo) for (const k of Object.keys(st.cargo)) st.cargo[k] = 0;
      st.wounds = (st.wounds || 0) + (fromDuel ? 1 : 0);
      if (captor?.alive && captor.struck === false && captor.ai?.setTarget) captor.ai.setTarget(null);
      if (captor?.alive && fromDuel) { captor.struck = false; captor.ai?.setTarget?.(null); }
      let p = player, escNote = null;
      if (pirate) {
        // the escape boat (a lugger, 22/10 — it used to be a sloop) off the cove, a handful of men, the old hull, its
        // refits and the squadron lost
        st.fleet = [];
        const np = this._escapeBoat(p, cove?.anchorPoint || null, crewLeft, null);
        np.hull = np.hullMax * 0.8; np.sails = 0.85;
        p = np;
      } else if (o.fast) {
        // the battered ship is laid up in the squadron at the port, the captain slips away on a lugger
        const np = this._escapeBoat(p, near, crewLeft, { hull: Math.max(0.4, p.hull / (p.hullMax || 1)), sails: Math.max(0.5, p.sails ?? 1) });
        escNote = this._escapeNote(np, player.name);
        p = np;
      } else {
        p.struck = false; p.alive = true; p.repairing = false;
        p.crew = Math.min(p.crewMax, crewLeft); p.hull = Math.max(p.hull, p.hullMax * 0.4); p.sails = Math.max(p.sails, 0.5);
        if (p.fires) for (let i = p.fires.length - 1; i >= 0; i--) g.combat?._extinguish?.(p, p.fires[i]);
        p.speed = 0; p.sailSetting = 0; p.desiredHeading = null;
        p.model.setFlag?.(p.faction);
        if (o.at && p.teleport) p.teleport(o.at.harborPoint.x + o.at.seaward.x * 260, o.at.harborPoint.z + o.at.seaward.z * 260);   // slipped out of the harbour
        else if (near && p.teleport) p.teleport(near.harborPoint.x, near.harborPoint.z);
      }
      st.crew = p.crew;
      if (p.controller) { p.controller.sailStep = 0; p.controller.timeCompression = false; }
      g.timeScale = 1;
      // the fight is over: nobody keeps hunting the freed captain
      for (const o of g.ships) if (o.ai?.target === player || o.ai?.target === p) o.ai.setTarget?.(null);
      g.career?.advanceDays?.(days);
      this.screen.classList.remove('on');
      this._pause(false);
      this.active = false; this._captive = false;
      g.cameraRig?.follow?.(p);
      saveGame(g, 'captivity');
      g.events.emit('notify', { text: pirate ? `After ${days} days on the beach, you put to sea again aboard ${theName(p.name)}, a lugger. Discreet until your first gunshot.` : escapeNote || `Freed after ${days} days in the cells. ${fmtInt(goldLost)} gold lost.${escNote ? ' ' + escNote[0].toUpperCase() + escNote.slice(1) : ''}`, kind: o.escaped ? 'good' : 'bad' });
      g.events.emit('player:captured', { kind, captor, goldLost, days });
      if (fromDuel) g.events.emit('boarding:end', { result: 'defeat', enemy: captor, penalty: { goldLost }, port: near });
    };
    this.screen.querySelector('button[data-c="ok"]').onclick = () => done();
    const fbtn = this.screen.querySelector('button[data-c="fast"]'); if (fbtn) fbtn.onclick = () => done({ fast: true });
    const esc = this.screen.querySelector('button[data-c="escape"]');
    if (esc) esc.onclick = () => {
      // escape attempt — success: no ransom, a few days lost, the ship slips out of that harbour;
      // failure: retaken, the sentence is lengthened (SNEAK.failMul, failDays)
      removeEventListener('keydown', this._keyH);
      this.screen.classList.remove('on');
      g.sneak.start({ kind: 'escape', port: jail, onEnd: (r) => {
        const S = SNEAK_TUNING;
        if (r.outcome === 'success') {
          const d = Math.round(S.escapeDays[0] + Math.random() * (S.escapeDays[1] - S.escapeDays[0]));
          escapeNote = `Escaped! After ${d} days in the cells, you find your ship at anchor off ${jail.name} and slip away without paying a ransom.`;
          done({ days: d, goldLost: 0, at: jail, escaped: true });
        } else {
          const d = Math.round(days * S.failMul + S.failDays);
          escapeNote = `Caught again, you serve a longer sentence: ${d} days in the cells. ${fmtInt(goldLost)} gold lost.`;
          done({ days: d });
        }
      } });
    };
    this._keyH = e => { if (e.code === 'Enter' || e.code === 'Space') done(fast ? { fast: true } : {}); };
    addEventListener('keydown', this._keyH);
  }

  // can the captain leave on the escape boat, keeping the old ship in the squadron?
  _canEscapeBoat() {
    const st = this.game.state;
    return (st.shipType || this.game.player?.type) !== ESCAPE_SHIP.type && ensureFleet(st).length < FLEET.max;
  }
  // the escape boat (ESCAPE_SHIP) replaces the flagship at `at` (a port: its harbour, heading out to sea) with up to its
  // berths of `crew` men; `old` = { hull, sails } (0–1) lays the old ship up in the squadron with its refits and the men
  // who do not fit aboard; null = the old ship is lost (marooned)
  _escapeBoat(p, at, crew, old) {
    const g = this.game, st = g.state, E = ESCAPE_SHIP, T = SHIP_TYPES[E.type];
    const fleet = ensureFleet(st);
    if (old && fleet.length < FLEET.max) fleet.push({ type: st.shipType || p.type, name: p.name, hull: Math.max(0.05, Math.min(1, old.hull)),
      sails: Math.max(0, Math.min(1, old.sails)), from: p.faction, own: true, crew: Math.max(0, crew - T.crew), upgrades: { ...NO_UPGRADES(), ...(st.upgrades || {}) }, cargo: {} });
    const taken = new Set([p.name, ...fleet.map(f => f.name)]);
    const pool = E.names.filter(n => !taken.has(n)), name = pool[Math.floor(Math.random() * pool.length)] || E.names[0];
    const x = at?.harborPoint ? at.harborPoint.x : at?.x ?? p.position.x, z = at?.harborPoint ? at.harborPoint.z : at?.z ?? p.position.z;
    const heading = at?.seaward ? Math.atan2(at.seaward.x, -at.seaward.z) : p.heading;
    const men = Math.max(4, Math.min(T.crew, crew));
    const Ctl = p.controller?.constructor;
    const np = g.spawnShip({ type: E.type, faction: p.faction, isPlayer: true, x, z, heading, name, sailSetting: 0, crew: men });
    np.crew = men; np.hull = np.hullMax; np.sails = 1;
    np.discreetUntil = (g.time || 0) + E.discreetS; np.discreetR = E.discreetR;
    if (Ctl) np.controller = new Ctl(g, np);
    g.removeShip(p); g.player = np;
    st.shipType = E.type; st.upgrades = NO_UPGRADES(); st.crew = np.crew;
    return np;
  }
  _escapeNote(np, laid) {
    return `${laid ? `${theName(laid, true)} joins the squadron (shipyard); ` : ''}you slip away on ${theName(np.name)}, a lugger that crosses the reefs and outruns the hunters. Discreet until your first gunshot: hostile ships only notice her within ${ESCAPE_SHIP.discreetR} m.`;
  }

  // the town whose prison holds the captain (nearest port of the captor's nation)
  _prisonTown(player, captor) {
    const ports = (this.game.islands?.ports || []).filter(p => !p.haven && p.faction === captor?.faction);
    if (!ports.length || !player) return null;
    return ports.map(p => ({ p, d: Math.hypot(p.x - player.position.x, p.z - player.position.z) })).sort((a, b) => a.d - b.d)[0].p;
  }

  _nearestCove(player) {
    let best = null, bd = Infinity;
    for (const c of this.game.islands?.coves || []) {
      const d = Math.hypot(c.anchorPoint.x - player.position.x, c.anchorPoint.z - player.position.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  _shipwreckScreen(player) {
    const g = this.game, st = g.state;
    if (this.active) { setTimeout(() => this._shipwreckScreen(player), 500); return; }
    this.active = true;
    const near = this._nearestFriendlyPort(player);
    const goldLost = Math.round((st.gold || 0) * 0.5);
    const crewLeft = Math.max(8, Math.round((player.crewMax || player.crew || 20) * 0.3));
    const fast = this._canEscapeBoat();   // leave on a fast lugger, the old ship refloated and sent to the squadron
    this._pause(true);
    this.screen.innerHTML = `<div class="board-sheet">
      <h2>Shipwreck!</h2>
      <div class="sub">The ship sinks beneath your feet. Clinging to the wreckage, the survivors are picked up by a passing fisherman.</div>
      <div class="rule"></div>
      <table>
        <tr><td>Gold lost with the ship</td><td class="n">${fmtInt(goldLost)}</td></tr>
        <tr><td>Cargo lost</td><td class="n">all</td></tr>
        <tr><td>Survivors</td><td class="n">${crewLeft}</td></tr>
        <tr><td>Ashore</td><td class="n">a month</td></tr>
      </table>
      <div class="rule"></div>
      <div class="sub">${near ? `At ${near.name}, you gather a tired hull and a skeleton crew.` : 'You gather a tired hull and a skeleton crew.'}</div>
      ${fast ? `<div class="sub">Or else slip away on a lugger, the fastest of ships: she crosses the reefs, outruns the hunters and stays discreet until her first gunshot. ${player.name ? theName(player.name, true) : 'Your ship'}, refloated, will wait with the squadron.</div>` : ''}
      <div class="choices">${fast ? '<button data-c="fast">Slip away on a lugger</button>' : ''}<button data-c="ok">${fast ? 'Refloat your ship' : 'Put to sea again'}</button></div>
    </div>`;
    this.screen.classList.add('on');
    const done = (choice) => {
      removeEventListener('keydown', this._keyH);
      st.gold = Math.max(0, (st.gold || 0) - goldLost);
      if (st.cargo) for (const k of Object.keys(st.cargo)) st.cargo[k] = 0;
      st.wounds = (st.wounds || 0) + 1;
      if (choice === 'fast') {
        const np = this._escapeBoat(player, near, crewLeft, { hull: 0.5, sails: 0.6 });
        g.career?.advanceDays?.(30);
        this.screen.classList.remove('on');
        this._pause(false);
        this.active = false; this._wrecked = false;
        g.cameraRig?.follow?.(np);
        saveGame(g, 'shipwreck');
        g.events.emit('notify', { text: `Shipwrecked${near ? `, you put to sea again from ${near.name}` : ''}: ${this._escapeNote(np, player.name)}`, kind: 'info' });
        g.events.emit('player:shipwrecked', { port: near, goldLost, escapeBoat: true });
        return;
      }
      // refloat the player's ship as a fresh, under-manned hull
      const p = player;
      p.sunk = false; p.sinking = false; p.alive = true; p.struck = false;
      p.sinkT = 0; p._sinkY = 0; p._sinkRoll = 0; p._sinkPitch = 0; p.listing = 0;
      p.hull = p.hullMax * 0.6; if (p.sailsMax != null) p.sails = p.sailsMax; else p.sails = 1;
      p.crew = Math.min(p.crewMax || crewLeft, crewLeft); st.crew = p.crew;
      if (p.fires) for (let i = p.fires.length - 1; i >= 0; i--) g.combat?._extinguish?.(p, p.fires[i]);
      p.speed = 0; p.sailSetting = 0; p.desiredHeading = null;
      p.model.group.visible = true;
      p.model.forceDamage?.(null); p.model.setDamage?.({ hull: 0.4, sails: 0 });
      p.model.setFlag?.(p.faction);
      if (near && p.teleport) p.teleport(near.harborPoint.x, near.harborPoint.z);
      g.career?.advanceDays?.(30);
      this.screen.classList.remove('on');
      this._pause(false);
      this.active = false; this._wrecked = false;
      g.cameraRig?.follow?.(p);
      saveGame(g, 'shipwreck');
      g.events.emit('notify', { text: near ? `Shipwrecked, you put to sea again from ${near.name}.` : 'Shipwrecked, you put to sea again.', kind: 'bad' });
      g.events.emit('player:shipwrecked', { port: near, goldLost });
    };
    this.screen.querySelector('button[data-c="ok"]').onclick = () => done('ok');
    const fb = this.screen.querySelector('button[data-c="fast"]'); if (fb) fb.onclick = () => done('fast');
    this._keyH = e => { if (e.code === 'Enter' || e.code === 'Space') done(fast ? 'fast' : 'ok'); };
    addEventListener('keydown', this._keyH);
  }

  _nearestFriendlyPort(player) {
    const ports = this.game.islands?.ports || [];
    if (!player) return ports[0];
    let best = null, bd = Infinity;
    for (const p of ports) {
      const hostile = this.game.combat?.isHostile ? false : false;
      const friendly = p.faction === player.faction || p.haven || !hostile;
      const d = Math.hypot(p.x - player.position.x, p.z - player.position.z) * (p.faction === player.faction || p.haven ? 1 : 1.6);
      if (friendly && d < bd) { bd = d; best = p; }
    }
    return best;
  }
}
