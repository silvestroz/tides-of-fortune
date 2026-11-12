// HUD lives in DOM inside game.uiRoot (#ui). Shows: compass + wind, speed/sail setting, hull/sails/crew,
// broadside reload, gold/date, notifications (listens to 'notify'), minimap.
// API: hud.update(dt), hud.notify(text, kind), hud.show(bool)
// Extended API:
//   hud.showMenu(screen='title'|'captain'|'settings'|'controls'|'pause'), hud.menu (Menu)
//   hud.minimap (Minimap; .range metres), hud.compass (Compass)
//   hud.hints (Hints : conseils contextuels, ligne d'objectif, prologue — src/ui/hints.js)
//   hud.target  the Ship shown in the target card (nearest hostile within 900 m, else nearest ship within 600 m) or null
//   Hostility comes from game.combat.isHostile(player, ship) (combat/factions.js); local fallback only if absent.
// Keys handled here: M (toggle the large sea chart; a world-map system can take over with game.mapKeyHandled = true),
//   Esc (pause menu / back), F (enter nearest port within 400 m: emits 'port:enter' {port} and
//   'state:change' {from:'sail', to:'port'} — a port system can take over by setting game.portKeyHandled = true).
// Listens: 'notify', 'cannon:hit', 'ship:sunk', 'state:change'.
// Emits: 'ui:pause' { paused }, 'settings:change' (via settings.js).
// URL: ?menu=1 forces the title screen, ?menu=captain the captain sheet; in ?shot= scenes the menu is not
//   auto-shown otherwise. ?nohud=1 → game.hud is null (Game doesn't construct it).
import { installTextures } from './textures.js';
import { ensureSettings } from './settings.js';
import { isKey, kc } from '../core/keys.js';
import { Toasts } from './toasts.js';
import { concernsPlayer } from '../game/notifyRules.js';
import { Compass, compassPoint } from './compass.js';
import { Minimap } from './minimap.js';
import { Menu } from './menu.js';
import { ICONS } from './icons.js';
import { ResourceBar } from './resourceBar.js';
import { ShoalAlert } from './shoalAlert.js';
import { MissionBrief } from './missionBrief.js';   // reminder of the missions under way (bottom right)
import { Hints } from './hints.js';   // onboarding: contextual hints + early-career goals
import { flagSVG, factionColor } from './flags.js';
import { relation } from '../combat/factions.js';
import { threatOf } from '../data/seaZones.js';   // sea tiers: threat pill
import { isAssist } from '../data/assist.js';   // “Assisted” mode: “Auto” broadsides, “Cease fire” reminder
import { MONTHS, fmtInt, fmtNum, shipDesc, shipType, theShip, ofShip, pointOfSail } from '../core/i18n.js';

const AMMO_NAMES = { round: 'Round shot', chain: 'Chain shot', grape: 'Grapeshot' };
const PART_NAMES = { hull: 'hull', sails: 'rigging', crew: 'crew' };
const PART_ART = { hull: 'our hull', sails: 'our rigging', crew: 'our crew' };
const clamp01 = v => Math.max(0, Math.min(1, v));

export function formatDate(d) {
  if (!d) return '';
  return `${d.day ?? 1} ${MONTHS[((d.month ?? 1) - 1 + 12) % 12]} ${d.year ?? 1660}`;
}
// "Four bells in the afternoon watch"
const WATCHES = [[0, 'middle watch'], [4, 'morning watch'], [8, 'forenoon watch'], [12, 'afternoon watch'], [16, 'dog watches'], [20, 'first watch']];
const NUM = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
export function shipsBells(hours) {
  const h = ((hours ?? 12) % 24 + 24) % 24;
  const halfHours = Math.floor(h * 2);
  const bells = (halfHours % 8) || 8;
  const w = WATCHES.filter(([s]) => s <= (bells === 8 ? (h - 0.01 + 24) % 24 : h)).pop()[1];
  return `${NUM[bells]} bell${bells > 1 ? 's' : ''}, ${w}`;
}

function wood(cls, inner) {
  return `<div class="${cls} tof-wood"><div class="tof-rim"></div><i class="tof-rivet tl"></i><i class="tof-rivet tr"></i><i class="tof-rivet bl"></i><i class="tof-rivet br"></i>
    <div class="inner tof-parch">${inner}</div></div>`;
}
function gauge(key, label) {
  return `<div class="gauge g-${key}"><span class="ico">${ICONS[key]}</span><span class="lbl">${label}</span>
    <span class="track"><span class="ghost"></span><span class="fill ${key}"></span><span class="ticks"></span></span><span class="val">100%</span></div>`;
}

export class HUD {
  constructor(game) {
    this.game = game;
    const root = this.root = game.uiRoot;
    ensureSettings(game);
    installTextures(root);
    this.visible = true;
    this.target = null;
    this._t = 0; this._mmT = 0; this._slowT = 0;
    this._cache = {};
    this._hitAgg = new Map();

    const el = this.el = document.createElement('div');
    el.id = 'hud';
    el.innerHTML = `
      <div class="vignette"></div>
      <div class="ledger-strip tof-parch await">
        <span class="flagwrap"></span>
        <span class="ship"><span class="shipname">&nbsp;</span><span class="shipclass">&nbsp;</span></span>
        <span class="sep"></span>
        <span class="gold">${ICONS.gold}<span class="gv">0</span></span>
        <span class="sep"></span>
        <span class="date">${formatDate(game.state?.date)}</span>
        <span class="sep"></span>
        <span class="supplies" title="Provisions (days) · morale"><span class="sv-food"></span><span class="sv-mor"></span></span>
      </div>
      <div class="helm await">
        <div class="bar tof-wood"><div class="tof-rim"></div>
          <div class="cell vitals tof-parch">${gauge('hull', 'Hull')}${gauge('sails', 'Sails')}${gauge('crew', 'Men')}</div>
          <div class="cell sail tof-parch">
            <div class="knots"><span class="kv">0.0</span><small>knots</small></div>
            <div class="pos-banner"><span>Beam reach</span><i class="pips"><b></b><b></b><b></b></i></div>
            <div class="sailrow"><span class="kk">${kc('KeyS', 'kc sm')}</span><span class="glyphs sailset">
              <span class="glyph" data-s="0" title="Sails furled">${ICONS.furled}</span>
              <span class="glyph" data-s="1" title="Fighting sail">${ICONS.battle}</span>
              <span class="glyph" data-s="2" title="Full sail">${ICONS.full}</span></span><span class="kk">${kc('KeyW', 'kc sm')}</span></div>
          </div>
          <div class="compass-wrap"></div>
          <div class="cell guns tof-parch">
            <div class="ammorow"><span class="glyphs ammo">
              <span class="glyph" data-a="round">${ICONS.round}<span class="k">1</span></span>
              <span class="glyph" data-a="chain">${ICONS.chain}<span class="k">2</span></span>
              <span class="glyph" data-a="grape">${ICONS.grape}<span class="k">3</span></span></span><span class="ammo-name">Round shot</span></div>
            <div class="row guns"><span class="rl rl-p" title="Port broadside">${kc('KeyQ', 'kc sm')}<span class="rbar"><i></i></span><span class="st">ready</span></span>
              <span class="rl rl-s" title="Starboard broadside"><span class="st">ready</span><span class="rbar"><i></i></span>${kc('KeyE', 'kc sm')}</span></div>
          </div>
          <div class="cell acts tof-parch">
            <span class="act a-rep off" title="Emergency repairs"><span class="kc sm">R</span><span class="al">Repair</span></span>
            <span class="act a-board off" title="Board a weakened enemy"><span class="kc sm">B</span><span class="al">Board</span></span>
            <span class="cam-pill" hidden><span class="kc sm">C</span><span class="al">Recentre</span></span>
          </div>
        </div>
        <div class="tacline" hidden></div>
      </div>
      ${wood('target off', `<div class="hdr"><span class="tflag"></span><div><div class="tname">&nbsp;</div><div class="ttype">&nbsp;</div></div><div class="stance">Hostile</div><div class="threat" hidden><b></b><span></span></div></div>
        <div class="gauge"><span class="lbl">Hull</span><span class="track"><span class="fill hull"></span><span class="ticks"></span></span><span class="val t-h"></span></div>
        <div class="gauge"><span class="lbl">Sails</span><span class="track"><span class="fill sails"></span><span class="ticks"></span></span><span class="val t-s"></span></div>
        <div class="gauge"><span class="lbl">Men</span><span class="track"><span class="fill crew"></span><span class="ticks"></span></span><span class="val t-c"></span></div>
        <div class="meta"><span class="t-d"></span><span class="t-b"></span></div>`)}
      <div class="prompt board off tof-parch"><span class="key">B</span><span><b>Board her!</b> <span class="bname"></span></span><span class="bdist"></span></div>
      <div class="prompt off tof-parch"><span class="key">F</span><span><span class="pto">Enter</span> <b class="pname">port</b></span><span class="dist"></span><span class="pmis"></span></div>
      <div class="hint"><span class="kc">M</span> map <span class="kc">J</span> journal <span class="kc">L</span> ledger <span class="kc">I</span> hold <span class="kc">Esc</span> options</div>`;
    root.appendChild(el);
    this.res = new ResourceBar(game, el);
    this.toasts = new Toasts(game, el);   // unified event messages + banner + journal (J)
    this.shoal = new ShoalAlert(game, el);  // shoal warning (depth under the keel)
    this.missions = new MissionBrief(game, el);   // discreet reminder of the missions under way (missionBrief.js)
    this.hints = new Hints(game, el);       // onboarding: hint card (bottom left) + goal line (top centre)
    const q = s => el.querySelector(s);
    this.$ = {
      flag: q('.ledger-strip .flagwrap'), name: q('.ledger-strip .shipname'), cls: q('.ledger-strip .shipclass'), gold: q('.ledger-strip .gv'), date: q('.ledger-strip .date'),
      ledger: q('.ledger-strip'), helm: q('.helm'),
      knots: q('.kv'), sailGlyphs: [...el.querySelectorAll('.sailset .glyph')], ammoGlyphs: [...el.querySelectorAll('.ammo .glyph')],
      ammoName: q('.ammo-name'), pos: q('.pos-banner'), posText: q('.pos-banner span'), posPips: [...q('.pos-banner .pips').children],
      rlP: q('.rl-p'), rlS: q('.rl-s'), rbP: q('.rl-p .rbar i'), rbS: q('.rl-s .rbar i'), tac: q('.tacline'), aRep: q('.a-rep'), aBoard: q('.a-board'), aCam: q('.cam-pill'), aCamL: q('.cam-pill .al'),
      target: q('.target'), tflag: q('.tflag'), tname: q('.tname'), ttype: q('.ttype'), stance: q('.stance'), threat: q('.target .threat'),
      tfills: [...el.querySelectorAll('.target .fill')], tvals: [q('.t-h'), q('.t-s'), q('.t-c')], tdist: q('.t-d'), tbear: q('.t-b'),
      prompt: q('.prompt:not(.board)'), bprompt: q('.prompt.board'), bname: q('.prompt.board .bname'), bdist: q('.prompt.board .bdist'), pname: q('.pname'), pto: q('.prompt .pto'), pdist: q('.prompt .dist'), pmis: q('.prompt .pmis'),
    };
    this.gauges = {};
    for (const k of ['hull', 'sails', 'crew']) {
      const g = q('.g-' + k);
      this.gauges[k] = { el: g, fill: g.querySelector('.fill'), ghost: g.querySelector('.ghost'), val: g.querySelector('.val'), last: -1 };
    }
    this.compass = new Compass(q('.compass-wrap'));
    this.minimap = new Minimap(el, game);
    this.menu = new Menu(game, this);

    // ---- events ----
    const ev = game.events;
    ev.on('notify', d => this.notify(d?.text ?? String(d), d?.kind || 'info', { major: d?.major, key: d?.key, topic: d?.topic, tone: d?.tone, defer: d?.defer, logOnly: d?.logOnly }));
    ev.on('cannon:hit', d => this._onHit(d));
    // sinkings: only ours and those of ships we fight or escort (third parties: no message); surrenders are
    // reported once, by combat.strike; entering a port opens the port screen (no “Anchor dropped” echo)
    ev.on('ship:sunk', ({ ship } = {}) => {
      if (!ship) return;
      if (ship === game.player) this.notify('Our ship is going down!', 'bad');
      else if (concernsPlayer(game, ship)) this.notify(`${theShip(ship, true)} sinks and disappears beneath the waves.`, ship.faction === game.player?.faction ? 'bad' : 'good');
    });

    addEventListener('keydown', e => this._key(e));

    // initial menu
    const m = game.params.get('menu');
    if (m === 'captain') this.showMenu('captain');
    else if (m && m !== '0') this.showMenu(m === '1' ? 'title' : m);
    else if (!game.params.get('shot')) this.showMenu('title');
  }

  // ---------------- public API ----------------
  show(v = true) { this.visible = !!v; this.el.classList.toggle('hidden', !this.visible); }
  showMenu(screen = 'title') { this.menu.open(screen); }

  notify(text, kind = 'info', opts = {}) {
    if (!text) return null;
    return this.toasts.push(text, kind, { bell: shipsBells(this.game.sky?.timeOfDay), ...opts });
  }

  // ---------------- internals ----------------

  _onHit(d) {
    const p = this.game.player; if (!d || !p) return;
    let key, kind;
    if (d.target === p) { key = 'in:' + (d.attacker?.name || ''); kind = 'bad'; }
    else if (d.attacker === p) { key = 'out:' + (d.target?.name || d.target?.type); kind = 'good'; }
    else return;
    // aggregate the many balls of one broadside into one log entry
    let a = this._hitAgg.get(key);
    if (!a) {
      a = { n: 0, dmg: 0, parts: {}, d, kind };
      this._hitAgg.set(key, a);
      setTimeout(() => {
        this._hitAgg.delete(key);
        const part = Object.entries(a.parts).sort((x, y) => y[1] - x[1])[0]?.[0] || 'hull';
        const W = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
        const balls = a.n > 1 ? `${W[a.n] || a.n} shots` : 'One shot';
        // our hits: journal only (the target card shows the damage); hits taken: one coalesced toast
        if (a.kind === 'bad') this.notify(`${balls} ${ofShip(a.d.attacker)} hit${a.n > 1 ? '' : 's'} ${PART_ART[part]}!`, 'bad', { key: 'hit-in' });
        else this.notify(`${balls} hit${a.n > 1 ? '' : 's'} ${a.d.target ? `the ${PART_NAMES[part]} ${ofShip(a.d.target)}` : 'their target'}.`, 'good', { logOnly: true });
      }, 650);
    }
    a.n++; a.dmg += d.damage || 0; a.parts[d.part || 'hull'] = (a.parts[d.part || 'hull'] || 0) + 1;
    if (d.target === p) this.el.animate?.([{ transform: 'translate(0,0)' }, { transform: 'translate(3px,-2px)' }, { transform: 'translate(-2px,2px)' }, { transform: 'translate(0,0)' }], { duration: 260 });
  }

  _key(e) {
    if (e.target?.tagName === 'INPUT') { if (e.code === 'Escape') e.target.blur(); return; }
    if (e.code === 'Escape') {
      if (this.menu.isOpen) this.menu.back(); else if (this.game.mode !== 'menu') this.menu.open('pause');
      e.preventDefault();
    } else if (isKey(e, 'm') && !this.menu.isOpen && !this.game.mapKeyHandled) {
      this.minimap.toggleExpanded(); this.el.classList.toggle('chart-big', this.minimap.expanded); this.game.audio?.play?.('ui:page');
    } else if (isKey(e, 'f') && !this.menu.isOpen && !this.game.portKeyHandled) {
      const np = this._nearPort;
      if (np && this.game.mode === 'sail') {
        this.game.events.emit('port:enter', { port: np.port });
        this.game.events.emit('state:change', { from: 'sail', to: 'port' });
        this.game.mode = 'port';
      }
    }
  }

  _set(key, el, value, prop = 'textContent') {
    if (this._cache[key] === value) return;
    this._cache[key] = value; el[prop] = value;
  }

  // Hostility: combat's factions.js is the source of truth; fallback only if combat isn't loaded.
  _hostile(s, p) {
    if (!s || s === p || s.alive === false) return false;
    const c = this.game.combat;
    if (typeof c?.isHostile === 'function') { try { return !!c.isHostile(p, s); } catch { /* fall through */ } }
    if (s.hostile === true || s.faction === 'pirate') return true;
    if (this.game.state?.atWar?.[s.faction]) return true;
    return false;
  }
  // 'hostile' | 'friendly' | 'neutral'
  _stance(s, p) {
    if (this._hostile(s, p)) return 'hostile';
    const rel = relation(p.faction, s.faction);
    if (s.faction === p.faction || rel > 0) return 'friendly';
    return 'neutral';
  }

  update(dt) {
    this.menu.update?.(dt);
    this.hints?.update();   // onboarding: runs even with the HUD hidden (goals tracked in port); the card is suspended there
    if (!this.visible) return;
    const g = this.game, p = g.player, st = g.state || {};
    this._t += dt; this._slowT -= dt; this._mmT -= dt;
    // DOM refresh follows real time, even when the simulation is frozen: the time since the last call, so that a
    // 144 Hz screen does not redraw the chart or expire the messages 2.4 times as fast as a 60 Hz one (it was one
    // 60th of a second per call). Under the automated tools, which step by hand, still one 60th per call.
    const nowR = performance.now(), real = navigator.webdriver ? 1 / 60 : Math.min(0.1, (nowR - (this._realT ?? nowR - 1000 / 60)) / 1000);
    this._realT = nowR;
    this._mmT -= real; this._slowT -= real;
    this.res?.update(real); this.shoal?.update(real); this.toasts?.update(real); this.missions?.update(real);

    // ---------- ledger ----------
    if (this._slowT <= 0 || this._cache.ready !== !!p) {
      this._slowT = 0.25;
      if (p) {
        this._set('name', this.$.name, p.name || 'Unnamed');
        this._set('cls', this.$.cls, `${shipType(p.type) || 'Ship'}, ${p.guns ?? 0} guns · Capt. ${st.name || 'Thorne'}`);
        if (this._cache.flagF !== p.faction) { this._cache.flagF = p.faction; this.$.flag.innerHTML = flagSVG(p.faction); }
      }
      if (this._cache.ready !== !!p) {
        this._cache.ready = !!p;
        this.$.ledger.classList.toggle('await', !p); this.$.helm.classList.toggle('await', !p); this.res?.setAwait(!p);
        this.minimap.el.classList.toggle('await', !p); this.el.querySelector('.hint').classList.toggle('await', !p);
      }
      this._set('gold', this.$.gold, fmtInt(st.gold ?? 0));
      this._set('date', this.$.date, formatDate(st.date));
      // food (days left) and morale
      { const sf = this._svF ||= this.el.querySelector('.sv-food'), sm = this._svM ||= this.el.querySelector('.sv-mor');
        const need = Math.max(1, Math.ceil((p?.crew ?? st.crew ?? 0) / 25)), days = Math.floor((st.food ?? 0) / need), mo = Math.round(st.morale ?? 70);
        this._set('svF', sf, `Provisions: ${days} ${days === 1 ? 'day' : 'days'}`); this._set('svM', sm, `Morale ${mo}`);
        sf.classList.toggle('low', days < 4); sm.classList.toggle('low', mo < 30); }
    }
    if (!p) { this.target = null; this._set('tOff', this.$.target, 'target tof-wood off', 'className'); return; }   // no stale target card without a player ship

    // ---------- gauges ----------
    const hullF = clamp01((p.hull ?? 0) / (p.hullMax || 1)), sailF = clamp01(p.sails ?? 1), crewF = clamp01((p.crew ?? 0) / (p.crewMax || 1));
    this._gauge('hull', hullF, `${Math.round(hullF * 100)}%`);
    this._gauge('sails', sailF, `${Math.round(sailF * 100)}%`);
    this._gauge('crew', crewF, `${Math.round(p.crew ?? 0)}`);

    // ---------- helm ----------
    const kn = p.knots ?? (p.speed || 0) * 1.94384;
    this._set('kn', this.$.knots, fmtNum(Math.max(0, kn), 1));
    const step = p.controller?.sailStep ?? (p.sailSetting >= 0.75 ? 2 : p.sailSetting >= 0.25 ? 1 : 0);
    if (this._cache.step !== step) { this._cache.step = step; this.$.sailGlyphs.forEach((gl, i) => gl.classList.toggle('on', i === step)); }
    const ammo = p.ammo || 'round';
    if (this._cache.ammo !== ammo) {
      this._cache.ammo = ammo; this.$.ammoGlyphs.forEach(gl => gl.classList.toggle('on', gl.dataset.a === ammo));
      this.$.ammoName.textContent = AMMO_NAMES[ammo] || ammo;
    }
    const pos = p.pointOfSail || '';
    if (this._cache.pos !== pos) {
      this._cache.pos = pos;
      this.$.posText.textContent = pos ? (s => s[0].toUpperCase() + s.slice(1))(pointOfSail(pos)) : compassPoint(p.heading);
      this.$.pos.classList.toggle('irons', pos === 'in irons');
    }
    // point-of-sail quality cue: name tints muted -> gold, 0..3 brass pips (rig-dependent polar, ship.sailQuality)
    const sq = clamp01(p.sailQuality ?? 0.7), sqQ = Math.round(sq * 20) / 20;
    if (this._cache.sq !== sqQ) {
      this._cache.sq = sqQ;
      this.$.pos.style.setProperty('--q', sqQ.toFixed(2));
      const n = sq >= 0.93 ? 3 : sq >= 0.75 ? 2 : sq >= 0.5 ? 1 : 0;
      this.$.posPips.forEach((b, i) => b.classList.toggle('on', i < n));
    }
    const rp = clamp01(p.reload?.port ?? 1), rs = clamp01(p.reload?.starboard ?? 1);
    this.compass.set({ heading: p.heading || 0, windAngle: g.wind?.angle ?? 0, windSpeed: g.wind?.speed ?? 0, reloadPort: rp, reloadStar: rs, guns: p.guns });
    const auto = isAssist(g.state) && !p.controller?.holdFire;   // “Assisted” mode: autonomous gun crews
    this._reloadLabel('rp', this.$.rlP, this.$.rbP, rp, auto);
    this._reloadLabel('rs', this.$.rlS, this.$.rbS, rs, auto);
    // combat lot 1 + UI navigation: one status line above the bar (weather gauge, repairs, rate of fire, dismasting)
    {
      const parts = [], wg = p.windGauge || 0, ml = p.mastLoss || 0, rof = p.fireRate ?? 1;
      if (wg > 0) parts.push(['up', 'Windward']);
      else if (wg < 0) parts.push(['dn', 'Leeward']);
      if (p.repairing) parts.push(['rep', p.repairWait ? 'Heaving to' : 'Repairs under way']);
      if (isAssist(g.state) && p.controller?.holdFire) parts.push(['dn', 'Cease fire (G)']);
      if (rof < 0.995) parts.push(['dn', `Rate of fire ${Math.round(rof * 100)}%`]);
      if (ml > 0) parts.push(['dn', ml >= 1 ? 'Dismasted' : ml >= 0.6 ? 'Topmasts gone' : 'Mast down']);
      const key = parts.map(x => x.join(':')).join('|');
      if (this._cache.tac !== key && this.$.tac) {
        this._cache.tac = key; this.$.tac.hidden = !parts.length;
        this.$.tac.innerHTML = parts.map(([c, t]) => `<span class="${c}">${t}</span>`).join('<i>·</i>');
      }
      // gaining / losing the weather gauge: one message, from combat._gaugeNote (hysteresis, fighting foe only)
    }
    // action chips: R repairs (active / waiting for the ship to stop / available / nothing to repair), B boarding (ready / approach / none)
    {
      const cap = (g.fortune?.fx?.repairCap ?? 0.75), damaged = (p.hull ?? 0) < (p.hullMax || 1) * cap - 0.5 || (p.sails ?? 1) < 0.8 - 0.002 || !!p.fires?.length;
      const rep = p.repairing ? (p.repairWait ? 'wait' : 'on') : damaged ? 'ready' : 'off';
      this._set('aRep', this.$.aRep, 'act a-rep ' + rep, 'className');
      this._set('aRepT', this.$.aRep, rep === 'wait' ? 'The ship must be stopped (under one knot): sails clewed up, she is losing way' : rep === 'on' ? 'Emergency repairs under way (R to suspend them; making sail or a broadside interrupts them)' : damaged ? 'Emergency repairs (R): heave to, work while stopped, reduced rate of fire' : 'Nothing to repair at sea', 'title');
      const bh0 = g.combat?.boardHint;
      this._set('aBo', this.$.aBoard, 'act a-board ' + (bh0 ? (bh0.inReach ? 'on' : 'ready') : 'off'), 'className');
      // C cycles the views (the camera never changes by itself); the pill shows outside the chase view only
      const rig = g.cameraRig, cm = rig?.mode, eng = !!rig?.engaged;
      const cam = !rig || rig.fixed || rig.path ? '' : cm === 'tactical' ? 'Behind the ship' : cm === 'broadside' ? 'Overview' : '';
      this._set('aCamH', this.$.aCam, !cam, 'hidden');
      this._set('aCamC', this.$.aCam, 'cam-pill' + (cm === 'tactical' && eng ? ' fight' : ''), 'className');
      if (cam) this._set('aCamL', this.$.aCamL, cam);
      this._set('aCamT', this.$.aCam, cam === 'Behind the ship' ? 'C: back to the view behind your ship' : 'C: change view', 'title');
    }
    const lock = g.state?.ammoUnlocked;
    const lockKey = lock ? `${lock.chain ? 1 : 0}${lock.grape ? 1 : 0}` : '11';
    if (this._cache.lock !== lockKey) {
      this._cache.lock = lockKey;
      this.$.ammoGlyphs.forEach(gl => { const k = gl.dataset.a, l = k !== 'round' && lock && !lock[k]; gl.classList.toggle('locked', !!l); gl.title = l ? `${AMMO_NAMES[k]} · buy it at the shipyard` : AMMO_NAMES[k]; });
    }

    // ---------- minimap ----------
    if (this._mmT <= 0 || !this._mmDrawn) { this._mmT = 0.1; this._mmDrawn = true; this.minimap.draw(); }

    // ---------- port prompt ----------
    let np = g.islands?.nearestPort?.(p.position.x, p.position.z);
    const nv = g.islands?.nearestVillage?.(p.position.x, p.position.z);   // fishing villages: same prompt (F)
    if (nv?.village && nv.dist < (np?.dist ?? Infinity)) np = { port: nv.village, dist: nv.dist };
    const near = np?.port && np.dist < 400 && g.mode === 'sail' && !this.menu.isOpen;
    this._nearPort = near ? np : null;
    this._set('pOff', this.$.prompt, near ? 'prompt tof-parch' : 'prompt tof-parch off', 'className');
    if (near) {
      // “Enter Havana”, “Land at The Mangroves”: a verb of its own for villages
      const nm = np.port.name || '', vil = !!np.port.village;
      this._set('pto', this.$.pto, vil ? 'Land at' : 'Enter');
      this._set('pname', this.$.pname, nm); this._set('pdist', this.$.pdist, `${fmtInt(np.dist)} m`);
      const mis = np.port.village ? 'fishing village' : g.career?.missionAtPort?.(np.port);   // what entering the port achieves for a mission
      this._set('pmis', this.$.pmis, mis ? `· ${mis}` : '');
      this.$.prompt.style.setProperty('--near', (0.85 + 0.15 * clamp01(1 - (np.dist - 150) / 250)).toFixed(2));   // text never below 0.85
    }

    // ---------- boarding prompt ----------
    let bh = g.mode === 'sail' && !this.menu.isOpen ? g.combat?.boardHint : null;
    if (bh && (!bh.ship || bh.ship.alive === false || bh.ship.sinking || bh.ship.sunk)) bh = null;   // stale hint (paused frame)
    this._set('bOff', this.$.bprompt, bh ? (bh.inReach ? 'prompt board ready tof-parch' : 'prompt board tof-parch') : 'prompt board tof-parch off', 'className');
    if (bh) {
      this._set('bname', this.$.bname, bh.ship.name);
      this._set('bdist', this.$.bdist, bh.inReach ? 'ready' : `close in to board · ${fmtInt(bh.dist)} m`);
    }

    // ---------- target card ----------
    // nearest hostile within 900 m; otherwise the nearest ship of any stance within 600 m
    let best = null, bd = 900, any = null, ad = 600;
    for (const s of g.ships || []) {
      if (s === p || s.alive === false) continue;
      const d = Math.hypot(s.position.x - p.position.x, s.position.z - p.position.z);
      if (d < ad) { ad = d; any = s; }
      if (d < bd && !s.struck && this._hostile(s, p)) { bd = d; best = s; }
    }
    if (!best && any) { best = any; bd = ad; }
    this.target = best;
    // the card is folded to its header (flag, name, stance) unless a hostile is within gun range or damaged;
    // it no longer hides the ships it describes in the sailing view
    const tFull = best && !(g.nameplates?.enabled && g.nameplates._active?.()) && !best.struck && this._hostile(best, p) && (bd < 520 || (best.hull / (best.hullMax || 1)) < 0.98);
    this._set('tOff', this.$.target, best ? (tFull ? 'target tof-wood' : 'target tof-wood compact') : 'target tof-wood off', 'className');
    if (best) {
      const stance = best.struck ? 'struck' : this._stance(best, p);
      if (this._cache.tShip !== best) {
        this._cache.tShip = best;
        this.$.tflag.innerHTML = flagSVG(best.faction, { w: 42, h: 28 });
        this.$.tname.textContent = best.name && best.name !== 'Unnamed' ? best.name : 'Unknown ship';
        this.$.ttype.textContent = `${shipDesc(best.faction, best.type, true)} · ${best.guns ?? '?'} guns`;
        this.$.target.querySelector('.inner').style.boxShadow = `inset 0.3em 0 0 ${factionColor(best.faction)}, inset 0 0 1.4em rgba(110,66,18,0.55)`;
      }
      const f = [clamp01(best.hull / (best.hullMax || 1)), clamp01(best.sails ?? 1), clamp01((best.crew ?? 0) / (best.crewMax || 1))];
      f.forEach((v, i) => { this.$.tfills[i].style.width = `calc(${(v * 100).toFixed(1)}% - 0.2em)`; });
      this._set('th', this.$.tvals[0], Math.round(f[0] * 100) + '%');
      this._set('ts', this.$.tvals[1], Math.round(f[1] * 100) + '%');
      this._set('tc', this.$.tvals[2], String(Math.round(best.crew ?? 0)));
      const stLbl = stance === 'struck' ? 'Colours struck' : stance === 'hostile'
        ? (f[0] < 0.25 ? 'Hostile · sinking' : f[2] < 0.25 ? 'Hostile · shaken' : best.faction === 'pirate' ? 'Pirate · hostile' : 'Hostile')
        : stance === 'friendly' ? 'Friendly' : 'Neutral';
      this._set('tst', this.$.stance, stLbl);
      // sea tiers: class and threat (current enemy strength / ours), except for a ship that has struck
      const th = !best.struck ? threatOf(best, p) : null, thEl = this.$.threat;
      this._set('thh', thEl, !th, 'hidden');
      if (th) {
        this._set('thc', thEl, `threat ${th.key}`, 'className');
        this._set('thr', thEl.firstChild, th.roman);
        this._set('thl', thEl.lastChild, th.label);
        this._set('tht', thEl, `Class ${th.roman} · strength ×${fmtNum(th.ratio, 1)} yours`, 'title');
      }
      this._set('tstc', this.$.stance, 'stance ' + stance, 'className');
      this._set('td', this.$.tdist, `${fmtInt(bd)} m away`);
      const brg = Math.atan2(best.position.x - p.position.x, -(best.position.z - p.position.z));
      let rel = ((brg - p.heading) * 180 / Math.PI) % 360; if (rel > 180) rel -= 360; if (rel < -180) rel += 360;
      const side = Math.abs(rel) < 20 ? 'dead ahead' : Math.abs(rel) > 160 ? 'astern' : rel > 0 ? 'to starboard' : 'to port';
      this._set('tb', this.$.tbear, side);
    }
  }

  _gauge(k, f, txt) {
    const g = this.gauges[k];
    if (Math.abs(g.last - f) < 0.002 && g.txt === txt) return;
    if (g.last >= 0 && f < g.last - 0.002) { /* damage: ghost lags behind */ } else g.ghost.style.width = `calc(${(f * 100).toFixed(1)}% - 0.2em)`;
    if (g.last < 0) g.ghost.style.width = `calc(${(f * 100).toFixed(1)}% - 0.2em)`;
    else if (f < g.last) requestAnimationFrame(() => { g.ghost.style.width = `calc(${(f * 100).toFixed(1)}% - 0.2em)`; });
    g.fill.style.width = `calc(${(f * 100).toFixed(1)}% - 0.2em)`;
    g.val.textContent = txt; g.el.classList.toggle('low', f < 0.25);
    g.last = f; g.txt = txt;
  }

  _reloadLabel(k, el, bar, v, auto = false) {
    const ready = v >= 1;
    const txt = ready ? (auto ? 'Auto' : 'Ready') : `${Math.round(v * 100)}%`;   // Auto: the broadside will fire by itself (assisted mode)
    bar.style.width = (v * 100).toFixed(1) + '%';
    if (this._cache[k] === txt) return;
    this._cache[k] = txt;
    el.classList.toggle('ready', ready);
    el.querySelector('.st').textContent = txt;
  }
}
