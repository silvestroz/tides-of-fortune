// Harbour life around the nearest port: chimney smoke, wheeling gulls (also a few over the player's ship at sea) and
// small boats crossing in front of the quay. Instanced, ONE draw call per type (3 total), rebuilt only when the
// nearest port changes. Everything is procedural (shader-animated smoke and gulls, CPU-steered boats).
//   new HarbourLife(game, towns); life.update(dt, t, night)
import * as THREE from 'three';
import { GeoBuilder, M } from './builder.js';

const MAX_CHIM = 40, PUFFS = 4, N_GULL_H = 14, N_GULL_S = 6, N_BOAT = 6;

export class HarbourLife {
  constructor(game, towns) {
    this.game = game; this.towns = towns; this.port = null;
    const low = game.quality === 'low';
    this.nChim = low ? 16 : MAX_CHIM;
    this._buildSmoke(); this._buildGulls(); this._buildBoats(towns.material);
    for (const m of [this.smoke, this.gulls, this.boats]) { m.frustumCulled = false; m.visible = false; game.scene.add(m); }
    this.gulls.visible = true;   // sea group follows the player even far from ports
  }

  // ---------- smoke: soft camera-facing puffs rising and drifting downwind, fading out ----------
  _buildSmoke() {
    const n = this.nChim * PUFFS;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.smokeBase = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);   // xyz base, w phase
    g.setAttribute('aBase', this.smokeBase);
    g.instanceCount = 0;
    this.smokeU = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(1, 0) }, uLight: { value: new THREE.Color(1, 1, 1) } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.smokeU, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        attribute vec4 aBase; uniform float uTime; uniform vec2 uWind;
        varying vec2 vC; varying float vA; varying float vT;
        void main() {
          float t = fract( uTime / 9.0 + aBase.w );
          vec3 p = aBase.xyz + vec3( 0.0, t * 19.0, 0.0 ) + vec3( uWind.x, 0.0, uWind.y ) * ( t * t * 24.0 + t * 3.0 );
          p.x += sin( t * 6.0 + aBase.w * 40.0 ) * 0.8 * t;
          vec4 mv = modelViewMatrix * vec4( p, 1.0 );
          float s = 1.1 + t * 5.8;   // gfx-ultra: a bigger, longer plume so it reads from the offing
          mv.xy += position.xy * s;
          vC = position.xy; vT = t;
          vA = smoothstep( 0.0, 0.08, t ) * ( 1.0 - t ) * ( 1.0 - t ) * ( 1.0 - smoothstep( 1600.0, 3200.0, -mv.z ) );
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uLight; varying vec2 vC; varying float vA; varying float vT;
        float h( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
        float n( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( h( i ), h( i + vec2( 1, 0 ) ), f.x ), mix( h( i + vec2( 0, 1 ) ), h( i + 1.0 ), f.x ), f.y ); }
        void main() {
          float r = length( vC );
          float nn = n( vC * 2.2 + vT * 3.0 ) * 0.6 + n( vC * 4.7 - vT * 2.0 ) * 0.4;
          // gfx-ultra: denser and darker grey-brown wood smoke (the pale plume vanished against a clear sky), the
          // young puffs darkest, ageing toward a lighter haze
          float a = smoothstep( 1.0, 0.2, r + ( nn - 0.5 ) * 0.6 ) * vA * 0.8;
          if ( a < 0.005 ) discard;
          vec3 c = mix( vec3( 0.26, 0.24, 0.23 ), vec3( 0.62, 0.6, 0.58 ), clamp( 0.3 + vT * 0.6 + vC.y * 0.3 + nn * 0.3, 0.0, 1.0 ) ) * uLight;
          gl_FragColor = vec4( c, a );
        }`,
    });
    this.smoke = new THREE.Mesh(g, m); this.smoke.renderOrder = 6;
  }

  // ---------- gulls: small bent-wing silhouettes circling, flapping in bursts then gliding ----------
  _buildGulls() {
    // body + two two-segment wings; aW = 0 body, 1 inner wing tip, 2 outer tip (flap amplitude), sign = side
    const P = [], W = [];
    const tri = (a, b, c, wa, wb, wc) => { P.push(...a, ...b, ...c); W.push(wa, wb, wc); };
    tri([0, 0, -0.55], [0.09, 0, 0.35], [-0.09, 0, 0.35], 0, 0, 0);
    for (const sd of [1, -1]) {
      tri([0, 0, -0.15], [0, 0, 0.18], [0.65 * sd, 0.08, -0.02], 0, 0, 1 * sd);
      tri([0.65 * sd, 0.08, -0.02], [0, 0, 0.18], [0.62 * sd, 0.08, 0.16], 1 * sd, 0, 1 * sd);
      tri([0.65 * sd, 0.08, -0.02], [0.62 * sd, 0.08, 0.16], [1.25 * sd, -0.05, 0.22], 1 * sd, 1 * sd, 2 * sd);
    }
    const n = N_GULL_H + N_GULL_S;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('aW', new THREE.Float32BufferAttribute(W, 1));
    const orb = new Float32Array(n * 4), grp = new Float32Array(n);   // orbit: offset x, z, radius, phase; group 0 harbour / 1 ship
    for (let i = 0; i < n; i++) {
      const s = i < N_GULL_H, r = Math.random;
      orb.set([(r() - 0.5) * (s ? 160 : 40), (r() - 0.5) * (s ? 120 : 40), (s ? 25 : 18) + r() * (s ? 45 : 22), r() * 100], i * 4);
      grp[i] = s ? 0 : 1;
    }
    g.setAttribute('aOrb', new THREE.InstancedBufferAttribute(orb, 4));
    g.setAttribute('aGrp', new THREE.InstancedBufferAttribute(grp, 1));
    g.instanceCount = n;
    this.gullU = { uTime: { value: 0 }, uA0: { value: new THREE.Vector4(0, 0, 0, 0) }, uA1: { value: new THREE.Vector4(0, 0, 0, 1) }, uLight: { value: new THREE.Color(1, 1, 1) } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.gullU, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        attribute float aW; attribute vec4 aOrb; attribute float aGrp; uniform float uTime; uniform vec4 uA0, uA1;
        varying float vShade; varying float vTip;
        void main() {
          vec4 A = aGrp < 0.5 ? uA0 : uA1;      // xyz anchor, w = visible
          float sp = ( 0.35 + fract( aOrb.w * 7.31 ) * 0.25 ) * 9.0 / aOrb.z * ( fract( aOrb.w * 3.7 ) < 0.5 ? 1.0 : -1.0 );
          float ang = aOrb.w + uTime * sp;
          vec3 c = A.xyz + vec3( aOrb.x + cos( ang ) * aOrb.z, 22.0 + fract( aOrb.w * 5.3 ) * 18.0 + sin( uTime * 0.4 + aOrb.w ) * 4.0, aOrb.y + sin( ang ) * aOrb.z );
          vec3 fwd = normalize( vec3( -sin( ang ), 0.0, cos( ang ) ) * sign( sp ) );
          vec3 rt = normalize( cross( fwd, vec3( 0.0, 1.0, 0.0 ) ) );
          float burst = smoothstep( 0.3, 0.7, sin( uTime * 0.7 + aOrb.w * 2.0 ) );
          float flap = sin( uTime * 9.0 + aOrb.w * 13.0 ) * burst;
          vec3 p = position;
          float aw = abs( aW );
          p.y += aw * ( 0.25 * flap ) + aw * aw * 0.06 * flap;
          float bank = -0.35 * sign( sp );
          vec3 lp = rt * p.x + vec3( 0.0, 1.0, 0.0 ) * ( p.y + p.x * bank ) + fwd * ( -p.z );
          vec3 wp = c + lp * 1.6 * A.w;
          vShade = 0.75 + 0.25 * aw; vTip = step( 1.5, aw );
          gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uLight; varying float vShade; varying float vTip;
        void main() { vec3 c = mix( vec3( 0.93, 0.92, 0.88 ), vec3( 0.16, 0.16, 0.17 ), vTip * 0.85 ) * vShade * uLight;
          gl_FragColor = vec4( c, 1.0 );
          #include <colorspace_fragment>
        }`,
    });
    this.gulls = new THREE.Mesh(g, m);
  }

  // ---------- small boats: launches and lateen-rigged fishing boats crossing the harbour ----------
  _buildBoats(mat) {
    const b = new GeoBuilder(true); b.ground = -0.5; b.aoH = 1;
    b.block(0, -0.35, 0, 1.6, 0.75, 5.0, '#7a4a2a', M.WOOD);
    b.block(0, 0.32, 0, 1.75, 0.14, 5.1, '#d8c8a4', M.WOOD);
    b.block(0, 0.1, 0, 1.3, 0.3, 4.4, '#3a2818', M.DARK);
    b.spire(0, -0.6, -2.6, 0.85, 0.95, 4, '#7a4a2a', M.WOOD);
    b.block(0, 0.4, 0.6, 1.5, 0.12, 0.35, '#8a6a48', M.WOOD);
    b.cyl(0, 0.3, -0.6, 0.07, 0.05, 4.6, 5, '#3a2a1a', M.WOOD);
    b.tri([0, 1.0, 1.6], [0, 5.4, -1.9], [0, 0.9, -1.4], '#efe4c8', M.CLOTH);
    b.tri([0, 0.9, -1.4], [0, 5.4, -1.9], [0, 1.0, 1.6], '#e8dcc0', M.CLOTH);
    this.boats = new THREE.InstancedMesh(b.build(), mat, N_BOAT);
    this.boats.castShadow = false; this.boats.receiveShadow = true;
    this.boatState = [];
  }

  _setPort(port) {
    this.port = port;
    if (!port) { this.smoke.visible = this.boats.visible = false; return; }
    // smoke from a spread of chimneys (every other one, capped)
    const ch = port._chimneys || [];
    const step = Math.max(1, Math.ceil(ch.length / this.nChim));
    let k = 0;
    for (let i = 0; i < ch.length && k < this.nChim; i += step, k++) {
      for (let j = 0; j < PUFFS; j++) this.smokeBase.setXYZW((k * PUFFS + j), ch[i][0], ch[i][1], ch[i][2], j / PUFFS + (i * 0.137 % 1));
    }
    this.smokeBase.needsUpdate = true;
    this.smoke.geometry.instanceCount = k * PUFFS;
    this.smoke.visible = k > 0;
    // boats: lanes parallel to the quay at 50-190 m off, each shuttling along its lane; lane kept only if in water
    const isl = this.game.islands, q = port.quay, s = port.seaward, l = port.lateral, hw = port.extent.hw;
    this.boatState = [];
    for (let i = 0; i < N_BOAT; i++) {
      const off = 50 + i * 26 + Math.random() * 10, span = hw * (0.7 + Math.random() * 0.6);
      let ok = true;
      for (let u = -1; u <= 1; u += 0.25) if (isl.getTerrainHeight(q.x + s.x * off + l.x * u * span, q.z + s.z * off + l.z * u * span) > -1.2) { ok = false; break; }
      if (ok) this.boatState.push({ off, span, ph: Math.random() * 6.28, sp: (2.2 + Math.random() * 1.8) / span });
    }
    this.boats.count = this.boatState.length;
    this.boats.visible = this.boats.count > 0;
  }

  update(dt, t, night = 0) {
    const g = this.game, cam = g.camera;
    if (!cam || !g.islands) return;
    const inPort = g.mode === 'port' || g.mode === 'duel';   // port screens: the harbour backdrop keeps its life, no sea gulls over the player
    const noLife = g.mode === 'duel';
    // nearest port within 2.5 km of the camera
    let best = null, bd = 2500;
    if (!noLife) for (const p of [...g.islands.ports, ...(g.islands.villages || [])]) {   // fishing villages: smoke of the fires, small boats
      const d = Math.hypot(p.quay.x - cam.position.x, p.quay.z - cam.position.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (best !== this.port) this._setPort(best);
    const wa = g.wind?.angle ?? 0;
    this.smokeU.uTime.value = t; this.smokeU.uWind.value.set(Math.sin(wa), -Math.cos(wa));
    const day = 1 - night * 0.75;
    this.smokeU.uLight.value.setScalar(day); this.gullU.uLight.value.setScalar(day);
    this.gullU.uTime.value = t;
    const p = this.port;
    if (p) {
      this.gullU.uA0.value.set(p.quay.x + p.seaward.x * 40, 0, p.quay.z + p.seaward.z * 40, night > 0.6 ? 0 : 1);
      const s = p.seaward, l = p.lateral, q = p.quay;
      const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
      this.boatState.forEach((b, i) => {
        const ph = b.ph + t * b.sp, u = Math.sin(ph), dir = Math.cos(ph) >= 0 ? 1 : -1;
        const x = q.x + s.x * b.off + l.x * u * b.span, z = q.z + s.z * b.off + l.z * u * b.span;
        v.set(x, Math.sin(t * 1.3 + i) * 0.12 - 0.05, z);
        // heading along the lane (bow = local -Z)
        qt.setFromAxisAngle(up, Math.atan2(-l.x * dir, -l.z * dir));
        qt.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(t * 0.9 + i * 2) * 0.05));
        m.compose(v, qt, sc); this.boats.setMatrixAt(i, m);
      });
      this.boats.instanceMatrix.needsUpdate = true;
    } else this.gullU.uA0.value.w = 0;
    // a few gulls over the player's ship at sea (not in port screens)
    const pl = g.player;
    if (pl && !inPort) this.gullU.uA1.value.set(pl.position.x, 0, pl.position.z, night > 0.6 ? 0 : 1);
    else this.gullU.uA1.value.w = 0;
  }
}
