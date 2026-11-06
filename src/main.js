// Entry point: blocks the browser context menu, starts the usage statistics, bakes the island relief in Web Workers,
// builds the Game behind the loading screen (#boot in index.html), then starts it and fades the loading screen out.
import { Game } from './core/game.js';
import { prebakeTerrain } from './world/terrain/prebake.js';   // island relief baked in Web Workers
import { startTelemetry } from './core/telemetry.js';            // usage statistics: Vercel audience, anonymous game statistics
import { blockContextMenu, installLeaveGuard } from './ui/leaveGuard.js';   // leave guard: right click, browser Back

blockContextMenu();   // from the loading screen on

const tel = startTelemetry();   // before the game: a failed load is counted too

// loading screen (#boot, index.html): fades out once the game is ready, removed at once in ?shot= showcases
const boot = document.getElementById('boot');
const hideBoot = () => {
  if (!boot) return;
  if (new URLSearchParams(location.search).has('shot')) { boot.remove(); return; }
  boot.classList.add('done');
  setTimeout(() => boot.remove(), 800);
};
const fail = e => {
  console.error(e); window.__error = String(e && e.stack || e); try { tel.fail(e); } catch { /* statistics never block the game */ }
  if (boot) { boot.classList.add('fail'); const m = boot.querySelector('.msg'); if (m) m.textContent = 'Loading failed. Reload the page.'; }
};

// let the browser paint the loading screen before the (synchronous, heavy) construction of the world; the fallback
// timer covers a tab opened in the background (requestAnimationFrame isn't served there)
const painted = new Promise(r => { requestAnimationFrame(() => setTimeout(r, 0)); setTimeout(r, 150); });
painted.then(async () => {
  // the islands' relief bakes in parallel (Web Workers) before the synchronous construction of the game
  try { const pre = await prebakeTerrain(parseInt(new URLSearchParams(location.search).get('seed') || '1717', 10)); globalThis.__tofPrebake = pre; window.__prebake = pre && { ms: pre.ms, workers: pre.workers }; }
  catch (e) { console.warn('prebake', e); }
  let game = null;
  try { game = new Game(document.getElementById('app'), document.getElementById('ui')); window.__game = game; } catch (e) { fail(e); return; }
  try { installLeaveGuard(game); } catch (e) { console.warn('leaveGuard', e); }
  try { tel.attach(game); } catch { /* idem */ }
  game.start().then(() => { hideBoot(); try { tel.ready(game); } catch { /* idem */ } }).catch(fail);
});
