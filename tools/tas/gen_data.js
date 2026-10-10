// dataset: features of settled decision states along saved solutions -> remaining ticks
// usage: node gen_data.js out.jsonl res1.json res2.json ...
require('../../js/gamedata.js'); require('../../js/font.js');
const Z = require('../../js/sim.js'); const V = require('./v4.js'); const B = require('./bot.js');
const { replay } = require('./replay.js');
const fs = require('fs');
const P = require('../../tas/progress_64_v3.json');
const out = fs.createWriteStream(process.argv[2], { flags: 'a' });
const cfg = Object.assign({}, V.DEF4, { colorPen: 1.5, wantFeat: true });
for (const f of process.argv.slice(3)) {
  const S = require(require('path').resolve(f));
  for (const lab of Object.keys(S.res)) {
    const r = S.res[lab]; if (!r.events) continue;
    const L = P.levels.find(l => l.label === lab);
    const g = replay(P.seed, P.events.filter(e => e[0] < L.startTick), L.startTick);
    let i = 0;
    for (let t = 0; t < 4000; t++) {
      let ev = null; if (i < r.events.length && r.events[i][0] === t) { ev = r.events[i][1]; i++; }
      const b = g.board;
      if (b.mGameState === Z.ST_PLAYING && B.isDecision(g) && (ev || t % 7 === 0)) {
        const sg = g.clone();
        for (let k = 0; k < cfg.settle && sg.board.mGameState === Z.ST_PLAYING; k++) sg.tick(null);
        if (sg.board.mGameState === Z.ST_PLAYING) {
          const e = V.evalState(sg, cfg);
          out.write(JSON.stringify({ x: e.feat, y: r.play - b.mStateCount, lab, f }) + '\n');
        }
      }
      if (b.mGameState === Z.ST_LEVELUP) break;
      g.tick(ev);
    }
  }
}
out.end();
