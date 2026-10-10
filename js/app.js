// App shell: screens (loading, main menu, adventure map, board, TAS replay), input, audio, 100 Hz loop.
(function (G) {
'use strict';
const Z = G.ZumaSim, R = G.ZumaRender, F = G.ZumaFont;
const IMG = R.IMG;

// ------------------------------------------------------------------------------------------ audio
const Audio2 = {
  pools: {}, muted: false, vol: 0.8, music: null, musicName: null, unlocked: false,
  sfxVol: 1,
  play(id, pitch, vol) {
    if (this.muted || !this.unlocked) return;
    const S = G.GAMEDATA.sounds['SOUND_' + id];
    if (!S) return;
    let p = this.pools[id];
    if (!p) p = this.pools[id] = [];
    let a = p.find(x => x.paused || x.ended);
    if (!a) { if (p.length >= 6) a = p[0]; else { a = new Audio('assets/' + S.file); p.push(a); } }
    try {
      a.preservesPitch = false; a.mozPreservesPitch = false; a.webkitPreservesPitch = false;
      a.playbackRate = Math.max(0.25, Math.min(4, Math.pow(2, (pitch || 0) / 12)));
      a.volume = Math.max(0, Math.min(1, S.volume * (vol === undefined ? 1 : vol) * this.sfxVol));
      a.currentTime = 0;
      const pr = a.play(); if (pr && pr.catch) pr.catch(() => {});
    } catch (e) { /* ignore */ }
  },
  loops: {},
  loop(id, on) {
    if (!this.unlocked) return;
    const S = G.GAMEDATA.sounds['SOUND_' + id];
    if (!S) return;
    let a = this.loops[id];
    if (on) {
      if (!a) { a = this.loops[id] = new Audio('assets/' + S.file); a.loop = true; }
      a.volume = this.muted ? 0 : S.volume * this.sfxVol; a.currentTime = 0;
      const pr = a.play(); if (pr && pr.catch) pr.catch(() => {});
    } else if (a) a.pause();
  },
  stopAll() { for (const k in this.loops) this.loops[k].pause(); for (const k in this.pools) for (const a of this.pools[k]) a.pause(); },
  // Background music (Zuma2K's approach): remember the wanted song while audio is still locked by the
  // browser's autoplay policy and start it on the first user gesture; a failed play() is retried later.
  wanted: null,
  song(name) {
    this.wanted = name;
    if (!this.unlocked) return;
    if (this.musicName === name && this.music && (!this.music.paused || this.music.ended)) return;
    if (this.music) { this.fade(this.music, 0, 0.5, true); this.music = null; }
    this.musicName = name;
    if (!name) return;
    const a = new Audio('assets/music/' + name + '.ogg');
    a.loop = !/song6|song7/.test(name); a.volume = 0; a.preload = 'auto';
    this.music = a;
    const pr = a.play(); if (pr && pr.catch) pr.catch(() => { if (this.music === a) this.musicName = null; });
    this.fade(a, this.muted ? 0 : this.vol * 0.7, 0.6);
  },
  unlock() {
    if (this.unlocked) { if (this.wanted && (!this.music || this.musicName !== this.wanted)) this.song(this.wanted); return; }
    this.unlocked = true;
    if (this.wanted) this.song(this.wanted);
  },
  fade(a, to, secs, stopAfter) {
    const from = a.volume, t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / (secs * 1000));
      a.volume = Math.max(0, Math.min(1, from + (to - from) * t));
      if (t < 1) setTimeout(step, 30); else if (stopAfter) a.pause();
    };
    step();
  },
  setMuted(m) { this.muted = m; if (this.music) this.music.volume = m ? 0 : this.vol * 0.7; for (const k in this.loops) this.loops[k].volume = m ? 0 : 0.8; },
};
const SONGS = { main: 'song0', danger: 'song5', menu: 'song1', adventure: 'song2', levelup: 'song6', gameover: 'song7', temple: 'song2' };

function makeSoundSink(app) {
  return (id, delay, pitch, vol) => {
    if (app.silent) return;
    if (id === 'killall') { for (const k in Audio2.loops) Audio2.loops[k].pause(); return; }
    if (id.startsWith('loop+')) { Audio2.loop(id.slice(5) === 'ROLLOUT' ? 'ROLLING' : id.slice(5), true); return; }
    if (id.startsWith('loop-')) { Audio2.loop(id.slice(5) === 'ROLLOUT' ? 'ROLLING' : id.slice(5), false); return; }
    if (id.startsWith('song:')) { const n = id.slice(5); Audio2.song(SONGS[n] || n); return; }
    if (id.startsWith('switch:')) { const n = id.slice(7); Audio2.song(SONGS[n] || n); return; }
    Audio2.play(id, pitch, vol);
  };
}

// ------------------------------------------------------------------------------------------ profile
const PROFILE_KEY = 'zumatas_profile_v1';
function loadProfile() {
  try { const p = JSON.parse(localStorage.getItem(PROFILE_KEY)); if (p) return p; } catch (e) { /* */ }
  return { mMaxLevel: 0, mMaxStage: 0 };
}
function saveProfile(p) { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) { /* */ } }

// ------------------------------------------------------------------------------------------ simple widgets
class ImgButton {
  constructor(id, x, y, onClick) { this.id = id; this.x = x; this.y = y; this.onClick = onClick; }
  get w() { const m = IMG[this.id]; return m ? m.w / 3 : 0; }
  get h() { const m = IMG[this.id]; return m ? m.h : 0; }
  hit(x, y) {
    const m = IMG[this.id]; if (!m) return false;
    if (x < this.x || y < this.y || x >= this.x + this.w || y >= this.y + this.h) return false;
    return true;
  }
  draw(g, mx, my, down) {
    const m = IMG[this.id]; if (!m) return;
    const over = this.hit(mx, my), cel = over ? (down ? 2 : 1) : 0;
    g.draw(m.img, cel * this.w, 0, this.w, this.h, this.x, this.y, this.w, this.h);
  }
}

// ------------------------------------------------------------------------------------------ App
class App {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = true;
    this.g = new R.Gfx(this.ctx);
    this.br = new R.BoardRenderer(this.ctx);
    this.mouse = { x: 320, y: 240, down: false };
    this.screen = 'loading';
    this.loadPct = 0;
    this.profile = loadProfile();
    this.updateCnt = 0;
    this.pendingEvents = [];
    this.paused = false;
    this.speed = 1;
    this.acc = 0;
    this.last = performance.now();
    this.bindInput();
    R.loadAssets(p => { this.loadPct = p; }).then(() => { this.loaded = true; });
    requestAnimationFrame(t => this.frame(t));
  }

  // ---------------------------------------------------------------- input
  toGame(e) {
    const r = this.canvas.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) * 640 / r.width), Math.floor((e.clientY - r.top) * 480 / r.height)];
  }
  bindInput() {
    const c = this.canvas;
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('mousemove', e => { const [x, y] = this.toGame(e); this.mouse.x = x; this.mouse.y = y; this.onMove(x, y); });
    c.addEventListener('mousedown', e => {
      Audio2.unlock();
      const [x, y] = this.toGame(e); this.mouse.x = x; this.mouse.y = y; this.mouse.down = true;
      this.onDown(x, y, e.button);
      e.preventDefault();
    });
    window.addEventListener('mouseup', () => { this.mouse.down = false; });
    window.addEventListener('keydown', e => {
      Audio2.unlock();
      this.onKey(e);
    });
  }
  onMove(x, y) {
    if (this.screen === 'board' && this.game && !this.paused) this.pendingEvents.push(['m', x, y]);
  }
  onDown(x, y, button) {
    const s = this.screen;
    if (s === 'loading') { if (this.loaded) this.showMenu(); return; }
    if (s === 'menu') { for (const b of this.menuButtons) if (b.hit(x, y)) { Audio2.play('BUTTON1'); b.onClick(); return; } return; }
    if (s === 'adventure') return this.advDown(x, y);
    if (s === 'board') return this.boardDown(x, y, button);
    if (s === 'tasmenu') return this.tasMenuDown(x, y);
    if (s === 'tas') return this.tasDown(x, y, button);
    if (s === 'credits') { this.showMenu(); }
  }
  onKey(e) {
    if (this.screen === 'board') {
      if (e.key === ' ' || e.key === 'p' || e.key === 'P') { this.paused = !this.paused; e.preventDefault(); }
      else if (e.key === 't' || e.key === 'T') { this.game.board.showParTimer = !this.game.board.showParTimer; }
      else if (e.key === 'Escape') { this.paused = !this.paused; }
    } else if (this.screen === 'tas') this.tasKey(e);
  }

  // ---------------------------------------------------------------- main menu
  showMenu() {
    this.screen = 'menu';
    this.menuCnt = 0;
    Audio2.song(SONGS.menu);
    this.menuButtons = [
      new ImgButton('IMAGE_MM_ARCADE', 452, 64, () => this.showAdventure()),
      new ImgButton('IMAGE_MM_GAUNTLET', 436, 153, () => { this.flashMsg = ['Gauntlet', '本复刻专注于冒险模式与 TAS 回放', 200]; }),
      new ImgButton('IMAGE_MM_OPTIONS', 418, 236, () => { Audio2.setMuted(!Audio2.muted); this.flashMsg = ['Options', Audio2.muted ? '声音：关' : '声音：开', 120]; }),
      new ImgButton('IMAGE_MM_MOREGAMES', 394, 305, () => this.showTasMenu()),
      new ImgButton('IMAGE_MM_QUIT', 496, 315, () => { this.flashMsg = ['Quit', '关闭浏览器窗口即可退出', 120]; }),
    ];
  }
  drawMenu() {
    const g = this.g, ctx = this.ctx;
    this.menuCnt++;
    const sky = IMG.IMAGE_MM_SKY;
    const ss = Math.trunc(this.menuCnt / 8) % sky.w;
    ctx.drawImage(sky.img, ss - sky.w, 0); ctx.drawImage(sky.img, ss, 0); ctx.drawImage(sky.img, ss + sky.w, 0);
    // eyes follow the mouse inside the eye cut-out (MainMenu::FindEyePos approximated)
    const ex = (cx, cy) => { const dx = this.mouse.x - cx, dy = this.mouse.y - cy, d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 120); return [cx + dx / d * 4 * k, cy + dy / d * 3 * k]; };
    const [lx, ly] = ex(219, 368), [rx, ry] = ex(276, 355);
    const el = IMG.IMAGE_MM_EYELEFT, er = IMG.IMAGE_MM_EYERIGHT;
    g.img('IMAGE_MM_BACK', 0, 0);
    ctx.drawImage(el.img, Math.trunc(lx - el.w / 2), Math.trunc(ly - el.h / 2));
    ctx.drawImage(er.img, Math.trunc(rx - er.w / 2), Math.trunc(ry - er.h / 2));
    g.img('IMAGE_SUNGLOW', -69, -63, { add: true, rot: (this.menuCnt * Math.PI / 180) * 0.3 });
    g.img('IMAGE_MM_SUN', 0, 2);
    const w = 'Welcome to Zuma!';
    g.text('BROWNTITLE', w, Math.trunc((640 - g.width('BROWNTITLE', w)) / 2), 32, 0xFFFFFF);
    for (const b of this.menuButtons) b.draw(g, this.mouse.x, this.mouse.y, this.mouse.down);
    // caption for the TAS button (replaces MORE GAMES)
    const mg = this.menuButtons[3];
    this.cjk('Claude TAS 速通回放', mg.x + mg.w / 2, mg.y + mg.h + 14, 13, '#ffe680', 'center');
    this.drawFlash();
  }
  drawFlash() {
    if (!this.flashMsg) return;
    const [t, s, n] = this.flashMsg;
    this.ctx.fillStyle = 'rgba(0,0,0,0.6)'; this.ctx.fillRect(120, 200, 400, 70);
    this.cjk(t + '：' + s, 320, 240, 16, '#ffff80', 'center');
    if (--this.flashMsg[2] <= 0) this.flashMsg = null;
  }
  cjk(text, x, y, size, color, align) {
    const c = this.ctx;
    c.save();
    c.font = `bold ${size}px "Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif`;
    c.textAlign = align || 'left'; c.textBaseline = 'middle';
    c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.85)'; c.strokeText(text, x, y);
    c.fillStyle = color || '#fff'; c.fillText(text, x, y);
    c.restore();
  }

  // ---------------------------------------------------------------- adventure screen
  showAdventure(reveal) {
    this.screen = 'adventure';
    this.advCnt = 0;
    const p = this.profile;
    this.advMax = Math.max(0, Math.min(11, p.mMaxStage));
    this.advDoor = this.advMax;
    this.advReveal = reveal ? { temple: Math.trunc(this.advMax / 3) + 1, stagger: -75 } : null;
    Audio2.song(SONGS.adventure);
    this.advButtons = [
      new ImgButton('IMAGE_ADVMAINMENUBUTTON', 0, 438, () => this.showMenu()),
      new ImgButton('IMAGE_ADVPLAYBUTTON', 542, 441, () => this.startAdventure(this.advDoor)),
    ];
  }
  doorRect(i) {
    const P = [[226, 300], [296, 270], [366, 300], [0, 164], [69, 159], [120, 155], [452, 154], [509, 154], [568, 154], [220, 35], [291, 35], [369, 35]];
    const m = IMG['IMAGE_ADVDOOR' + (Math.trunc(i / 3) + 1) + 'ABC'[i % 3]];
    return { x: P[i][0], y: P[i][1], w: m.w / 4, h: m.h, id: m };
  }
  doorAt(x, y) {
    for (let i = 0; i <= this.advMax && i < 12; i++) { const r = this.doorRect(i); if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) return i; }
    return -1;
  }
  advDown(x, y) {
    if (this.advReveal) return;
    for (const b of this.advButtons) if (b.hit(x, y)) { Audio2.play('BUTTON1'); b.onClick(); return; }
    const d = this.doorAt(x, y);
    if (d >= 0) { if (d === this.advDoor) this.startAdventure(d); else this.advDoor = d; }
  }
  drawAdventure() {
    const g = this.g, ctx = this.ctx;
    this.advCnt++;
    const sky = IMG.IMAGE_ADVSKY, ss = Math.trunc(this.advCnt / 4) % sky.w;
    ctx.drawImage(sky.img, ss - sky.w, 0); ctx.drawImage(sky.img, ss, 0); ctx.drawImage(sky.img, ss + sky.w, 0);
    g.img('IMAGE_ADVBACK', 0, 0); g.img('IMAGE_ADVTITLE', 0, 0); g.img('IMAGE_ADVHIGHSCORE', 456, 0);
    const R0 = this.advReveal, max = this.advMax;
    const hl = this.doorAt(this.mouse.x, this.mouse.y);
    const doors = (a, b) => {
      for (let i = a; i < b; i++) {
        const r = this.doorRect(i);
        const cel = i === this.advDoor ? 3 : i === hl ? 2 : i <= max ? 1 : 0;
        g.draw(r.id.img, cel * r.w, 0, r.w, r.h, r.x, r.y, r.w, r.h);
      }
    };
    if (R0) { R0.stagger++; if ((R0.temple === 4 && R0.stagger > 300) || (R0.temple !== 4 && R0.stagger > 100)) { this.advReveal = null; this.onRevealDone && this.onRevealDone(); } }
    const rv = this.advReveal;
    // temple 4
    if (rv && rv.temple === 4) {
      if (rv.stagger >= 0) { const y = 300 - rv.stagger, y2 = Math.trunc(y * y / 300); ctx.save(); ctx.translate(0, y2); g.img('IMAGE_ADVTEMPLE4', 174, 1); doors(9, 12); ctx.restore(); }
      g.img('IMAGE_ADVMIDDLE', 0, 72);
    } else if (max >= 9) { g.img('IMAGE_ADVTEMPLE4', 174, 1); doors(9, 12); g.img('IMAGE_ADVMIDDLE', 0, 72); }
    const fadeT = (n, vid, id, x, y, a, b, need) => {
      if (rv && rv.temple === n) {
        const c = Math.max(0, Math.trunc(255 * rv.stagger / 100));
        g.img(vid, x, y, { alpha: 255 - c }); g.img(id, x, y, { alpha: Math.min(255, c) }); doors(a, b);
      } else if (max < need) g.img(vid, x, y);
      else { g.img(id, x, y); doors(a, b); }
    };
    fadeT(3, 'IMAGE_ADVTEMPLE3V', 'IMAGE_ADVTEMPLE3', 395, 125, 6, 9, 6);
    fadeT(2, 'IMAGE_ADVTEMPLE2V', 'IMAGE_ADVTEMPLE2', 0, 112, 3, 6, 3);
    g.img('IMAGE_ADVTEMPLE1', 0, 188); doors(0, 3);
    const TN = ['TEMPLE OF ZUKULKAN', 'QUETZAL QUATL', 'POPO POYOLLI', 'SECRET SHRINE OF ZUMA'];
    const SN = ['DO YOU DARE ENTER THE ANCIENT RUINS?', 'THE 2ND LEVEL OF THE TEMPLE AWAITS.', 'WILL YOU DESCEND TO THE THIRD LEVEL?',
      'YOU HAVE UNCOVERED A HIDDEN DOOR!', 'THE GOLDEN SECRETS OF ZUMA AWAIT YOU.', 'DO YOU DARE ENTER THE LAST CHAMBER?',
      'ANOTHER LOST TEMPLE...', 'CAN YOU FULFILL THE PROPHECY?', 'THE LAST STAGE (?)', 'A RUINED TEMPLE RISES FROM THE EARTH.',
      'THE FINAL SECRET OF ZUMA BECKONS...', 'YOU ENTER THE RUINS ONE LAST TIME...'];
    if (this.advDoor >= 0) {
      g.img('IMAGE_ADVSTAGE', 289, 382);
      g.text('DIALOG', String(this.advDoor + 1), 344, 396, 0xFBF1B0);
      const tn = TN[Math.trunc(this.advDoor / 3)];
      g.text('BROWNTITLE', tn, 326 - Math.trunc(g.width('BROWNTITLE', tn) / 2), 422, 0xFFFFFF);
      const sn = SN[this.advDoor];
      g.text('MAIN10OUTLINE2', sn, 326 - Math.trunc(g.width('MAIN10OUTLINE2', sn) / 2), 456, 0xFFEA01);
    }
    g.text('MAIN8OUTLINE', 'Uncover the secret', 20, 74, 0x28534C);
    g.text('MAIN8OUTLINE', 'temples of Zuma!', 20, 88, 0x28534C);
    for (const b of this.advButtons) b.draw(g, this.mouse.x, this.mouse.y, this.mouse.down);
  }

  // ---------------------------------------------------------------- board (human play)
  startAdventure(stage) {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    const game = new Z.Game({ seed, visual: true, soundSink: makeSoundSink(this) });
    game.profile = this.profile;
    game.listeners = [(ev, arg) => this.onGameEvent(ev, arg)];
    game.startAdventure(stage);
    this.game = game;
    this.screen = 'board';
    this.paused = false;
    this.pendingEvents = [['m', this.mouse.x, this.mouse.y]];
    Audio2.song(SONGS.main);
  }
  onGameEvent(ev, arg) {
    if (ev === 'reset' || ev === 'levelUp') saveProfile(this.profile);
    if (ev === 'templeReveal' && this.screen === 'board') {
      saveProfile(this.profile);
      const game = this.game;
      this.showAdventure(true);
      this.onRevealDone = () => { this.onRevealDone = null; this.screen = 'board'; this.game = game; game.tick([['next']]); Audio2.song(SONGS.main); };
    }
    if (ev === 'gameEnd') { saveProfile(this.profile); if (arg === 'final') this.screen = 'credits'; else this.showAdventure(false); }
  }
  boardDown(x, y, button) {
    const b = this.game.board;
    if (this.paused) { this.paused = false; return; }
    if (x >= 540 && y >= 3 && x < 540 + 96 && y < 3 + 26 && !b.statsDialog) { this.paused = true; return; }
    if (b.statsDialog) {
      const r = this.statsOkRect();
      if (r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) this.pendingEvents.push(['ok']);
      return;
    }
    if (b.continueVisible) { if (x >= 410 && y >= 412 && x < 610 && y < 450) this.pendingEvents.push(['cont']); return; }
    this.pendingEvents.push(['m', x, y]);
    this.pendingEvents.push([button === 2 ? 'r' : 'l']);
  }
  statsOkRect() {
    const d = this.statsLayout();
    return d ? { x: d.x + 30, y: d.y + d.h - 62, w: d.w - 60, h: 38 } : null;
  }
  statsLayout() {
    const b = this.game.board, sd = b.statsDialog;
    if (!sd) return null;
    const w = 460, h = 360 + (sd.kind === 'gameover' ? -40 : 0);
    const ty = Math.trunc((480 - h) / 2), y0 = h + 480;
    const k = Math.min(20, this.game.appTick - sd.openTick);
    const y = Math.trunc(((ty - y0) * k + 20 * y0) / 20);
    return { x: Math.trunc((640 - w) / 2), y, w, h };
  }
  drawDialogBox(x, y, w, h) {
    const m = IMG.IMAGE_DIALOG_BACK, g = this.g;
    if (!m) return;
    // 9-slice with the original insets of the dialog image
    const L = 40, T = 100, Rr = 40, B = 40;
    const sw = m.w, sh = m.h;
    const parts = [[0, 0, L, T, x, y, L, T], [L, 0, sw - L - Rr, T, x + L, y, w - L - Rr, T], [sw - Rr, 0, Rr, T, x + w - Rr, y, Rr, T],
      [0, T, L, sh - T - B, x, y + T, L, h - T - B], [L, T, sw - L - Rr, sh - T - B, x + L, y + T, w - L - Rr, h - T - B], [sw - Rr, T, Rr, sh - T - B, x + w - Rr, y + T, Rr, h - T - B],
      [0, sh - B, L, B, x, y + h - B, L, B], [L, sh - B, sw - L - Rr, B, x + L, y + h - B, w - L - Rr, B], [sw - Rr, sh - B, Rr, B, x + w - Rr, y + h - B, Rr, B]];
    for (const p of parts) g.draw(m.img, ...p);
  }
  drawStats() {
    const b = this.game.board, sd = b.statsDialog, g = this.g;
    if (!sd) return;
    this.g.fill(0, Math.min(128, (this.game.appTick - sd.openTick) * 6), 0, 0, 640, 480);
    const d = this.statsLayout();
    this.drawDialogBox(d.x, d.y, d.w, d.h);
    g.img('IMAGE_GOD_HEAD', d.x + Math.trunc((d.w - IMG.IMAGE_GOD_HEAD.w) / 2), d.y - 30);
    const hdr = sd.kind === 'level' ? 'STATS' : sd.kind === 'final' ? 'WINNING TOTALS' : 'GAME OVER';
    g.text('TITLE', hdr, d.x + Math.trunc((d.w - g.width('TITLE', hdr)) / 2), d.y + 85, 0xD5E520);
    const top = d.y + 112, c1 = d.x + 34, c2 = c1 + 130, c3 = c1 + 210, c4 = c1 + 310;
    const lo = 6 + F.getFont('MAIN12').GetLineSpacing();
    const ls = b.mLevelStats, T = R.timeStr;
    if (sd.kind === 'level') {
      ['POINTS', 'COMBOS', 'COINS', 'GAPS', 'MAX CHAIN', 'MAX COMBO'].forEach((s, i) => g.text('MAIN12', s, c1, top + i * lo, 0xFFFF00));
      [sd.score, ls.mNumCombos, ls.mNumGemsCleared, ls.mNumGaps, ls.mMaxInARow, ls.mMaxCombo + 1].forEach((v, i) => g.text('MAIN12', String(v), c2, top + i * lo, 0xFFA500));
      g.text('MAIN12', 'YOUR TIME', c3, top, 0xFFFF00); g.text('MAIN12', 'ACE TIME', c3, top + lo, 0xFFFF00);
      g.fill(0xFFFF00, 255, c3, top + lo + 4, 160, 1);
      g.text('MAIN12', T(Math.trunc(ls.mTimePlayed / 100)), c4, top, sd.bonus > 0 ? 0x2AFF03 : 0xFFA500);
      g.text('MAIN12', T(b.mLevelDesc.mParTime), c4, top + lo, 0xFFA500);
      if (sd.bonus <= 0) g.text('MAIN12', 'NO TIME BONUS', c3, 4 + top + 2 * lo, 0x9DCBA2);
      else if (sd.paid > 0) g.text('MAIN12', 'BONUS +' + sd.paid, c3, 4 + top + 2 * lo, 0x2AFF03);
    } else {
      const gs = b.mGameStats;
      let t2 = top;
      if (sd.kind === 'final') { g.text('MAIN12', 'EXTRA LIFE BONUS', c1, t2, 0xFFFF00); if (sd.paid > 0) g.text('MAIN12', '+' + sd.paid, c3, t2, 0x2AFF03); t2 += 2 * lo; }
      ['TOTAL TIME', 'COMBOS', 'COINS'].forEach((s, i) => g.text('MAIN12', s, c1, t2 + i * lo, 0xFFFF00));
      ['GAPS', 'MAX CHAIN', 'MAX COMBO'].forEach((s, i) => g.text('MAIN12', s, c3, t2 + i * lo, 0xFFFF00));
      [T(Math.trunc(gs.mTimePlayed / 100)), gs.mNumCombos, gs.mNumGemsCleared].forEach((v, i) => g.text('MAIN12', String(v), c1 + 120, t2 + i * lo, 0xFFA500));
      [gs.mNumGaps, gs.mMaxInARow, gs.mMaxCombo + 1].forEach((v, i) => g.text('MAIN12', String(v), c1 + 340, t2 + i * lo, 0xFFA500));
    }
    const ok = this.statsOkRect();
    const over = this.mouse.x >= ok.x && this.mouse.y >= ok.y && this.mouse.x < ok.x + ok.w && this.mouse.y < ok.y + ok.h;
    this.br.drawButton('OK', ok.x, ok.y, ok.w, ok.h, over);
  }
  drawPause() {
    this.g.fill(0, 128, 0, 0, 640, 480);
    const t = 'PAUSED', w = this.g.width('HUGE', t);
    this.g.text('HUGE', t, Math.trunc((640 - w) / 2), 240, 0xFFFFFF);
    this.cjk('点击继续　·　空格暂停', 320, 300, 14, '#fff', 'center');
  }

  // ---------------------------------------------------------------- TAS replay
  showTasMenu() { this.screen = 'tasmenu'; Audio2.song(SONGS.menu); }
  movie() { return G.TAS_MOVIE || null; }
  drawTasMenu() {
    const ctx = this.ctx, g = this.g, M = this.movie();
    const sky = IMG.IMAGE_MM_SKY;
    ctx.drawImage(sky.img, 0, 0); ctx.drawImage(sky.img, sky.w, 0);
    g.img('IMAGE_MM_BACK', 0, 0);
    g.fill(0, 170, 0, 0, 640, 480);
    this.cjk('Claude TAS 速通回放', 320, 50, 26, '#ffe680', 'center');
    if (!M) { this.cjk('未找到 TAS 录像（tas/movie.js）', 320, 200, 16, '#fff', 'center'); this.tasItems = []; return; }
    const lines = [
      `种子 seed = ${M.seed}　·　${M.levels.length} 关　·　100 Hz 逐帧输入 ${M.inputCount || ''} 条`,
      `游戏内总时间 ${fmtT(M.totalPlayTicks)}　·　含过场（RTA 估算）${fmtT(M.totalRtaTicks)}`,
    ];
    // the movie note can be long: wrap at a ' · ' separator near the middle
    const note = M.note || '', parts = note.split(' · ');
    if (parts.length > 2) { const h = Math.ceil(parts.length / 2); lines.push(parts.slice(0, h).join(' · '), parts.slice(h).join(' · ')); }
    else if (note) lines.push(note);
    lines.forEach((l, i) => this.cjk(l, 320, 84 + i * 19, 12, '#ddd', 'center'));
    this.tasItems = [];
    const items = [['从头观看完整速通', 0]];
    for (let s = 0; s < 13; s++) {
      const li = M.levels.findIndex(L => L.stage === s);
      if (li >= 0) items.push([`从第 ${s + 1} 大关开始（${M.levels[li].name}）`, li]);
    }
    items.forEach(([t, li], i) => {
      const col = i < 7 ? 0 : 1, row = i < 7 ? i : i - 7;
      const x = 60 + col * 270, y = 170 + row * 38, w = 250, h = 30;
      const over = this.mouse.x >= x && this.mouse.y >= y && this.mouse.x < x + w && this.mouse.y < y + h;
      g.fill(over ? 0x806020 : 0x303030, 220, x, y, w, h);
      this.cjk(t, x + w / 2, y + h / 2, 13, over ? '#fff' : '#ffe680', 'center');
      this.tasItems.push({ x, y, w, h, li });
    });
    const bx = 330, by = 440, bw = 120, bh = 28;
    g.fill(0x303030, 220, bx, by, bw, bh);
    this.cjk('返回主菜单', bx + bw / 2, by + bh / 2, 13, '#fff', 'center');
    this.tasItems.push({ x: bx, y: by, w: bw, h: bh, back: true });
    // documentation (Chinese / English) in a new tab
    const dx = 160, dw = 160, dover = this.mouse.x >= dx && this.mouse.y >= by && this.mouse.x < dx + dw && this.mouse.y < by + bh;
    g.fill(dover ? 0x806020 : 0x604010, 230, dx, by, dw, bh);
    this.cjk('项目说明 / Docs', dx + dw / 2, by + bh / 2, 13, '#ffe680', 'center');
    this.tasItems.push({ x: dx, y: by, w: dw, h: bh, doc: true });
  }
  tasMenuDown(x, y) {
    for (const it of this.tasItems || []) if (x >= it.x && y >= it.y && x < it.x + it.w && y < it.y + it.h) {
      Audio2.play('BUTTON1');
      if (it.back) this.showMenu();
      else if (it.doc) window.open('docs/tas_doc.html', '_blank');
      else this.startTas(it.li);
      return;
    }
  }
  startTas(fromLevel) {
    const M = this.movie();
    const game = new Z.Game({ seed: M.seed, visual: false, soundSink: null });
    game.profile = { mMaxLevel: 0, mMaxStage: 0 };
    game.startAdventure(0);
    this.tas = { game, M, idx: 0, frame: 0, level: 0, splits: [], seekTo: fromLevel, mouse: [320, 240], clicks: [], speed: 1, paused: false, snaps: [], snapNext: 0 };
    if (!fromLevel) this.tas.snaps[0] = { game: game.clone(), idx: 0 };
    this.screen = 'tas';
    this.tasSeek();
  }
  // fast-forward (headless) until the requested level begins, then switch on visuals/sound
  tasSeek() {
    const T = this.tas;
    if (!T.seekTo) { this.tasVisualOn(); return; }
    const target = T.M.levels[T.seekTo].startTick;
    while (T.frame < target) this.tasStep(true);
    this.tasVisualOn();
  }
  tasVisualOn() {
    const T = this.tas;
    T.game.visual = true;
    T.game.soundSink = makeSoundSink(this);
    T.game.listeners = [(ev) => { if (ev === 'templeReveal') T.reveal = 1; }];
    Audio2.song(SONGS.main);
  }
  tasStep(headless) {
    const T = this.tas, M = T.M, ev = M.events;
    const evs = [];
    while (T.idx < ev.length && ev[T.idx][0] === T.frame) { for (const e of ev[T.idx][1]) evs.push(e); T.idx++; }
    for (const e of evs) { if (e[0] === 'm') T.mouse = [e[1], e[2]]; if (e[0] === 'l' || e[0] === 'r') T.clicks.push({ x: T.mouse[0], y: T.mouse[1], t: 30, r: e[0] === 'r' }); }
    T.game.tick(evs);
    T.frame++;
    // snapshot at every level start (for "restart this level")
    const Ls = M.levels;
    while (T.snapNext < Ls.length && Ls[T.snapNext].startTick < T.frame) T.snapNext++;
    if (T.snapNext < Ls.length && Ls[T.snapNext].startTick === T.frame) { T.snaps[T.snapNext] = { game: T.game.clone(), idx: T.idx }; T.snapNext++; }
  }
  // replay the current level again from its start (state snapshot taken when the replay passed it)
  tasRestartLevel() {
    const T = this.tas, li = this.tasLevelIndex(), S = T.snaps[li];
    if (!S) { this.startTas(li); return; }
    Audio2.stopAll();
    T.game = S.game.clone(); T.idx = S.idx; T.frame = T.M.levels[li].startTick;
    T.clicks = []; T.reveal = 0; T.done = false;
    this.tasVisualOn();
  }
  tasDown(x, y, button) {
    const T = this.tas;
    // control bar
    for (const b of this.tasButtons || []) if (x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h) { b.on(); return; }
  }
  tasKey(e) {
    const T = this.tas;
    if (e.key === ' ') { T.paused = !T.paused; e.preventDefault(); }
    else if (e.key === 'ArrowRight') { if (T.paused) this.tasStep(); }
    else if (e.key === '+' || e.key === '=') T.speed = Math.min(16, T.speed * 2);
    else if (e.key === '-') T.speed = Math.max(0.125, T.speed / 2);
    else if (e.key === 'r' || e.key === 'R') this.tasRestartLevel();
    else if (e.key === 'Escape') { Audio2.stopAll(); this.showTasMenu(); }
  }
  drawTasOverlay() {
    const T = this.tas, g = this.g, b = T.game.board, M = T.M, ctx = this.ctx;
    // virtual mouse of the TAS + recent clicks
    const [mx, my] = T.mouse;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mx - 7, my); ctx.lineTo(mx + 7, my); ctx.moveTo(mx, my - 7); ctx.lineTo(mx, my + 7); ctx.stroke();
    for (const c of T.clicks) {
      ctx.strokeStyle = c.r ? `rgba(80,200,255,${c.t / 30})` : `rgba(255,220,80,${c.t / 30})`;
      ctx.beginPath(); ctx.arc(c.x, c.y, 4 + (30 - c.t) * 0.5, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    // info panel
    const li = this.tasLevelIndex();
    const L = M.levels[li];
    const lvTime = b.mGameState === Z.ST_PLAYING ? b.mStateCount : (L && T.frame >= L.endTick ? L.playTicks : 0);
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(4, 34, 200, 62);
    this.cjk(`TAS  ${L ? L.label : ''}  ${L ? L.name : ''}`, 10, 46, 12, '#ffe680');
    const wr = L ? wrText(L.label) : null;
    this.cjk(`本关用时 ${fmtT(lvTime)}${wr ? `  (WR ${wr})` : ''}`, 10, 64, 12, '#fff');
    this.cjk(`总时间 ${fmtT(T.frame)}   速度 ×${T.speed}${T.paused ? ' 暂停' : ''}`, 10, 82, 12, '#aef');
    // control buttons
    this.tasButtons = [];
    const btn = (label, x, on) => { const y = 456, w = 54, h = 20; g.fill(0x202020, 200, x, y, w, h); this.cjk(label, x + w / 2, y + h / 2, 11, '#fff', 'center'); this.tasButtons.push({ x, y, w, h, on }); };
    btn(T.paused ? '继续' : '暂停', 6, () => { T.paused = !T.paused; });
    btn('单帧', 62, () => { if (T.paused) this.tasStep(); });
    btn('减速', 118, () => { T.speed = Math.max(0.125, T.speed / 2); });
    btn('加速', 174, () => { T.speed = Math.min(16, T.speed * 2); });
    btn('本关重开', 230, () => this.tasRestartLevel());
    btn('退出', 286, () => { Audio2.stopAll(); this.showTasMenu(); });
  }
  tasLevelIndex() {
    const T = this.tas, Ls = T.M.levels;
    let i = 0;
    while (i + 1 < Ls.length && T.frame >= Ls[i + 1].startTick) i++;
    return i;
  }

  // headless stepping for tests (the preview pane may not run rAF)
  step(n, events) {
    for (let i = 0; i < n; i++) {
      if (this.screen === 'board') { const ev = i === 0 && events ? events : this.pendingEvents; this.pendingEvents = []; this.game.tick(ev); }
      else if (this.screen === 'tas') { if (this.tas.reveal) { this.tas.reveal++; if (this.tas.reveal > 196) this.tas.reveal = 0; continue; } this.tasStep(); }
    }
    this.render();
  }

  // ---------------------------------------------------------------- loop
  frame(t) {
    let dt = Math.min(250, t - this.last);
    this.last = t;
    if (this.screen === 'board' && this.game && !this.paused) {
      this.acc += dt;
      while (this.acc >= 10) {
        this.acc -= 10;
        const ev = this.pendingEvents; this.pendingEvents = [];
        this.game.tick(ev);
      }
    } else if (this.screen === 'tas' && this.tas && !this.tas.paused && !this.tas.done) {
      this.acc += dt * this.tas.speed;
      let n = 0;
      while (this.acc >= 10 && n < 400) {
        this.acc -= 10; n++;
        if (this.tas.reveal) { this.tas.reveal++; if (this.tas.reveal > 196) this.tas.reveal = 0; else continue; }
        if (this.tas.idx >= this.tas.M.events.length && this.tas.game.board.statsDialog && this.tas.game.board.statsDialog.kind === 'final') { this.tas.done = true; break; }
        this.tasStep();
      }
      for (const c of this.tas.clicks) c.t -= dt / 10 * this.tas.speed;
      this.tas.clicks = this.tas.clicks.filter(c => c.t > 0);
    } else this.acc = 0;
    this.render();
    requestAnimationFrame(tt => this.frame(tt));
  }
  render() {
    const ctx = this.ctx, g = this.g;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 640, 480);
    if (this.screen === 'loading') {
      const L = IMG.IMAGE_LOADING_SCREEN;
      if (L && L.img) ctx.drawImage(L.img, 0, 0);
      const B = IMG.IMAGE_LOADERBAR;
      if (B && B.img) ctx.drawImage(B.img, 0, 0, Math.max(1, B.w * this.loadPct), B.h, 108, 440, Math.max(1, B.w * this.loadPct), B.h);
      this.cjk(this.loaded ? '点击开始' : '载入中…', 320, 420, 16, '#fff', 'center');
      return;
    }
    if (this.screen === 'menu') return this.drawMenu();
    if (this.screen === 'adventure') return this.drawAdventure();
    if (this.screen === 'tasmenu') return this.drawTasMenu();
    if (this.screen === 'credits') {
      g.img('IMAGE_HAPPYENDING', 0, 0);
      this.cjk('恭喜通关！点击返回主菜单', 320, 460, 16, '#fff', 'center');
      return;
    }
    if (this.screen === 'board') {
      const b = this.game.board;
      const ui = { menuOver: this.mouse.x >= 540 && this.mouse.y >= 3 && this.mouse.x < 636 && this.mouse.y < 29,
        contOver: this.mouse.x >= 410 && this.mouse.y >= 412 && this.mouse.x < 610 && this.mouse.y < 450 };
      this.br.drawBoard(this.game, ui);
      if (b.statsDialog) this.drawStats();
      else if (this.paused) this.drawPause();
      return;
    }
    if (this.screen === 'tas') {
      const T = this.tas, b = T.game.board;
      if (T.reveal) {
        g.fill(0, 255, 0, 0, 640, 480);
        this.cjk('（冒险地图：揭示下一座神庙）', 320, 240, 16, '#ffe680', 'center');
      } else {
        this.br.drawBoard(T.game, {});
        if (b.statsDialog) { const sv = this.game; this.game = T.game; this.drawStats(); this.game = sv; }
      }
      this.drawTasOverlay();
      if (T.done) this.cjk('TAS 结束 — 按 Esc 返回', 320, 200, 20, '#ffe680', 'center');
    }
  }
}

// WR time of a level in whole seconds, as the original stats box shows it (tas/wr_times.js)
function wrText(label) {
  const W = G.TAS_WR;
  if (W && W.dialog && W.dialog[label] !== undefined) return '0:' + String(W.dialog[label]).padStart(2, '0');
  return null;
}
function fmtT(ticks) {
  if (ticks === undefined || ticks === null) return '-';
  const cs = Math.round(ticks), s = Math.floor(cs / 100), m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

G.ZumaApp = { App, Audio2, fmtT };
})(window);
