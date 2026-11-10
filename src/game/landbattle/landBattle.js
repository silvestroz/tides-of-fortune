// Town assaults. game.landBattle: attack on an enemy town, a real-time tactical land battle (2–4 min) and its
// aftermath (plunder, governor, prison). Simulation: sim.js; rendering: view.js; sounds and officers' orders:
// feedback.js; settings: src/data/landbattle.js.
// Trigger (at sea, mode 'sail'):
//   - within 400 m of a port of another nation: “V Attack the town” prompt → choice of an assault from the sea
//     (the fort fires first: hull and men lost, but fewer defenders and a landing at the foot of the town) or a
//     landing further off (no fire from the fort, a longer march);
//   - at the pirate haven: “V Organise an attack” → choice of a nearby enemy town, reinforcement of
//     freebooters (LAND.haven.bonus × crew), voyage and landing.
// API: offer(port) · start(port, { approach:'sea'|'land', allies }) · forceEnd(winner) · screenOf(x, z)
//      active · sim · view · port · speed (time multiplier, debugging)
// Events: 'landbattle:start' { port, approach }, 'landbattle:end' { port, result, choice }, 'state:change'
//   { from:'sail', to:'land' } then { from:'land', to:'sail' }. Game mode 'land' during the battle.
// Loading: the battlefield (view.js, imported on first use) is built when the battle starts, under the loading
// screen (src/ui/townLoader.js), and released when it ends: nothing of it exists at sea.
// Save: nothing mid-battle; the aftermath goes through state.gold/crew, state.towns (living.assaulted) and
//   state.landBattles { won, lost } (missing from old saves: recreated on the fly).
import { LandSim, T } from './sim.js';
import { LandFeedback } from './feedback.js';
import { LAND, UNIT_KINDS, NATION_COATS } from '../../data/landbattle.js';
import { kc, isKey } from '../../core/keys.js';
import { NATIONS } from '../career.js';
import { getReputation, changeReputation, relation } from '../../combat/factions.js';
import { a, nationAdj, nationPeople, fmtInt, NBSP } from '../../core/i18n.js';
import { saveGame } from '../save.js';
import { hashString } from '../../core/rng.js';
import './landbattle.css';
import { openTownLoader, townScope } from '../../ui/townLoader.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class LandBattle {
  constructor(game) {
    this.game = game;
    this.active = false; this.sim = null; this.view = null; this.port = null; this.speed = 1;
    this.sel = new Set(); this.paused = false;
    const root = game.uiRoot || document.body;
    const el = (cls, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; root.appendChild(d); return d; };
    this.prompt = el('lb-prompt tof-parch off');
    this.panel = el('lb-screen');
    this.hud = el('lb-hud off');
    this.box = el('lb-box');
    this.fade = el('lb-fade');
    addEventListener('keydown', e => this._key(e), true);
    addEventListener('keyup', e => { if (this.active) this._keys.delete(e.code); }, true);
    this._keys = new Set();
    const cv = game.renderer.domElement;
    cv.addEventListener('mousedown', e => this._mouseDown(e));
    addEventListener('mousemove', e => this._mouseMove(e));
    addEventListener('mouseup', e => this._mouseUp(e));
    cv.addEventListener('contextmenu', e => { if (this.active) e.preventDefault(); });
    cv.addEventListener('wheel', e => { if (this.active && this.view) this.view.cam.dist *= e.deltaY > 0 ? 1.1 : 0.9; }, { passive: true });
    game.events.on('state:change', ({ to } = {}) => { if (to !== 'sail') this._showPrompt(null); });
  }

  // ------------------------------------------------------------------ prompt at sea
  _target() {
    const g = this.game, p = g.player;
    if (!p || g.mode !== 'sail' || this.active || this.panel.classList.contains('on') || g.boarding?.active || g.duel?.active) return null;
    const np = g.islands?.nearestPort?.(p.position.x, p.position.z);
    if (!np?.port || np.dist >= 400) return null;
    const port = np.port;
    if (port.haven) return this._havenTargets(port).length ? { port, haven: true } : null;
    if (port.faction === p.faction) return null;
    return { port, haven: false };
  }
  update() {
    if (this.active) return;
    this._pt = (this._pt || 0) - 1;
    if (this._pt > 0) return; this._pt = 10;
    this._showPrompt(this._target());
  }
  _showPrompt(t) {
    const k = t ? `${t.port.id}:${t.haven}` : '';
    if (k === this._promptK) return; this._promptK = k;
    this.prompt.classList.toggle('off', !t);
    if (t) this.prompt.innerHTML = `${kc('KeyV', 'key')}<span>${t.haven ? 'Organise an attack from the haven' : `Attack <b>${esc(t.port.name)}</b>`}</span>`;
  }

  _havenTargets(haven) {
    const g = this.game, pf = g.player?.faction;
    return (g.islands?.ports || []).filter(q => !q.haven && q.faction !== pf && NATIONS.includes(q.faction))
      .map(q => ({ port: q, d: Math.hypot(q.x - haven.x, q.z - haven.z) })).filter(o => o.d < LAND.haven.maxDist)
      .sort((a, b) => a.d - b.d).slice(0, 3);
  }

  // ------------------------------------------------------------------ choix
  offer(port) {
    const g = this.game, lv = g.living;
    if (!port) return;
    const crew = Math.round((g.player?.crew ?? g.state.crew ?? 0) * (1 - LAND.shipGuard));
    if (port.haven) {
      const list = this._havenTargets(port), bonus = Math.round(crew * LAND.haven.bonus);
      this._panel(`<h2>The council of the Brethren of the Coast</h2>
        <div class="sub">“A fat, poorly guarded town? ${fmtInt(bonus)} freebooters from the haven will march with you, for their share of the plunder.”</div>
        <div class="lb-choices">${list.map((o, i) => `<button class="btn lb-ch" data-act="haven" data-i="${i}">
          <b>${esc(o.port.name)}</b> <i>(${nationAdj(o.port.faction)})</i><span>${this._townLine(o.port)} · ${Math.max(1, Math.round(o.d / 1000))}${NBSP}leagues · ${Math.max(1, Math.ceil(o.d / 1800))}${NBSP}days at sea</span></button>`).join('')}</div>
        <div class="actions"><button class="btn" data-act="cancel">Give up</button></div>`, (act, b) => {
        if (act === 'haven') { const o = list[+b.dataset.i]; this._closePanel(); this._sailTo(o.port, Math.max(1, Math.ceil(o.d / 1800))); this.start(o.port, { approach: 'land', allies: bonus }); }
        else this._closePanel();
      });
      return;
    }
    const t = lv?.town(port) || { garrison: 50 };
    const atWar = g.player?.faction && g.player.faction !== 'pirate' && relation(g.player.faction, port.faction) < 0;
    this._panel(`<h2>Attack ${esc(port.name)}</h2>
      <div class="sub">${this._townLine(port)} · your men fit to fight: ${fmtInt(crew)}</div>
      ${atWar ? '' : `<p class="warn">The ${nationPeople(port.faction)} are not at war with your flag: this attack will make them hate you.</p>`}
      <div class="lb-choices">
        <button class="btn lb-ch" data-act="sea"><b>Assault from the sea</b><span>The fort opens fire on the ship before the landing at the foot of the town. Fewer defenders ashore, but hull and men pay a price.</span></button>
        <button class="btn lb-ch" data-act="land"><b>Land out of the way</b><span>The longboats touch a beach out of range of the fort. The whole garrison awaits you, and the march is longer.</span></button>
      </div>
      <div class="actions"><button class="btn" data-act="cancel">Give up</button></div>`, (act) => {
      this._closePanel();
      if (act === 'sea') { this._bombard(port, t.garrison); this.start(port, { approach: 'sea' }); }
      else if (act === 'land') this.start(port, { approach: 'land' });
    });
  }
  _townLine(port) {
    const lv = this.game.living, t = lv?.town(port) || { garrison: 50 }, w = lv?.wealth?.(port) ?? 3;
    return `garrison ${fmtInt(t.garrison)} men · wealth ${'●'.repeat(w)}${'○'.repeat(Math.max(0, 5 - w))}`;
  }
  _panel(html, onAct) {
    this.panel.innerHTML = `<div class="lb-sheet tof-parch">${html}</div>`;
    this.panel.classList.add('on');
    this._wasFrozen ??= this.game.frozen; this.game.frozen = true;
    this.panel.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => { this.game.audio?.play?.('ui:click'); onAct(b.dataset.act, b); });
  }
  _closePanel() {
    this.panel.classList.remove('on'); this.panel.innerHTML = '';
    if (!this.active && this._wasFrozen !== undefined) { this.game.frozen = this._wasFrozen; this._wasFrozen = undefined; }
  }

  _sailTo(port, days) {
    const g = this.game, p = g.player, hp = port.harborPoint;
    if (p && hp) { const hd = Math.atan2(port.seaward.x, -port.seaward.z) + Math.PI; if (p.teleport) p.teleport(hp.x + port.seaward.x * 200, hp.z + port.seaward.z * 200, hd); p.speed = 0; }
    g.career?.advanceDays?.(days, false);
  }

  // assault from the sea: the fort fires first (hull and crew losses by garrison and your guns)
  _bombard(port, garrison) {
    const g = this.game, p = g.player; if (!p) return;
    const guns = p.guns ?? 16, f = 0.7 + Math.random() * 0.6;
    const hullF = Math.min(0.45, garrison * LAND.sea.hullPerGarrison / 100 / (1 + guns / 30) * f);
    const lost = Math.min(Math.max(0, p.crew - 8), Math.round(garrison * LAND.sea.crewPerGarrison * f));
    p.hull = Math.max(p.hullMax * 0.12, p.hull - p.hullMax * hullF); p.crew -= lost; g.state.crew = p.crew;
    g.audio?.play?.('cannon', { volume: 1.2 });
    this._seaNote = `The fort of ${port.name} has fired on you: hull −${Math.round(hullF * 100)}%, ${lost} men lost.`;
  }

  // ------------------------------------------------------------------ bataille
  async start(port, { approach = 'land', allies = 0 } = {}) {
    const g = this.game, lv = g.living, p = g.player;
    if (this.active || !port) return;
    const town = lv?.town(port) || { garrison: 50 };
    const crew = p?.crew ?? g.state.crew ?? 40;
    this.guard = Math.max(2, Math.round(crew * LAND.shipGuard));
    const force = Math.max(6, crew - this.guard);
    const seed = (hashString ? hashString(port.id + ':' + (g.state.date?.day || 0)) : 7) >>> 0;
    this.port = port; this.approach = approach; this.allies = allies;
    this.sim = new LandSim({ heights: this._sample(port), seed: seed % 100000 + 1, playerForce: force, garrison: town.garrison, nation: port.faction, approach, allies });
    this.active = true; this.paused = false; this.speed = this.speed || 1; this.sel.clear(); this._retreatT = 0;
    this._prevMode = g.mode; this._prevFrozen = this._wasFrozen ?? g.frozen; this._wasFrozen = undefined;
    this._showPrompt(null);
    const L = openTownLoader(g, { mode: approach === 'sea' ? 'sea' : 'land', title: port.name });
    g.frozen = true; g.renderOverride = () => {};   // nothing drawn behind the loading screen
    this._scope = townScope(g);
    await L.step();
    const { LandView } = await import('./view.js');
    const pf = p?.faction || 'pirate', ships = [p?.type || 'brig', ...(g.state.fleet || []).map(f => f.type)];
    this.view = await new LandView(g).build(this.sim, { coat: NATION_COATS[port.faction] || '#555', playerCoat: NATION_COATS[pf] || NATION_COATS.pirate, seed, nation: port.faction, playerFaction: pf, ships }, L.step);
    await L.compile(this.view.scene, this.view.camera);
    g.mode = 'land'; g.frozen = true;
    g.hud?.show?.(false);
    g.events.emit('state:change', { from: this._prevMode || 'sail', to: 'land' });
    g.events.emit('landbattle:start', { port, approach });
    this._last = performance.now();
    g.renderOverride = () => this._frame();
    this._buildHud();
    for (const u of this.sim.units) if (u.side === 'player' && u.kind !== 'officiers') this.sel.add(u);
    L.close();
    const msg = (this._seaNote ? this._seaNote + ' ' : '') + (allies ? `${allies} freebooters from the haven land with you. ` : '') + 'Take the square or rout the garrison.';
    this._seaNote = null;
    g.events.emit('notify', { text: msg, kind: 'info' });
    this._toast(msg);
  }

  // samples the island's relief behind the town: x = the port's lateral axis, z = depth inland
  // (flipped: the tactical map keeps the beach at the bottom, the town at the top; only the shape of the relief is kept)
  _sample(port) {
    const isl = this.game.islands; if (!isl?.getTerrainHeight) return null;
    const { W, H, cell } = LAND, tc = port.townCenter || port, s = port.seaward || { x: 0, z: 1 }, l = port.lateral || { x: -s.z, z: s.x };
    const out = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const a = (i + 0.5) * cell - W * cell / 2, d = 30 + (H - j - 0.5) * cell * 0.9;   // the top of the map touches the town, the bottom climbs inland
      out[j * W + i] = isl.getTerrainHeight(tc.x + l.x * a - s.x * d, tc.z + l.z * a - s.z * d);
    }
    return out;
  }

  _frame() {
    const now = performance.now(), dt = Math.min(0.1, (now - this._last) / 1000); this._last = now;
    const sim = this.sim, v = this.view; if (!sim || !v) return;
    // camera: ZQSD (physical positions) or arrows, A/E to rotate
    const k = this._keys, c = v.cam, sp = c.dist * 1.1 * dt;
    let fx = 0, fz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) fz += 1; if (k.has('KeyS') || k.has('ArrowDown')) fz -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) fx += 1; if (k.has('KeyD') || k.has('ArrowRight')) fx -= 1;
    if (k.has('KeyQ')) c.yaw += dt * 1.2; if (k.has('KeyE')) c.yaw -= dt * 1.2;
    c.x += (Math.sin(c.yaw) * fz + Math.cos(c.yaw) * fx) * sp; c.z += (Math.cos(c.yaw) * fz - Math.sin(c.yaw) * fx) * sp;
    if (!this.paused && !sim.over) {
      const steps = Math.max(1, Math.round(this.speed));
      for (let s = 0; s < steps; s++) for (const e of sim.step(dt * this.speed / steps)) this._onEvent(e);
    }
    v.update(sim, this.paused ? 0 : dt, this.sel, u => u.side === 'player' || sim.visible(u, 'player'));
    v.render();
    this.fx?.frame(this.paused ? 0 : dt, sim, v);
    this._updateHud();
    this.game.audio?.music && (this.game.audio.combat = Math.max(this.game.audio.combat || 0, 0.7));
  }

  _onEvent(e) {
    const v = this.view;
    this.fx?.event(e, this.sim, v);
    if (e.type === 'volley') v.volley(e.unit);
    else if (e.type === 'melee') v.clash(e.x, e.z);
    else if (e.type === 'rout') this._toast(e.unit.side === 'player' ? `Your ${UNIT_KINDS[e.unit.kind].name.toLowerCase()} are giving way!` : `${UNIT_KINDS[e.unit.kind].name}: they are running!`);
    else if (e.type === 'rally') this._toast(`${UNIT_KINDS[e.unit.kind].name} rallied around the officers.`);
    else if (e.type === 'end') setTimeout(() => this._outcome(e.result), 900);
    if (e.unit && (e.type === 'destroyed' || e.type === 'fled')) this.sel.delete(e.unit);
  }

  forceEnd(winner = 'player') {
    const s = this.sim; if (!s || s.over) return;
    for (const u of s.units) if (u.side !== winner) { u.dead = (u.dead || 0) + Math.ceil(u.n * 0.5); u.n = Math.floor(u.n * 0.5); u.state = 'rout'; u.morale = 0; }
    s.time = Math.max(s.time, 1);
    for (const e of s.step(0.01)) this._onEvent(e);
    if (!s.over) { s.over = true; s.result = { winner, reason: 'forced', time: s.time, playerLost: 0, enemyLost: 0, playerLeft: s._men('player'), enemyLeft: s._men('enemy') }; this._onEvent({ type: 'end', result: s.result }); }
  }

  // ------------------------------------------------------------------ issue
  _outcome(res) {
    const g = this.game, port = this.port, lv = g.living, st = g.state, p = g.player;
    const allyLeft = this.allies ? Math.round(this.allies * res.playerLeft / Math.max(1, this.sim.startMen.player)) : 0;
    const back = Math.max(0, res.playerLeft - allyLeft);
    const crewNow = this.guard + back;
    if (p) p.crew = Math.max(4, Math.min(p.crewMax || crewNow, crewNow)); st.crew = p?.crew ?? crewNow;
    st.landBattles ||= { won: 0, lost: 0 };
    const lost = Math.max(0, (this.guard + this.sim.startMen.player - this.allies) - crewNow);
    if (res.winner === 'player') {
      st.landBattles.won++;
      const w = lv?.wealth?.(port) ?? 3, t = lv?.town(port) || { prosper: 1 };
      const P = LAND.pillage, gold = Math.round((P.base + P.perWealth * w) * (t.prosper || 1) * (1 - P.jitter + Math.random() * P.jitter * 2) * (this.allies ? 0.75 : 1) / 10) * 10;
      st.gold += gold;
      g.audio?._sting?.('victory', true);
      const others = NATIONS.filter(n => n !== port.faction && getReputation(g, n) >= 0);
      this._panel(`<h2>${esc(port.name)} is yours!</h2>
        <div class="sub">${res.reason === 'square' ? 'Your men hold the parade ground; the garrison has thrown down its arms.' : 'The garrison is routed.'}</div>
        <table class="lb-tab"><tr><td>Plunder of the treasury and warehouses</td><td class="n">${fmtInt(gold)} gold</td></tr>
        <tr><td>Men lost</td><td class="n">${fmtInt(lost)}</td></tr><tr><td>Enemy losses</td><td class="n">${fmtInt(res.enemyLost)}</td></tr>
        ${this.allies ? `<tr><td>Share left to the haven’s freebooters</td><td class="n">25%</td></tr>` : ''}</table>
        <div class="lb-choices">
          <button class="btn lb-ch" data-act="keep"><b>Raise the plunder and re-embark</b><span>The town stays ${nationAdj(port.faction)}, ruined and without a garrison. The ${nationPeople(port.faction)} will not forget it.</span></button>
          ${others.map(n => `<button class="btn lb-ch" data-act="gov" data-n="${n}"><b>Install ${a(nationAdj(n))} governor</b><span>The town goes to the ${nationPeople(n)}: reputation and merit with them, hatred from the ${nationPeople(port.faction)}.</span></button>`).join('')}
        </div>`, (act, b) => this._finish(res, act === 'gov' ? b.dataset.n : null, gold));
    } else {
      st.landBattles.lost++;
      g.audio?._sting?.('defeat', true);
      const caught = res.reason === 'rout' && Math.random() < LAND.prison && p;
      this._panel(`<h2>The assault is beaten back</h2>
        <div class="sub">${res.reason === 'time' ? 'The garrison held out until reinforcements arrived. Your men re-embark.' : caught ? 'Your men fall back to the longboats… and you are caught in the rout.' : 'Your men fall back in disorder to the longboats.'}</div>
        <table class="lb-tab"><tr><td>Men lost</td><td class="n">${fmtInt(lost)}</td></tr><tr><td>Enemy losses</td><td class="n">${fmtInt(res.enemyLost)}</td></tr></table>
        <div class="actions"><button class="btn" data-act="ok">${caught ? 'In irons…' : 'Re-embark'}</button></div>`, () => this._finish(res, null, 0, caught));
    }
  }

  async _finish(res, newNation, gold, caught = false) {
    const g = this.game, port = this.port, lv = g.living, old = port.faction;
    this._closePanel();
    if (res.winner === 'player') {
      lv?.assaulted?.(port, { won: true, newFaction: newNation });
      if (newNation) {
        changeReputation(g, newNation, LAND.rep.newNation, 'town'); changeReputation(g, old, LAND.rep.oldNation, 'town');
        g.career?._merit?.(newNation, LAND.rep.merit);
        lv?.news?.(`${port.name} has fallen: ${a(nationAdj(newNation))} governor is installed there.`, 'town');
      } else {
        changeReputation(g, old, LAND.rep.plunder, 'town');
        lv?.news?.(`${port.name} has been sacked by ${g.state.name || 'a captain'}.`, 'town');
      }
    } else lv?.assaulted?.(port, { won: false, killed: res.enemyLost });
    await this._fadeTo(true);
    this._teardown();
    g.events.emit('landbattle:end', { port, result: res, choice: newNation || (res.winner === 'player' ? 'plunder' : null), gold });
    if (caught) {
      g.boarding?._captivityScreen?.(g.player, { faction: old, _captain: { name: `the garrison of ${port.name}` }, alive: false }, { cause: 'assault', how: `Taken during the assault on ${port.name}.` });
    } else saveGame(g, 'landbattle');
    this._fadeTo(false);
    g.events.emit('notify', { text: res.winner === 'player' ? `${fmtInt(gold)} gold brought back from ${port.name}.` : `Retreat from ${port.name}.`, kind: res.winner === 'player' ? 'good' : 'bad' });
  }

  _teardown() {
    const g = this.game;
    this.active = false;
    if (g.renderOverride) g.renderOverride = null;
    this.fx?.dispose(); this.fx = null;
    this._scope?.end(); this._scope = null;   // before the dispose: the battle's programs go with its materials
    this.view?.dispose(); this.view = null;
    this.hud.classList.add('off'); this.hud.innerHTML = ''; this.box.style.display = 'none';
    g.mode = 'sail'; g.frozen = !!this._prevFrozen && !!g.params.get('frozen');
    g.hud?.show?.(true);
    if (g.player) { g.player.speed = 0; g.cameraRig?.follow?.(g.player); }
    g.events.emit('state:change', { from: 'land', to: 'sail' });
    this.sim = null; this.sel.clear(); this._promptK = null;
  }

  // ------------------------------------------------------------------ battle interface
  _buildHud() {
    const P = this.sim.units.filter(u => u.side === 'player');
    this.hud.classList.remove('off');
    this.hud.innerHTML = `
      <div class="lb-top tof-parch"><b class="lb-town">${esc(this.port.name)}</b><span class="lb-clock"></span><span class="lb-men"></span><span class="lb-goal"></span><div class="lb-hold"><i></i></div></div>
      <div class="lb-cards">${P.map((u, i) => `<div class="lb-card tof-parch" data-id="${u.id}"><span class="kc">${i + 1}</span><b>${UNIT_KINDS[u.kind].name}</b><span class="n"></span><div class="mor"><i></i></div></div>`).join('')}</div>
      <div class="lb-help tof-parch">Left click: select (drag = box) · right click: march / charge · ${kc('KeyW')}${kc('KeyA')}${kc('KeyS')}${kc('KeyD')} camera · ${kc('KeyQ')}${kc('KeyE')} rotate · wheel: zoom · ${kc('KeyT')} all · ${kc('KeyH')} halt · ${kc('Space')} pause · ${kc('KeyR')}${kc('KeyR')} retreat</div>
      <div class="lb-tags"></div><div class="lb-obj"><b></b><i><s></s></i></div><div class="lb-toast"></div><div class="lb-pause">Pause</div>`;
    this.fx = new LandFeedback(this.game, this.hud);   // positional battle sounds, officers' orders
    this.hud.querySelectorAll('.lb-card').forEach(c => c.onclick = e => { const u = this.sim.units.find(x => x.id === +c.dataset.id); if (!u) return; if (!e.shiftKey) this.sel.clear(); this.sel.add(u); });
    this._tags = new Map();
  }
  _updateHud() {
    const s = this.sim, h = this.hud; if (!s || !h.firstChild) return;
    const left = Math.max(0, LAND.timeLimit - s.time);
    h.querySelector('.lb-clock').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    h.querySelector('.lb-men').textContent = `Your men ${s._men('player')} · garrison ${s.units.filter(u => u.side === 'enemy' && s.alive(u) && u.state !== 'rout').reduce((a, u) => a + u.n, 0)}`;
    h.querySelector('.lb-hold i').style.width = `${Math.min(100, s.hold / LAND.holdTime * 100)}%`;
    h.querySelector('.lb-hold').classList.toggle('on', s.hold > 0);
    // objective: the square, its state and the time it must still be held
    const sq = this.view.squareState, rest = Math.ceil(Math.max(0, LAND.holdTime - s.hold));
    h.querySelector('.lb-goal').textContent = sq === 'held' ? `Holding the square: ${rest} s` : sq === 'contested' ? 'The square is contested' : sq === 'enemy' ? 'The garrison holds the square' : s.hold > 0 ? 'Retake the square!' : 'Take the square';
    const ob = h.querySelector('.lb-obj'), op = this.view.project(s.map.town.x, s.map.town.z, 22);
    ob.style.display = op.behind ? 'none' : ''; ob.style.transform = `translate(${op.x.toFixed(0)}px, ${op.y.toFixed(0)}px)`;
    ob.className = `lb-obj ${sq}`;
    ob.querySelector('b').textContent = sq === 'held' ? `Hold ${rest} s` : 'The square';
    ob.querySelector('s').style.width = `${Math.min(100, s.hold / LAND.holdTime * 100)}%`;
    h.querySelector('.lb-pause').classList.toggle('on', this.paused);
    for (const c of h.querySelectorAll('.lb-card')) {
      const u = s.units.find(x => x.id === +c.dataset.id);
      const alive = u && s.alive(u);
      c.classList.toggle('sel', !!u && this.sel.has(u)); c.classList.toggle('dead', !alive); c.classList.toggle('rout', alive && u.state === 'rout');
      c.querySelector('.n').textContent = alive ? `${u.n}` : '—';
      c.querySelector('.mor i').style.width = `${alive ? u.morale : 0}%`;
    }
    // labels above the companies (strength + morale)
    const box = h.querySelector('.lb-tags'), seen = new Set();
    for (const u of s.units) {
      if (!s.alive(u) || (u.side === 'enemy' && !s.visible(u, 'player'))) continue;
      seen.add(u.id);
      let t = this._tags.get(u.id);
      if (!t) { t = document.createElement('div'); t.className = `lb-tag ${u.side}`; t.innerHTML = '<span></span><i><b></b></i>'; box.appendChild(t); this._tags.set(u.id, t); }
      const p = this.view.project(u.x, u.z, 6);
      t.style.display = p.behind || p.y > innerHeight - 110 || p.y < 50 ? 'none' : '';
      t.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px)`;
      t.firstChild.textContent = `${u.side === 'enemy' ? UNIT_KINDS[u.kind].name + ' ' : ''}${u.n}${u.state === 'rout' ? ' · routed' : ''}`;
      t.querySelector('b').style.width = `${u.morale}%`;
      t.classList.toggle('sel', this.sel.has(u));
    }
    for (const [id, t] of this._tags) if (!seen.has(id)) { t.remove(); this._tags.delete(id); }
  }
  _toast(text) {
    const t = this.hud.querySelector('.lb-toast'); if (!t) return;
    t.textContent = text; t.classList.remove('on'); void t.offsetWidth; t.classList.add('on');
  }
  _fadeTo(on) { this.fade.classList.toggle('on', on); return new Promise(r => setTimeout(r, on ? 450 : 0)); }

  screenOf(x, z) { return this.view ? this.view.project(x, z) : null; }

  // ------------------------------------------------------------------ input
  _key(e) {
    const g = this.game;
    if (e.target?.tagName === 'INPUT') return;
    if (!this.active) {
      if (this.panel.classList.contains('on')) { if (e.code === 'Escape') { e.stopImmediatePropagation(); this._closePanel(); } return; }
      if (isKey(e, 'v') && g.mode === 'sail' && !g.hud?.menu?.isOpen) { const t = this._target(); if (t) { e.stopImmediatePropagation(); e.preventDefault(); this.offer(t.port); } }
      return;
    }
    if (this.panel.classList.contains('on')) return;
    e.stopImmediatePropagation();
    if (e.code !== 'F12' && e.code !== 'F3' && e.code !== 'F5') e.preventDefault();
    this._keys.add(e.code);
    const mine = () => this.sim.units.filter(u => u.side === 'player' && this.sim.alive(u));
    const dg = /^Digit([1-9])$/.exec(e.code);
    if (dg) { const u = this.sim.units.filter(x => x.side === 'player')[+dg[1] - 1]; if (u && this.sim.alive(u)) { if (!e.shiftKey) this.sel.clear(); this.sel.add(u); } }
    else if (isKey(e, 't')) { this.sel = new Set(mine()); }
    else if (isKey(e, 'h')) this.sim.halt([...this.sel]);
    else if (e.code === 'Space') this.paused = !this.paused;
    else if (e.code === 'Escape') this.sel.clear();
    else if (isKey(e, 'r')) {
      const now = performance.now();
      if (now - this._retreatT < 3000) { for (const u of mine()) { u.state = 'rout'; u.path = null; u.target = null; } this._toast(`Sound the retreat! To the longboats!`); }
      else { this._retreatT = now; this._toast(`Retreat? Press R again.`); }
    }
  }
  _ndc(e) { return { x: e.clientX / innerWidth * 2 - 1, y: -(e.clientY / innerHeight) * 2 + 1 }; }
  _mouseDown(e) {
    if (!this.active || !this.view || this.panel.classList.contains('on')) return;
    if (e.button === 0) { this._drag = { x: e.clientX, y: e.clientY, shift: e.shiftKey }; }
    else if (e.button === 2) {
      const pt = this.view.pick(this._ndc(e).x, this._ndc(e).y); if (!pt) return;
      const units = [...this.sel].filter(u => this.sim.alive(u));
      if (!units.length) return;
      const tgt = this.sim.order(units, pt.x, pt.z);
      this.view.order(pt.x, pt.z, tgt);
      this.fx?.order(units, tgt, this.sim, this.view);
      this.game.audio?.play?.('ui:click');
      this._toast(tgt ? `Attack: ${UNIT_KINDS[tgt.kind].name.toLowerCase()}!` : this.sim.cellAt(pt.x, pt.z) === T.WOOD ? 'Into the cover of the woods.' : this.sim.cellAt(pt.x, pt.z) === T.HILL ? 'Take the high ground.' : 'Forward, march.');
    }
  }
  _mouseMove(e) {
    const d = this._drag; if (!d || !this.active) return;
    const x0 = Math.min(d.x, e.clientX), y0 = Math.min(d.y, e.clientY), w = Math.abs(e.clientX - d.x), h = Math.abs(e.clientY - d.y);
    if (w + h > 8) Object.assign(this.box.style, { display: 'block', left: x0 + 'px', top: y0 + 'px', width: w + 'px', height: h + 'px' });
  }
  _mouseUp(e) {
    const d = this._drag; this._drag = null; this.box.style.display = 'none';
    if (!d || !this.active || e.button !== 0) return;
    const mine = this.sim.units.filter(u => u.side === 'player' && this.sim.alive(u));
    if (!d.shift) this.sel.clear();
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 8) {
      const x0 = Math.min(d.x, e.clientX), x1 = Math.max(d.x, e.clientX), y0 = Math.min(d.y, e.clientY), y1 = Math.max(d.y, e.clientY);
      for (const u of mine) { const p = this.view.project(u.x, u.z, 1); if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) this.sel.add(u); }
    } else {
      let best = null, bd = 40;
      for (const u of mine) { const p = this.view.project(u.x, u.z, 1); const dd = Math.hypot(p.x - e.clientX, p.y - e.clientY); if (dd < bd) { bd = dd; best = u; } }
      if (best) this.sel.add(best);
    }
  }
}
