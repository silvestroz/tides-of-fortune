// Screenshot tool for critics & builders.
// Usage: node tools/shot.mjs --shot ocean --out shots/ocean.png [--tod 17.5] [--w 1600 --h 900]
//        [--frames 20] [--q "extra=1&foo=2"] [--eval "js run after ready"] [--play 5]
// --play N : instead of freezing, let the sim run N seconds of real time before capture.
// --headed : visible browser window (always GPU-accelerated; use it if the GPU line below says SwiftShader).
// Requires the dev server: `npm run dev` (http://127.0.0.1:5173). Prints the WebGL renderer and console errors.
// Renders on the real GPU (new headless mode, no SwiftShader flags).
import { chromium } from 'playwright';
import { BASE, PORT, launchOpts } from './_env.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']);
  return a;
}, []));
const w = +(args.w || 1600), h = +(args.h || 900);
const out = args.out || 'shots/out.png';
const q = new URLSearchParams();
if (args.shot && args.shot !== 'game') q.set('shot', args.shot);
if (args.tod) q.set('tod', args.tod);
if (!args.play) q.set('frozen', '1');
if (args.q) for (const [k, v] of new URLSearchParams(args.q)) q.set(k, v);
const url = `${BASE}?${q}`;

fs.mkdirSync(path.dirname(out), { recursive: true });
// channel 'chromium' = full Chromium in new headless mode, which keeps hardware GPU acceleration
// (the default headless shell falls back to software WebGL).
const browser = await chromium.launch(launchOpts());
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 180000 });
try {
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000, polling: 250 });
} catch (e) { errors.push('timeout waiting for __ready'); }
const err = await page.evaluate(() => window.__error);
if (err) errors.push('[startup] ' + err);
const gpu = await page.evaluate(() => {
  const gl = window.__game?.renderer?.getContext?.() || document.createElement('canvas').getContext('webgl2');
  if (!gl) return 'no WebGL context';
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
});
console.log('GPU: ' + gpu);
if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) console.log('WARNING: software rendering, not the real GPU (try --headed)');
if (args.eval) await page.evaluate(args.eval);
if (args.play) await page.waitForTimeout(+args.play * 1000);
const frames = +(args.frames || 8);
await page.evaluate(n => new Promise(r => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), frames);
await page.evaluate(() => window.__game?.renderer?.setAnimationLoop(null));
await page.screenshot({ path: out, timeout: 0 });
console.log(`saved ${out} (${w}x${h}) in ${((Date.now() - t0) / 1000).toFixed(1)}s  url=${url}`);
if (errors.length) console.log('CONSOLE:\n' + [...new Set(errors)].slice(0, 30).join('\n'));
await browser.close();
