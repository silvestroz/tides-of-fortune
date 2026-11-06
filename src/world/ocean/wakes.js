// Ship wakes rendered into a camera-centred, world-space render target that the ocean shader samples.
//   new WakeSystem(renderer, { size = 1024 texels, extent = 900 m })
//   wakes.update(dt, time, ships, centerX, centerZ)   record ship trails + render the wake field
//   wakes.texture        RGBA HalfFloat:  r = foam 0..~1.5, g = wake wave height (m, signed), b = churned/aerated water 0..1, a = hull mask
//   wakes.uniforms       { uWakeTex, uWakeCenter (vec2), uWakeExtent (float) }  — shared into the ocean material
//   wakes.addFoam(x, z, radius, amount)   (API extension) transient foam splash (cannonball splashes, sinking ships)
// Each ship keeps a history of points (laid every ~1.5 m of travel). A triangle-strip ribbon follows that history:
// width grows with distance from the bow at the Kelvin half-angle (19.5°), so the V arms bend when the ship turns.
// The fragment shader draws: feathery Kelvin arms with diverging ripples, a bow cushion, a churned centre trail
// behind the stern, all fading with age and scaled by the speed the ship had when it laid that point.
import * as THREE from 'three';

const MAX_PTS = 160;            // per ship
const STEP = 1.5;               // metres between history points
const MAX_AGE = 45;             // seconds a trail point survives
const KELVIN = Math.tan(19.47 * Math.PI / 180);
const MAX_SPLASH = 64;

const ribbonVert = /* glsl */`
attribute vec4 aWake;   // x: lateral metres (signed), y: distance from bow (m), z: age (s), w: speed at the time (m/s)
attribute vec4 aShip;   // x: half beam, y: length, z: half width at this point, w: current speed
uniform vec2 uCenter; uniform float uExtent;
varying vec4 vWake; varying vec4 vShip;
void main() {
  vWake = aWake; vShip = aShip;
  vec2 c = ( position.xz - uCenter ) / ( uExtent * 0.5 );
  gl_Position = vec4( c, 0.0, 1.0 );
}
`;

const ribbonFrag = /* glsl */`
uniform float uTime;
varying vec4 vWake; varying vec4 vShip;
float hash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float vnoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash12( i ), hash12( i + vec2( 1, 0 ) ), f.x ), mix( hash12( i + vec2( 0, 1 ) ), hash12( i + vec2( 1, 1 ) ), f.x ), f.y );
}
void main() {
  float lat = vWake.x, d = vWake.y, age = vWake.z, spd = vWake.w;
  float hb = vShip.x, L = vShip.y, hw = vShip.z;
  float a = abs( lat );
  float sp = clamp( spd / 9.0, 0.0, 1.4 );
  float edge = a / max( hw, 0.01 );                       // 0 centre .. 1 ribbon edge (arm line ~0.86)
  float fadeArm = exp( -age / 16.0 );
  float fadeTrail = exp( -age / 14.0 );   // old trails (30 s+) lingered as wide pale-turquoise wedges from the tactical camera
  float n = vnoise( vec2( d * 0.35, lat * 0.6 ) ), n2 = vnoise( vec2( d * 1.3 + 7.0, lat * 1.7 ) );

  // --- Kelvin arms: a bright feathered line on each side of the wedge, broken up by noise
  float armPos = 0.86;
  float armW = 0.035 + 0.07 * smoothstep( 0.0, 160.0, d );
  float arm = exp( -pow( ( edge - armPos ) / armW, 2.0 ) );
  arm *= smoothstep( -2.0, 6.0, d );
  // break the arm into feathered clumps (each diverging crest makes its own foam patch)
  float clump = smoothstep( 0.25, 0.75, vnoise( vec2( d * 0.22, sign( lat ) * 3.0 ) ) * 0.7 + n2 * 0.5 );
  arm *= mix( 1.0, clump, smoothstep( 8.0, 40.0, d ) );
  // diverging waves: short crests slanted backwards from the arm line
  float dv = sin( ( d * 0.9 - a * 2.2 ) * 0.9 + uTime * 0.4 );
  // confined to a band inside the arm and to the first ~60 m: across the whole wedge they printed hundreds of metres
  // of parallel stripes (corduroy) over the sea from the tactical camera
  float diver = smoothstep( 0.25, 0.95, dv ) * smoothstep( 0.6, armPos, edge ) * smoothstep( 1.0, armPos, edge ) * exp( -d / 60.0 );
  float armFade = fadeArm * exp( -d / 55.0 ) * smoothstep( 0.0, 0.6, n * 0.8 + 0.4 );
  float armFoam = ( arm * ( 0.45 + 0.6 * n ) + diver * 0.4 * n2 ) * armFade * sp;

  // --- bow cushion: foam piled along the hull from the stem back over the fore third
  float onHull = smoothstep( -3.0, 0.0, d ) * ( 1.0 - smoothstep( L * 0.3, L * 0.85, d ) );
  float bowSide = exp( -pow( ( a - hb * 1.05 ) / ( 1.2 + 0.03 * d ), 2.0 ) );
  float stem = exp( -pow( d / 2.2, 2.0 ) ) * exp( -pow( a / ( hb * 0.9 + 0.5 ), 2.0 ) );
  // hull-hugging foam along the whole waterline (thicker forward), plus the stem roll
  float alongHull = smoothstep( -3.0, 0.0, d ) * ( 1.0 - smoothstep( L * 0.85, L * 1.05, d ) );
  float hugW = mix( 2.2, 1.0, smoothstep( 0.0, L, d ) );
  float hug = exp( -pow( max( a - hb * 0.85, 0.0 ) / hugW, 2.0 ) ) * step( hb * 0.55, a ) * alongHull;
  float bow = ( bowSide * onHull * 1.2 + stem * 1.4 + hug * 0.7 ) * ( 0.55 + 0.65 * n2 ) * smoothstep( 0.15, 0.6, sp ) * fadeArm;
  // waterline collar: lapping foam around the whole hull footprint, even at rest; thicker at the bow
  float collarW = 1.6 + 1.2 * exp( -d / ( L * 0.3 ) ) + 1.5 * sp;
  float collar = exp( -pow( max( a - hb * 0.82, 0.0 ) / collarW, 2.0 ) ) * step( hb * 0.5, a ) * alongHull
               + exp( -pow( ( d - L ) / 2.5, 2.0 ) ) * step( a, hb * 1.0 ) * 1.4;
  collar *= ( 0.5 + 0.7 * vnoise( vec2( d * 0.8 + uTime * 0.7, lat * 2.0 ) ) ) * step( age, 1.5 );
  bow += collar * ( 0.85 + 0.5 * sp );

  // --- churned centre trail behind the stern: wide-ish, streaky, slowly widening
  float ds = d - L;
  float tw = hb * ( 0.85 + 0.012 * max( ds, 0.0 ) );
  float trailMask = smoothstep( -L * 0.35, -L * 0.05, ds ) * exp( -pow( a / tw, 2.0 ) );
  float streak = vnoise( vec2( lat * 0.9, d * 0.08 ) ) * 0.6 + n * 0.5;
  // streaky: foam lines run along the trail, breaking up more with distance; the body turns to churned turquoise
  float lines = vnoise( vec2( lat * 1.4, d * 0.05 ) ) * 0.65 + vnoise( vec2( lat * 3.1 + 5.0, d * 0.12 ) ) * 0.45;
  float breakup = smoothstep( 0.0, 160.0, ds );
  float trail = trailMask * smoothstep( 0.25 + 0.4 * breakup, 0.85, lines * ( 0.75 + 0.5 * streak ) ) * fadeTrail * sp * smoothstep( -6.0, 2.0, ds );
  // close behind the stern the turbulence is near-solid white
  trail += trailMask * exp( -max( ds, 0.0 ) / 16.0 ) * 0.9 * sp;
  // continuous foam ribbon: a soft, unbroken band down the trail centre that thins and fades with distance, so the
  // wake reads as one painted stroke (the streak/line noise alone broke into a dotted string from the battle camera)
  float ribbonW = tw * mix( 0.75, 0.45, smoothstep( 0.0, 140.0, ds ) );
  trail += smoothstep( -6.0, 2.0, ds ) * exp( -pow( a / max( ribbonW, 0.5 ), 2.0 ) ) * exp( -max( ds, 0.0 ) / 60.0 ) * ( 0.34 + 0.22 * n ) * fadeTrail * sp;
  // side streaks peeling off the quarters
  trail += exp( -pow( ( a - tw * 1.1 ) / ( 0.6 + 0.02 * max( ds, 0.0 ) ), 2.0 ) ) * smoothstep( -4.0, 4.0, ds ) * exp( -max( ds, 0.0 ) / 50.0 ) * 0.5 * n2 * sp * fadeTrail;

  // wake foam stays a narrow trail near the ship: everything fades with distance behind the stern so the Kelvin V never
  // paints a hundreds-of-metres pale wedge over the sea
  float far = exp( -max( d - L - 40.0, 0.0 ) / 45.0 );
  float foam = armFoam * far + bow + trail * mix( 0.35, 1.0, far );

  // --- wake wave height: the arm crest + transverse waves between the arms (λ = 2π v² / g)
  float k = 9.81 / max( spd * spd, 4.0 );
  float trans = sin( d * k - 1.57 ) * smoothstep( armPos, 0.2, edge ) * 0.25 * exp( -d / 90.0 );   // transverse waves die out behind the ship
  float h = ( arm * 0.55 + trans + bowSide * onHull * 0.6 ) * fadeArm * sp * clamp( hb * 0.25, 0.4, 1.5 );
  h -= trailMask * 0.15 * fadeTrail * sp;      // flattened trail (glassy slick)
  float churn = clamp( trailMask * exp( -age / 10.0 ), 0.0, 1.0 ) * sp * smoothstep( -2.0, 6.0, ds );   // starts at the stern, not under the hull   // arms no longer tint the sea turquoise
  float hull = smoothstep( 0.0, 1.0, d ) * ( 1.0 - smoothstep( L - 1.0, L, d ) ) * step( a, hb * 0.92 );
  gl_FragColor = vec4( foam, h, churn, hull );
}
`;

const fadeVert = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;
// splash layer accumulates (decays) so splashes persist after the event
const splashFrag = /* glsl */`
uniform sampler2D uPrev; uniform vec2 uShift; uniform float uDecay;
varying vec2 vUv;
void main() {
  vec2 uv = vUv + uShift;
  vec4 p = texture2D( uPrev, uv );
  if ( uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ) p = vec4( 0.0 );
  gl_FragColor = p * uDecay;
}
`;
const splatVert = /* glsl */`
attribute vec4 aSplat;   // xy world, z radius, w amount
uniform vec2 uCenter; uniform float uExtent;
varying vec2 vL; varying float vAmt;
void main() {
  vL = position.xy; vAmt = aSplat.w;
  vec2 w = aSplat.xy + position.xy * aSplat.z;
  gl_Position = vec4( ( w - uCenter ) / ( uExtent * 0.5 ), 0.0, 1.0 );
}
`;
const splatFrag = /* glsl */`
varying vec2 vL; varying float vAmt;
void main() {
  float r = length( vL );
  if ( r > 1.0 ) discard;
  float ring = exp( -pow( ( r - 0.7 ) / 0.22, 2.0 ) ) + 0.6 * ( 1.0 - r );
  gl_FragColor = vec4( ring * vAmt, ( 0.5 - r ) * vAmt * 0.4, vAmt * ( 1.0 - r ), 0.0 );
}
`;

export class WakeSystem {
  constructor(renderer, { size = 1024, extent = 900 } = {}) {
    this.renderer = renderer;
    this.size = size; this.extent = extent;
    const opts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
    this.rt = new THREE.WebGLRenderTarget(size, size, opts);
    this.splashA = new THREE.WebGLRenderTarget(size / 4, size / 4, opts);
    this.splashB = new THREE.WebGLRenderTarget(size / 4, size / 4, opts);
    this.center = new THREE.Vector2();
    this._splashCenter = new THREE.Vector2();
    this.uniforms = {
      uWakeTex: { value: this.rt.texture },
      uSplashTex: { value: this.splashA.texture },
      uWakeCenter: { value: this.center },
      uSplashCenter: { value: this._splashCenter },
      uWakeExtent: { value: extent },
    };
    this.camera = new THREE.Camera();
    this.trails = new Map();     // ship -> { pts: [{x,z,hx,hz,t,spd}], last:{x,z} }

    // ribbon mesh (all ships share one dynamic geometry)
    this.maxShips = 48;
    const nv = this.maxShips * (MAX_PTS + 1) * 2;
    const g = this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(nv * 3); this.aWake = new Float32Array(nv * 4); this.aShip = new Float32Array(nv * 4);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aWake', new THREE.BufferAttribute(this.aWake, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aShip', new THREE.BufferAttribute(this.aShip, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let s = 0; s < this.maxShips; s++) {
      const b = s * (MAX_PTS + 1) * 2;
      for (let i = 0; i < MAX_PTS; i++) {
        const a = b + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    g.setIndex(idx);
    this.ribbonMat = new THREE.ShaderMaterial({
      vertexShader: ribbonVert, fragmentShader: ribbonFrag,
      uniforms: { uCenter: { value: this.center }, uExtent: { value: extent }, uTime: { value: 0 } },
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.MaxEquation,
    });
    this.ribbon = new THREE.Mesh(g, this.ribbonMat);
    this.ribbon.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.ribbon);

    // splash accumulation (low-res, decaying)
    const quad = new THREE.PlaneGeometry(2, 2);
    this.fadeMat = new THREE.ShaderMaterial({
      vertexShader: fadeVert, fragmentShader: splashFrag,
      uniforms: { uPrev: { value: null }, uShift: { value: new THREE.Vector2() }, uDecay: { value: 1 } },
      depthTest: false, depthWrite: false,
    });
    this.fadeScene = new THREE.Scene();
    const fq = new THREE.Mesh(quad, this.fadeMat); fq.frustumCulled = false; this.fadeScene.add(fq);
    const sg = new THREE.InstancedBufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    sg.setIndex([0, 1, 2, 0, 2, 3]);
    this.splatData = new Float32Array(MAX_SPLASH * 4);
    this.splatAttr = new THREE.InstancedBufferAttribute(this.splatData, 4).setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('aSplat', this.splatAttr);
    sg.instanceCount = 0;
    this.splatGeo = sg;
    this.splatMat = new THREE.ShaderMaterial({
      vertexShader: splatVert, fragmentShader: splatFrag,
      uniforms: { uCenter: { value: this._splashCenter }, uExtent: { value: extent } },
      depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    const sm = new THREE.Mesh(sg, this.splatMat); sm.frustumCulled = false;
    this.splatScene = new THREE.Scene(); this.splatScene.add(sm);
    this.pending = [];
    this._first = true;
    // GPU pass is deferred to render() (called from the ocean mesh's onBeforeRender), so N sim steps between two
    // presented frames cost one wake pass instead of N (no GPU work queued up by headless/batched stepping).
    this._dirty = false; this._accDt = 0; this._stepSplats = 0; this._npDecayed = 0; this._cx = 0; this._cz = 0;
    this._cushion = { x: 0, z: 0, hx: 0, hz: 1, t: 0, spd: 0 };
    this._sc = new THREE.Vector2(); this._prevClear = new THREE.Color();
  }

  addFoam(x, z, radius = 6, amount = 1) {
    // per-step cap of MAX_SPLASH / 4 splats (historical behaviour), total cap MAX_SPLASH across deferred steps
    if (this._stepSplats < MAX_SPLASH / 4 && this.pending.length < MAX_SPLASH * 4) { this.pending.push(x, z, radius, amount); this._stepSplats++; }
  }

  _record(ship, t) {
    let tr = this.trails.get(ship);
    const p = ship.position;
    const fx = Math.sin(ship.heading), fz = -Math.cos(ship.heading);
    const L = ship.length || 30;
    // bow point (history is laid at the bow so the Kelvin wedge originates at the stem)
    const bx = p.x + fx * L * 0.5, bz = p.z + fz * L * 0.5;
    if (!tr) { tr = { pts: [], seen: t }; this.trails.set(ship, tr); }
    tr.seen = t;
    const spd = Math.max(0, ship.speed || 0);
    const last = tr.pts[0];
    if (!last || Math.hypot(bx - last.x, bz - last.z) >= STEP || t - last.t > 1.0) {
      tr.pts.unshift({ x: bx, z: bz, hx: fx, hz: fz, t, spd });
      if (tr.pts.length > MAX_PTS) tr.pts.length = MAX_PTS;
    }
    while (tr.pts.length > 1 && t - tr.pts[tr.pts.length - 1].t > MAX_AGE) tr.pts.pop();
    const h = tr.head || (tr.head = { x: 0, z: 0, hx: 0, hz: 1, spd: 0 });
    h.x = bx; h.z = bz; h.hx = fx; h.hz = fz; h.spd = spd;
  }

  update(dt, t, ships, cx, cz) {
    const texel = this.extent / this.size;
    this.center.set(Math.round(cx / texel) * texel, Math.round(cz / texel) * texel);
    this.ribbonMat.uniforms.uTime.value = t;

    // seed history for ships that spawned already moving: synthesize a straight trail behind them
    for (const s of ships) {
      if (!s || s.alive === false && !s.sinking) continue;
      if (!this.trails.has(s) && (s.speed || 0) > 0.5) {
        const tr = { pts: [], seen: t };
        const fx = Math.sin(s.heading), fz = -Math.cos(s.heading), L = s.length || 30;
        const bx = s.position.x + fx * L * 0.5, bz = s.position.z + fz * L * 0.5;
        for (let i = MAX_PTS - 1; i >= 1; i--) {
          const back = i * STEP;
          tr.pts.push({ x: bx - fx * back, z: bz - fz * back, hx: fx, hz: fz, t: t - back / s.speed, spd: s.speed });
        }
        this.trails.set(s, tr);
      }
      this._record(s, t);
    }
    for (const [s, tr] of this.trails) if (!ships.includes(s) && t - tr.seen > 0.5) this.trails.delete(s);

    // build ribbons
    let si = 0;
    const pos = this.pos, aw = this.aWake, as = this.aShip;
    const stride = (MAX_PTS + 1) * 2;
    for (const [s, tr] of this.trails) {
      if (si >= this.maxShips) break;
      const base = si * stride;
      const hb = (s.beam || 8) * 0.5, L = s.length || 30;
      const cur = Math.max(0, s.speed || 0);
      // point list: a cushion point ahead of the stem, then history
      const head = tr.head, pts = tr.pts, cu = this._cushion;
      cu.x = head.x + head.hx * 3; cu.z = head.z + head.hz * 3; cu.hx = head.hx; cu.hz = head.hz; cu.t = t; cu.spd = cur;
      // virtual list [cushion, head, ...pts] without allocating
      const at = (k) => k === 0 ? cu : k === 1 ? head : pts[k - 2];
      let d = -3, prev = cu;
      let n = Math.min(pts.length + 2, MAX_PTS + 1);
      for (let i = 0; i < MAX_PTS + 1; i++) {
        const k = Math.min(i, n - 1);
        const P = at(k);
        if (i > 0 && k === i) d += Math.hypot(P.x - prev.x, P.z - prev.z);
        prev = P;
        // ribbon direction: average of neighbours (smooth corners)
        const Q = at(Math.min(k + 1, n - 1)), R = at(Math.max(k - 1, 0));
        let tx = R.x - Q.x, tz = R.z - Q.z; const tl = Math.hypot(tx, tz);
        if (tl > 1e-3) { tx /= tl; tz /= tl; } else { tx = P.hx; tz = P.hz; }
        const rx = -tz, rz = tx;   // right of travel direction
        const hw = (hb * 0.75 + Math.max(0, d) * KELVIN) / 0.86 + 2.5;   // arm line sits at 0.86 of half width
        const age = Math.max(0, t - P.t);
        const spd = k < 2 ? cur : Math.min(P.spd, cur + 6);
        const collapsed = k !== i;   // padding beyond history: degenerate
        for (let side = 0; side < 2; side++) {
          const sg = side ? 1 : -1;
          const v = base + i * 2 + side;
          const w = collapsed ? 0 : hw;
          pos[v * 3] = P.x + rx * sg * w; pos[v * 3 + 1] = 0; pos[v * 3 + 2] = P.z + rz * sg * w;
          aw[v * 4] = sg * w; aw[v * 4 + 1] = d; aw[v * 4 + 2] = age; aw[v * 4 + 3] = collapsed ? 0 : spd;
          as[v * 4] = hb; as[v * 4 + 1] = L; as[v * 4 + 2] = hw; as[v * 4 + 3] = cur;
        }
      }
      si++;
    }
    this.geo.setDrawRange(0, si * MAX_PTS * 6);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aWake.needsUpdate = true;
    this.geo.attributes.aShip.needsUpdate = true;
    this._si = si;
    // splats queued in earlier un-rendered steps decay as if each step had been rendered (fade is linear)
    if (this._dirty) { const k = Math.exp(-dt / 7), pd = this.pending, m = this._npDecayed; for (let i = 3; i < m; i += 4) pd[i] *= k; }
    this._npDecayed = this.pending.length;
    this._accDt += dt; this._dirty = true; this._stepSplats = 0; this._cx = cx; this._cz = cz;
  }

  // GPU pass (wake ribbons + splash fade/splat). Never reads back; only issues draws into render targets.
  render() {
    if (!this._dirty) return;
    this._dirty = false;
    const dt = this._accDt; this._accDt = 0; this._npDecayed = 0;
    const si = this._si, cx = this._cx, cz = this._cz;
    const r = this.renderer;
    const prevRT = r.getRenderTarget(), prevAuto = r.autoClear;
    const prevClear = r.getClearColor(this._prevClear), prevAlpha = r.getClearAlpha();
    r.autoClear = false;
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rt); r.clear(true, false, false);
    if (si > 0) r.render(this.scene, this.camera);

    // splash layer: shift with the centre, decay, add pending splats
    const sTex = this.extent / (this.size / 4);
    const sc = this._sc.set(Math.round(cx / sTex) * sTex, Math.round(cz / sTex) * sTex);
    const shift = this.fadeMat.uniforms.uShift.value.set((sc.x - this._splashCenter.x) / this.extent, (sc.y - this._splashCenter.y) / this.extent);
    if (this._first) { shift.set(0, 0); this._first = false; r.setRenderTarget(this.splashA); r.clear(true, false, false); }
    this._splashCenter.copy(sc);
    this.fadeMat.uniforms.uPrev.value = this.splashA.texture;
    this.fadeMat.uniforms.uDecay.value = Math.exp(-dt / 7);
    r.setRenderTarget(this.splashB); r.clear(true, false, false); r.render(this.fadeScene, this.camera);
    const np = this.pending.length / 4;
    if (np) {
      this.splatData.set(this.pending);   // addFoam caps pending at MAX_SPLASH * 4 floats
      this.splatAttr.needsUpdate = true;
      this.splatGeo.instanceCount = np;
      r.render(this.splatScene, this.camera);
      this.pending.length = 0;
    }
    [this.splashA, this.splashB] = [this.splashB, this.splashA];
    this.uniforms.uSplashTex.value = this.splashA.texture;

    r.setRenderTarget(prevRT);
    r.autoClear = prevAuto;
    r.setClearColor(prevClear, prevAlpha);
  }

  dispose() {
    this.rt.dispose(); this.splashA.dispose(); this.splashB.dispose();
    this.geo.dispose(); this.ribbonMat.dispose(); this.fadeMat.dispose(); this.splatMat.dispose(); this.splatGeo.dispose();
  }
}
