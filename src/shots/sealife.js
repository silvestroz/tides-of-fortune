// Showcase: a pod of dolphins leaping off the brig's bow (sea life, src/world/seaLife.js).
// ?kind=dolphins|whale|flyfish|turtle|ray|bait (default dolphins), ?at=<s> event time for frozen frames.
import { setup as sailing } from './sailing.js';

export async function setup(game) {
  await sailing(game);
  // the sailing scene's frigate would block the calm check (not hostile, so fine), keep a calm sea for readability
  if (game.ocean) game.ocean.seaState = 0.45;
  const kind = game.params.get('kind') || 'dolphins';
  const life = game.seaLife; if (!life) return;
  const e = life.spawn(kind);
  if (!e) return;
  e.dur = 1e9;   // stays for the showcase
  e.t = +(game.params.get('at') || (kind === 'whale' ? 6 : 6.2));
  if (kind === 'dolphins') e.animals.forEach((a, i) => { a.off.set(-(9 + (i % 2) * 5 + i), -6 + i * 6); a.rate = 1.7; a.ph = Math.PI * 0.5 - e.t * a.rate * 2.2 + (i - 1) * 0.35; a.wasUp = true; });
  const rig = game.cameraRig;
  rig.follow(game.player);
}
