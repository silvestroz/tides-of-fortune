// Headless duel simulation test: node tools/test-duel.mjs
// Runs scripted and bot duels through the pure DuelSim and checks that both a player win and a player loss occur,
// via both end conditions (wounds and pressed-to-the-rail), plus the boarding spoils helpers.
import { DuelSim, boardingSpoils, defeatPenalty, TIMING, STAMINA, DUEL_DIFFICULTY, WEAPONS } from '../src/game/duel/sim.js';
import { mulberry32 } from '../src/core/rng.js';

let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ok   ' : '  FAIL ') + msg); if (!c) fails++; };
const DT = 1 / 60;

// a "good" player bot: parries the AI's wind-up line after a human-ish reaction, ripostes after a parry
function goodBot(sim, react = 0.12) {
  const me = sim.player, op = sim.enemy;
  let seen = 0, guess = null;
  return () => {
    if (op.state === 'windup') { seen += DT; if (seen > react && !guess) guess = op.height; me.intent = guess ? { parry: guess } : (me.state === 'parry' ? { parry: me.height } : null); return; }
    seen = 0; guess = null;
    if (me.busy) return;
    if (Math.abs(me.x - op.x) > TIMING.range - 0.1) { me.intent = { step: 1 }; return; }
    if (op.state === 'stagger' || op.state === 'recover' || op.state === 'hit' || op.state === 'taunt') { me.intent = { attack: ['high', 'mid', 'low'][Math.floor(sim.rand() * 3)] }; return; }
    me.intent = { parry: 'mid' };
  };
}
const idleBot = sim => () => { sim.player.intent = null; };
const retreatBot = sim => () => { if (!sim.player.busy) sim.player.intent = { step: -1 }; };

function run(opts, botF, maxT = 240) {
  const sim = new DuelSim({ rand: mulberry32(opts.seed || 1), ...opts });
  const bot = botF(sim);
  const ev = {};
  while (!sim.over && sim.time < maxT) { bot(); for (const e of sim.step(DT)) ev[e.type] = (ev[e.type] || 0) + 1; }
  return { sim, ev, res: sim.result };
}

console.log('duel sim tests');
// 1. idle player loses to any AI
{
  const { res, ev } = run({ difficulty: 0.5, crewPlayer: 50, crewEnemy: 50 }, idleBot);
  ok(res && res.winner === 'enemy', `idle player loses (${res?.reason}, ${res?.time.toFixed(1)} s, hits ${ev.hit})`);
}
// 2. good player beats an easy opponent most of the time
{
  let wins = 0, reasons = {};
  for (let s = 1; s <= 20; s++) { const { res } = run({ seed: s, difficulty: 0.2, crewPlayer: 60, crewEnemy: 40 }, goodBot); if (res?.winner === 'player') { wins++; reasons[res.reason] = (reasons[res.reason] || 0) + 1; } }
  ok(wins >= 14, `good player beats easy AI ${wins}/20 ${JSON.stringify(reasons)}`);
}
// 3. hard AI is harder than easy AI for the same bot
{
  let wE = 0, wH = 0;
  for (let s = 1; s <= 20; s++) {
    if (run({ seed: s, difficulty: 0.1 }, sim => goodBot(sim, 0.15)).res?.winner === 'player') wE++;
    if (run({ seed: s, difficulty: 1.0 }, sim => goodBot(sim, 0.15)).res?.winner === 'player') wH++;
  }
  ok(wE > wH, `difficulty matters: easy ${wE}/20 vs hard ${wH}/20`);
}
// 4. retreating player gets pressed to the rail
{
  const { res } = run({ difficulty: 0.5 }, retreatBot);
  ok(res && res.winner === 'enemy' && res.reason === 'pressed', `retreating player is pressed to the rail (${res?.reason})`);
}
// 5. scripted AI-off: player can press the enemy back to the rail with parried blows + steps
{
  const sim = new DuelSim({ rand: mulberry32(3), difficulty: 0.5, enemyHp: 99 });
  sim.aiEnabled = false;
  let n = 0;
  while (!sim.over && sim.time < 120) {
    const e = sim.enemy, p = sim.player;
    e.intent = e.busy ? null : { parry: 'mid' };
    if (!p.busy) p.intent = (Math.abs(e.x - p.x) > 1.6) ? { step: 1 } : { attack: 'mid' };
    sim.step(DT); n++;
  }
  ok(sim.result?.winner === 'player' && sim.result.reason === 'pressed', `player presses a guarding enemy to the rail (${sim.result?.reason}, ${sim.time.toFixed(1)} s)`);
}
// 6. taunt gives double-wound momentum
{
  const sim = new DuelSim({ rand: mulberry32(4), enemyHp: 5 }); sim.aiEnabled = false;
  sim.player.intent = { taunt: true };
  while (sim.player.momentum === 0 && sim.time < 3) sim.step(DT);
  ok(sim.player.momentum === 1, 'taunt completes and grants momentum');
  sim.player.intent = { attack: 'high' };
  while (sim.enemy.hp === 5 && sim.time < 5) sim.step(DT);
  ok(sim.enemy.hp === 3, `empowered slash wounds twice (hp ${sim.enemy.hp})`);
}
// 7. perfect parry staggers the attacker
{
  const sim = new DuelSim({ rand: mulberry32(5) }); sim.aiEnabled = false;
  sim.enemy.intent = { attack: 'low' };
  let perfect = false;
  while (sim.time < 2) {
    if (sim.enemy.state === 'windup' && sim.enemy.t > sim.enemy.dur - 0.1) sim.player.intent = { parry: 'low' };
    for (const e of sim.step(DT)) if (e.type === 'parry') perfect = e.perfect;
    if (perfect) break;
  }
  ok(perfect && sim.enemy.state === 'stagger', 'late (perfect) parry staggers the attacker');
}
// 9. dodges: a side step evades any line, a jump only a low cut, ducking only a high one
{
  const tryEvade = (kind, h) => {
    const sim = new DuelSim({ rand: mulberry32(6) }); sim.aiEnabled = false;
    sim.enemy.intent = { attack: h };
    let res = null;
    while (sim.time < 2 && !res) {
      if (sim.enemy.state === 'windup' && sim.enemy.t > sim.enemy.dur - 0.12 && sim.player.state === 'idle') sim.player.intent = { dodge: kind };
      for (const e of sim.step(DT)) if (e.type === 'evade' || e.type === 'hit' || e.type === 'whiff') res = e.type === 'whiff' ? 'evade' : e.type;
    }
    return res;
  };
  ok(tryEvade('side', 'mid') === 'evade' && tryEvade('back', 'high') === 'evade', 'side / back dodge evade the blow');
  ok(tryEvade('jump', 'low') === 'evade' && tryEvade('jump', 'high') === 'hit', 'a jump clears a low cut, not a high one');
  ok(tryEvade('duck', 'high') === 'evade' && tryEvade('duck', 'low') === 'hit', 'ducking clears a high cut, not a low one');
  const sim = new DuelSim({ rand: mulberry32(6) }); sim.aiEnabled = false;
  sim.player.intent = { dodge: 'side' }; sim.step(DT);
  ok(sim.player.stamina < STAMINA.max - STAMINA.dodge + 1, `a dodge costs stamina (${sim.player.stamina.toFixed(0)})`);
}
// 10. a guard emptied of stamina breaks
{
  const sim = new DuelSim({ rand: mulberry32(7), weaponEnemy: 'longsword' }); sim.aiEnabled = false;
  sim.player.stamina = 5;
  sim.enemy.intent = { attack: 'mid' };
  let br = false;
  while (sim.time < 3 && !br) { if (!sim.player.busy) sim.player.intent = { parry: 'mid' }; for (const e of sim.step(DT)) if (e.type === 'guardbreak') br = true; }
  ok(br && sim.player.state === 'stagger', 'a winded guard breaks under a long sword');
}
// 11. a successful taunt rattles the opponent; weapons differ in speed; a riposte winds up faster
{
  let stuns = 0;
  for (let s = 1; s <= 20; s++) {
    const sim = new DuelSim({ rand: mulberry32(s), difficulty: 0.5 }); sim.aiEnabled = false;
    sim.player.intent = { taunt: true };
    for (let i = 0; i < 80; i++) { sim.enemy.intent = sim.enemy.busy ? null : { parry: 'mid' }; for (const e of sim.step(DT)) if (e.type === 'tauntDone' && e.stun) stuns++; }
  }
  ok(stuns >= 5 && stuns <= 17, `taunt stuns sometimes (${stuns}/20)`);
  const wind = w => { const sim = new DuelSim({ rand: mulberry32(1), weaponPlayer: w }); sim.aiEnabled = false; sim.player.intent = { attack: 'mid' }; sim.step(DT); return sim.player.dur; };
  ok(wind('rapier') < wind('cutlass') && wind('cutlass') < wind('longsword'), `wind-ups rapier ${wind('rapier').toFixed(2)} < cutlass ${wind('cutlass').toFixed(2)} < long sword ${wind('longsword').toFixed(2)} s`);
  const sim = new DuelSim({ rand: mulberry32(1) }); sim.aiEnabled = false; sim.player.riposteT = 0.5; sim.player.intent = { attack: 'mid' }; sim.step(DT);
  ok(sim.player.dur < wind('cutlass') * 0.6, 'a riposte after a perfect parry winds up faster');
}
// 12. balance: an average human-like player (reaction 0.32–0.56 s, reads the line 65 % of the time) against
//     "lame honnête" (0.5) and pirate-grade (0.65) captains, at the 'captain' pace (= the old duel) and at normal ('mate')
function avgBot(sim, { react = 0.44, acc = 0.65, dodge = false } = {}) {
  const me = sim.player, op = sim.enemy, H = ['high', 'mid', 'low'], r = mulberry32(77);
  let seen = 0, guess = null, rt = react;
  return () => {
    if (op.state === 'windup') {
      seen += DT;
      if (seen > rt && !guess) {
        guess = r() < acc ? op.height : (dodge && me.stamina >= STAMINA.dodge && r() < 0.6 ? 'dodge' : H[Math.floor(r() * 3)]);
        if (guess === 'dodge') { me.intent = { dodge: 'side' }; return; }
      }
      if (guess === 'dodge') { me.intent = null; return; }
      me.intent = guess ? { parry: guess } : (me.state === 'parry' ? { parry: me.height } : null); return;
    }
    seen = 0; guess = null; rt = react - 0.12 + r() * 0.24;
    if (me.busy) return;
    if (Math.abs(me.x - op.x) > TIMING.range - 0.1) { me.intent = { step: 1 }; return; }
    if (['stagger', 'recover', 'hit', 'taunt'].includes(op.state) && r() < 0.5) { me.intent = { attack: H[Math.floor(r() * 3)] }; return; }
    if (r() < 0.01) { me.intent = { attack: H[Math.floor(r() * 3)] }; return; }
    me.intent = { parry: 'mid' };
  };
}
{
  const N = 60;
  const rate = (d, diff, o) => { let w = 0; for (let s = 1; s <= N; s++) if (run({ seed: s, difficulty: d, aiPace: diff.pace, aiRead: diff.read }, sim => avgBot(sim, o)).res?.winner === 'player') w++; return Math.round(100 * w / N); };
  const c5 = rate(0.5, DUEL_DIFFICULTY.captain), m5 = rate(0.5, DUEL_DIFFICULTY.mate), c65 = rate(0.65, DUEL_DIFFICULTY.captain), m65 = rate(0.65, DUEL_DIFFICULTY.mate), md65 = rate(0.65, DUEL_DIFFICULTY.mate, { dodge: true });
  console.log(`       average bot wins: d=0.5 captain ${c5} % / normal ${m5} % ; d=0.65 captain ${c65} % / normal ${m65} % / normal + dodges ${md65} %`);
  ok(m5 >= 70 && m5 > c5, 'normal: the average bot wins most duels against an honest blade');
  ok(m65 >= c65 + 15, 'normal: clearly easier than the captain pace against pirate-grade captains');
}
// 8. spoils / penalty helpers
{
  const sp = boardingSpoils('galleon', mulberry32(9), { crewEnemy: 120 });
  ok(sp.gold >= 1500 && Object.keys(sp.cargo).length > 0 && sp.recruits > 0, `spoils ${JSON.stringify(sp)}`);
  const pen = defeatPenalty(1000, mulberry32(2));
  ok(pen.goldLost > 0 && pen.goldLost < 1000, `defeat penalty ${JSON.stringify(pen)}`);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
