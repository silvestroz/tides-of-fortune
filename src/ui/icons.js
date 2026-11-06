// Hand-drawn style inline SVG icons (currentColor ink). API: ICONS[name] -> svg markup string.
const S = (body, vb = '0 0 32 32') => `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  hull: S(`<path d="M3 15 H29 L25.5 24 C21 26.5 11 26.5 6.5 24 Z" fill="currentColor" fill-opacity="0.18"/><path d="M3 15 H29 L25.5 24 C21 26.5 11 26.5 6.5 24 Z"/>
    <path d="M5 19 H27" stroke-width="1.1"/><circle cx="11" cy="17.2" r="0.9" fill="currentColor"/><circle cx="16" cy="17.2" r="0.9" fill="currentColor"/><circle cx="21" cy="17.2" r="0.9" fill="currentColor"/>
    <path d="M16 15 V5 M16 6 L22 10 L16 11"/>`),
  sails: S(`<path d="M15 3 V28"/><path d="M15 5 C22 7 25 12 24.5 18 L15 18 Z" fill="currentColor" fill-opacity="0.18"/><path d="M15 5 C22 7 25 12 24.5 18 L15 18 Z"/>
    <path d="M15 20 C20 21 22 23 22 26 L15 26 Z" fill="currentColor" fill-opacity="0.18"/><path d="M15 20 C20 21 22 23 22 26 L15 26 Z"/><path d="M15 6 L8 17 H15" stroke-width="1.3"/>`),
  crew: S(`<circle cx="12" cy="9.5" r="3.6"/><path d="M5 26 C5 19 8 16 12 16 C16 16 19 19 19 26"/>
    <circle cx="21.5" cy="11" r="3"/><path d="M19.8 16.8 C23.8 16.4 27 19 27 25"/><path d="M8.5 7.6 C10 4.8 14 4.8 15.5 7.6 Z" fill="currentColor"/>`),
  gold: `<svg viewBox="0 0 32 32" aria-hidden="true"><defs><radialGradient id="cg" cx="0.38" cy="0.32" r="0.8"><stop offset="0" stop-color="#fff2b0"/><stop offset="0.45" stop-color="#d9a930"/><stop offset="1" stop-color="#6e4810"/></radialGradient></defs>
    <circle cx="16" cy="16" r="13" fill="url(#cg)" stroke="#4a3006" stroke-width="1.4"/><circle cx="16" cy="16" r="9.6" fill="none" stroke="#7a5212" stroke-width="1" stroke-dasharray="1.2 1.4"/>
    <path d="M16 9 V23 M12 12 H20 M12 20 H20" stroke="#5a3a08" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  // sail-setting glyphs: furled, battle, full
  furled: S(`<path d="M16 3 V29"/><path d="M8 9 H24" stroke-width="2.6"/><path d="M9 18 H23" stroke-width="2.6"/><path d="M9 9.2 C12 10.6 20 10.6 23 9.2" stroke-width="1"/><path d="M10 18.2 C13 19.6 19 19.6 22 18.2" stroke-width="1"/><path d="M11 26 C14 28 18 28 21 26" stroke-width="1.2"/>`),
  battle: S(`<path d="M16 3 V29"/><path d="M8 8 H24"/><path d="M8.5 8 C9 12 9 14 9.5 15.5 H22.5 C23 14 23 12 23.5 8" fill="currentColor" fill-opacity="0.22"/><path d="M8.5 8 C9 12 9 14 9.5 15.5 H22.5 C23 14 23 12 23.5 8"/><path d="M9 20 H23" stroke-width="2.6"/><path d="M11 26 C14 28 18 28 21 26" stroke-width="1.2"/>`),
  full: S(`<path d="M16 3 V29"/><path d="M8 5 H24"/><path d="M8.5 5 C7.5 9 8 11.5 9 13.5 H23 C24 11.5 24.5 9 23.5 5" fill="currentColor" fill-opacity="0.22"/><path d="M8.5 5 C7.5 9 8 11.5 9 13.5 H23 C24 11.5 24.5 9 23.5 5"/>
    <path d="M8 15 C6.5 19.5 7.5 23 9 25 H23 C24.5 23 25.5 19.5 24 15 Z" fill="currentColor" fill-opacity="0.22"/><path d="M8 15 C6.5 19.5 7.5 23 9 25 H23 C24.5 23 25.5 19.5 24 15 Z"/>`),
  // ammunition
  round: S(`<circle cx="16" cy="16" r="8.5" fill="currentColor" fill-opacity="0.85"/><circle cx="13" cy="13" r="2.2" fill="#fff" fill-opacity="0.35" stroke="none"/>`),
  chain: S(`<circle cx="7.5" cy="16" r="5" fill="currentColor" fill-opacity="0.85"/><circle cx="24.5" cy="16" r="5" fill="currentColor" fill-opacity="0.85"/><path d="M12.5 16 C14 13.5 15.5 18.5 16 16 C16.5 13.5 18 18.5 19.5 16" stroke-width="1.6"/>`),
  grape: S(`<circle cx="12" cy="12" r="3.6" fill="currentColor" fill-opacity="0.85"/><circle cx="20" cy="12" r="3.6" fill="currentColor" fill-opacity="0.85"/><circle cx="16" cy="18.5" r="3.6" fill="currentColor" fill-opacity="0.85"/><circle cx="9.5" cy="20" r="3.2" fill="currentColor" fill-opacity="0.85"/><circle cx="22.5" cy="20" r="3.2" fill="currentColor" fill-opacity="0.85"/><path d="M6 26 C12 29 20 29 26 26" stroke-width="1.2"/>`),
  // toast marks
  good: S(`<path d="M16 4 L19 12.5 L28 13 L21 18.5 L23.5 27.5 L16 22.5 L8.5 27.5 L11 18.5 L4 13 L13 12.5 Z" fill="currentColor" fill-opacity="0.25"/><path d="M16 4 L19 12.5 L28 13 L21 18.5 L23.5 27.5 L16 22.5 L8.5 27.5 L11 18.5 L4 13 L13 12.5 Z"/>`),
  bad: S(`<path d="M16 3 C17 9 21 10 22 14 C23 18 21 22 16 28 C11 22 9 18 10 14 C11 10 15 9 16 3Z" fill="currentColor" fill-opacity="0.3"/><path d="M16 3 C17 9 21 10 22 14 C23 18 21 22 16 28 C11 22 9 18 10 14 C11 10 15 9 16 3Z"/><path d="M16 13 V19 M16 22 V22.5" stroke-width="2.2"/>`),
  info: S(`<path d="M24 4 C17 8 10 16 7 27 L9 27.5 C12 19 17 12 26 6 Z" fill="currentColor" fill-opacity="0.25"/><path d="M24 4 C17 8 10 16 7 27"/><path d="M26 6 C20 10 15 15 11 22" stroke-width="1.2"/><path d="M5 28 H15" stroke-width="1.2"/>`),
  cannon: S(`<path d="M5 13 L23 10.5 C26 10.2 27.5 12 27.5 15 C27.5 18 26 19.8 23 19.5 L5 17 Z" fill="currentColor" fill-opacity="0.3"/><path d="M5 13 L23 10.5 C26 10.2 27.5 12 27.5 15 C27.5 18 26 19.8 23 19.5 L5 17 Z"/><circle cx="12" cy="22" r="4.5"/><circle cx="12" cy="22" r="1" fill="currentColor"/>`),
  // skills
  fencing: S(`<path d="M5 27 L23 9 L26 4 L21 7 L5 23" fill="currentColor" fill-opacity="0.2"/><path d="M5 27 L24 8"/><path d="M8.5 19.5 C11 22 11 22 12.5 23.5" stroke-width="2.4"/><path d="M27 27 L9 9 L6 4 L11 7 L27 23" stroke-width="1.3"/><path d="M23.5 19.5 C21 22 21 22 19.5 23.5" stroke-width="2.4"/>`),
  gunnery: null,
  navigation: S(`<circle cx="16" cy="16" r="12"/><path d="M16 5 L19 16 L16 27 L13 16 Z" fill="currentColor" fill-opacity="0.85"/><path d="M5 16 L16 13.5 L27 16 L16 18.5 Z" fill="currentColor" fill-opacity="0.25"/><circle cx="16" cy="16" r="1.5" fill="#fff"/>`),
  wit: S(`<path d="M10 7 C10 4.5 22 4.5 22 7 L21 12 H11 Z" fill="currentColor" fill-opacity="0.2"/><path d="M10 7 C10 4.5 22 4.5 22 7 L21 12 H11 Z"/><path d="M5 12.5 C9 11 23 11 27 12.5"/><path d="M11 18 C13 16.5 15 16.5 16 18 C17 16.5 19 16.5 21 18 C19 21 13 21 11 18Z" fill="currentColor"/><path d="M22 4 C25 1 28 3 27 6" stroke-width="1.2"/><path d="M9 25 C12 28 20 28 23 25"/>`),
  medicine: S(`<path d="M11 4 H21 V8 L24 12 V27 C24 28 23 29 22 29 H10 C9 29 8 28 8 27 V12 L11 8 Z" fill="currentColor" fill-opacity="0.15"/><path d="M11 4 H21 V8 L24 12 V27 C24 28 23 29 22 29 H10 C9 29 8 28 8 27 V12 L11 8 Z"/><path d="M16 15 V24 M11.5 19.5 H20.5" stroke-width="2.4"/><path d="M11 8 H21"/>`),
};
ICONS.gunnery = ICONS.cannon;

// Engraved flourish rule (used in sheets and the title).
export const RULE = `<svg class="rule" viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round">
  <path d="M10 10 H122"/><path d="M178 10 H290"/><path d="M122 10 C132 2 140 2 150 10 C160 18 168 18 178 10"/><path d="M122 10 C132 18 140 18 150 10 C160 2 168 2 178 10"/>
  <circle cx="150" cy="10" r="2.5" fill="currentColor"/><circle cx="104" cy="10" r="1.5" fill="currentColor"/><circle cx="196" cy="10" r="1.5" fill="currentColor"/></g></svg>`;
