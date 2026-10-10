// trace a saved bench solution with DP cost per shot: node trace4.js <res.json> <label> [fromTick]
require('../../js/gamedata.js'); require('../../js/font.js');
const Z = require('../../js/sim.js'); const V = require('./v4.js');
const { replay } = require('./replay.js');
const P = require('../../tas/progress_64_v3.json');
const S = require(require('path').resolve(process.argv[2]));
const lab = process.argv[3], from = +(process.argv[4] || 0);
const L = P.levels.find(l => l.label === lab), r = S.res[lab];
const g = replay(P.seed, P.events.filter(e => e[0] < L.startTick), L.startTick);
const C = 'BYRGPW';
let i = 0, last = null;
const cfg = Object.assign({}, V.DEF4, { colorPen: 1.5 });
for (let t = 0; t < 4000; t++) {
  let ev = null; if (i < r.events.length && r.events[i][0] === t) { ev = r.events[i][1]; i++; }
  const b = g.board;
  if (b.mGameState === Z.ST_PLAYING && ev && ev.length > 1 && b.mStateCount >= from) {
    const e = V.evalState(g, cfg);
    const rm = e.rm;
    const gun = b.gun;
    const used = ev.some(x => x[0] === 'r') ? gun.mNextBullet.mType : gun.mBullet.mType;
    console.log(String(b.mStateCount).padStart(4), 'F', Math.round(e.F), 'dp', rm.map(x => V.clearCost(x)).join('+'), 'cpen', e.cpen.toFixed(1), 'gun', C[gun.mBullet.mType] + C[gun.mNextBullet.mType], 'shoot', C[used], 'sc', b.mScore - b.mLevelBeginScore, '|', rm.map(rr => rr.map(x => (x.wall ? '_' : '') + C[x.c] + x.n + (x.auto ? '*' : '')).join('')).join(' || '));
  }
  g.tick(ev);
  const ls = g.stats.lastScore; if (ls && ls !== last) { last = ls; if (b.mStateCount >= from) console.log('      +' + ls.pts, 'combo', ls.combo, 'n', ls.numBalls, ls.gapBonus ? 'gap' + ls.gapBonus : ''); }
  if (b.mHaveReachedTarget && b.targetReachedFrame === b.mStateCount) console.log('      TARGET at', b.mStateCount);
  if (b.mGameState === Z.ST_LEVELUP) { console.log('END', b.mStateCount); break; }
}
