// Full-game TAS driver: searches every adventure level in order with an ensemble of beam searches
// (parallel worker processes), keeps the fastest, handles transitions with minimal inputs and writes
// tas/movie.js (+ tas/progress.json for resuming).
// usage: node tools/tas/run_all.js [seed] [workers] [width]
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
require('../../js/gamedata.js'); require('../../js/font.js');
const Z = require('../../js/sim.js');
const { replay } = require('./worker.js');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tas');
const seed = +(process.argv[2] || 1);
const NW = +(process.argv[3] || 20);
const WIDTH = +(process.argv[4] || 48);
const TAG = process.argv[6] || '';
const PROG = path.join(OUT, 'progress_' + seed + TAG + '.json');
const REFINE = +(process.argv[5] || 0);

// WR (QuocQuoc444 & DadoYep, RTA 19:59.58) level times from the stats dialogs ("YOUR TIME", whole seconds)
const WR = { '1-1': 6, '1-2': 5, '1-3': 5, '1-4': 7, '2-1': 8, '2-2': 6, '2-3': 7, '2-4': 7, '3-1': 7, '3-2': 10, '3-3': 8, '3-4': 8,
  '4-1': 7, '4-2': 7, '4-3': 8, '4-4': 7, '4-5': 9, '5-1': 9, '5-2': 9, '5-3': 9, '5-4': 8, '5-5': 10, '6-1': 8, '6-2': 9, '6-3': 10,
  '6-4': 9, '6-5': 10, '6-6': 9, '7-1': 7, '7-2': 8, '7-3': 7, '7-4': 8, '7-5': 9, '7-6': 7, '8-1': 7, '8-2': 8, '8-3': 8, '8-4': 9,
  '8-5': 10, '8-6': 9, '8-7': 7, '9-1': 9, '9-2': 8, '9-3': 8, '9-4': 10, '9-5': 10, '9-6': 8, '10-1': 9, '10-2': 8, '10-3': 9,
  '10-4': 9, '10-5': 10, '10-6': 9, '11-1': 9, '11-2': 10, '11-3': 9, '11-4': 8, '11-5': 11, '11-6': 10, '12-1': 9, '12-2': 9,
  '12-3': 8, '12-4': 10, '12-5': 10, '12-6': 8 };

// diverse ensemble: different engines / evaluation settings (results are chaotic, best-of-N pays)
function configs(n, width) {
  const base = [
    { width },
    { width: 24 },
    { width, gamma: 0.55 },
    { width, betaShot: 90 },
    { width, betaShot: 40, evalShots: 4 },
    { width, fixDisc: 0.85, evalShots: 6, candShots: 6 },
    { width, fixDisc: 0.9, evalShots: 5, candShots: 5, gamma: 0.8 },
    { width, timing: 8 },
    { width: 24, timing: 6, gamma: 0.6 },
    { width, segPen: 120 },
    { width, segPen: 200, betaShot: 75 },
    { width, settle: 140 },
    { width, noise: 300, seed: 11 },
    { width, noise: 300, seed: 12 },
    { width: 64, noise: 150, seed: 13, gamma: 0.62 },
    { engine: 'macro', K: 8 },
    { engine: 'macro', K: 12, maxDelay: 0 },
    { width, evalShots: 4, gamma: 0.62, timing: 5 },
    { width: 32, fixDisc: 0.85, evalShots: 6, candShots: 6, timing: 8 },
    { width, perColor: 16, candShots: 6 },
    { width: 24, noise: 500, seed: 21 },
    { width: 24, noise: 500, seed: 22 },
  ];
  const out = [];
  for (let k = 0; k < n; k++) out.push(Object.assign({ seed: 1000 + k * 7919 }, base[k % base.length]));
  return out;
}

class Pool {
  constructor(n) {
    this.workers = [];
    for (let i = 0; i < n; i++) this.workers.push(cp.fork(path.join(__dirname, 'worker.js'), [], { execArgv: ['--max-old-space-size=1500'] }));
  }
  runAll(msgs) {
    return new Promise((resolve) => {
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

function loadProgress() {
  if (fs.existsSync(PROG)) return JSON.parse(fs.readFileSync(PROG, 'utf8'));
  return { seed, events: [], upto: 0, levels: [], reveals: 0, done: false };
}
function save(P) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(PROG, JSON.stringify(P));
  const playTot = P.levels.reduce((a, L) => a + L.playTicks, 0);
  const movie = { seed: P.seed, events: P.events, levels: P.levels, totalPlayTicks: playTot,
    totalRtaTicks: (P.finalTick || P.upto) + P.reveals * 196, inputCount: P.events.length,
    note: 'Claude TAS · 逐关集束搜索（beam search）+ 精确模拟验证 · 不含加载时间' };
  fs.writeFileSync(path.join(OUT, 'movie' + TAG + '.js'), 'window.TAS_MOVIE = ' + JSON.stringify(movie) + ';\n');
}

// advance through the level-end transitions with minimal inputs; returns when the next level begins
function transitions(g, P) {
  const b = g.board;
  let sawLevel = false;
  for (let k = 0; k < 5000; k++) {
    const ev = [];
    if (b.statsDialog && g.appTick - b.statsDialog.openTick >= 17) {
      if (b.statsDialog.kind === 'final') { P.done = true; P.finalTick = P.upto; return; }
      ev.push(['ok']);
    } else if (b.pendingReveal) { ev.push(['next']); P.reveals++; }
    else if (b.mGameState === Z.ST_LEVELUP && b.tr.state === Z.TS_TEMPLECOMPLETE) {
      if (b.continueVisible) ev.push(['cont']); else if (b.tr.count < b.tr.resetFrame || b.tr.count <= 1) ev.push(['l']);
    }
    else if (b.mGameState === Z.ST_LEVELBEGIN) return;
    if (ev.length) P.events.push([P.upto, ev]);
    g.tick(ev.length ? ev : null);
    P.upto++;
  }
  throw new Error('transition stuck');
}

async function main() {
  const P = loadProgress();
  const pool = new Pool(NW);
  console.log('seed', seed, 'workers', NW, 'width', WIDTH, 'resume at level', P.levels.length);
  while (!P.done) {
    const g = replay(P.seed, P.events, P.upto);
    const b = g.board;
    if (b.mGameState !== Z.ST_LEVELBEGIN) throw new Error('not at level begin: ' + b.mGameState);
    const L = b.mLevel, label = (b.mLevelDesc.mStage + 1) + '-' + (b.mLevelDesc.mLevel + 1);
    const t0 = Date.now();
    const cfgs = configs(NW, WIDTH);
    const res = await pool.runAll(cfgs.map(cfg => ({ seed: P.seed, events: P.events, upto: P.upto, cfg })));
    let best = null;
    for (const r of res) {
      if (!r.ok) { console.log('worker error', r.err); continue; }
      if (r.res && (!best || r.res.objective < best.objective)) best = r.res;
    }
    if (!best) throw new Error('no solution for level ' + label);
    // refinement: restart searches from checkpoints along the best solution
    for (let round = 0; round < REFINE; round++) {
      const shots = best.events.filter(e => e[0] > 1).map(e => e[0]);
      if (shots.length < 4) break;
      const msgs = [];
      const fr = [0.15, 0.3, 0.45, 0.6, 0.75];
      for (let q = 0; q < NW; q++) {
        const cut = shots[Math.floor(shots.length * fr[q % fr.length])];
        const cfg = Object.assign({}, configs(NW, WIDTH)[(q * 7 + round) % NW], { seed: 5000 + round * 100 + q, noise: q % 2 ? 200 : 0 });
        msgs.push({ seed: P.seed, events: P.events, upto: P.upto, cfg, prefix: best.events, cut });
      }
      const rr = await pool.runAll(msgs);
      let improved = false;
      for (const r of rr) if (r.ok && r.res && r.res.objective < best.objective) { best = r.res; improved = true; }
      if (!improved) break;
    }
    const objs = res.filter(r => r.ok && r.res).map(r => r.res.objective).sort((a, c) => a - c);
    // apply
    const startTick = P.upto;
    for (const [t, ev] of best.events) P.events.push([startTick + t, ev]);
    const endPlay = startTick + best.events[best.events.length - 1][0];
    let i = 0;
    const evs = best.events;
    for (let t = 0; ; t++) {
      let ev = null;
      if (i < evs.length && evs[i][0] === t) { ev = evs[i][1]; i++; }
      g.tick(ev); P.upto++;
      if (b.mGameState === Z.ST_LEVELUP) break;
      if (t > 6000) throw new Error('replay of best did not finish');
    }
    const lv = { level: L, stage: b.mLevelDesc.mStage, label, name: b.mLevelDesc.mDisplayName, startTick, endTick: P.upto,
      playTicks: b.levelTimes[b.levelTimes.length - 1], quake: b.tr.quakeFrame, score: b.mScore, targetAt: best.targetAt,
      wr: WR[label] !== undefined ? '0:' + String(WR[label]).padStart(2, '0') : null };
    P.levels.push(lv);
    transitions(g, P);
    save(P);
    console.log(`${label.padEnd(6)} play ${(lv.playTicks / 100).toFixed(2)}s  bonus ${lv.quake}  WR ${lv.wr || '-'}  objs ${objs.slice(0, 5).join(',')}  ${(Date.now() - t0) / 1000}s  total ${(P.upto / 100).toFixed(1)}s`);
  }
  save(P);
  pool.close();
  const playTot = P.levels.reduce((a, L) => a + L.playTicks, 0);
  console.log('DONE. levels', P.levels.length, 'play total', (playTot / 100).toFixed(2), 's; with transitions', ((P.finalTick + P.reveals * 196) / 100).toFixed(2), 's');
}
main().catch(e => { console.error(e); process.exit(1); });
