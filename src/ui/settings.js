// Shared player settings, stored on game.settings and persisted to localStorage.
//   game.settings = { master, music, sfx (0..1), quality: 'low'|'medium'|'high'|'ultra', mouseSensitivity (0.2..2),
//                     hints (bool, contextual hints and guided goals, src/ui/hints.js),
//                     stats (bool, anonymous statistics, src/core/telemetry.js),
//                     fps: 'auto'|'max'|'60' (presented cadence on fast screens, src/core/framePacer.js) }
// API: ensureSettings(game) -> settings ; saveSettings(game, patch) (merges, persists, emits 'settings:change')
const KEY = 'tof.settings.v1';
export const DEFAULT_SETTINGS = { master: 0.8, music: 0.6, sfx: 0.8, quality: 'high', mouseSensitivity: 1, hints: true, stats: true, fps: 'auto' };

export function ensureSettings(game) {
  if (game.settings) return game.settings;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
  game.settings = { ...DEFAULT_SETTINGS, ...saved };
  return game.settings;
}

export function saveSettings(game, patch) {
  const s = ensureSettings(game);
  Object.assign(s, patch);
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
  game.events.emit('settings:change', { settings: s, patch });
  return s;
}
