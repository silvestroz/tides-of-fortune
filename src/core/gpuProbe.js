// Proposes (never applies) the 'ultra' quality tier when the GPU looks strong. installGpuProbe(game) once at start.
// Rule: the WebGL renderer string (WEBGL_debug_renderer_info) names a desktop-class GPU (GeForce RTX / GTX 10xx+ at
// 70/80 class, Radeon RX 5700+/6000+/7000+, Arc A7xx, Apple M Pro/Max/Ultra) AND, after 12 s of sailing in 'high', the
// game shows every refresh of the screen (game.pacer.div 1) with a smoothed frame interval under 1.05x the refresh
// period (vsync-bound: 17.5 ms at 60 Hz, 7.3 ms at 144 Hz) at a pixel ratio >= 1. Then one discreet message
// suggests Options > Graphismes > Ultra. Asked once per browser (localStorage 'tof.ultraOffer'); skipped for ?shot=,
// ?quality= and when the player already chose ultra or a lower tier than high.
const KEY = 'tof.ultraOffer';
const STRONG = /RTX\s*\d|GTX\s*1(07|08)0|RX\s*(5[7-9]|[6-9]\d)\d\d|Radeon Pro W|Arc\(TM\)?\s*A7|Arc A7|Apple M\d+\s*(Pro|Max|Ultra)/i;

export function gpuName(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch { return ''; }
}

export function installGpuProbe(game) {
  const p = game.params;
  if (p.get('shot') || p.get('quality')) return;
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
