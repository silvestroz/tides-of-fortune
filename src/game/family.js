// Married life (state.spouse): game.family, created by Career.
//   - Visit: in the wife's port, the “Your home” card of the Governor tab (portScreen._governor →
//     family.card(port), data-act="home-*" buttons → family.act()). One evening per call: crew morale
//     +FAMILY.visitMorale (shore leave); if the captain is wounded and his last care is more than
//     FAMILY.careEvery days old, she sends for her father's physician: one wound less.
//   - Gift: once per call, FAMILY.giftCost coins → bond +FAMILY.giftBond, reputation +1 with her nation.
//   - Letters: at sea, every FAMILY.letterEvery days (± 2), a letter in the log (toast, sealed-letter icon) with
//     true news (town, her nation's wars, absence); one in three carries a parcel: produce of the granted lands
//     (if any) or treats for the crew (morale +FAMILY.parcelMorale).
//   - Bond (spouse.bond 0–100, starts at 60): −FAMILY.bondDecay per day, +visit, +gift; it only colours the tone
//     of the letters and the visit bonus. No effect on the score (the wife is always worth SCORE.spouse).
// State: optional fields of state.spouse (bond, lastVisit, lastCare, nextLetter, letters, gifts), recreated by ensure().
import { NBSP, fmtInt, nationPeople } from '../core/i18n.js';
import { relation, changeReputation } from '../combat/factions.js';

export const FAMILY = {
  visitMorale: 8, visitBond: 15, careEvery: 30, giftCost: 250, giftBond: 12, bondDecay: 1, bondStart: 60,
  letterEvery: 6, parcelChance: 0.34, parcelMorale: 4, landsYield: 0.3, landsMin: 60, landsMax: 600,
};
const NATIONS = ['english', 'spanish', 'french', 'dutch'];
const dayNum = d => d.year * 372 + d.month * 31 + d.day;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pick = (a, r = Math.random) => a[Math.floor(r() * a.length)];

// ---- original letter texts (the tone follows the bond) ----
const AWAY = {
  warm: d => [`It is ${d} days since your sail left the roads, and I still count the evening bells.`, `Every ship that enters port sends me running to the balcony. ${d} days already.`],
  cool: d => [`${d} days without a word from you. My father asks whether I am a widow or a wife.`, `They ask after you at the palace; I answer that the sea keeps you. ${d} days, captain.`],
};
// keys: town notes (living.townNote)
const TOWN = {
  epidemic: p => `Fever has come into ${p}; I go out only to the garden and I boil the water, as you insisted.`,
  plundered: p => `Freebooters have sacked ${p}. The palace held, but half the market is nothing but ashes.`,
  booming: p => `${p} is never empty: they build three houses a week on the hill, and the harbour is short of quays.`,
  conquered: p => `${p} has changed masters and flags. One gets used to it, says my father, through gritted teeth.`,
};
const QUIET = [
  p => `In ${p}, the rainy season has filled the cisterns. The orange trees in the patio are bearing at last.`,
  p => `The travelling painter has finished my portrait; it awaits you above the fireplace, looking far wiser than I am.`,
  p => `I have learnt to read flags from the terrace. I already recognise yours from very far away.`,
  p => `My father receives too many captains and too few good ones. He says you are the exception; do not disappoint him.`,
  p => `The market of ${p} is overflowing with mangoes. I am keeping a basket in the cool for your return.`,
];
const WAR = (n, o) => `There is talk of the war against the ${nationPeople(o)} at every dinner. My father has doubled the guard at the fort: beware of their frigates.`;
const CLOSE = { warm: ['Come back to me in one piece.', 'I pray for your sails.', 'I kiss you.'], cool: ['Come back, or write.', 'Your wife, in spite of everything.'] };

export class Family {
  constructor(game) {
    this.game = game;
    this._visit = new Set();   // actions already done during this call ('visit', 'gift')
    const ev = game.events;
    ev.on('port:leave', () => this._visit.clear());
    ev.on('career:day', () => this._onDay());
    ev.on('game:loaded', () => { this._visit.clear(); this.ensure(); });
  }

  get today() { return dayNum(this.game.state.date); }
  spouse() { return this.game.state.spouse || null; }
  ensure() {
    const sp = this.spouse(); if (!sp) return null;
    const now = this.today;
    sp.bond ??= FAMILY.bondStart; sp.lastVisit ??= now; sp.lastCare ??= -9999; sp.letters ??= 0; sp.gifts ??= 0;
    sp.nextLetter ??= now + FAMILY.letterEvery; sp.bondDay ??= now;
    return sp;
  }
  _port(sp) { return this.game.islands?.ports?.find(p => p.id === sp.port) || null; }
  _tone(sp) { return sp.bond >= 35 ? 'warm' : 'cool'; }

  // ------------------------------------------------------------------ lettres
  _onDay() {
    const g = this.game, sp = this.ensure(); if (!sp) return;
    const days = Math.min(10, Math.max(0, this.today - (sp.bondDay ?? this.today))); sp.bondDay = this.today;   // long jumps: 10 at most
    sp.bond = Math.max(0, sp.bond - days * FAMILY.bondDecay);
    if (this.today < sp.nextLetter) return;
    if (g.mode !== 'sail' || !g.player) return;   // letters wait until we put to sea again (relayed by ships)
    this.letter();
  }
  // composes a letter (true content: town, her nation's wars, absence); parcel: true/false to force the parcel
  letter({ parcel = null, rnd = Math.random } = {}) {
    const g = this.game, s = g.state, sp = this.ensure(); if (!sp) return null;
    const tone = this._tone(sp), port = this._port(sp), pn = port?.name || sp.portName;
    const away = Math.max(0, this.today - (sp.lastVisit ?? this.today));
    const lines = [];
    if (away >= 3) lines.push(pick(AWAY[tone](away), rnd));
    const note = port && g.living?.townNote?.(port);
    const nat = port?.faction || sp.faction;
    const wars = NATIONS.filter(o => o !== nat && relation(nat, o) < 0);
    if (note && TOWN[note]) lines.push(TOWN[note](pn));
    else if (wars.length && rnd() < 0.6) lines.push(WAR(nat, pick(wars, rnd)));
    else lines.push(pick(QUIET, rnd)(pn));
    let gift = null;
    if (parcel ?? rnd() < FAMILY.parcelChance) {
      const acres = g.career?.acres?.() || 0;
      if (acres > 0) {
        const gold = Math.max(FAMILY.landsMin, Math.min(FAMILY.landsMax, Math.round(acres * FAMILY.landsYield)));
        s.gold += gold; gift = { gold };
        lines.push(`The steward of your lands has sold the harvest: I enclose ${fmtInt(gold)}${NBSP}gold with this letter.`);
      } else {
        s.morale = Math.min(100, (s.morale ?? 60) + FAMILY.parcelMorale); gift = { morale: FAMILY.parcelMorale };
        lines.push('The parcel holds guava jam and tobacco from my father’s plantation. Share them with your men.');
      }
    }
    lines.push(pick(CLOSE[tone], rnd));
    sp.letters++; sp.nextLetter = this.today + FAMILY.letterEvery - 2 + Math.floor(rnd() * 5);
    const text = `${tone === 'warm' ? `A letter from ${pn}, in the hand of ${sp.name}` : `A few curt lines from ${sp.name}, from ${pn}`}: “${lines.join(' ')}”`;
    g.events.emit('family:letter', { spouse: sp, text, gift });
    g.events.emit('notify', { text, kind: gift ? 'good' : 'info', topic: 'diplomacy', key: 'family-letter' });
    return { text, gift };
  }

  // ------------------------------------------------------------------ visits (Governor tab of the wife's port)
  card(port) {
    const sp = this.ensure(); if (!sp || sp.port !== port.id) return '';
    const g = this.game, s = g.state, away = Math.max(0, this.today - (sp.lastVisit ?? this.today));
    const visited = this._visit.has('visit'), gave = this._visit.has('gift');
    const care = (s.wounds || 0) > 0 && this.today - (sp.lastCare ?? -9999) >= FAMILY.careEvery;
    const mood = sp.bond >= 70 ? 'She is waiting for you on the steps.' : sp.bond >= 35 ? 'She greets you with a slightly weary smile.' : 'She receives you coldly in the drawing room.';
    return `<div class="card home-card"><h3>❦ Your home in ${port.name}</h3>
      <p class="ink">${esc(sp.name)}, your wife. ${visited ? 'You spent the evening together.' : mood}${away > 1 && !visited ? ` Last visit ${away}${NBSP}days ago.` : ''} ${sp.letters ? `${sp.letters} letter${sp.letters > 1 ? 's' : ''} received at sea.` : ''}</p>
      <div class="home-bond" title="Bond ${sp.bond} / 100"><i style="width:${sp.bond}%"></i></div>
      <div class="btnrow">
        <button class="btn sm" data-act="home-visit" ${visited ? 'disabled' : ''}>${visited ? 'Evening spent' : `Spend the evening at home · morale +${FAMILY.visitMorale}${care ? ', care' : ''}`}</button>
        <button class="btn sm" data-act="home-gift" ${gave || s.gold < FAMILY.giftCost ? 'disabled' : ''}>${gave ? 'Gift given' : `Give a gift · ${FAMILY.giftCost}`}</button>
      </div></div>`;
  }
  act(port, act) {
    const g = this.game, s = g.state, sp = this.ensure();
    if (!sp || sp.port !== port.id) return false;
    if (act === 'home-visit' && !this._visit.has('visit')) {
      this._visit.add('visit');
      const away = Math.max(0, this.today - (sp.lastVisit ?? this.today));
      sp.lastVisit = this.today; sp.bond = Math.min(100, sp.bond + FAMILY.visitBond);
      s.morale = Math.min(100, (s.morale ?? 60) + FAMILY.visitMorale);
      const care = (s.wounds || 0) > 0 && this.today - (sp.lastCare ?? -9999) >= FAMILY.careEvery;
      if (care) { s.wounds -= 1; sp.lastCare = this.today; }
      g.events.emit('family:visit', { spouse: sp, care });
      g.events.emit('notify', { text: `${away > 6 ? `${sp.name} holds you in her arms for a long time.` : `A quiet evening with ${sp.name}.`} The crew has shore leave in town (morale +${FAMILY.visitMorale})${care ? '; the governor’s physician tends an old wound' : ''}.`, kind: 'good' });
      return true;
    }
    if (act === 'home-gift' && !this._visit.has('gift') && s.gold >= FAMILY.giftCost) {
      this._visit.add('gift');
      s.gold -= FAMILY.giftCost; sp.gifts++; sp.bond = Math.min(100, sp.bond + FAMILY.giftBond);
      changeReputation(g, port.faction, 1, 'family');
      g.events.emit('notify', { text: pick([`${sp.name} unwraps a length of Indian silk and drapes it over her shoulders at once.`, `A necklace of Margarita pearls: ${sp.name} shows it to the whole palace.`, `A music box from Europe: ${sp.name} plays it three times in a row.`]), kind: 'good' });
      return true;
    }
    return false;
  }
}
