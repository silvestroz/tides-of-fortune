// Settings of the sneaking / prison-escape mode (in-house balancing).
export const SNEAK = {
  cell: 5, W: 46, H: 32,           // town grid: 46 × 32 cells of 5 m (230 × 160 m); z = 0: the sea (bottom of the screen)
  walk: 2.7, run: 5.0,             // the captain's m/s (Shift = run, noisy)
  radius: 0.45,
  guards: { min: 4, max: 9, perGarrison: 1 / 15, walk: 1.45, investigate: 2.1, chase: 4.7, turn: 3.2 },
  view: { range: 22, half: 0.62, near: 2.4, shade: 0.55, runMul: 1.15, alarmMul: 1.3 },
  // gauge (0–100 per guard): seen → + seeRate × proximity × modifiers per s; out of sight → − decay per s
  seeRate: 62, decay: 9, runSee: 1.4, shadeSee: 0.6,
  levels: [15, 45, 75],            // suspicion / wariness / hunt thresholds; 100 = alarm
  noise: { run: 13, runRate: 22, lock: 9, lockRate: 9, cap: 60 },   // noise: radius m, gain per s, cap of the gauge through hearing
  disguise: [1, 0.65, 0.4],        // detection multiplier by disguise level
  lockTime: [7, 3.5, 1.5],         // s to pick the prison grate: no tool / skeleton key / lock-picking kit
  catchR: 1.3, alarmCalm: 30, goalR: 2.6,     // alarm: calms down after 30 s unseen
  sunElev: 0.6,                    // rad: low evening sun, long shadows (the same direction for rendering and simulation)
  sunDir: { x: 0.62, z: 0.78 },    // direction (in plan) toward the sun
  // aftermath
  escapeDays: [2, 5],              // successful escape: days elapsed instead of the sentence
  failMul: 1.5, failDays: 15,      // failed escape: sentence × 1.5 + 15 days
};
