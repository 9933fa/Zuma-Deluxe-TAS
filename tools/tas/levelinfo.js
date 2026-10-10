require('../../js/gamedata.js'); require('../../js/font.js');
const Z = require('../../js/sim.js');
const P = require('../../tas/progress_64_v3.json');
const { replay } = require('./worker.js');
// level info from the v3 run (exact states at level begin)
let g = replay(P.seed, [], 0);
let ei = 0;
const evs = P.events;
for (const L of P.levels) {
  while (g.appTick !== undefined && false) {}
  g = replay(P.seed, evs.filter(e => e[0] < L.startTick), L.startTick);
  const b = g.board, d = b.mLevelDesc;
  const cs = b.mCurveMgr.map(cm => `n${cm.wp.n} sp${cm.mCurveDesc.mSpeed.toFixed(2)} nb${cm.mCurveDesc.mNumBalls} sd${cm.mCurveDesc.mStartDistance} rep${cm.mCurveDesc.mBallRepeat} ms${cm.mCurveDesc.mMaxSingle} zb${cm.mCurveDesc.mZumaBack} dp${cm.mDangerPoint}`).join(' / ');
  console.log(L.label.padEnd(6), 'tgt', b.mScoreTarget - b.mLevelBeginScore, 'col', b.mCurveMgr[0].mCurveDesc.mNumColors, 'tf', d.mTreasureFreq, 'tp', d.mTreasurePoints.length, 'fire', d.mFireSpeed, 'play', L.playTicks, 'tgtAt', L.targetAt, '|', cs);
}
