// Original stylized faction flags as inline SVG strings (waving swallow-free rectangle with cloth shading).
// API: flagSVG(faction, { w=60, h=40, wave=true }) -> svg markup string ; factionColor(faction)
import { FACTIONS } from '../core/constants.js';

export function factionColor(f) { return FACTIONS[f]?.color || '#6b5a44'; }

const FIELDS = {
  // English: crimson field, white-bordered cross in the canton
  english: `<rect width="60" height="40" fill="#b8242c"/>
    <rect x="0" y="0" width="26" height="18" fill="#f1e8d2"/>
    <rect x="11" y="0" width="4" height="18" fill="#b8242c"/><rect x="0" y="7" width="26" height="4" fill="#b8242c"/>`,
  // Spanish: saffron field with a ragged crimson saltire
  spanish: `<rect width="60" height="40" fill="#f1e2b8"/>
    <path d="M4 3 L56 37 M56 3 L4 37" stroke="#a5201f" stroke-width="5" stroke-linecap="round" stroke-dasharray="7 2.2"/>
    <circle cx="30" cy="20" r="4.5" fill="#e0b43a" stroke="#7a4f10" stroke-width="1"/>`,
  // French: royal blue with three gold lilies (stylised)
  french: `<rect width="60" height="40" fill="#2e5aa8"/>
    ${[[20, 13], [40, 13], [30, 28]].map(([x, y]) => `<g transform="translate(${x} ${y})" fill="#e7c25a">
      <path d="M0 -6 C2.4 -3 2.4 0 0 2.5 C-2.4 0 -2.4 -3 0 -6Z"/><path d="M0 1.5 C3 -2 6 -1 5 2.5 C3.5 1 2 1.8 0 3.5Z"/>
      <path d="M0 1.5 C-3 -2 -6 -1 -5 2.5 C-3.5 1 -2 1.8 0 3.5Z"/><rect x="-3.5" y="3" width="7" height="1.6"/></g>`).join('')}`,
  // Dutch: orange / white / blue tricolour
  dutch: `<rect width="60" height="14" fill="#e07a24"/><rect y="13" width="60" height="14" fill="#f1e8d2"/><rect y="26.5" width="60" height="13.5" fill="#2a4f8f"/>`,
  // Pirates: black field, bone-white skull over crossed cutlasses
  pirate: `<rect width="60" height="40" fill="#151515"/>
    <path d="M16 32 L44 10 M44 32 L16 10" stroke="#e9e1cc" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="30" cy="17" r="7" fill="#e9e1cc"/><rect x="26" y="21" width="8" height="5" rx="1" fill="#e9e1cc"/>
    <circle cx="27.3" cy="16.6" r="1.9" fill="#151515"/><circle cx="32.7" cy="16.6" r="1.9" fill="#151515"/>`,
};

let uid = 0;
export function flagSVG(faction, { w = 60, h = 40, wave = true } = {}) {
  const id = 'fl' + (++uid);
  const field = FIELDS[faction] || `<rect width="60" height="40" fill="${factionColor(faction)}"/>`;
  const clip = wave
    ? 'M0 2 C15 -1 25 5 40 2 C50 0 56 1 60 2 L60 38 C56 37 50 36 40 38 C25 41 15 35 0 38 Z'
    : 'M0 0 H60 V40 H0 Z';
  return `<svg class="flag" viewBox="0 0 60 40" width="${w}" height="${h}" aria-hidden="true">
    <defs><clipPath id="${id}c"><path d="${clip}"/></clipPath>
      <linearGradient id="${id}g" x1="0" x2="1">
        <stop offset="0" stop-color="#000" stop-opacity="0.18"/><stop offset="0.25" stop-color="#fff" stop-opacity="0.16"/>
        <stop offset="0.5" stop-color="#000" stop-opacity="0.14"/><stop offset="0.75" stop-color="#fff" stop-opacity="0.12"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.22"/></linearGradient></defs>
    <g clip-path="url(#${id}c)">${field}<rect width="60" height="40" fill="url(#${id}g)"/></g>
    <path d="${clip}" fill="none" stroke="#1c120a" stroke-opacity="0.55" stroke-width="1.2"/>
  </svg>`;
}
