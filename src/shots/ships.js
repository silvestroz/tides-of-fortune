// Showcase for the procedural ship models.
//   default        lineup of all six types on the water (sloop -> galleon), good afternoon light
//   ?view=close    hero close-up of the frigate's stern quarter (gilded stern, windows, lanterns)
//   ?view=sail     brig under full sail at a dramatic low angle
//   ?view=damage   frigate with heavy hull + sail damage next to a pristine one (pirate strikes colours)
//   ?view=flags    one sloop per faction (ensign check)
//   ?view=family&fam=<famille>  the three sizes of one family
//   ?view=furl     galleon furled / frigate battle sails / brig full sail
//   ?view=wear     hull legibility at 60-140 m: clean planking, three-decker, half-wrecked and near-wrecked (ash-grey) hulls
//   ?view=weather&d=near|far|&w=0..1 [&type=][&faction=]  hull weathering side by side, or one hull at a given wear
import { SHIP_TYPES } from '../data/shipTypes.js';
export async function setup(game) {
  const view = game.params.get('view') || 'lineup';
  const W = game.wind;
  W.angle = 2.55;
  const spawn = (o) => {
    const s = game.spawnShip({ speed: 0, ...o });
    s.controller = null;
    if (o.lock) { s.update = ((orig) => function (dt, t) { this.speed = o.speed ?? 0; orig.call(this, dt, t); this.position.x = o.x; this.position.z = o.z; this.heading = o.heading; this._applyTransform?.(0, t); })(s.update); }
    return s;
  };

  // set the wind so it comes FROM a given bearing relative to a ship heading (default: port quarter)
  const windFor = (heading, rel = -2.35) => { W.angle = heading + rel + Math.PI; };
  // ship-local -> world (lx starboard, ly up, lf forward)
  const loc = (x, z, h, lx, ly, lf) => [x + Math.cos(h) * lx + Math.sin(h) * lf, ly, z + Math.sin(h) * lx - Math.cos(h) * lf];
  if (view === 'one') {
    // debug: ?view=one&type=frigate&faction=english&cam=side|stern|bow|top|quarter&set=1&dmg=0
    const type = game.params.get('type') || 'frigate', cam = game.params.get('cam') || 'quarter';
    const hd = Math.PI * 0.5; windFor(hd, parseFloat(game.params.get('wind') || '-2.35'));
    const s = spawn({ type, faction: game.params.get('faction') || 'english', x: 0, z: 0, heading: hd, sailSetting: parseFloat(game.params.get('set') || '1'), lock: true });
    const dm = parseFloat(game.params.get('dmg') || '0'); if (dm) s.model.forceDamage({ hull: dm, sails: dm });
    const L = s.model.length;
    const cams = {
      side: [[0, L * 0.25, L * 1.5], [0, L * 0.3, 0]],
      side2: [[0, L * 0.25, -L * 1.5], [0, L * 0.3, 0]],
      stern: [[-L * 0.75, L * 0.18, L * 0.35], [0, L * 0.12, 0]],
      bow: [[L * 0.8, L * 0.15, L * 0.5], [0, L * 0.2, 0]],
      top: [[-L * 0.3, L * 1.1, L * 0.7], [0, 0, 0]],
      quarter: [[-L * 0.9, L * 0.3, L * 1.0], [0, L * 0.3, 0]],
      hull: [[L * 0.05, L * 0.08, L * 0.55], [L * 0.05, L * 0.05, 0]],
    }[cam];
    game.cameraRig.setShot({ position: cams[0], lookAt: cams[1] });
  } else if (view === 'close') {
    const h = Math.PI * 0.12;
    windFor(h, -2.5);
    spawn({ type: 'frigate', faction: 'english', x: 0, z: 0, heading: h, sailSetting: 0.5, name: 'Resolute', lock: true });
    const [bx, , bz] = loc(0, 0, h, -90, 0, 120);
    spawn({ type: 'brig', faction: 'english', x: bx, z: bz, heading: h + 0.2, sailSetting: 1, lock: true });
    game.cameraRig.setShot({ position: loc(0, 0, h, -17, 7.5, -36), lookAt: loc(0, 0, h, -1, 7.2, -14) });
  } else if (view === 'sail') {
    const h = -Math.PI * 0.62;
    windFor(h, -2.45);   // wind over the port quarter -> sails fill, billow to starboard/forward
    spawn({ type: 'brig', faction: 'pirate', x: 0, z: 0, heading: h, sailSetting: 1, name: 'Black Wren', lock: true, speed: 9 });
    spawn({ type: 'merchantman', faction: 'dutch', ...Object.fromEntries([['x', loc(0, 0, h, 60, 0, -150)[0]], ['z', loc(0, 0, h, 60, 0, -150)[2]]]), heading: h + 0.3, sailSetting: 1, lock: true });
    game.cameraRig.setShot({ position: loc(0, 0, h, 17, 2.4, 27), lookAt: loc(0, 0, h, -1, 15, 0) });
  } else if (view === 'damage') {
    windFor(Math.PI * 0.5);
    const a = spawn({ type: 'frigate', faction: 'spanish', x: 0, z: 0, heading: Math.PI * 0.5, sailSetting: 1, lock: true });
    a.model.forceDamage({ hull: 0.85, sails: 0.95 });
    const b = spawn({ type: 'brig', faction: 'pirate', x: 45, z: 60, heading: Math.PI * 0.5, sailSetting: 0.5, lock: true });
    b.model.forceDamage({ hull: 0.5, sails: 0.5 });
    b.model.strikeFlag();
    game.cameraRig.setShot({ position: [20, 14, 110], lookAt: [20, 8, 10] });
  } else if (view === 'family') {
    // ?view=family&fam=cotre|goelette|brick|corvette|caboteur|marchand|fregate|vaisseau|galion — small, medium, large
    const fam = game.params.get('fam') || 'fregate';
    const ids = Object.keys(SHIP_TYPES).filter(id => SHIP_TYPES[id].fam === fam).sort((a, b) => SHIP_TYPES[a].size - SHIP_TYPES[b].size);
    const h = Math.PI * 0.5 + 0.42; windFor(h, -2.3);
    const span = ids.reduce((m, id) => Math.max(m, SHIP_TYPES[id].scale), 1) * ({ cotre: 18, goelette: 24, brick: 30, corvette: 42, caboteur: 32, marchand: 32, fregate: 42, vaisseau: 48, galion: 48 }[fam] || 40);
    ids.forEach((type, i) => spawn({ type, faction: game.params.get('faction') || 'english', x: (i - 1) * span * 1.6, z: -i * span * 0.4, heading: h, sailSetting: 1, lock: true }));
    game.cameraRig.setShot({ position: [0, span * 0.45, span * 3.6], lookAt: [0, span * 0.25, -span * 0.4] });
  } else if (view === 'wear') {
    // hull legibility at 60-140 m — clean planking (near frigate, three-decker and its three tiers of ports),
    // a half-wrecked frigate and a near-wrecked galleon (ash-grey hull), all broadside-on to the camera
    const h = Math.PI * 0.5; windFor(h, -2.2);
    // sails furled; camera 30 m up (battle-camera height) so the far row's hulls show above the near row
    const ws = [['frigate', 'english', -36, -58, 0], ['threedecker', 'english', 44, -68, 0], ['frigate', 'spanish', -52, -138, 0.6], ['galleon', 'spanish', 52, -142, 0.92]];
    for (const [type, faction, x, z, dmg] of ws) {
      const s = spawn({ type, faction, x, z, heading: h, sailSetting: 0, lock: true });
      if (dmg) s.model.forceDamage({ hull: dmg, sails: dmg * 0.6 });
    }
    game.cameraRig.setShot({ position: [0, 30, 10], lookAt: [0, 0, -112] });
  } else if (view === 'weather') {
    // hull weathering (src/data/hullWear.js), broadside-on. &d=near: fresh from the yard vs a pirate's never-careened
    // hull at ~45 m; &d=far: 0.06 / 0.45 (as baked) / 0.75 / 1 at combat range (~130 m)
    const h = Math.PI * 0.5; windFor(h, -2.2);
    // &w=<0..1>: one frigate alone at that wear (same spot and swell for a strict before / after)
    const far = game.params.get('d') === 'far', solo = game.params.get('w');
    const ws = solo != null ? [parseFloat(solo)] : far ? [0.06, 0.45, 0.75, 1.0] : [0.06, 1.0], gap = far ? 50 : 46;
    ws.forEach((w, i) => {
      const s = spawn({ type: game.params.get('type') || 'frigate', faction: game.params.get('faction') || 'english', x: (i - (ws.length - 1) / 2) * gap, z: 0, heading: h, sailSetting: 0, lock: true });
      s.model.setWear(w);
    });
    game.cameraRig.setShot(solo != null ? { position: [-6, 5, 30], lookAt: [-6, 3, 0] } : far ? { position: [0, 22, 135], lookAt: [0, 2, 0] } : { position: [0, 9, 50], lookAt: [0, 2.5, 0] });
  } else if (view === 'flags') {
    windFor(Math.PI * 0.5, -1.6);
    ['english', 'spanish', 'french', 'dutch', 'pirate'].forEach((f, i) => spawn({ type: 'sloop', faction: f, x: (i - 2) * 26, z: 0, heading: Math.PI * 0.5, sailSetting: 0.5, lock: true }));
    game.cameraRig.setShot({ position: [0, 12, 55], lookAt: [0, 8, 0] });
  } else if (view === 'furl') {
    windFor(Math.PI * 0.5);
    spawn({ type: 'galleon', faction: 'spanish', x: -60, z: 0, heading: Math.PI * 0.5, sailSetting: 0, lock: true });
    spawn({ type: 'frigate', faction: 'french', x: 0, z: 0, heading: Math.PI * 0.5, sailSetting: 0.5, lock: true });
    spawn({ type: 'brig', faction: 'english', x: 55, z: 0, heading: Math.PI * 0.5, sailSetting: 1, lock: true });
    game.cameraRig.setShot({ position: [0, 18, 120], lookAt: [0, 14, 0] });
  } else {
    // lineup: all six in a loose echelon on a broad reach, seen from off the bows
    const lineup = [
      ['sloop', 'pirate'], ['schooner', 'french'], ['brig', 'english'],
      ['merchantman', 'dutch'], ['frigate', 'english'], ['galleon', 'spanish'],
    ];
    const h = Math.PI * 0.5 + 0.42;
    windFor(h, -2.3);
    const xs = [-110, -68, -20, 34, 96, 166];
    lineup.forEach(([type, faction], i) => spawn({ type, faction, x: xs[i], z: -i * 22, heading: h, sailSetting: 1, lock: true }));
    game.cameraRig.setShot({ position: [6, 15, 150], lookAt: [14, 12, -40] });
  }
}
