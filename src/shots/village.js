// Showcase: a village seen from the sea, the player's brig at anchor.
//   ?v=<village id> (default v_cayman; also v_roncador, v_swan, v_andros, v_redes, v_pargo)
//   brig at anchor, in line with the dredged channel (clear of the shoals)
//   ?view=sea (default, wide shot from offshore) | close (close shot on the huts and the jetty) | ponton (the village
//   sheet open, as after F); ?tod=… for the time of day.
import { PlayerController } from '../ships/playerController.js';

export async function setup(game) {
  const v = game.islands.getVillage?.(game.params.get('v') || 'v_cayman') || game.islands.villages?.[0];
  if (!v) return;
  game.combat.setTrafficTarget?.(0);
  game.wind.angle = Math.PI * 0.75; game.wind.speed = 8;
  const s = v.seaward, l = v.lateral, q = v.quay, tc = v.townCenter, hp = v.harborPoint;
  const p = game.player = game.spawnShip({ type: 'brig', faction: 'english', isPlayer: true, x: hp.x + s.x * 70, z: hp.z + s.z * 70, heading: Math.atan2(l.x, -l.z), sailSetting: 0, name: 'Merry Wren' });
  p.controller = new PlayerController(game, p);
  game.cameraRig.follow(p);
  const view = game.params.get('view') || 'sea';
  if (view === 'ponton') { game.villages?.enter(v); return; }
  const k = view === 'close' ? 0.45 : 1;
  game.cameraRig.setShot?.({
    position: [q.x + s.x * 230 * k + l.x * 120 * k, view === 'close' ? 14 : 26, q.z + s.z * 230 * k + l.z * 120 * k],
    lookAt: [tc.x - l.x * 10, view === 'close' ? 4 : 6, tc.z - l.z * 10], fov: view === 'close' ? 38 : 34,
  });
}
