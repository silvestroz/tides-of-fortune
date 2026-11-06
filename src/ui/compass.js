// Brass binnacle compass (heading-up). The card rotates with the ship; a lubber mark stays at the bow.
// Shows: 32-point rose, degree ring, wind vane (where the wind comes FROM, barbs = strength), no-go wedge,
// port/starboard broadside reload arcs with gun pips, heading readout.
// API: new Compass(parentEl) ; compass.set({ heading, windAngle, windSpeed, reloadPort, reloadStar, guns })
const NS = 'http://www.w3.org/2000/svg';
const deg = r => r * 180 / Math.PI;
const pol = (r, a) => [Math.sin(a) * r, -Math.cos(a) * r];   // bearing a (rad), 0 = up

function arcPath(r, a0, a1) {
  const [x0, y0] = pol(r, a0), [x1, y1] = pol(r, a1);
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} ${a1 > a0 ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function sector(r0, r1, a0, a1) {
  const [x0, y0] = pol(r1, a0), [x1, y1] = pol(r1, a1), [x2, y2] = pol(r0, a1), [x3, y3] = pol(r0, a0);
  return `M${x0} ${y0} A${r1} ${r1} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 0 0 ${x3} ${y3} Z`;
}

const POINTS = ['N', 'NbE', 'NNE', 'NEbN', 'NE', 'NEbE', 'ENE', 'EbN', 'E', 'EbS', 'ESE', 'SEbE', 'SE', 'SEbS', 'SSE', 'SbE',
  'S', 'SbW', 'SSW', 'SWbS', 'SW', 'SWbW', 'WSW', 'WbS', 'W', 'WbN', 'WNW', 'NWbW', 'NW', 'NWbN', 'NNW', 'NbW'];
export function compassPoint(h) {
  const a = ((h % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return POINTS[Math.round(a / (Math.PI * 2) * 32) % 32].replace('b', ' by ');
}

export class Compass {
  constructor(parent) {
    const id = 'cp' + Math.floor(Math.random() * 1e6);
    const R_FACE = 84, R_BEZ = 100;
    // ---- rotating card ----
    let card = '';
    // degree ring
    for (let i = 0; i < 360; i += 5) {
      const a = i * Math.PI / 180, long = i % 30 === 0, mid = i % 10 === 0;
      const [x0, y0] = pol(R_FACE - 0.5, a), [x1, y1] = pol(R_FACE - (long ? 9 : mid ? 6 : 3.5), a);
      card += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#2a1c10" stroke-width="${long ? 1.3 : 0.7}"/>`;
    }
    card += `<circle r="${R_FACE - 11}" fill="none" stroke="#2a1c10" stroke-width="0.6"/>`;
    // rhumb lines
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, [x, y] = pol(R_FACE - 12, a);
      card += `<line x1="0" y1="0" x2="${x}" y2="${y}" stroke="#5a4128" stroke-width="${i % 2 ? 0.35 : 0.6}" stroke-opacity="0.6"/>`;
    }
    // 32-point rose: minor, intercardinal, cardinal stars
    const star = (r, w, a, f1, f2) => {
      const [tx, ty] = pol(r, a), [rx, ry] = pol(w, a + Math.PI / 4);
      const [l2x, l2y] = pol(w, a - Math.PI / 4);
      return `<path d="M0 0 L${l2x} ${l2y} L${tx} ${ty} Z" fill="${f1}" stroke="#2a1c10" stroke-width="0.5"/>
              <path d="M0 0 L${rx} ${ry} L${tx} ${ty} Z" fill="${f2}" stroke="#2a1c10" stroke-width="0.5"/>`;
    };
    for (let i = 0; i < 8; i++) card += star(44, 6, Math.PI / 8 + i * Math.PI / 4, '#e8d7ab', '#7b6244');
    for (let i = 0; i < 4; i++) card += star(58, 11, Math.PI / 4 + i * Math.PI / 2, '#d7c08c', '#3d2a17');
    for (let i = 0; i < 4; i++) card += star(i === 0 ? 72 : 68, 14, i * Math.PI / 2, i === 0 ? '#c94a3a' : '#efe0b8', i === 0 ? '#7a1414' : '#2a1c10');
    card += `<circle r="9" fill="#e9d8ae" stroke="#2a1c10" stroke-width="0.8"/><circle r="5.5" fill="none" stroke="#2a1c10" stroke-width="0.5"/>`;
    // fleur-de-lis style north mark (original simple trefoil)
    card += `<g transform="translate(0 ${-R_FACE + 18})" fill="#7a1414"><path d="M0 -6 C2.2 -3 2.2 0 0 2.2 C-2.2 0 -2.2 -3 0 -6Z"/></g>`;
    // cardinal letters
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([t, a]) => {
      const [x, y] = pol(R_FACE - 20.5, a * Math.PI / 180);
      card += `<text x="${x}" y="${y}" transform="rotate(${a} ${x} ${y})" text-anchor="middle" dominant-baseline="central" font-family="'IM Fell English SC', Georgia, serif" font-size="${t === 'N' ? 0 : 15}" fill="#2a1c10">${t}</text>`;
    });
    [30, 60, 120, 150, 210, 240, 300, 330].forEach(a => {
      const [x, y] = pol(R_FACE - 15, a * Math.PI / 180);
      card += `<text x="${x}" y="${y}" transform="rotate(${a} ${x} ${y})" text-anchor="middle" dominant-baseline="central" font-family="Georgia, serif" font-size="6.5" fill="#5a4128">${a}</text>`;
    });

    // ---- bezel ticks (fixed) ----
    let bezel = '';
    for (let i = 0; i < 64; i++) {
      const a = i * Math.PI / 32, [x0, y0] = pol(R_BEZ - 3, a), [x1, y1] = pol(R_BEZ - (i % 8 === 0 ? 9 : i % 2 ? 5 : 6.5), a);
      bezel += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#3a2608" stroke-width="${i % 8 === 0 ? 1.4 : 0.7}" stroke-opacity="0.85"/>`;
    }
    // reload arcs: port = left (bearing 205°..335°), starboard = right (25°..155°)
    const A = a => a * Math.PI / 180;
    const P0 = A(208), P1 = A(332), S0 = A(28), S1 = A(152);
    const RR = 111;

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '-125 -125 250 250');
    svg.setAttribute('class', 'compass');
    svg.innerHTML = `
      <defs>
        <radialGradient id="${id}face" cx="0.45" cy="0.4" r="0.7"><stop offset="0" stop-color="#f6ead0"/><stop offset="0.7" stop-color="#e3cd99"/><stop offset="1" stop-color="#b8945a"/></radialGradient>
        <linearGradient id="${id}brass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b5"/><stop offset="0.25" stop-color="#d9b55a"/><stop offset="0.5" stop-color="#7d5a1f"/><stop offset="0.72" stop-color="#d2ab55"/><stop offset="1" stop-color="#5e4210"/></linearGradient>
        <linearGradient id="${id}brass2" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1d488"/><stop offset="0.5" stop-color="#8a6424"/><stop offset="1" stop-color="#e9c97a"/></linearGradient>
        <linearGradient id="${id}fire" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffd67a"/><stop offset="1" stop-color="#ff9a3a"/></linearGradient>
        <filter id="${id}paper" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="n"/>
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.22  0 0 0 0 0.08  0 0 0 0.22 0" result="t"/><feComposite in="t" in2="SourceGraphic" operator="in" result="tt"/>
          <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="tt"/></feMerge></filter>
        <filter id="${id}glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <radialGradient id="${id}glass" cx="0.35" cy="0.25" r="0.75"><stop offset="0" stop-color="#fff" stop-opacity="0.28"/><stop offset="0.35" stop-color="#fff" stop-opacity="0.05"/><stop offset="1" stop-color="#000" stop-opacity="0.18"/></radialGradient>
      </defs>
      <!-- reload channels -->
      <g class="reload">
        <path d="${arcPath(RR, P0, P1)}" stroke="#1b0f06" stroke-width="10" stroke-linecap="round" fill="none" stroke-opacity="0.82"/>
        <path d="${arcPath(RR, S0, S1)}" stroke="#1b0f06" stroke-width="10" stroke-linecap="round" fill="none" stroke-opacity="0.82"/>
        <path class="rp" d="${arcPath(RR, P0, P1)}" stroke="url(#${id}fire)" stroke-width="5.5" stroke-linecap="round" fill="none"/>
        <path class="rs" d="${arcPath(RR, S1, S0)}" stroke="url(#${id}fire)" stroke-width="5.5" stroke-linecap="round" fill="none"/>
        <g class="pips-p"></g><g class="pips-s"></g>
      </g>
      <!-- bezel -->
      <circle r="${R_BEZ + 3}" fill="#1b0f06"/>
      <circle r="${R_BEZ + 1}" fill="url(#${id}brass)"/>
      <circle r="${R_BEZ - 2.5}" fill="url(#${id}brass2)"/>
      <circle r="${R_BEZ - 3}" fill="none" stroke="#3a2608" stroke-width="0.6"/>
      ${bezel}
      <circle r="${R_FACE + 2.5}" fill="#2a1a08"/>
      <circle r="${R_FACE}" fill="url(#${id}face)" filter="url(#${id}paper)"/>
      <!-- rotating card -->
      <g class="card">
        ${card}
        <path class="nogo" d="" fill="#8e1b1b" fill-opacity="0.28" stroke="#8e1b1b" stroke-opacity="0.9" stroke-width="1" stroke-dasharray="3 2"/>
        <g class="nogo-lbl"><text y="${-R_FACE + 28}" text-anchor="middle" font-family="'IM Fell English SC', Georgia, serif" font-size="12" fill="#8e1b1b" stroke="#f3e6c4" stroke-width="3" paint-order="stroke">head to wind</text></g>
        <g class="vane">
          <g class="vane-body">
            <path d="M0 ${-R_FACE - 1} L0 -12" stroke="#f6ecd2" stroke-width="6.5" stroke-linecap="round" stroke-opacity="0.9"/>
            <path d="M0 ${-R_FACE - 1} L0 -12" stroke="#0f4a5e" stroke-width="3.6" stroke-linecap="round"/>
            <path d="M0 -6 L-9.5 -25 L0 -20 L9.5 -25 Z" fill="#0f4a5e" stroke="#f6ecd2" stroke-width="1.2"/>
            <g class="barbs" stroke="#0f4a5e" stroke-width="2.2" stroke-linecap="round"></g>
          </g>
        </g>
      </g>
      </g>
      <!-- fixed overlays -->
      <g class="ship-mark" opacity="0.9">
        <path d="M0 -15 C4 -9 5 -2 4.5 8 L3 12 L-3 12 L-4.5 8 C-5 -2 -4 -9 0 -15 Z" fill="#2a1c10" stroke="#f3e6c4" stroke-width="0.8"/>
        <path d="M0 -8 V8" stroke="#e9d8ae" stroke-width="0.8"/>
      </g>
      <path d="M0 ${-R_BEZ - 6} L-7 ${-R_BEZ + 6} L0 ${-R_BEZ + 2} L7 ${-R_BEZ + 6} Z" fill="#8e1b1b" stroke="#2a0606" stroke-width="1"/>
      <circle r="${R_FACE}" fill="url(#${id}glass)" pointer-events="none"/>
      <g class="windmark"><path d="M0 ${-R_FACE - 1} L-6.5 ${-R_BEZ + 0.5} Q0 ${-R_BEZ + 4} 6.5 ${-R_BEZ + 0.5} Z" fill="#1f6a82" stroke="#f6ecd2" stroke-width="1.2"/></g>
      <g class="readout" transform="translate(0 ${R_FACE - 30})">
        <rect x="-34" y="-12" width="68" height="24" rx="2.5" fill="#2a1c10" stroke="url(#${id}brass)" stroke-width="1.6"/>
        <text class="hdg" x="0" y="0.6" text-anchor="middle" dominant-baseline="central" font-family="'IM Fell English SC', Georgia, serif" font-size="18" fill="#f3e2b0" letter-spacing="0.4">045°</text>
      </g>`;
    parent.appendChild(svg);
    this.svg = svg;
    this.card = svg.querySelector('.card');
    this.vane = svg.querySelector('.vane');
    this.barbs = svg.querySelector('.barbs');
    this.nogo = svg.querySelector('.nogo');
    this.windmark = svg.querySelector('.windmark');
    this.nogoLbl = svg.querySelector('.nogo-lbl');
    this.hdg = svg.querySelector('.hdg');
    this.rp = svg.querySelector('.rp'); this.rs = svg.querySelector('.rs');
    this.pipsP = svg.querySelector('.pips-p'); this.pipsS = svg.querySelector('.pips-s');
    for (const p of [this.rp, this.rs]) { const L = p.getTotalLength?.() || 240; p.style.strokeDasharray = `${L} ${L}`; p._len = L; }
    this._arc = { P0, P1, S0, S1, RR };
    this._guns = -1; this._barbs = -1; this._nogoA = null; this._last = {};
    this.R_FACE = R_FACE;
  }

  _pips(n) {
    const { P0, P1, S0, S1, RR } = this._arc;
    const mk = (a0, a1) => {
      let s = '';
      for (let i = 0; i < n; i++) {
        const a = a0 + (a1 - a0) * (n === 1 ? 0.5 : i / (n - 1));
        const [x, y] = pol(RR, a);
        s += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.6"/>`;
      }
      return s;
    };
    this.pipsP.innerHTML = mk(P0 + 0.06, P1 - 0.06); this.pipsS.innerHTML = mk(S0 + 0.06, S1 - 0.06);
  }

  set({ heading = 0, windAngle = 0, windSpeed = 0, reloadPort = 1, reloadStar = 1, guns = 14, noGo = Math.PI / 4 }) {
    this.card.setAttribute('transform', `rotate(${(-deg(heading)).toFixed(2)})`);
    const from = windAngle + Math.PI;
    this.vane.setAttribute('transform', `rotate(${deg(from).toFixed(2)})`);
    this.windmark.setAttribute('transform', `rotate(${deg(from - heading).toFixed(2)})`);
    if (this._nogoA !== noGo) {
      this._nogoA = noGo;
      // wedge drawn at bearing 0 (inside the vane group's rotation would double-rotate; so build in card space via vane angle)
    }
    this.nogo.setAttribute('d', sector(10, this.R_FACE - 1, from - noGo, from + noGo));
    this.nogoLbl.setAttribute('transform', `rotate(${(deg(from) + 24).toFixed(1)})`);
    // barbs: one per ~2.5 m/s (half barb each 1.25)
    const kn = windSpeed * 1.944, n = Math.max(0, Math.min(8, Math.round(kn / 5)));
    if (n !== this._barbs) {
      this._barbs = n;
      let s = '', y = -this.R_FACE + 5;
      for (let i = 0; i < Math.floor(n / 2); i++, y += 5) s += `<line x1="0" y1="${y}" x2="9" y2="${y - 6}"/>`;
      if (n % 2) s += `<line x1="0" y1="${y}" x2="5" y2="${y - 3.4}"/>`;
      this.barbs.innerHTML = s;
    }
    const hdeg = ((Math.round(deg(heading)) % 360) + 360) % 360;
    if (this._last.h !== hdeg) { this._last.h = hdeg; this.hdg.textContent = String(hdeg).padStart(3, '0') + '°'; }
    const gp = Math.max(1, Math.round((guns || 14) / 2));
    if (gp !== this._guns) { this._guns = gp; this._pips(Math.min(gp, 18)); }
    const fill = (p, v) => { p.style.strokeDashoffset = (p._len * (1 - Math.max(0, Math.min(1, v)))).toFixed(1); p.style.opacity = v >= 1 ? 1 : 0.6; };
    fill(this.rp, reloadPort); fill(this.rs, reloadStar);
    this.pipsP.setAttribute('fill', reloadPort >= 1 ? '#3a1a04' : '#d8b96a');
    this.pipsS.setAttribute('fill', reloadStar >= 1 ? '#3a1a04' : '#d8b96a');
    this.svg.querySelector('.reload').style.filter = '';
  }
}
