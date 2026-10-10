// replay a movie (tas/movie*.js or progress json) and print the WINNING TOTALS numbers + per-level table
require('../../js/gamedata.js'); require('../../js/font.js');
const Z = require('../../js/sim.js');
const fs = require('fs');
const f = process.argv[2] || 'tas/movie.js';
let M;
if (f.endsWith('.json')) M = JSON.parse(fs.readFileSync(f, 'utf8'));
else { const w = {}; new Function('window', fs.readFileSync(f, 'utf8'))(w); M = w.TAS_MOVIE; }
const g = new Z.Game({ seed: M.seed });
g.startAdventure(0);
let i = 0;
const end = M.events.length ? M.events[M.events.length - 1][0] + 2000 : 0;
for (let t = 0; t < end + 5000; t++) {
  let ev = null; if (i < M.events.length && M.events[i][0] === t) { ev = M.events[i][1]; i++; }
  g.tick(ev);
  if (g.board.statsDialog && g.board.statsDialog.kind === 'final') break;
}
const st = g.board.mGameStats, b = g.board;
const tt = Math.trunc(st.mTimePlayed / 100);
console.log('final dialog:', !!(b.statsDialog && b.statsDialog.kind === 'final'), 'levels', b.levelTimes.length);
console.log('TOTAL TIME', Math.floor(tt / 60) + ':' + String(tt % 60).padStart(2, '0'), '(' + (st.mTimePlayed / 100).toFixed(2) + ' s)', 'COMBOS', st.mNumCombos, 'COINS', st.mNumGemsCleared,
  'GAPS', st.mNumGaps, 'MAX CHAIN', st.mMaxInARow, 'MAX COMBO', st.mMaxCombo + 1, 'score', b.mScore);
