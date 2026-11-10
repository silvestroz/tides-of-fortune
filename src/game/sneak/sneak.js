// game.sneak: short mode (1–3 min) of sneaking into a hostile port or escaping from prison.
// Simulation: sim.js; rendering: view.js; settings: src/data/sneak.js.
// Trigger:
//   - ports.enter() in a hostile port, when the soldiers would arrest you: “Soldiers guard the quay” screen
//     (offerPort) → “Slip into town” (start kind 'infiltrate'), pay the fine (the old arrest) or leave;
//   - prison screen (boarding._captivityScreen): “Attempt an escape” (start kind 'escape').
// API: offerPort(port, tab) · start({ kind, port, onEnd }) · forceEnd(outcome) · screenOf(x, z)
//      active · sim · view · port · level (0–4, read by the music) · speed (debugging)
// Events: 'sneak:start' { kind, port }, 'sneak:end' { kind, port, result }, 'state:change' { to:'sneak' } / back.
// Game mode 'sneak' meanwhile (world frozen, rendered through renderOverride). Caught → duel against a guard
// (game.duel; tavern set near the tavern, otherwise the rampart at night); won: the guard is knocked out but the
// alarm is raised; lost: prison / longer sentence.
// Fugitive's tools (mnemonic keys, by character): T or left click throws a stone (at the cursor, else ahead),
// H hides in / leaves a doorway, barrels or a haystack, K knocks out a guard from behind; Space picks the grate.
// Loading: the town (view.js, imported on first use) is built when the mode starts, under the loading screen
// (src/ui/townLoader.js), and released when it ends: nothing of it exists at sea.
// Save: nothing mid-mode; optional counter state.sneaks { ok, caught, tries } recreated on the fly (tries: the
// attempt number, which draws the guards' routes and posts again at every attempt).
import { SneakSim } from './sim.js';
import { SNEAK } from '../../data/sneak.js';
import { NATION_COATS } from '../../data/landbattle.js';
import { kc, isKey } from '../../core/keys.js';
import { nationPeople } from '../../core/i18n.js';
import { hashString } from '../../core/rng.js';
import '../landbattle/landbattle.css';
import './sneak.css';
import { openTownLoader, townScope } from '../../ui/townLoader.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LEVELS = ['Unseen', 'Suspicion', 'Wariness', 'Hunted', 'Alarm!'];

export class Sneak {
  constructor(game) {
    this.game = game;
    this.active = false; this.sim = null; this.view = null; this.port = null; this.speed = 1; this.level = 0;
    const root = game.uiRoot || document.body;
    const el = (cls) => { const d = document.createElement('div'); d.className = cls; root.appendChild(d); return d; };
    this.panel = el('lb-screen sn-screen');
    this.hud = el('sn-hud off');
    this.fade = el('lb-fade');
    this._keys = new Set();
    addEventListener('keydown', e => this._key(e), true);
    addEventListener('keyup', e => { if (this.active) this._keys.delete(e.code); }, true);
    addEventListener('blur', () => this._keys.clear());
    addEventListener('pointermove', e => { if (this.active) this._mouse = { x: e.clientX, y: e.clientY }; }, true);
    addEventListener('pointerdown', e => {
      if (!this.active || this._fighting || e.button !== 0 || e.target?.closest?.('button, .lb-screen')) return;
      this._mouse = { x: e.clientX, y: e.clientY }; this._throw();
    }, true);
  }

  // ------------------------------------------------------------------ choice at the entrance of a hostile port
  offerPort(port, tab) {
    const g = this.game, lv = g.living, t = lv?.town?.(port) || { garrison: 60 };
    const dz = g.fortune?.fx?.disguise || 0;
    const fine = Math.min(g.state.gold || 0, Math.round(200 + (g.state.gold || 0) * 0.15));
    this._panel(`<h2>Soldiers guard the quay</h2>
      <div class="sub">At ${esc(port.name)}, the ${nationPeople(port.faction)} have your description. Garrison: ${t.garrison} men.</div>
      <div class="lb-choices">
        <button class="btn lb-ch" data-act="sneak"><b>Slip into town</b><span>A longboat sets you down at the end of the quay at nightfall. Reach the tavern or the governor’s palace without being caught${dz ? ` (your disguise fools the guards’ eyes)` : ''}.</span></button>
        <button class="btn lb-ch" data-act="fine"><b>Present yourself to the soldiers</b><span>They seize you; ${fine} gold buys your freedom.</span></button>
      </div>
      <div class="actions"><button class="btn" data-act="leave">Sail away</button></div>`, act => {
      this._closePanel();
      if (act === 'sneak') this.start({ kind: 'infiltrate', port, tab });
      else if (act === 'fine') g.ports?.enter(port, tab, { fate: 'arrest' });
    });
  }
  _panel(html, onAct) {
    this.panel.innerHTML = `<div class="lb-sheet tof-parch">${html}</div>`;
    this.panel.classList.add('on'); this._onAct = onAct;
    this._panelFrozen ??= this.game.frozen; this.game.frozen = true;
    this.panel.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => { this.game.audio?.play?.('ui:click'); onAct(b.dataset.act, b); });
  }
  _closePanel() {
    this.panel.classList.remove('on'); this.panel.innerHTML = ''; this._onAct = null;
    if (!this.active && this._panelFrozen !== undefined) { this.game.frozen = this._panelFrozen; this._panelFrozen = undefined; }
  }

  // ------------------------------------------------------------------ partie
  async start({ kind = 'infiltrate', port, tab = null, onEnd = null } = {}) {
    const g = this.game;
    if (this.active) return;
    port ||= g.islands?.ports?.find(p => !p.haven);
    if (!port) return;
    const town = g.living?.town?.(port) || { garrison: 60 };
    const seed = (hashString(port.id + ':' + kind) % 100000) + 1;
    const fx = g.fortune?.fx || {}, sn = g.state.sneaks ||= { ok: 0, caught: 0 };
    sn.tries = (sn.tries || 0) + 1;
    const patrolSeed = (hashString(`${port.id}:${kind}:${sn.tries}`) % 100000) + 1;
    this.port = port; this.kind = kind; this.tab = tab; this.onEnd = onEnd;
    this.sim = new SneakSim({ seed, patrolSeed, kind, garrison: town.garrison, disguise: fx.disguise || 0, lockpick: fx.lockpick || 0 });
    this._mouse = null;
    this.active = true; this.level = 0; this._fighting = false; this._ending = false; this._giveUpT = 0;
    this._prevMode = g.mode; this._prevFrozen = this._panelFrozen ?? g.frozen; this._panelFrozen = undefined;
    this._prevHud = g.hud?.visible;
    const L = openTownLoader(g, { mode: kind, title: port.name });
    g.frozen = true; g.renderOverride = () => {};   // nothing drawn behind the loading screen
    this._scope = townScope(g);
    await L.step();
    const { SneakView } = await import('./view.js');
    this.view = await new SneakView(g).build(this.sim, { coat: NATION_COATS[port.faction] || '#555', nation: port.faction, seed }, L.step);
    this.view.update(this.sim, 0);   // the figures in place (and visible) before their programs are compiled
    await L.compile(this.view.scene, this.view.camera);
    this.view.render();   // one frame under the loading screen: the shadow-map variants (skinned figures) compile now
    g.mode = 'sneak'; g.frozen = true;
    g.hud?.show?.(false);
    g.events.emit('state:change', { from: this._prevMode || 'sail', to: 'sneak' });
    g.events.emit('sneak:start', { kind, port });
    this._last = performance.now();
    g.renderOverride = () => this._frame();
    this._buildHud();
    L.close();
    const lp = this.sim.lockpick;
    this._toast(kind === 'escape'
      ? (lp ? `Your ${lp >= 2 ? 'lockpicking kit' : 'skeleton key'} is in your boot. Pick the lock of the grille (Space).` : 'A bent pin to pick the lock of the grille (Space)… this will take a while.')
      : `Reach the tavern or the palace without being seen. Keep to the shadows, away from the lanterns.`);
  }

  _frame() {
    const now = performance.now(), dt = Math.min(0.1, (now - this._last) / 1000); this._last = now;
    const sim = this.sim, v = this.view; if (!sim || !v) return;
    const k = this._keys;
    let x = 0, z = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) z += 1; if (k.has('KeyS') || k.has('ArrowDown')) z -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x += 1; if (k.has('KeyD') || k.has('ArrowRight')) x -= 1;   // x toward the left of the screen
    if (!this._scripted) sim.input = { x, z, run: k.has('ShiftLeft') || k.has('ShiftRight'), act: k.has('Space') };
    if (!this._fighting && !sim.over) {
      const steps = Math.max(1, Math.round(this.speed));
      for (let s = 0; s < steps; s++) for (const e of sim.step(dt * this.speed / steps)) this._onEvent(e);
    }
    this.level = sim.level;
    v.update(sim, this._fighting ? 0 : dt);
    v.render();
    this._updateHud();
  }

  _onEvent(e) {
    const g = this.game;
    if (e.type === 'level') {
      if (e.to > e.from && e.to < 4) g.audio?.play?.('ui:click');
      if (e.to === 3 && e.from < 3) this._toast(`You have been spotted! Vanish into the shadows.`);
    } else if (e.type === 'alarm') { g.audio?.play?.('bell', { volume: 1.1 }); this._toast(`Alarm! The whole guard is on your heels.`); }
    else if (e.type === 'calm') this._toast('The guard loses your trail.');
    else if (e.type === 'lock') g.audio?.play?.('ui:click', { volume: 0.5 });
    else if (e.type === 'unlocked') { g.audio?.play?.('ui:page'); this._toast(`The grille gives way! Make for the quay.`); }
    else if (e.type === 'stone') { g.audio?.play?.('ui:click', { volume: 0.35 }); this.view?.throwStone(e); }
    else if (e.type === 'landed') { g.audio?.play?.('ui:click', { volume: 0.6 }); this.view?.ping(e.x, e.z); if (e.guard) this._toast('A guard goes to see what made that noise.'); }
    else if (e.type === 'hide') { if (e.on) this._toast('Hidden. Only a guard searching right here would find you.'); }
    else if (e.type === 'ko') { g.audio?.play?.('ui:page', { volume: 0.8 }); this._toast('The guard slumps without a sound. If his comrades find him, they will sound the alarm.'); }
    else if (e.type === 'body') this._toast('A guard has found his comrade knocked out!');
    else if (e.type === 'barred') this._toast(this.kind === 'escape' ? 'The longboat is watched while the alarm rings: lose the guards first.' : 'The door is barred while the alarm rings: lose the guards first.');
    else if (e.type === 'fail') {
      const why = { none: 'No stones left.', nohide: 'No hiding place within reach (doorways, barrels, haystacks).', facing: 'He would see you coming: strike from behind.', noone: 'No guard within reach.' }[e.why];
      if (why) this._toast(why);
    }
    else if (e.type === 'caught') this._caught(e.guard);
    else if (e.type === 'goal') setTimeout(() => this._end({ outcome: 'success', goal: e.goal.id }), 350);
  }

  // caught: a quick duel against the guard (the duel sim), then carry on or fail
  async _caught(guard) {
    const g = this.game;
    if (this._fighting) return;
    this._fighting = true;
    this._toast(`A guard is on you!`);
    await new Promise(r => setTimeout(r, 700));
    if (!this.active) return;
    let won;
    if (g.duel?.start && !this._noDuel) {
      await this._fadeTo(true);
      g.renderOverride = null; this.hud.classList.add('off');
      const fz = g.frozen; g.frozen = false;
      const town = g.living?.town?.(this.port) || { garrison: 60 };
      // duel set: caught near the tavern → the tavern room, otherwise the rampart at night
      const pl = this.sim?.player, tav = this.kind !== 'escape' && this.sim?.goals?.find(q => q.id === 'tavern');
      const scene = pl && tav && Math.hypot(pl.x - tav.x, pl.z - tav.z) < 22 ? 'tavern' : 'rampart';
      const res = await new Promise(res => {
        g.duel.start({ opponent: { name: `Sergeant of the ${this.port.name} guard`, faction: this.port.faction, difficulty: Math.min(0.62, 0.36 + town.garrison / 400) },
          setting: { scene, faction: this.port.faction }, crewPlayer: 1, crewEnemy: 1, weapon: g.state.duelWeapon || 'cutlass', tutorial: false, intro: false, onEnd: res });
        this._fadeTo(false);
      });
      await this._fadeTo(true);
      g.frozen = fz; g.mode = 'sneak'; g.hud?.show?.(false);
      g.renderOverride = () => this._frame(); this._last = performance.now();
      this.hud.classList.remove('off');
      this._fadeTo(false);
      won = res?.winner === 'player';
    } else won = Math.random() < 0.5;
    if (!this.active) return;
    this._fighting = false;
    if (won) {
      this.sim.knockOut(guard);
      for (const e of this.sim.raiseAlarm()) this._onEvent(e);
      this._toast(`The guard is down… but the alarm is raised!`);
    } else this._end({ outcome: 'caught' });
  }

  forceEnd(outcome = 'success') {
    if (!this.sim || this._ending) return;
    this.sim.forceEnd(outcome);
    this._end({ outcome, goal: outcome === 'success' ? this.sim.result.goal : null });
  }

  async _end(result) {
    const g = this.game;
    if (this._ending || !this.active) return;
    this._ending = true;
    const port = this.port, kind = this.kind, onEnd = this.onEnd;
    result = { ...result, time: this.sim.time, alarms: this.sim.stats.alarms };
    g.state.sneaks ||= { ok: 0, caught: 0 };
    g.state.sneaks[result.outcome === 'success' ? 'ok' : 'caught']++;
    if (result.outcome === 'success') g.audio?._sting?.('victory', true);
    await this._fadeTo(true);
    this._teardown();
    g.events.emit('sneak:end', { kind, port, result });
    if (kind === 'infiltrate') {
      if (result.outcome === 'success') {
        g.ports?.enter(port, result.goal === 'governor' ? 'governor' : 'tavern', { fate: 'sneaked' });
        g.events.emit('notify', { text: result.goal === 'governor' ? `Here you are in the antechamber of the governor of ${port.name}.` : `You push open the door of the ${port.name} tavern without anyone looking up.`, kind: 'good' });
      } else {
        g.boarding?._captivityScreen?.(g.player, { faction: port.faction, _captain: { name: `the guard of ${port.name}` }, alive: false }, { cause: 'sneak', how: `Caught in the back streets of ${port.name}.` });
      }
    }
    try { onEnd?.(result); } catch (err) { console.error(err); }
    this._fadeTo(false);
  }

  _teardown() {
    const g = this.game;
    this.active = false;
    if (g.renderOverride) g.renderOverride = null;
    this._scope?.end(); this._scope = null;   // before the dispose: the town's programs go with its materials
    this.view?.dispose(); this.view = null;
    this.hud.classList.add('off'); this.hud.innerHTML = '';
    g.mode = this._prevMode === 'sneak' ? 'sail' : (this._prevMode || 'sail');
    g.frozen = !!this._prevFrozen;
    if (g.mode === 'sail') g.hud?.show?.(true);
    if (g.player) { g.player.speed = 0; g.cameraRig?.follow?.(g.player); }
    g.events.emit('state:change', { from: 'sneak', to: g.mode });
    this.sim = null; this._keys.clear(); this.level = 0; this._scripted = false; this.speed = 1;
  }

  // ------------------------------------------------------------------ interface
  _buildHud() {
    const sim = this.sim, esc_ = this.kind === 'escape';
    this.hud.classList.remove('off');
    this.hud.innerHTML = `
      <div class="sn-top tof-parch"><b>${esc_ ? 'Escape' : 'Infiltration'} · ${esc(this.port.name)}</b>
        <div class="sn-gauge"><i></i><s style="left:${SNEAK.levels[0]}%"></s><s style="left:${SNEAK.levels[1]}%"></s><s style="left:${SNEAK.levels[2]}%"></s></div><span class="sn-lvl"></span></div>
      <div class="sn-goal tof-parch"></div>
      <div class="sn-lock"><i></i></div>
      <div class="sn-tools tof-parch"><span class="sn-stones"></span></div>
      <div class="lb-help tof-parch">${kc('KeyW')}${kc('KeyA')}${kc('KeyS')}${kc('KeyD')} move · <span class="kc">Shift</span> run (noisy) · ${kc('KeyT')} or click: throw a stone · ${kc('KeyH')} hide · ${kc('KeyK')} knock out from behind · ${esc_ ? `${kc('Space')} pick the lock · ` : ''}${kc('KeyR')}${kc('KeyR')} surrender</div>
      <div class="sn-marks"></div><div class="sn-ctx"></div><div class="lb-toast"></div>`;
    this._ctx = this.hud.querySelector('.sn-ctx');
    this._marks = [];
    const box = this.hud.querySelector('.sn-marks');
    for (let i = 0; i < sim.guards.length; i++) { const d = document.createElement('div'); d.className = 'sn-mark'; box.appendChild(d); this._marks.push(d); }
    this._goalEls = sim.goals.map(gl => { const d = document.createElement('div'); d.className = 'sn-goalmark'; d.textContent = gl.id === 'quay' ? 'Quay' : gl.id === 'tavern' ? 'Tavern' : 'Governor'; box.appendChild(d); return d; });
  }
  _updateHud() {
    const s = this.sim, h = this.hud; if (!s || !h.firstChild || !this.view) return;
    const L = s.level;
    h.querySelector('.sn-gauge i').style.width = `${s.gauge.toFixed(1)}%`;
    h.querySelector('.sn-gauge').dataset.l = L;
    const lv = h.querySelector('.sn-lvl'); lv.textContent = LEVELS[L]; lv.dataset.l = L;
    const gl = h.querySelector('.sn-goal');
    gl.textContent = !s.map.gate.open ? (s.nearGate ? `Hold Space to pick the lock of the grille` : 'Go to the courtyard grille')
      : this.kind === 'escape' ? 'Reach the longboat at the quay' : 'Reach the tavern or the governor’s palace';
    const lk = h.querySelector('.sn-lock');
    lk.classList.toggle('on', !s.map.gate.open && s.lockT > 0);
    lk.firstChild.style.width = `${Math.min(100, s.lockT / s.lockTime * 100)}%`;
    s.guards.forEach((g, i) => {
      const m = this._marks[i]; if (!m) return;
      const t = g.down ? '' : s.alarm || g.state === 'chase' ? '!!' : g.state === 'investigate' ? '!' : g.state === 'look' || g.state === 'lured' ? '?' : '';
      if (!t) { m.style.display = 'none'; return; }
      const p = this.view.project(g.x, g.z, 3.6);
      m.style.display = ''; m.textContent = t; m.dataset.l = t.length;
      m.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px)`;
    });
    this.hud.querySelector('.sn-stones').innerHTML = `Stones <b>${'●'.repeat(s.stones)}${'○'.repeat(Math.max(0, SNEAK.tools.stones - s.stones))}</b>${s.player.hidden ? ' · <i>hidden</i>' : ''}`;
    // contextual prompt under the captain
    const ctx = s.player.hidden ? `${kc('KeyH')} leave the hiding place` : s.koTarget() ? `${kc('KeyK')} knock him out` : s.nearHide() ? `${kc('KeyH')} hide` : '';
    if (ctx !== this._ctxHtml) { this._ctxHtml = ctx; this._ctx.innerHTML = ctx; this._ctx.style.display = ctx ? 'block' : 'none'; }
    if (ctx) { const p = this.view.project(s.player.x, s.player.z, 0); this._ctx.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px)`; }
    s.goals.forEach((g, i) => { const p = this.view.project(g.x, g.z, 2.5), e = this._goalEls[i]; e.style.transform = `translate(${Math.max(64, Math.min(innerWidth - 64, p.x)).toFixed(0)}px, ${Math.max(70, Math.min(innerHeight - 60, p.y)).toFixed(0)}px)`; });
  }
  // stone: at the cursor when the mouse is on the town, otherwise ahead of the captain
  _throw() {
    const s = this.sim, p = s?.player; if (!p || this._fighting) return;
    const at = this._mouse && this.view?.pick(this._mouse.x, this._mouse.y);
    const e = s.throwStone(at ? at.x : p.x + Math.sin(p.heading) * 10, at ? at.z : p.z + Math.cos(p.heading) * 10);
    if (e.why !== 'cooldown') this._onEvent(e);
  }
  _toast(text) {
    const t = this.hud.querySelector('.lb-toast'); if (!t) return;
    t.textContent = text; t.classList.remove('on'); void t.offsetWidth; t.classList.add('on');
  }
  _fadeTo(on) { this.fade.classList.toggle('on', on); return new Promise(r => setTimeout(r, on ? 450 : 0)); }
  screenOf(x, z) { return this.view ? this.view.project(x, z) : null; }

  _key(e) {
    if (e.target?.tagName === 'INPUT') return;
    if (!this.active) {
      if (this.panel.classList.contains('on') && e.code === 'Escape') { e.stopImmediatePropagation(); this._onAct?.('leave'); this._closePanel(); }
      return;
    }
    if (this._fighting) return;   // the duel reads its own keys
    e.stopImmediatePropagation();
    if (e.code !== 'F12' && e.code !== 'F3' && e.code !== 'F5') e.preventDefault();
    this._keys.add(e.code);
    if (e.repeat) return;
    const sim = this.sim;
    if (isKey(e, 't')) this._throw();
    else if (isKey(e, 'h')) this._onEvent(sim.toggleHide());
    else if (isKey(e, 'k')) this._onEvent(sim.tryKnockOut());
    else if (isKey(e, 'r')) {
      const now = performance.now();
      if (now - this._giveUpT < 3000) this._end({ outcome: 'caught', surrendered: true });
      else { this._giveUpT = now; this._toast(`Surrender? Press R again.`); }
    }
  }
}
