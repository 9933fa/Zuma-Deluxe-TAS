// RNG lever probe: delay a level's final shot by d ticks (re-aimed at the same slot), finish the level, and
// measure the next level with a quick search. Shows how much the next level varies per tick of waiting.
// usage: node delayprobe.js <movie> <labels csv> <maxDelay> [parallel] [quickWidth]
'use strict';
const fs = require('fs'), cp = require('child_process');
require('../../js/gamedata.js'); require('../../js/font.js');
const Z = require('../../js/sim.js');
const V = require('./v4.js'), B = require('./bot.js');

function loadMovie(f) {
  if (f.endsWith('.json')) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const w = {}; new Function('window', fs.readFileSync(f, 'utf8'))(w); return w.TAS_MOVIE;
}
function replayTo(seed, events, upto) {
  const g = new Z.Game({ seed }); g.startAdventure(0);
  let i = 0;
  for (let t = 0; t < upto; t++) { let ev = null; if (i < events.length && events[i][0] === t) { ev = events[i][1]; i++; } g.tick(ev); }
  return g;
}
// finish the level from g (no more inputs), then the minimal transition inputs up to the next LevelBegin
function finishAndTransit(g, upto) {
  const b = g.board, events = [];
  for (let k = 0; k < 4000 && b.mGameState === Z.ST_PLAYING; k++) { g.tick(null); upto++; }
  if (b.mGameState !== Z.ST_LEVELUP) return null;
  const play = b.levelTimes[b.levelTimes.length - 1];
  for (let k = 0; k < 6000; k++) {
    const ev = [];
    if (b.statsDialog && g.appTick - b.statsDialog.openTick >= 17) { if (b.statsDialog.kind === 'final') return null; ev.push(['ok']); }
    else if (b.pendingReveal) ev.push(['next']);
    else if (b.mGameState === Z.ST_LEVELUP && b.tr.state === Z.TS_TEMPLECOMPLETE) {
      if (b.continueVisible) ev.push(['cont']); else if (b.tr.count < b.tr.resetFrame || b.tr.count <= 1) ev.push(['l']);
    } else if (b.mGameState === Z.ST_LEVELBEGIN) break;
    if (ev.length) events.push([upto, ev]);
    g.tick(ev.length ? ev : null); upto++;
  }
  return { play, events, upto };
}

if (process.argv[2] === '--child') {
  process.on('message', (m) => {
    try {
      const g = replayTo(m.seed, m.events, m.upto);
      const r = V.beam4(g, m.cfg);
      process.send({ id: m.id, play: r ? r.playTicks : null });
    } catch (e) { process.send({ id: m.id, play: null, err: String(e.stack) }); }
  });
  return;
}

const M = loadMovie(process.argv[2] || 'tas/movie.js');
const labels = (process.argv[3] || '2-1').split(',');
const MD = +(process.argv[4] || 20), NP = +(process.argv[5] || 12), QW = +(process.argv[6] || 8);
const QUICK = [0, 1, 2, 3, 4].map(k => ({ maxDelay: 6, colorPen: 1.5, coarse: 4, width: QW, noise: k ? 30 : 0, seed: 100 + k }));

const jobs = [], meta = [];
for (const lab of labels) {
  const li = M.levels.findIndex(l => l.label === lab);
  const L = M.levels[li], N = M.levels[li + 1];
  if (!N) continue;
  const inLv = M.events.filter(e => e[0] >= L.startTick && e[0] < L.endTick);
  const last = inLv.filter(e => e[1].some(x => x[0] === 'l')).pop();
  const T = last[0];
  const prefix = M.events.filter(e => e[0] < T);
  const g0 = replayTo(M.seed, M.events, T);
  if (!B.isDecision(g0)) { console.log(lab, 'final shot not at a decision point'); continue; }
  // the original final shot's slot
  const mv = last[1].find(x => x[0] === 'm') || ['m', g0.board.lastMouse[0], g0.board.lastMouse[1]], swap = last[1].some(x => x[0] === 'r');
  const o0 = V.trace(g0, new V.Proj(g0, 160), [mv[1], mv[2]]);
  const rows = [];
  for (let d = 0; d <= MD; d++) {
    const g = g0.clone();
    let ok = true;
    for (let k = 0; k < d; k++) { g.tick(null); if (g.board.mGameState !== Z.ST_PLAYING) { ok = false; break; } }
    if (!ok || !B.isDecision(g)) continue;
    let mouse = [mv[1], mv[2]];
    if (d > 0) {
      const groups = V.sweep(g, new V.Proj(g, 160), 1, 4);
      const hit = groups.filter(q => q.o.kind === o0.kind && (o0.kind !== 'hit' || (q.o.ci === o0.ci && q.o.prev === o0.prev && q.o.next === o0.next)));
      if (!hit.length) continue;
      hit.sort((a, c) => c.width - a.width);
      mouse = hit[0].mouse;
    }
    const ev = [['m', mouse[0], mouse[1]]]; if (swap) ev.push(['r']); ev.push(['l']);
    g.tick(ev);
    const fin = finishAndTransit(g, T + d + 1);
    if (!fin) continue;
    const events = prefix.concat([[T + d, ev]], fin.events);
    const r = { lab, next: N.label, d, play: fin.play, moviePlay: L.playTicks, quick: [] };
    rows.push(r);
    for (const cfg of QUICK) { jobs.push({ id: jobs.length, seed: M.seed, events, upto: fin.upto, cfg }); meta.push(r); }
  }
  console.log(lab, 'final shot at', T, 'variants', rows.length);
}

const res = new Array(jobs.length);
let nextJob = 0, doneJobs = 0;
const workers = [];
const t0 = Date.now();
function give(w) {
  if (nextJob >= jobs.length) { w.kill(); return; }
  w.send(jobs[nextJob++]);
}
for (let i = 0; i < Math.min(NP, jobs.length); i++) {
  const w = cp.fork(__filename, ['--child'], { execArgv: ['--max-old-space-size=1500'] });
  w.on('message', (r) => { if (r.err) console.log('ERR', r.err.split('\n')[0]); meta[r.id].quick.push(r.play); if (++doneJobs === jobs.length) report(); give(w); });
  give(w);
}
function report() {
  const by = new Map();
  for (const r of new Set(meta)) { if (!by.has(r.lab)) by.set(r.lab, []); by.get(r.lab).push(r); }
  for (const [lab, rows] of by) {
    rows.sort((a, c) => a.d - c.d);
    const line = rows.map(r => { const q = Math.min(...r.quick.filter(x => x !== null)); r.q = q; r.sum = r.play + q; return `d${r.d}:${r.play}+${q}`; });
    const base = rows.find(r => r.d === 0);
    const bestR = rows.reduce((a, r) => (r.sum < a.sum ? r : a));
    const qs = rows.map(r => r.q), mean = qs.reduce((a, x) => a + x, 0) / qs.length, sd = Math.sqrt(qs.reduce((a, x) => a + (x - mean) ** 2, 0) / qs.length);
    console.log(`${lab} -> ${rows[0].next}: next-level quick sd ${sd.toFixed(0)} ticks; d0 sum ${base ? base.sum : '?'}, best d${bestR.d} sum ${bestR.sum} (${base ? bestR.sum - base.sum : '?'})`);
    console.log('   ' + line.join(' '));
  }
  console.log('wall', ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
