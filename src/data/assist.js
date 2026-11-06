// “Assisted” game mode (assisted play). Pure tables (importable in node).
// Picked on the captain sheet (src/ui/menu.js) and in Options; stored in game.state.assist (bool, absent =
// Classic, old saves included).
//   - auto-fire: src/ships/autoFire.js (called by PlayerController.update), G = fire at will / cease fire;
//   - boarding carried without a duel: src/game/boarding.js (begin → capture screen, reason 'assist').
// Other ships attack exactly as in Classic mode (the AI does not change).
export const GAME_MODES = [
  ['classic', 'Classic', 'you aim the guns and cross swords yourself'],
  ['assist', 'Assisted', 'automatic fire, boarding without a duel'],
];
export const isAssist = state => !!state?.assist;

// Auto-fire: same rules as the AI gun crews (ai.js, _gunnery), plus safeguards:
//   - never first: only at a ship that attacks the player or that the player has already hit;
//   - not during repairs (R), nor through a non-hostile ship;
//   - not at a ship that has struck its colours, nor at a boardable prize that no longer fights or whose hull
//     is below holdHull (don't sink the prize: B takes it).
export const AUTO_FIRE = {
  rangeK: 0.92,     // share of the loaded ammunition's range
  arcPad: 0.22,     // rad added to the target's half-length seen from the gun (lateral aim ±0.2 rad)
  holdHull: 0.25,   // hull of a boardable prize below which fire stops, even if it still fights
  scanS: 0.1,       // s between two decisions
};
