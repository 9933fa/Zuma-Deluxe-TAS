// benchmark a v4 config on level-begin states from the v3 run.
// usage: node bench4.js '<cfg json>' <labels csv | all> [parallel]
'use strict';
const path = require('path'), cp = require('child_process');
const P = require('../../tas/progress_64_v3.json');
if (process.argv[2] === '--child') {
  require('../../js/gamedata.js'); require('../../js/font.js');
  const { replay } = require('./replay.js');
  const V = require('./v4.js');
  process.on('message', (m) => {
    const L = P.levels.find(l => l.label === m.label);
    const g = replay(P.seed, P.events.filter(e => e[0] < L.startTick), L.startTick);
    const t0 = Date.now();
    let r = null, err = null;
    try { r = V.beam4(g, m.cfg); } catch (e) { err = String(e.stack); }
    process.send({ label: m.label, play: r ? r.playTicks : null, targetAt: r ? r.targetAt : null, sec: (Date.now() - t0) / 1000, err, events: r ? r.events : null });
  });
  return;
}
const cfg = JSON.parse(process.argv[2] || '{}');
let labels = process.argv[3] || 'all';
labels = labels === 'all' ? P.levels.map(l => l.label) : labels.split(',');
const NP = +(process.argv[4] || 22);
const queue = labels.slice(), res = {};
let active = 0;
const t0 = Date.now();
function next(w) {
  if (!queue.length) { w.kill(); if (--active === 0) report(); return; }
  w.send({ label: queue.shift(), cfg });
}
for (let i = 0; i < Math.min(NP, labels.length); i++) {
  const w = cp.fork(__filename, ['--child'], { execArgv: ['--max-old-space-size=1500'] });
  active++;
  w.on('message', (r) => { res[r.label] = r; if (r.err) console.log(r.label, 'ERR', r.err.split('\n').slice(0, 3).join(' ')); next(w); });
  next(w);
}
function report() {
  let s4 = 0, s3 = 0, n = 0, better = 0;
  const rows = [];
  for (const lab of labels) {
    const r = res[lab], L = P.levels.find(l => l.label === lab);
    if (!r || r.play === null) { rows.push(lab + ' FAIL'); continue; }
    s4 += r.play; s3 += L.playTicks; n++; if (r.play < L.playTicks) better++;
    rows.push(`${lab.padEnd(6)} v4 ${String(r.play).padStart(5)} (tgt ${r.targetAt}) v3 ${String(L.playTicks).padStart(5)} (tgt ${L.targetAt})  ${r.play - L.playTicks > 0 ? '+' : ''}${r.play - L.playTicks}  ${r.sec.toFixed(0)}s`);
  }
  console.log(rows.join('\n'));
  console.log(JSON.stringify(cfg), 'SUM v4', s4, 'v3', s3, 'diff', s4 - s3, 'better', better + '/' + n, 'wall', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  if (process.env.SAVE) require('fs').writeFileSync(process.env.SAVE, JSON.stringify({ cfg, res }));
}
