// Minimal event bus. Known events (payloads):
//  'cannon:fire'   { ship, side, count }
//  'cannon:hit'    { target, attacker, point, damage, part: 'hull'|'sails'|'crew' }
//  'cannon:splash' { point }
//  'ship:sunk'     { ship }
//  'ship:struck'   { ship }   // surrendered
//  'port:enter'    { port }
//  'port:leave'    { port }
//  'notify'        { text, kind: 'info'|'good'|'bad' }
//  'state:change'  { from, to }   // 'sail' | 'port' | 'duel' | 'map' | 'menu'
export class Events {
  constructor() { this.map = new Map(); }
  on(name, fn) { if (!this.map.has(name)) this.map.set(name, new Set()); this.map.get(name).add(fn); return () => this.off(name, fn); }
  off(name, fn) { this.map.get(name)?.delete(fn); }
  emit(name, data) { this.map.get(name)?.forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); }
}
