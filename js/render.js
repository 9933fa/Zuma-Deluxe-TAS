// Renderer: draws the simulation state the way Board::Draw / TransitionMgr::Draw / CircleDialog do,
// using the original 640x480 assets (built by tools/build_assets.py).
(function (G) {
'use strict';
const Z = G.ZumaSim, F = G.ZumaFont;
const SEXY_PI = Z.SEXY_PI;

// ------------------------------------------------------------------------------------------ assets
const IMG = {};        // id -> {img, w, h, rows, cols}
const LIMG = {};       // level image key -> {img, w, h}
function loadAssets(onProgress) {
  const D = G.GAMEDATA;
  const jobs = [];
  const load = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = 'assets/' + src; });
  for (const id in D.images) { const m = D.images[id]; jobs.push(load(m.file).then(im => { IMG[id] = Object.assign({ img: im }, m); })); }
  for (const k in D.levelImages) { const m = D.levelImages[k]; jobs.push(load(m.file).then(im => { LIMG[k] = Object.assign({ img: im }, m); })); }
  const fontImgs = new Set();
  for (const f in D.fonts) for (const L of D.fonts[f].layers) fontImgs.add(L.image);
  for (const f of fontImgs) jobs.push(load(f).then(im => { LIMG[f] = { img: im, w: im ? im.width : 0, h: im ? im.height : 0 }; }));
  let done = 0;
  for (const j of jobs) j.then(() => { done++; if (onProgress) onProgress(done / jobs.length); });
  return Promise.all(jobs);
}

function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }

// colorize cache: image * color (SetColorizeImages)
const TINT = new Map();
function tinted(img, rgb) {
  if (!img) return null;
  rgb &= 0xffffff;
  if (rgb === 0xffffff) return img;
  let m = TINT.get(img);
  if (!m) { m = new Map(); TINT.set(img, m); }
  let c = m.get(rgb);
  if (c) return c;
  c = mkCanvas(img.width, img.height);
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = '#' + rgb.toString(16).padStart(6, '0');
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(img, 0, 0);
  m.set(rgb, c);
  return c;
}
// CutoutImageFromAlpha(bg, alpha, x, y)
function cutout(bg, alphaImg, x, y, w, h) {
  const c = mkCanvas(w, h), cx = c.getContext('2d');
  if (bg) cx.drawImage(bg, -x, -y);
  if (alphaImg) { cx.globalCompositeOperation = 'destination-in'; cx.drawImage(alphaImg, 0, 0); }
  return c;
}
function hex(rgb, a) {
  const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
  return a === undefined ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a / 255})`;
}

class Gfx {
  constructor(ctx) { this.ctx = ctx; }
  cel(id, x, y, cel, opts) {
    const m = IMG[id]; if (!m || !m.img) return;
    const cw = m.w / m.cols, ch = m.h / m.rows;
    const cx = (m.cols > 1 ? cel % m.cols : 0) * cw, cy = (m.rows > 1 ? cel : 0) * ch;
    this.draw(m.img, cx, cy, cw, ch, x, y, cw, ch, opts);
  }
  img(id, x, y, opts) { const m = IMG[id]; if (!m || !m.img) return; this.draw(m.img, 0, 0, m.w, m.h, x, y, m.w, m.h, opts); }
  draw(img, sx, sy, sw, sh, dx, dy, dw, dh, opts) {
    const c = this.ctx;
    if (sw <= 0 || sh <= 0) return;
    let src = img;
    let alpha = 1, add = false;
    if (opts) {
      if (opts.color !== undefined) src = tinted(img, opts.color);
      if (opts.alpha !== undefined) alpha = opts.alpha / 255;
      add = !!opts.add;
    }
    if (alpha <= 0) return;
    c.save();
    if (alpha < 1) c.globalAlpha = alpha;
    if (add) c.globalCompositeOperation = 'lighter';
    if (opts && opts.rot !== undefined) {
      const rcx = opts.rcx !== undefined ? opts.rcx : dw / 2, rcy = opts.rcy !== undefined ? opts.rcy : dh / 2;
      c.translate(dx + rcx, dy + rcy);
      c.rotate(-opts.rot);
      if (opts.scale) c.scale(opts.scale, opts.scale);
      c.drawImage(src, sx, sy, sw, sh, -rcx, -rcy, dw, dh);
    } else c.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
    c.restore();
  }
  fill(rgb, a, x, y, w, h, add) {
    const c = this.ctx;
    c.save();
    if (add) c.globalCompositeOperation = 'lighter';
    c.fillStyle = hex(rgb, a); c.fillRect(x, y, w, h);
    c.restore();
  }
  text(fontId, s, x, y, rgb, alpha) {
    const f = F.getFont(fontId);
    const col = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, alpha === undefined ? 255 : alpha];
    for (const cmd of f.layout(x, y, s, col)) {
      const L = LIMG[cmd.img];
      if (!L || !L.img) continue;
      const rgbc = (cmd.color[0] << 16) | (cmd.color[1] << 8) | cmd.color[2];
      this.draw(L.img, cmd.sx, cmd.sy, cmd.sw, cmd.sh, cmd.dx, cmd.dy, cmd.sw, cmd.sh,
        { color: rgbc, alpha: cmd.color[3], add: cmd.mode === 1 });
    }
  }
  width(fontId, s) { return F.getFont(fontId).StringWidth(s); }
}

// ------------------------------------------------------------------------------------------ level art cache
class LevelArt {
  constructor(desc) {
    this.desc = desc;
    this.bg = mkCanvas(640, 480);
    const bx = this.bg.getContext('2d');
    if (desc.mImagePath) {
      const L = LIMG[desc.mImagePath.toLowerCase()];
      if (L && L.img) bx.drawImage(L.img, 0, 0);
    } else { bx.fillStyle = '#000'; bx.fillRect(0, 0, 640, 480); }
    this.sprites = [[], [], [], [], []];
    if (!desc.mInSpace) {
      for (const s of desc.mSprites) {
        const key = s.mImagePath.toLowerCase();
        const L = LIMG[key];
        if (!L || !L.img) continue;
        let im = L.img;
        if (s.mCutout) im = cutout(this.bg, L.img, s.x, s.y, L.w, L.h);
        if (s.mPriority < 0) bx.drawImage(im, s.x, s.y);
        else this.sprites[Math.min(4, s.mPriority)].push({ im, x: s.x, y: s.y });
      }
    }
    this.inSpace = desc.mInSpace;
    if (this.inSpace) {
      this.stars = [];
      for (let i = 0; i < 1000; i++) this.stars.push(this.newStar(Math.random() * 480));
    }
  }
  newStar(y) {
    const k = Math.floor(Math.random() * 3);
    return { x: Math.floor(Math.random() * 640), y, vy: [0.2, 0.6, 0.9][k], c: ['#404040', '#909090', '#ffffff'][k] };
  }
  updateStars() {
    if (!this.inSpace) return;
    this.stars = this.stars.filter(s => { s.y += s.vy; return s.y < 480; });
    while (this.stars.length < 1000) this.stars.push(this.newStar(0));
  }
}

// ------------------------------------------------------------------------------------------ board drawing
class BoardRenderer {
  constructor(ctx) {
    this.g = new Gfx(ctx);
    this.ctx = ctx;
    this.art = new Map();
    this.gunTop = null;
    this.bgSprCache = null;
  }
  artFor(desc) {
    const key = desc.mName + '|' + desc.mImagePath;
    let a = this.art.get(key);
    if (!a) { a = new LevelArt(desc); this.art.set(key, a); }
    return a;
  }
  shooterTop() {
    if (!this.gunTop) {
      const b = IMG.IMAGE_SHOOTER_BOTTOM, t = IMG.IMAGE_SHOOTER_TOP;
      if (!b || !b.img || !t || !t.img) return null;
      this.gunTop = cutout(b.img, t.img, 31, 12, t.w, t.h);
    }
    return this.gunTop;
  }

  drawBackground(board, desc) {
    const g = this.g, art = this.artFor(desc);
    if (art.inSpace) {
      const neb = IMG.IMAGE_NEBULA1;
      if (neb && neb.img) {
        const sc = Math.trunc((board.spriteUpdateCnt || 0) / 4) % neb.h;
        this.ctx.drawImage(neb.img, 0, sc - neb.h); this.ctx.drawImage(neb.img, 0, sc); this.ctx.drawImage(neb.img, 0, sc + neb.h);
        for (const s of art.stars) { this.ctx.fillStyle = s.c; this.ctx.fillRect(Math.trunc(s.x), Math.trunc(s.y), 1, 1); }
      } else { this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, 640, 480); }
    } else this.ctx.drawImage(art.bg, 0, 0);
    this.drawHoles(board, board.holes, board.mCurveMgr);
    return art;
  }
  // SpriteMgr::DrawBackground's hole loop (cover frame from the curve's hole percent, additive flash)
  drawHoles(board, holes, cms, gfx) {
    const g = gfx || this.g, HC = IMG.IMAGE_HOLE_COVER;
    (holes || []).forEach((h, hi) => {
      let pct = 0;
      for (const cm of cms || []) if (cm.holeIdx === hi) pct = Math.max(pct, cm.holePercent || 0);
      let fr = Math.trunc(HC.rows * pct); if (fr >= HC.rows) fr = HC.rows - 1;
      const drawHole = (opts) => {
        g.img('IMAGE_HOLE', h.x, h.y, Object.assign({ rot: h.rot }, opts || {}));
        g.cel('IMAGE_HOLE_COVER', h.x, h.y, fr, Object.assign({ rot: h.rot }, opts || {}));
      };
      drawHole();
      if (h.total > 0) drawHole({ add: true, color: (h.total << 16) | (h.total << 8) | h.total });
    });
  }

  drawBall(game, b, wpMgr) {
    const g = this.g, board = game.board;
    if (b.mClearCount !== 0) { this.drawExplosion(b); return; }
    this.doDrawBall(game, b);
    if (b.mPowerFade && (b.mPowerFade & 0x10) !== 0) this.doDrawBall(game, b, true);
    if (game.ballBlink) this.doDrawBall(game, b, true);
  }
  doDrawBall(game, b, add) {
    const g = this.g;
    const ids = ['BLUE', 'YELLOW', 'RED', 'GREEN', 'PURPLE', 'WHITE'];
    if (b.mPowerType === Z.PT_NONE) {
      const id = 'IMAGE_' + ids[b.mType] + '_BALL', m = IMG[id];
      if (!m) return;
      const fr = (b.mStartFrame + Math.trunc(b.mWayPoint)) % m.rows;
      g.cel(id, b.mx - 16, b.my - 16, ((fr % m.rows) + m.rows) % m.rows, { rot: b.mRotation, add });
      return;
    }
    const sc = game.board.mStateCount;
    if (b.mPowerType === Z.PT_BOMB) {
      const id = 'IMAGE_' + ids[b.mType] + '_BOMB', m = IMG[id];
      const x = Math.trunc(b.mx - Math.trunc(m.w / 2)), y = Math.trunc(b.my - Math.trunc(m.h / 2));
      g.img(id, x, y, { add });
      let a = sc % 50;
      if (a <= 9) a = 0; else if (a <= 24) a = Math.trunc((200 * a - 2000) / 15); else if (a <= 34) a = 200; else a = 200 - Math.trunc((200 * a - 7000) / 15);
      g.img('IMAGE_' + ids[b.mType] + '_LIGHT', x + 7, y + 9, { add: true, color: (a << 16) | (a << 8) | a });
      return;
    }
    const kind = b.mPowerType === Z.PT_SLOW ? 'SLOW' : b.mPowerType === Z.PT_ACC ? 'ACCURACY' : 'BACKWARDS';
    const id = 'IMAGE_' + ids[b.mType] + '_' + kind, m = IMG[id];
    const x = b.mx - Math.trunc(m.w / 2), y = b.my - Math.trunc(m.h / 2);
    g.img(id, x, y, { rot: b.mRotation + SEXY_PI / 2, add });
    const t = sc % 100;
    let a;
    if (t < 20) a = 0; else if (t < 50) a = Math.trunc((255 * t - 5100) / 30); else if (t < 70) a = 255; else a = 255 - Math.trunc((255 * t - 17850) / 30);
    g.img('IMAGE_' + kind + '_LIGHT', x, y, { rot: b.mRotation + SEXY_PI / 2, color: Z.DARK_BALL_COLORS[b.mType], alpha: a });
  }
  drawExplosion(b) {
    const g = this.g, m = IMG.IMAGE_GRAY_EXPLOSION;
    const ch = m.h / m.rows;
    const x = Math.trunc(b.mx - m.w / 2), y = Math.trunc(b.my - ch / 2);
    const cel = Math.trunc(b.mClearCount / 3);
    if (cel < m.rows) g.cel('IMAGE_GRAY_EXPLOSION', x, y, cel, { rot: (b.mStartFrame * SEXY_PI) / 25, color: Z.BRIGHT_BALL_COLORS[b.mType] });
    if (b.mParticles) {
      const c = Z.BRIGHT_BALL_COLORS[b.mType];
      const r = Math.min((c >> 16) & 455, 255), gg = Math.min((c >> 8) & 455, 255), bb = Math.min(c & 455, 255);
      const a = b.mClearCount > 20 ? 255 - Math.trunc((255 * b.mClearCount - 5100) / 20) : 255;
      this.ctx.fillStyle = `rgba(${r},${gg},${bb},${Math.max(0, a) / 255})`;
      for (const p of b.mParticles) this.ctx.fillRect(Math.trunc(b.mClearCount * p.vx + p.x), Math.trunc(b.mClearCount * p.vy + p.y), p.size, p.size);
    }
  }
  drawShadow(b) {
    if (b.mClearCount !== 0) return;
    const m = IMG.IMAGE_BALL_SHADOW;
    this.g.img('IMAGE_BALL_SHADOW', b.mx - Math.trunc(m.w / 2) - 3, b.my - Math.trunc(m.h / 2) + 5, { color: 0, alpha: 96 });
  }

  drawSparkles(pm, pri) {
    const L = pm.sparkles[pri];
    for (const s of L) {
      if (s.cnt < 0) continue;
      this.g.cel('IMAGE_SPARKLE', Math.trunc(s.x), Math.trunc(s.y), s.frame, { add: true, color: s.color });
    }
  }
  drawTopMost(board) {
    const pm = board.particles, g = this.g;
    this.drawSparkles(pm, 5);
    for (const e of pm.explosions) {
      if (e.cnt < 0) continue;
      const m = IMG.IMAGE_EXPLOSION;
      g.cel('IMAGE_EXPLOSION', e.x - Math.trunc(m.w / 2), e.y - Math.trunc(m.h / m.rows / 2), e.cnt >> 2, { add: true });
    }
    for (const t of pm.texts) {
      if (t.cnt < 0 || t.text === undefined) continue;
      const a = t.fade ? 255 - Math.trunc(255 * t.cnt / t.dur) : 255;
      g.text(t.font, t.text, t.x, t.y, t.color, a);
    }
  }

  drawGun(gun, opts) {
    const g = this.g;
    const cx = gun.mCenterX - 54, cy = gun.mCenterY - 54, ang = gun.mAngle;
    const scale = opts && opts.scale;
    const extra = opts && opts.add ? { add: true, color: 0xffffff, alpha: opts.alpha } : {};
    const R = (o) => Object.assign({ rot: ang }, extra, o);
    if (scale && scale !== 1) {
      // DrawCachedGunImage: whole frog scaled around its centre (no balls)
      this.ctx.save();
      this.ctx.translate(gun.mCenterX, gun.mCenterY); this.ctx.scale(scale, scale); this.ctx.translate(-gun.mCenterX, -gun.mCenterY);
      this.drawGun(Object.assign(Object.create(Object.getPrototypeOf(gun)), gun, { mBullet: null, mNextBullet: null, mBlinkCount: 0 }));
      this.ctx.restore();
      return;
    }
    g.img('IMAGE_SHOOTER_BOTTOM', cx, cy, R({ rcx: 54, rcy: 54 }));
    let off;
    if (gun.mState === Z.GS_NORMAL) off = 51;
    else if (gun.mState === Z.GS_FIRING) off = Math.trunc(gun.mStatePercent * 30 + (1 - gun.mStatePercent) * 51);
    else off = Math.trunc(gun.mStatePercent * 51 + (1 - gun.mStatePercent) * 30);
    let tongue = 17;
    if (gun.mBullet) tongue = 54 - off; else off = 37;
    g.img('IMAGE_SHOOTER_TONGUE', cx + 38, cy + off, R({ rcx: 16, rcy: tongue }));
    if (gun.mBullet) this.drawBulletBall(gun.mBullet);
    if (gun.mShowNextBall && gun.mNextBullet && gun.mState !== Z.GS_RELOADING) {
      const m = IMG.IMAGE_NEXT_BALL, w = m.w / 6;
      g.draw(m.img, gun.mNextBullet.mType * w, 0, w, m.h, cx + 47, cy + 22, w, m.h, R({ rcx: 7, rcy: 32 }));
    }
    const top = this.shooterTop();
    if (top) g.draw(top, 0, 0, top.width, top.height, cx + 31, cy + 12, top.width, top.height, R({ rcx: 23, rcy: 42 }));
    if (gun.mBlinkCount === 0) return;
    let blink = 0;
    if (gun.mBlinkCount > 4 && gun.mBlinkCount < 20) blink = 1;
    else if (gun.mBlinkCount > 24) return;
    const e = IMG.IMAGE_EYE_BLINK, eh = e.h / 2;
    g.draw(e.img, 0, blink * eh, e.w, eh, cx + 25, cy + 42, e.w, eh, R({ rcx: 29, rcy: 12 }));
  }
  drawBulletBall(b) {
    // Bullet::Draw -> Ball::Draw with waypoint 0
    const wp = b.mWayPoint; b.mWayPoint = 0;
    this.doDrawBall(this.game, b);
    b.mWayPoint = wp;
  }

  drawTreasure(board) {
    const g = this.g, tr = board.mCurTreasure;
    if (tr) {
      const fr = Math.trunc(board.mStateCount / 4) % 30;
      g.cel('IMAGE_COIN', tr.x - 28, tr.y - 8, fr, { color: 0, alpha: 96 });
      g.cel('IMAGE_COIN', tr.x - 18, tr.y - 18, fr);
    }
    if (board.mTreasureZoomFrame !== 0) {
      const m = IMG.IMAGE_COIN, z = board.mTreasureZoomFrame;
      const sc = 1 + z / 30, w = m.w, h = m.h / m.rows;
      const x = Math.trunc(board.mTreasureZoomX + sc * -18), y = Math.trunc(board.mTreasureZoomY + sc * -18);
      const off = z + Math.trunc((board.mStateCount - z + 1) / 4);
      g.draw(m.img, 0, h * (off % 30), w, h, Math.trunc(x + sc * -10), Math.trunc(y + sc * 10), w * sc, h * sc, { color: 0, alpha: 96 - Math.trunc(96 * z / 40) });
      g.draw(m.img, 0, h * (off % 30), w, h, x, y, w * sc, h * sc, { alpha: 255 - Math.trunc(255 * z / 40) });
    }
  }

  drawBalls(game, board) {
    // BallDrawer: per priority: sprites, particles, shadows, balls
    const balls = [[], [], [], [], []], shadows = [[], [], [], [], []];
    for (const cm of board.mCurveMgr) {
      const wp = cm.wp;
      for (const b of cm.mBallList) {
        const pri = wp.GetPriority(b);
        const nb = b.GetNextBall(true);
        const np = (nb && pri > wp.GetPriority(nb)) ? wp.GetPriority(nb) : pri;
        balls[pri].push(b); shadows[np].push(b);
      }
      for (const b of cm.mBulletList) { const pri = wp.GetPriorityBullet(b); balls[pri].push(b); shadows[pri].push(b); }
    }
    const art = this.artFor(board.mLevelDesc);
    for (let i = 0; i < 5; i++) {
      for (const s of art.sprites[i]) this.ctx.drawImage(s.im, s.x, s.y);
      this.drawSparkles(board.particles, i);
      for (const b of shadows[i]) this.drawShadow(b);
      for (const b of balls[i]) this.drawBall(game, b);
    }
  }

  drawText(board) {
    const g = this.g;
    if ((board.mLivesBlinkCount & 0x10) === 0) {
      let lives = board.mLives - 1;
      if (board.mGameState === Z.ST_LOSING) lives = board.mLives;
      let n = 0, xn = false;
      if (lives === 0) { const t = 'Last Life'; g.text('DIALOG', t, 64 - Math.trunc(g.width('DIALOG', t) / 2), 20, 0xFFFF00); }
      else if (lives <= 3) n = lives; else { n = 1; xn = true; }
      let fx = 28;
      for (let i = 0; i < n; i++) { g.img('IMAGE_FROG_LIVES', fx, 3); fx += 26; }
      if (xn) g.text('FLOAT', 'x' + lives, fx + 4, 22, 0xFFFF00);
    }
    g.text('DIALOG', board.mLevelString, 200 - Math.trunc(g.width('DIALOG', board.mLevelString) / 2), 15, 0xFFFF00);
    const sc = String(board.mScoreDisplay);
    g.text('MONODIGIT', sc, 360 - g.width('MONODIGIT', sc), 17, 0xFFFFFF);
    if (board.mScoreTarget - board.mLevelBeginScore > 0 && (board.mBarBlinkCount & 0x20) === 0) {
      let id = 'IMAGE_ZUMA_BAR';
      const bw = IMG.IMAGE_ZUMA_BAR.w;
      let w = (board.mCurBarSize * bw) >> 8;
      if (bw <= w || board.mGameState === Z.ST_LEVELUP) { id = 'IMAGE_ZUMA_BAR_DONE'; w = bw; }
      else if (board.mBarBlinkCount !== 0) id = 'IMAGE_ZUMA_BAR_DONE';
      const m = IMG[id];
      if (w > 0) g.draw(m.img, 0, 0, w, m.h, 409, 2, w, m.h);
    }
    if (board.showParTimer && board.mGameState === Z.ST_PLAYING) {
      let t = board.mLevelDesc.mParTime - Math.trunc(board.mStateCount / 100), over = false;
      if (t < 0) { t = Math.trunc(board.mStateCount / 100) - board.mLevelDesc.mParTime; over = true; }
      g.text('MAIN10OUTLINE', (over ? '-' : '') + timeStr(t), 580, 460, 0xFFFF00);
    }
  }

  drawLetterStamps(board) {
    const g = this.g;
    for (const st of board.vis.stamps) {
      if (st.cnt < 0) continue;
      const f = F.getFont(st.font);
      if (!st.img) {
        st.img = mkCanvas(f.StringWidth(st.text) + 10, f.GetHeight() + 10);
        new Gfx(st.img.getContext('2d')).text(st.font, st.text, 5, f.GetAscent(), st.color);
      }
      const px = st.x - 5, py = st.y - f.GetAscent();
      const rem = st.dur - st.cnt;
      if (st.cnt >= 30 && (rem < 0 || rem >= 10)) { this.ctx.drawImage(st.img, px, py); continue; }
      let sc;
      if (rem < 0 || rem >= 10) {
        if (st.cnt >= 10) { const b = st.cnt - 10, a = 20 - b; sc = (a * 1.1 + b) / 20; }
        else sc = st.cnt * 0.6 / 10 + 0.5;
      } else sc = 0.5 + rem / 20;
      if (sc <= 0.01) continue;
      const w = st.img.width, h = st.img.height, sw = Math.trunc(w * sc), sh = Math.trunc(h * sc);
      this.ctx.drawImage(st.img, 0, 0, w, h, px + Math.trunc(w / 2) - Math.trunc(sw / 2), py + Math.trunc(h / 2) - Math.trunc(sh / 2), sw, sh);
    }
  }
  drawLevelFade(board) { if (board.tr.levelFade) this.g.fill(0, board.tr.levelFade, 0, 0, 640, 480); }
  drawFrog(board) {
    const s = board.tr.curFrogScale;
    if (s === 1 || s === undefined) this.drawGun(board.gun);
    else if (s > 0.01) this.drawGun(board.gun, { scale: s });
  }

  bgTransitionSprites(board) {
    const V = board.vis;
    if (!V.bgSprites) return null;
    if (this.bgSprCache && this.bgSprCache.src === V.bgSprites) return this.bgSprCache.imgs;
    const art = this.artFor(V.bgSource || board.mLevelDesc);
    const full = mkCanvas(640, 480), fx = full.getContext('2d');
    if (art.bg) fx.drawImage(art.bg, 0, 0);
    this.drawHoles(board, board.holes, board.mCurveMgr, new Gfx(fx));
    const imgs = V.bgSprites.map(sp => {
      const L = LIMG[sp.mask];
      const cut = cutout(full, L && L.img, sp.mx, sp.my, sp.mw, sp.mh);
      const c = mkCanvas(sp.w, sp.h), x = c.getContext('2d');
      x.drawImage(tinted(cut, 0x505050), sp.shadow[0], sp.shadow[1]);
      x.drawImage(cut, sp.img[0], sp.img[1]);
      return c;
    });
    this.bgSprCache = { src: V.bgSprites, imgs };
    return imgs;
  }

  drawStageCompleteText(board) {
    const tr = board.tr, g = this.g;
    if (tr.state === Z.TS_STAGECOMPLETE) {
      if (tr.count < tr.stageCompleteFrame || tr.count > tr.stageCompleteFrame + 150) return;
      if (tr.count - tr.stageCompleteFrame < 50) {
        this.ctx.save(); this.ctx.beginPath(); this.ctx.rect(0, 0, board.gun.mCenterX, 480); this.ctx.clip();
        const w = g.width('HUGE', 'COMPLETE');
        g.text('HUGE', 'COMPLETE', 320 - Math.trunc(w / 2), 250, 0xFFFF00);
        this.ctx.restore();
        return;
      }
    }
    const w = g.width('HUGE', 'COMPLETE');
    g.text('HUGE', 'COMPLETE', 320 - Math.trunc(w / 2), 250, 0xFFFF00);
  }

  drawBoard(game, ui) {
    this.game = game;
    const board = game.board, g = this.g, ctx = this.ctx, tr = board.tr;
    const desc = board.mLevelDesc;
    if (!desc) return;
    const art = this.artFor(desc);
    if (!this.lastStarTick || this.lastStarTick !== board.spriteUpdateCnt) { art.updateStars(); this.lastStarTick = board.spriteUpdateCnt; }
    const st = board.mGameState;
    if (st === Z.ST_LOSING) {
      this.drawBackground(board, desc);
      if (board.mPauseCount === 0) this.drawBalls(game, board);
      else { for (let i = 0; i < 5; i++) { for (const s of art.sprites[i]) ctx.drawImage(s.im, s.x, s.y); this.drawSparkles(board.particles, i); } }
      for (const b of board.mBulletList) this.drawShadow(b);
      for (const b of board.mBulletList) this.drawBulletBall(b);
      const gun = board.gun;
      if (tr.resetFrame === 0 || tr.resetFrame - tr.count > 200) {
        const saved = gun.mAngle;
        gun.mAngle = (tr.count * tr.count) / 2000 + (tr.curFrogAngle || 0);
        this.drawGun(gun);
        if (tr.count > 50) {
          let a = Math.trunc(255 * (tr.count - 50) / 200);
          if (a > 0) { if (a > 255) a = 255; this.drawGun(gun, { add: true, alpha: a }); }
        }
        gun.mAngle = saved;
      }
      this.drawLevelFade(board);
      this.drawSparkles(board.particles, 4);
      this.drawLetterStamps(board);
    } else if (st === Z.ST_LEVELUP) {
      if (tr.state === Z.TS_TEMPLECOMPLETE) this.drawTempleComplete(board);
      else if (tr.state === Z.TS_QUAKE) {
        if (!tr.doTempleUp) {
          const a = Math.trunc(255 * tr.count / 250);
          if (a >= 10) {
            const nd = board.mNextLevelDesc;
            this.drawBackgroundStatic(nd);
            this.drawHoles(board, this.holesOf(board, nd), null);
            if (a < 255) g.fill(0, 255 - a, 0, 0, 640, 480);
          } else g.fill(0, 255, 0, 0, 640, 480);
        } else g.fill(0, 255, 0, 0, 640, 480);
        const imgs = this.bgTransitionSprites(board);
        if (imgs) {
          board.vis.bgSprites.forEach((sp, i) => g.draw(imgs[i], 0, 0, imgs[i].width, imgs[i].height, Math.trunc(sp.x - sp.vx * 50), Math.trunc(sp.y - sp.vy * 50), imgs[i].width, imgs[i].height, { color: 0, alpha: 80 }));
          board.vis.bgSprites.forEach((sp, i) => ctx.drawImage(imgs[i], sp.x, sp.y));
        }
        this.drawLevelFade(board);
        if (tr.doStageUp && tr.count < 100) this.drawStageCompleteText(board);
        this.drawLetterStamps(board);
        this.drawSparkles(board.particles, 0);
        this.drawFrog(board);
        this.drawSparkles(board.particles, 4);
      } else {
        this.drawBackground(board, desc);
        this.drawLevelFade(board);
        if (tr.state === Z.TS_STAGECOMPLETE) this.drawStageCompleteText(board);
        this.drawLetterStamps(board);
        this.drawSparkles(board.particles, 0);
        this.drawFrog(board);
        this.drawSparkles(board.particles, 4);
      }
    } else if (st === Z.ST_LEVELBEGIN) {
      this.drawBackground(board, desc);
      for (let i = 0; i < 5; i++) { for (const s of art.sprites[i]) ctx.drawImage(s.im, s.x, s.y); this.drawSparkles(board.particles, i); }
      this.drawGun(board.gun);
      this.drawLevelFade(board);
      this.drawLetterStamps(board);
    } else {
      this.drawBackground(board, desc);
      if (board.mPauseCount === 0 || board.statsDialog) this.drawBalls(game, board);
      else for (let i = 0; i < 5; i++) for (const s of art.sprites[i]) ctx.drawImage(s.im, s.x, s.y);
      this.drawGun(board.gun);
      this.drawTreasure(board);
      if (board.mShowGuide && board.mGuide) {
        let a = 120;
        if (board.mAccuracyCount <= 300) a = Math.trunc(120 * board.mAccuracyCount / 300) + 8;
        ctx.fillStyle = `rgba(0,255,255,${a / 255})`;
        ctx.beginPath(); ctx.moveTo(...board.mGuide[0]); for (let i = 1; i < 4; i++) ctx.lineTo(...board.mGuide[i]); ctx.closePath(); ctx.fill();
      }
      for (const b of board.mBulletList) this.drawShadow(b);
      for (const b of board.mBulletList) this.drawBulletBall(b);
    }
    // border + HUD
    if (st !== Z.ST_LEVELUP || tr.state !== Z.TS_TEMPLECOMPLETE) {
      g.img('IMAGE_MENU_BAR', 0, 0);
    } else g.img('IMAGE_MENU_BAR', 0, 0);
    const mb = IMG.IMAGE_MENU_BUTTON;
    if (mb) g.draw(mb.img, (ui && ui.menuOver ? 1 : 0) * mb.w / 3, 0, mb.w / 3, mb.h, 540, 3, mb.w / 3, mb.h);
    this.drawText(board);
    // overlay: topmost particles
    this.drawTopMost(board);
    if (board.continueVisible) this.drawButton('CONTINUE', 410, 450 - 38, 200, 38, ui && ui.contOver);
  }
  holesOf(board, desc) {
    if (!this.holeCache) this.holeCache = new Map();
    const key = desc.mName + '|' + desc.mCurveDesc.map(c => c.mPath).join(',');
    let h = this.holeCache.get(key);
    if (!h) { h = board.computeHoles(desc); this.holeCache.set(key, h); }
    return h;
  }
  drawBackgroundStatic(desc) {
    const art = this.artFor(desc);
    if (art.inSpace) { this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, 640, 480); }
    else this.ctx.drawImage(art.bg, 0, 0);
  }
  drawTempleComplete(board) {
    const g = this.g, tr = board.tr;
    g.fill(0x000032, 255, 0, 0, 640, 480);
    const w = g.width('HUGE', 'CONGRATULATIONS!');
    g.text('HUGE', 'CONGRATULATIONS!', 320 - Math.trunc(w / 2), 120, 0xFFFF00);
    g.img('IMAGE_GOD_HEAD', Math.trunc(Math.cos(tr.count * SEXY_PI / 180 * 2) * 5 + 50), Math.trunc(Math.sin(tr.count * SEXY_PI / 180 * 2) * 5 + 160));
    if (tr.count > 0) {
      const gun = board.gun, sa = gun.mAngle;
      gun.mAngle = SEXY_PI * 2 / 3;
      this.drawGun(gun);
      gun.mAngle = sa;
    }
    for (const bl of board.vis.blurbs) {
      const n = bl.charNum + 1;
      if (n > 0) g.text(bl.font, n < bl.text.length ? bl.text.substr(0, n) : bl.text, bl.x, bl.y, bl.color);
    }
  }
  // DialogButton look: 3-slice image with label
  drawButton(label, x, y, w, h, over) {
    const g = this.g, m = IMG.IMAGE_DIALOG_BUTTON;
    if (!m) return;
    const cw = m.w / 3, sx = (over ? 1 : 0) * cw;
    const ew = 12;
    g.draw(m.img, sx, 0, ew, m.h, x, y, ew, h);
    g.draw(m.img, sx + ew, 0, cw - 2 * ew, m.h, x + ew, y, w - 2 * ew, h);
    g.draw(m.img, sx + cw - ew, 0, ew, m.h, x + w - ew, y, ew, h);
    const tw = g.width('MAIN12', label);
    const f = F.getFont('MAIN12');
    g.text('MAIN12', label, x + Math.trunc((w - tw) / 2), y + Math.trunc((h - f.GetHeight()) / 2) + f.GetAscent() + 1, over ? 0xFFFFFF : 0xEEDD99);
  }
}

function timeStr(t) {
  if (Math.trunc(t / 3600) > 0) return `${Math.trunc(t / 3600)}:${String(Math.trunc(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  return `${Math.trunc(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

G.ZumaRender = { loadAssets, IMG, LIMG, Gfx, BoardRenderer, tinted, cutout, mkCanvas, timeStr, hex };
})(typeof window !== 'undefined' ? window : global);
