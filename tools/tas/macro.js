// Macro-action TAS search: commit to a cascade plan, execute it (setup shots, trigger, extend the
// running cascade with outer-layer fixes), then choose the next plan. Plans at each macro decision
// point are compared by rolling the level out to the end (nested rollouts).
'use strict';
const Z = require('../../js/sim.js');
const B = require('./bot.js');

const DEF = { K: 8, maxShots: 7, maxTicks: 3200, perLayer: 2, verify: 3, seed: 1, temp: 0, betaBall: 60, rolloutTemp: 0, maxDelay: 8, delayCost: 3 };

function countSegBalls(curves) { let n = 0; for (const C of curves) for (const S of C.segs) n += S.balls.length; return n; }

function planStats(p) {
  const trigShots = p.junction ? 0 : Math.max(1, 3 - p.trigger.n);
  return { trigShots, fixes: p.shots - trigShots };
}

// rough benefit per tick of a plan (used for greedy choice and for ranking the K candidates)
function planRate(game, curves, p, P) {
  const b = game.board, need = Math.max(0, b.mScoreTarget - b.mScore);
  const { trigShots, fixes } = planStats(p);
  let out = 0;
  if (p.score >= need) {
    const tw = p.trigger.balls[0].wp;
    for (const C of curves) if (C.ci === p.ci) for (const S of C.segs) for (const x of S.balls) if (x.wp < tw && x.wp < p.push) out++;
  }
  const benefit = Math.min(p.score, need) + P.betaBall * (p.balls + out);
  const extra = Math.max(0, fixes - P.perLayer * Math.max(0, p.depth - 1));
  const T = (trigShots + extra) * 21 + 40 + p.depth * 70;
  return benefit / T;
}

class Executor {
  constructor(plan, P) {
    this.trigIds = new Set(plan.trigger.balls.map(x => x.id));
    this.depth = plan.depth; this.ci = plan.ci; this.P = P;
    this.triggered = !!plan.junction; this.done = false; this.idle = 0;
  }
  current(plans) {
    let best = null;
    if (!this.triggered) {
      for (const p of plans) {
        if (p.junction || p.ci !== this.ci || !p.trig) continue;
        if (!p.trigger.balls.some(x => this.trigIds.has(x.id))) continue;
        if (p.depth < this.depth) continue;
        if (!best || p.shots < best.shots || (p.shots === best.shots && p.score > best.score)) best = p;
      }
      if (!best) {   // structure changed: accept a shallower version
        for (const p of plans) {
          if (p.junction || p.ci !== this.ci || !p.trig) continue;
          if (!p.trigger.balls.some(x => this.trigIds.has(x.id))) continue;
          if (!best || p.depth > best.depth || (p.depth === best.depth && p.shots < best.shots)) best = p;
        }
        if (best) this.depth = best.depth;
      }
    } else {
      for (const p of plans) {
        if (!p.junction || p.ci !== this.ci) continue;
        if (!best || p.depth > best.depth || (p.depth === best.depth && p.shots < best.shots)) best = p;
      }
    }
    return best;
  }
  triggerAllowed(p) {
    // layer-1 fixes before the trigger; outer layers may still be fixed while the inner ones pop
    const cnt = new Map();
    for (const st of p.pre) cnt.set(st.layer, (cnt.get(st.layer) || 0) + 1);
    let acc = 0;
    const layers = Array.from(cnt.keys()).sort((a, c) => a - c);
    for (const L of layers) {
      if (L <= 1) return false;
      acc += cnt.get(L);
      if (acc > this.P.perLayer * (L - 1)) return false;
    }
    return true;
  }
}

function fireEv(m, swap) { const ev = [['m', m[0], m[1]]]; if (swap) ev.push(['r']); ev.push(['l']); return ev; }

// one decision of the macro policy. Returns {ev} or null (do nothing this tick)
function decide(game, st, P, rng) {
  const r = decide0(game, st, P, rng);
  if (P.trace) {
    const C = 'BYRGPW', b = game.board, ex = st.exec, pl = st.lastPlan;
    console.log(b.mStateCount, 'sc', b.mScore - b.mLevelBeginScore, 'gun', C[b.gun.mBullet.mType] + (b.gun.mNextBullet ? C[b.gun.mNextBullet.mType] : '-'),
      ex ? ('plan d' + ex.depth + (ex.triggered ? ' TRIG' : '')) : 'noplan', pl ? 'cur d' + pl.depth + ' s' + pl.shots + ' pre[' + pl.pre.map(x => x.kind + C[x.color] + x.layer).join(',') + '] trig ' + (pl.trig ? C[pl.trig.color] : '-') : '',
      r ? (r.what || 'shot') + ' ' + JSON.stringify(r.ev) : 'none');
    const cv = B.chainModel(game);
    console.log('     ', cv.map(c => c.segs.map(s => s.runs.map(x => C[x.color] + x.n).join('')).join(' | ')).join(' || '));
  }
  return r;
}
function decide0(game, st, P, rng) {
  const b = game.board, gun = b.gun;
  const cur = gun.mBullet.mType, nxt = gun.mNextBullet ? gun.mNextBullet.mType : -1;
  // plan on the board as it will be once our in-flight shots have landed
  let pg = game;
  const inFlight = (g) => { const bb = g.board; if (bb.mBulletList.length) return true; for (const cm of bb.mCurveMgr) if (cm.mBulletList.length) return true; return g.board.gun.mState === Z.GS_FIRING; };
  if (inFlight(game)) { pg = game.clone(); for (let k = 0; k < 90 && inFlight(pg) && pg.board.mGameState === Z.ST_PLAYING; k++) pg.tick(null); }
  const curves = B.chainModel(pg);
  if (countSegBalls(curves) === 0) return null;
  const plans = B.planCascades(curves, { maxShots: P.maxShots });
  const proj = new B.Projection(game, 110);
  const need = Math.max(0, b.mScoreTarget - b.mScore);
  // choose / continue a macro
  let plan = st.exec ? st.exec.current(plans) : null;
  if (st.exec && !plan) {
    // cascade finished (or plan vanished)
    let busy = false;
    for (const cm of b.mCurveMgr) for (const x of cm.mBallList) if (x.mClearCount > 0 || x.mSuckCount > 0) busy = true;
    if (st.exec.trigTick !== undefined && st.t - st.exec.trigTick < 110) busy = true;
    else busy = false;   // cascade cannot be extended any more: start the next macro right away
    if (busy && st.exec.triggered) plan = null; else { st.macroEnds.push(st.t); st.exec = null; }
  }
  if (!st.exec) {
    const cands = [];
    for (const p of plans) { if (!p.trig || p.junction) continue; cands.push({ p, r: planRate(game, curves, p, P) }); }
    cands.sort((a, c) => c.r - a.r);
    if (!cands.length) return null;
    let pick = 0;
    if (st.forced !== undefined && st.forced !== null) { pick = Math.min(st.forced, cands.length - 1); st.forced = null; }
    else if (P.rolloutTemp > 0) { while (pick < cands.length - 1 && rng() < P.rolloutTemp) pick++; }
    st.exec = new Executor(cands[pick].p, P);
    st.macroStarts.push(st.t);
    st.lastCands = cands.length;
    plan = st.exec.current(plans) || cands[pick].p;
  }
  const ex = st.exec;
  st.lastPlan = plan;
  // coin
  if (b.mCurTreasure && need > 0) {
    const tre = b.mCurTreasure;
    const needed = new Set(plan ? plan.pre.map(s => s.color).concat(plan.trig ? [plan.trig.color] : []) : []);
    for (const sw of [false, true]) {
      const col = sw ? nxt : cur;
      if (col < 0 || (needed.has(col) && !(sw ? needed.has(cur) : needed.has(nxt)))) continue;
      const m = B.mouseFor(gun, tre.x + 15, tre.y + 15);
      const pr = B.predictShot(game, proj, m, sw);
      if (pr.coin) { const r = B.simShot(game, m, sw, 200); if (r.fired && r.coin) return { ev: fireEv(m, sw) }; }
    }
  }
  if (plan) {
    // setup / extension shots, innermost layer first
    const pre = plan.pre.slice().sort((a, c) => a.layer - c.layer);
    const tryStep = (step, swap) => B.findShot2(game, proj, swap, B.stepTargets(step), B.stepSlots(step), rng, P.verify);
    if (!ex.triggered && plan.trig && ex.triggerAllowed(plan)) {
      for (const [col, sw] of [[cur, false], [nxt, true]]) {
        if (col !== plan.trig.color) continue;
        const s = tryStep(plan.trig, sw);
        if (s) { ex.triggered = true; ex.trigTick = st.t; const stp = plan.trig; return { ev: fireEv(s.mouse, sw), what: 'TRIGGER', redo: (g2) => redoStep(g2, stp, sw, P, rng), want: wantList(plan, true) }; }
      }
    }
    for (const step of pre) {
      for (const [col, sw] of [[cur, false], [nxt, true]]) {
        if (col !== step.color) continue;
        const s = tryStep(step, sw);
        if (s) return { ev: fireEv(s.mouse, sw), what: 'step' + step.kind + step.layer, redo: (g2) => redoStep(g2, step, sw, P, rng), want: wantList(plan, ex.triggered) };
      }
    }
  }
  // nothing useful: get rid of the colour we need least
  const want = new Set();
  if (plan) { for (const s of plan.pre) want.add(s.color); if (plan.trig && !ex.triggered) want.add(plan.trig.color); }
  const swap = want.has(cur) && !want.has(nxt) && nxt >= 0;
  if (ex && ex.triggered && !plan && st.exec) return null;   // let the cascade play out
  const d = B.findDiscard2(game, proj, swap, rng);
  if (d) return { ev: fireEv(d.mouse, swap), what: 'discard', redo: (g2) => { const r2 = B.simShot(g2, d.mouse, swap, 200); return r2.fired && !r2.landed && r2.gone ? fireEv(d.mouse, swap) : null; }, want: plan ? wantList(plan, ex.triggered) : [] };
  // no free direction: put it next to its own colour somewhere outside the plan
  const col = swap ? nxt : cur;
  const inPlan = new Set();
  if (plan) { const R = plan.seg.runs, j = R.indexOf(plan.trigger); for (let k = Math.max(0, j - plan.depth); k <= Math.min(R.length - 1, j + plan.depth); k++) for (const x of R[k].balls) inPlan.add(x.id); }
  for (const C of curves) for (const S of C.segs) for (const R of S.runs) {
    if (R.color !== col || R.balls.some(x => inPlan.has(x.id))) continue;
    const step = { kind: 'add', run: R, color: col };
    const s = B.findShot2(game, proj, swap, B.stepTargets(step), B.stepSlots(step), rng, 2);
    if (s) return { ev: fireEv(s.mouse, swap), what: 'dump' };
  }
  st.idle++;
  return null;
}

function redoStep(g2, step, swap, P, rng) {
  const pr = new B.Projection(g2, 110);
  const s = B.findShot2(g2, pr, swap, B.stepTargets(step), B.stepSlots(step), rng, P.verify);
  return s ? fireEv(s.mouse, swap) : null;
}
function wantList(plan, triggered) {
  const out = [];
  for (const s of plan.pre.slice().sort((a, c) => a.layer - c.layer)) if (out.indexOf(s.color) < 0) out.push(s.color);
  if (!triggered && plan.trig && out.indexOf(plan.trig.color) < 0) out.push(plan.trig.color);
  return out;
}
// RNG manipulation: the colour loaded after a shot depends on the exact firing tick. Try delays and keep
// the one whose new ball is the most wanted colour.
function timeShot(game, r, P) {
  if (!P.maxDelay || !r.redo || !r.want || !r.want.length) return { ev: r.ev, delay: 0 };
  let best = null;
  const g = game.clone();
  for (let d = 0; d <= P.maxDelay; d++) {
    if (d > 0) { g.tick(null); if (!B.isDecision(g)) break; }
    const ev = d === 0 ? r.ev : r.redo(g);
    if (!ev) continue;
    const c = g.clone();
    c.tick(ev);
    for (let k = 0; k < 8 && c.board.gun.mState !== Z.GS_RELOADING; k++) c.tick(null);
    const nb = c.board.gun.mNextBullet;
    const col = nb ? nb.mType : -1;
    const rank = r.want.indexOf(col);
    const sc = rank < 0 ? 0 : 100 - rank * 10;
    const val = sc - d * P.delayCost;
    if (!best || val > best.val) best = { val, ev, delay: d };
    if (rank === 0 && d === 0) break;
  }
  return best || { ev: r.ev, delay: 0 };
}

// play from `game` (a decision-capable state) to the end of the level with the macro policy.
// forcedFirst: index of the plan to use for the first macro decision.
function rollout(game, events, t0, P, rng, forcedFirst, limitPlay) {
  const g = game.clone();
  const st = { exec: null, t: t0, macroStarts: [], macroEnds: [], forced: forcedFirst, idle: 0, pending: null };
  const evs = events.slice();
  const b = g.board;
  let t = t0;
  if (b.mGameState === Z.ST_LEVELBEGIN) { evs.push([t, [['l']]]); g.tick([['l']]); t++; }
  while (t < P.maxTicks && b.mGameState === Z.ST_PLAYING) {
    if (limitPlay && b.mStateCount > limitPlay) return { fail: true, t, st };
    let ev = null;
    if (st.pending) { if (t >= st.pending.at) { ev = st.pending.ev; st.pending = null; } }
    else if (B.isDecision(g)) {
      st.t = t;
      const d = decide(g, st, P, rng);
      if (d) {
        const tm = timeShot(g, d, P);
        if (tm.delay === 0) ev = tm.ev; else st.pending = { at: t + tm.delay, ev: tm.ev };
      }
    }
    if (ev) evs.push([t, ev]);
    g.tick(ev);
    t++;
  }
  if (b.mGameState !== Z.ST_LEVELUP) return { fail: true, t, st };
  const play = b.levelTimes[b.levelTimes.length - 1];
  return { events: evs, objective: play + b.tr.quakeFrame, playTicks: play, quake: b.tr.quakeFrame, score: b.mScore,
    targetAt: b.targetReachedFrame, macroStarts: st.macroStarts, t };
}

// nested search: at each macro decision point of the incumbent, try K alternative plans with rollouts
function macroLevel(startGame, opts) {
  const P = Object.assign({}, DEF, opts || {});
  const rng = B.mulberry(P.seed);
  let root = startGame.clone();
  let events = P.prefix ? P.prefix.map(e => [e[0], e[1]]) : [];
  let t = P.t0 || 0;
  if (root.board.mGameState === Z.ST_LEVELBEGIN) { events.push([t, [['l']]]); root.tick([['l']]); t++; }
  while (!B.isDecision(root) && root.board.mGameState === Z.ST_PLAYING) { root.tick(null); t++; }
  let best = null;
  const consider = (r) => { if (r && !r.fail && (!best || r.objective < best.objective)) { best = r; return true; } return false; };
  // walk forward over macro decision points
  for (let step = 0; step < 40; step++) {
    let localBest = null;
    for (let k = 0; k < P.K; k++) {
      const r = rollout(root, events, t, P, B.mulberry(P.seed * 977 + step * 131 + k), k, best ? best.playTicks : null);
      if (r && !r.fail && (!localBest || r.objective < localBest.objective)) localBest = r;
      consider(r);
    }
    if (P.verbose) console.log('macro step', step, 't', t, 'local', localBest && localBest.objective, 'best', best && best.objective);
    if (!localBest || !best) break;
    // advance root along the best solution to its next macro start after the current one
    const next = best.macroStarts.find(x => x > t);
    if (next === undefined) break;
    let i = 0;
    const g = root.clone();
    // replay the best events from t to next
    const tail = best.events.filter(e => e[0] >= t && e[0] < next);
    for (let tt = t; tt < next; tt++) {
      let ev = null;
      if (i < tail.length && tail[i][0] === tt) { ev = tail[i][1]; i++; }
      g.tick(ev);
    }
    events = best.events.filter(e => e[0] < next);
    root = g; t = next;
    if (!B.isDecision(root)) break;
  }
  return best;
}

module.exports = { macroLevel, rollout, decide, DEF };
