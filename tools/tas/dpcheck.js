const V = require('./v4.js');
// brute force BFS on abstract chains: insert one ball of any colour adjacent to any run (or into a run)
function norm(runs) { // merge equal neighbours, pop >=3 with cascade
  return runs;
}
function key(R) { return R.map(r => r.c + r.n).join(''); }
function shoot(R, k, col, sideNew) {
  // add a ball of colour col to run k (if same colour) -> pop cascade
  R = R.map(r => ({ c: r.c, n: r.n }));
  if (R[k].c !== col) return null;
  R[k].n++;
  if (R[k].n < 3) return R;
  let i = k;
  for (;;) {
    R.splice(i, 1);
    const l = i - 1;
    if (l < 0 || i >= R.length || R[l].c !== R[i].c) break;
    const m = { c: R[l].c, n: R[l].n + R[i].n };
    R.splice(l, 2, m); i = l;
    if (m.n < 3) break;
  }
  return R;
}
function bfs(R0) {
  let frontier = [R0], seen = new Set([key(R0)]);
  for (let d = 0; d < 30; d++) {
    const nx = [];
    for (const R of frontier) {
      if (!R.length) return d;
      for (let k = 0; k < R.length; k++) {
        const R2 = shoot(R, k, R[k].c);
        const kk = key(R2);
        if (!seen.has(kk)) { seen.add(kk); nx.push(R2); }
      }
    }
    frontier = nx;
  }
  return 99;
}
const mk = s => s.match(/[A-Z]\d/g).map(t => ({ c: t[0], n: +t[1], auto: false, ids: [] }));
const tests = process.argv.slice(2).length ? process.argv.slice(2) : ['G3Y2B3R2Y3B1G1B1R2Y2B2Y1B2G1', 'R1G3Y2G2R2G3B1G3B1Y2R1G1Y1G2R1', 'R3G1R3B2R1G1R2G2'];
for (const s of tests) {
  const R = mk(s).map(r => ({ c: r.c, n: Math.min(r.n, 2) }));
  console.log(s, 'dp', V.clearCost(mk(s)), 'bfs(n>=3 as 2)', bfs(R));
}
