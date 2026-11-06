// Showcase: two captains fencing on the deck of a Spanish galleon at golden hour, crews cheering, brawls behind.
//   ?view=action (default)  the enemy's high slash mid-swing, trail arc, the player bracing
//   ?view=parry             the player's perfect parry: sparks + flash at the blades
//   ?view=finish            slow-mo finishing blow, the enemy captain going down
//   ?view=capture           the capture screen with its Transshipment panel (hold nearly full)
//   ?view=board             the full boarding flow from 'combat:board' (transition + duel live, autoplay)
//   &scene=tavern|rampart         the same moments off deck: a tavern common room (windows by the hour: &tod=22 for
//                                 the night), the town rampart at night (guard of the infiltration)
//   &role=merchant|pirate         the enemy deck's dressing (default patrol = a man-of-war: shot and powder)
import { PlayerController } from '../ships/playerController.js';

export async function setup(game) {
  const view = game.params.get('view') || 'action';
  const c = game.combat;
  c.setTrafficTarget?.(0); c.noMagazine = true;
  if (!game.params.get('tod')) game.sky.setTimeOfDay(16.8);
  game.wind.angle = Math.PI * 0.6; game.wind.speed = 6;
  const x = 2600, z = 2600;
  const p = game.player = game.spawnShip({ type: 'frigate', faction: 'english', isPlayer: true, x: x - 16, z, heading: 0.05, sailSetting: 0, name: 'Merry Wren' });
  p.controller = new PlayerController(game, p); p.crew = 150;
  const e = c.spawnAI({ type: 'galleon', faction: 'spanish', role: game.params.get('role') || 'patrol', x: x + 14, z: z + 2, heading: 0, sailSetting: 0, name: 'San Telmo', crew: 120 });
  e.ai.hold = true; e.ai.fireAtWill = false; e.speed = p.speed = 0;
  for (let i = 0; i < 20; i++) game.step(1 / 30);
  game.cameraRig.follow(p);

  if (view === 'capture') {
    const st = game.state; st.cargo = { sugar: 40, hides: 20 }; st.food = 30; st.fleet = st.fleet || [];
    e.crew = 60; game.boarding.active = true; game.boarding._captureScreen(p, e, { winner: 'player', reason: 'wounds' });
    return;
  }
  if (view === 'board') { c.strike?.(e); game.events.emit('combat:board', { attacker: p, defender: e }); return; }

  const duel = game.duel;
  await duel.preloadModel?.();   // A/B: ?captain=glb waits for the rigged model
  const scene = game.params.get('scene');
  const OFF = {
    tavern: { name: 'Jack Barbe-Grise', faction: 'pirate', difficulty: 0.5 },
    rampart: { name: 'Sergeant of the San Telmo guard', faction: 'spanish', difficulty: 0.5 },
  };
  if (OFF[scene]) duel.start({ opponent: OFF[scene], setting: { scene, faction: OFF[scene].faction === 'pirate' ? 'english' : OFF[scene].faction }, crewPlayer: 1, crewEnemy: 1, intro: false, seed: 5, noInput: true });
  else duel.start({ opponent: { name: 'Don Rodrigo de Alcalá', faction: 'spanish', difficulty: 0.6 }, setting: e, crewPlayer: 150, crewEnemy: 120, intro: false, seed: 5, noInput: true });
  const sim = duel.sim;
  sim.aiEnabled = false;
  const dt = 1 / 60;
  const run = (n) => { for (let i = 0; i < n; i++) game.step(dt); };
  run(60);
  sim.player.x = -0.95; sim.enemy.x = 1.0;
  run(20);
  if (view === 'action') {
    // the enemy winds up high and slashes; capture mid-strike while the player parries mid (wrong line)
    // the enemy's mid cut met by a late (perfect) parry: blades lock, sparks fly, the enemy's arc still trails
    sim.enemy.intent = { attack: 'mid' };
    run(1);
    while (sim.enemy.state === 'windup') { if (sim.enemy.t > sim.enemy.dur - 0.1) sim.player.intent = { parry: 'mid' }; run(1); }
    run(1);
    duel._view = 'action';
  } else if (view === 'parry') {
    // the player's high cut caught on the enemy's high guard (an ordinary parry)
    sim.enemy.intent = { parry: 'high' };
    run(30);
    sim.player.intent = { attack: 'high' };
    run(1);
    while (sim.player.state === 'windup') { sim.enemy.intent = { parry: 'high' }; run(1); }
    run(2);
    duel._view = 'parry';
  } else if (view === 'finish') {
    sim.enemy.hp = 1;
    sim.player.intent = { attack: 'high' };
    run(1);
    while (!sim.over) run(1);
    // slow-mo is real-time based in update(); step a little in sim time
    for (let i = 0; i < 220; i++) game.step(dt * 0.22);
    duel._view = 'finish';
  }
  // freeze: the shot tool freezes after setup; the warm-up steps in game.start() advance 0.2 s, compensate by pausing the sim
  duel._freezeSim = true;
}
