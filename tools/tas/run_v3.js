// Full-game TAS driver v3: per level an ensemble of searches; the best M distinct solutions are then
// compared by how good the NEXT level becomes (every level's balls come from the RNG state the previous
// level leaves behind, so this is RNG manipulation across levels). Picks min(level + next level).
// usage: node tools/tas/run_v3.js <seed> <workers> <M> <tag>
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
require('../../js/gamedata.js'); require('../../js/font.js');
const Z = require('../../js/sim.js');
const { replay } = require('./worker.js');

const ROOT = path.join(__dirname, '..', '..'), OUT = path.join(ROOT, 'tas');
const seed = +(process.argv[2] || 64), NW = +(process.argv[3] || 22), M = +(process.argv[4] || 5), TAG = process.argv[5] || '_v3';
const PROG = path.join(OUT, 'progress_' + seed + TAG + '.json');
const WR = require('./wr.json');

const ENSEMBLE = [
  { width: 48 }, { width: 24 }, { width: 48, gamma: 0.55 }, { width: 48, betaShot: 90 }, { width: 48, betaShot: 40, evalShots: 4 },
  { width: 48, fixDisc: 0.85, evalShots: 6, candShots: 6 }, { width: 48, timing: 8 }, { width: 48, segPen: 120 },
  { width: 48, noise: 300, seed: 11 }, { width: 48, noise: 300, seed: 12 }, { width: 24, noise: 500, seed: 21 },
  { width: 24, noise: 500, seed: 22 }, { width: 32, gamma: 0.62, evalShots: 4 }, { width: 48, settle: 140 },
  { width: 24, timing: 6, gamma: 0.6 }, { width: 48, perColor: 16, candShots: 6 }, { width: 24, betaShot: 75, noise: 200, seed: 31 },
  { width: 24, gamma: 0.7, noise: 200, seed: 32 }, { width: 32, noise: 400, seed: 33 }, { width: 32, fixDisc: 0.9, evalShots: 5, candShots: 5, gamma: 0.8 },
  { width: 24, segPen: 200, betaShot: 75 }, { width: 24, noise: 300, seed: 34, timing: 5 },
];
const QUICK = [{ width: 24 }, { width: 24, gamma: 0.55 }, { width: 24, noise: 300, seed: 7 }, { width: 24, betaShot: 90 }];

class Pool {
  constructor(n) { this.workers = []; for (let i = 0; i < n; i++) this.workers.push(cp.fork(path.join(__dirname, 'worker.js'), [], { execArgv: ['--max-old-space-size=1500'] })); }
  runAll(msgs) {
    return new Promise((resolve) => {
      if (!msgs.length) return resolve([]);
      const results = new Array(msgs.length); let next = 0, done = 0;
      const give = (w) => {
        if (next >= msgs.length) return;
        const id = next++;
        w.once('message', (r) => { results[id] = r; done++; if (done === msgs.length) resolve(results); else give(w); });
        w.send(Object.assign({ id }, msgs[id]));
      };
      for (const w of this.workers) give(w);
    });
  }
  close() { for (const w of this.workers) w.kill(); }
}

// apply a level solution + minimal transition inputs to a clone of g (at LevelBegin);
// returns {events (absolute), upto, game, reveals, done, lv}
function applySolution(g0, upto0, sol) {
  const g = g0.clone(), b = g.board;
  const events = [];
  let upto = upto0, reveals = 0, done = false, finalTick = null;
  let i = 0;
  for (const [t, ev] of sol.events) events.push([upto0 + t, ev]);
  for (let t = 0; ; t++) {
    let ev = null;
    if (i < sol.events.length && sol.events[i][0] === t) { ev = sol.events[i][1]; i++; }
    g.tick(ev); upto++;
    if (b.mGameState === Z.ST_LEVELUP) break;
    if (t > 6000) throw new Error('solution did not finish');
  }
  const lv = { level: b.mLevel, stage: b.mLevelDesc.mStage, label: (b.mLevelDesc.mStage + 1) + '-' + (b.mLevelDesc.mLevel + 1),
    name: b.mLevelDesc.mDisplayName, startTick: upto0, endTick: upto, playTicks: b.levelTimes[b.levelTimes.length - 1],
    quake: b.tr.quakeFrame, score: b.mScore, targetAt: sol.targetAt };
  lv.wr = WR[lv.label] !== undefined ? '0:' + String(WR[lv.label]).padStart(2, '0') : null;
  for (let k = 0; k < 6000; k++) {
    const ev = [];
    if (b.statsDialog && g.appTick - b.statsDialog.openTick >= 17) {
      if (b.statsDialog.kind === 'final') { done = true; finalTick = upto; break; }
      ev.push(['ok']);
    } else if (b.pendingReveal) { ev.push(['next']); reveals++; }
    else if (b.mGameState === Z.ST_LEVELUP && b.tr.state === Z.TS_TEMPLECOMPLETE) {
      if (b.continueVisible) ev.push(['cont']); else if (b.tr.count < b.tr.resetFrame || b.tr.count <= 1) ev.push(['l']);
    } else if (b.mGameState === Z.ST_LEVELBEGIN) break;
    if (ev.length) events.push([upto, ev]);
    g.tick(ev.length ? ev : null); upto++;
  }
  return { events, upto, game: g, reveals, done, finalTick, lv };
}

function loadProgress() {
  if (fs.existsSync(PROG)) return JSON.parse(fs.readFileSync(PROG, 'utf8'));
  return { seed, events: [], upto: 0, levels: [], reveals: 0, done: false, carry: null };
}
function save(P) {
  fs.writeFileSync(PROG, JSON.stringify(P));
  const playTot = P.levels.reduce((a, L) => a + L.playTicks, 0);
  const movie = { seed: P.seed, events: P.events, levels: P.levels, totalPlayTicks: playTot,
    totalRtaTicks: (P.finalTick || P.upto) + P.reveals * 196, inputCount: P.events.length,
    note: 'Claude TAS v3 · 集束搜索集成 + 跨关随机数操控（按下一关结果选本关解）· 不含加载时间' };
  fs.writeFileSync(path.join(OUT, 'movie' + TAG + '.js'), 'window.TAS_MOVIE = ' + JSON.stringify(movie) + ';\n');
}

async function main() {
  const P = loadProgress();
  const pool = new Pool(NW);
  console.log('v3 seed', seed, 'workers', NW, 'M', M, 'resume at level', P.levels.length);
  let g = replay(P.seed, P.events, P.upto);
  while (!P.done) {
    const b = g.board;
    if (b.mGameState !== Z.ST_LEVELBEGIN) throw new Error('not at level begin');
    const t0 = Date.now();
    const label = (b.mLevelDesc.mStage + 1) + '-' + (b.mLevelDesc.mLevel + 1);
    // 1. ensemble
    const res = await pool.runAll(ENSEMBLE.slice(0, NW).map((cfg, k) => ({ seed: P.seed, events: P.events, upto: P.upto, cfg: Object.assign({ seed: 1000 + k * 7919 }, cfg) })));
    let cands = [];
    for (const r of res) if (r.ok && r.res) cands.push(r.res); else if (!r.ok) console.log('worker error', r.err.split('\n')[0]);
    if (P.carry) cands.push(P.carry);
    // distinct by outcome
    const seen = new Set();
    cands.sort((a, c) => a.objective - c.objective);
    cands = cands.filter(c => { const k = c.objective + ':' + c.events.length + ':' + c.events[c.events.length - 1][0]; if (seen.has(k)) return false; seen.add(k); return true; });
    if (!cands.length) throw new Error('no solution for ' + label);
    const top = cands.slice(0, M);
    // 2. apply each candidate
    const applied = top.map(c => applySolution(g, P.upto, c));
    // 3. next-level lookahead
    let choice = 0, nextInfo = [];
    if (!applied[0].done && top.length > 1) {
      const msgs = [];
      applied.forEach((a, ci) => {
        const evs = P.events.concat(a.events);
        for (const q of QUICK) msgs.push({ seed: P.seed, events: evs, upto: a.upto, cfg: q, ci });
      });
      const rr = await pool.runAll(msgs);
      const nextBest = top.map(() => null);
      rr.forEach((r, k) => { const ci = msgs[k].ci; if (r.ok && r.res && (!nextBest[ci] || r.res.objective < nextBest[ci].objective)) nextBest[ci] = r.res; });
      let bestSum = Infinity;
      top.forEach((c, ci) => {
        const s = c.objective + (nextBest[ci] ? nextBest[ci].objective : 5000);
        nextInfo.push(c.objective + '+' + (nextBest[ci] ? nextBest[ci].objective : '?'));
        if (s < bestSum) { bestSum = s; choice = ci; }
      });
      P.carry = nextBest[choice];
    } else P.carry = null;
    const A = applied[choice];
    for (const e of A.events) P.events.push(e);
    P.upto = A.upto; P.reveals += A.reveals;
    P.levels.push(A.lv);
    if (A.done) { P.done = true; P.finalTick = A.finalTick; }
    g = A.game;
    save(P);
    console.log(`${label.padEnd(6)} play ${(A.lv.playTicks / 100).toFixed(2)}s  bonus ${A.lv.quake}  WR ${A.lv.wr || '-'}  pick ${choice} [${nextInfo.join(' ')}]  ${(Date.now() - t0) / 1000}s  total ${(P.upto / 100).toFixed(1)}s`);
  }
  pool.close();
  const playTot = P.levels.reduce((a, L) => a + L.playTicks, 0);
  console.log('DONE. levels', P.levels.length, 'play total', (playTot / 100).toFixed(2), 's; with transitions', ((P.finalTick + P.reveals * 196) / 100).toFixed(2), 's');
}
main().catch(e => { console.error(e); process.exit(1); });
