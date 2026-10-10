require('../../js/gamedata.js'); require('../../js/font.js');
const Z = require('../../js/sim.js'); const B = require('./bot.js'); const V = require('./v4.js');
const { replay } = require('./replay.js');
const P = require('../../tas/progress_64_v3.json');
let tot = 0, ok = 0, gapOk = 0, gapTot = 0, ms = 0;
for (const lab of ['3-2', '6-5', '9-5', '12-3']) {
  const L = P.levels.find(l => l.label === lab);
  const g = replay(P.seed, P.events.filter(e => e[0] < L.startTick), L.startTick + 1 + 300);
  // advance to decision
  for (let k = 0; k < 600 && !B.isDecision(g); k++) g.tick(null);
  if (!B.isDecision(g)) { console.log(lab, 'no decision'); continue; }
  const t0 = Date.now();
  const proj = new V.Proj(g, 160);
  const groups = V.sweep(g, proj, 1);
  ms += Date.now() - t0;
  console.log(lab, 'groups', groups.length, 'hit', groups.filter(x => x.o.kind === 'hit').length, 'ms', Date.now() - t0);
  for (const gr of groups) {
    if (gr.o.kind !== 'hit') continue;
    // exact
    const c = g.clone(); const gun = c.board.gun; const bid = gun.mBullet.mId;
    c.tick([['m', gr.mouse[0], gr.mouse[1]], ['l']]);
    let land = null;
    for (let t = 0; t < 200 && !land; t++) {
      c.tick(null);
      for (let ci = 0; ci < c.board.mNumCurves; ci++) for (const bl of c.board.mCurveMgr[ci].mBulletList) if (bl.mId === bid) {
        const h = bl.mHitBall; const prev = bl.mHitInFront ? h : h.GetPrevBall(false), next = bl.mHitInFront ? h.GetNextBall(false) : h;
        land = { ci, prev: prev ? prev.mId : -1, next: next ? next.mId : -1, gb: V.gapBonus(bl.mGapInfo.map(x => ({ d: x.mDist, id: x.mBallId }))) };
      }
    }
    tot++;
    const o = gr.o;
    if (land && land.ci === o.ci && land.prev === o.prev && land.next === o.next) ok++;
    else if (tot - ok < 6) console.log('  mismatch', gr.mouse, 'pred', o.hit, o.front, o.prev, o.next, 'exact', land && land.prev, land && land.next, 'w', gr.width);
    const pg = V.gapBonus(o.gaps);
    if (pg || (land && land.gb)) { gapTot++; if (land && land.gb === pg) gapOk++; else if (gapTot - gapOk < 5) console.log('  gap mismatch pred', pg, 'exact', land && land.gb, 'w', gr.width); }
  }
}
console.log('slot ok', ok, '/', tot, 'gap ok', gapOk, '/', gapTot, 'sweep ms', ms);
