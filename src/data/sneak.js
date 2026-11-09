// Settings of the sneaking / prison-escape mode (in-house balancing, measured by tools/test-sneak.mjs).
export const SNEAK = {
  cell: 5, W: 46, H: 32,           // town grid: 46 × 32 cells of 5 m (230 × 160 m); z = 0: the sea (bottom of the screen)
  walk: 2.7, run: 5.0,             // the captain's m/s (Shift = run, noisy)
  radius: 0.45,
  // garrison → number of guards; posts: sentries standing still at the exits (count below a garrison of 60 / from 60);
  // pairShare: share of the patrols walking in pairs (the second one covers the rear)
  guards: { min: 5, max: 11, perGarrison: 1 / 13, walk: 1.5, investigate: 2.2, chase: 4.7, turn: 3.2, posts: [2, 3], pairShare: 0.4, torch: 0.75 },
  post: { sweep: 1.25, period: [5.5, 9], pause: 0.35 },   // sentries: head sweep (rad either side), period (s), share of time staring ahead
  // sight at night: range × light factor (deep shadow / moonlight / lantern or torch light); near: sensed whatever the
  // facing (behind: × behind, a slow sense that leaves time to knock the guard out)
  view: { range: 21, half: 0.62, near: 2.4, behind: 0.12, runMul: 1.15, alarmMul: 1.3 },
  light: { dark: 0.4, moon: 0.72, lit: 1.35, rateDark: 0.4, rateMoon: 1, rateLit: 1.6, lamp: 9, torch: 7.5 },
  // gauge (0–100 per guard): seen → + seeRate × proximity × light × modifiers per s; out of sight → − decay per s
  seeRate: 55, decay: 8, runSee: 1.4,
  levels: [15, 45, 75],            // suspicion / wariness / hunt thresholds; 100 = alarm
  noise: { run: 13, runRate: 24, lock: 9, lockRate: 9, cap: 60 },   // noise: radius m, gain per s, cap of the gauge through hearing
  disguise: [1, 0.65, 0.4],        // detection multiplier by disguise level
  lockTime: [7, 3.5, 1.5],         // s to pick the prison grate: no tool / skeleton key / lock-picking kit
  catchR: 1.3, alarmCalm: 30, goalR: 2.6,     // alarm: calms down after 30 s unseen
  // fugitive's tools: stones (count, range m, noise radius m, cooldown s; a lured guard searches lureLook s);
  // hiding spots (reach m; a searching guard closer than searchR m finds you); knock-out (reach m, minimum angle
  // between the guard's facing and you, noise radius m); a knocked-out guard seen within bodySight m raises the alarm
  tools: { stones: 3, throwMax: 16, stoneNoise: 15, cooldown: 1.2, lureLook: 5, hideR: 2.2, searchR: 2.2, koR: 1.9, koBack: 1.9, koNoise: 5, bodySight: 15, bodyTime: 0.5 },
  moonElev: 0.62,                  // rad: moon height (long cast shadows; the same direction for rendering and simulation)
  moonDir: { x: 0.85, z: -0.53 },  // direction (in plan) toward the moon: low on the sea side, the facades seen are moonlit
  // aftermath
  escapeDays: [2, 5],              // successful escape: days elapsed instead of the sentence
  failMul: 1.5, failDays: 15,      // failed escape: sentence × 1.5 + 15 days
};
