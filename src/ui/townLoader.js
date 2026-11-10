// Loading screen of the town scenes (sneak, land battle) and the lifetime of their GPU resources. A town scene builds
// everything it draws when it starts (geometry, materials, characters, shader programs) and releases it when it ends;
// this screen covers the build and the shader compilation, then fades out once the scene's first frame is on screen.
//   const L = openTownLoader(game, { mode: 'infiltrate'|'escape'|'sea'|'land', title })   shown at once
//   await L.step()             yields to the browser between build steps (the screen keeps animating)
//   await L.compile(scene, camera)   compiles the scene's programs (renderer.compileAsync, shadow variants included)
//   L.close()                  fades out after the next frame drawn on screen
//   const scope = townScope(game)  ...  scope.end()   (call end() BEFORE disposing the scene's materials) the programs
//     created during the scene are no longer kept alive by the game (game._pinPrograms keeps the sea's for good):
//     disposing the scene's materials then frees them, and the sea is left with what it had before.
import './townLoader.css';

const LINES = {
  infiltrate: ['The guards take their posts…', 'Night falls on the quay…', 'Lanterns are lit along the alleys…'],
  escape: ['The turnkey’s footsteps fade down the corridor…', 'The guards change watch…', 'Somewhere a bell tolls midnight…'],
  sea: ['The boats make for the beach…', 'The gun crews run out the cannon…'],
  land: ['The men form up beyond the treeline…', 'Muskets are primed and swords drawn…'],
};
const TITLES = { infiltrate: 'Infiltration', escape: 'Escape', sea: 'Assault', land: 'Assault' };
const raf = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

export function openTownLoader(game, { mode = 'infiltrate', title = '' } = {}) {
  const root = game.uiRoot || document.body, el = document.createElement('div'), lines = LINES[mode] || LINES.infiltrate;
  el.className = `town-loader${mode === 'infiltrate' || mode === 'escape' ? ' night' : ''}`;
  el.innerHTML = `<div class="tl-card tof-parch">
      <div class="tl-rose"><i></i><b></b></div>
      <div class="tl-head">${TITLES[mode] || ''}${title ? ` · ${String(title).replace(/[&<>"]/g, '')}` : ''}</div>
      <div class="tl-line">${lines[Math.floor(Math.random() * lines.length)]}</div>
      <div class="tl-bar"><i></i></div></div>`;
  root.appendChild(el);
  const bar = el.querySelector('.tl-bar i');
  let n = 0, closed = false;
  return {
    el,
    async step() { if (closed) return; n++; bar.style.width = `${Math.min(92, 8 + n * 12)}%`; await raf(); },
    async compile(scene, camera) {
      const r = game.renderer, sh = r.shadowMap.enabled;
      r.shadowMap.enabled = true;
      let p;
      try { p = r.compileAsync ? r.compileAsync(scene, camera) : (r.compile(scene, camera), Promise.resolve()); } catch (e) { console.warn('town compile', e); p = Promise.resolve(); }
      r.shadowMap.enabled = sh;
      await Promise.race([p, new Promise(res => setTimeout(res, 4000))]);
      bar.style.width = '100%';
      await raf();
    },
    close() {
      if (closed) return; closed = true;
      requestAnimationFrame(() => requestAnimationFrame(() => {   // the scene's first frame is on screen
        el.classList.add('out');
        setTimeout(() => el.remove(), 600);
      }));
    },
  };
}

export function townScope(game) {
  const P = game.renderer.info.programs || [], before = new Set(P);
  return {
    end() {
      for (const p of game.renderer.info.programs || []) {
        // pinned by the game during the scene and still used by one of its materials: unpin (the material's dispose
        // then frees it); a program no material uses any more (a duel's, already gone) keeps its pin
        if (!before.has(p) && p._tofPin && p.usedTimes > 1) { p.usedTimes--; game._pinned = Math.max(0, (game._pinned || 0) - 1); }
      }
    },
  };
}
