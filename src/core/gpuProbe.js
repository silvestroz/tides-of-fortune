// Proposes (never applies) a quality tier that suits the machine better: 'ultra' when the GPU looks strong, Standard
// when 'ultra' does not hold. installGpuProbe(game) once at start.
// Rule: the WebGL renderer string (WEBGL_debug_renderer_info) names a desktop-class GPU (GeForce RTX / GTX 10xx+ at
// 70/80 class, Radeon RX 5700+/6000+/7000+, Arc A7xx, Apple M Pro/Max/Ultra) AND, after 12 s of sailing in 'high', the
// game shows every refresh of the screen (game.pacer.div 1) with a smoothed frame interval under 1.05x the refresh
// period (vsync-bound: 17.5 ms at 60 Hz, 7.3 ms at 144 Hz) at a pixel ratio >= 1. Then one discreet message
// suggests Options > Graphismes > Ultra. Asked once per browser (localStorage 'tof.ultraOffer'); skipped for ?shot=,
// ?quality= and when the player already chose ultra or a lower tier than high.
// The other way round, when the player runs 'ultra' and the machine cannot hold it: after 15 s of sailing, 20 s in a
// row spent below native scale with the cadence divided (or, on a screen under 75 Hz, frames 15 % longer than a
// refresh) bring one message suggesting Standard. Never applied for the player; asked once per browser
// ('tof.standardOffer'); skipped for ?shot=, ?quality=, ?dynres=0 / ?pr= and under the automated tools.
const KEY = 'tof.ultraOffer', KEY_DOWN = 'tof.standardOffer';
const STRONG = /RTX\s*\d|GTX\s*1(07|08)0|RX\s*(5[7-9]|[6-9]\d)\d\d|Radeon Pro W|Arc\(TM\)?\s*A7|Arc A7|Apple M\d+\s*(Pro|Max|Ultra)/i;

export function gpuName(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch { return ''; }
}

// true while 'ultra' is too much: rendering below native and still not at the screen's rate
function struggling(game) {
  const d = game.dynres, pacer = game.pacer;
  if (!d?.enabled || !pacer || d.scale > 0.95) return false;
  return pacer.div > 1 || d.ms > pacer.refreshMs * 1.15;
}

function installStandardHint(game) {
  let asked = false;
  try { asked = !!localStorage.getItem(KEY_DOWN); } catch { asked = true; }
  if (asked || navigator.webdriver || !game.dynres?.enabled) return;
  let sailT = 0, badT = 0;
  const id = setInterval(() => {
    if (game.mode !== 'sail' || document.hidden || game.frozen) return;
    sailT++;
    if (sailT < 15) return;
    badT = struggling(game) ? badT + 1 : 0;
    if (badT < 20) return;
    clearInterval(id);
    try { localStorage.setItem(KEY_DOWN, String(Date.now())); } catch { /* ignore */ }
    game.events.emit('notify', { text: 'The Ultra level is heavy for this machine: Standard will sail smoother (Options › Graphics).', kind: 'info', topic: 'info' });
  }, 1000);
}

export function installGpuProbe(game) {
  const p = game.params;
  if (p.get('shot') || p.get('quality')) return;
  if (game.quality === 'ultra') { installStandardHint(game); return; }
  let asked = false;
  try { asked = !!localStorage.getItem(KEY); } catch { asked = true; }
  if (asked || game.quality !== 'high') return;
  const name = gpuName(game.renderer);
  game.gpuName = name;
  if (!STRONG.test(name) || /swiftshader|llvmpipe|software/i.test(name)) return;
  let sailT = 0, last = performance.now();
  const tick = () => {
    const now = performance.now(), dt = (now - last) / 1000; last = now;
    if (game.mode === 'sail' && !document.hidden) sailT += Math.min(dt, 0.1);
    if (sailT < 12) { requestAnimationFrame(tick); return; }
    const ms = game.dynres?.ms ?? 99, pr = game.dynres?.scale ?? game.renderer.getPixelRatio(), pacer = game.pacer;
    const holds = pacer ? pacer.div === 1 && ms < pacer.refreshMs * 1.05 : ms < 17.5;
    if (holds && pr >= 0.99) {
      try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
      game.events.emit('notify', { text: 'Your graphics card has headroom: the Ultra level is available (Options › Graphics).', kind: 'info', topic: 'info' });
    }
  };
  requestAnimationFrame(tick);
}
