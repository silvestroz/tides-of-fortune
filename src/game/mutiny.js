// Mutiny screen (created by Career: career.mutinyUI). When morale falls below MORALE.mutinyBelow after the
// warning, career.mutiny() sets state.mutinyPending and opens this screen as soon as the captain is at sea and free
// (no duel, boarding, port or mini-game): face the ringleader in a duel on his own deck (game.duel.start,
// setting = the player's ship) or give in. Settings and pure logic: src/data/mutiny.js.
// The world is frozen during the choice (mode 'map', Escape neutralised, HUD hidden); nothing to save apart from
// state.mutinyPending (reopened after a load).
import { ringleader, duelDifficulty, mutinyOutcome } from '../data/mutiny.js';
import { fmtInt, NBSP } from '../core/i18n.js';
// Styles: lb-screen / lb-sheet / lb-choices / lb-tab classes of src/game/landbattle/landbattle.css (loaded by
// game.landBattle and game.sneak). No CSS import here: career.js imports this module and must stay importable in node
// (tools/test-missions.mjs imports career.js in node).

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class MutinyScreen {
  constructor(game, career) {
    this.game = game; this.career = career; this.isOpen = false; this.inDuel = false;
    this.el = document.createElement('div'); this.el.className = 'lb-screen mu-screen';
    (game.uiRoot || document.body).appendChild(this.el);
    this.el.addEventListener('click', e => { const b = e.target.closest?.('button[data-act]'); if (b) this._act(b.dataset.act); });
    // capture: Escape doesn't open the pause menu during the choice; 1 / 2 = the two choices
    addEventListener('keydown', e => {
      if (!this.isOpen) return;
      if (e.code === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); }
      else if (e.code === 'Digit1' || e.code === 'Numpad1') { e.preventDefault(); this._act('duel'); }
      else if (e.code === 'Digit2' || e.code === 'Numpad2') { e.preventDefault(); this._act('yield'); }
    }, true);
  }

  // can the captain receive the delegation now?
  canOpen() {
    const g = this.game;
    return !this.isOpen && !this.inDuel && g.mode === 'sail' && !!g.player && g.player.alive !== false && !g.player.sinking
      && !g.duel?.active && !g.boarding?.active && !g.ports?.isOpen && !g.landBattle?.active && !g.sneak?.active
      && !g.retirement?.isRetired && !g.hud?.menu?.isOpen;
  }

  open() {
    if (!this.canOpen()) return false;
    const g = this.game, s = g.state, p = g.player, d = s.date;
    const L = this.leader = ringleader(d.year * 372 + d.month * 31 + d.day);
    const crew = p.crew, yl = mutinyOutcome('yield', { gold: s.gold, crew }), lo = mutinyOutcome('duel', { gold: s.gold, crew }, false), wo = mutinyOutcome('duel', { gold: s.gold, crew }, true);
    this.isOpen = true;
    this._prev = { frozen: g.frozen, mode: g.mode };
    g.frozen = true; g.mode = 'map'; g.hud?.show?.(false);
    const men = n => `${n}${NBSP}${n > 1 ? 'men' : 'man'}`;
    this.el.innerHTML = `<div class="lb-sheet mu-sheet tof-parch">
      <h2>Mutiny!</h2>
      <div class="sub">At first light, the crew has gathered at the foot of the quarterdeck. ${esc(L.name)}, ${L.post}, steps forward, a cutlass in his belt: “${L.grievance}”</div>
      <table class="lb-tab">
        <tr><td>Give in</td><td class="n">−${fmtInt(yl.gold)} gold · −${men(yl.men)}</td></tr>
        <tr><td>Duel lost</td><td class="n">−${fmtInt(lo.gold)} gold · −${men(lo.men)} · a wound</td></tr>
        <tr><td>Duel won</td><td class="n">revolt quelled · ${wo.men ? `${men(wo.men)} in irons, put ashore at the first port` : 'the ringleader in irons'}</td></tr>
      </table>
      <div class="lb-choices">
        <button class="btn lb-ch" data-act="duel"><b>Face ${esc(L.name)} with the cutlass · 1</b><span>A duel on your own deck, before the whole crew. Win, and you break the revolt and morale rises; lose, and the mutineers carry off more and you keep a wound.</span></button>
        <button class="btn lb-ch" data-act="yield"><b>Give in · 2</b><span>The mutineers take the longboat with their share. The loyal men stay aboard.</span></button>
      </div>
    </div>`;
    this.el.classList.add('on');
    g.audio?.play?.('ui:page');
    return true;
  }

  _close() {
    const g = this.game;
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('on'); this.el.innerHTML = '';
    g.frozen = this._prev?.frozen && g.params?.get('frozen') ? true : false;
    g.mode = 'sail'; g.hud?.show?.(true);
  }

  _act(act) {
    if (!this.isOpen) return;
    const g = this.game, s = g.state, L = this.leader;
    g.audio?.play?.('ui:select');
    this._close();
    s.mutinyPending = false;
    if (act !== 'duel' || !g.duel?.start || !g.player?.model) return this.career._mutinyApply('yield');
    this.inDuel = true;
    const diff = duelDifficulty(s.morale);
    g.duel.start({
      opponent: { name: L.name, faction: 'pirate', difficulty: diff, look: { sailor: true, jacket: false, shirt: '#ddd2b8', sleeves: 'rolled', coat: '#4a3a2a', hat: 'bandana', bandana: '#2f4a6a', sash: '#2f4a6a', expr: 'fierce' } },
      setting: g.player, crewPlayer: 1, crewEnemy: 1, tutorial: false,
      onEnd: (r) => { this.inDuel = false; this.career._mutinyApply('duel', r?.winner === 'player', L); },
    });
    return true;
  }
}

