// Keyboard-layout-aware key labels.
// Physical-position controls are bound by KeyboardEvent.code (KeyW = the key where W sits on QWERTY, i.e. Z on AZERTY).
// keyLabel(code) -> the character printed on that key for the player's layout ('KeyW' -> 'Z' on AZERTY).
// kc(code, cls='kc') -> '<span class="kc" data-code="KeyW">Z</span>' (auto-relabelled when the layout resolves).
// isKey(e, ch) -> true if the keydown produced character ch (mnemonic commands: M, T, C, F...).
// Resolution: navigator.keyboard.getLayoutMap() (Chrome/Edge) → else first keydown with a code/key mismatch
// → else navigator.language 'fr' (AZERTY guess). On change, every [data-code] element in the document is relabelled
// and window 'keys:layout' fires.
const QWERTY = c => c.startsWith('Key') ? c.slice(3) : c.startsWith('Digit') ? c.slice(5) : ({ Space: 'Space', Escape: 'Esc', Semicolon: ';', Comma: ',' }[c] || c);
// labels of keys outside the letter rows (arrows, numpad, right Ctrl / Shift)
const SPECIAL = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', ControlRight: 'Right Ctrl', ShiftRight: 'Right Shift',
  Backspace: 'Backspace', NumpadSubtract: 'Num −', NumpadAdd: 'Num +', NumpadEnter: 'Enter' };
const AZERTY = { KeyQ: 'A', KeyA: 'Q', KeyW: 'Z', KeyZ: 'W', KeyM: ',', Semicolon: 'M' };
let map = null;            // code -> char from getLayoutMap
let layout = (typeof navigator !== 'undefined' && /^fr\b|^fr-(FR|BE)/i.test(navigator.language || '')) ? 'azerty' : 'qwerty';

export function keyLabel(code) {
  if (SPECIAL[code]) return SPECIAL[code];
  if (/^Numpad\d$/.test(code)) return 'Num ' + code.slice(6);
  const m = map?.get?.(code);
  if (m && m.length === 1) return m.toUpperCase();
  if (layout === 'azerty' && AZERTY[code]) return AZERTY[code];
  return QWERTY(code);
}
export function kc(code, cls = 'kc') { return `<span class="${cls}" data-code="${code}">${keyLabel(code)}</span>`; }
export function isKey(e, ch) { return (e.key || '').toLowerCase() === ch.toLowerCase(); }
export function currentLayout() { return map ? 'detected' : layout; }

function relabel() {
  if (typeof document === 'undefined') return;
  for (const el of document.querySelectorAll('[data-code]')) el.textContent = keyLabel(el.dataset.code);
  dispatchEvent(new CustomEvent('keys:layout', { detail: { layout: currentLayout() } }));
}
if (typeof window !== 'undefined') {
  navigator.keyboard?.getLayoutMap?.().then(m => { map = m; relabel(); }).catch(() => {});
  if (layout === 'azerty') queueMicrotask(relabel);
  const probe = e => {
    if (map || !e.key || e.key.length !== 1) return;
    const k = e.key.toLowerCase(), c = e.code;
    let l = null;
    if ((c === 'KeyQ' && k === 'a') || (c === 'KeyW' && k === 'z') || (c === 'KeyA' && k === 'q') || (c === 'KeyZ' && k === 'w')) l = 'azerty';
    else if (/^Key[A-Z]$/.test(c) && k === c.slice(3).toLowerCase() && 'qwaz'.includes(k)) l = 'qwerty';
    if (l && l !== layout) { layout = l; relabel(); }
  };
  addEventListener('keydown', probe, true);
}
