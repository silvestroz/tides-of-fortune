// Procedural textures for the particle system (no asset files).
//   makeParticleAtlas() -> THREE.CanvasTexture  2x2 atlas, white RGB, shape in ALPHA:
//     frame 0 = billowing smoke puff (cauliflower lobes), 1 = flame tongue,
//     frame 2 = spray droplets cluster, 3 = soft round glow / mist.
//   makeWoodTexture() -> THREE.CanvasTexture  painterly plank grain for debris.
import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

const CELL = 256;

function softBlob(ctx, x, y, r, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(0.55, `rgba(255,255,255,${a * 0.6})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

function drawCell(ctx, ox, oy, fn) {
  ctx.save();
  ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
  ctx.translate(ox, oy);
  fn(ctx);
  ctx.restore();
}

// fade alpha to zero toward the cell border so billboards are never hard-edged
function edgeMask(ctx, ox, oy, inner = 0.25, outer = 0.5) {
  ctx.save();
  // clip first: destination-in otherwise clears every pixel outside the source shape (i.e. the other atlas cells)
  ctx.beginPath(); ctx.rect(ox, oy, CELL, CELL); ctx.clip();
  ctx.globalCompositeOperation = 'destination-in';
  const c = CELL / 2;
  const g = ctx.createRadialGradient(ox + c, oy + c, CELL * inner, ox + c, oy + c, CELL * outer * 0.98);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(ox, oy, CELL, CELL);
  ctx.restore();
}

export function makeParticleAtlas() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = CELL * 2;
  const ctx = cv.getContext('2d');
  const rnd = mulberry32(9137);

  // 0: smoke volute — curling filaments wound along a swirl field over a thin mist, instead of a
  // round cotton puff: soft wide strokes for the body, finer brighter strokes for the curls, ragged eroded rim
  drawCell(ctx, 0, 0, c => {
    softBlob(c, 128, 134, 60, 0.26);
    const curl = (x, y, ang, len, w0, a0, turn) => {
      let px = x, py = y;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        ang += turn * (0.6 + t * 1.4);
        const nx = px + Math.cos(ang) * 3.2, ny = py + Math.sin(ang) * 3.2;
        c.strokeStyle = `rgba(255,255,255,${a0 * Math.sin(Math.PI * Math.min(1, t * 1.3 + 0.05))})`;
        c.lineWidth = w0 * (1 - t * 0.75); c.lineCap = 'round';
        c.beginPath(); c.moveTo(px, py); c.lineTo(nx, ny); c.stroke();
        px = nx; py = ny;
      }
    };
    c.filter = 'blur(6px)';
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2, d = 10 + rnd() * 40;
      curl(128 + Math.cos(a) * d, 134 + Math.sin(a) * d * 0.8, a + Math.PI * 0.5, 18 + rnd() * 18, 26 + rnd() * 22, 0.16 + rnd() * 0.12, (rnd() < 0.5 ? -1 : 1) * (0.05 + rnd() * 0.06));
    }
    c.filter = 'blur(2px)';
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2, d = 20 + rnd() * 55;
      curl(128 + Math.cos(a) * d, 132 + Math.sin(a) * d * 0.85, a + Math.PI * 0.5 + (rnd() - 0.5), 10 + rnd() * 16, 5 + rnd() * 9, 0.12 + rnd() * 0.14, (rnd() < 0.5 ? -1 : 1) * (0.1 + rnd() * 0.12));
    }
    c.filter = 'none';
  });
  edgeMask(ctx, 0, 0, 0.16, 0.5);

  // 1: flame tongue — teardrop pointing up, ragged
  drawCell(ctx, CELL, 0, c => {
    for (let i = 0; i < 40; i++) {
      const t = rnd();
      const y = 170 - t * 120, w = (1 - t) * 46 + 8;
      softBlob(c, 128 + (rnd() - 0.5) * w * 0.9, y + (rnd() - 0.5) * 18, w * (0.5 + rnd() * 0.6), 0.25 + 0.3 * (1 - t));
    }
    softBlob(c, 128, 160, 52, 0.9);
  });
  edgeMask(ctx, CELL, 0, 0.2, 0.5);

  // 2: spray — droplets + mist
  drawCell(ctx, 0, CELL, c => {
    softBlob(c, 128, 128, 90, 0.25);
    for (let i = 0; i < 140; i++) {
      const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.6) * 100;
      softBlob(c, 128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 2 + rnd() * 6, 0.5 + rnd() * 0.5);
    }
    for (let i = 0; i < 20; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * 60;
      softBlob(c, 128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 18 + rnd() * 20, 0.2);
    }
  });
  edgeMask(ctx, 0, CELL, 0.2, 0.5);

  // 3: soft glow dot
  drawCell(ctx, CELL, CELL, c => {
    const g = c.createRadialGradient(128, 128, 0, 128, 128, 126);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, CELL, CELL);
  });

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function makeWoodTexture() {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 256;
  const c = cv.getContext('2d');
  const rnd = mulberry32(4411);
  c.fillStyle = '#8a5a2b'; c.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 90; i++) {
    const x = rnd() * 64, w = 0.6 + rnd() * 2.2;
    const l = rnd();
    c.fillStyle = l < 0.5 ? `rgba(43,26,16,${0.12 + rnd() * 0.25})` : `rgba(214,160,96,${0.08 + rnd() * 0.2})`;
    c.beginPath();
    c.moveTo(x, 0);
    for (let y = 0; y <= 256; y += 16) c.lineTo(x + Math.sin(y * 0.03 + i) * 2.5, y);
    c.lineTo(x + w, 256); c.lineTo(x + w, 0); c.fill();
  }
  // splintered dark ends
  c.fillStyle = 'rgba(30,18,10,0.6)'; c.fillRect(0, 0, 64, 6); c.fillRect(0, 250, 64, 6);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
