// Keyboard + mouse state. Physical-position controls use codes; mnemonic commands use pressedKey('m').
// Use input.down('KeyW'), input.pressed('Space') (edge, this frame).
export class Input {
  constructor(dom) {
    this.keys = new Set();
    this.justPressed = new Set();
    this.justPressedKeys = new Set();   // e.key lowercased: layout-independent mnemonic commands
    this.mouse = { x: 0, y: 0, dx: 0, dy: 0, wheel: 0, buttons: 0, locked: false };
    addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (!this.keys.has(e.code)) { this.justPressed.add(e.code); if (e.key) this.justPressedKeys.add(e.key.toLowerCase()); }
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('mousemove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; });
    dom.addEventListener('mousedown', e => { this.mouse.buttons = e.buttons; this.justPressed.add('Mouse' + e.button); });
    addEventListener('mouseup', e => { this.mouse.buttons = e.buttons; });
    dom.addEventListener('wheel', e => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    dom.addEventListener('contextmenu', e => e.preventDefault());
  }
  down(code) { return this.keys.has(code); }
  pressed(code) { return this.justPressed.has(code); }
  // mnemonic command by character (M, T, C, F...) — works on AZERTY/QWERTZ etc.
  pressedKey(ch) { return this.justPressedKeys.has(ch.toLowerCase()); }
  endFrame() { this.justPressed.clear(); this.justPressedKeys.clear(); this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0; }
}
