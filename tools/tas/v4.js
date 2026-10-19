// TAS search v4: exact aim sweep + time-based value with an interval-DP clear cost.
// - Proj: no-fire projection of every ball (list order, collidable flag) for H ticks.
// - sweep(): every integer mouse point on the screen border is a distinct exact firing angle; the
//   bullet is traced against the projection (treasure, ball collision with the original rules, gap
//   crossing with CheckGapShot's rules) and consecutive angles with the same outcome are grouped.
// - clearCost(): minimum number of shots to clear a run list (Zuma interval DP: clear the middle,
//   ends merge and pop in a cascade).
// - finishEst(): estimated level end tick from clear cost, score still needed (chain-in-a-row bonus
//   included), bar climb and inflow of new balls.
'use strict';
const Z = require('../../js/sim.js');
const B = require('./bot.js');
const f32 = Math.fround;

// ------------------------------------------------------------------------------------------ projection
const GX = 28, GY = 24;
class Proj {
  constructor(game, H) {
    this.frames = [];
    const c = game.clone();
    this.rec(c);
    for (let t = 1; t <= H; t++) {
      c.tick(null);
      if (c.board.mGameState !== Z.ST_PLAYING) break;
      this.rec(c);
    }
    this.H = this.frames.length - 1;
  }
  rec(c) {
    const b = c.board, fr = [];
    for (let ci = 0; ci < b.mNumCurves; ci++) {
      const L = b.mCurveMgr[ci].mBallList.toArray(), n = L.length;
      const F = { n, ids: new Int32Array(n), wp: new Float32Array(n), x: new Float32Array(n), y: new Float32Array(n), ok: new Uint8Array(n) };
      for (let i = 0; i < n; i++) {
        const ball = L[i];
        F.ids[i] = ball.mId; F.wp[i] = ball.mWayPoint; F.x[i] = ball.mx; F.y[i] = ball.my;
        let ok = ball.mBullet === null && ball.mClearCount === 0;
        if (ok) { const pb = ball.GetPrevBall(true), nb = ball.GetNextBall(true); if ((pb && pb.mBullet) || (nb && nb.mBullet)) ok = false; }
        F.ok[i] = ok ? 1 : 0;
      }
      fr.push(F);
    }
    // spatial grid (32 px cells, GX x GY with a 4-cell margin) of collidable balls, CSR layout
    let tot = 0;
    for (const F of fr) tot += F.n;
    const cellOf = new Int32Array(tot), codes = new Int32Array(tot);
    const start = new Int32Array(GX * GY + 1);
    let q = 0;
    fr.forEach((F, ci) => { for (let i = 0; i < F.n; i++) { if (!F.ok[i]) continue; const cx = (F.x[i] >> 5) + 4, cy = (F.y[i] >> 5) + 4; if (cx < 0 || cy < 0 || cx >= GX || cy >= GY) continue; const k = cx * GY + cy; cellOf[q] = k; codes[q] = ci * 4096 + i; start[k + 1]++; q++; } });
    for (let k = 0; k < GX * GY; k++) start[k + 1] += start[k];
    const items = new Int32Array(q), fillp = start.slice(0, GX * GY);
    for (let j = 0; j < q; j++) items[fillp[cellOf[j]]++] = codes[j];   // codes in increasing (ci, i) order per cell
    fr.gstart = start; fr.gitems = items;
    this.frames.push(fr);
  }
  at(t) { return this.frames[Math.max(0, Math.min(this.H, t))]; }
}

// curve sample points used by CheckGapShot (every 32 waypoints, not in a tunnel)
function gapPoints(cm) {
  if (cm.wp.c.gapPts) return cm.wp.c.gapPts;
  const pts = [];
  for (let i = 1; i < cm.wp.n; i += 32) if (!cm.wp.tun[i]) pts.push(i);
  const P = { i: Int32Array.from(pts), x: Float32Array.from(pts.map(i => cm.wp.xs[i])), y: Float32Array.from(pts.map(i => cm.wp.ys[i])), grid: new Map() };
  for (let k = 0; k < pts.length; k++) { const key = ((P.x[k] >> 5) + 4) * 64 + ((P.y[k] >> 5) + 4); let a = P.grid.get(key); if (!a) P.grid.set(key, a = []); a.push(k); }
  cm.wp.c.gapPts = P;
  return P;
}

// trace one shot. returns {kind:'hit', ci, hit, front, prev, next, gaps:[{id,d}], t} | {kind:'coin'} | {kind:'gone'}
function trace(game, proj, mouse) {
  const b = game.board, gun = b.gun;
  const ang = B.mouseAngle(gun.mCenterX, gun.mCenterY, mouse[0], mouse[1]);
  const { L, v } = B.launch(gun, ang);
  const tre = b.mCurTreasure;
  const nc = b.mNumCurves;
  const cur = [0, 0, 0];
  const gaps = [];
  for (let t = 6; t < 300; t++) {
    const px = L[0] + v[0] * (t - 2), py = L[1] + v[1] * (t - 2);
    if (tre) { const dx = px - tre.x - 15, dy = py - tre.y - 15; if (dx * dx + dy * dy < 36 * 36) return { kind: 'coin', t }; }
    const fr = proj.at(t);
    // candidates from the 3x3 cells around the bullet, in (curve, list) order
    const gx = (px >> 5) + 4, gy = (py >> 5) + 4;
    let cand = null;
    const gs = fr.gstart, gi = fr.gitems;
    for (let ax = gx - 1; ax <= gx + 1; ax++) {
      if (ax < 0 || ax >= GX) continue;
      for (let ay = gy - 1; ay <= gy + 1; ay++) {
        if (ay < 0 || ay >= GY) continue;
        const k = ax * GY + ay;
        for (let p = gs[k], e = gs[k + 1]; p < e; p++) {
          const code = gi[p], ci = code >> 12, i = code & 4095, F = fr[ci];
          const dx = px - F.x[i], dy = py - F.y[i];
          if (dx * dx + dy * dy < 1024) (cand || (cand = [])).push(code);
        }
      }
    }
    if (cand) cand.sort((p, q) => p - q);
    if (cand) for (const code of cand) {
      const ci = code >> 12, i = code & 4095, F = fr[ci];
      {
        const cm = b.mCurveMgr[ci];
        const [qx, qy] = cm.wp.CalcPerpendicular(F.wp[i]);
        const front = f32(f32(f32(px - F.x[i]) * qy) - f32(f32(py - F.y[i]) * qx)) < 0;
        const w = Math.trunc(F.wp[i]);
        if (front ? cm.wp.InTunnelPt(w + 16) : cm.wp.InTunnelPt(w - 16)) continue;
        let prev = front ? F.ids[i] : (i > 0 ? F.ids[i - 1] : -1);
        let next = front ? (i + 1 < F.n ? F.ids[i + 1] : -1) : F.ids[i];
        // Bullet::CheckSetHitBallToPrevBall: the previous ball also touching moves the slot back
        if (front && i > 0) { const ex = px - F.x[i - 1], ey = py - F.y[i - 1]; if (ex * ex + ey * ey < 1024) { prev = F.ids[i - 1]; next = F.ids[i]; } }
        // the gap being landed in does not count
        const gs = gaps.filter(g => g.id !== next || g.ci !== ci);
        return { kind: 'hit', ci, hit: F.ids[i], front, prev, next, gaps: gs, t };
      }
    }
    // CheckGapShot
    for (let ci = 0; ci < nc; ci++) {
      const cm = b.mCurveMgr[ci], n = cm.wp.n;
      const idx = cur[ci];
      if (idx > 0 && idx < n) {
        const dy = cm.wp.ys[idx] - py, dx = cm.wp.xs[idx] - px;
        if (dx * dx + dy * dy < 1024) continue;
        cur[ci] = 0;
      }
      const G = gapPoints(cm);
      let kk = -1;
      const gx = (px >> 5) + 4, gy = (py >> 5) + 4;
      for (let ax = gx - 1; ax <= gx + 1; ax++) for (let ay = gy - 1; ay <= gy + 1; ay++) {
        const a = G.grid.get(ax * 64 + ay);
        if (!a) continue;
        for (const k of a) { if (kk >= 0 && k >= kk) continue; const dy = G.y[k] - py, dx = G.x[k] - px; if (dx * dx + dy * dy < 1024) kk = k; }
      }
      if (kk >= 0) {
        const i = G.i[kk];
        cur[ci] = i;
        const F = fr[ci];
        // first ball with wp > i (list order is ascending wp except transiently; fall back to a scan)
        let j = -1;
        if (F.sorted === undefined) { F.sorted = true; for (let a = 1; a < F.n; a++) if (F.wp[a] < F.wp[a - 1]) { F.sorted = false; break; } }
        if (F.sorted) { let lo = 0, hi = F.n; while (lo < hi) { const md = (lo + hi) >> 1; if (F.wp[md] > i) hi = md; else lo = md + 1; } j = lo < F.n ? lo : -1; }
        else { for (let a = 0; a < F.n; a++) if (F.wp[a] > i) { j = a; break; } }
        if (j > 0) {
          const d = Math.trunc(F.wp[j] - F.wp[j - 1]);
          if (d > 0 && !gaps.some(g => g.id === F.ids[j])) gaps.push({ ci, id: F.ids[j], d });
        }
      }
    }
    if (!(px >= 0 && py >= 0 && px - 16 < 640 && py - 16 < 480)) return { kind: 'gone', t };
  }
  return { kind: 'gone', t: 300 };
}

function gapBonus(gaps) {
  if (!gaps.length) return 0;
  let m = 0;
  for (const g of gaps) if (m === 0 || g.d < m) m = g.d;
  if (m <= 0) return 0;
  m -= 64; if (m < 0) m = 0;
  let gb = Math.trunc((300 - m) * 500 / 300);
  gb = Math.trunc(gb / 10) * 10;
  if (gb < 10) gb = 10;
  if (gaps.length > 1) gb *= gaps.length;
  return gb;
}

// all screen-border mouse points, in angular order around the screen
let BORDER = null;
function border(step) {
  if (BORDER && BORDER.step === step) return BORDER.pts;
  const pts = [];
  for (let x = 0; x < 640; x += step) pts.push([x, 0]);
  for (let y = 0; y < 480; y += step) pts.push([639, y]);
  for (let x = 639; x >= 0; x -= step) pts.push([x, 479]);
  for (let y = 479; y >= 0; y -= step) pts.push([0, y]);
  BORDER = { step, pts };
  return pts;
}

function okey(o) {
  if (o.kind !== 'hit') return o.kind;
  return o.ci + ':' + o.prev + ':' + o.next + ':' + o.gaps.map(g => g.id).sort().join(',');
}

// returns outcome groups [{o, mouse, width}]. Coarse pass every `coarse` border points, then bisection
// wherever neighbouring samples differ (full resolution at every outcome boundary).
function sweep(game, proj, step, coarse) {
  const pts = border(step || 1);
  const n = pts.length;
  coarse = coarse || 1;
  const outs = new Array(n), keys = new Array(n);
  const get = (i) => { if (outs[i] === undefined) { outs[i] = trace(game, proj, pts[i]); keys[i] = okey(outs[i]); } return keys[i]; };
  const fill = (a, b) => {   // a < b, both sampled
    if (b - a <= 1) return;
    if (keys[a] === keys[b]) { for (let i = a + 1; i < b; i++) { outs[i] = outs[a]; keys[i] = keys[a]; } return; }
    const m = (a + b) >> 1; get(m); fill(a, m); fill(m, b);
  };
  let prev = 0; get(0);
  for (let i = coarse; i < n; i += coarse) { get(i); fill(prev, i); prev = i; }
  if (prev !== n - 1) { get(n - 1); fill(prev, n - 1); }
  const groups = [];
  let s = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || keys[i] !== keys[s]) {
      const mid = (s + i - 1) >> 1;
      groups.push({ o: outs[mid], mouse: pts[mid], width: i - s });
      s = i;
    }
  }
  return groups;
}

// ------------------------------------------------------------------------------------------ run model
// flat run list per curve: [{c, n, auto, ids}] ; auto = run of >=3 that pops by itself (active junction)
// chain model with exact contact (a run never spans a gap, unlike bot.chainModel's 40px rule)
function chainModel4(game) {
  const b = game.board, curves = [];
  for (let ci = 0; ci < b.mNumCurves; ci++) {
    const cm = b.mCurveMgr[ci], wp = cm.wp;
    const all = cm.mBallList.toArray();
    const vb = [];
    let pendingClear = false;
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
        else if (prevBall.mSuckPending && prev.type === ball.mType) join = 'active';
        else join = 'wall';
      }
      vb.push({ id: ball.mId, type: ball.mType, wp: ball.mWayPoint, join, ball });
      pendingClear = false;
    }
    const segs = [];
    let seg = null;
    for (const v of vb) {
      if (!seg || v.join === 'wall') { seg = { runs: [], balls: [], junctions: [] }; segs.push(seg); }
      seg.balls.push(v);
      const R = seg.runs[seg.runs.length - 1];
      if (R && R.color === v.type) {
        R.balls.push(v); R.n++;
        if (v.join === 'active' && seg.junctions.indexOf(seg.runs.length - 1) < 0) seg.junctions.push(seg.runs.length - 1);
      } else seg.runs.push({ color: v.type, n: 1, balls: [v] });
    }
    curves.push({ ci, segs, all, cm });
  }
  return curves;
}

function runModel(game) {
  const curves = chainModel4(game);
  return curves.map(C => {
    const runs = [];
    for (const S of C.segs) {
      S.runs.forEach((R, k) => {
        runs.push({ c: R.color, n: R.n, auto: R.n >= 3 && S.junctions.indexOf(k) >= 0, ids: R.balls.map(v => v.id), wall: k === 0 && S !== C.segs[0], w0: R.balls[0].wp, w1: R.balls[R.balls.length - 1].wp, act: S.junctions.indexOf(k) >= 0 });
      });
    }
    return runs;
  });
}

// minimum shots to clear a run list (interval DP over (i, j, carried count s of run i); s=3: pops on merge)
function clearCostFixed(runs) {
  const rr = runs.map(r => ({ c: r.c, n: r.n >= 3 ? (r.auto ? 3 : 2) : r.n, auto: r.auto }));
  const m = rr.length;
  if (!m) return 0;
  const c = rr.map(r => r.c), n = rr.map(r => r.n);
  const memo = new Float64Array(m * m * 3).fill(-1);
  function F(i, j, s) {
    if (i > j) return 0;
    const key = (i * m + j) * 3 + (s - 1);
    if (memo[key] >= 0) return memo[key];
    let best = (s >= 3 ? 0 : 3 - s) + F(i + 1, j, i + 1 <= j ? n[i + 1] : 1);
    // same colour right after a gap: the groups get pushed together (no set check), one shot pops both
    if (i + 1 <= j && c[i + 1] === c[i] && s < 3) { const t = F(i + 1, j, Math.min(2, s + n[i + 1])); if (t < best) best = t; }
    for (let k = i + 2; k <= j; k++) {
      if (c[k] !== c[i]) continue;
      const mid = F(i + 1, k - 1, n[i + 1]);
      if (mid >= best) continue;
      const tot = mid + F(k, j, Math.min(3, s + n[k]));
      if (tot < best) best = tot;
    }
    memo[key] = best;
    return best;
  }
  return F(0, m - 1, n[0]);
}


// ------------------------------------------------------------------------------------------ cascade planner
// Cascade plans on a flat run list: trigger run j (shots 3-n, 0 for an active junction), then layer by layer
// the neighbours merge when their colours match (combo k, knockback 45k px pushes the rear part back) or
// are fixed by inserting balls of one side's colour next to the other side.
// plan: {j, shots, trig, cons:Set(run idx), lo, push, depth, score, fixes:[{side, run, col, cnt}]}
function planFlat(runs, maxShots, out) {
  const m = runs.length;
  for (let j = 0; j < m; j++) {
    const R0 = runs[j];
    let trig = R0.auto ? 0 : (R0.n >= 3 ? 1 : 3 - R0.n);
    if (trig > maxShots) continue;
    const cons = [j];
    rec(j - 1, j + 1, trig, trig, cons, 0, 10 * Math.max(3, R0.n + trig), 1, []);
  }
  function rec(l, r, shots, trig, cons, push, score, depth, fixes) {
    out.push({ j: cons[0], shots, trig, cons: cons.slice(), lo: l + 1, push, depth, score, fixes: fixes.slice() });
    if (l < 0 || r >= m || depth > 20) return;
    const L = runs[l], R = runs[r];
    if (L.c === R.c) {
      const need = Math.max(0, 3 - L.n - R.n);
      if (shots + need > maxShots) return;
      const f2 = need ? fixes.concat([{ add: true, run: l, col: L.c, cnt: need }]) : fixes;
      cons.push(l, r);
      rec(l - 1, r + 1, shots + need, trig, cons, push + 45 * depth, score + 10 * (L.n + R.n + need) + 100 * depth, depth + 1, f2);
      cons.length -= 2;
      return;
    }
    // fix: insert R's colour beside L (consumes R), or L's colour beside R (consumes L)
    for (const side of [0, 1]) {
      const T = side === 0 ? R : L, idx = side === 0 ? r : l;
      const cnt = Math.max(1, 3 - T.n);
      if (shots + cnt > maxShots) continue;
      cons.push(idx);
      const f2 = fixes.concat([{ side, run: idx, other: side === 0 ? l : r, col: T.c, cnt }]);
      if (side === 0) rec(l, r + 1, shots + cnt, trig, cons, push + 45 * depth, score + 10 * (T.n + cnt) + 100 * depth, depth + 1, f2);
      else rec(l - 1, r, shots + cnt, trig, cons, push + 45 * depth, score + 10 * (T.n + cnt) + 100 * depth, depth + 1, f2);
      cons.length -= 1;
    }
  }
  return out;
}

// clear cost of a curve with the best cascade plan applied (consumed runs removed, rear runs inside the
// knockback distance removed when the target will be reached by then)
function planCost(runs, P, scoreOk) {
  const base = clearCostFixed(runs);
  let best = { cost: base, plan: null, score: 0, time: 0 };
  if (runs.length < 2) return best;
  const plans = planFlat(runs, P.planShots, []);
  for (const p of plans) {
    p.pushed = 0;
    const drift = 25 * p.depth;
    for (let k = 0; k < p.lo; k++) if (runs[k].w1 < p.push - drift) p.pushed += runs[k].n; else break;
    let consumed = 0; for (const k of p.cons) consumed += runs[k].n;
    p.quick = consumed + p.pushed - 2.5 * p.shots;
  }
  plans.sort((a, c) => c.quick - a.quick);
  for (const p of plans.slice(0, P.topPlans)) {
    if (p.depth < 2) continue;
    const cs = new Set(p.cons);
    const rest = [];
    const usePush = scoreOk(p.score);
    for (let k = 0; k < runs.length; k++) {
      if (cs.has(k)) continue;
      if (usePush && k < p.lo && runs[k].w1 < p.push - 25 * p.depth) continue;
      rest.push(runs[k]);
    }
    // merge equal neighbours left after removal
    const rr = [];
    for (const r of rest) { const q = rr[rr.length - 1]; if (q && q.c === r.c) rr[rr.length - 1] = Object.assign({}, q, { n: q.n + r.n, auto: false }); else rr.push(r); }
    const cost = p.shots + clearCostFixed(rr);
    if (cost < best.cost) best = { cost, plan: p, score: p.score, time: 21 * p.trig + 70 * p.depth };
  }
  return best;
}

// abstract insertion of colour col next to ball prevId/nextId; returns {runs, popped, combo, setMade}
function insertAbstract(runs, col, prevId, nextId) {
  const R = runs.map(r => ({ c: r.c, n: r.n, auto: r.auto, ids: r.ids }));
  let ip = -1, inx = -1;
  for (let k = 0; k < R.length; k++) {
    if (R[k].ids.indexOf(prevId) >= 0) ip = k;
    if (R[k].ids.indexOf(nextId) >= 0) inx = k;
  }
  let at;
  if (ip >= 0 && R[ip].c === col) { R[ip] = Object.assign({}, R[ip], { n: R[ip].n + 1 }); at = ip; }
  else if (inx >= 0 && R[inx].c === col) { R[inx] = Object.assign({}, R[inx], { n: R[inx].n + 1 }); at = inx; }
  else {
    // new run between ip and inx (splitting a run if both ids are in the same run)
    const nr = { c: col, n: 1, auto: false, ids: [] };
    if (ip >= 0 && ip === inx) {
      const r = R[ip], k = r.ids.indexOf(prevId) + 1;
      const a = { c: r.c, n: k, auto: false, ids: r.ids.slice(0, k) }, bq = { c: r.c, n: r.n - k, auto: false, ids: r.ids.slice(k) };
      R.splice(ip, 1, a, nr, bq); at = ip + 1;
    } else if (ip >= 0) { R.splice(ip + 1, 0, nr); at = ip + 1; }
    else if (inx >= 0) { R.splice(inx, 0, nr); at = inx; }
    else { R.push(nr); at = R.length - 1; }
    return { runs: R, popped: 0, combo: 0, setMade: false };
  }
  if (R[at].n < 3) return { runs: R, popped: 0, combo: 0, setMade: false };
  // pop + cascade
  let popped = 0, combo = 0, pts = 0;
  let k = at;
  for (;;) {
    popped += R[k].n; pts += 10 * R[k].n + 100 * combo;
    R.splice(k, 1);
    const l = k - 1, r = k;
    if (l < 0 || r >= R.length || R[l].c !== R[r].c) break;
    const merged = { c: R[l].c, n: R[l].n + R[r].n, auto: false, ids: R[l].ids.concat(R[r].ids) };
    R.splice(l, 2, merged);
    k = l; combo++;
    if (merged.n < 3) break;
  }
  return { runs: R, popped, combo, pts, setMade: true };
}


// add one ball of the run's colour to run k (abstract), popping/cascading
function addToRun(runs, k) {
  const R = runs.map(r => ({ c: r.c, n: r.n >= 3 ? (r.auto ? 3 : 2) : r.n, auto: r.auto }));
  R[k].n++;
  if (R[k].n < 3) return R;
  let i = k;
  for (;;) {
    R.splice(i, 1);
    const l = i - 1;
    if (l < 0 || i >= R.length || R[l].c !== R[i].c) break;
    const m = { c: R[l].c, n: R[l].n + R[i].n, auto: false };
    R.splice(l, 2, m); i = l;
    if (m.n < 3) break;
  }
  return R;
}

// colour-aware cost: shots to clear given the two balls in hand. A useful move with a gun colour keeps the
// DP cost; otherwise one extra shot (discard / wasted) is charged (fractionally for the next ball).
function colorPenalty(rm, costs, gunCols) {
  const tot = costs.reduce((a, x) => a + x, 0);
  if (tot === 0) return 0;
  let best = [Infinity, Infinity];
  gunCols.forEach((col, gi) => {
    if (col < 0) return;
    rm.forEach((runs, ci) => {
      for (let k = 0; k < runs.length; k++) {
        if (runs[k].c !== col) continue;
        const c2 = clearCostFixed(addToRun(runs, k));
        const after = tot - costs[ci] + c2 + 1;
        if (after < best[gi]) best[gi] = after;
      }
    });
  });
  const b0 = best[0] - tot, b1 = best[1] - tot;   // 0 = on an optimal path
  return Math.min(Math.max(0, b0), Math.max(0, b1) + 0.3, 1.5);
}


// longest natural cascade still to come from the active junction runs (layers)
function activeDepth(runs) {
  let best = 0;
  for (let j = 0; j < runs.length; j++) {
    if (!runs[j].auto) continue;
    let d = 1, l = j - 1, r = j + 1, carry = 0;
    while (l >= 0 && r < runs.length && runs[l].c === runs[r].c && runs[l].n + runs[r].n >= 3) { d++; l--; r++; }
    if (d > best) best = d;
  }
  return best;
}


// rear runs pushed out of the entrance by the knockback of the active cascades (after the target these
// balls are deleted; before it they go back to the pending queue, which is cleared at the target)
function pushOut(runs, drift) {
  let cut = 0;
  for (let j = 0; j < runs.length; j++) {
    if (!runs[j].auto) continue;
    let d = 1, l = j - 1, r = j + 1, push = 0;
    while (l >= 0 && r < runs.length && runs[l].c === runs[r].c && runs[l].n + runs[r].n >= 3) { push += 45 * d; d++; l--; r++; }
    push -= drift * d;
    let k = 0;
    while (k <= l && runs[k].w1 < push) k++;
    if (k > cut) cut = k;
  }
  return cut ? runs.slice(cut) : runs;
}

// shots needed to score D more points starting with n0 clears in a row
function shotsForScore(D, n0, mu) {
  if (D <= 0) return 0;
  let s = 0, acc = 0;
  for (let k = 1; k < 200; k++) {
    const n = n0 + k;
    const p = 30 + mu + (n > 4 ? 10 * n + 50 : 0);
    if (acc + p >= D) return s + (D - acc) / p;
    acc += p; s++;
  }
  return 200;
}

const DEF4 = { coarse: 1, pushOut: 0, drift: 20, layerT: 0, colorPen: 1, maxDelay: 0, delayTop: 3, postDelay: 0, postTop: 6, planShots: 0, topPlans: 6, rho: 300, planScoreW: 0.7, alpha: 1.0, mu: 40, kappa: 0.6, omega: 0.25, tail: 50, width: 24, K: 14, settle: 60, maxDepth: 120, maxTicks: 3500, noise: 0, seed: 1, step: 1 };

// estimated level end tick for a state at tick ts, given the per-curve clear costs
function finishEst(b, ts, cost, P, n0) {
  const D = Math.max(0, b.mScoreTarget - b.mScore);
  if (n0 === undefined) n0 = b.mNumClearsInARow;
  if (b.mHaveReachedTarget) return ts + 21 * cost + P.tail;
  const Ss = shotsForScore(D, n0, P.mu);
  const Ttrig = Math.max(ts + 21 * Ss, ts + 256 - b.mCurBarSize);
  let inflow = 0;
  for (const cm of b.mCurveMgr) inflow += Math.max(0.3, cm.mAdvanceSpeed) * (Ttrig - ts) / 32;
  const Sc = cost + P.kappa * inflow;
  const hi = Math.max(Ss, Sc), lo = Math.min(Ss, Sc);
  return Math.max(Ttrig, ts + 21 * (hi + P.omega * lo)) + P.tail;
}

function evalState(game, P) {
  const b = game.board;
  if (b.mGameState === Z.ST_LEVELUP) return { done: true, F: b.levelTimes[b.levelTimes.length - 1] };
  if (b.mGameState !== Z.ST_PLAYING) return { dead: true };
  const rm = runModel(game);
  const D = Math.max(0, b.mScoreTarget - b.mScore);
  let cost = 0, extra = 0, tmin = 0;
  const plans = [], costs = [];
  let adepth = 0;
  for (let runs of rm) {
    adepth = Math.max(adepth, activeDepth(runs));
    if (P.pushOut && (b.mHaveReachedTarget || D <= P.pushOut)) runs = pushOut(runs, P.drift);
    const pc = P.planShots ? planCost(runs, P, (sc) => b.mHaveReachedTarget || sc + P.rho >= D) : { cost: clearCostFixed(runs), plan: null, score: 0, time: 0 };
    cost += pc.cost; extra += pc.score; tmin = Math.max(tmin, pc.time);
    plans.push(pc.plan); costs.push(pc.cost);
  }
  let cpen = 0;
  if (P.colorPen) {
    const gun = b.gun;
    cpen = colorPenalty(rm, costs, [gun.mBullet ? gun.mBullet.mType : -1, gun.mNextBullet ? gun.mNextBullet.mType : -1]);
    cost += P.colorPen * cpen;
  }
  if (P.model || P.wantFeat) {
    const feat = featuresOf(b, rm, costs, cpen, adepth, D, P);
    if (P.wantFeat) return { feat, rm, costs, cpen };
    let F = b.mStateCount + mlpEval(P.model, feat);
    for (const cm of b.mCurveMgr) if (!cm.mBallList.empty()) { const fr = cm.mBallList.back().mWayPoint / cm.wp.n; if (fr > 0.85) F += (fr - 0.85) * 4000; }
    return { F, cost, rm, plans, cpen };
  }
  const save = b.mScore; b.mScore += Math.round(extra * P.planScoreW);
  let F = finishEst(b, b.mStateCount, cost * P.alpha, P);
  b.mScore = save;
  F = Math.max(F, b.mStateCount + tmin + P.tail, b.mStateCount + P.layerT * adepth + P.tail);
  // danger
  for (const cm of b.mCurveMgr) if (!cm.mBallList.empty()) { const fr = cm.mBallList.back().mWayPoint / cm.wp.n; if (fr > 0.85) F += (fr - 0.85) * 4000; }
  return { F, cost, rm, plans, cpen };
}


// ------------------------------------------------------------------------------------------ learned value
function featuresOf(b, rm, costs, cpen, adepth, D, P) {
  const tgt = Math.max(1, b.mScoreTarget - b.mLevelBeginScore);
  let balls = 0, segs = 0, maxFar = 0, len = 0, speed = 0, pend = 0, singles = 0, doubles = 0, big = 0, autos = 0;
  b.mCurveMgr.forEach((cm, ci) => {
    const runs = rm[ci];
    for (const r of runs) { balls += r.n; if (r.wall) segs++; if (r.n === 1) singles++; else if (r.n === 2) doubles++; else big++; if (r.auto) autos++; }
    if (!cm.mBallList.empty()) { maxFar = Math.max(maxFar, cm.mBallList.back().mWayPoint / cm.wp.n); len += cm.wp.n; }
    speed += cm.mAdvanceSpeed; pend += cm.mPendingBalls.length;
  });
  const dp = costs.reduce((a, x) => a + x, 0);
  const shotsSc = shotsForScore(D, b.mNumClearsInARow, 40);
  return [
    b.mStateCount / 1000, D / tgt, D / 5000, b.mCurBarSize / 256, b.mHaveReachedTarget ? 1 : 0,
    dp / 10, Math.max(...costs) / 10, cpen, balls / 30, maxFar, segs / 5, adepth / 5, speed, Math.min(pend, 20) / 10,
    Math.min(b.mNumClearsInARow, 30) / 10, b.mBallColorMap.size / 6, b.mNumCurves - 1, tgt / 5000, len / 3000,
    singles / 10, doubles / 10, big / 5, autos / 3, shotsSc / 20,
    b.mCurveMgr.reduce((a, cm) => a + (cm.mSlowCount > 0 ? 1 : 0) + (cm.mBackwardCount > 0 ? 1 : 0), 0) / 2,
    b.mBulletList.length / 3,
  ];
}
const MODELS = {};
function loadModel(f) { if (!MODELS[f]) MODELS[f] = JSON.parse(require('fs').readFileSync(require('path').resolve(__dirname, '../..', f), 'utf8')); return MODELS[f]; }
function mlpEval(M, x) {
  // M: {mu, sd, layers:[{W (out x in), b}], ymu, ysd}
  let h = x.map((v, i) => (v - M.mu[i]) / M.sd[i]);
  M.layers.forEach((L, li) => {
    const o = new Array(L.b.length);
    for (let r = 0; r < L.b.length; r++) { let s = L.b[r]; const W = L.W[r]; for (let c = 0; c < h.length; c++) s += W[c] * h[c]; o[r] = (li < M.layers.length - 1 && s < 0) ? 0 : s; }
    h = o;
  });
  return h[0] * M.ysd + M.ymu;
}

// ------------------------------------------------------------------------------------------ candidates
function fireEv(m, swap) { const ev = [['m', m[0], m[1]]]; if (swap) ev.push(['r']); ev.push(['l']); return ev; }

function candidates(game, P, rng, base) {
  const b = game.board, gun = b.gun;
  const cur = gun.mBullet.mType, nxt = gun.mNextBullet ? gun.mNextBullet.mType : -1;
  const proj = new Proj(game, 160);
  const groups = sweep(game, proj, P.step, P.coarse);
  const rm = base.rm;
  const colors = [[cur, false]];
  if (nxt >= 0 && nxt !== cur) colors.push([nxt, true]);
  const out = [];
  const t1 = b.mStateCount + 21;
  let coin = null, gone = null;
  for (const g of groups) {
    if (g.o.kind === 'coin') { if (!coin || g.width > coin.width) coin = g; continue; }
    if (g.o.kind === 'gone') { if (!gone || g.o.t < gone.o.t || (g.o.t === gone.o.t && g.width > gone.width)) gone = g; continue; }
  }
  // insertion fixes wanted by the current best cascade plans
  const insOk = new Set();
  (base.plans || []).forEach((p, ci) => {
    if (!p) return;
    const runs = rm[ci];
    for (const f of p.fixes) {
      if (f.add) continue;
      let a, bq;
      if (f.side === 0) { a = runs[f.other]; bq = runs[f.other + 1]; } else { a = runs[f.other - 1]; bq = runs[f.other]; }
      if (!a || !bq) continue;
      insOk.add(ci + ':' + a.ids[a.ids.length - 1] + ':' + bq.ids[0] + ':' + f.col);
    }
  });
  // best group per (colour, slot): prefer gap bonus, then width
  const bySlot = new Map();
  for (const g of groups) {
    if (g.o.kind !== 'hit') continue;
    const o = g.o, runs = rm[o.ci];
    for (const [col, swap] of colors) {
      // only shots that join a run of the same colour
      let rel = false;
      for (const r of runs) if (r.c === col && (r.ids.indexOf(o.prev) >= 0 || r.ids.indexOf(o.next) >= 0)) { rel = true; break; }
      if (!rel && !insOk.has(o.ci + ':' + o.prev + ':' + o.next + ':' + col)) continue;
      const gb = gapBonus(o.gaps);
      const key = col + ':' + o.ci + ':' + o.prev + ':' + o.next + ':' + (gb > 0 ? 'g' : '');
      const prev = bySlot.get(key);
      const score = gb * 10 + Math.min(g.width, 12);
      if (!prev || score > prev.score) bySlot.set(key, { g, col, swap, gb, score });
    }
  }
  for (const s of bySlot.values()) {
    const o = s.g.o;
    const ab = insertAbstract(rm[o.ci], s.col, o.prev, o.next);
    let cost = 0;
    rm.forEach((runs, ci) => { cost += clearCostFixed(ci === o.ci ? ab.runs : runs); });
    const pts = ab.setMade ? (ab.pts + s.gb + (b.mNumClearsInARow + 1 > 4 ? 10 * (b.mNumClearsInARow + 1) + 50 : 0)) : 0;
    const save = b.mScore; b.mScore += pts;
    const F = finishEst(b, t1, cost, P, ab.setMade ? b.mNumClearsInARow + 1 : 0);
    b.mScore = save;
    out.push({ ev: fireEv(s.g.mouse, s.swap), F, desc: (ab.setMade ? 'set' : 'add') + s.col + (s.gb ? 'g' + s.gb : '') + (ab.combo ? 'c' + ab.combo : '') });
  }
  out.sort((a, c) => a.F - c.F);
  const sel = out.slice(0, P.K);
  if (coin) for (const [col, swap] of colors) sel.push({ ev: fireEv(coin.mouse, swap), desc: 'coin' + col });
  if (gone) for (const [col, swap] of colors) sel.push({ ev: fireEv(gone.mouse, swap), desc: 'disc' + col });
  if (!sel.length) sel.push({ wait: 6, desc: 'wait' });
  else if (P.waitAlways) sel.push({ wait: P.waitAlways, desc: 'wait' + P.waitAlways });
  return sel;
}

function advanceToDecision(game, maxT) {
  for (let t = 0; t < maxT; t++) {
    if (game.board.mGameState !== Z.ST_PLAYING) return t;
    if (B.isDecision(game)) return t;
    game.tick(null);
  }
  return maxT;
}

function hashNode(game) {
  const b = game.board;
  let h = b.mScore + '|' + (b.gun.mBullet ? b.gun.mBullet.mType : '-') + (b.gun.mNextBullet ? b.gun.mNextBullet.mType : '-') + '|';
  for (const cm of b.mCurveMgr) { for (const x of cm.mBallList) h += x.mType + (x.mClearCount ? '*' : '') + (x.mCollidesWithNext ? '' : '_'); h += '/'; }
  return h;
}

function beam4(startGame, opts) {
  const P = Object.assign({}, DEF4, opts || {});
  if (P.modelFile && !P.model) P.model = loadModel(P.modelFile);
  const rng = B.mulberry(P.seed);
  const root = startGame.clone();
  const events = [];
  let t = 0;
  if (root.board.mGameState === Z.ST_LEVELBEGIN) { events.push([0, [['l']]]); root.tick([['l']]); t = 1; }
  t += advanceToDecision(root, 400);
  let beam = [{ game: root, events, t, F: 0 }];
  let best = null;
  const finish = (g, evs) => {
    const bb = g.board, play = bb.levelTimes[bb.levelTimes.length - 1];
    if (!best || play < best.objective) best = { events: evs, objective: play, playTicks: play, quake: bb.tr.quakeFrame, score: bb.mScore, targetAt: bb.targetReachedFrame };
  };
  for (let depth = 0; depth < P.maxDepth && beam.length; depth++) {
    const children = [];
    const seen = new Set();
    const makeChild = (node, c, delay) => {
      const g = node.game.clone();
      const evs = node.events.slice();
      let t2 = node.t;
      if (c.wait) { for (let k = 0; k < c.wait; k++) { g.tick(null); t2++; } }
      else {
        for (let k = 0; k < delay; k++) { g.tick(null); t2++; }
        if (!B.isDecision(g)) return null;
        evs.push([t2, c.ev]); g.tick(c.ev); t2++;
      }
      t2 += advanceToDecision(g, 300);
      if (g.board.mGameState === Z.ST_LEVELUP) { finish(g, evs); return null; }
      if (g.board.mGameState !== Z.ST_PLAYING) return null;
      const h = hashNode(g);
      if (seen.has(h)) return null;
      seen.add(h);
      const sg = g.clone();
      for (let k = 0; k < P.settle && sg.board.mGameState === Z.ST_PLAYING; k++) sg.tick(null);
      if (sg.board.mGameState === Z.ST_LEVELUP) { finish(sg, evs); return null; }
      const e = evalState(sg, P);
      if (e.dead) return null;
      if (t2 > P.maxTicks) return null;
      return { game: g, events: evs, t: t2, F: e.F + (P.noise ? (rng() - 0.5) * P.noise : 0), cpen: e.cpen, desc: c.desc + (delay ? '+' + delay : ''), score: g.board.mScore, c };
    };
    for (const node of beam) {
      const base = evalState(node.game, P);
      if (!base.rm) continue;
      const kids = [];
      for (const c of candidates(node.game, P, rng, base)) { const ch = makeChild(node, c, 0); if (ch) kids.push(ch); }
      if (P.maxDelay) {
        kids.sort((a, c) => a.F - c.F);
        // post-target colour fishing: once the score target is reached a wider delay
        // window is pure gain whenever the saved shot outweighs the waited frames
        // (the value function prices the wait via mStateCount), so try more delays
        // on more kids there.
        const post = P.postDelay && node.game.board.mHaveReachedTarget;
        const md = post ? P.postDelay : P.maxDelay;
        const dt = post ? Math.max(P.delayTop, P.postTop) : P.delayTop;
        const extra = [];
        for (const k of kids.slice(0, dt)) {
          if ((!(k.cpen > 0) && !P.delayAll && !post) || k.c.wait) continue;
          for (let d = 1; d <= md; d++) { const ch = makeChild(node, k.c, d); if (ch) extra.push(ch); }
        }
        for (const x of extra) kids.push(x);
      }
      for (const k of kids) children.push(k);
    }
    children.sort((a, c) => a.F - c.F || c.score - a.score);
    beam = children.slice(0, P.width).filter(c => !best || c.t < best.playTicks);
    if (P.verbose) {
      const top = beam[0];
      if (top) console.log('depth', depth, 'beam', beam.length, 't', top.t, 'F', Math.round(top.F), 'score', top.game.board.mScore - top.game.board.mLevelBeginScore, top.desc, best ? 'best ' + best.objective : '');
    }
  }
  return best;
}

module.exports = { featuresOf, mlpEval, Proj, trace, sweep, gapBonus, runModel, clearCost: clearCostFixed, insertAbstract, finishEst, evalState, beam4, DEF4 };
