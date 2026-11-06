// Mutiny (career.mutiny, screen src/game/mutiny.js): instead of an outright loss, the captain chooses to face the
// ringleader in a duel on his own deck, or to give in. Settings and pure logic (testable in node, no DOM).

export const MUTINY = {
  // give in: the old mutiny (the mutineers take the longboat with a share of the gold)
  yield: { gold: 0.4, men: 0.3, morale: 45 },
  // duel lost: a heavier loss and a wound for the captain
  lost: { gold: 0.6, men: 0.45, morale: 35, wounds: 1 },
  // duel won: the revolt dies down, the ringleader and his two or three followers are put ashore in irons
  won: { morale: 58, men: 0.04 },
  // the ringleader's duel difficulty: from 0.44 (morale 8) to 0.56 (morale 0), ± 0.04
  duel: { base: 0.44, perMorale: 0.015, spread: 0.04, max: 0.6 },
};

// Original names of the ringleaders and their post aboard.
export const RINGLEADERS = ['Abel Grisdale', 'Jory Penhallow', 'Matthias Vorne', 'Tobiah Lusk', 'Corentin Le Goff', 'Hugo Barral',
  'Esteban Ruiz', 'Piet Haeck', 'Gaspard Mornet', 'Silas Crowne', 'Ewan Tregear', 'Bastien Morlaix'];
export const POSTS = ['the boatswain', 'the master gunner', 'the steward', 'a foretopman', 'the boatswain’s mate', 'the bosun'];
export const GRIEVANCES = [
  'We’ve been working ourselves to the bone for weeks and haven’t seen the colour of a single coin.',
  'The biscuit is full of weevils and our share of the plunder sleeps in your chest.',
  'We signed on for gold, captain, not to rot at sea under your orders.',
  'The men have had enough. Either you share out, or we help ourselves.',
  'We want what we’re owed, and a longboat for those who can take no more.',
];

// deterministic ringleader for a given day (same ringleader if the screen is reopened after a load)
export function ringleader(seed) {
  const h = (Math.imul(seed | 0, 2654435761) >>> 0);
  return { name: RINGLEADERS[h % RINGLEADERS.length], post: POSTS[(h >>> 8) % POSTS.length], grievance: GRIEVANCES[(h >>> 16) % GRIEVANCES.length] };
}

export function duelDifficulty(morale, rnd = Math.random) {
  const D = MUTINY.duel;
  return Math.min(D.max, D.base + Math.max(0, 8 - (morale || 0)) * D.perMorale + (rnd() * 2 - 1) * D.spread);
}

// Outcome of a choice. choice: 'yield' | 'duel'; won: outcome of the duel. Changes nothing: returns the losses and morale.
export function mutinyOutcome(choice, { gold = 0, crew = 0 } = {}, won = false) {
  if (choice === 'duel' && won) {
    const men = crew > 8 ? Math.max(1, Math.round(crew * MUTINY.won.men)) : 0;
    return { gold: 0, men, morale: MUTINY.won.morale, wounds: 0 };
  }
  const k = choice === 'duel' ? MUTINY.lost : MUTINY.yield;
  return { gold: Math.round(Math.max(0, gold) * k.gold), men: crew > 4 ? Math.max(1, Math.round(crew * k.men)) : 0, morale: k.morale, wounds: k.wounds || 0 };
}
