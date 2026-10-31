// endgame headroom probe: replay a movie to `back` ticks before each level's target moment and re-search
// the rest of the level with a given v4 config; compares the finish tick with the movie's.
// usage: node endprobe.js <movie> '<cfg json>' <labels csv | all> [back] [parallel]
'use strict';
const fs = require('fs'), cp = require('child_process');
require('../../js/gamedata.js'); require('../../js/font.js');
const Z = require('../../js/sim.js');

function loadMovie(f) {
  if (f.endsWith('.json')) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const w = {}; new Function('window', fs.readFileSync(f, 'utf8'))(w); return w.TAS_MOVIE;
}
function replayTo(M, upto) {
  const g = new Z.Game({ seed: M.seed }); g.startAdventure(0);
  let i = 0;
  for (let t = 0; t < upto; t++) { let ev = null; if (i < M.events.length && M.events[i][0] === t) { ev = M.events[i][1]; i++; } g.tick(ev); }
  return g;
}

if (process.argv[2] === '--child') {
  const V = require('./v4.js');
  let M = null;
  process.on('message', (m) => {
    if (!M) M = loadMovie(m.movie);
    const g = replayTo(M, m.abs);
    const t0 = Date.now();
    let r = null, err = null;
    try { r = V.beam4(g, m.cfg); } catch (e) { err = String(e.stack); }
    process.send({ label: m.label, play: r ? r.playTicks : null, sec: (Date.now() - t0) / 1000, err });
  });
  return;
}

const movieFile = process.argv[2] || 'tas/movie.js';
const cfg = JSON.parse(process.argv[3] || '{}');
const M = loadMovie(movieFile);
let labels = process.argv[4] || 'all';
labels = labels === 'all' ? M.levels.map(l => l.label) : labels.split(',');
const back = +(process.argv[5] || 0), NP = +(process.argv[6] || 12);

// one pass over the movie: absolute tick of (in-level tick == targetAt - back) for every level
const want = new Map(M.levels.map(L => [L.label, L]));
const abs = new Map();
{
  const g = new Z.Game({ seed: M.seed }); g.startAdventure(0);
  let i = 0;
  const end = M.events[M.events.length - 1][0];
  for (let t = 0; t <= end; t++) {
    const b = g.board;
    if (b.mGameState === Z.ST_PLAYING) {
      const lab = (b.mLevelDesc.mStage + 1) + '-' + (b.mLevelDesc.mLevel + 1), L = want.get(lab);
      if (L && !abs.has(lab) && b.mStateCount >= Math.max(1, L.targetAt - back)) abs.set(lab, t);
    }
    let ev = null; if (i < M.events.length && M.events[i][0] === t) { ev = M.events[i][1]; i++; }
    g.tick(ev);
  }
}

const queue = labels.slice(), res = {};
let active = 0;
const t0 = Date.now();
function next(w) {
  if (!queue.length) { w.kill(); if (--active === 0) report(); return; }
  const label = queue.shift();
  w.send({ label, cfg, movie: movieFile, abs: abs.get(label) });
}
for (let i = 0; i < Math.min(NP, labels.length); i++) {
  const w = cp.fork(__filename, ['--child'], { execArgv: ['--max-old-space-size=1500'] });
  active++;
  w.on('message', (r) => { res[r.label] = r; if (r.err) console.log(r.label, 'ERR', r.err.split('\n').slice(0, 3).join(' ')); next(w); });
  next(w);
}
function report() {
  let sNew = 0, sOld = 0, n = 0, better = 0, worse = 0;
  const rows = [];
  for (const lab of labels) {
    const r = res[lab], L = want.get(lab);
    if (!r || r.play === null) { rows.push(lab + ' FAIL'); continue; }
    sNew += r.play; sOld += L.playTicks; n++;
    if (r.play < L.playTicks) better++; else if (r.play > L.playTicks) worse++;
    rows.push(`${lab.padEnd(6)} tgt ${String(L.targetAt).padStart(4)} movie ${String(L.playTicks).padStart(4)} new ${String(r.play).padStart(4)}  ${r.play - L.playTicks > 0 ? '+' : ''}${r.play - L.playTicks}  ${r.sec.toFixed(0)}s`);
  }
  console.log(rows.join('\n'));
  console.log(JSON.stringify(cfg), 'back', back, 'SUM new', sNew, 'movie', sOld, 'diff', sNew - sOld, 'better', better, 'worse', worse, 'of', n, 'wall', ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
