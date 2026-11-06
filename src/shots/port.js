// Showcase: the port screen at Havana. ?tab=market|tavern|shipyard|governor|bank  (?port=<id> for another port)
//   shipyard extras: &fleet=N  a squadron of N prizes (1–7) ; &ship=<type>  that type picked on the slipway
//   (shown at the quay) ; &ship=fleet:<i>  ship i of the squadron shown at the quay
import { PlayerController } from '../ships/playerController.js';

export async function setup(game) {
  const port = game.islands.getPort?.(game.params.get('port') || 'havana') || game.islands.ports[0];
  const hp = port.harborPoint;
  const p = game.player = game.spawnShip({ type: 'brig', faction: 'english', isPlayer: true, x: hp.x, z: hp.z, heading: 0, sailSetting: 0, name: 'Merry Wren' });
  p.controller = new PlayerController(game, p);
  p.hull = p.hullMax * 0.68; p.sails = 0.81; p.crew = 74;
  game.spawnShip({ type: 'galleon', faction: 'spanish', x: hp.x + port.seaward.x * 120 + 80, z: hp.z + port.seaward.z * 120, heading: 1.2, sailSetting: 0, name: 'San Ildefonso' });
  game.spawnShip({ type: 'merchantman', faction: 'spanish', x: hp.x - 140, z: hp.z - port.seaward.z * 40, heading: 2.2, sailSetting: 0, name: 'Esperanza' });
  game.cameraRig.follow(p);
  const st = game.state;
  Object.assign(st, { name: 'Elias Thorne', gold: 4385, food: 34, morale: 58, nationality: 'english', date: { year: 1661, month: 3, day: 14 } });
  st.cargo = { sugar: 18, cloth: 12, rum: 6 };
  st.ledger.cost = { sugar: 18 * 30, cloth: 12 * 52, rum: 6 * 40 };
  st.ledger.profit = 1240; st.plunder = 860; st.daysAtSea = 23; st.captures = 3;
  st.reputation.spanish = 22; st.reputation.english = 34; st.rank.english = 2; st.rank.spanish = 1;
  st.letters = {};
  // Havana is Spanish; at war with England — give the player a Spanish letter so the doors open
  if (relation(p.faction, port.faction) < 0) st.letters[port.faction] = true;
  const nf = Math.min(7, +(game.params.get('fleet') || 0));
  if (nf > 0) {
    const DEMO = [
      { type: 'merchantman', name: 'Santa Lucía', hull: 0.62, sails: 0.8, from: 'spanish', crew: 18, cargo: { sugar: 40, tobacco: 22 } },
      { type: 'schooner', name: 'Marie-Galante', hull: 0.9, from: 'french', crew: 0 },
      { type: 'frigate', name: 'Valiente', hull: 0.41, sails: 0.55, from: 'spanish', crew: 30, cargo: { spice: 12 } },
      { type: 'lugger', name: 'Ferret', hull: 1, from: 'french' },
      { type: 'pink', name: 'Hoorn', hull: 0.75, from: 'dutch', cargo: { cloth: 30 } },
      { type: 'brigantine', name: 'Black Gull', hull: 0.5, from: 'pirate', crew: 12 },
      { type: 'greatgalleon', name: 'Nuestra Señora del Mar', hull: 0.33, sails: 0.4, from: 'spanish', crew: 40, cargo: { silver: 10 } },
    ];
    st.fleet = DEMO.slice(0, nf).map(f => ({ ...f, upgrades: { guns: 0, hull: 0, hold: 0, sheath: 0, canvas: 0, berths: 0 } }));
  }
  game.sky.setTimeOfDay(parseFloat(game.params.get('tod') || '17.2'));
  game.ports.enter(port, game.params.get('tab') || 'harbour');
  const pick = game.params.get('ship');
  if (pick) {
    const sc = game.ports.screen; if (pick.startsWith('fleet:')) sc.fleetSel = +pick.slice(6); else sc.sel = pick;
    sc.render();
    document.querySelector('.fl-row.sel, .oncale')?.scrollIntoView({ block: 'center' });   // the card that goes with the ship at the quay
  }
  // let the backdrop camera move start
  for (let i = 0; i < 30; i++) game.step(1 / 30);
  await new Promise(r => setTimeout(r, 300));
}
import { relation } from '../combat/factions.js';
