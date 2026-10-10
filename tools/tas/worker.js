// Worker process: replays the movie so far, then searches the next level.
'use strict';
require('../../js/gamedata.js'); require('../../js/font.js');
const Z = require('../../js/sim.js');
const { beamLevel } = require('./beam.js');
const { macroLevel } = require('./macro.js');

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

process.on('message', (msg) => {
  try {
    const g = replay(msg.seed, msg.events, msg.upto);
    const t0 = Date.now();
    let cfg = msg.cfg;
    if (msg.prefix) {
      // replay the first part of a known solution, then search from there
      let i = 0;
      for (let t = 0; t < msg.cut; t++) {
        let ev = null;
        if (i < msg.prefix.length && msg.prefix[i][0] === t) { ev = msg.prefix[i][1]; i++; }
        g.tick(ev);
      }
      cfg = Object.assign({}, cfg, { prefix: msg.prefix.slice(0, i), t0: msg.cut });
    }
    const r = cfg.engine === 'macro' ? macroLevel(g, cfg) : beamLevel(g, cfg);
    process.send({ id: msg.id, ok: true, res: r ? { events: r.events, objective: r.objective, playTicks: r.playTicks, quake: r.quake, score: r.score, targetAt: r.targetAt } : null, sec: (Date.now() - t0) / 1000, cfg: msg.cfg });
  } catch (e) {
    process.send({ id: msg.id, ok: false, err: String(e && e.stack || e) });
  }
});
module.exports = { replay };
