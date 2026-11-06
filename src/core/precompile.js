// Compiles a scene's shader programs BEFORE its first render, in parallel when the driver allows it (WebGL extension
// KHR_parallel_shader_compile: Chrome on Windows, macOS, Linux): the main thread no longer blocks on each program
// at first render (frozen image and UI), it waits without freezing until they are all ready.
//   canPrecompile(renderer) -> bool
//   precompile(renderer, scene, camera, { shadows, target, timeout }) -> Promise<bool> (true = the wait was useful)
//     shadows: value of renderer.shadowMap.enabled during compilation (the "receives shadow" variants depend on it)
//     target:  scene whose lights and fog are used (renderer.compile(scene, camera, target))
//     Never rejects; resolves after `timeout` ms at the latest. Without the extension: resolved at once (programs
//     then compile on first render, as before).
// Compiled programs stay alive (game._pinPrograms, via renderer.compile).
// ?pc=1 forces the asynchronous path without the extension (software-rendering tests: compileAsync then waits 10 ms)
const FORCE = typeof location !== 'undefined' && /[?&]pc=1(&|$)/.test(location.search);
export function canPrecompile(r) { return !!(r?.compileAsync && (FORCE || r.extensions?.has?.('KHR_parallel_shader_compile'))); }

export function precompile(r, scene, camera, { shadows = null, target = null, timeout = 2500 } = {}) {
  if (!canPrecompile(r) || !scene || !camera) return Promise.resolve(false);
  const sh = r.shadowMap.enabled;
  if (shadows != null) r.shadowMap.enabled = shadows;
  let p;
  try { p = r.compileAsync(scene, camera, target); } catch (e) { console.warn('precompile', e); p = Promise.resolve(); }
  r.shadowMap.enabled = sh;
  return Promise.race([p.then(() => true, () => true), new Promise(res => setTimeout(() => res(true), timeout))]);
}
