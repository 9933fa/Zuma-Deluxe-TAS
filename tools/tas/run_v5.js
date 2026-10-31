// Full-game TAS driver v5 (search: tools/tas/v4.js). Same per-level ensemble as run_v4, but the cross-level
// choice uses full-power lookahead: the top M distinct solutions are first ranked by a quick next-level search,
// then the best F of them each get the whole ensemble on the next level, and the pick is
// min(level + best next level found). The chosen candidate's next-level results are carried over, so they
// become that level's ensemble and no search is thrown away.
// usage: node tools/tas/run_v5.js <seed> <workers> <M> <tag> <width> <quickWidth> <F> <ensemble>
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
require('../../js/gamedata.js'); require('../../js/font.js');
const Z = require('../../js/sim.js');
const { replay } = require('./replay.js');

const ROOT = path.join(__dirname, '..', '..'), OUT = path.join(ROOT, 'tas');
const seed = +(process.argv[2] || 24), NW = +(process.argv[3] || 128), M = +(process.argv[4] || 16), TAG = process.argv[5] || '_v5';
const W = +(process.argv[6] || 64), QW = +(process.argv[7] || 8), FW = +(process.argv[8] || 4), NE = +(process.argv[9] || 32);
const MAXLV = +(process.env.MAXLV || 1e9);   // stop after this many levels (smoke tests)
// final-shot delay variants: the final shot of the best FDC candidates is also tried FD ticks later (re-aimed at
// the same slot). The level often ends at the same tick anyway, but the RNG the next level starts from differs.
const FD = +(process.env.FD || 0), FDC = +(process.env.FDC || 6), VMAX = +(process.env.VMAX || 40);
const PROG = path.join(OUT, 'progress_' + seed + TAG + '.json');
const WR = require('./wr.json');

const BASE = { maxDelay: 6, colorPen: 1.5, coarse: 4 };
const VAR = [{ alpha: 1.5, K: 20, settle: 90, colorPen: 2 }, { alpha: 1.5, K: 20, settle: 90 }, { alpha: 1.5, colorPen: 2, settle: 90 }, { alpha: 1.5, K: 20, colorPen: 2 }, { alpha: 1.5, K: 20 }, {}, { colorPen: 2 }, { settle: 90 }, { K: 20 }, { alpha: 1.5 }, { alpha: 1.25 }, { mu: 60 }];
const ENSEMBLE = [];
for (let k = 0; k < NE; k++) ENSEMBLE.push(Object.assign({}, BASE, VAR[k % VAR.length], { width: W, noise: k < VAR.length ? 0 : 30, seed: 1 + k }));
const QUICK = [0, 1, 2, 3, 4].map(k => Object.assign({}, BASE, { width: QW, noise: k ? 30 : 0, seed: 100 + k }));

class Pool {
  constructor(n) { this.workers = []; for (let i = 0; i < n; i++) this.workers.push(cp.fork(path.join(__dirname, 'worker4.js'), [], { execArgv: ['--max-old-space-size=1500'] })); }
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

// apply a level solution + minimal transition inputs to a clone of g (at LevelBegin) (same as run_v4)
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

// variants of a level solution with its final shot delayed by 1..FD ticks; each is simulated to the level end
function finalShotVariants(g0, sol) {
  const V = require('./v4.js'), B = require('./bot.js');
  const evs = sol.events, k = evs.length - 1;
  if (k < 0 || !evs[k][1].some(x => x[0] === 'l')) return [];
  const T = evs[k][0];
  const g = g0.clone();
  let i = 0;
  for (let t = 0; t < T; t++) { let ev = null; if (i < k && evs[i][0] === t) { ev = evs[i][1]; i++; } g.tick(ev); }
  if (g.board.mGameState !== Z.ST_PLAYING || !B.isDecision(g)) return [];
  const mv = evs[k][1].find(x => x[0] === 'm') || ['m', g.board.lastMouse[0], g.board.lastMouse[1]];
  const swap = evs[k][1].some(x => x[0] === 'r');
  const o0 = V.trace(g, new V.Proj(g, 160), [mv[1], mv[2]]);
  const out = [];
  const gd = g.clone();
  for (let d = 1; d <= FD; d++) {
    gd.tick(null);
    if (gd.board.mGameState !== Z.ST_PLAYING) break;
    if (!B.isDecision(gd)) continue;
    const hit = V.sweep(gd, new V.Proj(gd, 160), 1, 4).filter(q => q.o.kind === o0.kind && (o0.kind !== 'hit' || (q.o.ci === o0.ci && q.o.prev === o0.prev && q.o.next === o0.next)));
    if (!hit.length) continue;
    hit.sort((a, c) => c.width - a.width);
    const ev = [['m', hit[0].mouse[0], hit[0].mouse[1]]]; if (swap) ev.push(['r']); ev.push(['l']);
    const gf = gd.clone(), b = gf.board;
    gf.tick(ev);
    for (let n = 0; n < 4000 && b.mGameState === Z.ST_PLAYING; n++) gf.tick(null);
    if (b.mGameState !== Z.ST_LEVELUP) continue;
    const play = b.levelTimes[b.levelTimes.length - 1];
    out.push({ events: evs.slice(0, k).concat([[T + d, ev]]), objective: play, playTicks: play, quake: b.tr.quakeFrame, score: b.mScore, targetAt: b.targetReachedFrame, variant: d });
  }
  return out;
}
// what the next level depends on: the run RNG state and the score
function nextSig(game) {
  const r = game.appRand;
  let h = 2166136261;
  for (let i = 0; i < 624; i++) h = Math.imul(h ^ r.mt[i], 16777619) >>> 0;
  return r.mti + ':' + h + ':' + game.board.mScore + ':' + game.board.mLives;
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
    note: 'Claude TAS v5 · v4 search ensemble + full-power cross-level lookahead (quick filter M -> F, whole ensemble on the next level, results carried over)' };
  fs.writeFileSync(path.join(OUT, 'movie' + TAG + '.js'), 'window.TAS_MOVIE = ' + JSON.stringify(movie) + ';\n');
}

const best = (rs) => rs.reduce((a, r) => (r && (!a || r.objective < a.objective) ? r : a), null);
function collect(rr, label) {
  const out = [];
  for (const r of rr) { if (r.ok && r.res) out.push(r.res); else if (!r.ok) console.log('worker error', label, r.err.split('\n')[0]); }
  return out;
}

async function main() {
  const P = loadProgress();
  const pool = new Pool(NW);
  console.log('v5 seed', seed, 'workers', NW, 'M', M, 'F', FW, 'ensemble', NE, 'width', W, 'quick', QW, 'final-shot delays', FD, 'x', FDC, 'resume at level', P.levels.length);
  let g = replay(P.seed, P.events, P.upto);
  while (!P.done && P.levels.length < MAXLV) {
    const b = g.board;
    if (b.mGameState !== Z.ST_LEVELBEGIN) throw new Error('not at level begin');
    const t0 = Date.now();
    const label = (b.mLevelDesc.mStage + 1) + '-' + (b.mLevelDesc.mLevel + 1);
    // 1. this level's ensemble: carried over from the previous lookahead, or searched now
    let cands = P.carry;
    if (!cands || !cands.length) {
      cands = collect(await pool.runAll(ENSEMBLE.map(cfg => ({ seed: P.seed, events: P.events, upto: P.upto, cfg }))), label);
    }
    const seen = new Set();
    cands = cands.slice().sort((a, c) => a.objective - c.objective)
      .filter(c => { const k = c.objective + ':' + c.events.length + ':' + c.events[c.events.length - 1][0]; if (seen.has(k)) return false; seen.add(k); return true; });
    if (!cands.length) throw new Error('no solution for ' + label);
    let pool0 = cands.slice(0, M), nvar = 0;
    if (FD > 0) cands.slice(0, FDC).forEach((c, ci) => { for (const v of finalShotVariants(g, c)) { v.from = ci; pool0.push(v); nvar++; } });
    // distinct by what the next level starts from (lowest objective wins, originals before variants on ties)
    let ap = pool0.map(c => ({ c, a: applySolution(g, P.upto, c) }));
    ap.sort((x, y) => x.c.objective - y.c.objective || (x.c.variant ? 1 : 0) - (y.c.variant ? 1 : 0));
    const sigs = new Set();
    ap = ap.filter(x => { if (x.a.done) return true; const s = nextSig(x.a.game); if (sigs.has(s)) return false; sigs.add(s); return true; }).slice(0, M + (FD > 0 ? VMAX : 0));
    const top = ap.map(x => x.c), applied = ap.map(x => x.a);
    const tagOf = (c) => c.variant ? `v${c.from}d${c.variant}` : '';
    let choice = 0, info = '', carry = null;
    if (!applied[0].done && top.length > 1) {
      // 2. quick next-level search for all M candidates
      const qm = [];
      applied.forEach((a, ci) => { const evs = P.events.concat(a.events); for (const q of QUICK) qm.push({ seed: P.seed, events: evs, upto: a.upto, cfg: q, ci }); });
      const qr = await pool.runAll(qm);
      const quick = top.map(() => []);
      qr.forEach((r, k) => { if (r.ok && r.res) quick[qm[k].ci].push(r.res); });
      const qsum = top.map((c, ci) => c.objective + (best(quick[ci]) ? best(quick[ci]).objective : 5000));
      // 3. full ensemble on the next level for the best F by the quick estimate
      const order = top.map((c, ci) => ci).sort((a, c) => qsum[a] - qsum[c]).slice(0, FW);
      const fm = [];
      for (const ci of order) { const evs = P.events.concat(applied[ci].events); for (const cfg of ENSEMBLE) fm.push({ seed: P.seed, events: evs, upto: applied[ci].upto, cfg, ci }); }
      const fr = await pool.runAll(fm);
      const full = new Map(order.map(ci => [ci, []]));
      fr.forEach((r, k) => { if (r.ok && r.res) full.get(fm[k].ci).push(r.res); else if (!r.ok) console.log('worker error', label, r.err.split('\n')[0]); });
      let bestSum = Infinity;
      const parts = [];
      for (const ci of order) {
        const nb = best(full.get(ci).concat(quick[ci]));
        const s = top[ci].objective + (nb ? nb.objective : 5000);
        parts.push(`${ci}${tagOf(top[ci])}:${top[ci].objective}+${nb ? nb.objective : '?'}(q${best(quick[ci]) ? best(quick[ci]).objective : '?'})`);
        if (s < bestSum) { bestSum = s; choice = ci; }
      }
      info = (FD > 0 ? `n${top.length} var${nvar} ` : '') + parts.join(' ');
      carry = full.get(choice).concat(quick[choice]);
    }
    const A = applied[choice];
    for (const e of A.events) P.events.push(e);
    P.upto = A.upto; P.reveals += A.reveals;
    P.levels.push(A.lv);
    P.carry = carry;
    if (A.done) { P.done = true; P.finalTick = A.finalTick; P.carry = null; }
    g = A.game;
    save(P);
    const tot = P.levels.reduce((a, L) => a + L.playTicks, 0);
    console.log(`${label.padEnd(6)} play ${(A.lv.playTicks / 100).toFixed(2)}s  WR ${A.lv.wr || '-'}  pick ${choice} [${info}]  ${((Date.now() - t0) / 1000).toFixed(0)}s  sum ${(tot / 100).toFixed(2)}s`);
  }
  pool.close();
  const playTot = P.levels.reduce((a, L) => a + L.playTicks, 0);
  console.log((P.done ? 'DONE.' : 'STOP.') + ' levels', P.levels.length, 'play total', (playTot / 100).toFixed(2), 's');
}
main().catch(e => { console.error(e); process.exit(1); });
