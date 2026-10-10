// trace a level of a progress file: node trace3.js <progressfile> <label>
require('../../js/gamedata.js'); require('../../js/font.js');
const Z = require('../../js/sim.js'); const B = require('./bot.js');
const { replay } = require('./replay.js');
const P = require(require('path').resolve(process.argv[2]));
const L = P.levels.find(l => l.label === process.argv[3]);
const g = replay(P.seed, P.events.filter(e => e[0] < L.startTick), L.startTick);
const evs = P.events.filter(e => e[0] >= L.startTick && e[0] < L.endTick);
let i = 0; const C = 'BYRGPW';
let lastScore = 0;
const show = (tag) => {
  const b = g.board, cv = B.chainModel(g);
  console.log(String(b.mStateCount).padStart(5), tag.padEnd(10), 'sc', String(b.mScore - b.mLevelBeginScore).padStart(5), 'bar', b.mCurBarSize, 'gun', b.gun.mBullet ? C[b.gun.mBullet.mType] + (b.gun.mNextBullet ? C[b.gun.mNextBullet.mType] : '') : '--', '|',
    cv.map(c => c.segs.map(s => s.runs.map(r => C[r.color] + r.n).join('') + '@' + Math.round(s.balls[0].wp) + '-' + Math.round(s.balls[s.balls.length - 1].wp)).join(' | ')).join(' || '));
};
for (let t = L.startTick; t < L.endTick; t++) {
  let ev = null; if (i < evs.length && evs[i][0] === t) { ev = evs[i][1]; i++; }
  const b = g.board;
  if (b.mGameState === Z.ST_PLAYING && (ev || (b.mStateCount % 50 === 0 && b.mHaveReachedTarget))) show(ev ? (ev.length === 3 ? 'SHOT swap' : 'SHOT') : '');
  g.tick(ev);
  const ls = g.stats.lastScore;
  if (ls && ls !== lastScore) { lastScore = ls; console.log('       +' + ls.pts, 'combo', ls.combo, 'gap', ls.gapBonus, 'n', ls.numBalls, ls.inARow ? 'chain' : ''); }
  if (b.mHaveReachedTarget && b.targetReachedFrame === b.mStateCount) show('TARGET');
}
console.log('end', g.board.levelTimes);
