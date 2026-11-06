// CPU profile (CDP sampling) of loading, then of a few frames at sea, on the dev server (readable function names).
// Prints the most expensive functions (self time) and the time per source file, separately for loading and frames.
// usage: node tools/perf-profile.mjs [--frames N] [--query "…"] [--top 30] [--callers 12] [--cpu2d]
//   --callers N: call chains of the N most expensive functions
import { chromium } from 'playwright';
import { BASE, launchOpts } from './_env.mjs';
import { summarize as summarizeProfile } from './_cpuprofile.mjs';

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const frames = +opt('--frames', 20), query = opt('--query', ''), TOP = +opt('--top', 30), CALLERS = +opt('--callers', 0);
// --cpu2d: 2D canvas rasterised by the CPU (in software rendering, the "accelerated" canvas goes through SwiftShader
// and inflates everything that paints textures; the CPU gives an order of magnitude closer to a real machine)
const browser = await chromium.launch(launchOpts(process.argv.includes('--cpu2d') ? ['--disable-accelerated-2d-canvas'] : []));
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });

const summarize = (profile, label) => summarizeProfile(profile, label, { top: TOP, callers: CALLERS });

await cdp.send('Profiler.start');
await page.goto(BASE + (query ? '?' + query : ''), { timeout: 600000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 900000, polling: 500 });
const { profile: loadProfile } = await cdp.send('Profiler.stop');
summarize(loadProfile, 'chargement');
const times = await page.evaluate(() => window.__game.bootTimes);
console.log('bootTimes :', times.filter(t => t[1] >= 20).map(t => `${t[0]} ${t[1]}`).join(' · '));

await page.evaluate(() => { const g = window.__game; g.hud?.menu?.close?.(); g.mode = 'sail'; g.events.emit('state:change', { from: 'menu', to: 'sail' }); g.cameraRig.follow(g.player); });
await page.evaluate(() => new Promise(r => { let n = 0; const f = () => (++n >= 3 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));   // warm-up of the start
await cdp.send('Profiler.start');
await page.evaluate(N => new Promise(r => { let n = 0; const f = () => (++n >= N ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), frames);
const { profile: frameProfile } = await cdp.send('Profiler.stop');
summarize(frameProfile, `${frames} images en mer`);
await browser.close();
