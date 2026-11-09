// Showcase: sneaking into a hostile Spanish port at nightfall.
//   ?port=<id> (default havana)   ?kind=infiltrate|escape   ?play=<s> advances the game (the captain follows a path)
//   ?view=offer: the “Soldiers guard the quay” screen   ?view=prison: the prison screen with “Attempt an escape”
//   ?level=0..4: forces the gauge (shows the red cones and the alarm)
//   ?torch=1: a torch-bearing guard stands just ahead of the captain, his back turned (within knock-out reach)
//   ?frozen=1 (set by tools/shot.mjs): the simulation stops once the scene is set (stable captures)
//   ?zoom=<m>: camera distance (default 78)   ?pitch=<rad>: camera pitch (default 1.12)
//   ?poses=1: a sheet of the characters' poses on the quay (walk, run, sneak, hidden, sentry, torch, knocked out,
//             lock); ?pt=<s> = time into the cycles (the figures stay in place, their legs walking); ?focus=<i>
//             centres the i-th figure; ?face=<rad> turns them
import { PlayerController } from '../ships/playerController.js';
import { findPath, blocked } from '../game/sneak/sim.js';
import { CaptainFigure, LOOKS, liteFigureMaterials } from '../game/duel/figure.js';
import { GaitAnimator, cloneFigure } from '../game/duel/locomotion.js';
import * as THREE from 'three';

export async function setup(game) {
  const port = game.islands.getPort?.(game.params.get('port') || 'havana') || game.islands.ports.find(p => !p.haven);
  const hp = port.harborPoint;
  const p = game.player = game.spawnShip({ type: 'brig', faction: 'english', isPlayer: true, x: hp.x + port.seaward.x * 300, z: hp.z + port.seaward.z * 300, heading: 0, sailSetting: 0, name: 'Merry Wren' });
  p.controller = new PlayerController(game, p); p.crew = 60;
  game.cameraRig.follow(p);
  game.combat.setTrafficTarget?.(0);
  Object.assign(game.state, { name: 'Elias Thorne', gold: 2400, crew: 60 });
  for (let i = 0; i < 10; i++) game.step(1 / 30);
  const view = game.params.get('view');
  if (view === 'offer') { game.sneak.offerPort(port); return; }
  if (view === 'prison') { game.boarding._captivityScreen(p, { faction: port.faction, _captain: { name: `the guard of ${port.name}` }, alive: false }, { cause: 'sneak', how: `Caught in the back streets of ${port.name}.` }); return; }
  const kind = game.params.get('kind') || 'infiltrate';
  await game.sneak.start({ kind, port });
  const sn = game.sneak, sim = sn.sim;
  if (kind === 'escape') { sim.map.gate.open = true; sim.map.type[sim.map.gate.j * sim.map.W + sim.map.gate.i] = 0; }
  const play = parseFloat(game.params.get('play') || '9');
  const goal = sim.goals[sim.goals.length > 1 ? 1 : 0];
  const path = findPath(sim.map, sim.player.x, sim.player.z, goal.x, goal.z) || [];
  for (let t = 0; t < play && path.length; t += 1 / 20) {
    const n = path[0], dx = n.x - sim.player.x, dz = n.z - sim.player.z;
    if (Math.hypot(dx, dz) < 0.6) { path.shift(); continue; }
    sim.input = { x: dx, z: dz, run: false, act: false };
    for (const g of sim.guards) g.sus = Math.min(g.sus, 40);   // showcase: we don't get caught
    sim.step(1 / 20);
    if (sim.caught) { sim.caught.x += 12; sim.caught.sus = 0; sim.caught = null; }
  }
  sim.input = { x: 0, z: 0, run: false, act: false };
  const lv = game.params.get('level');
  if (lv != null) {
    const L = +lv, near = sim.guards.filter(g => !g.down).sort((a, b) => Math.hypot(a.x - sim.player.x, a.z - sim.player.z) - Math.hypot(b.x - sim.player.x, b.z - sim.player.z));
    if (L >= 4) sim.raiseAlarm(); else if (near[0]) { near[0].sus = [5, 30, 60, 90][L]; near[0].lastSeen = { x: sim.player.x, z: sim.player.z }; }
    sim.step(0.01);
  }
  if (game.params.get('torch')) {
    const p = sim.player, g = sim.guards.filter(q => !q.down && !q.post).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    if (g) {
      g.torch = true; g.leader = null; g.sus = 0;
      const a = [0, Math.PI / 2, Math.PI, -Math.PI / 2].find(t => !blocked(sim.map, p.x + Math.sin(t) * 1.7, p.z + Math.cos(t) * 1.7)) ?? 0;
      g.x = p.x + Math.sin(a) * 1.7; g.z = p.z + Math.cos(a) * 1.7; g.heading = a; g.path = []; g.wait = 99; g.baseH = a;
    }
    sim.step(0.01);
  }
  sn.view.cam.x = sim.player.x; sn.view.cam.z = sim.player.z;
  if (game.params.get('zoom')) sn.view.cam.dist = +game.params.get('zoom');
  if (game.params.get('pitch')) sn.view.cam.pitch = +game.params.get('pitch');
  if (game.params.get('poses')) poseSheet(game, sn);
  sn._scripted = !!game.params.get('frozen');
  if (sn._scripted) sn.speed = 0;
}

// the pose sheet: figures built like the town's actors, each driven in one state for ?pt seconds, then held
function poseSheet(game, sn) {
  const v = sn.view, S = v.scene, lite = liteFigureMaterials(), z0 = 4 * 5, x0 = 115 - 16;
  const guardF = new CaptainFigure({ coat: '#c9a54a', trim: '#8a1e1e', lapel: '#8a1e1e', waistcoat: '#8a1e1e', breeches: '#3a2a20', hat: 'morion', tool: 'musket', sword: false, fists: true, moustache: true, expr: 'stern', epaulette: false, headScale: 1.3, detail: 0.4, lite, seed: 11 });
  const capF = new CaptainFigure({ ...LOOKS.player, sheathed: true, cutlass: true, headScale: 1.3, detail: 0.4, lite, seed: 3 });
  const rows = [
    ['walk', guardF, { speed: 1.5, gait: 'walk', carry: 'musket' }],
    ['chase', guardF, { speed: 4.7, gait: 'run', carry: 'port' }],
    ['torch', guardF, { speed: 1.5, gait: 'walk', carry: 'torch' }],
    ['sentry', guardF, { speed: 0, look: 'sentry', carry: 'musket' }],
    ['knocked out', guardF, { speed: 0, pose: 'down', carry: 'musket' }],
    ['sneak', capF, { speed: 2.7, gait: 'sneak' }],
    ['run', capF, { speed: 5.0, gait: 'run' }],
    ['hidden', capF, { speed: 0, pose: 'hide' }],
    ['lock', capF, { speed: 0, pose: 'work' }],
  ];
  const T = parseFloat(game.params.get('pt') || '1.3'), dt = 1 / 30;
  const items = rows.map(([label, fig, st], i) => {
    const rig = cloneFigure(fig), sc = fig === capF ? 1.95 : 1.9; rig.group.scale.setScalar(sc);
    rig.group.position.set(x0 + i * 2.9, 0, z0); rig.group.rotation.y = label === 'knocked out' ? -Math.PI / 2 : +(game.params.get('face') ?? Math.PI - 0.6);
    S.add(rig.group);
    const anim = new GaitAnimator(rig, { scale: sc, seed: i + 1 });
    for (let t = 0; t < T; t += dt) anim.update(dt, { ...st, dist: st.speed * dt });
    if (st.carry === 'torch') {   // the town's torch is drawn by the view; here a plain stick and flame in the fist
      rig.group.updateMatrixWorld(true);
      const h = anim.handPoint('r', new THREE.Vector3()), tm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 5), new THREE.MeshBasicMaterial({ color: '#3a2618' }));
      tm.position.copy(h).add(new THREE.Vector3(0, 0.2, 0)); S.add(tm);
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.6, 6), new THREE.MeshBasicMaterial({ color: '#ffb347' })); fl.position.copy(h).add(new THREE.Vector3(0, 1.1, 0)); S.add(fl);
    }
    return { label, rig, x: x0 + i * 2.9 };
  });
  if (!game.params.get('zoom')) v.cam.dist = 24;
  if (!game.params.get('pitch')) v.cam.pitch = 0.8;
  const focus = +(game.params.get('focus') ?? 4);   // the sheet's figure at the centre
  const up = v.update.bind(v);
  v.update = (sim, dt2) => { up(sim, dt2); v.capRing.visible = false; for (const a of [v.actors.cap, ...v.actors.guards]) a.rig.group.visible = false; v.cam.x = x0 + 2.9 * focus; v.cam.z = z0 - 2; };
  const lab = document.createElement('div'); lab.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:50;font:600 13px Georgia,serif;color:#f4e6c0;text-shadow:0 1px 2px #000';
  document.body.appendChild(lab);
  const place = () => { lab.innerHTML = items.map(it => { const p = v.project(it.x, z0, 0); return `<div style="position:absolute;left:${p.x - 40}px;top:${p.y + 24}px;width:80px;text-align:center">${it.label}</div>`; }).join(''); requestAnimationFrame(place); };
  place();
}
