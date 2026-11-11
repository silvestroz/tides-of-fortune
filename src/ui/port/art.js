// Hand-drawn SVG art for the port screens: location vignettes, goods glyphs, ship silhouettes, ornaments.
// API: VIGNETTE[loc] (svg), GOOD_ICON(good) (svg), SHIP_SIL(type) (svg), SEAL(text) (svg)
import { SHIP_TYPES } from '../../data/shipTypes.js';
import { GOOD_ART, VIGNETTE_ART } from '../paintedIcons.js';

const INK = '#2a1c10';

// --- location vignettes and goods glyphs: painted icons (paintedIcons.js), 32 x 32 -------------------
const ART = (cls, body) => `<svg viewBox="0 0 32 32" class="${cls}" aria-hidden="true">${body}</svg>`;
export const VIGNETTE = Object.fromEntries(Object.entries(VIGNETTE_ART).map(([k, v]) => [k, ART('vig', v)]));
const GOODS_SVG = Object.fromEntries(Object.entries(GOOD_ART).map(([k, v]) => [k, ART('gico', v)]));
// unknown good: a plain crate
const CRATE = ART('gico', `<g stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"><path d="M5 8 H27 V26 H5 Z" fill="#a88a5a"/><path d="M5 8 L27 26 M5 14 H27 M5 20 H27" stroke-width="0.8" fill="none"/></g>`);
export function GOOD_ICON(g) { return GOODS_SVG[g] || CRATE; }

// --- ship silhouettes (side elevation, 160x80) -------------------------------------------------
const SH = {
  sloop: { L: 70, masts: [[0.5, 46]], bow: 22, gun: 4 },
  schooner: { L: 84, masts: [[0.36, 48], [0.62, 52]], bow: 24, gun: 5 },
  brig: { L: 98, masts: [[0.34, 52], [0.64, 56]], bow: 22, gun: 7, square: true },
  merchantman: { L: 104, masts: [[0.3, 50], [0.55, 56], [0.78, 44]], bow: 16, gun: 4, square: true, fat: 1.25 },
  frigate: { L: 124, masts: [[0.26, 56], [0.52, 62], [0.78, 50]], bow: 20, gun: 12, square: true },
  galleon: { L: 132, masts: [[0.24, 56], [0.5, 64], [0.74, 52], [0.9, 38]], bow: 18, gun: 14, square: true, castle: true, fat: 1.3 },
};
// derived types reuse their base silhouette, scaled, with their own gun count / mast count
for (const [id, t] of Object.entries(SHIP_TYPES)) {
  if (SH[id]) continue;
  const b = SH[t.base], k = Math.min(1.2, Math.max(0.7, t.scale));
  SH[id] = { ...b, L: Math.round(b.L * k), masts: b.masts.slice(0, t.art?.masts || b.masts.length).map(([f, h]) => [f, Math.round(h * Math.sqrt(k))]),
    gun: Math.max(1, Math.round(t.guns / 3)), square: t.rig !== 'fore-aft' && b.square !== false ? (b.square ?? t.rig !== 'fore-aft') : false };
}
export function SHIP_SIL(type) {
  const s = SH[type] || SH.brig;
  const x0 = 80 - s.L / 2, x1 = 80 + s.L / 2, wl = 62, h = 10 * (s.fat || 1);
  let d = `<path d="M${x0} ${wl - h} L${x1 - s.bow} ${wl - h} L${x1 + 4} ${wl - h - 6} C${x1 - 4} ${wl + 2} ${x1 - 20} ${wl + 6} ${x0 + 14} ${wl + 5} C${x0 + 4} ${wl + 2} ${x0 - 2} ${wl - 4} ${x0} ${wl - h} Z" fill="#8a5a2b" fill-opacity="0.75"/>`;
  if (s.castle) d += `<path d="M${x0 - 2} ${wl - h} V${wl - h - 9} H${x0 + 26} V${wl - h}" fill="#8a5a2b" fill-opacity="0.75"/>`;
  else d += `<path d="M${x0 - 1} ${wl - h} V${wl - h - 4} H${x0 + 18} V${wl - h}" fill="#8a5a2b" fill-opacity="0.75"/>`;
  d += `<path d="M${x0 + 4} ${wl - h + 4} C${x0 + 30} ${wl - h + 6} ${x1 - 30} ${wl - h + 6} ${x1 - 6} ${wl - h + 3}" stroke="#c9a24a" stroke-width="1.6" fill="none"/>`;
  for (let i = 0; i < s.gun; i++) { const gx = x0 + 14 + i * ((s.L - 34) / Math.max(1, s.gun - 1)); d += `<rect x="${gx - 1.4}" y="${wl - h + 5.5}" width="2.8" height="2.4" fill="${INK}" stroke="none"/>`; }
  d += `<path d="M${x1 - s.bow + 6} ${wl - h - 2} L${x1 + 22} ${wl - h - 14}" stroke-width="1.3"/>`;
  for (const [f, mh] of s.masts) {
    const mx = x0 + s.L * f, top = wl - h - mh;
    d += `<path d="M${mx} ${wl - h} V${top}" stroke-width="1.6"/>`;
    if (s.square) {
      const w1 = mh * 0.42, w2 = mh * 0.32;
      d += `<path d="M${mx - w1} ${top + mh * 0.5} C${mx - w1 + 2} ${top + mh * 0.82} ${mx + w1 - 2} ${top + mh * 0.82} ${mx + w1} ${top + mh * 0.5} L${mx + w1 - 3} ${top + mh * 0.85} H${mx - w1 + 3} Z" fill="#efe3c2" fill-opacity="0.9"/>`;
      d += `<path d="M${mx - w2} ${top + mh * 0.14} C${mx - w2 + 2} ${top + mh * 0.42} ${mx + w2 - 2} ${top + mh * 0.42} ${mx + w2} ${top + mh * 0.14} L${mx + w2 - 2} ${top + mh * 0.45} H${mx - w2 + 2} Z" fill="#efe3c2" fill-opacity="0.9"/>`;
    } else {
      d += `<path d="M${mx + 1} ${top + 3} C${mx + mh * 0.5} ${top + mh * 0.35} ${mx + mh * 0.62} ${top + mh * 0.7} ${mx + mh * 0.6} ${wl - h - 4} L${mx + 1} ${wl - h - 4} Z" fill="#efe3c2" fill-opacity="0.9"/>`;
    }
    d += `<path d="M${mx} ${top} l7 2 l-7 2.5" fill="#b8242c" fill-opacity="0.85" stroke-width="0.6"/>`;
  }
  d += `<path d="M6 ${wl + 3} C30 ${wl} 50 ${wl + 6} 80 ${wl + 3} C110 ${wl} 130 ${wl + 6} 154 ${wl + 3}" stroke-width="0.8" opacity="0.6" fill="none"/>`;
  d += `<path d="M20 ${wl + 9} C40 ${wl + 6} 60 ${wl + 11} 90 ${wl + 8} C110 ${wl + 6} 126 ${wl + 10} 140 ${wl + 9}" stroke-width="0.6" opacity="0.4" fill="none"/>`;
  return `<svg viewBox="0 0 160 80" class="shipsil" aria-hidden="true"><g stroke="${INK}" stroke-width="1" stroke-linejoin="round" stroke-linecap="round">${d}</g></svg>`;
}

// --- ornaments --------------------------------------------------------------------------------
export function SEAL(letter = 'T', color = '#8e1b1b') {
  return `<svg viewBox="0 0 64 64" class="seal" aria-hidden="true"><defs><radialGradient id="sl${letter}" cx="0.38" cy="0.32" r="0.8"><stop offset="0" stop-color="#d0564a"/><stop offset="0.55" stop-color="${color}"/><stop offset="1" stop-color="#4a0808"/></radialGradient></defs>
    <path d="M32 3 C38 6 42 2 47 7 C51 11 57 10 58 17 C60 23 63 26 60 32 C58 38 62 42 57 47 C53 51 54 57 47 58 C41 60 38 63 32 60 C26 63 22 59 17 58 C11 56 10 51 7 47 C3 42 5 37 4 32 C2 26 6 22 7 17 C9 11 13 9 17 7 C23 3 26 6 32 3Z" fill="url(#sl${letter})"/>
    <circle cx="32" cy="32" r="19" fill="none" stroke="#4a0808" stroke-width="1.6" opacity="0.7"/><circle cx="32" cy="32" r="16" fill="none" stroke="#e07a6a" stroke-width="0.6" opacity="0.5"/>
    <text x="32" y="40" text-anchor="middle" font-family="IM Fell English SC, Georgia, serif" font-size="22" fill="#4a0808" opacity="0.85">${letter}</text></svg>`;
}

// small ink glyphs for the ledger strip / rows
const I = (b) => `<svg viewBox="0 0 24 24" class="ig" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${b}</g></svg>`;
export const GLYPH = {
  hold: I(`<path d="M3 9 L12 4 L21 9 V19 L12 22 L3 19 Z"/><path d="M3 9 L12 13 L21 9 M12 13 V22"/>`),
  morale: I(`<path d="M12 20 C6 15 3 12 3 8.5 C3 5.5 5.5 3.5 8 3.5 C10 3.5 11.2 4.6 12 6 C12.8 4.6 14 3.5 16 3.5 C18.5 3.5 21 5.5 21 8.5 C21 12 18 15 12 20Z" fill="currentColor" fill-opacity="0.2"/>`),
  food: I(`<path d="M6 4 H18 C20 8 20 16 18 20 H6 C4 16 4 8 6 4Z"/><path d="M4.6 9 H19.4 M4.6 15 H19.4"/>`),
  crew: I(`<circle cx="9" cy="7" r="3"/><path d="M3 20 C3 14 6 12 9 12 C12 12 15 14 15 20"/><circle cx="17" cy="8.5" r="2.4"/><path d="M15.5 12.8 C18.8 12.6 21 14.6 21 19"/>`),
  calendar: I(`<rect x="3.5" y="5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5 H20.5 M8 3 V7 M16 3 V7"/>`),
  profit: I(`<path d="M3 18 L9 12 L13 15 L21 6"/><path d="M15 6 H21 V12"/>`),
  anchor: I(`<circle cx="12" cy="5" r="2"/><path d="M12 7 V21 M7 11 H17 M4 14 C4 19 8 21 12 21 C16 21 20 19 20 14"/><path d="M2.5 15.5 L4 13.5 L5.5 15.5 M18.5 15.5 L20 13.5 L21.5 15.5"/>`),
  hammer: I(`<path d="M4 20 L14 10"/><path d="M12 6 L16 2 L22 8 L18 12 Z" fill="currentColor" fill-opacity="0.2"/>`),
  scroll: I(`<path d="M6 4 H17 C19 4 19 7 17 7 H8 V18 C8 21 4 21 4 18 V6 C4 4.5 5 4 6 4Z"/><path d="M8 18 H18 C20 18 20 21 18 21 H6"/><path d="M11 10 H16 M11 13 H16"/>`),
  mug: I(`<path d="M5 6 H15 V20 H5 Z"/><path d="M15 9 C19 9 19 16 15 16"/><path d="M5 6 C5 3 15 3 15 6"/>`),
  rumor: I(`<path d="M4 5 H20 V15 H11 L6 19 V15 H4 Z"/><path d="M8 9 H16 M8 12 H13"/>`),
  x: I(`<path d="M6 6 L18 18 M18 6 L6 18" stroke-width="2.2"/>`),
};

// --- speaker portraits (painted medallion, 100x100) ------------------------------------------------
// PORTRAIT(role, seed): role = merchant|tavern|shipyard|governor|bank|guard|council. Deterministic per seed.
// opts.img: a bust painted from the 3D character (portrait3d.js) instead of the vector drawing; the medallion's
// background, halo and frame stay the same
export function PORTRAIT(role, seed = 0, opts = {}) {
  const h = (seed >>> 0) || 1;
  const skin = ['#e6b994', '#cf9a74', '#b07a52', '#8a5636', '#ecc6a4'][h % 5];
  const hair = ['#2a1a10', '#4a2a14', '#7a5a30', '#9a948a', '#1a1410'][(h >> 3) % 5];
  const bg = { merchant: ['#6e3a1c', '#2a1408'], tavern: ['#8a4a14', '#2a1206'], tavernw: ['#8a4a14', '#2a1206'], shipyard: ['#4a5a5e', '#161c1e'], governor: ['#6a1a1a', '#200606'], bank: ['#3a4a2a', '#10160a'], guard: ['#3a3a44', '#0e0e14'], council: ['#2a2a2a', '#080808'] }[role] || ['#5a3a1c', '#1a0e06'];
  const id = 'pp' + role + (h % 997);
  const coat = { merchant: '#2c4a6a', tavern: '#e8dcc0', tavernw: '#5a2a3a', shipyard: '#6a4a2a', governor: '#9a1e1e', bank: '#2a2a30', guard: '#8e1b1b', council: '#3a2a1a' }[role] || '#5a3a1c';
  let body = `<path d="M14 100 C14 80 30 72 50 72 C70 72 86 80 86 100Z" fill="${coat}"/><path d="M14 100 C14 80 30 72 50 72 C70 72 86 80 86 100Z" fill="url(#${id}s)"/>`;
  let head = '', top = '', extra = '';
  if (role === 'governor') {        // powdered wig, lace jabot, gold frogging
    top = `<path d="M28 44 C24 20 76 20 72 44 C76 52 74 62 70 66 C68 56 66 46 64 40 C56 34 44 34 36 40 C34 46 32 56 30 66 C26 62 24 52 28 44Z" fill="#ece6da"/><path d="M30 50 C26 54 26 60 30 64 M70 50 C74 54 74 60 70 64" stroke="#b8b0a2" stroke-width="2" fill="none"/>`;
    extra = `<path d="M44 72 L50 90 L56 72 C54 76 46 76 44 72Z" fill="#f6f0e2"/><path d="M30 82 H40 M30 87 H40 M60 82 H70 M60 87 H70" stroke="#e8c470" stroke-width="2"/>`;
  } else if (role === 'tavern') {   // bald, apron, mug-flushed cheeks
    top = `<path d="M33 40 C33 26 67 26 67 40" fill="${skin}"/><path d="M31 44 C30 38 33 36 35 40 M69 44 C70 38 67 36 65 40" stroke="${hair}" stroke-width="4" fill="none"/>`;
    extra = `<path d="M38 74 H62 V100 H38Z" fill="#f2ead6"/><path d="M38 74 L30 72 M62 74 L70 72" stroke="#c9b890" stroke-width="2"/><circle cx="39" cy="52" r="3.5" fill="#d0503a" opacity="0.35"/><circle cx="61" cy="52" r="3.5" fill="#d0503a" opacity="0.35"/>`;
  } else if (role === 'tavernw') {  // headscarf, curls, apron
    top = `<path d="M30 44 C26 22 74 22 70 44 C68 34 32 34 30 44Z" fill="#a8302a"/><path d="M31 44 C28 52 30 60 33 64 M69 44 C72 52 70 60 67 64" stroke="${hair}" stroke-width="5" fill="none"/><circle cx="68" cy="30" r="3" fill="#a8302a"/>`;
    extra = `<path d="M38 74 H62 V100 H38Z" fill="#f2ead6"/><path d="M40 74 C44 70 56 70 60 74" stroke="#c9b890" stroke-width="2" fill="none"/><circle cx="40" cy="54" r="3.2" fill="#d0503a" opacity="0.3"/><circle cx="60" cy="54" r="3.2" fill="#d0503a" opacity="0.3"/>`;
  } else if (role === 'shipyard') { // knitted cap, leather apron
    top = `<path d="M30 38 C30 18 70 18 70 38 Z" fill="#8e3a24"/><path d="M29 38 H71 V42 H29Z" fill="#6a2a18"/>`;
    extra = `<path d="M40 76 H60 L62 100 H38Z" fill="#4a2e18"/><path d="M36 64 C40 70 60 70 64 64 C60 76 40 76 36 64Z" fill="${hair}"/>`;
  } else if (role === 'bank') {     // spectacles, quill behind ear
    top = `<path d="M32 40 C32 24 68 24 68 40 C64 34 36 34 32 40Z" fill="${hair}"/>`;
    extra = `<circle cx="43" cy="49" r="5" fill="none" stroke="#c9a24a" stroke-width="1.6"/><circle cx="57" cy="49" r="5" fill="none" stroke="#c9a24a" stroke-width="1.6"/><path d="M48 49 H52" stroke="#c9a24a" stroke-width="1.4"/><path d="M68 40 L80 18" stroke="#f2ead6" stroke-width="3"/><path d="M44 72 L50 82 L56 72Z" fill="#f2ead6"/>`;
  } else if (role === 'guard') {    // morion helmet
    top = `<path d="M24 40 C30 34 70 34 76 40 C70 42 30 42 24 40Z" fill="#9aa0a8"/><path d="M32 38 C32 20 68 20 68 38Z" fill="#b8bec6"/><path d="M50 16 V24" stroke="#9aa0a8" stroke-width="3"/>`;
    extra = `<path d="M36 64 C40 70 60 70 64 64 C60 72 40 72 36 64Z" fill="${hair}"/>`;
  } else if (role === 'council') {  // tricorne, eyepatch
    top = `<path d="M22 36 C30 24 70 24 78 36 C66 32 34 32 22 36Z" fill="#1e1612"/><path d="M34 32 C36 16 64 16 66 32Z" fill="#1e1612"/><path d="M40 28 H60" stroke="#c9a24a" stroke-width="1.4"/>`;
    extra = `<path d="M38 46 L62 44" stroke="#120a06" stroke-width="1.4"/><ellipse cx="43" cy="49" rx="4.5" ry="4" fill="#120a06"/><path d="M36 62 C40 72 60 72 64 62 C60 68 40 68 36 62Z" fill="${hair}"/>`;
  } else {                          // merchant: wide hat, moustache, neck scarf
    top = `<path d="M20 34 C30 30 70 30 80 34 C70 37 30 37 20 34Z" fill="#5a3a1c"/><path d="M34 33 C34 18 66 18 66 33Z" fill="#6e4a24"/><path d="M34 31 H66" stroke="#b8242c" stroke-width="2.4"/>`;
    extra = `<path d="M42 59 C46 56 54 56 58 59 C54 58 46 58 42 59Z" fill="${hair}" stroke="${hair}" stroke-width="2"/><path d="M40 72 C46 78 54 78 60 72 L56 82 H44Z" fill="#c9a24a"/>`;
  }
  head = `<path d="M44 64 H56 V76 H44Z" fill="${skin}"/><ellipse cx="50" cy="50" rx="16" ry="19" fill="${skin}"/><ellipse cx="50" cy="50" rx="16" ry="19" fill="url(#${id}f)"/>
    <ellipse cx="43" cy="49" rx="1.8" ry="1.5" fill="#1a0e08"/><ellipse cx="57" cy="49" rx="1.8" ry="1.5" fill="#1a0e08"/><path d="M40 44 Q43 42 46 44 M54 44 Q57 42 60 44" stroke="${hair}" stroke-width="1.6" fill="none"/>
    <path d="M50 50 L48 57 H52" stroke="#7a4a30" stroke-width="1.1" fill="none"/><path d="M45 62 Q50 64.5 55 62" stroke="#6a2a20" stroke-width="1.3" fill="none"/>`;
  return `<svg viewBox="0 0 100 100" class="portrait" aria-hidden="true"><defs>
    <radialGradient id="${id}b" cx="0.4" cy="0.35" r="0.8"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></radialGradient>
    <radialGradient id="${id}f" cx="0.35" cy="0.3" r="0.9"><stop offset="0" stop-color="#fff2d8" stop-opacity="0.35"/><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#3a1a08" stop-opacity="0.35"/></radialGradient>
    <linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0.18"/><stop offset="0.5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></linearGradient>
    <radialGradient id="${id}v" cx="0.5" cy="0.45" r="0.6"><stop offset="0.7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#140a04" stop-opacity="0.55"/></radialGradient>
    <clipPath id="${id}c"><circle cx="50" cy="50" r="46"/></clipPath></defs>
    <circle cx="50" cy="50" r="46" fill="url(#${id}b)"/><g clip-path="url(#${id}c)"><circle cx="34" cy="30" r="22" fill="#ffd890" opacity="0.12"/>${opts.img ? `<image href="${opts.img}" x="-6" y="-2" width="112" height="112" preserveAspectRatio="xMidYMid slice"/><circle cx="50" cy="50" r="46" fill="url(#${id}v)"/>` : `${body}${head}${top}${extra}`}</g>
    <circle cx="50" cy="50" r="46" fill="none" stroke="#2a1806" stroke-width="3"/><circle cx="50" cy="50" r="48.5" fill="none" stroke="#d9b55a" stroke-width="2.2"/></svg>`;
}
