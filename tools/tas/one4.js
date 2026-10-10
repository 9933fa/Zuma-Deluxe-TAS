require('../../js/gamedata.js'); require('../../js/font.js');
const { replay } = require('./replay.js'); const V = require('./v4.js');
const P = require('../../tas/progress_64_v3.json');
const L = P.levels.find(l => l.label === process.argv[2]);
const g = replay(P.seed, P.events.filter(e => e[0] < L.startTick), L.startTick);
const t0 = Date.now();
const r = V.beam4(g, Object.assign({ verbose: true }, JSON.parse(process.argv[3] || '{}')));
console.log('result', r && r.playTicks, 'target', r && r.targetAt, 'v3', L.playTicks, 'sec', (Date.now() - t0) / 1000);
if (r) {
  const pre = P.events.filter(e => e[0] < L.startTick);
  const evs = pre.concat(r.events.map(e => [e[0] + L.startTick, e[1]]));
  require('fs').writeFileSync(process.env.OUT || 'tas/one4_out.json', JSON.stringify({ seed: P.seed, events: evs, levels: [{ label: L.label, startTick: L.startTick, endTick: L.startTick + r.playTicks + 5 }] }));
}
