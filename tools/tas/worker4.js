// v4 worker: replay the movie so far, then search the next level with beam4
'use strict';
const { replay } = require('./replay.js');
const V = require('./v4.js');
process.on('message', (msg) => {
  try {
    const g = replay(msg.seed, msg.events, msg.upto);
    const t0 = Date.now();
    const r = V.beam4(g, msg.cfg);
    process.send({ id: msg.id, ok: true, res: r ? { events: r.events, objective: r.objective, playTicks: r.playTicks, quake: r.quake, score: r.score, targetAt: r.targetAt } : null, sec: (Date.now() - t0) / 1000, cfg: msg.cfg });
  } catch (e) {
    process.send({ id: msg.id, ok: false, err: String(e && e.stack || e) });
  }
});
