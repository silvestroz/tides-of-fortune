// Builds the single-file distributable: dist/tides-of-fortune.html (vite build + vite-plugin-singlefile),
// then checks that the only external reference left is Google Fonts.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
execSync('npx vite build', { stdio: 'inherit' });
const src = 'dist/index.html', out = 'dist/tides-of-fortune.html';
fs.renameSync(src, out);
// the inlined game bundle (≈ 2 MB) lands in <head>: move it to the end of <body> so the loading screen (#boot) is parsed
// and painted while the file is still downloading (a module script is deferred anyway: execution order is unchanged)
{
  let h = fs.readFileSync(out, 'utf8');
  const i = h.indexOf('<script type="module"'), j = i < 0 ? -1 : h.indexOf('</script>', i), k = h.lastIndexOf('</body>');
  // plain slicing, never String.replace: the bundle is full of `$'` / `$&` sequences that replace() would expand
  if (i >= 0 && j > i && k > j) { const tag = h.slice(i, j + 9); h = h.slice(0, i) + h.slice(j + 9, k) + tag + '\n' + h.slice(k); fs.writeFileSync(out, h); }
}
for (const f of fs.readdirSync('dist')) if (f !== 'tides-of-fortune.html') fs.rmSync('dist/' + f, { recursive: true, force: true });
const html = fs.readFileSync(out, 'utf8');
const ext = [...html.matchAll(/(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+/g)].map(m => m[0]).filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u));
const rel = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)=["'](?!https?:|data:)[^"']+/g)].map(m => m[0]);
console.log(`${out}: ${(fs.statSync(out).size / 1048576).toFixed(2)} MB`);
if (ext.length || rel.length) { console.error('external refs left:', ext, rel); process.exit(1); }
