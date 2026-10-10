// per-level min over several saved bench results: node minof.js a.json b.json ...
const P = require('../../tas/progress_64_v3.json');
const files = process.argv.slice(2).map(f => require(require('path').resolve(f)));
let sum = 0, sum1 = 0;
const best = {};
for (const L of P.levels) {
  let m = Infinity, who = -1;
  files.forEach((F, k) => { const r = F.res[L.label]; if (r && r.play !== null && r.play < m) { m = r.play; who = k; } });
  best[L.label] = { play: m, who };
  sum += m; if (files[0].res[L.label]) sum1 += files[0].res[L.label].play;
}
console.log('files', files.length, 'first', sum1, 'min-of', sum, (sum / 100).toFixed(2) + 's');
