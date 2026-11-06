// Painterly cumulus: each cloud is a cluster of camera-facing "puffs" (one InstancedBufferGeometry, ONE draw call).
// Every puff is shaded as a noisy sphere: wrap-lit tops, cool shaded bellies (by height within the cloud),
// silver lining when back-lit, sun-tinted at golden hour, and aerial haze toward the horizon colour.
// The field tiles infinitely around the camera and drifts with game.wind. Puffs are depth-sorted on the CPU.
// API: new CloudLayer(skyUniforms) ; .mesh ; .setCoverage(0..1) ; .update(dt, camera, wind)
import * as THREE from 'three';
import { mulberry32 } from '../../core/rng.js';
import { QUALITY } from '../../core/constants.js';

const TILE = 14000;          // cloud field tiles every TILE metres around the camera
const N_CLOUDS = 72;

const vert = /* glsl */`
attribute vec3 aAnchor;     // cloud anchor (tile space, xz) + base altitude
attribute vec4 aPuff;       // xyz offset from anchor, w = radius
attribute vec4 aInfo;       // x = height-in-cloud 0..1, y = seed, z = cloud threshold (vs coverage), w = cloud scale
uniform vec3 uCam;
uniform vec2 uWindOff;
uniform float uCoverage;
uniform sampler2D uNoise;
varying vec2 vUv;
varying vec4 vInfo;
varying vec3 vWorld;
varying vec3 vRight, vUp, vFwd;
varying float vFade;
void main() {
  // wrap anchor around camera
  vec2 a = aAnchor.xz + uWindOff;
  a = mod( a - uCam.xz + 0.5 * ${TILE.toFixed(1)}, ${TILE.toFixed(1)} ) - 0.5 * ${TILE.toFixed(1)} + uCam.xz;
  // coverage: clouds whose threshold exceeds coverage shrink away
  float grow = smoothstep( aInfo.z - 0.12, aInfo.z + 0.05, uCoverage );
  float sc = aInfo.w * mix( 0.35, 1.0, grow ) * ( 1.0 + 0.35 * smoothstep( 0.75, 1.0, uCoverage ) );
  vec3 center = vec3( a.x, aAnchor.y, a.y ) + aPuff.xyz * sc;
  float r = aPuff.w * sc * grow;
  // fade clouds near the tile edge so wrapping never pops
  float d = length( center.xz - uCam.xz );
  vFade = 1.0 - smoothstep( 0.36 * ${TILE.toFixed(1)}, 0.49 * ${TILE.toFixed(1)}, d );
  vec3 toCam = normalize( uCam - center );
  vec3 right = normalize( cross( vec3( 0.0, 1.0, 0.0 ), toCam ) );
  vec3 up = cross( toCam, right );
  vec3 wp = center + ( right * position.x + up * position.y ) * r;
  vUv = position.xy;
  vInfo = aInfo;
  vWorld = center;
  vRight = right; vUp = up; vFwd = toCam;
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}
`;

const frag = /* glsl */`
uniform vec3 uCloudLit, uCloudShade, uSunColor, uGlow, uHorizon, uBand;
uniform vec3 uSunDir, uCam, uMoonDir;
uniform float uSunUp, uFlash, uOvercast, uLightI;
uniform vec3 uFlashDir;
uniform sampler2D uNoise;
uniform vec2 uWindOff;
varying vec2 vUv;
varying vec4 vInfo;
varying vec3 vWorld;
varying vec3 vRight, vUp, vFwd;
varying float vFade;
void main() {
  float r2 = dot( vUv, vUv );
  if ( r2 > 1.0 ) discard;
  // noisy edge: billowy cauliflower breakup + fine wisps
  vec2 nuv = vUv * 0.22 + vInfo.y * 7.31;
  float n1 = texture2D( uNoise, nuv ).r;
  float n2 = texture2D( uNoise, vUv * 0.55 + vInfo.y * 3.1 ).g;
  float edge = sqrt( r2 ) + ( n1 - 0.5 ) * 0.55 + ( n2 - 0.5 ) * 0.22;
  float alpha = smoothstep( 1.0, 0.55, edge ) * smoothstep( 1.0, 0.78, sqrt( r2 ) );
  if ( alpha < 0.01 ) discard;
  // sphere-ish normal (bumped)
  float z = sqrt( max( 1.0 - r2, 0.0 ) );
  vec3 n = normalize( vRight * ( vUv.x + ( n1 - 0.5 ) * 0.6 ) + vUp * ( vUv.y + ( n2 - 0.5 ) * 0.6 ) + vFwd * z * 0.9 );
  vec3 L = normalize( uSunDir );
  float ndl = dot( n, L );
  float wrap = clamp( ndl * 0.55 + 0.45, 0.0, 1.0 );
  // bellies are flat & shaded; tops catch light
  float h = clamp( vInfo.x + vUv.y * 0.18, 0.0, 1.0 );
  float belly = smoothstep( 0.0, 0.55, h );
  float lit = wrap * mix( 0.35, 1.0, belly );
  // painterly posterise: soft 3-band step keeps the "brushed" look
  float band = floor( lit * 4.0 ) / 4.0;
  lit = mix( lit, band + 0.125, 0.18 );
  vec3 col = mix( uCloudShade, uCloudLit, lit );
  // direct sun warmth on lit faces (golden hour tint)
  col += uSunColor * pow( max( ndl, 0.0 ), 2.0 ) * 0.22 * uSunUp * belly * uLightI;
  // silver lining: thin edges back-lit by the sun
  vec3 V = normalize( vWorld - uCam );
  float mu = max( dot( V, L ), 0.0 );
  float thin = 1.0 - z;   // smooth toward the puff rim (no hard outline)
  col += ( uGlow * 0.6 + uSunColor * 0.3 ) * pow( mu, 10.0 ) * ( 0.35 + thin * 0.9 * h ) * uSunUp;
  col += uBand * pow( mu, 3.0 ) * 0.25 * uSunUp;
  // gfx-ultra: sun at or just below the horizon lights the cloud bellies from beneath (hot orange-pink undersides,
  // tops already turning to the cool violet shade) — the painted sunset look
  float under = smoothstep( -0.14, -0.01, L.y ) * ( 1.0 - smoothstep( 0.05, 0.18, L.y ) ) * ( 1.0 - uOvercast );
  col = mix( col, mix( uBand * 1.25, uGlow * 1.1, 0.4 ), under * ( 1.0 - belly * 0.7 ) * ( 0.45 + 0.4 * pow( mu, 2.0 ) ) );
  col = mix( col, col * vec3( 0.82, 0.74, 0.95 ), under * belly * 0.35 );
  // moonlit rim at night
  col += vec3( 0.25, 0.32, 0.5 ) * pow( max( dot( V, normalize( uMoonDir ) ), 0.0 ), 8.0 ) * ( 1.0 - uSunUp ) * ( 0.15 + thin * 0.25 );
  col *= 1.0 - uOvercast * 0.35 * ( 1.0 - h );
  // lightning flash illuminates from inside
  col += vec3( 0.55, 0.6, 0.85 ) * uFlash * ( 0.5 + 0.8 * z ) * ( 0.4 + 4.0 * pow( max( dot( normalize( vWorld - uCam ), uFlashDir ), 0.0 ), 12.0 ) + 1.2 * pow( max( dot( normalize( vWorld - uCam ), uFlashDir ), 0.0 ), 3.0 ) );
  // aerial perspective toward horizon colour (distance + low elevation)
  float dist = length( vWorld - uCam );
  float elev = max( ( vWorld.y - uCam.y ) / dist, 0.0 );
  float haze = 1.0 - exp( -dist * 0.00011 );
  haze = max( haze, 1.0 - smoothstep( 0.0, 0.09, elev ) );
  vec3 hz = uHorizon + uBand * pow( max( dot( normalize( vec3( V.x, 0.0, V.z ) ), normalize( vec3( L.x, 0.0, L.z ) + 1e-4 ) ), 0.0 ), 4.0 ) * 0.25 * uSunUp;
  col = mix( col, hz, clamp( haze * 0.75, 0.0, 0.85 ) );
  float a = alpha * vFade * smoothstep( 0.0, 0.03, elev + 0.01 );
  gl_FragColor = vec4( col * a, a ); // premultiplied
}
`;

export class CloudLayer {
  constructor(skyU) {
    const rnd = mulberry32(4242);
    const anchors = [], puffs = [], infos = [];
    const nClouds = Math.round(N_CLOUDS * (QUALITY.clouds ?? 1));
    for (let c = 0; c < nClouds; c++) {
      const ax = (rnd() - 0.5) * TILE, az = (rnd() - 0.5) * TILE;
      const alt = 560 + rnd() * 300;
      const thr = rnd();                       // appears when coverage > thr
      const scale = 0.7 + rnd() * 0.9;
      const big = thr > 0.6 ? 1.25 : 1.0;      // storm/cloudy-only clouds are bigger, towering
      const width = (520 + rnd() * 620) * big;
      const tall = (200 + rnd() * 320) * big * (thr > 0.7 ? 1.6 : 1);
      const nP = 16 + Math.floor(rnd() * 10);
      const seed = rnd();
      for (let p = 0; p < nP; p++) {
        // dome-shaped distribution: wide flat base, rounded heaped top
        const u = rnd() * 2 - 1, v = rnd() * 2 - 1;
        const x = u * width * 0.5, z = v * width * 0.32;
        const edgeFall = 1 - Math.min(1, Math.hypot(u, v * 1.2));
        const y = Math.pow(rnd(), 0.8) * tall * (0.35 + 0.65 * edgeFall);
        const rad = (130 + rnd() * 140) * (0.55 + 0.6 * edgeFall) * big;
        anchors.push(ax, alt, az);
        puffs.push(x, y, z, rad);
        infos.push(Math.min(1, y / tall), seed + p * 0.137, thr, scale);
      }
      // ultra: small cauliflower lobes heaped on the upper surface (own random stream: the cloud layout stays the
      // same as in the other tiers, only finer detail is added)
      const nD = Math.round(nP * (QUALITY.cloudDetail || 0));
      if (nD) {
        const r2 = mulberry32(9001 + c * 131);
        for (let p = 0; p < nD; p++) {
          const u = r2() * 2 - 1, v = r2() * 2 - 1;
          const edgeFall = 1 - Math.min(1, Math.hypot(u, v * 1.2));
          if (edgeFall <= 0.05) { p--; continue; }
          const y = tall * (0.45 + 0.6 * edgeFall) * (0.8 + r2() * 0.35);
          anchors.push(ax, alt, az);
          puffs.push(u * width * 0.45, y, v * width * 0.28, (55 + r2() * 60) * big);
          infos.push(Math.min(1, y / tall), seed + 0.5 + p * 0.173, thr, scale);
        }
      }
      // a couple of flat base puffs so the belly reads as a level line
      for (let p = 0; p < 4; p++) {
        anchors.push(ax, alt, az);
        puffs.push((rnd() - 0.5) * width * 0.7, -10, (rnd() - 0.5) * width * 0.3, (170 + rnd() * 90) * big);
        infos.push(0.0, seed + 0.9 + p * 0.21, thr, scale);
      }
    }
    this.count = anchors.length / 3;
    const base = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    this.src = { anchors: new Float32Array(anchors), puffs: new Float32Array(puffs), infos: new Float32Array(infos) };
    this.aAnchor = new THREE.InstancedBufferAttribute(new Float32Array(anchors), 3);
    this.aPuff = new THREE.InstancedBufferAttribute(new Float32Array(puffs), 4);
    this.aInfo = new THREE.InstancedBufferAttribute(new Float32Array(infos), 4);
    for (const a of [this.aAnchor, this.aPuff, this.aInfo]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aAnchor', this.aAnchor);
    g.setAttribute('aPuff', this.aPuff);
    g.setAttribute('aInfo', this.aInfo);
    g.instanceCount = this.count;
    this.uniforms = {
      uCloudLit: skyU.uCloudLit, uCloudShade: skyU.uCloudShade, uSunColor: skyU.uSunColor, uGlow: skyU.uGlow,
      uHorizon: skyU.uHorizon, uBand: skyU.uBand, uSunDir: skyU.uSunDir, uMoonDir: skyU.uMoonDir, uFlash: skyU.uFlash, uFlashDir: skyU.uFlashDir,
      uOvercast: skyU.uOvercast, uNoise: skyU.uNoise, uWindOff: skyU.uWindOff,
      uCam: { value: new THREE.Vector3() }, uCoverage: { value: 0.4 }, uSunUp: { value: 1 }, uLightI: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false, premultipliedAlpha: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -900;   // after sky, before world transparents
    this._order = new Uint32Array(this.count);
    this._dist = new Float32Array(this.count);
    this._sortTimer = 0;
    this.coverage = 0.4;
    this.targetCoverage = 0.4;
  }
  setCoverage(c) { this.targetCoverage = c; }
  update(dt, camera, windOff, force = false) {
    this.coverage += (this.targetCoverage - this.coverage) * Math.min(1, dt * 0.25);
    if (force) this.coverage = this.targetCoverage;
    this.uniforms.uCoverage.value = this.coverage;
    this.uniforms.uCam.value.copy(camera.position);
    // back-to-front sort (approximate: by puff centre with wrapped anchor). Throttled.
    this._sortTimer -= dt;
    if (this._sortTimer > 0 && !force) return;
    this._sortTimer = 0.25;
    const { anchors, puffs, infos } = this.src;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const T = TILE, H = TILE / 2;
    for (let i = 0; i < this.count; i++) {
      let ax = anchors[i * 3] + windOff.x, az = anchors[i * 3 + 2] + windOff.y;
      ax = ((ax - cx + H) % T + T) % T - H + cx;
      az = ((az - cz + H) % T + T) % T - H + cz;
      const sc = infos[i * 4 + 3];
      const x = ax + puffs[i * 4] * sc - cx, y = anchors[i * 3 + 1] + puffs[i * 4 + 1] * sc - cy, z = az + puffs[i * 4 + 2] * sc - cz;
      this._dist[i] = x * x + y * y + z * z;
      this._order[i] = i;
    }
    const d = this._dist;
    const ord = Array.from(this._order).sort((a, b) => d[b] - d[a]);
    const A = this.aAnchor.array, P = this.aPuff.array, I = this.aInfo.array;
    for (let k = 0; k < ord.length; k++) {
      const i = ord[k];
      A[k * 3] = anchors[i * 3]; A[k * 3 + 1] = anchors[i * 3 + 1]; A[k * 3 + 2] = anchors[i * 3 + 2];
      for (let j = 0; j < 4; j++) { P[k * 4 + j] = puffs[i * 4 + j]; I[k * 4 + j] = infos[i * 4 + j]; }
    }
    this.aAnchor.needsUpdate = this.aPuff.needsUpdate = this.aInfo.needsUpdate = true;
  }
}
