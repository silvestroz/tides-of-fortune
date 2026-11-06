// Painterly time-of-day palette. Keyframes are indexed by SUN ELEVATION (degrees), not clock time,
// so dawn and dusk share structure; a dawn tint is blended in for mornings, a storm grade on top.
// samplePalette(elevDeg, morning 0..1, storm 0..1, out) fills `out` (all colours linear).
import * as THREE from 'three';

const C = (h) => new THREE.Color(h);
// fields: zenith, horizon, glow (Mie halo), band (sun-side horizon warmth), anti (belt of Venus),
// light (direct light colour), lightI, hemiSky, hemiGround, hemiI, cloudLit, cloudShade, exposure, stars, haze
const KEYS = [
  { el: -24, zenith: C('#040914'), horizon: C('#0c1a33'), glow: C('#0a1428'), band: C('#0d1a35'), anti: C('#0b1630'),
    light: C('#7f9fd9'), lightI: 0.55, hemiSky: C('#2a4777'), hemiGround: C('#060c18'), hemiI: 0.55,
    cloudLit: C('#24304a'), cloudShade: C('#0b1222'), exposure: 1.35, stars: 1.0, haze: 0.5 },
  { el: -10, zenith: C('#0b1838'), horizon: C('#2c3b66'), glow: C('#4a3f6a'), band: C('#6a4060'), anti: C('#1d2850'),
    light: C('#7f9fd9'), lightI: 0.4, hemiSky: C('#34507f'), hemiGround: C('#0a1020'), hemiI: 0.55,
    cloudLit: C('#5a4a6e'), cloudShade: C('#1a2038'), exposure: 1.3, stars: 0.75, haze: 0.6 },
  { el: -4, zenith: C('#2a326e'), horizon: C('#b06d66'), glow: C('#ff7a52'), band: C('#ff5c3c'), anti: C('#6a5a8a'),
    light: C('#ff8a5a'), lightI: 0.08, hemiSky: C('#6a6a9a'), hemiGround: C('#1a1a2a'), hemiI: 0.65,
    cloudLit: C('#ff7f5c'), cloudShade: C('#3c3456'), exposure: 1.2, stars: 0.15, haze: 0.8 },
  { el: 0, zenith: C('#2c4688'), horizon: C('#f09a5e'), glow: C('#ff8a40'), band: C('#ff6e3a'), anti: C('#bb88ac'),
    light: C('#ff8848'), lightI: 1.3, hemiSky: C('#7d86b6'), hemiGround: C('#2a2c3a'), hemiI: 0.75,
    cloudLit: C('#ffaa70'), cloudShade: C('#5a4a68'), exposure: 0.92, stars: 0.0, haze: 1.0 },
  { el: 5, zenith: C('#3a68ac'), horizon: C('#f6c08a'), glow: C('#ffb46b'), band: C('#ff9a55'), anti: C('#b9b0c4'),
    light: C('#ffae66'), lightI: 2.4, hemiSky: C('#8ea4cc'), hemiGround: C('#2f3a44'), hemiI: 0.85,
    cloudLit: C('#ffcf9a'), cloudShade: C('#6f6a86'), exposure: 0.92, stars: 0.0, haze: 1.0 },
  // golden hour (tod ~16.5-18.5 sits at el ~35..8): warm low key, cooler blue fill, peach horizon
  { el: 14, zenith: C('#2c5ea8'), horizon: C('#f0be8c'), glow: C('#ffb468'), band: C('#ff9c52'), anti: C('#a9b0d0'),
    light: C('#ffa458'), lightI: 3.0, hemiSky: C('#6f8ec4'), hemiGround: C('#283042'), hemiI: 0.72,
    cloudLit: C('#ffc888'), cloudShade: C('#5a5f8c'), exposure: 0.95, stars: 0.0, haze: 0.9 },
  { el: 24, zenith: C('#2462b8'), horizon: C('#ecd0a2'), glow: C('#ffc47e'), band: C('#ffb06a'), anti: C('#b4c2dc'),
    light: C('#ffba74'), lightI: 3.35, hemiSky: C('#7c9ed2'), hemiGround: C('#2c3c4c'), hemiI: 0.74,
    cloudLit: C('#ffd6a0'), cloudShade: C('#5e6c96'), exposure: 0.95, stars: 0.0, haze: 0.78 },
  { el: 38, zenith: C('#3174be'), horizon: C('#d2dcdc'), glow: C('#ffe4bc'), band: C('#ffdcae'), anti: C('#cadae4'),
    light: C('#ffe4bc'), lightI: 3.3, hemiSky: C('#9cc0e2'), hemiGround: C('#364c58'), hemiI: 0.95,
    cloudLit: C('#fff6e6'), cloudShade: C('#7286a6'), exposure: 0.96, stars: 0.0, haze: 0.85 },
  { el: 52, zenith: C('#2f74c0'), horizon: C('#c6e2ee'), glow: C('#fff1d6'), band: C('#ffe6c0'), anti: C('#cfe2ec'),
    light: C('#fff0d8'), lightI: 3.3, hemiSky: C('#a8cbea'), hemiGround: C('#38505a'), hemiI: 1.0,
    cloudLit: C('#ffffff'), cloudShade: C('#7488a8'), exposure: 0.96, stars: 0.0, haze: 0.8 },
  { el: 75, zenith: C('#286cc0'), horizon: C('#bcdcec'), glow: C('#fff7e6'), band: C('#fff0d8'), anti: C('#c8e0ec'),
    light: C('#fff6e8'), lightI: 3.4, hemiSky: C('#a8cbea'), hemiGround: C('#3a525c'), hemiI: 1.0,
    cloudLit: C('#ffffff'), cloudShade: C('#7a8cac'), exposure: 0.95, stars: 0.0, haze: 0.75 },
];
const COLOR_KEYS = ['zenith', 'horizon', 'glow', 'band', 'anti', 'light', 'hemiSky', 'hemiGround', 'cloudLit', 'cloudShade'];
const NUM_KEYS = ['lightI', 'hemiI', 'exposure', 'stars', 'haze'];

// Dawn: cooler, pinker, more pastel than dusk.
const DAWN = { horizon: C('#f0b2a0'), glow: C('#ffa48a'), band: C('#ff8f86'), anti: C('#9fb2d8'), light: C('#ffb08a'), cloudLit: C('#ffc0b0') };
// Storm: slate greys with a sickly green-teal cast.
const STORM = { zenith: C('#2c363e'), horizon: C('#5f6d72'), glow: C('#8a8c80'), band: C('#77766a'), anti: C('#56626a'),
  light: C('#aab4b8'), hemiSky: C('#66767f'), hemiGround: C('#1e262c'), cloudLit: C('#7c878c'), cloudShade: C('#262e35') };

export function createPaletteState() {
  const o = {};
  for (const k of COLOR_KEYS) o[k] = new THREE.Color();
  for (const k of NUM_KEYS) o[k] = 0;
  return o;
}

const _c = new THREE.Color();
export function samplePalette(el, morning, storm, out) {
  let i = 0;
  while (i < KEYS.length - 2 && el > KEYS[i + 1].el) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  let t = THREE.MathUtils.clamp((el - a.el) / (b.el - a.el), 0, 1);
  t = t * t * (3 - 2 * t);
  for (const k of COLOR_KEYS) out[k].copy(a[k]).lerp(b[k], t);
  for (const k of NUM_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  // dawn tint strongest around the horizon crossing
  const dawnW = morning * Math.exp(-Math.pow((el - 1) / 9, 2)) * 0.75;
  if (dawnW > 0.001) for (const k in DAWN) out[k].lerp(DAWN[k], dawnW);
  if (storm > 0.001) {
    const day = THREE.MathUtils.smoothstep(el, -8, 6);
    for (const k in STORM) {
      _c.copy(STORM[k]).multiplyScalar(0.12 + 0.88 * day);
      // keep a little sunset warmth bleeding through
      out[k].lerp(_c, storm * 0.85);
    }
    out.lightI *= 1 - storm * 0.72;
    out.hemiI *= 1 - storm * 0.15;
    out.exposure *= 1 + storm * 0.1;
    out.stars *= 1 - storm;
    out.haze += storm * 1.4;
  }
  return out;
}
