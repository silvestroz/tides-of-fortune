// English typography check of the DISPLAYED strings (heuristic, gives false positives).
// Usage: node tools/typo-check.mjs [files or folders…]   (default: src/)   [--all] also list the low-confidence cases
//        [--count] only print the number of suspects per file
// Rules: no space before ; : ! ? and %, quotes “ ” (never « »); the narrow no-break space U+202F only
// sits between a number and its unit (500 m, 12 kn).
// How: a small JS tokenizer keeps only string literals and the text parts of template literals (the ${…} code is
// skipped), strips HTML tags and entities, then flags “word :” / “word !” / “45 %” / « » left over from French.
// False positives to expect (check every case by eye, never bulk-replace):
//   CSS inside strings ('color : red'), selectors, URLs and query strings ('?shot='), keys / ids, regexes written as
//   strings; the « » glyphs used as arrow buttons in the transfer panels.
// Confidence: 'high' = a letter before the sign in prose; 'low' = the rest (shown with --all).
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const ALL = args.includes('--all'), COUNT = args.includes('--count');
const roots = args.filter(a => !a.startsWith('--'));
if (!roots.length) roots.push('src');

const files = [];
const walk = p => {
  const st = fs.statSync(p);
  if (st.isDirectory()) { for (const f of fs.readdirSync(p)) if (f !== 'node_modules' && !f.startsWith('.')) walk(path.join(p, f)); }
  else if (/\.(m?js)$/.test(p)) files.push(p);
};
roots.forEach(walk);

// ---- tokenizer: yields { text, line, col } for each string chunk ----
function strings(src) {
  const out = [];
  // names bound to the narrow space in this file: const NB = '\u202f' (or the literal character)
  const names = [...src.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*['"](?:\\u202f|\u202f)['"]/gi)].map(m => m[1]);
  const nnRx = new RegExp(`^\\s*(?:['"](?:\\\\u202f|\u202f)['"]|${['NNBSP', 'NARROW', 'NBSP', ...names].join('|')})\\s*$`, 'i');
  let i = 0, line = 1, lineStart = 0, lastSig = '';      // lastSig: last significant code char (regex heuristic)
  const n = src.length;
  const tplStack = [];                                     // brace depth for each open template ${
  let braceDepth = 0;
  const nl = c => { if (c === '\n') { line++; lineStart = i + 1; } };
  const readQuoted = q => {                                // i on the opening quote
    const l0 = line, c0 = i - lineStart + 1; let s = ''; i++;
    while (i < n && src[i] !== q) {
      if (src[i] === '\\') { s += src.slice(i, i + 2); i += 2; continue; }
      if (src[i] === '\n') break;                          // unterminated: bail
      s += src[i]; i++;
    }
    i++; out.push({ text: s, line: l0, col: c0 });
  };
  // a template literal is kept whole: its ${…} parts become \u0000 (nested templates are separate items)
  const readTemplate = acc => {                          // i just after ` or after the } closing a ${…}
    while (i < n) {
      const c = src[i];
      if (c === '\\') { acc.text += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { i++; out.push(acc); return 'end'; }
      if (c === '$' && src[i + 1] === '{') { i += 2; acc.exprAt = i; return 'expr'; }
      nl(c); acc.text += c; i++;
    }
    out.push(acc); return 'end';
  };
  while (i < n) {
    const c = src[i];
    if (c === '\n') { nl(c); i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { nl(src[i]); i++; } i += 2; continue; }
    if (c === '/' && (!lastSig || /[(,=:[!&|?{};+\-*%<>~^]/.test(lastSig) || /\b(return|typeof|case|in|of)$/.test(src.slice(Math.max(0, i - 8), i).trimEnd()))) {
      // regex literal
      i++; let cls = false;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false;
        else if (src[i] === '/' && !cls) { i++; break; }
        i++;
      }
      while (/[a-z]/i.test(src[i] || '')) i++;
      lastSig = 'x'; continue;
    }
    if (c === '"' || c === "'") { readQuoted(c); lastSig = 'x'; continue; }
    if (c === '`') {
      const acc = { text: '', line, col: i - lineStart + 1 }; i++;
      if (readTemplate(acc) === 'expr') { tplStack.push({ depth: braceDepth, acc }); braceDepth++; }
      lastSig = 'x'; continue;
    }
    if (c === '{') { braceDepth++; lastSig = c; i++; continue; }
    if (c === '}') {
      braceDepth--;
      if (tplStack.length && tplStack[tplStack.length - 1].depth === braceDepth) {
        const { acc } = tplStack.pop();
        // ${NNBSP} / ${'\u202f'} count as the narrow space itself; any other expression is a \u0000 placeholder
        acc.text += nnRx.test(src.slice(acc.exprAt, i)) ? '\u202f' : '\u0000'; i++;
        if (readTemplate(acc) === 'expr') { tplStack.push({ depth: braceDepth, acc }); braceDepth++; }
        lastSig = 'x'; continue;
      }
      lastSig = c; i++; continue;
    }
    lastSig = /[\w$)\]]/.test(c) ? 'x' : c; i++;
  }
  return out;
}

// ---- checks on one string chunk ----
const NARROW = ' ', NBSP = ' ';
function check(raw) {
  // drop HTML tags (attributes hold CSS), entities, escaped unicode written in source
  // tooltips and labels are displayed too: keep their text before the tags are dropped
  const attrs = [...raw.matchAll(/\b(?:title|aria-label|placeholder|alt)="([^"]*)"/g)].map(m => m[1]).join(' · ');
  let t = (raw + (attrs ? ' · ' + attrs : '')).replace(/\\u202f/gi, NARROW).replace(/\\u00a0/gi, NBSP).replace(/\\n/g, ' ')
    .replace(/<[^<>]*>/g, ' ').replace(/&nbsp;/g, NBSP).replace(/&#8239;|&#x202f;/gi, NARROW).replace(/&[a-z]+;/gi, 'x');
  const hits = [];
  if (/\b(uniform|varying|vec[234]|gl_Position|gl_FragColor|void main|precision (high|medium)p)\b|#include/.test(raw)) return hits;   // GLSL
  if (!/[a-z]{2,}/i.test(t)) return hits;                                 // no word: not prose
  if (/^[\w$.-]+$/.test(t.trim())) return hits;                           // identifier / key
  if (/^\s*(https?:|data:|#|\.|\[)/.test(t)) return hits;
  const prose = /[a-z]{2,}[\s  ][a-z]{2,}/i.test(t);
  // a space (ordinary, no-break or narrow) before ; : ! ? — French spacing in English text
  const re = /([^\s  ])([\s  ]+)([;:!?])/g;
  let m;
  while ((m = re.exec(t))) {
    const [all, before, sp, sign] = m, idx = m.index + all.length - 1, after = t[idx + 1] ?? '';
    if (sign === '?' && after && !/[\s  )"'”\u0000]/.test(after)) continue;   // ' ?a=b', ' ?.'
    if (sign === ':' && /^\d/.test(after)) continue;                                     // 12 :30
    const letter = /[a-z0-9)”\u0000]/i.test(before);
    const conf = letter && prose ? 'high' : 'low';
    const kind = sp.includes(NARROW) ? 'narrow' : sp.includes(NBSP) ? 'nbsp' : 'space';
    hits.push({ sign, kind, conf, at: idx });
  }
  // a space before % after a number (write 45%)
  for (const k of t.matchAll(/(\d|\u0000)([\s  ]+)%/g)) hits.push({ sign: '%', kind: k[2].includes(NARROW) ? 'narrow' : 'space', conf: prose ? 'high' : 'low', at: k.index + k[0].length - 1 });
  // French guillemets: English text uses “ ” (and ‘ ’)
  for (let k = 0; k < t.length; k++) if (t[k] === '«' || t[k] === '»') hits.push({ sign: t[k], kind: 'quote', conf: 'high', at: k });
  return hits.map(h => ({ ...h, ctx: t.slice(Math.max(0, h.at - 28), h.at + 12).replace(/\u0000/g, '${…}').replace(/ /g, '·').replace(/\s+/g, ' ') }));
}

let total = 0, totalLow = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const rows = [];
  for (const s of strings(src)) for (const h of check(s.text)) rows.push({ ...h, line: s.line });
  const hi = rows.filter(r => r.conf === 'high'), lo = rows.filter(r => r.conf === 'low');
  total += hi.length; totalLow += lo.length;
  if (COUNT) { if (rows.length) console.log(`${String(hi.length).padStart(4)} ${String(lo.length).padStart(4)}  ${f}`); continue; }
  const show = ALL ? rows : hi;
  if (!show.length) continue;
  console.log(`\n${f}`);
  for (const r of show) console.log(`  ${String(r.line).padStart(5)}  ${r.conf === 'high' ? ' ' : '?'} ${r.sign} (${r.kind.padEnd(5)})  …${r.ctx}…`);
}
console.log(`\n${total} likely cases${ALL ? `, ${totalLow} doubtful` : ` (+ ${totalLow} doubtful: --all)`}. False positives are possible: check every case by eye.`);
console.log('English typography: no space before ; : ! ? %, quotes “ ”; U+202F only between a number and its unit.');
