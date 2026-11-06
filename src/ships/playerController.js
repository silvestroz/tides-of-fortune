// PlayerController(game, ship) — keyboard/mouse → ship fields. API: update(dt), sailStep (0|1|2), timeCompression (bool).
// Controls:
//   A/D or ←/→   rudder (smoothly ramps; release centres the helm)
//   W/S or ↑/↓   sail orders in 3 steps: 0 furled / 1 battle sails (0.5) / 2 full sail (1.0)
//   Q / E        fire port / starboard broadside: game.combat.fireBroadside(ship, side, ship.ammo)
//   Space        fire the side facing the nearest enemy (enemy = other living, un-struck ship of another faction
//                or ship.hostile === true, pirates, or game.state.atWar[faction]); falls back to the side the camera looks at in broadside-aim mode
//   1 / 2 / 3    ammo round / chain / grape (ship.ammo)
//   T            time compression game.timeScale 1 ↔ 4 (refused while an enemy is within 400 m; auto-drops to 1 if one closes in)
//   R            emergency repairs on/off (combat.toggleRepair): heave to — sails furled (step 0) — and the work only
//                goes on below 1 knot; making sail (W/↑) or firing a broadside (Q/E/Space) interrupts it. Enemies
//                nearby never block R. Slow, crew-dependent, slower reload meanwhile.
//   I            the hold at sea (game.hold, src/ui/holdScreen.js): jettison goods / provisions, world frozen meanwhile
//   X X          strike the colours (surrender to the nearest enemy within 700 m; confirm within 3 s)
//   C            cycle camera mode (chase / broadside / tactical) — handled by cameraRig.cycleMode()
//   G            “Assisted” mode (game.state.assist): fire at will ↔ cease fire (this.holdFire); broadsides
//                go off by themselves at the engaged enemy (src/ships/autoFire.js); manual fire stays possible
//   Mouse right-drag orbit, wheel zoom — handled by CameraRig.
// Emits 'notify' for sail orders / ammo / time compression and 'player:sail' { step } / 'player:ammo' { ammo }.
import { wrapAngle } from '../core/constants.js';
import { autoFire } from './autoFire.js';   // “Assisted” mode
import { isAssist } from '../data/assist.js';
import { keyLabel } from '../core/keys.js';

export const SAIL_STEPS = [0, 0.5, 1];
const SAIL_NAMES = ['Sails furled', 'Fighting sail', 'Full sail'];
const AMMO = { Digit1: 'round', Digit2: 'chain', Digit3: 'grape', Numpad1: 'round', Numpad2: 'chain', Numpad3: 'grape' };
const AMMO_LOCKED = { chain: 'Chain shot', grape: 'Grapeshot' };
const AMMO_NAMES = { round: 'Round shot loaded', chain: 'Chain shot loaded', grape: 'Grapeshot loaded' };
export const COMPRESSION_SAFE_DIST = 400;

// Key bindings. Position commands by KeyboardEvent.code; `keys` = mnemonic commands by character
// (input.pressedKey): ZQSD + arrows, A/E, Space, 1-2-3 of the main row and the numpad, B R I X T C G.
//   left/right/up/down: helm and sail · port/star: broadsides · near: broadside toward the nearest enemy
//   ammo { code: 'round'|'chain'|'grape' } · strike/repair: { codes, keys }
const KEYMAP = {
  left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
  port: ['KeyQ'], star: ['KeyE'], near: ['Space'], ammo: AMMO,
  strike: { codes: [], keys: ['x'] }, repair: { codes: [], keys: ['r'] },
};

export class PlayerController {
  constructor(game, ship) {
    this.game = game; this.ship = ship; this.keymap = KEYMAP;
    this.sailStep = ship.sailSetting >= 0.75 ? 2 : ship.sailSetting >= 0.25 ? 1 : 0;
    ship.sailSetting = SAIL_STEPS[this.sailStep];
    this.helm = 0;
    this.timeCompression = false;
    this._checkT = 0;
  }

  notify(text, kind = 'info') { this.game.events.emit('notify', { text, kind }); }

  isEnemy(o) {
    const s = this.ship;
    if (o === s || !o.alive || o.struck || o.sinking) return false;
    if (o.hostile === true || o.hostileTo?.has?.(s)) return true;
    if (o.hostile === false) return false;
    if (o.faction === s.faction) return false;
    return o.faction === 'pirate' || s.faction === 'pirate' || this.game.state?.atWar?.[o.faction] === true;
  }

  nearestEnemy(maxDist = Infinity) {
    let best = null, bd = maxDist * maxDist;
    const p = this.ship.position;
    for (const o of this.game.ships) {
      if (!this.isEnemy(o)) continue;
      const d = (o.position.x - p.x) ** 2 + (o.position.z - p.z) ** 2;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  sideFacing(target) {
    const s = this.ship;
    const b = Math.atan2(target.position.x - s.position.x, -(target.position.z - s.position.z));
    return wrapAngle(b - s.heading) < 0 ? 'port' : 'starboard';
  }

  fire(side) {
    const s = this.ship;
    if (!s.alive || s.struck) return;
    this.game.combat?.fireBroadside?.(s, side, s.ammo);
  }

  // “Assisted” mode: G toggles fire at will (autonomous gun crews) and cease fire (manual fire)
  toggleAutoFire() {
    const g = this.game;
    if (!isAssist(g.state)) { this.notify('Automatic fire: “Assisted” game mode (Options)'); return; }
    this.holdFire = !this.holdFire;
    this.notify(this.holdFire ? 'Cease fire! Firing by hand (G: fire at will)' : 'Fire at will! The gunners fire on their own', this.holdFire ? 'info' : 'good');
    g.events.emit('assist:fire-mode', { hold: !!this.holdFire });
  }

  // opts.quiet: no “Sails …” toast (R furls the sails and says so itself)
  setSailStep(step, { quiet = false } = {}) {
    step = Math.max(0, Math.min(2, step));
    if (step === this.sailStep) return;
    if (step > 0 && this.ship.repairing) this.game.combat?.stopRepair?.(this.ship, 'sail');   // making sail ends repairs
    this.sailStep = step;
    this.ship.sailSetting = SAIL_STEPS[step];
    if (!quiet) this.notify(SAIL_NAMES[step]);
    this.game.events.emit('player:sail', { step });
  }

  setTimeCompression(on) {
    const g = this.game;
    if (on && this.nearestEnemy(COMPRESSION_SAFE_DIST)) { this.notify('Enemy sails too close to hurry time', 'bad'); on = false; }
    if (on === this.timeCompression) return;
    this.timeCompression = on;
    g.timeScale = on ? 4 : 1;
    this.notify(on ? 'Time sped up ×4' : 'Normal time');
  }

  // X twice within 3 s: strike the colours to the nearest enemy (boarding.js then shows the captivity sheet)
  askStrike() {
    const s = this.ship, g = this.game, now = performance.now();
    if (s.struck || s.sinking) return;
    if (!this.nearestEnemy(700)) { this.notify('No enemy to surrender to'); return; }
    if (now - (this._strikeAsk || -1e9) < 3000) { this._strikeAsk = 0; g.combat?.strike?.(s); return; }
    this._strikeAsk = now;
    const k = this.keymap.strike.keys[0]?.toUpperCase() || keyLabel(this.keymap.strike.codes[0]);
    this.notify(`Strike the colours? Press ${k} again to surrender`, 'bad');
  }

  update(dt) {
    const g = this.game, i = g.input, s = this.ship;
    if (!s.alive) return;
    const realDt = dt / (g.timeScale || 1);

    // helm: ramp the wheel rather than snapping (feels like hauling a wheel); fast centring on release
    // integration: helm/sail/gun orders only while actually sailing (menu, port, map, duel and capture screens
    // own the keyboard then — W/S navigate menus, 1-5 pick port tabs, A/D/J/K fence)
    const live = g.mode === 'sail' && !g.hud?.menu?.isOpen && !g.boarding?.active;
    const K = this.keymap, any = codes => codes.some(c => i.down(c)), hit = codes => codes.some(c => i.pressed(c));
    const act = a => hit(a.codes) || a.keys.some(ch => i.pressedKey(ch));
    const r = !live ? 0 : (any(K.right) ? 1 : 0) - (any(K.left) ? 1 : 0);
    const rate = r === 0 ? 3.5 : (Math.sign(r) !== Math.sign(this.helm) && this.helm !== 0 ? 4.5 : 2.2);
    this.helm += Math.max(-rate * realDt, Math.min(rate * realDt, r - this.helm));
    s.rudder = this.helm;
    if (r !== 0) s.desiredHeading = null;
    if (!live) return;

    if (hit(K.up)) this.setSailStep(this.sailStep + 1);
    if (hit(K.down)) this.setSailStep(this.sailStep - 1);

    for (const code in K.ammo) if (i.pressed(code) && s.ammo !== K.ammo[code]) {
      // chain / grape are bought at a shipyard (game.state.ammoUnlocked; absent = old save or scene: all unlocked)
      const lock = g.state?.ammoUnlocked;
      if (K.ammo[code] !== 'round' && lock && !lock[K.ammo[code]]) { this.notify(`${AMMO_LOCKED[K.ammo[code]]}: buy it at the shipyard`, 'bad'); continue; }
      s.ammo = K.ammo[code]; this.notify(AMMO_NAMES[s.ammo]); g.events.emit('player:ammo', { ammo: s.ammo, ship: s });
    }

    if (i.pressedKey?.('b')) g.combat?.requestBoard?.();
    if (hit(K.port)) this.fire('port');
    if (hit(K.star)) this.fire('starboard');
    if (hit(K.near)) {
      const e = this.nearestEnemy(1500);
      const rig = g.cameraRig;
      const side = e ? this.sideFacing(e) : (rig?.mode === 'broadside' ? rig.aimSide : null);
      if (side) this.fire(side); else this.notify('No target in sight');
    }

    if (act(K.repair)) g.combat?.toggleRepair?.(s);
    if (act(K.strike)) this.askStrike();
    if (i.pressedKey('i')) g.hold?.open?.();   // the hold (jettison goods)
    if (i.pressedKey('t')) this.setTimeCompression(!this.timeCompression);
    if (i.pressedKey('c')) g.cameraRig?.cycleMode?.();
    if (i.pressedKey('g')) this.toggleAutoFire();
    // “Assisted” mode: automatic broadsides at the engaged enemy
    if (autoFire(g, s, this).length && !g.state.assistTold) {
      g.state.assistTold = true;
      this.notify('Your gunners fire on their own at the engaged enemy (G: cease fire)', 'info');
    }

    // auto-drop compression when an enemy closes in (checked 4×/s)
    this._checkT -= realDt;
    if (this.timeCompression && this._checkT <= 0) {
      this._checkT = 0.25;
      if (this.nearestEnemy(COMPRESSION_SAFE_DIST)) { this.setTimeCompression(false); this.notify('Sail ho! Time back to normal', 'bad'); }
    }
  }
}
