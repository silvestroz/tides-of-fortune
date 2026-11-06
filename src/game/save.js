// Save / load to localStorage (all access wrapped in try/catch; works without storage).
// API:
//   saveInfo() -> { name, date, gold, port } | null
//   saveGame(game, reason?) -> bool      serialises game.state + the player ship (type, name, faction, pos, hull, sails, crew)
//   loadGame(game) -> bool               restores state, respawns the player ship (keeps its controller class)
//   installSaveHooks(game)               autosave on 'port:enter' / 'port:leave', and enables the title menu's
//                                        "Continue" button by wrapping hud.menu._render (no edit to menu.js) and
//                                        catching its click in the capture phase.
// Emits 'game:saved' {reason}, 'game:loaded' {}.
import { gunSpeedF } from './transship.js';   // jettisoned guns (hold, I key)
const KEY = 'tof.save.v1';

function store() { try { return window.localStorage; } catch { return null; } }

export function saveInfo() {
  try { const d = JSON.parse(store()?.getItem(KEY) || 'null'); return d ? d.info : null; } catch { return null; }
}

export function saveGame(game, reason = 'manual') {
  const p = game.player;
  const data = {
    v: 1, at: Date.now(),
    state: game.state,
    ship: p ? { type: p.type, name: p.name, faction: p.faction, x: p.position.x, z: p.position.z, heading: p.heading, hull: p.hull, sails: p.sails, crew: p.crew } : null,
    timeOfDay: game.sky?.timeOfDay,
    info: { name: game.state.name, date: { ...game.state.date }, gold: game.state.gold, port: game.state.lastPortName || null, ship: p?.name },
  };
  try { store()?.setItem(KEY, JSON.stringify(data)); game.events.emit('game:saved', { reason }); return true; }
  catch (e) { return false; }
}

export const NO_UPGRADES = () => ({ guns: 0, hull: 0, hold: 0, sheath: 0, canvas: 0, berths: 0 });
// Apply refit multipliers to a ship instance (idempotent: derived from spec + levels).
// withHull: also rebuild hullMax from spec (fresh ship on load); otherwise hullMax is grown incrementally by upgrade().
export function applyUpgrades(ship, up = {}, withHull = false) {
  if (!ship) return;
  const s = ship.spec;
  if (withHull && up.hull) ship.hullMax = Math.round(s.hull * Math.pow(1.1, up.hull));
  ship.gunPower = 1 + (up.guns || 0) * 0.15;
  ship.turnMul = 1 + (up.sheath || 0) * 0.15;
  ship.speedMul = (1 + (up.canvas || 0) * 0.06) * gunSpeedF(up.gunsLost, s.guns);   // jettisoned guns (I)
  ship.guns = Math.max(0, (s.guns || 0) - (up.gunsLost || 0));
  ship.crewMax = Math.round(s.crewMax * (1 + (up.berths || 0) * 0.1));
}

export function loadGame(game) {
  let d;
  try { d = JSON.parse(store()?.getItem(KEY) || 'null'); } catch { d = null; }
  if (!d?.state) return false;
  // keep object identity of game.state (other systems may hold it)
  for (const k of Object.keys(game.state)) delete game.state[k];
  Object.assign(game.state, d.state);
  if (game.worldMap) game.worldMap.track = game.state.mapTrack ||= [];   // world map holds a reference to the track array
  const sh = d.ship;
  if (sh) {
    let p = game.player;
    const C = p?.controller?.constructor;
    const np = game.spawnShip({ type: sh.type, faction: sh.faction, isPlayer: true, x: sh.x, z: sh.z, heading: sh.heading, name: sh.name, crew: sh.crew });
    // re-apply shipyard refits (they live on the ship instance, which is rebuilt here)
    const up = game.state.upgrades || {};
    applyUpgrades(np, up, true);
    np.hull = Math.min(np.hullMax, sh.hull ?? np.hullMax); np.sails = sh.sails ?? 1; np.crew = sh.crew ?? np.crew;
    if (C) np.controller = new C(game, np);
    if (p) game.removeShip(p);
    game.player = np;
    game.cameraRig?.follow?.(np);
  }
  // the hour of the day is part of the save (the calendar turns at the sky's midnight)
  if (d.timeOfDay != null && game.sky?.autoAdvance) { game.sky.setTimeOfDay(d.timeOfDay); if (game.career) game.career._tod = null; }
  game.events.emit('game:loaded', {});
  return true;
}

export const AUTOSAVE_S = 120;
export function installSaveHooks(game) {
  const ev = game.events;
  ev.on('port:leave', () => saveGame(game, 'port'));
  ev.on('village:leave', () => saveGame(game, 'port'));   // fishing villages
  // autosave at sea every AUTOSAVE_S of calm sailing (not in combat, duel, boarding or any mini-game)
  setInterval(() => {
    const p = game.player, rig = game.cameraRig;
    if (game.mode !== 'sail' || !p?.alive || p.sinking || game.duel?.active || game.boarding?.active) return;
    if (rig?.mode === 'tactical' || rig?.engaged || (game.combat?.intensity || 0) > 0.05) return;
    // serialisation and write (synchronous) in an idle gap between two frames rather than in the middle of one
    if (window.requestIdleCallback) requestIdleCallback(() => saveGame(game, 'auto'), { timeout: 2000 }); else saveGame(game, 'auto');
  }, AUTOSAVE_S * 1000);
  const menu = game.hud?.menu;
  if (!menu) return;
  const orig = menu._render.bind(menu);
  menu._render = () => {
    orig();
    if (menu.screen !== 'title') return;
    const b = menu.scr.querySelector('[data-act="continue"]');
    const info = saveInfo();
    if (b && info) {
      b.disabled = false;
      const note = b.querySelector('.note');
      const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      if (note) note.textContent = `${info.name} · ${info.date?.day} ${MONTHS[(info.date?.month || 1) - 1]} ${info.date?.year}${info.port ? ' · ' + info.port : ''}`;
    }
  };
  // the HUD shows the title before this hook is installed (HUD is built before PortSystem): re-render it now,
  // otherwise "Continue" stays disabled on page load even when a save exists
  if (menu.isOpen && menu.screen === 'title') menu._render();
  menu.el.addEventListener('click', e => {
    const b = e.target.closest?.('[data-act="continue"]');
    if (!b || b.disabled) return;
    e.stopPropagation();
    game.audio?.play?.('ui:start');
    if (loadGame(game)) {
      game.mode = 'sail';
      ev.emit('state:change', { from: 'menu', to: 'sail' });
      menu.close();
      game.hud?.notify?.(`Welcome back aboard, Captain ${game.state.name}.`, 'good');
    }
  }, true);
}
