// Governor missions under way, in brief.
//   missionBriefs(game) -> [{ id, kind, title, short, full, left, when, whenShort, ready, urgent }]
//     short = short objective (HUD), full = career.missionObjective(m) (Registry, tooltip), left = days left.
//   new MissionBrief(game, hudEl) · update()  discreet reminder in the HUD, at sea: bottom right, above the key
//     line (away from the goal line at top centre, the hint cards at bottom left, the messages on the left and the
//     target sheet at top right). Three missions at most, the most urgent first; in combat (target sheet
//     visible) only titles and deadlines remain. Styles at the end of hud.css (.mission-brief).
import { qtyLabel, dayLabel } from '../data/missions.js';
import { GOODS } from '../data/world.js';
import { a, nationAdj, NBSP } from '../core/i18n.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const today = d => (d ? d.year * 372 + d.month * 31 + d.day : 0);

// short objective; “(F)” becomes a key: a mission that ends in a port says what to do there, and that it is
// entered with F (the HUD's F prompt repeats the verb: “Enter … · hand over the dispatches”)
const SHORT = {
  deliver: m => `Hand the dispatches to ${m.toName} (F)`,
  escort: m => `Bring the merchantman to ${m.toName} (F)`,
  envoy: m => `Hand the letter to ${m.toName} (F)`,
  hunt: m => (m.ready ? `Report in ${a(nationAdj(m.nation))} port (F)` : `Taken or sunk: ${m.progress || 0}/${m.count}`),
  transport: m => `Deliver ${qtyLabel(m.qty, m.good, GOODS)} to ${m.toName} (F)`,
  quarry: m => (m.ready ? `Collect the bounty in ${a(nationAdj(m.nation))} port (F)` : `${m.captain}, near ${m.place}`),
  scout: m => (m.ready ? `Report to ${m.fromName} (F)` : `Approach ${m.toName}, then return`),
  rescue: m => (m.ready ? `Bring the castaways to ${m.fromName} (F)` : `Castaways near ${m.place}`),
};

export function missionBriefs(game) {
  const st = game?.state, c = game?.career;
  if (!st?.missions) return [];
  const t0 = today(st.date);
  return st.missions.filter(m => m.status === 'active').map(m => {
    const left = m.deadline ? m.deadline - t0 : null;
    const urgent = left != null && left <= 1 && !m.ready;
    const when = m.ready ? 'to report' : left == null ? '' : left <= 0 ? 'last day' : left === 1 ? '1 day left' : `${left}${NBSP}days left`;
    const whenShort = m.ready ? 'to report' : left == null ? '' : left <= 0 ? 'last day' : left === 1 ? '1 day' : `${left}${NBSP}days`;
    return {
      id: m.id, kind: m.kind, title: m.title, ready: !!m.ready, left, urgent, when, whenShort,
      date: m.deadline ? dayLabel(m.deadline) : '',
      short: (SHORT[m.kind] || (() => ''))(m), full: c?.missionObjective?.(m) || '',
    };
  }).sort((a, b) => (b.urgent - a.urgent) || (a.ready - b.ready) || ((a.left ?? 99) - (b.left ?? 99)));
}

export class MissionBrief {
  constructor(game, hudEl) {
    this.game = game; this._t = 0; this._sig = '';
    const el = this.el = document.createElement('div');
    el.className = 'mission-brief off';
    hudEl.appendChild(el);
  }
  update(real = 1 / 60) {
    this._t -= real; if (this._t > 0) return; this._t = 0.5;
    const g = this.game, hud = g.hud;
    const on = g.mode === 'sail' && !!g.player && !g.params?.get?.('nohud');
    const list = on ? missionBriefs(g) : [];
    const fight = !!hud?.el?.querySelector?.('.target:not(.off) .stance.hostile');   // combat: titles and deadlines only
    const big = !!hud?.el?.classList?.contains('chart-big');
    const show = list.length > 0 && !big;
    const sig = show ? `${fight}|${list.map(b => `${b.id}:${b.short}:${b.whenShort}`).join('|')}` : '';
    if (sig !== this._sig) {
      this._sig = sig;
      if (show) {
        const rows = list.slice(0, 3).map(b => `<div class="mb-row${b.urgent ? ' urgent' : ''}${b.ready ? ' ready' : ''}" title="${esc(b.full)}">
          <div class="mb-t"><b>${esc(b.title)}</b>${b.whenShort ? `<span class="mb-w">${b.whenShort}</span>` : ''}</div>
          ${fight ? '' : `<div class="mb-o"><span class="mb-ot">${esc(b.short).replace(' (F)', '')}</span>${b.short.includes(' (F)') ? '<span class="kc">F</span>' : ''}</div>`}</div>`).join('');
        const more = list.length > 3 ? `<div class="mb-more">+${list.length - 3} more in the ledger</div>` : '';
        this.el.innerHTML = `<div class="mb-h">Missions <span class="kc">L</span></div>${rows}${more}`;
      }
      this.el.classList.toggle('off', !show);
      this.el.classList.toggle('fight', fight);
    }
  }
}
