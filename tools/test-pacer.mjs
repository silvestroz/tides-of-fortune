// Frame pacer (src/core/framePacer.js) on synthetic displays, in node: no browser, no GPU.
// Each case drives FramePacer.tick() with rAF timestamps of a simulated display (refresh rate, timestamp jitter,
// per-frame work time: the next callback comes at the first refresh after the work is done) and checks the
// measured rate, the chosen cadence, the evenness of dt and that simulated time follows real time.
// The displays are also given the timestamp jitter measured on a 120 Hz laptop panel (MEASURED below), a display
// that changes while the game runs, and rates outside the usual list.
// The second half runs the pacer together with the dynamic resolution (src/core/dynres.js, on a stubbed window):
// frame cost = cpuMs + gpuMs x scale², so a lower scale only helps a GPU-bound machine. It ends with the scale
// the dynamic resolution starts from (kept in a stubbed localStorage).
// Usage: node tools/test-pacer.mjs
import { FramePacer } from '../src/core/framePacer.js';
import { DynRes } from '../src/core/dynres.js';

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// rAF intervals measured on a 120 Hz laptop panel while every frame was on time (ms, bucketed to 0.5 ms: count).
// Scaled to the simulated rate, they give the `jitter: 'measured'` displays below; the few missed refreshes of
// that capture (four double intervals and one 100 ms stall in 600) are played as real missed refreshes.
const MEASURED = [[5.5, 1], [6, 1], [6.5, 2], [7, 2], [7.5, 82], [8, 74], [8.5, 339], [9, 39], [9.5, 52], [11.5, 1], [12.5, 1], [14.5, 1]];
const M_TOTAL = MEASURED.reduce((s, b) => s + b[1], 0), M_MEAN = MEASURED.reduce((s, b) => s + b[0] * b[1], 0) / M_TOTAL;
function measuredInterval(P) {
  let k = rnd() * M_TOTAL, i = 0;
  while (k >= MEASURED[i][1]) k -= MEASURED[i++][1];
  return (MEASURED[i][0] + (rnd() - 0.5) * 0.5) * P / M_MEAN;
}

// A simulated display: next() moves to the refresh after `work` ms of frame time and returns the rAF timestamp.
//   hz: number, or t => number (the window moves to another display)
//   jitter: width (ms) of a uniform timestamp noise, or 'measured' (intervals drawn from MEASURED: the timestamp
//           wanders around the true refresh time, within a third of a period)
//   lag: share of a period by which the callback that follows a drawn frame may come late (its timestamp with
//        it): a long interval then a short one, as a busy main thread gives
function display({ hz, jitter = 0.3, lag = 0 }) {
  let off = 0;
  const d = { t: 1000, P: 0, missed: 0 };
  d.next = (work, drawn) => {
    const P = d.P = 1000 / (typeof hz === 'function' ? hz(d.t) : hz);
    let n = Math.max(1, Math.ceil(work / P - 1e-9));
    if (jitter === 'measured') {
      const r = rnd();
      if (r < 1 / 600) n += 11; else if (r < 5 / 600) n += 1;
      off = Math.max(-0.35 * P, Math.min(0.35 * P, off + measuredInterval(P) - P));
    } else off = (rnd() - 0.5) * jitter;
    d.t += n * P;
    return d.t + off + (drawn && lag ? rnd() * lag * P : 0);
  };
  return d;
}

function run({ hz, workMs, jitter = 0.3, lag = 0, seconds = 20, mode = 'auto', watch = null }) {
  const scr = display({ hz, jitter, lag }), pacer = new FramePacer({ mode });
  let sim = 0, shown = 0, ts = scr.t, lastShown = 0;
  const dts = [], gaps = [], end = 1000 + seconds * 1000, hzSeen = new Set();
  let maxDiv = 1;
  while (scr.t < end) {
    const t = scr.t, dt = pacer.tick(ts);
    let work = 0.2;
    if (dt >= 0) {
      sim += dt; shown++;
      const w = typeof workMs === 'function' ? workMs(t) : workMs;
      work = w * (0.9 + rnd() * 0.2);
      if (t > 1000 + 12000) { dts.push(dt * 1000); if (lastShown) gaps.push(t - lastShown); }
      lastShown = t;
      if (t > 1500) { hzSeen.add(pacer.hz); maxDiv = Math.max(maxDiv, pacer.div); }
      watch?.(t, pacer);
    }
    ts = scr.next(work, dt >= 0);
  }
  const real = (scr.t - 1000) / 1000;
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))); };
  const even = dts.filter(v => Math.abs(v / (scr.P * pacer.div) - Math.round(v / (scr.P * pacer.div))) < 0.03).length / dts.length;
  return { pacer, real, sim, fps: shown / real, dtSd: sd(dts), dtEven: even, gapSd: sd(gaps), gapMean: mean(gaps), hzSeen: [...hzSeen], maxDiv };
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


// ---- measured timestamp jitter: the reading must not move, the cadence must follow the true rate ----
const steady = (r, hz) => r.pacer.hz === hz && r.hzSeen.length === 1 && Math.abs(r.pacer.refreshMs - 1000 / hz) < 0.01;
const seen = r => `hz read ${r.hzSeen.join('/')} (${r.pacer.refreshMs.toFixed(2)} ms) div ${r.pacer.div} (max ${r.maxDiv}) fps ${r.fps.toFixed(1)}`;
{ const r = run({ hz: 120, workMs: 3, jitter: 'measured', seconds: 240 });
  check('120 Hz, measured jitter, light GPU: 120 Hz for 4 min, every refresh', steady(r, 120) && r.maxDiv === 1 && r.fps > 115, seen(r));
  check('120 Hz, measured jitter: dt within 3 % of a whole number of refreshes (intervals: within 15 %)', r.dtEven > 0.97, `${(r.dtEven * 100).toFixed(1)} % of frames`); }
{ const r = run({ hz: 120, workMs: 10, jitter: 'measured', seconds: 240 });
  check('120 Hz, measured jitter, GPU good for 60 only: 120 Hz read, 60 fps, never one image in three', steady(r, 120) && r.pacer.div === 2 && r.maxDiv === 2 && r.fps > 57, seen(r)); }
{ const r = run({ hz: 120, workMs: 20, jitter: 'measured', seconds: 240 });
  check('120 Hz, measured jitter, slow GPU: 120 Hz read, cadence never under 48 fps', steady(r, 120) && r.maxDiv === 2, seen(r)); }
{ const r = run({ hz: 120, workMs: 10, jitter: 'measured', lag: 0.3, seconds: 240 });
  check('120 Hz, measured jitter, callbacks late after each drawn frame: still 120 Hz, 60 fps', steady(r, 120) && r.maxDiv === 2 && r.fps > 57, seen(r)); }
{ const r = run({ hz: 120, workMs: 3, jitter: 'measured', lag: 0.3, seconds: 120 });
  check('120 Hz, same late callbacks, light GPU: every refresh', steady(r, 120) && r.maxDiv === 1, seen(r)); }
{ const r = run({ hz: 60, workMs: 8, jitter: 'measured', seconds: 240 });
  check('60 Hz, measured jitter: 60 Hz, every refresh', steady(r, 60) && r.maxDiv === 1 && r.fps > 58, seen(r)); }
{ const r = run({ hz: 60, workMs: 20, jitter: 'measured', seconds: 120 });
  check('60 Hz, measured jitter, slow GPU: still 60 Hz, cadence not divided', steady(r, 60) && r.maxDiv === 1, seen(r)); }
{ const r = run({ hz: 144, workMs: 3, jitter: 'measured', seconds: 240 });
  check('144 Hz, measured jitter, light GPU: 144 Hz, every refresh', steady(r, 144) && r.maxDiv === 1 && r.fps > 138, seen(r)); }
{ const r = run({ hz: 144, workMs: 16, jitter: 'measured', seconds: 240 });
  check('144 Hz, measured jitter, slow GPU: 144 Hz, 48 fps, no lower', steady(r, 144) && r.pacer.div === 3 && r.maxDiv === 3, seen(r)); }
{ const r = run({ hz: 119.88, workMs: 3, jitter: 'measured', seconds: 60 });
  check('119.88 Hz panel: read as 120', r.pacer.hz === 120 && r.hzSeen.length === 1, seen(r)); }

// ---- rates outside the usual list, displays that change ----
{ const r = run({ hz: 50, workMs: 8, jitter: 'measured', seconds: 60 });
  check('50 Hz, measured jitter: read as 50, not pulled to 60', r.pacer.hz === 50 && r.hzSeen.length === 1 && Math.abs(r.pacer.refreshMs - 20) < 0.1 && r.maxDiv === 1, seen(r)); }
{ const r = run({ hz: 85, workMs: 4, jitter: 'measured', seconds: 60 });
  check('85 Hz, measured jitter: read as 85 (1 Hz off at most right after the opening measure)', r.pacer.hz === 85 && r.hzSeen.every(h => Math.abs(h - 85) <= 1) && Math.abs(r.pacer.refreshMs - 1000 / 85) < 0.06 && r.maxDiv === 1, seen(r)); }
const moved = (from, to, workMs) => {
  let at = 0;
  const r = run({ hz: t => (t < 11000 ? from : to), workMs, jitter: 'measured', seconds: 30, watch: (t, p) => { if (!at && t > 11000 && p.hz === to) at = t; } });
  return { r, delay: at ? (at - 11000) / 1000 : Infinity };
};
{ const { r, delay } = moved(144, 60, 4);
  check('window moved from 144 Hz to 60 Hz: read within 6 s, cadence back to every refresh', r.pacer.hz === 60 && delay < 6 && r.pacer.div === 1, `after ${delay.toFixed(1)} s, ${seen(r)}`); }
{ const { r, delay } = moved(60, 144, 4);
  check('window moved from 60 Hz to 144 Hz: read within 3 s', r.pacer.hz === 144 && delay < 3 && r.pacer.div === 1, `after ${delay.toFixed(1)} s, ${seen(r)}`); }
{ const { r, delay } = moved(120, 144, 4);
  check('window moved from 120 Hz to 144 Hz (close rates): read within 3 s', r.pacer.hz === 144 && delay < 3, `after ${delay.toFixed(1)} s, ${seen(r)}`); }
{ const { r, delay } = moved(144, 120, 4);
  check('window moved from 144 Hz to 120 Hz: read within 6 s', r.pacer.hz === 120 && delay < 6, `after ${delay.toFixed(1)} s, ${seen(r)}`); }

// ---- pacer + dynamic resolution: resolution first, cadence second on fast screens ----
globalThis.document = { hidden: false };
const screen = (w, h, dpr) => { globalThis.innerWidth = w; globalThis.innerHeight = h; globalThis.window = { devicePixelRatio: dpr }; };
screen(1920, 1080, 1);

function runBoth({ hz, cpuMs, gpuMs, seconds = 60, mode = 'auto', query = '', stallAt = 0, jitter = 0.3, quality = 'high' }) {
  const scr = display({ hz, jitter }), pacer = new FramePacer({ mode });
  const game = { params: new URLSearchParams(query), quality, pacer, renderer: { setPixelRatio() {}, setSize() {} }, post: null };
  const dr = new DynRes(game), startScale = dr.scale;
  let shown = 0, t0 = 0, minScale = dr.scale, maxScale = dr.scale, maxDiv = 1, ts = scr.t, scaleSum = 0;
  const cost = v => (typeof v === 'function' ? v(scr.t) : v), hzSeen = new Set();
  while (scr.t < 1000 + seconds * 1000) {
    const t = scr.t;
    if (stallAt && t > stallAt && t < stallAt + 10000) { scr.t += 1017; pacer.tick(scr.t); dr.frame(scr.t); ts = scr.next(0.2, false); continue; }   // window covered: 1 frame/s
    const dt = pacer.tick(ts);
    let work = 0.2;
    if (dt >= 0) {
      dr.frame(t);
      work = (cost(cpuMs) + cost(gpuMs) * dr.scale * dr.scale) * (0.95 + rnd() * 0.1);
      if (t > 1000 + (seconds - 10) * 1000) { shown++; t0 ||= t; scaleSum += dr.scale; }
      minScale = Math.min(minScale, dr.scale); maxScale = Math.max(maxScale, dr.scale);
      if (t > 1500) { hzSeen.add(pacer.hz); maxDiv = Math.max(maxDiv, pacer.div); }
    }
    ts = scr.next(work, dt >= 0);
  }
  return { pacer, dr, fps: shown / ((scr.t - t0) / 1000), minScale, maxScale, startScale, maxDiv, hzSeen: [...hzSeen], scale: scaleSum / shown };
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

// ---- the same pair under the measured jitter ----
const infoJ = r => `hz read ${r.hzSeen.join('/')} scale ${r.scale.toFixed(2)} (${r.minScale} to ${r.maxScale}) div ${r.pacer.div} (max ${r.maxDiv}) fps ${r.fps.toFixed(0)}`;
// a 120 Hz laptop, window 1512 x 744 at dpr 2, Standard: 5.9 ms + 9.5 ms per megapixel rendered (1.125 Mpx at scale 1)
screen(1512, 744, 2);
const LAPTOP = { hz: 120, cpuMs: 5.9, gpuMs: 9.5 * 1.512 * 0.744, jitter: 'measured' };
{ const r = runBoth({ ...LAPTOP, seconds: 300 });
  check('120 Hz laptop, Standard: 120 Hz read, 60 fps at a scale of 0.8 to 0.9, never one image in three',
    r.hzSeen.join() === '120' && r.pacer.div === 2 && r.maxDiv === 2 && r.fps > 57 && r.scale >= 0.8 && r.scale <= 0.92 && r.startScale === 1, infoJ(r)); }
{ const r = runBoth({ ...LAPTOP, cpuMs: 2.5, gpuMs: 3.5, seconds: 120 });
  check('same laptop, a tier light enough for 120 fps: every refresh, native scale or above (retries of the next step included)', r.hzSeen.join() === '120' && r.maxDiv === 1 && r.minScale >= 1 && r.fps > 110, infoJ(r)); }
{ const r = runBoth({ ...LAPTOP, cpuMs: 2.5, gpuMs: 6.5, seconds: 120 });
  check('same laptop, GPU just short of 120 fps at native scale: a smaller render keeps every refresh', r.hzSeen.join() === '120' && r.maxDiv === 1 && r.scale < 1 && r.scale >= 0.8 && r.fps > 115, infoJ(r)); }
screen(1920, 1080, 1);
{ const r = runBoth({ hz: 144, cpuMs: 2, gpuMs: 6.5, jitter: 'measured', seconds: 120 });
  check('144 Hz, GPU just short, measured jitter: a smaller render keeps 144 fps', r.hzSeen.join() === '144' && r.pacer.div === 1 && r.scale < 1 && r.fps > 138, infoJ(r)); }
{ const r = runBoth({ hz: 144, cpuMs: 2, gpuMs: 10, jitter: 'measured', seconds: 120 });
  check('144 Hz, slow GPU, measured jitter: half rate, scale back up', r.hzSeen.join() === '144' && r.pacer.div === 2 && r.maxDiv === 2 && r.dr.scale >= 1, infoJ(r)); }
{ const r = runBoth({ hz: 60, cpuMs: 3, gpuMs: 15, jitter: 'measured', seconds: 120 });
  check('60 Hz, GPU just short, measured jitter: one step down keeps 60 fps', r.hzSeen.join() === '60' && r.scale <= 0.92 && r.scale >= 0.88 && r.maxDiv === 1 && r.fps > 57, infoJ(r)); }
{ const r = runBoth({ hz: 60, cpuMs: 3, gpuMs: 11, jitter: 'measured', seconds: 120 });
  check('60 Hz, room to spare, measured jitter: native scale', r.hzSeen.join() === '60' && r.minScale >= 1 && r.maxDiv === 1, infoJ(r)); }

// ---- start-up scale: the last scale that held, kept per tier and window size ----
const kept = new Map();
const storage = { getItem: k => kept.get(k) ?? null, setItem: (k, v) => { kept.set(k, String(v)); } };
const fresh = (query = '', quality = 'high') => new DynRes({ params: new URLSearchParams(query), quality, pacer: null, renderer: { setPixelRatio() {}, setSize() {} }, post: null });
const keptScale = tier => JSON.parse(kept.get('tof.dynres') || '{}')[tier]?.scale;
screen(1512, 744, 2);
check('start-up, no storage at all: native scale', fresh().scale === 1, `scale ${fresh().scale}`);
globalThis.localStorage = storage;
check('start-up, nothing kept: native scale, not the ceiling', fresh().scale === 1 && fresh().cap > 1.5, `scale ${fresh().scale} ceiling ${fresh().cap}`);
{ const r = runBoth({ ...LAPTOP, seconds: 120 });
  check('a session on the laptop keeps the scale that held', keptScale('high') === 0.9 && kept.size === 1, `kept ${kept.get('tof.dynres')} (session ended at ${r.dr.scale})`);
  check('next session starts from it', fresh().scale === 0.9, `scale ${fresh().scale}`); }
check('another tier has its own entry: native scale', fresh('', 'ultra').scale === 1, `scale ${fresh('', 'ultra').scale}`);
check('?dynres=0 and ?pr=1.5 ignore it', fresh('dynres=0').scale === 1 && fresh('pr=1.5').scale === 1.5, `scale ${fresh('dynres=0').scale} / ${fresh('pr=1.5').scale}`);
screen(1400, 800, 2);
check('window of about the same size: same start', fresh().scale === 0.9, `scale ${fresh().scale}`);
screen(2560, 1300, 1);
check('window three times as large: native scale', fresh().scale === 1, `scale ${fresh().scale}`);
screen(1512, 744, 2);
{ const before = kept.get('tof.dynres');
  Object.defineProperty(globalThis, 'navigator', { value: { webdriver: true }, configurable: true });
  const r = runBoth({ ...LAPTOP, cpuMs: 2, gpuMs: 2, seconds: 60 });
  check('automated browser: nothing read, nothing kept', r.startScale === 1 && kept.get('tof.dynres') === before, `start ${r.startScale}, kept ${kept.get('tof.dynres')}`);
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true }); }
{ const r = runBoth({ ...LAPTOP, cpuMs: 2, gpuMs: 1, seconds: 90 });
  check('strong machine starting from a kept 0.9: climbs to its ceiling, which is kept in turn', r.startScale === 0.9 && r.dr.scale === r.dr.cap && keptScale('high') === r.dr.cap, `start ${r.startScale} end ${r.dr.scale} kept ${keptScale('high')}`);
  check('next session starts at that ceiling', fresh().scale === r.dr.cap, `scale ${fresh().scale}`); }
kept.set('tof.dynres', '{"high":{"px":1124928,"scale":1.3}}');
check('kept scale between two steps: the step under it', fresh().scale === 1.25, `scale ${fresh().scale}`);
kept.set('tof.dynres', 'not json');
check('unreadable entry: native scale', fresh().scale === 1, `scale ${fresh().scale}`);
globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
{ const r = runBoth({ ...LAPTOP, seconds: 30 });
  check('storage that throws: native start, the session runs', r.startScale === 1 && r.fps > 50, `start ${r.startScale} fps ${r.fps.toFixed(0)}`); }

console.log(fail ? `\n${fail} failure(s)` : '\nall passed');
process.exit(fail ? 1 : 0);
