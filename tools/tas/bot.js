// TAS policy for the faithful Zuma simulation.
// - Planner: finds palindromic cascade structures (runs merging outward from a trigger run) and the
//   minimal set of insertions (colour + slot) that make them cascade.
// - Aiming: predicts ball motion with a no-fire projection of the exact simulation, solves the intercept,
//   then verifies every shot by simulating it on a clone (only shots that land in the wanted slot are used).
// - Colour control: swap (free) and firing unwanted balls off-screen; small firing delays reroll the RNG.
'use strict';
const Z = require('../../js/sim.js');
const f32 = Math.fround;

// ------------------------------------------------------------------------------------------ helpers
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function isDecision(game) {
  const b = game.board;
  if (b.mGameState !== Z.ST_PLAYING || b.mPauseCount) return false;
  const gun = b.gun;
  if (gun.mState !== Z.GS_NORMAL || !gun.mBullet) return false;
  for (let i = 0; i < b.mNumCurves; i++) if (!b.mCurveMgr[i].CanFire()) return false;
  return true;
}

// angle the game computes for an integer mouse position (Board::MouseMove)
function mouseAngle(cx, cy, x, y) {
  const fx = x - cx;
  if (fx !== 0) {
    let v = f32(Math.atan(f32((cy - y) / fx)));
    if (fx < 0) v = f32(v + Z.SEXY_PI);
    return f32(v + Z.SEXY_PI / 2.0);
  }
  return y < cy ? Z.SEXY_PI : 0;
}
// bullet launch point (end of tongue phase) and per-tick velocity for an angle
function launch(gun, ang) {
  const cx = gun.mRecoilX1, cy = gun.mRecoilY1;
  const c = Math.cos(ang), s = Math.sin(ang);
  const ox = 1, oy = 10;
  const L = [cx + ox * c + oy * s, cy + oy * c - ox * s];
  const rad = ang - Math.PI / 2;
  const v = [Math.cos(rad) * gun.mFireVel, -Math.sin(rad) * gun.mFireVel];
  return { L, v };
}
// mouse point on screen in direction (dx,dy) from the gun centre, preferring the target point itself
function mouseFor(gun, tx, ty) {
  let x = Math.round(tx), y = Math.round(ty);
  if (x >= 0 && x < 640 && y >= 0 && y < 480 && Math.hypot(x - gun.mCenterX, y - gun.mCenterY) > 12) return [x, y];
  const dx = tx - gun.mCenterX, dy = ty - gun.mCenterY, d = Math.hypot(dx, dy) || 1;
  let r = d;
  for (; r > 12; r *= 0.9) { x = Math.round(gun.mCenterX + dx / d * r); y = Math.round(gun.mCenterY + dy / d * r); if (x >= 0 && x < 640 && y >= 0 && y < 480) break; }
  return [x, y];
}

// ------------------------------------------------------------------------------------------ projection
// Exact future positions of all balls if we do not fire (other in-flight shots / cascades included).
class Projection {
  constructor(game, H) {
    this.H = H;
    this.pos = new Map();      // id -> Float32Array(3*(H+1)) x,y,wp ; NaN when not on track
    this.curveOf = new Map();
    const c = game.clone();
    this.record(c, 0);
    for (let t = 1; t <= H; t++) {
      c.tick(null);
      if (c.board.mGameState !== Z.ST_PLAYING) { this.H = t - 1; break; }
      this.record(c, t);
    }
    this.end = c;
  }
  record(c, t) {
    const b = c.board;
    for (let ci = 0; ci < b.mNumCurves; ci++) {
      for (const ball of b.mCurveMgr[ci].mBallList) {
        let a = this.pos.get(ball.mId);
        if (!a) { a = new Float32Array(3 * (this.H + 1)).fill(NaN); this.pos.set(ball.mId, a); this.curveOf.set(ball.mId, ci); }
        a[3 * t] = ball.mx; a[3 * t + 1] = ball.my; a[3 * t + 2] = ball.mWayPoint;
      }
    }
  }
  at(id, t) {
    const a = this.pos.get(id);
    if (!a) return null;
    t = Math.max(0, Math.min(this.H, Math.round(t)));
    if (isNaN(a[3 * t])) { for (let k = t; k >= 0; k--) if (!isNaN(a[3 * k])) return [a[3 * k], a[3 * k + 1], a[3 * k + 2]]; return null; }
    return [a[3 * t], a[3 * t + 1], a[3 * t + 2]];
  }
}

// ------------------------------------------------------------------------------------------ chain model
function chainModel(game) {
  const b = game.board, curves = [];
  for (let ci = 0; ci < b.mNumCurves; ci++) {
    const cm = b.mCurveMgr[ci], wp = cm.wp;
    const all = cm.mBallList.toArray();
    // virtual chain: clearing balls removed; neighbours across a clearing group with equal colours will be
    // sucked together (active junction)
    const vb = [];
    let pendingClear = false, lastGapPhysical = false;
    for (let i = 0; i < all.length; i++) {
      const ball = all[i];
      if (ball.mClearCount > 0) { pendingClear = true; continue; }
      const prev = vb.length ? vb[vb.length - 1] : null;
      let join = 'none';
      if (prev) {
        const prevBall = all[i - 1];
        if (pendingClear) join = (prev.type === ball.mType) ? 'active' : 'wall';
        else if (prevBall.mCollidesWithNext) join = 'contact';
        else if (ball.mSuckCount > 0 && prev.type === ball.mType) join = 'active';
        else join = (ball.mWayPoint - prevBall.mWayPoint < 40) ? 'contact' : 'wall';
      }
      const pb = i > 0 ? all[i - 1] : null, nb = i + 1 < all.length ? all[i + 1] : null;
      vb.push({ id: ball.mId, type: ball.mType, wp: ball.mWayPoint, x: ball.mx, y: ball.my, tun: wp.InTunnelPt(Math.trunc(ball.mWayPoint)),
        join, ball, power: ball.GetPowerTypeWussy(), prevId: pb ? pb.mId : 'x', nextId: nb ? nb.mId : 'x' });
      pendingClear = false;
    }
    // segments + runs
    const segs = [];
    let seg = null;
    for (const v of vb) {
      if (!seg || v.join === 'wall') { seg = { runs: [], balls: [], junctions: [] }; segs.push(seg); }
      seg.balls.push(v);
      const R = seg.runs[seg.runs.length - 1];
      if (R && R.color === v.type && v.join !== 'active') { R.balls.push(v); R.n++; }
      else {
        if (R && v.join === 'active') {
          if (R.color === v.type) { R.balls.push(v); R.n++; seg.junctions.push(seg.runs.length - 1); continue; }
        }
        seg.runs.push({ color: v.type, n: 1, balls: [v] });
      }
    }
    curves.push({ ci, segs, all, cm });
  }
  return curves;
}

// ------------------------------------------------------------------------------------------ planner
// A step: {kind:'add', run} (ball of run.color touching the run) or {kind:'ins', a, b, color} (new run
// between adjacent runs a|b). Plans: {ci, seg, trigger, steps, depth, score, popped, push}
function planCascades(curves, opts) {
  const maxShots = opts.maxShots || 6, plans = [];
  for (const C of curves) {
    for (const S of C.segs) {
      const runs = S.runs, m = runs.length;
      const starts = [];
      for (let j = 0; j < m; j++) starts.push({ j, junction: false });
      for (const j of S.junctions) starts.push({ j, junction: true });
      for (const st of starts) {
        const j = st.j, R0 = runs[j];
        const pre = [];
        let trig = null, shots = 0;
        if (!st.junction) {
          const need = Math.max(1, 3 - R0.n);
          for (let k = 0; k < need - 1; k++) pre.push({ kind: 'add', run: R0, color: R0.color, layer: 0 });
          trig = { kind: 'add', run: R0, color: R0.color, trigger: true };
          shots = need;
        }
        const base = { ci: C.ci, seg: S, trigger: R0, junction: st.junction, pre, trig, shots, depth: 1, popped: [st.junction ? R0.n : Math.max(3, R0.n + 1)] };
        expand(base, runs, j - 1, j + 1, null, null, maxShots, plans, opts);
      }
    }
  }
  for (const p of plans) {
    let sc = 0, push = 0;
    for (let k = 0; k < p.depth; k++) { sc += 100 * k + 10 * p.popped[k]; if (k > 0) push += 45 * k; }
    p.score = sc; p.push = push;
    p.balls = p.popped.reduce((a, b) => a + b, 0);
  }
  return plans;
}
function expand(p, runs, l, r, lv, rv, maxShots, out, opts) {
  out.push(p);
  if (p.depth >= 18) return;
  const L = lv || (l >= 0 ? runs[l] : null), R = rv || (r < runs.length ? runs[r] : null);
  if (!L || !R) return;
  const nl = lv ? lv.n : L.n, nr = rv ? rv.n : R.n;
  const nextL = lv ? l : l - 1, nextR = rv ? r : r + 1;
  if (L.color === R.color) {
    const need = Math.max(0, 3 - (nl + nr));
    if (p.shots + need > maxShots) return;
    const pre = p.pre.slice();
    for (let k = 0; k < need; k++) pre.push({ kind: 'add', run: lv ? R : L, color: L.color, layer: p.depth });
    const q = Object.assign({}, p, { pre, shots: p.shots + need, depth: p.depth + 1, popped: p.popped.concat([nl + nr + need]) });
    expand(q, runs, nextL, nextR, null, null, maxShots, out, opts);
    return;
  }
  if (opts.noFix) return;
  for (const side of [0, 1]) {
    const col = side === 0 ? R.color : L.color, other = side === 0 ? nr : nl;
    const cnt = Math.max(1, 3 - other);
    if (p.shots + cnt > maxShots) continue;
    let a, b;
    if (side === 0) { if (lv) continue; a = L; b = runs[l + 1]; } else { if (rv) continue; a = runs[r - 1]; b = R; }
    if (!a || !b || a.color === col || b.color === col) continue;
    const pre = p.pre.slice();
    for (let k = 0; k < cnt; k++) pre.push({ kind: 'ins', a, b, color: col, side, layer: p.depth });
    const q = Object.assign({}, p, { pre, shots: p.shots + cnt, depth: p.depth + 1, popped: p.popped.concat([cnt + other]) });
    if (side === 0) expand(q, runs, l, nextR, null, null, maxShots, out, opts);
    else expand(q, runs, nextL, r, null, null, maxShots, out, opts);
  }
}

// acceptable landing slots for a step: list of [prevId, nextId] (null = chain end)
function stepSlots(step) {
  if (step.kind === 'add') {
    const B = step.run.balls, out = [];
    for (let i = 0; i < B.length; i++) {
      out.push([B[i].prevId, B[i].id]);
      out.push([B[i].id, B[i].nextId]);
    }
    return out;
  }
  const a = step.a.balls[step.a.balls.length - 1], b = step.b.balls[0];
  return [[a.id, b.id]];
}
// aim candidates for a step: [ballId, side(+1 front/-1 back)]
function stepTargets(step) {
  if (step.kind === 'add') {
    const B = step.run.balls, out = [];
    for (const v of B) { if (v.tun) continue; out.push([v.id, -1]); out.push([v.id, 1]); }
    return out;
  }
  const a = step.a.balls[step.a.balls.length - 1], b = step.b.balls[0];
  const out = [];
  if (!a.tun) out.push([a.id, 1]);
  if (!b.tun) out.push([b.id, -1]);
  return out;
}

// ------------------------------------------------------------------------------------------ shooting
// simulate a shot on a clone; returns landing info
function simShot(game, mouse, swap, maxT) {
  const c = game.clone();
  const gun = c.board.gun;
  const bid = (swap ? gun.mNextBullet : gun.mBullet).mId;
  const color = (swap ? gun.mNextBullet : gun.mBullet).mType;
  const ev = [['m', mouse[0], mouse[1]]];
  if (swap) ev.push(['r']);
  ev.push(['l']);
  const coins0 = c.stats.coins;
  c.tick(ev);
  if (!(c.board.gun.mState === Z.GS_FIRING)) return { fired: false };
  for (let t = 1; t < (maxT || 160); t++) {
    c.tick(null);
    const b = c.board;
    if (b.mGameState !== Z.ST_PLAYING) return { fired: true, landed: null, gone: true, t, color };
    let found = false;
    for (let ci = 0; ci < b.mNumCurves; ci++) {
      for (const bl of b.mCurveMgr[ci].mBulletList) {
        if (bl.mId === bid) {
          const h = bl.mHitBall;
          const prev = bl.mHitInFront ? h : h.GetPrevBall(false), next = bl.mHitInFront ? h.GetNextBall(false) : h;
          return { fired: true, landed: { ci, prev: prev ? prev.mId : 'x', next: next ? next.mId : 'x', hit: h.mId, front: bl.mHitInFront }, t, color };
        }
      }
    }
    if (b.mBulletList.some(x => x.mId === bid)) found = true;
    if (gun.mBullet && gun.mBullet.mId === bid) found = true;
    if (!found) return { fired: true, landed: null, gone: true, coin: c.stats.coins > coins0, t, color };
  }
  return { fired: true, landed: null, gone: false, color };
}

function aimAt(game, proj, ballId, side, off, delay) {
  delay = delay || 0;
  const gun = game.board.gun;
  const cv = game.board.mCurveMgr[proj.curveOf.get(ballId)];
  let t = 20, mouse = null;
  for (let it = 0; it < 5; it++) {
    const q = proj.at(ballId, t + delay);
    if (!q) return null;
    const i = Math.max(0, Math.min(cv.wp.n - 2, Math.trunc(q[2])));
    let dx = cv.wp.xs[i + 1] - cv.wp.xs[i], dy = cv.wp.ys[i + 1] - cv.wp.ys[i];
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const tx = q[0] + side * dx * off, ty = q[1] + side * dy * off;
    mouse = mouseFor(gun, tx, ty);
    const ang = mouseAngle(gun.mCenterX, gun.mCenterY, mouse[0], mouse[1]);
    const { L } = launch(gun, ang);
    const d = Math.hypot(tx - L[0], ty - L[1]);
    const nt = 2 + Math.max(0, d - 26) / gun.mFireVel;
    if (Math.abs(nt - t) < 0.5) break;
    t = nt;
  }
  return mouse;
}

// try to land a ball of the given colour in one of the acceptable slots
function findShot(game, proj, color, swap, targets, slots, rng, budget) {
  const okSlot = (L) => L && slots.some(s => s[0] === L.prev && s[1] === L.next);
  const offs = [9, 5, 13, 2, 16];
  const tried = new Set();
  let n = 0;
  const order = targets.slice();
  for (let i = order.length - 1; i > 0; i--) { const k = Math.floor(rng() * (i + 1)); [order[i], order[k]] = [order[k], order[i]]; }
  for (const off of offs) {
    for (const [id, side] of order) {
      if (n >= budget) return null;
      const m = aimAt(game, proj, id, side, off);
      if (!m) continue;
      const key = m[0] * 1000 + m[1];
      if (tried.has(key)) continue;
      tried.add(key);
      n++;
      const r = simShot(game, m, swap, 120);
      if (r.fired && okSlot(r.landed)) return { mouse: m, swap, res: r };
    }
  }
  return null;
}

// fire away harmlessly (off-screen, or into a coin)
function findDiscard(game, swap, rng, budget) {
  const gun = game.board.gun, cx = gun.mCenterX, cy = gun.mCenterY;
  const tre = game.board.mCurTreasure;
  const cands = [];
  if (tre) cands.push(mouseFor(gun, tre.x + 15, tre.y + 15));
  const N = 48, o = rng() * Math.PI * 2;
  for (let k = 0; k < N; k++) { const a = o + k * 2 * Math.PI / N; cands.push(mouseFor(gun, cx + Math.cos(a) * 400, cy + Math.sin(a) * 400)); }
  let n = 0;
  for (const m of cands) {
    if (n++ >= budget) break;
    const r = simShot(game, m, swap, 200);
    if (r.fired && !r.landed && r.gone) return { mouse: m, swap, res: r };
  }
  return null;
}

module.exports = { mulberry, isDecision, mouseAngle, launch, mouseFor, Projection, chainModel, planCascades, stepSlots, stepTargets,
  simShot, aimAt, findShot, findDiscard };

// ------------------------------------------------------------------------------------------ fast prediction
// Predict where a shot lands using the no-fire projection (exact until the bullet touches something).
// Returns {hit, front, t} or {gone:true} or {coin:true}.
function predictShot(game, proj, mouse, swap, delay) {
  delay = delay || 0;
  const b = game.board, gun = b.gun;
  const ang = mouseAngle(gun.mCenterX, gun.mCenterY, mouse[0], mouse[1]);
  const { L, v } = launch(gun, ang);
  const tre = b.mCurTreasure;
  const ids = predictShot.ids || (predictShot.ids = []);
  // candidate balls: those present in projection
  for (let t = 6; t < 400; t++) {
    const px = L[0] + v[0] * (t - 2), py = L[1] + v[1] * (t - 2);
    if (tre) { const dx = px - tre.x - 15, dy = py - tre.y - 15; if (dx * dx + dy * dy < 36 * 36) return { coin: true, t }; }
    if (!(px >= 0 && py >= 0 && px - 16 < 640 && py - 16 < 480)) return { gone: true, t };
    const pt = Math.min(proj.H, t - 1 + delay);
    let best = null;
    for (const [id, a] of proj.pos) {
      const x = a[3 * pt], y = a[3 * pt + 1];
      if (isNaN(x)) continue;
      const dx = x - px, dy = y - py;
      if (dx * dx + dy * dy < 1024) {
        const ci = proj.curveOf.get(id), cv = b.mCurveMgr[ci];
        const wp = a[3 * pt + 2];
        if (cv.wp.InTunnelPt(Math.trunc(wp))) continue;
        if (!best || ci < best.ci || (ci === best.ci && wp < best.wp)) best = { id, ci, wp, x, y };
      }
    }
    if (best) {
      const cv = b.mCurveMgr[best.ci];
      const i = Math.max(0, Math.min(cv.wp.n - 2, Math.trunc(best.wp)));
      const dx = cv.wp.xs[i + 1] - cv.wp.xs[i], dy = cv.wp.ys[i + 1] - cv.wp.ys[i];
      const front = (px - best.x) * dx + (py - best.y) * dy > 0;
      return { hit: best.id, ci: best.ci, front, t, wp: best.wp };
    }
  }
  return { gone: true, t: 400 };
}

// cheap discard search: geometric check first, then one verification
function findDiscard2(game, proj, swap, rng) {
  const gun = game.board.gun, cx = gun.mCenterX, cy = gun.mCenterY;
  const N = 72, o = rng() * Math.PI * 2;
  const cands = [];
  for (let k = 0; k < N; k++) {
    const a = o + k * 2 * Math.PI / N;
    const m = mouseFor(gun, cx + Math.cos(a) * 400, cy + Math.sin(a) * 400);
    const p = predictShot(game, proj, m, swap);
    if (p.gone || p.coin) cands.push({ m, p });
  }
  cands.sort((a, b) => (b.p.coin ? 1 : 0) - (a.p.coin ? 1 : 0) || a.p.t - b.p.t);
  for (const c of cands.slice(0, 3)) {
    const r = simShot(game, c.m, swap, 200);
    if (r.fired && !r.landed && r.gone) return { mouse: c.m, swap, res: r };
  }
  return null;
}

// find a shot landing in an accepted slot: geometric filter, then verification of the best few
function findShot2(game, proj, swap, targets, slots, rng, verifyMax) {
  const okPred = (p) => {
    if (!p || p.hit === undefined) return false;
    return true;
  };
  const cands = [];
  const seen = new Set();
  for (const [id, side] of targets) {
    for (const off of [9, 4, 13]) {
      const m = aimAt(game, proj, id, side, off);
      if (!m) continue;
      const key = m[0] * 1000 + m[1];
      if (seen.has(key)) continue;
      seen.add(key);
      const p = predictShot(game, proj, m, swap);
      if (!okPred(p)) continue;
      // predicted slot
      const cm = game.board.mCurveMgr[p.ci];
      let hb = null;
      for (const x of cm.mBallList) if (x.mId === p.hit) { hb = x; break; }
      let prev, next;
      if (hb) { const pv = hb.GetPrevBall(false), nx = hb.GetNextBall(false); prev = p.front ? hb.mId : (pv ? pv.mId : 'x'); next = p.front ? (nx ? nx.mId : 'x') : hb.mId; }
      const good = slots.some(s => s[0] === prev && s[1] === next);
      if (good) cands.push({ m, p, pri: p.t + rng() * 4 });
    }
  }
  cands.sort((a, b) => a.pri - b.pri);
  const okSlot = (L) => L && slots.some(s => s[0] === L.prev && s[1] === L.next);
  for (const c of cands.slice(0, verifyMax || 3)) {
    const r = simShot(game, c.m, swap, 120);
    if (r.fired && okSlot(r.landed)) return { mouse: c.m, swap, res: r };
  }
  return null;
}
module.exports.predictShot = predictShot;
module.exports.findDiscard2 = findDiscard2;
module.exports.findShot2 = findShot2;
