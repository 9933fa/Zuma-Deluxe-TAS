'use strict';
require('../../js/gamedata.js'); require('../../js/font.js');
const Z = require('../../js/sim.js');
function replay(seed, events, upto) {
  const g = new Z.Game({ seed });
  g.startAdventure(0);
  let i = 0;
  for (let t = 0; t < upto; t++) {
    let ev = null;
    if (i < events.length && events[i][0] === t) { ev = events[i][1]; i++; }
    g.tick(ev);
  }
  return g;
}
module.exports = { replay };
