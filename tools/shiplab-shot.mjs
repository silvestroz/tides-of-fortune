// Captures of the ship workshop (tools/shiplab.html): node tools/shiplab-shot.mjs <folder> <type> [cam[:extra]…]
// Cams: quarter (default), side, stern, bow, head, deck, waist, top, rig, far; extra = more URL parameters
// (e.g. quarter:far=1). Prints the triangle counts of the hull geometry (near / far) and of the sails. Dev server: TOF_URL.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { BASE, launchOpts } from './_env.mjs';

const out = process.argv[2] || 'shots/shiplab', type = process.argv[3] || 'frigate';
const views = process.argv.slice(4).length ? process.argv.slice(4) : ['quarter', 'side', 'stern', 'bow', 'deck'];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(launchOpts(['--disable-dev-shm-usage']));
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));
for (const v of views) {
  const [cam, extra = ''] = v.split(':');
  const t0 = Date.now();
  await page.goto(`${BASE}tools/shiplab.html?type=${type}&cam=${cam}${extra ? '&' + extra : ''}`, { timeout: 120000 });
  await page.waitForFunction(() => window.__labReady, null, { timeout: 240000 });
  const info = await page.evaluate(() => window.__labInfo);
  await page.screenshot({ path: `${out}/${type}-${cam}${extra ? '-' + extra.replace(/[^a-z0-9]+/gi, '') : ''}.png` });
  console.log(`${type} ${cam}: ${info.tris} tris (far ${info.farTris}), sails ${info.sailTris}, ${info.verts} verts, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
console.log(errors.length ? 'ERRORS: ' + errors.slice(0, 5).join(' | ') : 'console clean');
await browser.close();
