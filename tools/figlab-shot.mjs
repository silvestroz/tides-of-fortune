// Captures of the character workshop (tools/figlab.html): node tools/figlab-shot.mjs <folder> [view[:tod]…]
// Views: line (default), duel, faces, profile, crowd; tod: day | dusk | night. Dev server: TOF_URL.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { BASE, launchOpts } from './_env.mjs';

const out = process.argv[2] || 'shots/figlab';
const views = process.argv.slice(3).length ? process.argv.slice(3) : ['line', 'duel', 'faces', 'profile', 'crowd'];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(launchOpts(['--disable-dev-shm-usage']));
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));
for (const v of views) {
  const [view, tod = 'day', extra = ''] = v.split(':');   // extra: additional URL parameters, e.g. faces:day:olall=1
  const t0 = Date.now();
  await page.goto(`${BASE}tools/figlab.html?view=${view}&tod=${tod}${extra ? '&' + extra : ''}`, { timeout: 120000 });
  await page.waitForFunction(() => window.__labReady, null, { timeout: 240000 });
  const info = await page.evaluate(() => window.__labInfo);
  await page.screenshot({ path: `${out}/${view}${tod !== 'day' ? '-' + tod : ''}${extra ? '-' + extra.replace(/[^a-z0-9]+/gi, '') : ''}.png` });
  console.log(`${view}:${tod} ${Math.round(info.tris / 1000)} k tri, ${info.calls} draws, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
console.log(errors.length ? 'ERREURS : ' + errors.slice(0, 5).join(' | ') : 'console sans erreur');
await browser.close();
