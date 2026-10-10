require('../../js/gamedata.js'); require('../../js/font.js');
const Z = require('../../js/sim.js');
const { beamLevel } = require('./beam.js');
const a = +process.argv[2], b = +process.argv[3];
for (let s = a; s < b; s++) {
  const g = new Z.Game({ seed: s }); g.startAdventure(0);
  const r = beamLevel(g, { width: 24 });
  console.log('SEED', s, r ? r.objective : 9999, r ? r.playTicks : '-');
}
