// Frame pacer (src/core/framePacer.js) on synthetic displays, in node: no browser, no GPU.
// Each case drives FramePacer.tick() with rAF timestamps of a simulated display (refresh rate, timestamp jitter,
// per-frame work time: the next callback comes at the first refresh after the work is done) and checks the
// measured rate, the chosen cadence, the evenness of dt and that simulated time follows real time.
// The second half runs the pacer together with the dynamic resolution (src/core/dynres.js, on a stubbed window):
// frame cost = cpuMs + gpuMs x scale², so a lower scale only helps a GPU-bound machine.
// Usage: node tools/test-pacer.mjs
import { FramePacer } from '../src/core/framePacer.js';
import { DynRes } from '../src/core/dynres.js';

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
  check('simulated time follows real time (opening measure aside)', Math.abs(r.sim - r.real) < 0.25, `sim ${r.sim.toFixed(3)} s / real ${r.real.toFixed(3)} s`); }
{ const r = run({ hz: 144, workMs: 16 });
  check('144 Hz, slow GPU: true rate known from the opening measure, even 48 fps, no lower', r.pacer.hz === 144 && r.pacer.div === 3 && Math.abs(r.fps - 48) < 2 && r.gapSd < 0.5, `div ${r.pacer.div} fps ${r.fps.toFixed(1)} (hz read ${r.pacer.hz})`); }
{ const r = run({ hz: 144, workMs: 8.5, jitter: 0.1 });
  check('144 Hz, every frame late from the start: still read as 144 Hz', r.pacer.hz === 144 && r.pacer.div === 2, `hz ${r.pacer.hz} div ${r.pacer.div}`); }


// ---- pacer + dynamic resolution: resolution first, cadence second on fast screens ----
globalThis.innerWidth = 1920; globalThis.innerHeight = 1080;
globalThis.window = { devicePixelRatio: 1 }; globalThis.document = { hidden: false };

function runBoth({ hz, cpuMs, gpuMs, seconds = 60, mode = 'auto', query = '', stallAt = 0 }) {
  const P = 1000 / hz, pacer = new FramePacer({ mode });
  const game = { params: new URLSearchParams(query), quality: 'high', pacer, renderer: { setPixelRatio() {}, setSize() {} }, post: null };
  const dr = new DynRes(game);
  let t = 1000, shown = 0, t0 = 0, minScale = dr.scale;
  const cost = v => (typeof v === 'function' ? v(t) : v);
  while (t < 1000 + seconds * 1000) {
    if (stallAt && t > stallAt && t < stallAt + 10000) { t += 1017; pacer.tick(t); dr.frame(t); continue; }   // window covered: 1 frame/s
    const dt = pacer.tick(t + (rnd() - 0.5) * 0.3);
    let work = 0.2;
    if (dt >= 0) {
      dr.frame(t);
      work = (cost(cpuMs) + cost(gpuMs) * dr.scale * dr.scale) * (0.95 + rnd() * 0.1);
      if (t > 1000 + (seconds - 10) * 1000) { shown++; t0 ||= t; }
      minScale = Math.min(minScale, dr.scale);
    }
    t += Math.max(1, Math.ceil(work / P - 1e-9)) * P;
  }
  return { pacer, dr, fps: shown / ((t - t0) / 1000), minScale };
}
const info = r => `scale ${r.dr.scale} div ${r.pacer.div} fps ${r.fps.toFixed(0)}`;

{ const r = runBoth({ hz: 144, cpuMs: 2, gpuMs: 3 });
  check('144 Hz, room to spare: native scale, every refresh', r.dr.scale >= 1 && r.pacer.div === 1 && r.minScale >= 1, info(r)); }
{ const r = runBoth({ hz: 144, cpuMs: 2, gpuMs: 6.5 });
  check('144 Hz, GPU just short: a smaller render keeps 144 fps', r.dr.scale < 1 && r.dr.scale >= 0.8 && r.pacer.div === 1 && r.fps > 135, info(r)); }
{ const r = runBoth({ hz: 144, cpuMs: 2, gpuMs: 6.5, query: 'chase=0' });
  check('same machine, ?chase=0: half rate at native scale (previous behaviour)', r.dr.scale >= 1 && r.pacer.div === 2, info(r)); }
{ const r = runBoth({ hz: 144, cpuMs: 9, gpuMs: 2, seconds: 90 });
  check('144 Hz, CPU-bound: the scale cannot help, half rate, scale back to native', r.pacer.div === 2 && r.dr.scale >= 1, info(r)); }
{ const r = runBoth({ hz: 144, cpuMs: 2, gpuMs: 10, seconds: 90 });
  check('144 Hz, slow GPU: half rate, scale back up', r.pacer.div === 2 && r.dr.scale >= 1, info(r)); }
{ const r = runBoth({ hz: 144, cpuMs: 2, gpuMs: 8.5, mode: 'max', seconds: 40 });
  check('144 Hz, “max”: the scale goes as low as needed, never a skipped refresh', r.pacer.div === 1 && r.dr.scale <= 0.8 && r.fps > 135, info(r)); }
{ const r = runBoth({ hz: 144, cpuMs: 2, gpuMs: t => (t < 40000 ? 12 : 6.5), seconds: 200 });
  check('144 Hz, load eases later: back to every refresh at a smaller scale', r.pacer.div === 1 && r.fps > 135, info(r)); }
{ const r = runBoth({ hz: 60, cpuMs: 3, gpuMs: 15 });
  check('60 Hz, GPU just short: one step down keeps 60 fps (it used to settle at 30)', r.dr.scale === 0.9 && r.pacer.div === 1 && r.fps > 57, info(r)); }
{ const r = runBoth({ hz: 60, cpuMs: 3, gpuMs: 11 });
  check('60 Hz, room to spare: native scale', r.dr.scale >= 1 && r.pacer.div === 1 && r.minScale >= 1, info(r)); }
{ const r = runBoth({ hz: 60, cpuMs: 3, gpuMs: 6, stallAt: 20000, seconds: 31 });
  check('60 Hz, window covered for 10 s (1 frame/s): the scale does not drop', r.minScale >= 1, `min scale ${r.minScale}`); }

console.log(fail ? `\n${fail} failure(s)` : '\nall passed');
process.exit(fail ? 1 : 0);
