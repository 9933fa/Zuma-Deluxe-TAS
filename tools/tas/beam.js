// Beam search over shots for one level.
// Node = exact simulation state at a decision point (gun ready). Children = candidate shots (planner
// generated, aim predicted geometrically), "discard" (off-screen) and "wait". Children are simulated
// exactly up to the next decision point and ranked with a value function.
'use strict';
const Z = require('../../js/sim.js');
const B = require('./bot.js');

const DEF = {
  width: 24, beta: 18, betaShot: 60, gamma: 0.7, evalShots: 3, perColor: 10, maxDepth: 400, maxTicks: 3500, lambda: 3,
  waitTicks: 8, noise: 0.0, seed: 1, settle: 80, delays: null, delayTop: 3,
};

function countBalls(curves) { let n = 0; for (const C of curves) for (const S of C.segs) n += S.balls.length; return n; }

function runShots(R) { return R.n >= 3 ? 1 : 3 - R.n; }
function evaluate(game, P) {
  const b = game.board;
  if (b.mGameState === Z.ST_LEVELUP) return { v: 1e9 - b.levelTimes[b.levelTimes.length - 1] * 1000 - b.tr.quakeFrame, done: true };
  if (b.mGameState !== Z.ST_PLAYING) return { v: -1e9, dead: true };
  const curves = B.chainModel(game);
  const N = countBalls(curves);
  const need = Math.max(0, b.mScoreTarget - b.mScore);
  let clear = 0;
  for (const C of curves) for (const S of C.segs) for (const R of S.runs) clear += runShots(R);
  let best = 0, bestPlan = null;
  const plans = B.planCascades(curves, { maxShots: P.evalShots });
  for (const p of plans) {
    // runs consumed by the cascade
    let saved = 0;
    const runs = p.seg.runs, j = runs.indexOf(p.trigger);
    const lo = Math.max(0, j - (p.depth - 1)), hi = Math.min(runs.length - 1, j + (p.depth - 1));
    for (let k = lo; k <= hi; k++) saved += runShots(runs[k]);
    if (p.score >= need) {
      const tw = p.trigger.balls[0].wp;
      for (const C of curves) if (C.ci === p.ci) for (const S of C.segs) for (const R of S.runs) {
        if (S === p.seg && runs.indexOf(R) >= lo) continue;
        if (R.balls[R.balls.length - 1].wp < tw && R.balls[R.balls.length - 1].wp < p.push) saved += runShots(R);
      }
    }
    let g;
    if (P.fixDisc) {
      const trigShots = p.junction ? 0 : Math.max(1, 3 - p.trigger.n);
      const fixes = p.shots - trigShots;
      // fixes for outer layers can be shot while the inner layers pop (~70 ticks per layer)
      if (fixes > 3 * (p.depth - 1) + 1) continue;
      g = (Math.min(p.score, need) + P.betaShot * (saved - p.shots)) * Math.pow(P.gamma, trigShots) * Math.pow(P.fixDisc, fixes);
    } else g = (Math.min(p.score, need) + P.betaShot * (saved - p.shots)) * Math.pow(P.gamma, p.shots);
    if (g > best) { best = g; bestPlan = p; }
  }
  let front = 0;
  for (const cm of b.mCurveMgr) if (!cm.mBallList.empty()) front = Math.max(front, cm.mBallList.back().mWayPoint / cm.wp.n);
  let segs = 0;
  for (const C of curves) segs += Math.max(0, C.segs.length - 1);
  const v = (b.mScoreTarget - b.mLevelBeginScore - need) - P.betaShot * clear + best - (front > 0.8 ? (front - 0.8) * 3000 : 0) - (P.segPen || 0) * segs;
  return { v, curves, N, need, bestPlan };
}

function advanceToDecision(game, maxT) {
  for (let t = 0; t < maxT; t++) {
    if (game.board.mGameState !== Z.ST_PLAYING) return t;
    if (B.isDecision(game)) return t;
    game.tick(null);
  }
  return maxT;
}

function fireEv(m, swap) { const ev = [['m', m[0], m[1]]]; if (swap) ev.push(['r']); ev.push(['l']); return ev; }

// candidate actions for a node
function candidates(game, curves, P, rng, want) {
  const b = game.board, gun = b.gun;
  const cur = gun.mBullet.mType, nxt = gun.mNextBullet ? gun.mNextBullet.mType : -1;
  const proj = new B.Projection(game, 110);
  const out = [];
  const seenSlot = new Set();
  const colors = [[cur, false]];
  if (nxt >= 0 && nxt !== cur) colors.push([nxt, true]);
  const plans = B.planCascades(curves, { maxShots: P.candShots || 4 });
  plans.sort((a, c) => (c.score / (c.shots + 1)) - (a.score / (a.shots + 1)));
  for (const [col, swap] of colors) {
    const steps = [];
    // runs of this colour
    for (const C of curves) for (const S of C.segs) for (const R of S.runs) if (R.color === col) steps.push({ kind: 'add', run: R, color: col, pri: R.n >= 2 ? 0 : 1 });
    // planner fixes
    for (const p of plans.slice(0, 30)) for (const st of p.pre) if (st.kind === 'ins' && st.color === col) steps.push(Object.assign({ pri: 2 }, st));
    steps.sort((a, c) => a.pri - c.pri);
    let n = 0;
    for (const st of steps) {
      if (n >= P.perColor) break;
      const slots = B.stepSlots(st);
      const key = col + ':' + slots.map(s => s.join('-')).join(',');
      if (seenSlot.has(key)) continue;
      seenSlot.add(key);
      const sh = aimPredict(game, proj, swap, B.stepTargets(st), slots, 0);
      if (sh) { out.push({ ev: fireEv(sh, swap), desc: st.kind + col, swap, targets: B.stepTargets(st), slots }); n++; }
      if (P.delays && n <= P.delayTop) for (const d of P.delays) {
        const sd = aimPredict(game, proj, swap, B.stepTargets(st), slots, d);
        if (sd) out.push({ delay: d, ev: fireEv(sd, swap), desc: st.kind + col + '+' + d });
      }
    }
    // discard / coin
    const d = discardPredict(game, proj, swap, rng);
    if (d) out.push({ ev: fireEv(d.m, swap), desc: d.coin ? 'coin' + col : 'discard' + col, swap, dir: d.m });
  }
  if (P.timing && want && want.length) for (const c of out) timeCandidate(game, proj, c, want, P);
  if (!out.length || P.allowWait) out.push({ wait: P.waitTicks, desc: 'wait' });
  return out;
}

// choose the firing delay whose reloaded ball has the most wanted colour (RNG manipulation)
function timeCandidate(game, proj, c, want, P) {
  let best = null;
  const g = game.clone();
  for (let d = 0; d <= P.timing; d++) {
    if (d > 0) { g.tick(null); if (!B.isDecision(g)) break; }
    let ev = c.ev;
    if (d > 0) {
      if (c.slots) { const m = aimPredict(game, proj, c.swap, c.targets, c.slots, d); if (!m) continue; ev = fireEv(m, c.swap); }
      else if (c.dir) { const p = B.predictShot(game, proj, c.dir, c.swap, d); if (!(p.gone || p.coin)) continue; }
    }
    const h = g.clone();
    h.tick(ev);
    for (let k = 0; k < 8 && h.board.gun.mState !== Z.GS_RELOADING; k++) h.tick(null);
    const nb = h.board.gun.mNextBullet, col = nb ? nb.mType : -1;
    const rank = want.indexOf(col);
    const val = (rank < 0 ? 0 : 100 - 15 * rank) - d * (P.delayCost || 4);
    if (!best || val > best.val) best = { val, ev, d };
  }
  if (best) { c.ev = best.ev; c.delay = best.d; }
}

function aimPredict(game, proj, swap, targets, slots, delay) {
  const b = game.board;
  for (const off of [9, 4, 13, 1]) {
    for (const [id, side] of targets) {
      const m = B.aimAt(game, proj, id, side, off, delay);
      if (!m) continue;
      const p = B.predictShot(game, proj, m, swap, delay);
      if (p.hit === undefined) continue;
      const cm = b.mCurveMgr[p.ci];
      let hb = null;
      for (const x of cm.mBallList) if (x.mId === p.hit) { hb = x; break; }
      if (!hb) continue;
      const pv = hb.GetPrevBall(false), nx = hb.GetNextBall(false);
      const prev = p.front ? hb.mId : (pv ? pv.mId : 'x'), next = p.front ? (nx ? nx.mId : 'x') : hb.mId;
      if (slots.some(s => s[0] === prev && s[1] === next)) return m;
    }
  }
  return null;
}

function discardPredict(game, proj, swap, rng) {
  const gun = game.board.gun, cx = gun.mCenterX, cy = gun.mCenterY;
  const tre = game.board.mCurTreasure;
  if (tre) { const m = B.mouseFor(gun, tre.x + 15, tre.y + 15); const p = B.predictShot(game, proj, m, swap); if (p.coin) return { m, coin: true }; }
  const N = 60, o = rng() * Math.PI * 2;
  for (let k = 0; k < N; k++) {
    const a = o + k * 2 * Math.PI / N;
    const m = B.mouseFor(gun, cx + Math.cos(a) * 400, cy + Math.sin(a) * 400);
    const p = B.predictShot(game, proj, m, swap);
    if (p.gone) return { m };
    if (p.coin) return { m, coin: true };
  }
  return null;
}

function hashNode(game) {
  const b = game.board;
  let h = b.mScore + '|' + (b.gun.mBullet ? b.gun.mBullet.mType : '-') + (b.gun.mNextBullet ? b.gun.mNextBullet.mType : '-') + '|';
  for (const cm of b.mCurveMgr) { for (const x of cm.mBallList) h += x.mType + (x.mClearCount ? '*' : '') + (x.mCollidesWithNext ? '' : '_'); h += '/'; }
  return h;
}

// startGame: state at LevelBegin. Returns best {events, objective}
function beamLevel(startGame, opts) {
  const P = Object.assign({}, DEF, opts || {});
  const rng = B.mulberry(P.seed);
  const root = startGame.clone();
  const events = P.prefix ? P.prefix.map(e => [e[0], e[1]]) : [];
  let t = P.t0 || 0;
  if (root.board.mGameState === Z.ST_LEVELBEGIN) { events.push([0, [['l']]]); root.tick([['l']]); t = 1; }
  t += advanceToDecision(root, 400);
  let beam = [{ game: root, events, t, v: 0 }];
  let best = null;
  const lvl = root.board.mLevel;
  for (let depth = 0; depth < P.maxDepth && beam.length; depth++) {
    const children = [];
    const seen = new Set();
    for (const node of beam) {
      const ev0 = evaluate(node.game, P);
      if (!ev0.curves) continue;
      const want = [];
      if (ev0.bestPlan) { for (const st of ev0.bestPlan.pre) if (want.indexOf(st.color) < 0) want.push(st.color); if (ev0.bestPlan.trig && want.indexOf(ev0.bestPlan.trig.color) < 0) want.push(ev0.bestPlan.trig.color); }
      for (const c of candidates(node.game, ev0.curves, P, rng, want)) {
        const g = node.game.clone();
        const evs = node.events.slice();
        let t2 = node.t;
        if (c.wait) { for (let k = 0; k < c.wait; k++) { g.tick(null); t2++; } }
        else {
          if (c.delay) for (let k = 0; k < c.delay; k++) { g.tick(null); t2++; }
          evs.push([t2, c.ev]); g.tick(c.ev); t2++;
        }
        t2 += advanceToDecision(g, 300);
        let e;
        if (P.settle) {
          const sg = g.clone();
          let k = 0;
          for (; k < P.settle && sg.board.mGameState === Z.ST_PLAYING; k++) sg.tick(null);
          e = evaluate(sg, P);
          if (e.done) {
            // waiting from this node finishes the level
            const play = sg.board.levelTimes[sg.board.levelTimes.length - 1];
            const obj = play + sg.board.tr.quakeFrame;
            if (!best || obj < best.objective) best = { events: evs, objective: obj, playTicks: play, quake: sg.board.tr.quakeFrame, score: sg.board.mScore, targetAt: sg.board.targetReachedFrame };
            continue;
          }
        } else e = evaluate(g, P);
        if (e.dead) continue;
        const child = { game: g, events: evs, t: t2, v: e.v - P.lambda * t2 + (P.noise ? (rng() - 0.5) * P.noise : 0), desc: c.desc, done: e.done };
        if (e.done) {
          const obj = g.board.levelTimes[g.board.levelTimes.length - 1] + g.board.tr.quakeFrame;
          if (!best || obj < best.objective) best = { events: evs, objective: obj, playTicks: g.board.levelTimes[g.board.levelTimes.length - 1], quake: g.board.tr.quakeFrame, score: g.board.mScore, targetAt: g.board.targetReachedFrame };
          continue;
        }
        if (t2 > P.maxTicks) continue;
        const h = hashNode(g);
        if (seen.has(h)) continue;
        seen.add(h);
        children.push(child);
      }
    }
    // prune: nodes slower than the best found are useless
    children.sort((a, c) => c.v - a.v);
    beam = children.slice(0, P.width).filter(c => !best || c.t < best.playTicks);
    if (P.verbose) {
      const top = beam[0];
      if (top) console.log('depth', depth, 'beam', beam.length, 't', top.t, 'v', Math.round(top.v), 'score', top.game.board.mScore, 'balls', countBalls(B.chainModel(top.game)), top.desc, best ? 'best ' + best.objective : '');
    }
  }
  return best;
}

module.exports = { beamLevel, evaluate, DEF };

// ------------------------------------------------------------------------------------------ pilot method
// Greedy continuation (heuristic argmax each shot) to the end of the level. Returns full solution or null.
function greedyFinish(game, events, t, P, rng, maxTicks) {
  let g = game, evs = events, tt = t;
  for (let step = 0; step < 200; step++) {
    if (g.board.mGameState === Z.ST_LEVELUP) break;
    if (g.board.mGameState !== Z.ST_PLAYING || tt > maxTicks) return null;
    const e0 = evaluate(g, P);
    if (!e0.curves) return null;
    let bestC = null;
    for (const c of candidates(g, e0.curves, P, rng)) {
      const h = g.clone();
      const ev2 = evs.slice();
      let t2 = tt;
      if (c.wait) { for (let k = 0; k < c.wait; k++) { h.tick(null); t2++; } }
      else { evs !== null; ev2.push([t2, c.ev]); h.tick(c.ev); t2++; }
      t2 += advanceToDecision(h, 300);
      let e;
      if (P.pilotSettle) { const sg = h.clone(); for (let k = 0; k < P.pilotSettle && sg.board.mGameState === Z.ST_PLAYING; k++) sg.tick(null); e = evaluate(sg, P); if (e.done) e.v += 1e6; }
      else e = evaluate(h, P);
      if (e.dead) continue;
      if (!bestC || e.v > bestC.v) bestC = { g: h, evs: ev2, t: t2, v: e.v };
    }
    if (!bestC) return null;
    g = bestC.g; evs = bestC.evs; tt = bestC.t;
  }
  // let pending cascades finish
  for (let k = 0; k < 600 && g.board.mGameState === Z.ST_PLAYING; k++) g.tick(null);
  const b = g.board;
  if (b.mGameState !== Z.ST_LEVELUP) return null;
  const play = b.levelTimes[b.levelTimes.length - 1];
  return { events: evs, objective: play + b.tr.quakeFrame, playTicks: play, quake: b.tr.quakeFrame, score: b.mScore, targetAt: b.targetReachedFrame };
}

function pilotLevel(startGame, opts) {
  const P = Object.assign({}, DEF, { width: 8, pilots: 3, pilotSettle: 40, perColor: 6 }, opts || {});
  const rng = B.mulberry(P.seed);
  const root = startGame.clone();
  const events = P.prefix ? P.prefix.map(e => [e[0], e[1]]) : [];
  let t = P.t0 || 0;
  if (root.board.mGameState === Z.ST_LEVELBEGIN) { events.push([0, [['l']]]); root.tick([['l']]); t = 1; }
  t += advanceToDecision(root, 400);
  let best = greedyFinish(root.clone(), events.slice(), t, P, rng, P.maxTicks);
  let beam = [{ game: root, events, t, score: best ? best.objective : 1e9 }];
  for (let depth = 0; depth < P.maxDepth && beam.length; depth++) {
    const children = [];
    const seen = new Set();
    for (const node of beam) {
      const e0 = evaluate(node.game, P);
      if (!e0.curves) continue;
      const kids = [];
      for (const c of candidates(node.game, e0.curves, P, rng)) {
        const g = node.game.clone();
        const evs = node.events.slice();
        let t2 = node.t;
        if (c.wait) { for (let k = 0; k < c.wait; k++) { g.tick(null); t2++; } }
        else { evs.push([t2, c.ev]); g.tick(c.ev); t2++; }
        t2 += advanceToDecision(g, 300);
        if (g.board.mGameState === Z.ST_LEVELUP) {
          const b = g.board, play = b.levelTimes[b.levelTimes.length - 1], obj = play + b.tr.quakeFrame;
          if (!best || obj < best.objective) best = { events: evs, objective: obj, playTicks: play, quake: b.tr.quakeFrame, score: b.mScore, targetAt: b.targetReachedFrame };
          continue;
        }
        if (g.board.mGameState !== Z.ST_PLAYING || t2 > P.maxTicks) continue;
        const h = hashNode(g);
        if (seen.has(h)) continue;
        seen.add(h);
        const sg = g.clone(); for (let k = 0; k < P.settle && sg.board.mGameState === Z.ST_PLAYING; k++) sg.tick(null);
        const e = evaluate(sg, P);
        kids.push({ game: g, events: evs, t: t2, v: e.v });
      }
      kids.sort((a, c) => c.v - a.v);
      for (const k of kids.slice(0, P.pilots)) {
        const r = greedyFinish(k.game.clone(), k.events.slice(), k.t, P, rng, best ? Math.min(P.maxTicks, best.playTicks) : P.maxTicks);
        k.score = r ? r.objective : 1e9 - k.v;
        if (r && (!best || r.objective < best.objective)) best = r;
        children.push(k);
      }
    }
    children.sort((a, c) => a.score - c.score);
    beam = children.slice(0, P.width).filter(c => c.score < 1e9 - 1e6 || children.length < P.width);
    if (P.verbose) console.log('depth', depth, 'beam', beam.length, 't', beam[0] && beam[0].t, 'bestPilot', beam[0] && beam[0].score, 'best', best && best.objective);
    if (!beam.length) break;
  }
  return best;
}
module.exports.pilotLevel = pilotLevel;
module.exports.greedyFinish = greedyFinish;
