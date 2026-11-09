// Frame pacer (src/core/framePacer.js) on synthetic displays, in node: no browser, no GPU.
// Each case drives FramePacer.tick() with rAF timestamps of a simulated display (refresh rate, timestamp jitter,
// per-frame work time: the next callback comes at the first refresh after the work is done) and checks the
// measured rate, the chosen cadence, the evenness of dt and that simulated time follows real time.
// Usage: node tools/test-pacer.mjs
import { FramePacer } from '../src/core/framePacer.js';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function run({ hz, workMs, jitter = 0.3, seconds = 20, mode = 'auto' }) {
  const P = 1000 / hz, pacer = new FramePacer({ mode });
  let t = 1000, sim = 0, shown = 0;
  const dts = [], gaps = [];
  let lastShown = 0;
  while (t < 1000 + seconds * 1000) {
    const ts = t + (rnd() - 0.5) * jitter;
    const dt = pacer.tick(ts);
    let work = 0.2;
    if (dt >= 0) {
      sim += dt; shown++;
      const w = typeof workMs === 'function' ? workMs(t) : workMs;
      work = w * (0.9 + rnd() * 0.2);
      if (t > 1000 + 12000) { dts.push(dt * 1000); if (lastShown) gaps.push(t - lastShown); }
      lastShown = t;
    }
    t += Math.max(1, Math.ceil(work / P - 1e-9)) * P;   // next refresh after the work
  }
  const real = (t - 1000) / 1000;
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
  return { pacer, real, sim, fps: shown / real, dtSd: sd(dts), gapSd: sd(gaps), gapMean: mean(gaps) };
}

let fail = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); if (!ok) fail++; };

{ const r = run({ hz: 60, workMs: 8 });
  check('60 Hz, fast GPU: 60 Hz measured, every refresh', r.pacer.hz === 60 && r.pacer.div === 1, `hz ${r.pacer.hz} div ${r.pacer.div} fps ${r.fps.toFixed(1)}`);
  check('60 Hz: dt even despite timestamp jitter', r.dtSd < 0.05, `sd ${r.dtSd.toFixed(3)} ms`); }
{ const r = run({ hz: 144, workMs: 4 });
  check('144 Hz, fast GPU: stays at 144', r.pacer.hz === 144 && r.pacer.div === 1, `hz ${r.pacer.hz} div ${r.pacer.div} fps ${r.fps.toFixed(1)}`);
  check('144 Hz: dt even', r.dtSd < 0.05, `sd ${r.dtSd.toFixed(3)} ms`); }
{ const r = run({ hz: 144, workMs: 7.2, seconds: 30 });
  check('144 Hz, GPU just short: even half rate (72 fps)', r.pacer.div === 2 && r.gapSd < 0.5, `div ${r.pacer.div} fps ${r.fps.toFixed(1)} gap sd ${r.gapSd.toFixed(2)} ms`); }
{ const r = run({ hz: 144, workMs: 7.2, seconds: 30, mode: 'max' });
  check('144 Hz, same GPU, “max”: every refresh, uneven gaps', r.pacer.div === 1 && r.gapSd > 1, `fps ${r.fps.toFixed(1)} gap sd ${r.gapSd.toFixed(2)} ms`); }
{ const r = run({ hz: 144, workMs: 3, mode: '60' });
  check('144 Hz, “60”: one image every 2 refreshes', r.pacer.div === 2 && Math.abs(r.fps - 72) < 2, `fps ${r.fps.toFixed(1)}`); }
{ const r = run({ hz: 240, workMs: 9, seconds: 40 });
  check('240 Hz, GPU at ~110 fps: divided cadence, >= 48 fps', r.pacer.div >= 2 && r.fps >= 48 && r.gapSd < 0.6, `div ${r.pacer.div} fps ${r.fps.toFixed(1)} gap sd ${r.gapSd.toFixed(2)}`); }
{ const r = run({ hz: 144, workMs: t => (t < 21000 ? 7.2 : 3), seconds: 160 });
  check('144 Hz, load drops later: back to full rate after a try', r.pacer.div === 1, `div ${r.pacer.div}`); }
{ const r = run({ hz: 144, workMs: 7.2, seconds: 60 });
  check('simulated time follows real time', Math.abs(r.sim - r.real) < 0.05, `sim ${r.sim.toFixed(3)} s / real ${r.real.toFixed(3)} s`); }
{ const r = run({ hz: 144, workMs: 16 });
  check('144 Hz, slow GPU: no division below 48 fps', r.fps > 40 && r.pacer.div === 1, `div ${r.pacer.div} fps ${r.fps.toFixed(1)} (hz read ${r.pacer.hz})`); }

console.log(fail ? `\n${fail} failure(s)` : '\nall passed');
process.exit(fail ? 1 : 0);
