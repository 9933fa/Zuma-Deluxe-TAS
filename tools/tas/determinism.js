require('../../js/gamedata.js'); require('../../js/font.js');
const Z = require('../../js/sim.js');
function run(visual) {
  const g = new Z.Game({ seed: 777, visual });
  g.startAdventure(0);
  let rnd = 12345; const R = () => (rnd = (Math.imul(rnd, 1103515245) + 12345) >>> 0) / 4294967296;
  const log = [];
  for (let t = 0; t < 60000; t++) {
    const b = g.board, ev = [];
    if (b.mGameState === Z.ST_LEVELBEGIN) ev.push(['l']);
    else if (b.statsDialog) ev.push(['ok']);
    else if (b.continueVisible) ev.push(['cont']);
    else if (b.pendingReveal) ev.push(['next']);
    else if (t % 23 === 0) {
      const cm = b.mCurveMgr[0], gb = b.gun.mBullet; let tgt = null;
      if (gb) for (const x of cm.mBallList) if (x.mType === gb.mType && x.mClearCount === 0 && R() < 0.3) { tgt = x; break; }
      if (tgt) ev.push(['m', Math.round(tgt.mx + (R() - 0.5) * 20), Math.round(tgt.my + (R() - 0.5) * 20)], ['l']);
      else if (R() < 0.3) ev.push(['r']);
    }
    g.tick(ev);
    if (t % 1000 === 0) log.push([b.mLevel, b.mScore, b.mLives, g.appRand.mti, g.appRand.mt[5], b.mCurveMgr[0] ? b.mCurveMgr[0].mBallList.size : 0].join(','));
  }
  return { log, level: g.board.mLevel, score: g.board.mScore, lives: g.board.mLives, times: g.board.levelTimes };
}
const t0 = Date.now(); const a = run(false); const t1 = Date.now(); const b = run(true); const t2 = Date.now();
console.log('headless ms', t1 - t0, 'visual ms', t2 - t1);
console.log('same:', JSON.stringify(a.log) === JSON.stringify(b.log), 'level', a.level, b.level, 'score', a.score, b.score, 'lives', a.lives, b.lives);
console.log('levelTimes', a.times.join(' '));
