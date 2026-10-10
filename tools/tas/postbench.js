// search only the post-target phase: start from the state at the target trigger of a saved solution
// usage: node postbench.js <res.json> '<cfg>' [labels|all] [procs]
'use strict';
const cp = require('child_process');
const P = require('../../tas/progress_64_v3.json');
if (process.argv[2] === '--child') {
  require('../../js/gamedata.js'); require('../../js/font.js');
  const Z = require('../../js/sim.js'); const V = require('./v4.js');
  const { replay } = require('./replay.js');
  process.on('message', (m) => {
    const S = require(require('path').resolve(m.file));
    const L = P.levels.find(l => l.label === m.label), r = S.res[m.label];
    const g = replay(P.seed, P.events.filter(e => e[0] < L.startTick), L.startTick);
    let i = 0, t = 0;
    for (; t < 4000; t++) {
      if (g.board.mHaveReachedTarget) break;
      let ev = null; if (i < r.events.length && r.events[i][0] === t) { ev = r.events[i][1]; i++; }
      g.tick(ev);
    }
    const trig = g.board.mStateCount;
    const t0 = Date.now();
    const res = V.beam4(g, m.cfg);
    process.send({ label: m.label, orig: r.play, trig, play: res ? res.playTicks : null, sec: (Date.now() - t0) / 1000 });
  });
  return;
}
const file = process.argv[2], cfg = JSON.parse(process.argv[3] || '{}');
const S = require(require('path').resolve(file));
let labels = (process.argv[4] || 'all'); labels = labels === 'all' ? Object.keys(S.res) : labels.split(',');
const NP = +(process.argv[5] || 23);
const queue = labels.slice(), out = [];
let active = 0;
function next(w) { if (!queue.length) { w.kill(); if (--active === 0) report(); return; } w.send({ label: queue.shift(), cfg, file }); }
for (let k = 0; k < Math.min(NP, labels.length); k++) { const w = cp.fork(__filename, ['--child']); active++; w.on('message', (r) => { out.push(r); next(w); }); next(w); }
function report() {
  let a = 0, b = 0;
  for (const r of out) { a += r.orig - r.trig; b += (r.play || 9999) - r.trig; }
  console.log(JSON.stringify(cfg), 'levels', out.length, 'orig cleanup', a, 'new cleanup', b, 'avg', (a / out.length).toFixed(0), '->', (b / out.length).toFixed(0));
}
