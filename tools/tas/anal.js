// per-level analysis of saved bench solutions: state at target trigger vs cleanup duration
require('../../js/gamedata.js'); require('../../js/font.js');
const Z = require('../../js/sim.js'); const V = require('./v4.js'); const B = require('./bot.js');
const { replay } = require('./replay.js');
const P = require('../../tas/progress_64_v3.json');
const S = require(require('path').resolve(process.argv[2]));
const C = 'BYRGPW';
for (const lab of Object.keys(S.res)) {
  const r = S.res[lab]; if (!r.events) continue;
  const L = P.levels.find(l => l.label === lab);
  const g = replay(P.seed, P.events.filter(e => e[0] < L.startTick), L.startTick);
  let i = 0, shots = 0, shotsAfter = 0, info = null;
  for (let t = 0; t < 4000; t++) {
    let ev = null; if (i < r.events.length && r.events[i][0] === t) { ev = r.events[i][1]; i++; }
    const b = g.board;
    if (ev && ev.length > 1) { shots++; if (b.mHaveReachedTarget) shotsAfter++; }
    g.tick(ev);
    if (!info && b.mHaveReachedTarget) {
      const rm = V.runModel(g);
      const balls = rm.map(rr => rr.reduce((a, x) => a + x.n, 0));
      const far = b.mCurveMgr.map(cm => cm.mBallList.empty() ? 0 : Math.round(100 * cm.mBallList.back().mWayPoint / cm.wp.n));
      const cost = rm.map(rr => V.clearCost(rr));
      info = { t: b.mStateCount, balls, far, cost, chain: rm.map(rr => rr.map(x => C[x.c] + x.n).join('')) };
    }
    if (b.mGameState === Z.ST_LEVELUP) break;
  }
  console.log(lab.padEnd(6), 'end', r.play, 'trig', info.t, 'clean', r.play - info.t, 'shots', shots, 'after', shotsAfter, 'balls', info.balls.join('+'), 'far%', info.far.join(','), 'dp', info.cost.join('+'), '|', info.chain.join(' || '));
}
