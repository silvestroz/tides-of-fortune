// Summary of a CDP CPU profile (Profiler.stop): functions by self time, files, and (callers > 0) call chains of
// the most expensive functions. Shared by perf-profile and perf-transitions.
export function summarize(profile, label, { top: TOP = 30, callers: CALLERS = 0, files = 20 } = {}) {

  const nodes = new Map(profile.nodes.map(n => [n.id, n]));
  const self = new Map();
  const dts = profile.timeDeltas; let total = 0;
  for (let i = 0; i < profile.samples.length; i++) { const id = profile.samples[i], dt = (dts[i] || 0) / 1000; self.set(id, (self.get(id) || 0) + dt); total += dt; }
  const byFn = new Map(), byFile = new Map();
  for (const [id, ms] of self) {
    const n = nodes.get(id), cf = n.callFrame, file = (cf.url || '(natif)').replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '');
    const key = `${cf.functionName || '(anonyme)'}  ${file}:${cf.lineNumber + 1}`;
    byFn.set(key, (byFn.get(key) || 0) + ms); byFile.set(file, (byFile.get(file) || 0) + ms);
  }
  console.log(`\n== ${label} : ${(total / 1000).toFixed(1)} s échantillonnées`);
  console.log('-- fonctions (temps propre) :');
  for (const [k, ms] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`  ${ms.toFixed(0).padStart(7)} ms  ${k}`);
  console.log('-- fichiers :');
  for (const [k, ms] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, files)) console.log(`  ${ms.toFixed(0).padStart(7)} ms  ${k}`);
  if (CALLERS) {
    // --callers: for the most expensive functions, the call chains (4 levels) leading to them
    const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const label = id => { const cf = nodes.get(id).callFrame; return `${cf.functionName || '(anon)'}@${(cf.url || '').replace(/^.*\//, '').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`; };
    const keyOf = id => { const cf = nodes.get(id).callFrame; return `${cf.functionName || '(anonyme)'}  ${(cf.url || '(natif)').replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`; };
    const tops = [...byFn].sort((a, b) => b[1] - a[1]).slice(0, CALLERS).map(e => e[0]);
    for (const top of tops) {
      const chains = new Map();
      for (const [id, ms] of self) {
        if (keyOf(id) !== top) continue;
        const ch = []; let p = parent.get(id);
        while (p != null && ch.length < 6) { const l = label(p); if (!l.startsWith('(root)') && !l.startsWith('(program)')) ch.push(l); p = parent.get(p); }
        const k = ch.join(' < '); chains.set(k, (chains.get(k) || 0) + ms);
      }
      console.log(`  ▸ ${top}`);
      for (const [k, ms] of [...chains].sort((a, b) => b[1] - a[1]).slice(0, 4)) console.log(`      ${ms.toFixed(0).padStart(6)} ms  ${k}`);
    }
  }
}
