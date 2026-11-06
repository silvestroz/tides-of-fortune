// Loads dist/tides-of-fortune.html from file:// and screenshots the title menu and sailing.
// Fails on console errors or any network request other than Google Fonts.
import { chromium } from 'playwright';
import { BASE, PORT, launchOpts } from './_env.mjs';
import path from 'node:path';
import fs from 'node:fs';
const file = 'file://' + path.resolve('dist/tides-of-fortune.html');
fs.mkdirSync('shots/dist', { recursive: true });
const browser = await chromium.launch(launchOpts());
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [], external = [];
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { const u = r.url(); if (!/^(file:|data:|blob:)/.test(u) && !/fonts\.(googleapis|gstatic)\.com/.test(u)) external.push(u); });
await page.goto(file, { timeout: 300000 });
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 600000, polling: 500 });
const shot = async f => { await page.evaluate(() => __game.renderer.setAnimationLoop(null)); await page.screenshot({ path: f, timeout: 0 }); await page.evaluate(() => __game.renderer.setAnimationLoop(() => __game.frame())); };
await shot('shots/dist/title.png');
await page.click('.menu-layer [data-act="new"]', { force: true });
await page.click('.menu-layer [data-act="start"]', { force: true, timeout: 120000 });
await page.waitForFunction(() => __game.mode === 'sail', null, { timeout: 300000, polling: 500 });
await page.evaluate(() => { const g = __game; for (let i = 0; i < 60; i++) g.step(1 / 30); });
await page.waitForTimeout(3000);
await shot('shots/dist/sailing.png');
console.log(JSON.stringify({ mode: await page.evaluate(() => __game.mode), errors, external }));
await browser.close();
