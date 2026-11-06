// game.seaZones: sea tiers (I guarded waters, II trade routes, III perilous seas) drawn from src/data/seaZones.js.
//   seaZones.at(x, z)          → { tier, name, port?, shape }
//   seaZones.tierAt(x, z)      → 1 | 2 | 3
//   seaZones.forbids(ship, x, z, target?)  zone closed to this ship (too heavy for the tier, a Top 10 captain in
//                              tier I, a pirate stronger than 1.15 × the targeted player in tier I)
//   seaZones.cap(tier, role)   → { maxClass, maxPower } for the traffic draw (combat._spawnRandom)
//   seaZones.playerPower()     the player's ship rating
//   seaZones.current           the player's zone (updated at sea); on each confirmed change (ZONE_NOTE.confirm s)
//                              'zone:enter' { tier, name, from } and a message (once per zone and per ZONE_NOTE.repeat s,
//                              none in ?shot= showcases)
// Readers: combat.js (traffic, convoys), ai.js (targets, pursuit, cruising), living.js (hunters), pirateLords.js
// (lairs, spawns, avenging pirate), fortune.js (treasure cove), career.js (missions: ship, bounty).
import { buildZones, zoneAt, forbidden, capFor, livePower, zoneEnterText, ZONE_NOTE } from '../data/seaZones.js';

export class SeaZones {
  constructor(game) {
    this.game = game;
    this.zones = null;
    this.current = null;
    this._key = null; this._pend = null; this._told = new Map();
    game.events?.on?.('game:loaded', () => { this._key = null; this._pend = null; });
    game.events?.on?.('game:new', () => { this._key = null; this._pend = null; this._told.clear(); });
  }
  get data() {
    if (!this.zones && this.game.islands?.ports?.length) this.zones = buildZones(this.game.islands.ports);
    return this.zones;
  }
  at(x, z) { return zoneAt(this.data, x, z); }
  tierAt(x, z) { return zoneAt(this.data, x, z).tier; }
  forbids(ship, x, z, target = null) { return forbidden(this.data, ship, x, z, target); }
  playerPower() { return livePower(this.game.player); }
  cap(tier, role) { return capFor(tier, role, this.playerPower()); }
  update(dt) {
    const g = this.game, p = g.player;
    if (!p || g.mode !== 'sail' || !(dt > 0)) return;
    const z = this.current = this.at(p.position.x, p.position.z), key = `${z.tier}|${z.name}`;
    if (this._key == null) { this._key = key; return; }   // first measurement (start, load): no message
    if (key === this._key) { this._pend = null; return; }
    if (this._pend?.key !== key) this._pend = { key, t: 0 };
    if ((this._pend.t += dt) < ZONE_NOTE.confirm) return;
    const from = Number(this._key.split('|')[0]);
    this._key = key; this._pend = null;
    g.events.emit('zone:enter', { tier: z.tier, name: z.name, from });
    if (g.params?.get?.('shot')) return;
    const last = this._told.get(key);
    if (last != null && g.time - last < ZONE_NOTE.repeat) return;
    this._told.set(key, g.time);
    g.events.emit('notify', { text: zoneEnterText(z), kind: z.tier === 3 ? 'bad' : z.tier === 1 ? 'good' : 'info', topic: 'zone', key: 'zone' });
  }
}
