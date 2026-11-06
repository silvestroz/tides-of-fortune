// Onboarding. Texts and settings of the contextual hints, the “First steps” screen and the guided goals of the
// early career. The logic is in src/ui/hints.js (game.hud.hints).
// Each hint: { title, body() (HTML, keys as badges), topic (TOAST_ICONS icon), prio? (pressing situation: jumps the
// queue, highest first; 0 by default) }. Position keys by code (kc('KeyW') = Z on AZERTY), mnemonic keys by letter (K('b')).
import { kc } from '../core/keys.js';
import { a } from '../core/i18n.js';

const K = ch => `<span class="kc">${ch}</span>`;           // mnemonic command (letter shown as is)

// how long a card stays up (real seconds): reading ~5 s + 1 s per 22 characters, clamped
export const HINT_TIMING = { base: 5, perChars: 22, min: 8, max: 15, gap: 1.4, sailDelay: 8, timeDelay: 50, mapDelay: 110,
  journalAfter: 12, minShownToDismiss: 2.5 };

export const HINTS = {
  sail: {
    title: 'Wind and points of sail', topic: 'wind',
    body: () => `A beam reach or a broad reach is fastest, close-hauled is slow: the point of sail shows above the compass. ${kc('KeyW')}${kc('KeyS')} make or shorten sail, ${kc('KeyA')}${kc('KeyD')} the helm.`,
  },
  time: {
    title: 'Hurrying time', topic: 'info',
    body: () => `For a long passage, ${K('T')} speeds time up ×4. It returns to normal as soon as an enemy sail draws near.`,
  },
  guns: {
    title: 'Broadsides', topic: 'combat',
    body: () => `${kc('KeyQ')} fires to port, ${kc('KeyE')} to starboard, ${K('Space')} on the side facing the enemy. The bars by the compass show each broadside reloading.`,
  },
  camera: {
    title: 'Combat view', topic: 'combat', prio: 2,
    body: () => `At the first cannon shot, the camera frames your ship and the enemy. ${K('C')} puts it back behind your ship, ${K('C')} again returns it to the fight. Options: “Combat camera” keeps it behind you.`,
  },
  board: {
    title: 'Board her!', topic: 'combat', prio: 5,
    body: () => `This enemy is weak enough to be taken. Come alongside and press ${K('B')} when the prompt says “ready”.`,
  },
  port: {
    title: 'Putting in', topic: 'gold', prio: 2,
    body: () => `${K('F')} to enter port. At the market, buy what is plentiful and sell it where it is scarce; the governor hands out missions and ranks.`,
  },
  map: {
    title: 'The map', topic: 'info',
    body: () => `${K('M')} unrolls the map: ports, nations and where your missions lead. ${K('M')} or ${K('Esc')} rolls it up again.`,
  },
  journal: {
    title: 'The ship’s journal', topic: 'info',
    body: () => `Missed a message? ${K('J')} opens the journal: the latest news, with the time and date.`,
  },
  registry: {
    title: 'The ledger', topic: 'lord',
    body: () => `${K('L')} opens the ledger: your ranks, your officers, your items, your squadron and the ten most feared pirate captains.`,
  },
  repair: {
    title: 'Damage', topic: 'bad', prio: 3,
    body: () => `${K('R')} heaves to for repairs: work only goes on while stopped, under one knot, and stops if you make sail or fire. At sea you can only patch things up; the shipyard does the rest.`,
  },
  hold: {
    title: 'The hold', topic: 'gold',
    body: () => `${K('I')} opens the hold at sea to throw goods overboard. Loaded beyond her capacity, the ship crawls.`,
  },
  storm: {
    title: 'Storm', topic: 'weather', prio: 4,
    body: () => `The edge of a storm drives the ship faster, but its eye tears hull and sails apart. Steer around the dark heart.`,
  },
  shoal: {
    title: 'Shallows', topic: 'shoal', prio: 4,
    body: () => `Clear water hides reefs where a deep hull runs aground and is damaged. Turn towards the dark blue; small ships get through.`,
  },
  // sea tiers (src/data/seaZones.js): first entry onto the trade routes, then into perilous seas
  zone2: {
    title: 'Out of guarded waters', topic: 'zone', prio: 2,
    body: () => `Corvettes and frigates cruise here, and captains of the Top 10. A ship’s card tells you whether she is a match for you; the map (${K('M')}) shows the guarded waters, where pursuers that are too heavy give up.`,
  },
  zone3: {
    title: 'Perilous seas', topic: 'zone', prio: 3,
    body: () => `Ships of the line and the most feared pirates, but also treasure galleons and rewards ×1.6. Facing a ship “out of your class”, run for safer waters.`,
  },
  fleet: {
    title: 'Your squadron', topic: 'info',
    body: () => `The prize joins your squadron (ledger ${K('L')}). At the shipyard of a friendly port, repair her, sell her or make her your flagship.`,
  },
};
export const HINT_KEYS = Object.keys(HINTS);
// hints a seasoned captain already knows (old save without `tutorials`, career under way)
export const VETERAN_SEEN = ['sail', 'time', 'guns', 'board', 'port', 'map', 'storm', 'shoal'];

// ---- playable prologue (src/game/prologue.js), offered with a new game, skippable ----
export const PROLOGUE = {
  type: 'sloop', target: 'Cormorant', captain: 'Nat Crowe',   // name without the article (“the Cormorant” in the texts)
  hull: 0.6, crew: 0.9, duel: 0.12,          // the target's starting hull and crew (at least half of ours + 2), boarding duel
  strikeAt: 0.42,                            // strikes her colours below this fraction of hull
  turn: 1.4,                                 // rad of accumulated heading change for the “helm” step (~80°)
  dist: [650, 850, 1100, 480],               // m ahead of the player; deep water is searched around the heading
  offer: {
    title: 'Prologue',
    text: () => `A few orders at the helm, a broadside and a first prize taken from a crippled freebooter off the port. About two minutes.`,
    start: 'Begin', skip: 'Skip',
  },
  sighted: n => `Sail ho! The ${n}, a crippled pirate sloop, lies at anchor offshore: her guns are silent.`,
  done: n => `Your first prize! Board the ${n} (B) to seize her cargo. Prologue complete.`,
  doneSunk: n => `The ${n} goes to the bottom. Prologue complete: set course for the governor.`,
  doneBoarded: n => `The ${n} is yours: your first prize. Prologue complete: set course for the governor.`,
};

// ---- guided goals of the early career (new game only) ----
// step: ['offer' → 'p-sail' → 'p-helm' → 'p-fire' → 'p-strike' →] 'visit' → 'accept' → 'mission' → 'rank' → 'done'. Texts (short HTML, Spectral): `o` = state.tutorials.goals.
export const GOAL_TEXT = {
  'p-sail': () => `Leave the roads: set full sail (${kc('KeyW')})`,
  'p-helm': () => `Put the helm over (${kc('KeyA')} or ${kc('KeyD')}) and turn a quarter circle`,
  'p-fire': o => `Fire a broadside at the ${o.target || 'freebooter'}: ${kc('KeyQ')} port, ${kc('KeyE')} starboard`,
  'p-strike': o => `Pound the ${o.target || 'freebooter'} until she strikes her colours`,
  visit: o => `Enter ${o.portName || 'a friendly port'} (${K('F')}) and see the governor`,
  accept: o => o.again ? 'Accept a new mission from a governor' : 'Accept a mission from the governor',
  // o.how: short objective of a mission that ends in port (missionBriefs, set by hints._renderGoal), “(F)” as a key
  mission: o => (o.how ? o.how.replace('(F)', `(${K('F')})`) : `Complete the mission: ${o.mission || 'the governor’s'}`),
  rank: o => o.ready ? `${o.nationAdj ? a(o.nationAdj).replace(/^a/, 'A') : 'A'} governor awaits you: receive your first rank` : 'Earn a first rank (missions and prizes, then the governor)',
};
// port message (the port screen hides the HUD) when the goal advances during the stay
export const GOAL_PORT_TEXT = {
  visit: () => `Goal: see the governor (tab 4).`,
  accept: () => `Goal: accept a mission from the governor.`,
  mission: o => `Goal: complete the mission “${o.mission || ''}”.`,
  rank: () => `Goal: earn a first rank.`,
  done: () => `First steps done: the sea is yours, captain.`,
};

// ---- “First steps” screen (pause menu) ----
export const FIRST_STEPS = [
  ['Sailing by the wind', `The wind makes the speed: a beam reach or a broad reach runs fast, close-hauled is slow. Follow the compass rose.`],
  ['Trading', `Buy at the market what is plentiful, sell where it is scarce. Keep provisions for your men.`],
  ['Serving a governor', `He hands out missions: carry dispatches, escort, hunt a freebooter. They pay and make your reputation.`],
  ['Fighting and boarding', `Fire your broadsides from the right side, then board the weakened enemy and beat her captain with the sword.`],
  ['Ranks and lands', `Missions and prizes earn you ranks, and with them lands and privileges in the nation’s ports.`],
  ['Retirement', `Share out the plunder in port when the crew grows restless. When age comes, your fortune and titles make your last years.`],
];
// [keys (codes Key*/Digit* → kc(), else the letter), action]
export const FIRST_KEYS = [
  [['KeyW', 'KeyS'], 'Sail'], [['KeyA', 'KeyD'], 'Helm'], [['KeyQ', 'KeyE'], 'Port / starboard broadside'],
  [['Space'], 'Broadside towards the enemy'], [['B'], 'Board'], [['F'], 'Enter port'], [['R'], 'Repair (stopped)'],
  [['T'], 'Hurry time'], [['M'], 'Map'], [['J'], 'Journal'], [['L'], 'Ledger'], [['I'], 'Hold'],
  [['C'], 'View · recentre in combat'], [['Esc'], 'Pause and options'],
];
