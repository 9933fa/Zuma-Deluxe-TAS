// Zuma Deluxe game logic, ported line by line from the CircleShootApp decompilation
// (Board.cpp, CurveMgr.cpp, Ball.cpp, Bullet.cpp, Gun.cpp, WayPoint.cpp, CurveData.cpp,
//  LevelParser.cpp, TransitionMgr.cpp).  Pure simulation: no DOM, runs in Node and the browser.
// Floats that are `float` in the original are rounded with Math.fround so that the arithmetic
// follows single precision like the original executable.
(function (G) {
'use strict';

const f32 = Math.fround;
const SEXY_PI = f32(3.1415901);
const BALL_R = 16;               // GetDefaultBallRadius()
const MAX_GAP_SIZE = 300;
const PT_BOMB = 0, PT_SLOW = 1, PT_ACC = 2, PT_BACK = 3, PT_NONE = 4;  // PowerType_None == PowerType_Max == 4
const BALL_ROWS = [47, 50, 50, 50, 51, 50];  // frames of baBall<colour>.gif (resources.xml)

// ------------------------------------------------------------------------------------------
// MTRand (SexyAppFramework/MTRand.cpp)
// ------------------------------------------------------------------------------------------
class MTRand {
  constructor(seed) { this.mt = new Uint32Array(624); this.mti = 625; this.SRand(seed === undefined ? 4357 : seed); }
  SRand(seed) {
    seed = seed >>> 0;
    if (seed === 0) seed = 4357;
    const mt = this.mt;
    mt[0] = seed;
    for (let i = 1; i < 624; i++) {
      const s = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, s) + i) >>> 0;
    }
    this.mti = 624;
  }
  Next() {
    const mt = this.mt;
    let y;
    if (this.mti >= 624) {
      let kk;
      for (kk = 0; kk < 624 - 397; kk++) {
        y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + 397] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0);
      }
      for (; kk < 623; kk++) {
        y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + (397 - 624)] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0);
      }
      y = (mt[623] & 0x80000000) | (mt[0] & 0x7fffffff);
      mt[623] = mt[396] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0);
      this.mti = 0;
    }
    y = mt[this.mti++];
    y ^= (y >>> 11);
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= (y >>> 18);
    return (y & 0x7fffffff) >>> 0;
  }
}

// MSVC CRT rand() (per thread; the loader thread starts at the default seed 1)
class CRand {
  constructor(seed) { this.s = (seed === undefined ? 1 : seed) >>> 0; }
  next() { this.s = (Math.imul(this.s, 214013) + 2531011) >>> 0; return (this.s >>> 16) & 0x7fff; }
}

// ------------------------------------------------------------------------------------------
// Doubly linked list emulating std::list<Ball*> with stable iterators (nodes)
// ------------------------------------------------------------------------------------------
class BList {
  constructor() { const e = { ball: null, prev: null, next: null }; e.prev = e; e.next = e; this.end = e; this.size = 0; }
  begin() { return this.end.next; }
  empty() { return this.size === 0; }
  front() { return this.end.next.ball; }
  back() { return this.end.prev.ball; }
  insert(itr, ball) {   // insert before itr, return new node
    const n = { ball, prev: itr.prev, next: itr };
    itr.prev.next = n; itr.prev = n; this.size++;
    return n;
  }
  erase(node) { node.prev.next = node.next; node.next.prev = node.prev; this.size--; const r = node.next; node.prev = node.next = null; return r; }
  *[Symbol.iterator]() { for (let n = this.end.next; n !== this.end; n = n.next) yield n.ball; }
  toArray() { const a = []; for (let n = this.end.next; n !== this.end; n = n.next) a.push(n.ball); return a; }
}

// ------------------------------------------------------------------------------------------
// Level data: CurveData (.dat) + LevelParser (levels.xml)
// ------------------------------------------------------------------------------------------
function b64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const s = atob(b64), a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

function loadCurve(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const rd4 = () => { const v = dv.getInt32(p, true); p += 4; return v; };
  const rdf = () => { const v = dv.getFloat32(p, true); p += 4; return v; };
  const rd1 = () => dv.getUint8(p++);
  const hdr = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]); p = 4;
  if (hdr !== 'CURV') throw new Error('bad curve');
  const ver = rd4();
  let small, tunnels;
  if (ver <= 2) { small = false; tunnels = true; } else { small = rd1() !== 0; tunnels = rd1() !== 0; }
  if (!small) { rd4(); const n = rd4(); p += n; }
  const size = rd4();
  const xs = new Float32Array(size), ys = new Float32Array(size);
  const tun = new Uint8Array(size), pri = new Uint8Array(size);
  if (size > 0) {
    if (ver > 1) {
      xs[0] = rdf(); ys[0] = rdf();
      if (tunnels) { tun[0] = rd1() ? 1 : 0; pri[0] = rd1(); }
      let ox = xs[0], oy = ys[0];
      const INV = f32(0.01);
      for (let i = 1; i < size; i++) {
        const dx = dv.getInt8(p++), dy = dv.getInt8(p++);
        xs[i] = f32(f32(dx * INV) + ox); ys[i] = f32(f32(dy * INV) + oy);
        if (tunnels) { tun[i] = rd1() ? 1 : 0; pri[i] = rd1(); }
        ox = xs[i]; oy = ys[i];
      }
    } else {
      for (let i = 0; i < size; i++) { xs[i] = rdf(); ys[i] = rdf(); tun[i] = rd1() ? 1 : 0; pri[i] = rd1(); }
    }
  }
  return { xs, ys, tun, pri, n: size };
}

// --- tiny XML reader matching SexyAppFramework XMLParser semantics we need (first attribute wins)
function parseXmlElements(xml) {
  xml = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  const out = [];
  const re = /<(\/?)([A-Za-z_][\w]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1]) { out.push({ type: 'end', name: m[2] }); continue; }
    const attrs = new Map();
    const are = /([A-Za-z_][\w]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>\/][^\s>]*?)(?=\s|\/?$))/g;
    let a;
    const body = m[3];
    while ((a = are.exec(body))) {
      const v = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4];
      if (!attrs.has(a[1])) attrs.set(a[1], v);
    }
    out.push({ type: 'start', name: m[2], attrs });
    if (m[4]) out.push({ type: 'end', name: m[2] });
  }
  return out;
}

function sscanfFloat(s) { const v = parseFloat(s); return isNaN(v) ? null : f32(v); }
function sscanfInt(s) { const m = /^\s*[-+]?\d+/.exec(s); return m ? parseInt(m[0], 10) : null; }
function sscanfHex(s) { const m = /^\s*(0x)?[0-9a-fA-F]+/.exec(s); return m ? (parseInt(m[0], 16) >>> 0) : null; }

function newCurveDesc() {
  return {
    mPath: '', mSpeed: f32(0.5), mStartDistance: 40, mNumColors: 4, mNumBalls: 0, mBallRepeat: 40, mMaxSingle: 10,
    mMergeSpeed: f32(0.05), mDangerDistance: 600, mAccelerationRate: 0, mMaxSpeed: 100, mScoreTarget: 1000,
    mSkullRotation: -1, mCurAcceleration: 0, mPowerUpFreq: [3000, 3000, 3000, 3000], mSlowFactor: 4, mSlowSpeed: 0,
    mSlowDistance: 500, mZumaBack: 300, mZumaSlow: 1100, mDrawCurve: false, mDrawTunnels: true, mDestroyAll: true,
    mCurveColor: 0xffffffff,
  };
}
function cloneCurveDesc(c) { const o = Object.assign({}, c); o.mPowerUpFreq = c.mPowerUpFreq.slice(); return o; }
function newLevelDesc() {
  return {
    mId: 0, mName: '', mDisplayName: '', mImagePath: '', mFireSpeed: f32(6), mReloadDelay: 0, mGunX: 320, mGunY: 240,
    mBGColor: -1, mDifficulty: 0, mHueRot: 0, mTreasureFreq: 300, mParTime: 0, mSprites: [], mBackgroundAlpha: [],
    mTreasurePoints: [], mInSpace: false, mStage: 0, mLevel: 0,
    mCurveDesc: [newCurveDesc(), newCurveDesc(), newCurveDesc()],
  };
}
function cloneLevelDesc(d) {
  const o = Object.assign({}, d);
  o.mSprites = d.mSprites.map(s => Object.assign({}, s));
  o.mBackgroundAlpha = d.mBackgroundAlpha.map(s => Object.assign({}, s));
  o.mTreasurePoints = d.mTreasurePoints.map(t => ({ x: t.x, y: t.y, mCurveDist: t.mCurveDist.slice() }));
  o.mCurveDesc = d.mCurveDesc.map(cloneCurveDesc);
  return o;
}
function numCurves(d) { let n = 0; for (let i = 0; i < 3; i++) if (d.mCurveDesc[i].mPath.length) n++; return n; }

class LevelParser {
  constructor(xml) {
    this.mLevels = []; this.mSettingsMap = new Map(); this.mGraphicsMap = new Map();
    this.mLevelProgressionMap = new Map(); this.mStageMap = []; this.mBoardSet = new Set();
    this.mCurDir = ''; this.mCurLevelId = '';
    this.rand = null; // AppRand used by GetLevel (parsing happens before the run starts: not part of the run RNG)
    this.parse(xml);
  }
  getPath(s) { return (s.indexOf('/') < 0 && s.indexOf('\\') < 0) ? this.mCurDir + s : s; }
  copyGraphics(to, from) {
    for (let i = 0; i < 3; i++) {
      const t = to.mCurveDesc[i], f = from.mCurveDesc[i];
      t.mPath = f.mPath; t.mDangerDistance = f.mDangerDistance; t.mDrawCurve = f.mDrawCurve;
      t.mDrawTunnels = f.mDrawTunnels; t.mCurveColor = f.mCurveColor; t.mSkullRotation = f.mSkullRotation;
    }
    to.mGunX = from.mGunX; to.mGunY = from.mGunY; to.mBGColor = from.mBGColor; to.mImagePath = from.mImagePath;
    to.mSprites = from.mSprites.map(s => Object.assign({}, s));
    to.mBackgroundAlpha = from.mBackgroundAlpha.map(s => Object.assign({}, s));
    to.mTreasurePoints = from.mTreasurePoints.map(t => ({ x: t.x, y: t.y, mCurveDist: t.mCurveDist.slice() }));
    to.mName = from.mName; to.mDisplayName = from.mDisplayName; to.mInSpace = from.mInSpace;
  }
  parse(xml) {
    const els = parseXmlElements(xml);
    let inGraphics = false;
    let i = 0;
    while (i < els.length && !(els[i].type === 'start' && els[i].name === 'Levels')) i++;
    i++;
    for (; i < els.length; i++) {
      const e = els[i];
      if (e.type === 'start') {
        if (inGraphics) {
          const d = this.mLevels[this.mLevels.length - 1];
          if (e.name === 'Sprite') d.mSprites.push(this.parseSprite(e, false));
          else if (e.name === 'BackgroundAlpha') d.mBackgroundAlpha.push(this.parseSprite(e, false));
          else if (e.name === 'Cutout') d.mSprites.push(this.parseSprite(e, true));
          else if (e.name === 'TreasurePoint') {
            const t = { x: 0, y: 0, mCurveDist: [0, 0, 0] };
            const g = k => e.attrs.get(k);
            if (g('x') !== undefined) t.x = sscanfInt(g('x'));
            if (g('y') !== undefined) t.y = sscanfInt(g('y'));
            for (let c = 0; c < 3; c++) { const v = g('dist' + (c + 1)); t.mCurveDist[c] = v !== undefined ? sscanfInt(v) : 0; }
            d.mTreasurePoints.push(t);
          } else throw new Error('Invalid Section ' + e.name);
        } else if (e.name === 'Level' || e.name === 'Graphics' || e.name === 'Settings') {
          this.parseLevel(e, e.name === 'Level');
          inGraphics = true;
        } else if (e.name === 'LevelProgression') {
          this.parseLevelProgression(e);
        } else if (e.name === 'StageProgression') {
          for (let s = 0; s < 13; s++) this.parseStageProgression(e, s);
        }
      } else if (e.type === 'end') {
        if (!inGraphics) continue;
        if (e.name === 'Level') inGraphics = false;
        else if (e.name === 'Settings') { inGraphics = false; this.mSettingsMap.set(this.mCurLevelId, this.mLevels.pop()); }
        else if (e.name === 'Graphics') { inGraphics = false; this.mGraphicsMap.set(this.mCurLevelId, this.mLevels.pop()); }
      }
    }
    for (let k = 0; k < this.mLevels.length; k++) this.mLevels[k].mId = k;
  }
  parseSprite(e, cutout) {
    const s = { mImagePath: '', mPriority: 0, x: 0, y: 0, vx: 0, vy: 0, mCutout: cutout };
    const g = k => e.attrs.get(k);
    s.mImagePath = this.getPath(g('image') || '');
    if (g('pri') !== undefined) s.mPriority = sscanfInt(g('pri'));
    if (g('x') !== undefined) s.x = sscanfInt(g('x'));
    if (g('y') !== undefined) s.y = sscanfInt(g('y'));
    if (g('vx') !== undefined) s.vx = sscanfFloat(g('vx'));
    if (g('vy') !== undefined) s.vy = sscanfFloat(g('vy'));
    if (g('cutout') !== undefined) s.mCutout = g('cutout').toLowerCase() === 'true';
    return s;
  }
  // GetCurveAttribute: names sorted (std::map), prefix match; plain name applies to curves 0..1
  curveAttr(d, attrs, name, field, parser) {
    const keys = Array.from(attrs.keys()).sort();
    let k = 0;
    while (k < keys.length && keys[k] < name) k++;
    for (; k < keys.length; k++) {
      const aName = keys[k];
      if (aName.toLowerCase().indexOf(name.toLowerCase()) !== 0) return;
      const dig = aName.charCodeAt(aName.length - 1) - 48;
      let start, end;
      if (aName.length && dig <= 9) { end = dig; start = end; } else { start = 0; end = 2; }
      for (let c = start; c < end; c++) {
        const v = parser(attrs.get(aName));
        if (v !== null) {
          if (field === 'mPowerUpFreq0') d.mCurveDesc[c].mPowerUpFreq[0] = v;
          else if (field === 'mPowerUpFreq1') d.mCurveDesc[c].mPowerUpFreq[1] = v;
          else if (field === 'mPowerUpFreq2') d.mCurveDesc[c].mPowerUpFreq[2] = v;
          else if (field === 'mPowerUpFreq3') d.mCurveDesc[c].mPowerUpFreq[3] = v;
          else d.mCurveDesc[c][field] = v;
        }
      }
    }
  }
  parseLevel(e, isLevel) {
    let d = newLevelDesc();
    const A = e.attrs, g = k => A.get(k);
    this.mCurLevelId = g('id') || '';
    this.mCurDir = g('dir') !== undefined ? g('dir') : 'levels/' + this.mCurLevelId;
    this.mCurDir = this.mCurDir.replace(/[\\/]+$/, '');
    if (this.mCurDir.length) this.mCurDir += '/';
    let aName = g('name') || '';
    let aDisp = g('dispname') || '';
    if (g('settings') !== undefined) {
      const s = this.mSettingsMap.get(g('settings'));
      if (!s) throw new Error('Settings not found ' + g('settings'));
      d = cloneLevelDesc(s);
    }
    for (let c = 0; c < 3; c++) {
      const v = g('settings' + (c + 1));
      if (v !== undefined) d.mCurveDesc[c] = cloneCurveDesc(this.mSettingsMap.get(v).mCurveDesc[c]);
    }
    if (g('graphics') !== undefined) {
      if (!aName) aName = g('graphics');
      if (!aDisp) aDisp = aName;
      const gr = this.mGraphicsMap.get(g('graphics'));
      if (!gr) throw new Error('Graphics not found ' + g('graphics'));
      this.copyGraphics(d, gr);
    }
    if (g('bgcolor') !== undefined) d.mBGColor = sscanfHex(g('bgcolor'));
    if (g('gx') !== undefined) d.mGunX = sscanfInt(g('gx'));
    if (g('gy') !== undefined) d.mGunY = sscanfInt(g('gy'));
    if (g('firespeed') !== undefined) d.mFireSpeed = sscanfFloat(g('firespeed'));
    if (g('reloaddelay') !== undefined) d.mReloadDelay = sscanfInt(g('reloaddelay'));
    if (g('difficulty') !== undefined) d.mDifficulty = sscanfInt(g('difficulty'));
    if (g('huerot') !== undefined) d.mHueRot = sscanfInt(g('huerot'));
    if (g('treasurefreq') !== undefined) d.mTreasureFreq = sscanfInt(g('treasurefreq'));
    if (g('partime') !== undefined) d.mParTime = sscanfInt(g('partime'));
    if (g('image') !== undefined) d.mImagePath = this.getPath(g('image'));
    if (g('space') !== undefined) d.mInSpace = g('space').toLowerCase() === 'true';
    if (g('powerfreq') !== undefined) {
      const pf = sscanfInt(g('powerfreq'));
      if (pf !== null) for (let c = 0; c < 3; c++) for (let j = 0; j < 4; j++) if (d.mCurveDesc[c].mPowerUpFreq[j] > 0) d.mCurveDesc[c].mPowerUpFreq[j] = pf;
    }
    if (g('curve') !== undefined) d.mCurveDesc[0].mPath = this.getPath(g('curve'));
    if (g('curve1') !== undefined) d.mCurveDesc[0].mPath = this.getPath(g('curve1'));
    if (g('curve2') !== undefined) d.mCurveDesc[1].mPath = this.getPath(g('curve2'));
    if (g('curve3') !== undefined) d.mCurveDesc[2].mPath = this.getPath(g('curve3'));
    const bool = s => s.toLowerCase() === 'true';
    this.curveAttr(d, A, 'curvecolor', 'mCurveColor', sscanfHex);
    this.curveAttr(d, A, 'drawcurve', 'mDrawCurve', bool);
    this.curveAttr(d, A, 'drawtunnels', 'mDrawTunnels', bool);
    this.curveAttr(d, A, 'destroyall', 'mDestroyAll', bool);
    this.curveAttr(d, A, 'speed', 'mSpeed', sscanfFloat);
    this.curveAttr(d, A, 'maxspeed', 'mMaxSpeed', sscanfFloat);
    this.curveAttr(d, A, 'start', 'mStartDistance', sscanfInt);
    this.curveAttr(d, A, 'colors', 'mNumColors', sscanfInt);
    this.curveAttr(d, A, 'balls', 'mNumBalls', sscanfInt);
    this.curveAttr(d, A, 'score', 'mScoreTarget', sscanfInt);
    this.curveAttr(d, A, 'skullrot', 'mSkullRotation', sscanfInt);
    this.curveAttr(d, A, 'accrate', 'mAccelerationRate', sscanfFloat);
    this.curveAttr(d, A, 'bombfreq', 'mPowerUpFreq0', sscanfInt);
    this.curveAttr(d, A, 'slowfreq', 'mPowerUpFreq1', sscanfInt);
    this.curveAttr(d, A, 'accfreq', 'mPowerUpFreq2', sscanfInt);
    this.curveAttr(d, A, 'backfreq', 'mPowerUpFreq3', sscanfInt);
    this.curveAttr(d, A, 'repeat', 'mBallRepeat', sscanfInt);
    this.curveAttr(d, A, 'single', 'mMaxSingle', sscanfInt);
    this.curveAttr(d, A, 'mergespeed', 'mMergeSpeed', sscanfFloat);
    this.curveAttr(d, A, 'danger', 'mDangerDistance', sscanfInt);
    this.curveAttr(d, A, 'slowdistance', 'mSlowDistance', sscanfInt);
    this.curveAttr(d, A, 'slowfactor', 'mSlowFactor', sscanfFloat);
    this.curveAttr(d, A, 'slowspeed', 'mSlowSpeed', sscanfFloat);
    this.curveAttr(d, A, 'zumaslow', 'mZumaSlow', sscanfInt);
    this.curveAttr(d, A, 'zumaback', 'mZumaBack', sscanfInt);
    if (d.mParTime === 0) {
      d.mParTime = Math.trunc(35 * d.mCurveDesc[0].mScoreTarget / 1000);
      if (numCurves(d) > 1) d.mParTime = Math.trunc(d.mParTime * f32(numCurves(d) * f32(0.95)));
      d.mParTime = 5 * Math.trunc((d.mParTime + 4) / 5);
    }
    for (let c = 0; c < 3; c++) if (d.mCurveDesc[c].mSlowSpeed !== 0) d.mCurveDesc[c].mSlowFactor = f32(d.mCurveDesc[c].mSpeed / d.mCurveDesc[c].mSlowSpeed);
    if (isLevel && g('progression') !== undefined) {
      let dd = 0, pd = 0;
      if (g('difficultydiff') !== undefined) dd = sscanfInt(g('difficultydiff'));
      if (g('pardiff') !== undefined) pd = sscanfInt(g('pardiff'));
      const prog = this.mLevelProgressionMap.get(g('progression'));
      if (!prog || !prog.length) throw new Error('LevelProgression not found');
      for (const [sid, diff] of prog) {
        const p = cloneLevelDesc(this.mSettingsMap.get(sid));
        this.copyGraphics(p, d);
        p.mDifficulty = diff + dd; p.mParTime += pd;
        if (!p.mName) p.mName = aName;
        if (!p.mDisplayName) p.mDisplayName = aDisp;
        this.mLevels.push(p);
      }
    } else {
      if (!d.mName) d.mName = aName;
      if (!d.mDisplayName) d.mDisplayName = aDisp;
      this.mLevels.push(d);
    }
    if (isLevel) this.mBoardSet.add(aName);
  }
  parseLevelProgression(e) {
    const id = e.attrs.get('id');
    const prog = [];
    for (const s of (e.attrs.get('settings') || '').split(/[, \r\n\t]+/).filter(x => x)) prog.push([s, 0]);
    const diffs = (e.attrs.get('difficulty') || '').split(/[, \r\n\t]+/).filter(x => x);
    for (let k = 0; k < prog.length && k < diffs.length; k++) prog[k][1] = (parseInt(diffs[k], 10) || 0) - 1;
    this.mLevelProgressionMap.set(id, prog);
  }
  getLevel(diff, avoid, find) {
    const byDiff = []; let aDiff = 0, best = null;
    for (const L of this.mLevels) {
      if (find && find !== L.mName) continue;
      if (L.mDifficulty > diff && (best === null || best.mDifficulty > L.mDifficulty)) best = L;
      if (L.mDifficulty === aDiff) byDiff.push(L);
      else if (L.mDifficulty > aDiff && L.mDifficulty <= diff) { byDiff.length = 0; byDiff.push(L); aDiff = L.mDifficulty; }
    }
    let list = [];
    if (avoid && avoid.length) list = byDiff.filter(L => avoid.indexOf(L.mName) < 0);
    if (!list.length) list = byDiff;
    if (list.length) { const r = this.rand ? this.rand() % list.length : 0; return list[r]; }
    return best || this.mLevels[0];
  }
  parseStageProgression(e, stage) {
    while (this.mStageMap.length <= stage) this.mStageMap.push([]);
    const names = (e.attrs.get('stage' + (stage + 1)) || '').split(/[, \r\n\t]+/).filter(x => x);
    const diffs = (e.attrs.get('diffi' + (stage + 1)) || '').split(/[, \r\n\t]+/).filter(x => x);
    const prog = this.mStageMap[stage];
    for (const n of names) { if (!this.mBoardSet.has(n)) throw new Error('Level not found ' + n); const d = newLevelDesc(); d.mName = n; prog.push(d); }
    let lv = 0;
    for (let k = 0; k < diffs.length && k < prog.length; k++) {
      const dd = (parseInt(diffs[k], 10) || 0) - 1;   // atoi("lvl11") == 0
      let d;
      if (dd >= 0) d = cloneLevelDesc(this.getLevel(dd, null, prog[k].mName));
      else {
        const s = this.mSettingsMap.get(diffs[k]);
        if (!s) throw new Error('Setting not found ' + diffs[k]);
        const name = prog[k].mName;
        d = cloneLevelDesc(s); d.mName = name;
        this.copyGraphics(d, this.getLevel(0, null, name));
      }
      d.mStage = stage; d.mLevel = lv++;
      prog[k] = d;
    }
  }
  getStageLevel(num) {
    let c = 0;
    for (const L of this.mStageMap) { if (c + L.length > num) return L[num - c]; c += L.length; }
    return this.mLevels[0];
  }
  getLevelNumByStage(stage) { let r = 0; for (let i = 0; i < stage; i++) r += this.mStageMap[i].length; return r; }
  getBackgroundTransition(crand) {
    const ds = this.mLevels.filter(L => L.mBackgroundAlpha.length);
    if (!ds.length) return this.mLevels[0];
    return ds[crand.next() % ds.length];
  }
}

// ------------------------------------------------------------------------------------------
// WayPointMgr (WayPoint.cpp)
// ------------------------------------------------------------------------------------------
class WayPointMgr {
  constructor(curve) {
    this.c = curve; this.n = curve.n;
    this.xs = curve.xs; this.ys = curve.ys; this.tun = curve.tun; this.pri = curve.pri;
    if (!curve.perpX) {   // lazily computed caches shared between all users of the curve (pure functions of the points)
      curve.perpX = new Float32Array(curve.n); curve.perpY = new Float32Array(curve.n);
      curve.rot = new Float32Array(curve.n); curve.avgRot = new Float32Array(curve.n);
      curve.havePerp = new Uint8Array(curve.n); curve.haveAvg = new Uint8Array(curve.n);
    }
  }
  GetNumPoints() { return this.n; }
  GetEndPoint() { return this.n - 1; }
  calcPerp(i) {
    const c = this.c;
    if (c.havePerp[i]) return;
    const j = (i + 1 < this.n) ? i + 1 : i - 1;
    let px = f32(this.ys[j] - this.ys[i]), py = f32(this.xs[i] - this.xs[j]);
    const len = f32(Math.sqrt(f32(f32(px * px) + f32(py * py))));
    if (len !== 0) { px = f32(px / len); py = f32(py / len); }
    c.perpX[i] = px; c.perpY[i] = py;
    let rot = f32(Math.acos(px));
    if (py > 0) rot = -rot;
    if (rot < 0) rot = f32(rot + f32(2 * SEXY_PI));
    c.rot[i] = rot;
    c.havePerp[i] = 1;
  }
  calcAvgRot(i) {
    const c = this.c;
    if (c.haveAvg[i]) return;
    this.calcPerp(i);
    c.haveAvg[i] = 1;
    c.avgRot[i] = c.rot[i];
    let first = i - 10, last = i + 10;
    if (first < 0) first = 0;
    if (last >= this.n) last = this.n - 1;
    this.calcPerp(first);
    for (let k = first + 1; k < last; k++) {
      this.calcPerp(k);
      let dr = f32(c.rot[k] - c.rot[k - 1]);
      if (dr > 0) { while (dr > SEXY_PI) dr = f32(dr - f32(2 * SEXY_PI)); }
      else if (dr < 0) { while (dr < -SEXY_PI) dr = f32(dr + f32(2 * SEXY_PI)); }
      if (dr > f32(0.1) || dr < f32(-0.1)) {
        const mix = f32(1 - f32((k - first) / (last - first)));
        c.avgRot[i] = f32(c.rot[first] + f32(mix * dr));
        return;
      }
    }
  }
  SetWayPoint(ball, thePoint, visual) {
    if (this.n === 0) return;
    let aPoint = Math.trunc(thePoint), aNext;
    if (thePoint < 0) { aPoint = 0; aNext = 1; }
    else if (aPoint >= this.n) { aPoint = this.n - 1; aNext = aPoint + 1; }
    else { aNext = aPoint + 1; }
    const nx = aNext < this.n ? aNext : aPoint;
    const mix = f32(thePoint - aPoint);
    ball.mx = f32(this.xs[aPoint] + f32(mix * f32(this.xs[nx] - this.xs[aPoint])));
    ball.my = f32(this.ys[aPoint] + f32(mix * f32(this.ys[nx] - this.ys[aPoint])));
    ball.mWayPoint = f32(thePoint);
    if (visual) { this.calcAvgRot(aPoint); ball.SetRotation(this.c.avgRot[aPoint], false); }
  }
  SetWayPointInt(ball, thePoint, visual) {
    if (this.n === 0) return;
    let aPoint = 0;
    if (thePoint >= 0) aPoint = thePoint >= this.n ? this.n - 1 : thePoint;
    ball.mx = this.xs[aPoint]; ball.my = this.ys[aPoint];
    ball.mWayPoint = f32(thePoint);
    if (visual) { this.calcAvgRot(aPoint); ball.SetRotation(this.c.avgRot[aPoint], false); }
  }
  FindFreeWayPoint(existing, nb, inFront, pad, visual) {
    pad = pad | 0;
    const itr = inFront ? 1 : -1;
    let wp = Math.trunc(existing.mWayPoint);
    if (inFront && existing.mWayPoint < nb.mWayPoint) wp = Math.trunc(nb.mWayPoint);
    else if (existing.mWayPoint > nb.mWayPoint) wp = Math.trunc(nb.mWayPoint);
    while (wp >= 0) {
      if (wp >= this.n) break;
      nb.mx = this.xs[wp]; nb.my = this.ys[wp];
      if (!nb.CollidesWithPhysically(existing, pad)) break;
      wp += itr;
    }
    this.SetWayPointInt(nb, wp, visual);
  }
  CalcPerpendicular(wpf) {
    let i = Math.trunc(wpf);
    if (i < 0) i = 0;
    if (i >= this.n) i = this.n - 1;
    this.calcPerp(i);
    return [this.c.perpX[i], this.c.perpY[i]];
  }
  GetRotationForPoint(i) {
    if (i < 0) i = 0;
    if (i >= this.n - 1) i = this.n - 1;
    this.calcPerp(i);
    return this.c.rot[i];
  }
  GetPriorityPt(p) { if (p < 0) return 0; if (p >= this.n) return 0; return this.pri[p]; }
  GetPriority(ball) {
    const a = this.GetPriorityPt(Math.trunc(ball.mWayPoint - BALL_R)), b = this.GetPriorityPt(Math.trunc(ball.mWayPoint + BALL_R));
    return a > b ? a : b;
  }
  GetPriorityBullet(b) {
    if (b.mWayPoint === 0 || b.mHitPercent < f32(0.7)) return 4;
    return this.GetPriority(b);
  }
  InTunnelPt(p) { if (p < 0) return true; if (p >= this.n) return false; return this.tun[p] !== 0; }
  InTunnelBall(ball, inFront) { const w = Math.trunc(ball.mWayPoint); return inFront ? this.InTunnelPt(w + BALL_R) : this.InTunnelPt(w - BALL_R); }
}

// ------------------------------------------------------------------------------------------
// Ball / Bullet (Ball.cpp / Bullet.cpp)
// ------------------------------------------------------------------------------------------
class Ball {
  constructor(game) {
    this.mId = ++game.idGen;
    this.mType = 0; this.mWayPoint = 0; this.mRotation = 0; this.mDestRotation = 0; this.mRotationInc = 0;
    this.mx = 0; this.my = 0;
    this.mList = null; this.mNode = null;
    this.mCollidesWithNext = false; this.mNeedCheckCollision = false; this.mSuckPending = false;
    this.mBullet = null;
    this.mClearCount = 0; this.mSuckCount = 0; this.mBackwardsCount = 0; this.mBackwardsSpeed = 0;
    this.mComboCount = 0; this.mComboScore = 0; this.mStartFrame = 0;
    this.mPowerCount = 0; this.mPowerFade = 0; this.mGapBonus = 0; this.mNumGaps = 0;
    this.mPowerType = PT_NONE; this.mDestPowerType = PT_NONE;
    this.mParticles = null;
  }
  GetRadius() { return BALL_R; }
  SetRotation(rot, immediate) {
    if (immediate !== false) { this.mRotation = rot; return; }
    rot = f32(rot);
    const TWO = f32(6.2831802);
    while (Math.abs(rot - this.mRotation) > SEXY_PI) {
      if (rot > this.mRotation) rot = f32(rot - TWO); else rot = f32(rot + TWO);
    }
    this.mDestRotation = rot;
    this.mRotationInc = f32(0.104719669);
    if (rot < this.mRotation) this.mRotationInc = -this.mRotationInc;
  }
  UpdateRotation() {
    if (this.mPowerFade > 0) {
      --this.mPowerFade;
      if (this.mPowerFade === 0) {
        this.mPowerType = this.mDestPowerType; this.mDestPowerType = PT_NONE;
        if (this.mPowerType !== PT_NONE) this.mPowerCount = 2000;
      }
    }
    if (this.mPowerCount > 0) {
      --this.mPowerCount;
      if (this.mPowerCount <= 0 && this.mPowerType !== PT_NONE) { this.mDestPowerType = PT_NONE; this.mPowerFade = 100; }
    }
    if (this.mRotationInc !== 0) {
      this.mRotation = f32(this.mRotation + this.mRotationInc);
      if (this.mRotationInc > 0 && this.mRotation > this.mDestRotation) { this.mRotation = this.mDestRotation; this.mRotationInc = 0; }
      else if (this.mRotationInc < 0 && this.mRotation < this.mDestRotation) { this.mRotation = this.mDestRotation; this.mRotationInc = 0; }
    }
  }
  GetPowerTypeWussy() { return this.mPowerType === PT_NONE ? this.mDestPowerType : this.mPowerType; }
  SetPowerType(t, delay) {
    if (t === this.mPowerType) return;
    if (delay !== false) { this.mDestPowerType = t; this.mPowerFade = 100; }
    else { this.mDestPowerType = PT_NONE; this.mPowerType = t; }
  }
  SetFrame(f) { const rows = BALL_ROWS[this.mType] || 50; this.mStartFrame = rows - (Math.trunc(f32(f + this.mWayPoint)) % rows); }
  RandomizeFrame(game) { this.mStartFrame = game.AppRand() % 50; }
  StartClearCount(game, inTunnel) {
    if (this.mClearCount !== 0) return;
    this.mClearCount = 1;
    if (!inTunnel) {
      const vis = game.visual;
      const ps = vis ? new Array(60) : null;
      for (let i = 0; i < 60; i++) {
        const angle = f32(f32((game.AppRand() % 360) * SEXY_PI) / 180);
        const speed = f32((game.AppRand() % 500) / 500);
        const rnd = game.AppRand() % 30;
        const sz = ((game.AppRand() % 10) < 2 ? 1 : 0) + 1;
        if (vis) {
          const vx = f32(Math.sin(angle) * speed), vy = f32(Math.cos(angle) * speed);
          ps[i] = { x: rnd * vx + this.mx, y: rnd * vy + this.my, vx, vy, size: sz };
        }
      }
      if (vis) this.mParticles = ps;
    }
  }
  CollidesWithPhysically(b, pad) {
    const dx = f32(b.mx - this.mx), dy = f32(b.my - this.my);
    const r = f32(BALL_R + (pad | 0));
    return f32(f32(dx * dx) + f32(dy * dy)) < f32(r * f32(r * 4));
  }
  CollidesWith(b, pad) {
    return Math.abs(Math.trunc(this.mWayPoint) - Math.trunc(b.mWayPoint)) < 2 * ((pad | 0) + BALL_R);
  }
  // ray intersection used by the accuracy guide
  Intersects(p1x, p1y, v1x, v1y) {
    const dx = f32(p1x - this.mx), dy = f32(p1y - this.my);
    const a = f32(f32(v1y * v1y) + f32(v1x * v1x));
    let b = f32(v1x * dx); b = f32(b + f32(v1y * dy)); b = f32(b + b);
    let disc = f32(f32(b * b) - f32(f32(f32(f32(dx * dx) + f32(dy * dy)) - 256) * f32(a * 4)));
    if (disc < 0) return null;
    disc = f32(Math.sqrt(disc));
    return f32(f32(-b - disc) / f32(2 * a));
  }
  SetCollidesWithPrev(v) { const p = this.GetPrevBall(false); if (p) p.mCollidesWithNext = v; }
  GetCollidesWithPrev() { const p = this.GetPrevBall(false); return p ? p.mCollidesWithNext : false; }
  UpdateCollisionInfo(pad) {
    const p = this.GetPrevBall(false), n = this.GetNextBall(false);
    if (p) p.mCollidesWithNext = p.CollidesWith(this, pad);
    if (n) this.mCollidesWithNext = n.CollidesWith(this, pad); else this.mCollidesWithNext = false;
  }
  RemoveFromList() { if (this.mList) { this.mList.erase(this.mNode); this.mList = null; this.mNode = null; } }
  InsertInList(list, itr) { this.mList = list; this.mNode = list.insert(itr, this); return this.mNode; }
  GetPrevBall(mustCollide) {
    if (!this.mList) return null;
    const pn = this.mNode.prev;
    if (pn === this.mList.end) return null;
    if (!mustCollide) return pn.ball;
    return pn.ball.mCollidesWithNext ? pn.ball : null;
  }
  GetNextBall(mustCollide) {
    if (!this.mList) return null;
    const nn = this.mNode.next;
    if (nn === this.mList.end) return null;
    if (!mustCollide || this.mCollidesWithNext) return nn.ball;
    return null;
  }
}

class Bullet extends Ball {
  constructor(game) {
    super(game);
    this.isBullet = true;
    this.mVelX = 0; this.mVelY = 0; this.mHitBall = null; this.mHitInFront = false; this.mHaveSetPrevBall = false;
    this.mHitX = 0; this.mHitY = 0; this.mDestX = 0; this.mDestY = 0; this.mHitPercent = 0; this.mMergeSpeed = f32(0.05);
    this.mGapInfo = []; this.mCurCurvePoint = [0, 0, 0];
  }
  destroy() { if (this.mHitBall) this.mHitBall.mBullet = null; }  // ~Bullet -> SetBallInfo(NULL)
  SetVelocity(vx, vy) { this.mVelX = f32(vx); this.mVelY = f32(vy); }
  SetHitBall(ball, inFront) {
    if (this.mHitBall) this.mHitBall.mBullet = null;
    this.mHaveSetPrevBall = false; this.mHitBall = ball; this.mHitX = this.mx; this.mHitY = this.my;
    this.mHitPercent = 0; this.mHitInFront = inFront;
    if (this.mHitBall) this.mHitBall.mBullet = this;
  }
  CheckSetHitBallToPrevBall() {
    if (this.mHaveSetPrevBall || !this.mHitBall) return;
    const p = this.mHitBall.GetPrevBall(false);
    if (!p) return;
    if (p.CollidesWithPhysically(this, 0) && p.mClearCount === 0) {
      this.mHaveSetPrevBall = true;
      this.mHitBall.mBullet = null;
      this.mHitBall = p; this.mHitInFront = true; this.mHitX = this.mx; this.mHitY = this.my; this.mHitPercent = 0;
      p.mBullet = this;
    }
  }
  SetDestPos(x, y) { this.mDestX = x; this.mDestY = y; }
  Update() {
    if (!this.mHitBall) { this.mx = f32(this.mx + this.mVelX); this.my = f32(this.my + this.mVelY); }
    else if (this.mClearCount === 0) {
      this.mHitPercent = f32(this.mHitPercent + this.mMergeSpeed);
      if (this.mHitPercent > 1) this.mHitPercent = 1;
      this.mx = f32(this.mHitX + f32(this.mHitPercent * f32(this.mDestX - this.mHitX)));
      this.my = f32(this.mHitY + f32(this.mHitPercent * f32(this.mDestY - this.mHitY)));
    }
  }
  MergeFully() { this.mHitPercent = 1; this.Update(); }
  GetPushBall() {
    if (!this.mHitBall) return null;
    const pb = !this.mHitInFront ? this.mHitBall : this.mHitBall.GetNextBall(false);
    if (pb && pb.CollidesWithPhysically(this, 0)) return pb;
    return null;
  }
  UpdateHitPos() { this.mHitX = this.mx; this.mHitY = this.my; }
  AddGapInfo(curve, dist, ballId) {
    for (const g of this.mGapInfo) if (g.mBallId === ballId) return false;
    this.mGapInfo.push({ mCurve: curve, mDist: dist, mBallId: ballId });
    return true;
  }
  GetMinGapDist() { let m = 0; for (const g of this.mGapInfo) if (m === 0 || g.mDist < m) m = g.mDist; return m; }
  RemoveGapInfoForBall(id) { this.mGapInfo = this.mGapInfo.filter(g => g.mBallId !== id); }
}

// ------------------------------------------------------------------------------------------
// Gun (Gun.cpp)
// ------------------------------------------------------------------------------------------
const GS_NORMAL = 0, GS_FIRING = 1, GS_RELOADING = 2;
class Gun {
  constructor(game) {
    this.game = game;
    this.mCenterX = 320; this.mCenterY = 240; this.mWidth = 108; this.mHeight = 108;
    this.mAngle = 0; this.mRecoilCount = 0; this.mBlinkCount = 0; this.mWink = false;
    this.mRecoilX1 = 320; this.mRecoilY1 = 240; this.mRecoilX2 = 320; this.mRecoilY2 = 240;
    this.mFireVel = f32(6); this.mState = GS_NORMAL; this.mStatePercent = 0;
    this.mBullet = null; this.mNextBullet = null; this.mShowNextBall = true;
  }
  NeedsReload() { return this.mNextBullet === null || this.mBullet === null; }
  Reload(type, delay, power) {
    const b = new Bullet(this.game);
    b.mType = type; b.SetPowerType(power, false);
    this.mStatePercent = 0;
    if (this.mBullet) this.mBullet.destroy();
    this.mBullet = this.mNextBullet; this.mNextBullet = b;
    this.mState = GS_RELOADING;
    if (!delay) { this.mState = GS_NORMAL; this.mStatePercent = 1; }
    this.CalcAngle();
  }
  SetAngle(a) { this.mAngle = f32(a); this.CalcAngle(); }
  StartFire(recoil) {
    if (this.mState !== GS_NORMAL || !this.mBullet) return false;
    this.mStatePercent = 0; this.mState = GS_FIRING;
    this.mCenterX = this.mRecoilX1; this.mCenterY = this.mRecoilY1;
    const b = this.mBullet;
    const rad = f32(this.mAngle - f32(SEXY_PI / 2));
    const vx = f32(Math.cos(rad)), vy = f32(-Math.sin(rad));
    b.SetVelocity(f32(vx * this.mFireVel), f32(vy * this.mFireVel));
    b.mx = f32(f32(-40 * vx) + b.mx); b.my = f32(f32(-40 * vy) + b.my);
    this.mRecoilX1 = this.mCenterX; this.mRecoilY1 = this.mCenterY;
    this.mRecoilX2 = Math.trunc(this.mCenterX + f32(vx * -6)); this.mRecoilY2 = Math.trunc(this.mCenterY + f32(vy * -6));
    if (recoil !== false) this.mRecoilCount = 25;
    this.mWink = false; this.mBlinkCount = 25;
    this.CalcAngle();
    return true;
  }
  GetFiredBullet() {
    if (this.mState === GS_FIRING && this.mStatePercent >= 1) {
      const b = this.mBullet; this.mBullet = null; this.mState = GS_NORMAL; return b;
    }
    return null;
  }
  SetPos(x, y) { this.mCenterX = x | 0; this.mCenterY = y | 0; this.mRecoilX1 = x | 0; this.mRecoilY1 = y | 0; this.CalcAngle(); }
  Update() {
    if (this.mRecoilCount > 0) {
      this.mRecoilCount--;
      if (this.mRecoilCount <= 20) {
        if (this.mRecoilCount === 1) { this.mCenterX = this.mRecoilX1; this.mCenterY = this.mRecoilY1; }
        else if (this.mRecoilCount > 14) {
          this.mCenterX = Math.trunc((this.mRecoilCount - 16) * (this.mRecoilX1 - this.mRecoilX2) / 5) + this.mRecoilX2;
          this.mCenterY = Math.trunc((this.mRecoilCount - 16) * (this.mRecoilY1 - this.mRecoilY2) / 5) + this.mRecoilY2;
        } else {
          this.mCenterX = this.mRecoilX1 + Math.trunc(this.mRecoilCount * (this.mRecoilX2 - this.mRecoilX1) / 15);
          this.mCenterY = this.mRecoilY1 + Math.trunc(this.mRecoilCount * (this.mRecoilY2 - this.mRecoilY1) / 15);
        }
      }
    }
    if (this.mBlinkCount > 0) this.mBlinkCount--;
    if (this.mState === GS_FIRING) {
      this.mStatePercent = f32(this.mStatePercent + f32(0.15));
      if (this.mStatePercent > f32(0.6)) this.mBullet.Update();
    } else {
      this.mStatePercent = f32(this.mStatePercent + f32(0.07));
    }
    if (this.mStatePercent > 1) { this.mStatePercent = 1; if (this.mState === GS_RELOADING) this.mState = GS_NORMAL; }
    this.CalcAngle();
  }
  SwapBullets() {
    if (this.mState !== GS_NORMAL || !this.mBullet || !this.mNextBullet) return false;
    if (this.mBullet.mType === this.mNextBullet.mType) return false;
    const b = this.mBullet; this.mBullet = this.mNextBullet; this.mNextBullet = b;
    this.CalcAngle();
    return true;
  }
  EmptyBullets() {
    this.mState = GS_NORMAL;
    if (this.mNextBullet) { this.mNextBullet.destroy(); this.mNextBullet = null; }
    if (this.mBullet) { this.mBullet.destroy(); this.mBullet = null; }
  }
  SetBulletType(t) { if (this.mBullet) this.mBullet.mType = t; }
  SetNextBulletType(t) { if (this.mNextBullet) this.mNextBullet.mType = t; }
  DoBlink(wink) { this.mWink = !!wink; this.mBlinkCount = 25; }
  CalcAngle() {
    if (!this.mBullet) return;
    const start = f32(this.mCenterY - 20), end = f32(this.mCenterY + 25);
    let px = f32(this.mCenterX + 1), py = 0;
    if (this.mState === GS_NORMAL) py = end;
    else if (this.mState === GS_RELOADING) py = f32(start + f32(f32(end - start) * this.mStatePercent));
    else if (this.mStatePercent <= f32(0.6)) py = f32(end + f32(f32(f32(f32(this.mCenterY + 10) - end) * this.mStatePercent) / f32(0.6)));
    else return;
    // RotateXY
    const cx = this.mCenterX, cy = this.mCenterY, rad = this.mAngle;
    const ox = f32(px - cx), oy = f32(py - cy);
    const c = f32(Math.cos(rad)), s = f32(Math.sin(rad));
    const nx = f32(f32(cx + f32(ox * c)) + f32(oy * s));
    const ny = f32(f32(cy + f32(oy * c)) - f32(ox * s));
    this.mBullet.mx = nx; this.mBullet.my = ny;
    this.mBullet.mRotation = this.mAngle;
  }
}

// ------------------------------------------------------------------------------------------
// CurveMgr (CurveMgr.cpp)
// ------------------------------------------------------------------------------------------
class CurveMgr {
  constructor(board, curveNum) {
    this.board = board; this.game = board.game; this.mCurveNum = curveNum;
    this.mBallList = new BList(); this.mPendingBalls = []; this.mBulletList = [];
    this.mLastPowerUpFrame = [0, 0, 0, 0];
    this.mStopTime = 0; this.mSlowCount = 0; this.mBackwardCount = 0; this.mTotalBalls = 0; this.mAdvanceSpeed = 0;
    this.mFirstChainEnd = 0; this.mFirstBallMovedBackwards = false; this.mHaveSets = false; this.mDangerPoint = 0;
    this.mPathLightEndFrame = 0; this.mLastClearedBallPoint = 0; this.mHadPowerUp = false; this.mStopAddingBalls = false;
    this.mInDanger = false; this.mLastPathShowTick = 0;
    this.wp = null; this.mCurveDesc = null;
    this.holePercent = 0;
  }
  SetupLevel(desc, curveNum) {
    this.mCurveNum = curveNum;
    this.mCurveDesc = desc.mCurveDesc[curveNum];
    this.wp = new WayPointMgr(this.game.getCurve(this.mCurveDesc.mPath));
    let skull = this.mCurveDesc.mSkullRotation;
    if (skull >= 0) skull = f32(f32(skull * SEXY_PI) / 180);
    let hx = 0, hy = 0;
    if (this.wp.n > 0) {
      const e = this.wp.GetEndPoint();
      this.wp.calcPerp(e);
      hx = Math.trunc(this.wp.xs[e]); hy = Math.trunc(this.wp.ys[e]);
      if (skull < 0) skull = this.wp.c.rot[e];
    }
    this.holeX = hx; this.holeY = hy; this.holeRot = skull;
    this.mDangerPoint = this.wp.GetNumPoints() - this.mCurveDesc.mDangerDistance;
    if (this.mDangerPoint >= this.wp.GetNumPoints()) this.mDangerPoint = this.wp.GetEndPoint();
  }
  SetupLevelDesc(desc) {
    this.mCurveDesc = desc.mCurveDesc[this.mCurveNum];
    this.mDangerPoint = this.wp.GetNumPoints() - this.mCurveDesc.mDangerDistance;
    if (this.mDangerPoint >= this.wp.GetNumPoints()) this.mDangerPoint = this.wp.GetEndPoint();
  }
  setDesc(desc) { this.mCurveDesc = desc.mCurveDesc[this.mCurveNum]; }

  MakeCombo(list, numBalls, comboSize, numColors) {
    const g = this.game;
    const types = new Array(comboSize), counts = new Array(comboSize);
    let bc = numBalls, prev = -1;
    for (let i = 0; i < comboSize; i++) {
      let c;
      do { c = g.AppRand() % numColors; } while (prev === c);
      types[i] = c; counts[i] = 3; bc -= 3; prev = c;
    }
    for (let i = 0; i < bc; i++) counts[g.AppRand() % comboSize]++;
    // std::list insert semantics on a plain array: aBallItr is an index into the list
    let itr = 0;
    for (let i = 0; i < comboSize; i++) {
      for (let j = 0; j < counts[i]; j++) {
        const insertNext = (g.AppRand() % 2) !== 0;
        const b = new Ball(g);
        b.mType = types[i];
        b.RandomizeFrame(g);
        if (insertNext) { list.splice(itr, 0, b); }       // aBallItr = insert(aBallItr, b) -> points at b
        else { list.unshift(b); itr++; }                   // insert at begin: existing iterator shifts by one
      }
    }
  }

  StartLevel() {
    const board = this.board, g = this.game;
    this.mCurveDesc = board.mLevelDesc.mCurveDesc[this.mCurveNum];
    this.mPathLightEndFrame = 0;
    this.mLastPathShowTick = board.BoardGetTickCount() - 1000000;
    this.mLastClearedBallPoint = 0;
    for (let i = 0; i < 4; i++) this.mLastPowerUpFrame[i] = board.mStateCount - 1000;
    this.holePercent = 0;
    this.DeleteBalls();
    g.AppRand();
    let n = this.mCurveDesc.mNumBalls;
    if (n === 0) n = 10;
    if (g.profile.mMaxLevel < 2 && board.mLevelDesc.mStage < 1) {
      for (let k = 0; k < 5; k++) this.MakeCombo(this.mPendingBalls, 0, 2, this.mCurveDesc.mNumColors);
    }
    for (let i = 0; i < n; i++) this.AddPendingBall();
    this.mStopTime = 0; this.mSlowCount = 0; this.mBackwardCount = 0;
    this.mTotalBalls = this.mCurveDesc.mNumBalls;
    this.mStopAddingBalls = false; this.mInDanger = false; this.mFirstChainEnd = 0; this.mFirstBallMovedBackwards = false;
    this.RollBallsIn();
  }

  UpdatePlaying() {
    const L = this.mBallList;
    const atBeginning = L.empty() || L.back().mWayPoint < 50;
    if (this.mStopTime > 0) {
      this.mStopTime--;
      if (atBeginning) this.mStopTime = 0;
      if (this.mStopTime === 0) this.mAdvanceSpeed = 0;
    }
    if (this.mSlowCount > 0) { this.mSlowCount--; if (atBeginning) this.mSlowCount = 0; }
    if (this.mBackwardCount > 0) { this.mBackwardCount--; if (atBeginning) this.mBackwardCount = 0; }
    this.AddBall();
    this.UpdateBallRotation();
    this.AdvanceBullets();
    this.UpdateSuckingBalls();
    this.AdvanceBalls();
    this.AdvanceBackwardBalls();
    this.RemoveBallsAtFront();
    this.UpdateSets();
    this.UpdatePowerUps();
    this.SetFarthestBall(L.empty() ? 0 : Math.trunc(L.back().mWayPoint));
  }

  UpdateLosing() {
    const L = this.mBallList, end = this.wp.GetEndPoint();
    let n = L.begin();
    while (n !== L.end) {
      const b = n.ball;
      if (b.mWayPoint >= end) {
        if (b.mSuckCount < 0) b.mSuckCount++;
        else { const nx = n.next; b.mList = null; L.erase(n); n = nx; continue; }
      } else {
        this.wp.SetWayPoint(b, f32(b.mWayPoint + Math.trunc(b.mSuckCount / 4)), this.game.visual);
        b.mSuckCount++;
        if (b.mWayPoint > end) b.mSuckCount = 0;
      }
      n = n.next;
    }
    if (!L.empty()) this.SetFarthestBall(Math.trunc(L.back().mWayPoint));
  }

  SetLosing() {
    for (const b of this.mBulletList) b.destroy();
    this.mBulletList = [];
    for (const b of this.mBallList) b.mSuckCount = Math.trunc(f32(this.mAdvanceSpeed * 4));
  }

  CheckCollision(bullet) {
    const BL = this.mBulletList;
    for (let i = 0; i < BL.length; i++) {
      const ab = BL[i];
      if (bullet.CollidesWithPhysically(ab, 0)) { ab.Update(); this.AdvanceMergingBullet(i); break; }
    }
    const L = this.mBallList;
    let found = null, flag = false;
    for (let n = L.begin(); n !== L.end; n = n.next) {
      const ball = n.ball;
      if (ball.CollidesWithPhysically(bullet, 0) && ball.mBullet === null && ball.mClearCount === 0) {
        const pb = ball.GetPrevBall(true);
        if (pb === null || pb.mBullet === null) {
          const nb = ball.GetNextBall(true);
          if (nb === null || nb.mBullet === null) {
            const [px, py] = this.wp.CalcPerpendicular(ball.mWayPoint);
            const ix = f32(bullet.mx - ball.mx), iy = f32(bullet.my - ball.my);
            flag = f32(f32(ix * py) - f32(iy * px)) < 0;
            if (!this.wp.InTunnelBall(ball, flag)) { found = ball; break; }
          }
        }
      }
    }
    if (!found) return false;
    bullet.SetHitBall(found, flag);
    bullet.mMergeSpeed = this.mCurveDesc.mMergeSpeed;
    const nb2 = found.GetNextBall(false);
    if (!flag) bullet.RemoveGapInfoForBall(found.mId);
    else if (nb2) bullet.RemoveGapInfoForBall(nb2.mId);
    this.game.sound('BALLCLICK2');
    this.mBulletList.push(bullet);
    return true;
  }

  CheckGapShot(bullet) {
    const dia = BALL_R * 2;
    const diaSq = f32(dia * dia);
    const bx = bullet.mx, by = bullet.my;
    const n = this.wp.n;
    const idx = bullet.mCurCurvePoint[this.mCurveNum];
    const xs = this.wp.xs, ys = this.wp.ys, tun = this.wp.tun;
    if (idx > 0 && idx < n) {
      const dy = f32(ys[idx] - by), dx = f32(xs[idx] - bx);
      if (diaSq > f32(f32(dy * dy) + f32(dx * dx))) return false;
      bullet.mCurCurvePoint[this.mCurveNum] = 0;
    }
    for (let i = 1; i < n; i += dia) {
      if (tun[i]) continue;
      const dy = f32(ys[i] - by), dx = f32(xs[i] - bx);
      if (diaSq > f32(f32(dy * dy) + f32(dx * dx))) {
        bullet.mCurCurvePoint[this.mCurveNum] = i;
        const L = this.mBallList;
        for (let nd = L.begin(); nd !== L.end; nd = nd.next) {
          const b = nd.ball;
          if (b.mWayPoint > i) {
            const pb = b.GetPrevBall(false);
            if (!pb) return false;
            const d = Math.trunc(f32(b.mWayPoint - pb.mWayPoint));
            if (d <= 0) return false;
            return bullet.AddGapInfo(this.mCurveNum, d, b.mId);
          }
        }
        return false;
      }
    }
    return false;
  }

  IsLosing() {
    const L = this.mBallList;
    if (this.mHaveSets || L.empty() || this.wp.GetEndPoint() > L.back().mWayPoint || this.mBulletList.length || this.mBackwardCount > 0) return false;
    let b = L.back();
    while (b) { if (b.mSuckCount > 0) return false; b = b.GetPrevBall(true); }
    return true;
  }
  IsWinning() { return this.mBallList.empty() && this.mPendingBalls.length === 0; }
  CanRestart() { return this.mBallList.empty(); }
  CanFire() { const L = this.mBallList; if (L.empty()) return true; return L.back().mWayPoint < this.wp.GetEndPoint(); }

  CheckBallIntersection(p1x, p1y, v1x, v1y, best) {
    let hit = null;
    for (const b of this.mBallList) {
      if (!this.wp.InTunnelPt(Math.trunc(b.mWayPoint))) {
        const t = b.Intersects(p1x, p1y, v1x, v1y);
        if (t !== null && t < best.t && t > 0) { best.t = t; hit = b; }
      }
    }
    return hit;
  }

  ActivatePower(ball) {
    const t = ball.GetPowerTypeWussy();
    this.game.gotPowerUp[t] = true;
    if (t === PT_BOMB) this.ActivateBomb(ball);
    else if (t === PT_BACK) { if (!this.mBallList.empty()) this.mBackwardCount = 300; }
    else if (t === PT_SLOW) { if (this.mSlowCount < 1000) this.mSlowCount = 800; }
  }

  DeleteBalls() {
    for (const b of this.mBulletList) b.destroy();
    this.mBallList = new BList();
    this.mPendingBalls = [];
    this.mBulletList = [];
  }

  GetPoint(p) {
    if (p < 0) p = 0;
    if (p >= this.wp.n) p = this.wp.GetEndPoint();
    return [this.wp.xs[p], this.wp.ys[p], this.wp.pri[p]];
  }
  GetCurveLength() { return this.wp.n; }
  SetStopAddingBalls(stop) {
    if (this.mStopAddingBalls === stop) return;
    if (this.GetFarthestBallPercent() > 50) { this.mBackwardCount = this.mCurveDesc.mZumaBack; this.mSlowCount = this.mCurveDesc.mZumaSlow; }
    this.mStopAddingBalls = stop;
    if (stop) this.mPendingBalls = [];
  }
  DoEndlessZumaEffect() { if (this.GetFarthestBallPercent() > 50) this.mBackwardCount = this.mCurveDesc.mZumaBack; }
  DetonateBalls() {
    for (const b of this.mBallList) if (b.mClearCount === 0) { b.StartClearCount(this.game, true); this.board.UpdateBallColorMap(b, false); }
  }
  GetFarthestBallPercent() {
    const L = this.mBallList;
    if (L.empty()) return 0;
    return Math.trunc(f32(f32(L.back().mWayPoint * 100) / this.wp.n));
  }

  DrawPathSparkles(start, stagger, addSound) {
    // visual/sound only; returns the stagger exactly as the original
    let p = start; const fwd = ((this.mCurveNum ^ 1) & 1) !== 0;
    let pitch = fwd ? 0 : -20; let ctr = 0;
    const pm = this.board.particles, vis = this.game.visual;
    while (p < this.wp.n) {
      if (vis) { const [x, y, pri] = this.GetPoint(p); pm.AddSparkle(Math.trunc(x), Math.trunc(y), 0, 0, pri, 0, stagger, 0xFFFF00); }
      if (addSound && (ctr % 25) === 0) {
        if (fwd) { if (pitch > -20) pitch--; } else { if (pitch < 0) pitch++; }
        this.board.addSound('TRAIL_LIGHT', stagger, f32(pitch * f32(0.8)));
      }
      p += 11; ++stagger; ++ctr;
    }
    if (addSound) this.board.addSound('TRAIL_LIGHT_END', stagger, 0);
    this.board.AddHoleFlash(this.mCurveNum, stagger);
    return stagger + 60;
  }

  DrawEndLevelBonus(stagger) {
    const g = this.game, n = this.wp.n;
    let p = this.mLastClearedBallPoint + (n - this.mLastClearedBallPoint) % 60;
    let st = stagger;
    while (p <= n) {
      const [ex, ey, epri] = this.GetPoint(p);
      for (let i = 0; i < 5; i++) {
        const ox = g.AppRand() % 21 - 10, oy = g.AppRand() % 21 - 10;
        this.board.particles.AddExplosion(Math.trunc(ex) + ox, Math.trunc(ey) + oy, 0, 0, st);
      }
      this.board.particles.FloatingText([['+100', 'FLOAT', 0xFFFF00]], Math.trunc(ex), Math.trunc(ey), st + 10, 100);
      p += 60; st += 4;
    }
    for (let i = stagger + 1; i < st; i += 10) this.board.addSound('BONUS_EXPLOSION', i, 0);
    return st;
  }

  HasReachedCruisingSpeed() { return f32(this.mAdvanceSpeed - this.mCurveDesc.mSpeed) < f32(0.1); }
  AddPowerUp(t) {
    const g = this.game;
    const idx = g.AppRand() % this.mBallList.size;
    let n = this.mBallList.begin();
    for (let i = 0; i < idx; i++) n = n.next;
    const b = n.ball;
    if (b.mPowerType === PT_NONE && b.mDestPowerType === PT_NONE) b.SetPowerType(t, true);
  }

  DeleteBullet(b) {
    if (!b) return;
    const i = this.mBulletList.indexOf(b);
    if (i >= 0) this.mBulletList.splice(i, 1);
    b.destroy();
  }
  DeleteBall(ball) {
    const b = ball.mBullet;
    if (b) {
      b.MergeFully();
      const i = this.mBulletList.indexOf(b);
      if (i >= 0) this.AdvanceMergingBullet(i);
    }
    this.DeleteBullet(b);
    ball.SetCollidesWithPrev(false);
  }

  SetFarthestBall(point) {
    let last = this.mDangerPoint; if (last < 0) last = 0;
    let open = 0;
    if (last <= point) open = f32((point - last) / (this.wp.n - last));
    this.holePercent = open;
  }

  GetNumInARow(ball, color, ends) {
    if (ball.mType !== color) return 0;
    let cnt = 1, ne = ball, pe = ball;
    for (;;) { const nb = ne.GetNextBall(true); if (!nb || nb.mType !== color) break; ne = nb; cnt++; }
    for (;;) { const pb = pe.GetPrevBall(true); if (!pb || pb.mType !== color) break; pe = pb; cnt++; }
    if (ends) { ends.next = ne; ends.prev = pe; }
    return cnt;
  }

  CheckSet(ball) {
    const board = this.board, g = this.game;
    this.mHadPowerUp = false;
    const ends = { next: null, prev: null };
    const combo = ball.mComboCount;
    const cnt = this.GetNumInARow(ball, ball.mType, ends);
    if (cnt < 3) return false;
    board.mNumCleared = 0; board.mClearedXSum = 0; board.mClearedYSum = 0;
    board.mCurComboCount = combo; board.mCurComboScore = ball.mComboScore;
    board.mNeedComboCount = [];
    for (let i = 0; i < 4; i++) g.gotPowerUp[i] = false;
    let gap = 0, ngaps = 0;
    const endBall = ends.next.GetNextBall(false);
    let b = ends.prev;
    while (b !== endBall) {
      if (b.mSuckPending) { b.mSuckPending = false; board.mNumClearsInARow++; }
      this.StartClearCount(b);
      gap += b.mGapBonus;
      if (b.mNumGaps > ngaps) ngaps = b.mNumGaps;
      b.mGapBonus = 0; b.mNumGaps = 0;
      b = b.GetNextBall(false);
    }
    this.DoScoring(ball, board.mNumCleared, combo, gap, ngaps);
    const st = board.mLevelStats;
    if (board.mCurComboCount > st.mMaxCombo || (board.mCurComboCount === st.mMaxCombo && board.mCurComboScore >= st.mMaxComboScore)) {
      st.mMaxCombo = board.mCurComboCount; st.mMaxComboScore = board.mCurComboScore;
    }
    b = ends.prev;
    while (b !== endBall) { b.mComboCount = combo; b.mComboScore = board.mCurComboScore; b = b.GetNextBall(false); }
    for (const nb of board.mNeedComboCount) { nb.mComboCount = combo; nb.mComboScore = board.mCurComboScore; }
    board.mNeedComboCount = [];
    if (!this.mHadPowerUp) {
      const snd = ['BALLDESTROYED1', 'BALLDESTROYED2', 'BALLDESTROYED3', 'BALLDESTROYED4'][combo] || 'BALLDESTROYED5';
      g.sound(snd);
      g.sound('COMBO', 2 * combo, Math.min(1.0, combo * 0.2 + 0.4));
    }
    board.mCurComboCount = 0; board.mCurComboScore = 0;
    g.stats.sets++;
    return true;
  }

  DoScoring(ball, numBalls, combo, gapBonus, numGaps) {
    if (numBalls === 0) return;
    const board = this.board, g = this.game;
    let pts = 100 * combo + 10 * numBalls + gapBonus;
    let inARow = false;
    if (board.mNumClearsInARow > 4 && combo === 0) {
      const rb = 10 * board.mNumClearsInARow + 50;
      pts += rb; board.mCurInARowBonus += rb; inARow = true;
    }
    board.mCurComboScore += pts;
    board.IncScore(pts);
    if (combo > 0) ++board.mLevelStats.mNumCombos;
    if (gapBonus) ++board.mLevelStats.mNumGaps;
    if (g.visual) {
      const col = TEXT_BALL_COLORS[ball.mType];
      const lines = ['+' + pts];
      if (combo > 0) lines.push('COMBO x' + (combo + 1));
      if (gapBonus > 0) lines.push(numGaps > 2 ? 'TRIPLE GAP BONUS' : numGaps > 1 ? 'DOUBLE GAP BONUS' : 'GAP BONUS');
      if (inARow) lines.push('CHAIN BONUS x' + board.mNumClearsInARow);
      if (g.gotPowerUp[PT_SLOW]) lines.push('SLOWDOWN Ball');
      if (g.gotPowerUp[PT_BACK]) lines.push('BACKWARDS Ball');
      if (g.gotPowerUp[PT_ACC]) lines.push('ACCURACY Ball');
      board.particles.FloatingText(lines.map(l => [l, 'FLOAT', col]), Math.trunc(board.mClearedXSum / numBalls), Math.trunc(board.mClearedYSum / numBalls), 0, 0);
    }
    if (gapBonus > 0) {
      if (numGaps > 1) {
        board.addSound('GAP_BONUS', 15, 2.0);
        if (numGaps <= 2) board.addSound('GAP_BONUS', 30, 3.0);
      }
      g.sound('GAP_BONUS');
    }
    if (inARow) board.addSound('CHAIN_BONUS', 0, board.mNumClearsInARow - 5);
    g.stats.lastScore = { pts, combo, gapBonus, numGaps, numBalls, inARow };
  }

  GetNumPendingSingles(numGroups) {
    let groups = 0, prev = -1, singles = 0, gc = 0;
    const P = this.mPendingBalls;
    const step = (c) => {
      if (c === prev) ++gc;
      else { if (gc === 1) ++singles; gc = 1; ++groups; prev = c; }
    };
    for (let i = P.length - 1; i >= 0; i--) {
      if (groups > numGroups) break;
      step(P[i].mType);
    }
    for (let i = 0; i < P.length; i++) step(P[i].mType);
    return singles;
  }

  AddPendingBall() {
    const g = this.game, cd = this.mCurveDesc;
    let nc = cd.mNumColors;
    const b = new Ball(g);
    b.RandomizeFrame(g);
    let prev;
    if (this.mPendingBalls.length) prev = this.mPendingBalls[this.mPendingBalls.length - 1].mType;
    else if (!this.mBallList.empty()) prev = this.mBallList.front().mType;
    else prev = g.AppRand() % nc;
    if (prev >= nc) prev = g.AppRand() % nc;
    const ms = cd.mMaxSingle;
    let nw;
    if (g.AppRand() % 100 <= cd.mBallRepeat) nw = prev;
    else if (ms < 10 && this.GetNumPendingSingles(1) === 1 && (ms === 0 || this.GetNumPendingSingles(10) > ms)) nw = prev;
    else { do { nw = g.AppRand() % nc; } while (nw === prev); }
    b.mType = nw;
    this.mPendingBalls.push(b);
  }

  AddBall() {
    const g = this.game;
    if (!this.mPendingBalls.length) {
      if (this.mCurveDesc.mNumBalls !== 0 || this.mStopAddingBalls) return;
      this.AddPendingBall();
    }
    const b = this.mPendingBalls[0];
    this.wp.SetWayPoint(b, 1, g.visual);
    const L = this.mBallList;
    if (!L.empty()) {
      const fb = L.front();
      if (b.mWayPoint > fb.mWayPoint || fb.CollidesWith(b, 0)) return;
    }
    this.board.UpdateBallColorMap(b, true);
    b.InsertInList(L, L.begin());
    b.UpdateCollisionInfo(Math.trunc(f32(5 + this.mAdvanceSpeed)));
    b.mNeedCheckCollision = true;
    if (g.visual) b.SetRotation(this.wp.GetRotationForPoint(Math.trunc(b.mWayPoint)), true);
    b.mBackwardsCount = 0; b.mSuckCount = 0; b.mGapBonus = 0; b.mNumGaps = 0; b.mComboCount = 0; b.mComboScore = 0;
    this.mPendingBalls.shift();
  }

  UpdateBallRotation() {
    for (const b of this.mBallList) b.UpdateRotation();
    for (const b of this.mBulletList) b.UpdateRotation();
  }

  AdvanceBalls() {
    const L = this.mBallList, cd = this.mCurveDesc, board = this.board, g = this.game;
    if (L.empty()) return;
    let maxSpeed = cd.mSpeed;
    if (cd.mAccelerationRate !== 0) {
      cd.mCurAcceleration = f32(cd.mCurAcceleration + cd.mAccelerationRate);
      maxSpeed = f32(maxSpeed + cd.mCurAcceleration);
      if (maxSpeed > cd.mMaxSpeed) maxSpeed = cd.mMaxSpeed;
    }
    if (this.mSlowCount !== 0) maxSpeed = f32(maxSpeed / 4);
    if (this.mFirstChainEnd >= this.mDangerPoint - cd.mSlowDistance) {
      if (this.mFirstChainEnd < this.mDangerPoint) {
        const d = f32((this.mFirstChainEnd - (this.mDangerPoint - cd.mSlowDistance)) / f32(cd.mSlowDistance));
        maxSpeed = f32(f32(f32(1 - d) * maxSpeed) + f32(f32(d * maxSpeed) / f32(cd.mSlowFactor)));
      } else {
        maxSpeed = f32(maxSpeed / cd.mSlowFactor);
      }
    }
    if (board.mIsEndless && board.mStateCount > 300) {
      const fp = this.GetFarthestBallPercent(), hd = 30;
      if (fp < hd) {
        maxSpeed = f32(f32(f32(maxSpeed + f32((hd - fp) * maxSpeed)) * 3) / hd);
        if (maxSpeed > this.mAdvanceSpeed) this.mAdvanceSpeed = f32(this.mAdvanceSpeed + f32(0.03));
      }
    }
    if (this.mAdvanceSpeed > maxSpeed) this.mAdvanceSpeed = f32(this.mAdvanceSpeed - f32(0.1));
    if (this.mAdvanceSpeed < maxSpeed) {
      this.mAdvanceSpeed = f32(this.mAdvanceSpeed + f32(0.005));
      if (this.mAdvanceSpeed >= maxSpeed) this.mAdvanceSpeed = maxSpeed;
    }
    const vis = g.visual, wp = this.wp;
    let b = L.front();
    if (!this.mFirstBallMovedBackwards && !this.mStopTime) wp.SetWayPoint(b, f32(b.mWayPoint + this.mAdvanceSpeed), vis);
    let firstEnd = null;
    for (let n = L.begin(); n !== L.end; ) {
      b = n.ball; n = n.next;
      if (n === L.end) break;
      const nb = n.ball;
      const nwp = nb.mWayPoint, w = b.mWayPoint;
      if (w > f32(f32(nwp - BALL_R) - BALL_R)) {
        wp.SetWayPoint(nb, f32(f32(w + BALL_R) + BALL_R), vis);
        if (!b.mCollidesWithNext) { b.mCollidesWithNext = true; board.PlayBallClick('BALLCLICK1'); }
        b.mNeedCheckCollision = false;
      }
      if (firstEnd === null && !b.mCollidesWithNext) firstEnd = b;
    }
    if (firstEnd === null) firstEnd = L.back();
    this.mFirstChainEnd = Math.trunc(firstEnd.mWayPoint);
    if (this.mFirstChainEnd >= this.mDangerPoint) {
      const tick = board.BoardGetTickCount();
      const maxTime = 100 + Math.trunc(4000 * (this.GetCurveLength() - this.mFirstChainEnd) / (this.GetCurveLength() - this.mDangerPoint));
      const frame = board.mStateCount;
      if (frame >= this.mPathLightEndFrame && tick - this.mLastPathShowTick >= maxTime) {
        g.sound('WARNING');
        this.mLastPathShowTick = tick;
        this.mPathLightEndFrame = frame + this.DrawPathSparkles(this.mFirstChainEnd, 0, false);
      }
    }
    this.mInDanger = L.back().mWayPoint >= this.mDangerPoint;
  }

  AdvanceBackwardBalls() {
    this.mFirstBallMovedBackwards = false;
    const L = this.mBallList;
    if (L.empty()) return;
    const vis = this.game.visual, wp = this.wp;
    let collided = false, bs = 0;
    if (this.mBackwardCount !== 0) { L.back().mBackwardsSpeed = 1; L.back().mBackwardsCount = 1; }
    let n = L.end.prev;
    for (;;) {
      const b = n.ball;
      const bc = b.mBackwardsCount;
      if (bc > 0) {
        bs = b.mBackwardsSpeed;
        wp.SetWayPoint(b, f32(b.mWayPoint - bs), vis);
        b.mBackwardsCount = bc - 1;
        collided = true;
      }
      n = n.prev;
      if (n === L.end) break;
      const nb = n.ball;
      if (collided) {
        if (nb.mCollidesWithNext) {
          wp.SetWayPoint(nb, f32(nb.mWayPoint - bs), vis);
        } else {
          const off = f32(f32(b.mWayPoint - BALL_R) - BALL_R);
          if (nb.mWayPoint > off) {
            nb.mCollidesWithNext = true; collided = true;
            this.board.PlayBallClick('BALLCLICK1');
            bs = f32(nb.mWayPoint - off);
            nb.mWayPoint = off;        // Ball::SetWayPoint only (position not updated)
          } else collided = false;
        }
      }
    }
    if (collided) {
      this.mFirstBallMovedBackwards = true;
      if (this.mStopTime < 20) this.mStopTime = 20;
    }
  }

  UpdateSuckingBalls() {
    const L = this.mBallList, vis = this.game.visual, wp = this.wp;
    let n = L.begin();
    while (n !== L.end) {
      const b = n.ball;
      const sc = b.mSuckCount;
      if (sc <= 0) { n = n.next; continue; }
      let nb = null;
      const suck = Math.trunc(sc / 8);
      while (n !== L.end) {
        nb = n.ball; n = n.next;
        nb.mSuckCount = 0;
        wp.SetWayPoint(nb, f32(nb.mWayPoint - suck), vis);
        const bul = nb.mBullet;
        if (bul) {
          const pb = bul.GetPushBall();
          if (pb) wp.FindFreeWayPoint(pb, bul, false, 0, vis);
          bul.UpdateHitPos();
        }
        if (!nb.mCollidesWithNext) break;
      }
      b.mSuckCount = sc + 1;
      const pb = b.GetPrevBall(false);
      if (!pb) { b.mSuckCount = 0; continue; }
      const nw = f32(f32(b.mWayPoint - BALL_R) - BALL_R);
      if (pb.mWayPoint > nw) {
        wp.SetWayPoint(pb, nw, vis);
        this.board.PlayBallClick('BALLCLICK1');
        pb.mCollidesWithNext = true;
        b.mSuckCount = 0;
        if (!this.CheckSet(b)) { b.mComboCount = 0; b.mComboScore = 0; }
        if (nb.mBackwardsCount === 0) {
          nb.mBackwardsCount = 30;
          let bs = f32(b.mComboCount * f32(1.5));
          if (bs <= f32(0.5)) bs = f32(0.5);
          nb.mBackwardsSpeed = bs;
        }
        this.ClearPendingSucks(nb);
      }
    }
  }

  UpdateSets() {
    this.mHaveSets = false;
    const L = this.mBallList;
    let n = L.begin();
    while (n !== L.end) {
      const b = n.ball;
      const cc = b.mClearCount;
      if (cc > 0) this.mHaveSets = true;
      if (cc < 40) {
        if (cc > 0) b.mClearCount = cc + 1;
        n = n.next;
      } else {
        const nb = b.GetNextBall(false), pb = b.GetPrevBall(false);
        if (nb && nb.mClearCount === 0 && pb && nb.mType === pb.mType) {
          nb.mSuckCount = 10;
          nb.mComboCount = b.mComboCount + 1; nb.mComboScore = b.mComboScore;
        }
        if (n === L.begin()) {
          this.mAdvanceSpeed = 0;
          if (this.mStopTime < 40) this.mStopTime = 40;
        }
        this.DeleteBall(b);
        const nx = n.next;
        L.erase(n); b.mList = null; b.mNode = null;
        n = nx;
      }
    }
  }

  UpdatePowerUps() {
    const L = this.mBallList, g = this.game, board = this.board;
    if (L.empty()) return;
    for (let i = 0; i < 4; i++) {
      const f = this.mCurveDesc.mPowerUpFreq[i];
      if (f > 0 && (g.AppRand() % f) === 0 && f < board.mStateCount - this.mLastPowerUpFrame[i]) {
        this.AddPowerUp(i);
        this.mLastPowerUpFrame[i] = board.mStateCount;
      }
    }
  }

  RemoveBallsAtFront() {
    const L = this.mBallList;
    let n = L.begin();
    while (n !== L.end) {
      const b = n.ball;
      if (b.mWayPoint >= 1) break;
      n = n.next;
      this.DeleteBullet(b.mBullet);
      b.RemoveFromList();
      if (b.mClearCount === 0) this.board.UpdateBallColorMap(b, false);
      if (b.mClearCount !== 0 || this.mStopAddingBalls) this.DeleteBall(b);
      else this.mPendingBalls.unshift(b);
    }
  }

  // index-based (std::list<Bullet*>::iterator replaced by array index; returns next index)
  AdvanceMergingBullet(i) {
    const g = this.game, board = this.board, wp = this.wp, vis = g.visual;
    const bul = this.mBulletList[i];
    if (!bul.mHitBall || !bul.mHitBall.mList) {
      // target ball already removed (a dangling pointer in the original): drop the bullet
      bul.mHitBall = null; this.mBulletList.splice(i, 1); return i;
    }
    bul.CheckSetHitBallToPrevBall();
    const hit = bul.mHitBall;
    wp.SetWayPoint(bul, hit.mWayPoint, vis);
    wp.FindFreeWayPoint(hit, bul, bul.mHitInFront, 0, vis);
    bul.SetDestPos(bul.mx, bul.my);
    bul.Update();
    const pb = bul.GetPushBall();
    if (pb) {
      const num = f32(1 - bul.mHitPercent);
      const fpad = f32(f32(f32(-BALL_R) * num) / 2);
      const point = pb.mWayPoint;
      const pct = f32((BALL_R + BALL_R) * f32(bul.mHitPercent * bul.mHitPercent));
      wp.FindFreeWayPoint(bul, pb, true, Math.trunc(fpad), vis);
      if (f32(pb.mWayPoint - bul.mWayPoint) > pct) {
        const ep = f32(bul.mWayPoint + pct);
        if (ep > point) wp.SetWayPoint(pb, ep, vis); else wp.SetWayPoint(pb, point, vis);
      }
      pb.mNeedCheckCollision = true;
    }
    if (bul.mHitPercent >= 1) {
      const L = this.mBallList;
      let itr = hit.mNode;
      if (bul.mHitInFront) itr = itr.next;
      const nb = new Ball(g);
      nb.mRotation = bul.mRotation;
      nb.mType = bul.mType;
      nb.SetPowerType(bul.mPowerType, false);
      wp.SetWayPoint(nb, bul.mWayPoint, vis);
      nb.SetFrame(0);
      nb.InsertInList(L, itr);
      board.UpdateBallColorMap(nb, true);
      let minGap = bul.GetMinGapDist();
      const nGaps = bul.mGapInfo.length;
      bul.destroy();
      this.mBulletList.splice(i, 1);
      this.mTotalBalls++;
      const pb2 = nb.GetPrevBall(false), nx2 = nb.GetNextBall(false);
      nb.UpdateCollisionInfo(5);
      nb.mNeedCheckCollision = true;
      if (pb2 && nb.GetCollidesWithPrev()) pb2.mNeedCheckCollision = true;
      if (minGap > 0) {
        minGap -= BALL_R * 4;
        if (minGap < 0) minGap = 0;
        const rate = board.mIsEndless ? 250 : 500;
        let gb = Math.trunc((MAX_GAP_SIZE - minGap) * rate / MAX_GAP_SIZE);
        gb = Math.trunc(gb / 10) * 10;
        if (gb < 10) gb = 10;
        if (nGaps > 1) gb *= nGaps;
        nb.mGapBonus = gb & 0xffff; nb.mNumGaps = nGaps & 0xffff;
      }
      board.mNumClearsInARow++;
      g.lastLanded = nb;
      if (!this.CheckSet(nb)) {
        board.mNumClearsInARow--;
        if (pb2 && !pb2.mCollidesWithNext && pb2.mType === nb.mType && pb2.mBullet === null && pb2.mClearCount === 0) {
          nb.mSuckPending = true; nb.mSuckCount = 1;
        } else if (nx2 && !nb.mCollidesWithNext && nx2.mType === nb.mType && nx2.mBullet === null && nx2.mClearCount === 0) {
          nb.mSuckPending = true;
          if (nx2.mSuckCount <= 0) nx2.mSuckCount = 1;
        } else {
          board.ResetInARowBonus();
          nb.mGapBonus = 0; nb.mNumGaps = 0;
        }
      }
      return i;
    }
    return i + 1;
  }

  AdvanceBullets() {
    let i = 0;
    while (i < this.mBulletList.length) i = this.AdvanceMergingBullet(i);
  }

  StartClearCount(ball) {
    if (ball.mClearCount > 0) return;
    const board = this.board;
    board.UpdateBallColorMap(ball, false);
    board.mLevelStats.mNumBallsCleared++;
    board.mNumCleared++;
    board.mClearedXSum += Math.trunc(ball.mx);
    board.mClearedYSum += Math.trunc(ball.my);
    this.mLastClearedBallPoint = Math.trunc(ball.mWayPoint);
    if (ball.mSuckPending) ball.mSuckPending = false;
    ball.StartClearCount(this.game, this.wp.InTunnelPt(Math.trunc(ball.mWayPoint)));
    if (ball.GetPowerTypeWussy() !== PT_NONE) { board.ActivatePower(ball); this.mHadPowerUp = true; }
  }

  ActivateBomb(ball) {
    const g = this.game, board = this.board;
    const bx = Math.trunc(ball.mx), by = Math.trunc(ball.my);
    const pm = board.particles;
    pm.AddExplosion(bx, by, 0, BALL_COLORS[ball.mType], 5);
    const v19 = Math.trunc(85 / 3);     // IMAGE_EXPLOSION->mWidth / 3
    for (let i = v19, a6 = 7; i < 100; i += v19, a6 += 4) {
      let v21 = 0;
      do {
        const rx = g.AppRand() % 21 - 10, ry = g.AppRand() % 21 - 10;
        pm.AddExplosion(Math.trunc(bx + rx + f32(Math.sin(v21) * i)), Math.trunc(by + ry + f32(Math.cos(v21) * i)), 0, BALL_COLORS[ball.mType], a6);
        v21 = f32(v21 + f32(f32(v19) / f32(i)));
      } while (v21 < f32(SEXY_PI * 2));
    }
    pm.AddExplosion(Math.trunc(ball.mx), Math.trunc(ball.my), 0, BALL_COLORS[ball.mType], 0);
    for (const b of this.mBallList) {
      if (b.mClearCount === 0 && b.CollidesWithPhysically(ball, 45)) {
        b.mComboCount = board.mCurComboCount; b.mComboScore = board.mCurComboScore;
        board.mNeedComboCount.push(b);
        this.StartClearCount(b);
      }
    }
  }

  ClearPendingSucks(endBall) {
    if (!endBall) return;
    let b = endBall, coll = true;
    while (b) {
      if (b.mSuckPending) { b.mSuckPending = false; this.board.ResetInARowBonus(); b.mGapBonus = 0; b.mNumGaps = 0; }
      b = b.GetPrevBall(false);
      if (!b) return;
      if (!b.mCollidesWithNext) coll = false;
      if (!coll && b.mSuckCount !== 0) return;
    }
  }

  RollBallsIn() {
    const sp = this.mCurveDesc.mSpeed;
    let sd = 50;
    if (!this.board.mIsEndless) sd = this.mCurveDesc.mStartDistance;
    let w = f32(Math.trunc(sd * this.wp.n / 100));
    w = f32(w - f32(this.mFirstChainEnd / this.wp.n));
    if (this.mFirstChainEnd <= 0 || w > 0) {
      const a = f32(sp + 20);
      this.mAdvanceSpeed = f32(sp + f32(f32(f32(f32(f32(Math.sqrt(f32(f32(a * a) + f32(f32(w * -20) * -4)))) - a) * f32(0.5)) + 18) * f32(0.1)));
    } else this.mAdvanceSpeed = this.mCurveDesc.mSpeed;
  }
}

const BALL_COLORS = [0x1980FF, 0xFFFF00, 0xFF0000, 0x00FF00, 0xFF00FF, 0xFFFFFF];
const BRIGHT_BALL_COLORS = [0x80FFFF, 0xFFFF40, 0xFFAAAA, 0x80FF80, 0xFF80FF, 0xFFFFFF];
const DARK_BALL_COLORS = [0x231679, 0x60510A, 0xA00F14, 0x204422, 0x561643, 0x381B22];
const TEXT_BALL_COLORS = [0x2D8BFF, 0xFFFF00, 0xFF0000, 0x00FF00, 0xFF00FF, 0xFFFFFF];

// ------------------------------------------------------------------------------------------
// Board + level flow (Board.cpp, TransitionMgr.cpp)
// ------------------------------------------------------------------------------------------
const ST_NONE = 0, ST_PLAYING = 1, ST_LOSING = 2, ST_LEVELUP = 3, ST_LEVELBEGIN = 4;
const TS_NONE = 0, TS_LEVELBEGIN = 1, TS_BONUS = 2, TS_STAGECOMPLETE = 3, TS_TEMPLECOMPLETE = 4, TS_QUAKE = 5, TS_LOSING = 6;

function newStats() {
  return { mTimePlayed: 0, mNumBallsCleared: 0, mNumGemsCleared: 0, mNumGaps: 0, mNumCombos: 0, mMaxCombo: -1,
    mMaxComboScore: 0, mMaxInARow: 0, mMaxInARowScore: 0 };
}
function addStats(a, b) {
  a.mTimePlayed += b.mTimePlayed; a.mNumBallsCleared += b.mNumBallsCleared; a.mNumGemsCleared += b.mNumGemsCleared;
  a.mNumCombos += b.mNumCombos; a.mNumGaps += b.mNumGaps;
  if (b.mMaxCombo > a.mMaxCombo || (b.mMaxCombo === a.mMaxCombo && b.mMaxComboScore > a.mMaxComboScore)) { a.mMaxCombo = b.mMaxCombo; a.mMaxComboScore = b.mMaxComboScore; }
  if (b.mMaxInARow > a.mMaxInARow) { a.mMaxInARow = b.mMaxInARow; a.mMaxInARowScore = b.mMaxInARowScore; }
}


// ------------------------------------------------------------------------------------------
// ParticleMgr (ParticleMgr.cpp). Visual items are only kept when game.visual; floating texts that
// carry a score increment (end-of-level "+100") are always kept because they add score.
// ------------------------------------------------------------------------------------------
class ParticleMgr {
  constructor(board) { this.board = board; this.game = board.game; this.Clear(); }
  Clear() { this.sparkles = [[], [], [], [], [], []]; this.explosions = []; this.texts = []; }
  AddSparkle(x, y, vx, vy, pri, dur, stagger, color) {
    if (!this.game.visual) return;
    this.sparkles[pri].push({ x: f32(x - 10), y: f32(y - 10), vx, vy, dur: dur > 0 ? dur : 28, frame: 0, cnt: -(stagger || 0),
      color: color === undefined ? 0xFFFF00 : color });
  }
  AddExplosion(x, y, r, color, stagger) {
    if (!this.game.visual) return;
    this.explosions.push({ x, y, r, color, cnt: -(stagger || 0), curColor: 0 });
  }
  AddFloatingText(x, y, color, text, font, stagger, inc, dur, fade) {
    if (!this.game.visual && !(inc > 0)) return;
    this.texts.push({ x, y, color, text, font, cnt: -(stagger || 0), inc: inc || 0, dur: dur === undefined ? 100 : dur, fade: !!fade });
  }
  // FloatingTextHelper::AddText + AddToMgr; lines = [[text, fontId, color], ...]
  FloatingText(lines, x, y, stagger, inc) {
    if (!lines.length) return;
    if (!this.game.visual) {
      if (inc > 0) for (const l of lines) this.texts.push({ cnt: -(stagger || 0), inc, dur: 100, y: 0 });
      return;
    }
    const F = G.ZumaFont;
    const descs = lines.map(([t, f, c]) => { const ft = F.getFont(f); return { t, f, c, w: ft.StringWidth(t), h: ft.GetLineSpacing() }; });
    let tw = 0, th = 0;
    for (const d of descs) { if (tw >= d.w) tw = d.w; th += d.h; }
    let tx = x - Math.trunc(tw / 2), ty = y + Math.trunc(th / 2);
    if (tw + tx > 600) tx = 600 - tw;
    if (th - ty > 440) ty = 440 - th;
    if (ty < 100) ty = 100;
    if (tx < 40) tx = 40;
    for (const d of descs) {
      this.AddFloatingText(tx + Math.trunc((tw - d.w) / 2), ty, d.c, d.t, d.f, stagger, inc);
      ty += d.h;
    }
  }
  Update() {
    if (this.game.visual) {
      for (let p = 0; p < 6; p++) {
        const L = this.sparkles[p];
        if (!L.length) continue;
        let w = 0;
        for (let i = 0; i < L.length; i++) {
          const sp = L[i];
          sp.cnt++;
          if (sp.cnt >= 0) {
            sp.frame = (sp.cnt >> 1) % 14;
            if (sp.cnt >= sp.dur) continue;
            sp.x = f32(sp.x + sp.vx); sp.y = f32(sp.y + sp.vy);
          }
          L[w++] = sp;
        }
        L.length = w;
      }
      const E = this.explosions;
      let w = 0;
      for (let i = 0; i < E.length; i++) {
        const e = E[i];
        e.cnt++;
        if (e.cnt >= 0) {
          if (e.cnt > 50) continue;
          const a = 200 - 4 * e.cnt;
          e.curColor = ((a > 0 ? (a << 24) : 0x1000000) | e.color) >>> 0;
        }
        E[w++] = e;
      }
      E.length = w;
    }
    const T = this.texts;
    if (T.length) {
      let w = 0;
      for (let i = 0; i < T.length; i++) {
        const t = T[i];
        t.cnt++;
        if (t.cnt >= 0) {
          if (t.cnt === 1 && t.inc > 0) this.board.IncScore(t.inc);
          if (t.cnt > t.dur) continue;
          t.y--;
        }
        T[w++] = t;
      }
      T.length = w;
    }
  }
}

// SoundMgr (delayed sounds); purely audio, only active when a sound sink is attached
class SoundMgr {
  constructor(game) { this.game = game; this.cnt = 0; this.queue = []; }
  Add(id, delay, pitch) {
    const sink = this.game.soundSink;
    if (!sink) return;
    if (!delay) sink(id, 0, pitch || 0);
    else { this.queue.push({ t: this.cnt + delay, id, pitch: pitch || 0 }); this.queue.sort((a, b) => a.t - b.t); }
  }
  Update() {
    this.cnt++;
    if (!this.queue.length) return;
    const sink = this.game.soundSink;
    while (this.queue.length && this.queue[0].t <= this.cnt) { const q = this.queue.shift(); if (sink) sink(q.id, 0, q.pitch); }
  }
}

const TEMPLE_TEXTS = [
  ["Interloper of puny!  You suppose the secret of Zuma it is possible to take the knowing so easily?  No!  There is defect for your thinking!  Our cryptic hidden nature cannot be discovered so directly.  Three mystery shrines protect method!  Never you will strike past them!", 0],
  ["I see what?!?  You have lived still.  Is it possible to be the one of which the ancient prophecy speaks?  It was sent in order perhaps to release me from my wicked capture person finally.  But no namely this was the story of the exactly old wive.  You want to live, now retreat!", 1],
  ["As for me it is not possible to believe!  Your power namely that is large!  But there is one more temple which you do not find, that the Zuma deeply buried under the land.  It was hidden, it is the temple of secret!  You the final temple must fight in order to take the cover of position of my jail!!", 1],
  ["The final temple of Zuma was struck!  Your extreme power is not possible to be defeated!  As for me it can taste the taste whose almost freedom is sweet sweetly.  But God of the sun can be imprisoned at only that true house.", 1],
  ["Excellent work, mighty frog one!  You obtained your lawful place of the stars, at the side of the ancient ruler of the Zuma.  In the future, as for me, you are known as our sibling.  I will call you brother, and we control the outer space together!  It is joyous news!  Now we are to the dance!", 4],
];

const STATS_DIALOG_MIN = 17;

class Board {
  constructor(game) {
    this.game = game;
    this.gun = new Gun(game);
    this.mCurveMgr = [];
    this.mNumCurves = 0;
    this.mScore = 0; this.mScoreDisplay = 0; this.mLevel = 0; this.mStartLevel = 0; this.mLevelBeginScore = 0;
    this.mLives = 3; this.mStateCount = 0; this.mGameState = ST_NONE; this.mPauseCount = 0; this.mDialogCount = 0;
    this.mFlashCount = 30; this.mDifficultyDiff = 0; this.mLevelEndFrame = 0; this.mMaxStage = 0;
    this.mLevelDesc = null; this.mNextLevelDesc = null;
    this.mScoreTarget = 0; this.mCurBarSize = 0; this.mTargetBarSize = 0; this.mBarBlinkCount = 0; this.mLivesBlinkCount = 0;
    this.mAccuracyCount = 0; this.mDestroyAll = true; this.mHaveReachedTarget = false; this.mLevelBeginning = false;
    this.mIsWinning = false; this.mIsEndless = false; this.mNumClearsInARow = 0; this.mCurInARowBonus = 0;
    this.mNumCleared = 0; this.mClearedXSum = 0; this.mClearedYSum = 0; this.mCurComboCount = 0; this.mCurComboScore = 0;
    this.mNeedComboCount = []; this.mBallColorMap = new Map();
    this.mBulletList = [];
    this.mCurTreasure = null; this.mCurTreasureNum = 0; this.mTreasureEndFrame = 0; this.mTreasureZoomFrame = 0;
    this.mTreasureZoomX = 0; this.mTreasureZoomY = 0;
    this.mLevelStats = newStats(); this.mGameStats = newStats();
    this.mLevelString = ''; this.mVerboseLevelString = '';
    this.mShowGuide = false; this.mDoGuide = false; this.mRecalcGuide = false; this.mGuide = null; this.mGuideCenter = [0, 0];
    this.mLastBallClickTick = 0; this.mLastExplosionTick = 0;
    this.holeFlashes = [];
    this.holes = [];
    this.particles = new ParticleMgr(this);
    this.sounds = new SoundMgr(game);
    this.vis = { stamps: [], blurbs: [], bgSprites: null, quake: false };
    this.bgSpriteCount = 0;     // number of background transition sprites (AppRand consumer during the quake)
    // TransitionMgr state that matters for flow
    this.tr = { state: TS_NONE, count: 0, resetFrame: 0, quakeFrame: 0, stageCompleteFrame: 0, doStageUp: false, doTempleUp: false };
    this.statsDialog = null;    // {kind:'level'|'gameover'|'final', openTick}
    this.continueVisible = false;
    this.lastMouse = [320, 240];
  }

  BoardGetTickCount() { return 10 * this.mStateCount; }
  addSound(id, delay, pitch) { this.sounds.Add(id, delay || 0, pitch || 0); }
  AddHoleFlash(curve, stagger) { this.holeFlashes.push({ cnt: -stagger, curve }); }
  ClearHoleFlashes() {
    this.holeFlashes = [];
    for (const h of this.holes) { h.bright = [0, 0, 0]; h.total = 0; }
  }
  AddLetterStamp(text, x, y, color, stagger, font, dur) {
    if (!this.game.visual) return;
    this.vis.stamps.push({ text, x, y, color, cnt: -stagger, font: font || 'HUGE', dur: dur || 0 });
  }
  // DrawTextParticles: sparkles on ~1/50 of the opaque pixels of the HUGE glyphs
  TextParticles(str, x, y, stagger) {
    const g = this.game, F = G.ZumaFont, huge = F.getFont('HUGE');
    const mask = g.data.fontMasks && g.data.fontMasks.nativealien48;
    if (!mask) return;
    if (!mask.bits) mask.bits = b64ToBytes(mask.b64);
    y -= huge.GetAscent();
    for (const c of huge.layout(0, huge.GetAscent(), str, [255, 255, 255, 255])) {
      for (let j = 0; j < c.sh; j++) for (let i = 0; i < c.sw; i++) {
        const px = c.sx + i, py = c.sy + j, bit = py * mask.w + px;
        if ((mask.bits[bit >> 3] >> (bit & 7)) & 1) {
          if (g.Rand() % 50 === 0) {
            const col = BRIGHT_BALL_COLORS[g.Rand() % 6];
            this.particles.AddSparkle(c.dx + i + x, c.dy + j + y, 0, 0, 0, 0, stagger + g.Rand() % 10, col);
          }
        }
      }
    }
  }
  // TransitionMgr::AddTextBlurb / AddTextBlurbWrap; returns the stagger/duration like the original
  AddTextBlurb(text, x, y, stagger) {
    let st = -stagger;
    if (stagger > 0) st = 3 - stagger;
    const b = { charNum: Math.trunc(st / 4), delay: 0, color: 0xFFFF00, font: 'DIALOG', x, y, text };
    this.vis.blurbs.push(b);
    let dur = -4 * b.charNum;
    for (let i = 0; i < text.length;) {
      const c = text[i++];
      const n = i < text.length - 1 ? text[i] : '';
      if (c === '.' || c === '?' || c === '!') dur += 16;
      else if (n === '.' || n === '?' || n === '!') dur += 16;
      else dur += 4;
    }
    return dur;
  }
  AddTextBlurbWrap(text, x, y, maxW, stagger) {
    const font = G.ZumaFont.getFont('DIALOG');
    let s = text, pc = null, len = 0, i = 0, we = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === ' ') we = i;
      len += font.CharWidthKern(c, pc);
      if (len > maxW) {
        stagger = this.AddTextBlurb(s.substr(0, we), x, y, stagger);
        y += font.GetLineSpacing();
        s = s.substr(we + 1); pc = null; len = 0; we = 0; i = 0;
        continue;
      }
      i++; pc = c;
    }
    return this.AddTextBlurb(s, x, y, stagger);
  }
  TempleText(t) {
    this.vis.blurbs = [];
    if (!G.ZumaFont || t > 4) return 250;
    const [txt, ending] = TEMPLE_TEXTS[t];
    const ends = ['Ribbit.', 'Ribbit.', 'Ribbit.', 'Ribbit?', 'Ribbit!'];
    let st = this.AddTextBlurbWrap(txt, 220, 180, 380, 150);
    if (t === 3) {
      this.AddTextBlurb(ends[1], 200, 380, st + 100);
      const ty = 6 * G.ZumaFont.getFont('DIALOG').GetLineSpacing() + 180;
      this.AddTextBlurbWrap('We come from the star, return to the star!  It is of you to rescue of my star.', 220, ty, 380, st + 50);
      return st + 100;
    }
    st = this.AddTextBlurb(ends[ending], 200, 380, st + 100);
    return st + 100;
  }
  // SpriteMgr::UpdateBackgroundTransition position clamp
  BgMove(sp, dx, dy) {
    const x = sp.x, y = sp.y;
    sp.x += dx; sp.y += dy;
    if ((x <= 0 && sp.x >= 0) || (x + sp.w >= 630 && sp.x + sp.w < 640)) sp.x = x;
    if ((y <= 0 && sp.y >= 0) || (y + sp.h >= 470 && sp.y + sp.h < 480)) sp.y = y;
  }
  MakeBgSprites(desc) {
    const g = this.game, out = [];
    for (const d of desc.mBackgroundAlpha) {
      const key = d.mImagePath.toLowerCase().split('\\').join('/');
      const im = g.data.levelImages[key];
      if (!im) continue;
      const v12 = Math.trunc(f32(d.vx * -10)), v13 = Math.trunc(f32(-10 * d.vy));
      const sx = v12 < 0 ? 0 : v12, sy = v13 >= 0 ? v13 : 0;
      const ix = v12 <= 0 ? -v12 : 0, iy = v13 <= 0 ? -v13 : 0;
      const sp = { mask: key, mx: d.x, my: d.y, mw: im.w, mh: im.h, w: im.w + Math.abs(v12), h: im.h + Math.abs(v13),
        shadow: [sx, sy], img: [ix, iy], x: d.x + (v12 < 0 ? v12 : 0), y: d.y + (v13 < 0 ? v13 : 0), vx: d.vx, vy: d.vy };
      out.push(sp);
    }
    return out;
  }
  PlayBallClick(id) {
    const t = this.BoardGetTickCount();
    if (t - this.mLastBallClickTick >= 250) { this.game.sound(id); this.mLastBallClickTick = t; }
  }

  DoAccuracy(acc) {
    this.mRecalcGuide = acc; this.mShowGuide = acc; this.mDoGuide = acc;
    if (acc) this.gun.mFireVel = f32(15);
    else { this.mAccuracyCount = 0; this.gun.mFireVel = this.mLevelDesc.mFireSpeed; }
  }

  StartLevel() {
    this.mGameState = ST_PLAYING;
    this.mStateCount = 0;
    this.ClearHoleFlashes();
    this.particles.Clear();
    this.trClear();
    this.gun.mFireVel = this.mLevelDesc.mFireSpeed;
    this.gun.SetPos(this.mLevelDesc.mGunX, this.mLevelDesc.mGunY);
    this.game.loop('ROLLING', true);
    this.mLevelBeginning = true;
    this.game.event('startLevel');
  }

  SetLosing() {
    this.game.loop('ROLLING', false);
    this.ResetInARowBonus();
    this.mLevelStats.mTimePlayed = this.mStateCount;
    addStats(this.mGameStats, this.mLevelStats);
    this.mLevelStats = newStats();
    this.DeleteBullets();
    if (!this.gun.StartFire(false)) this.gun.EmptyBullets();
    for (let i = 0; i < this.mNumCurves; i++) this.mCurveMgr[i].SetLosing();
    this.mGameState = ST_LOSING;
    this.mStateCount = 0;
    this.mLives--;
    if (this.mLives <= 0) this.game.song('gameover');
    this.trClear();
    this.tr.resetFrame = 0; this.tr.count = 0; this.tr.state = TS_LOSING; this.tr.curFrogAngle = this.gun.mAngle;
    this.game.event('losing');
  }

  DoLevelUp() {
    const g = this.game;
    if (this.mNextLevelDesc && this.mNextLevelDesc.mStage > g.profile.mMaxStage) g.profile.mMaxStage = this.mNextLevelDesc.mStage;
    this.game.loop('ROLLING', false);
    this.mTargetBarSize = 256; this.mCurBarSize = 256;
    if (this.mNumClearsInARow > this.mLevelStats.mMaxInARow) { this.mLevelStats.mMaxInARow = this.mNumClearsInARow; this.mLevelStats.mMaxInARowScore = this.mCurInARowBonus; }
    this.ResetInARowBonus();
    this.mLevelStats.mTimePlayed = this.mStateCount;
    addStats(this.mGameStats, this.mLevelStats);
    g.song('levelup');
    this.DoAccuracy(false);
    // DoGenerateBackgroundTransitions (loader thread): own BackgroundAlpha or a random one picked with the
    // loader thread's CRT rand()
    let bgDesc = this.mLevelDesc;
    if (!bgDesc.mBackgroundAlpha.length) bgDesc = g.parser.getBackgroundTransition(g.loaderRand);
    this.bgTransitionDesc = bgDesc;
    this.bgSpriteCount = bgDesc.mBackgroundAlpha.length;
    this.vis.bgSprites = g.visual ? this.MakeBgSprites(bgDesc) : null;
    this.vis.bgSource = this.mLevelDesc;
    this.vis.quake = false;
    this.levelTimes.push(this.mStateCount);
    for (let i = 0; i < this.mNumCurves; i++) this.mCurveMgr[i].DeleteBalls();
    this.DeleteBullets();
    if (!this.gun.StartFire(false)) this.gun.EmptyBullets();
    this.mGameState = ST_LEVELUP;
    // TransitionMgr::DoLevelUp
    this.trClear();
    const tr = this.tr;
    tr.quakeFrame = 20;
    for (let i = 0; i < this.mNumCurves; i++) {
      if (i !== 0) tr.quakeFrame += 50;
      tr.quakeFrame = this.mCurveMgr[i].DrawEndLevelBonus(tr.quakeFrame);
    }
    tr.quakeFrame += 50;
    tr.state = TS_BONUS; tr.count = 0;
    tr.doStageUp = this.mNextLevelDesc.mStage !== this.mLevelDesc.mStage;
    if (!tr.doStageUp) tr.doTempleUp = false;
    else { const s = this.mLevelDesc.mStage; tr.doTempleUp = ((s + 1) % 3 === 0 || s === 12); }
    this.mStateCount = 0;
    g.event('levelUp');
  }

  CheckEndConditions() {
    if (this.mBulletList.length || this.gun.mState === GS_FIRING) return;
    let i;
    for (i = 0; i < this.mNumCurves; i++) if (!this.mCurveMgr[i].IsWinning()) break;
    if (i === this.mNumCurves) { this.DoLevelUp(); return; }
    for (i = 0; i < this.mNumCurves; i++) if (this.mCurveMgr[i].IsLosing()) break;
    if (i !== this.mNumCurves) { this.SetLosing(); return; }
    for (i = 0; i < this.mNumCurves; i++) if (this.mCurveMgr[i].mInDanger) break;
    this.game.switchSong(i === this.mNumCurves ? 'main' : 'danger');
  }

  AdvanceFreeBullet(idx) {
    const b = this.mBulletList[idx], g = this.game;
    b.Update();
    const tre = this.mCurTreasure;
    if (tre) {
      const dx = f32(b.mx - tre.x - 15), dy = f32(b.my - tre.y - 15);
      const r = f32(BALL_R + 20);
      if (f32(f32(dx * dx) + f32(dy * dy)) < f32(r * r)) {
        ++this.mLevelStats.mNumGemsCleared;
        let bonus = Math.trunc((this.mScoreTarget - this.mLevelBeginScore) / 600) * 100;
        if (this.mIsEndless) { if (bonus < 200) bonus = 200; } else if (bonus < 500) bonus = 500;
        this.particles.FloatingText([['BONUS +' + bonus, 'FLOAT', 0xFFFF00]], tre.x, tre.y, 0, 0);
        this.IncScore(bonus);
        g.sound('JEWEL_HIT');
        this.mTreasureZoomFrame = 1; this.mTreasureZoomX = tre.x; this.mTreasureZoomY = tre.y;
        if (g.visual) for (let i = 0; i < 10; i++) {
          const a = f32(f32(Math.trunc(i * 360 / 10) * SEXY_PI) / 180);
          const vx = f32(Math.cos(a)), vy = f32(Math.sin(a));
          const col = BRIGHT_BALL_COLORS[g.Rand() % 6];
          this.particles.AddSparkle(tre.x + vx * 16, tre.y + vx * 16, 2 * vx, 2 * vy, 5, 0, g.Rand() % 5, col);
        }
        this.mCurTreasure = null;
        b.destroy();
        this.mBulletList.splice(idx, 1);
        g.stats.coins++;
        return idx;
      }
    }
    for (let i = 0; i < this.mNumCurves; i++) {
      if (this.mCurveMgr[i].CheckCollision(b)) { this.mBulletList.splice(idx, 1); return idx; }
    }
    for (let i = 0; i < this.mNumCurves; i++) this.mCurveMgr[i].CheckGapShot(b);
    if (b.mx >= 0 && b.my >= 0 && f32(b.mx - BALL_R) < 640 && f32(b.my - BALL_R) < 480) return idx + 1;
    this.ResetInARowBonus();
    b.destroy();
    this.mBulletList.splice(idx, 1);
    g.stats.wasted++;
    return idx;
  }

  UpdateBullets() { let i = 0; while (i < this.mBulletList.length) i = this.AdvanceFreeBullet(i); }

  UpdatePlaying() {
    const g = this.game;
    const fired = this.gun.GetFiredBullet();
    if (fired) { this.mBulletList.push(fired); this.CheckReload(); }
    this.UpdateBullets();
    this.UpdateTreasure();
    if (this.mLevelBeginning) {
      let still = false;
      for (let i = 0; i < this.mNumCurves; i++) if (!this.mCurveMgr[i].HasReachedCruisingSpeed()) still = true;
      if (!still || this.mStateCount > 500) { this.mLevelBeginning = false; g.loop('ROLLING', false); }
    }
    if (!this.mHaveReachedTarget && this.mCurBarSize === 256 && this.mScore >= this.mScoreTarget) {
      this.mBarBlinkCount = 224; this.mFlashCount = 50;
      g.sound('BAR_FULL');
      if (this.mIsEndless) this.DoLevelUp();
      else {
        this.mHaveReachedTarget = true;
        this.targetReachedFrame = this.mStateCount;
        for (let i = 0; i < this.mNumCurves; i++) {
          this.mCurveMgr[i].SetStopAddingBalls(true);
          if (!this.mDestroyAll) this.mCurveMgr[i].DetonateBalls();
        }
        g.event('target');
      }
      if (!this.mDestroyAll) g.sound('EXPLODE');
    }
    const diff = this.mScoreTarget - this.mLevelBeginScore;
    if (diff > 0) {
      const rem = this.mScoreTarget - this.mScore;
      if (rem < 0) {
        if (this.mLevelEndFrame !== 0) {
          if (this.mStateCount - 3000 === this.mLevelEndFrame) {
            for (let i = 0; i < this.mNumCurves; i++) {
              const cd = this.mLevelDesc.mCurveDesc[i];
              cd.mPowerUpFreq[0] = 500; cd.mPowerUpFreq[1] = 0; cd.mPowerUpFreq[2] = 0; cd.mPowerUpFreq[3] = 0;
              cd.mAccelerationRate = f32(0.0003);
            }
          }
        } else if (this.mBallColorMap.size === 2) this.mLevelEndFrame = this.mStateCount;
      }
      this.mTargetBarSize = 256 - Math.trunc(rem * 256 / diff);
    }
    for (let i = 0; i < this.mNumCurves; i++) this.mCurveMgr[i].UpdatePlaying();
    this.CheckEndConditions();
    if (this.mStateCount > 50) this.CheckReload();
  }

  mapNth(n) { let i = 0; for (const k of this.mBallColorMap.keys()) { if (i === n) return k; i++; } return 0; }
  sortedColorMap() {   // std::map<int,int> iteration order (ascending keys)
    if (this.mapDirty) { this.mBallColorMap = new Map([...this.mBallColorMap.entries()].sort((a, b) => a[0] - b[0])); this.mapDirty = false; }
  }
  CheckReload() {
    const g = this.game;
    if (this.mBallColorMap.size === 0) return;
    this.sortedColorMap();
    const gun = this.gun;
    if (gun.mBullet && !this.mBallColorMap.has(gun.mBullet.mType)) gun.SetBulletType(this.mapNth(g.AppRand() % this.mBallColorMap.size));
    if (gun.mNextBullet && !this.mBallColorMap.has(gun.mNextBullet.mType)) gun.SetNextBulletType(this.mapNth(g.AppRand() % this.mBallColorMap.size));
    while (gun.NeedsReload()) gun.Reload(this.mapNth(g.AppRand() % this.mBallColorMap.size), true, PT_NONE);
  }
  UpdateBallColorMap(ball, added) {
    const m = this.mBallColorMap, t = ball.mType;
    if (added) { if (!m.has(t)) { m.set(t, 1); this.mapDirty = true; } else m.set(t, m.get(t) + 1); }
    else if (m.has(t)) { const v = m.get(t) - 1; if (v <= 0) m.delete(t); else m.set(t, v); }
  }

  UpdateGuide() {
    const gun = this.gun;
    const ang = f32(gun.mAngle - f32(SEXY_PI / 2));
    const dx = f32(Math.sin(ang)), dy = f32(Math.cos(ang));
    const dx3 = f32(dx * 16), dy3 = f32(dy * 16);
    const cx = f32(gun.mCenterX + f32(dy * 50)), cy = f32(gun.mCenterY + f32(dx * -50));
    const g1x = f32(cx - dx3), g1y = f32(cy - dy3), g2x = f32(cx + dx3), g2y = f32(cy + dy3);
    const v1x = f32(Math.cos(ang)), v1y = f32(-Math.sin(ang));
    const best = { t: 10000000 };
    let ball = null;
    for (let i = 0; i < this.mNumCurves; i++) { const h = this.mCurveMgr[i].CheckBallIntersection(g1x, g1y, v1x, v1y, best); if (h) ball = h; }
    for (let i = 0; i < this.mNumCurves; i++) { const h = this.mCurveMgr[i].CheckBallIntersection(g2x, g2y, v1x, v1y, best); if (h) ball = h; }
    if (!ball) best.t = f32(1000 / Math.sqrt(v1x * v1x + v1y * v1y));
    const gx = f32(cx + f32(v1x * best.t)), gy = f32(cy + f32(v1y * best.t));
    if (!this.mRecalcGuide && this.mShowGuide && Math.hypot(this.mGuideCenter[0] - gx, this.mGuideCenter[1] - gy) < 20) return;
    this.mGuideCenter = [gx, gy];
    this.mShowGuide = true; this.mRecalcGuide = false;
    this.mGuide = [[Math.trunc(g1x + dx3 * 0.5), Math.trunc(g1y + dy3 * 0.5)], [Math.trunc(g2x - dx3 * 0.5), Math.trunc(g2y - dy3 * 0.5)],
      [Math.trunc(gx + dx), Math.trunc(gy + dy)], [Math.trunc(gx - dx), Math.trunc(gy - dy)]];
  }

  UpdateTreasure() {
    const g = this.game, d = this.mLevelDesc;
    if (this.mTreasureZoomFrame !== 0) { this.mTreasureZoomFrame++; if (this.mTreasureZoomFrame > 40) this.mTreasureZoomFrame = 0; }
    if (this.mCurTreasure) {
      if (this.mStateCount > this.mTreasureEndFrame) { g.sound('JEWEL_DISAPPEAR'); this.mCurTreasure = null; }
      return;
    }
    if (this.mScore >= this.mScoreTarget) return;
    if (!d.mTreasurePoints.length) return;
    const r = g.AppRand() % d.mTreasureFreq;
    if (r !== 0 || d.mTreasureFreq >= this.mStateCount - this.mTreasureEndFrame) return;
    const np = d.mTreasurePoints.length;
    for (let i = 0; i < np * 2; i++) {
      this.mCurTreasureNum = g.AppRand() % np;
      this.mCurTreasure = d.mTreasurePoints[this.mCurTreasureNum];
      for (let j = 0; j < this.mNumCurves; j++) {
        if (this.mCurTreasure.mCurveDist[j] === 0) continue;
        const fp = this.mCurveMgr[j].GetFarthestBallPercent();
        if (this.mCurTreasure.mCurveDist[j] > fp) { this.mCurTreasure = null; return; }
      }
      if (this.mCurTreasure) {
        g.sound('JEWEL_APPEAR');
        this.mTreasureEndFrame = this.mStateCount + 1000;
        if (g.visual) for (let j = 0; j < 360; j += 90) {
          const col = BRIGHT_BALL_COLORS[g.Rand() % 6], r = g.Rand() % 5;
          const sy = this.mCurTreasure.y + Math.sin(j * SEXY_PI / 180) * 4 - 15, sx = this.mCurTreasure.x + Math.cos(j * SEXY_PI / 180) * 4 + 10;
          this.particles.AddSparkle(sx, sy, 0, 0.25, 5, 0, r, col);
        }
        g.event('coin');
        break;
      }
    }
  }

  UpdateMiscStuff() {
    if (this.mScoreDisplay !== this.mScore) {
      if (this.mScoreDisplay < this.mScore) this.mScoreDisplay += Math.trunc((this.mScore - this.mScoreDisplay) / 50.0 + 2.0);
      if (this.mScoreDisplay > this.mScore) this.mScoreDisplay = this.mScore;
    }
    if (this.mCurBarSize !== this.mTargetBarSize) {
      if (this.mCurBarSize < this.mTargetBarSize) this.mCurBarSize++;
      if (this.mCurBarSize > this.mTargetBarSize) this.mCurBarSize--;
    }
    if (this.mBarBlinkCount > 0) this.mBarBlinkCount--;
    if (this.mFlashCount > 0) { this.game.ballBlink = true; if (--this.mFlashCount === 0) this.game.ballBlink = false; }
    if (this.mLivesBlinkCount > 0) this.mLivesBlinkCount--;
    if (this.mAccuracyCount > 0) { if (--this.mAccuracyCount === 0) this.DoAccuracy(false); }
  }

  UpdateHoles() {   // SpriteMgr::UpdateHoles (visual)
    for (const f of this.holeFlashes) {
      f.cnt++;
      if (f.cnt < 0) continue;
      let b = 0;
      if (f.cnt < 30) b = Math.trunc(255 * f.cnt / 30);
      else if (f.cnt < 60) b = 255 - Math.trunc((f.cnt - 30) * 255 / 30);
      const cm = this.mCurveMgr.find(c => c.mCurveNum === f.curve);
      const h = cm && this.holes[cm.holeIdx];
      if (!h) continue;
      h.bright[f.curve] = b;
      for (let i = 0; i < 3; i++) if (b < h.bright[i]) b = h.bright[i];
      h.total = b;
    }
  }

  Update() {
    const g = this.game;
    if (this.mPauseCount !== 0) {
      if (this.statsDialog) {
        const d = this.statsDialog;
        d.cnt++;   // StatsDialog::Update (bonus counter)
        if (d.paid < d.bonus && d.cnt > 100) {
          if (d.cnt % 10 === 1) this.addSound('BONUS_EXPLOSION', 0, d.paid / (d.kind === 'final' ? 25000 : 1000));
          const old = d.paid;
          d.paid = (d.kind !== 'final' ? -2400 : 0) + d.paid + 2500;
          if (d.paid > d.bonus) d.paid = d.bonus;
          this.IncScore(d.paid - old); this.mScoreDisplay = this.mScore;
          d.score = d.kind === 'level' ? this.mScore - this.mLevelBeginScore : this.mScore;
        }
        this.particles.Update(); this.sounds.Update(); this.UpdateMiscStuff();
      }
      return;
    }
    this.gun.Update();
    this.UpdateHoles();
    this.spriteUpdateCnt = (this.spriteUpdateCnt || 0) + 1;
    this.particles.Update();
    this.sounds.Update();
    this.mStateCount++;
    switch (this.mGameState) {
      case ST_PLAYING: this.UpdatePlaying(); break;
      case ST_LOSING: case ST_LEVELUP: case ST_LEVELBEGIN: this.trUpdate(); break;
    }
    if (this.mDoGuide) this.UpdateGuide();
    this.UpdateMiscStuff();
  }

  // ---- input (Board::MouseMove / MouseDown)
  MouseMove(x, y) {
    this.lastMouse = [x, y];
    if (this.mPauseCount !== 0) return;
    const gun = this.gun;
    const fx = x - gun.mCenterX;
    let angle;
    if (fx !== 0) {
      let v = f32(Math.atan(f32((gun.mCenterY - y) / fx)));
      if (fx < 0) v = f32(v + SEXY_PI);
      angle = f32(v + SEXY_PI / 2.0);
    } else {
      angle = 0;
      if (y < gun.mCenterY) angle = SEXY_PI;
    }
    gun.SetAngle(angle);
    this.mRecalcGuide = true;
  }
  MouseDown(x, y, clickCount) {
    const g = this.game;
    if (this.mPauseCount !== 0) { return; }
    if (this.mGameState === ST_PLAYING) {
      for (let i = 0; i < this.mNumCurves; i++) if (!this.mCurveMgr[i].CanFire()) return;
      if (clickCount >= 0) { if (this.gun.StartFire(true)) { g.sound('BALLFIRE'); g.stats.shots++; g.event('fire'); } }
      else { if (this.gun.SwapBullets()) g.sound('BUTTON2'); }
    } else {
      this.trMouseDown(x, y, clickCount);
    }
  }

  ActivatePower(ball) {
    const g = this.game;
    switch (ball.GetPowerTypeWussy()) {
      case PT_BOMB: { const t = this.BoardGetTickCount(); if (t - this.mLastExplosionTick > 250) { this.mLastExplosionTick = t; g.sound('EXPLODE'); } break; }
      case PT_BACK: g.sound('BACKWARDS_BALL'); break;
      case PT_SLOW: g.sound('SLOWDOWN_BALL'); break;
      case PT_ACC: g.sound('ACCURACY_BALL'); this.mAccuracyCount = 2000; this.DoAccuracy(true); break;
    }
    for (let i = 0; i < this.mNumCurves; i++) this.mCurveMgr[i].ActivatePower(ball);
  }

  IncScore(inc) {
    if (inc <= 0) return;
    const s = this.mScore;
    this.mScore += inc;
    if (Math.trunc(s / 50000) < Math.trunc((s + inc) / 50000) && !this.mIsEndless && !this.mIsWinning) {
      this.mLives += Math.trunc((s + inc) / 50000) - Math.trunc(s / 50000);
      this.mLivesBlinkCount = 150;
      this.game.sound('EXTRA_LIFE');
      this.addSound('EXTRA_LIFE', 30, 0); this.addSound('EXTRA_LIFE', 60, 0);
    }
  }
  ResetInARowBonus() {
    if (this.mNumClearsInARow > this.mLevelStats.mMaxInARow) { this.mLevelStats.mMaxInARow = this.mNumClearsInARow; this.mLevelStats.mMaxInARowScore = this.mCurInARowBonus; }
    this.mNumClearsInARow = 0; this.mCurInARowBonus = 0;
  }
  DeleteBullets() { for (const b of this.mBulletList) b.destroy(); this.mBulletList = []; }

  GetLevel(num) {
    const d = cloneLevelDesc(this.game.parser.getStageLevel(num));
    let nc = Math.trunc(d.mStage / 3) + 4;
    if (nc > 6) nc = 6;
    for (let i = 0; i < numCurves(d); i++) d.mCurveDesc[i].mNumColors = nc;
    return d;
  }

  setupCurves(desc) {
    const n = numCurves(desc);
    const cms = [];
    for (let i = 0; i < 3; i++) {
      if (!desc.mCurveDesc[i].mPath) continue;
      const cm = new CurveMgr(this, i);
      cm.SetupLevel(desc, i);
      cms.push(cm);
    }
    this.holes = this.holesForCurves(cms);
    this.mNumCurves = n;
    return cms;
  }
  // holes of a level that is not loaded yet (the next level drawn under the quake); render only, no side effects
  computeHoles(desc) {
    const cms = [];
    for (let i = 0; i < 3; i++) {
      if (!desc.mCurveDesc[i].mPath) continue;
      const cm = new CurveMgr(this, i);
      cm.SetupLevel(desc, i);
      cms.push(cm);
    }
    return this.holesForCurves(cms);
  }
  holesForCurves(cms) {
    // holes: SpriteMgr::PlaceHole merges holes closer than 20 px
    const holes = [];
    for (const cm of cms) {
      const hw = 88, cx = cm.holeX - hw / 2, cy = cm.holeY - hw / 2;
      let rot = cm.holeRot;
      while (rot < 0) rot = f32(rot + f32(SEXY_PI * 2));
      while (rot > f32(SEXY_PI * 2)) rot = f32(rot - f32(SEXY_PI * 2));
      for (const q of [0, 0.5, 1, 1.5, 2]) if (Math.abs(rot - f32(SEXY_PI * q)) < 0.2) rot = q === 2 ? 0 : f32(SEXY_PI * q);
      let k;
      for (k = 0; k < holes.length; k++) { const h = holes[k]; if ((h.y - cy) * (h.y - cy) + (h.x - cx) * (h.x - cx) < 400) break; }
      if (k === holes.length) holes.push({ x: Math.trunc(cx), y: Math.trunc(cy), rot, curves: [], bright: [0, 0, 0], total: 0 });
      holes[k].curves.push(cm.mCurveNum);
      cm.holeIdx = k;
    }
    return holes;
  }

  // Board::Reset
  Reset(gameOver, isLevelReset) {
    const g = this.game;
    this.mStateCount = 0;
    g.ballBlink = false;
    if (this.mLevelDesc) this.DoAccuracy(false);
    if (g.soundSink) g.soundSink('killall', 0, 0);
    this.sounds.queue = [];
    this.continueVisible = false;
    this.particles.Clear();
    this.trClear();
    this.DeleteBullets();
    if (gameOver) {
      this.mGameStats = newStats();
      this.mScore = 0; this.mScoreDisplay = 0; this.mCurBarSize = 0; this.mDifficultyDiff = 0;
      this.mLevel = this.mStartLevel;
      this.mLives = 3;
      this.gun.EmptyBullets();
    } else if (!isLevelReset) this.mLevel++;
    this.mLevelStats = newStats();
    this.mShowGuide = false; this.mRecalcGuide = false;
    g.wasReset = isLevelReset;
    this.mLevelDesc = this.GetLevel(this.mLevel);
    this.mNextLevelDesc = this.GetLevel(this.mLevel + 1);
    if (!isLevelReset || !this.mCurveMgr.length) this.mCurveMgr = this.setupCurves(this.mLevelDesc);
    else { for (const cm of this.mCurveMgr) cm.setDesc(this.mLevelDesc); }
    this.mNumCurves = this.mCurveMgr.length;
    this.gun.SetPos(this.mLevelDesc.mGunX, this.mLevelDesc.mGunY);
    this.mBallColorMap = new Map();
    this.gun.EmptyBullets();
    for (let i = 0; i < this.mNumCurves; i++) this.mCurveMgr[i].StartLevel();
    this.mDestroyAll = true;
    let target = 0;
    for (let i = 0; i < this.mNumCurves; i++) {
      if (target < this.mLevelDesc.mCurveDesc[i].mScoreTarget) target = this.mLevelDesc.mCurveDesc[i].mScoreTarget;
      if (!this.mLevelDesc.mCurveDesc[i].mDestroyAll) this.mDestroyAll = false;
    }
    this.mScoreTarget = target < 0 ? 0 : this.mScore + target;
    this.mLevelString = 'LVL ' + (this.mLevelDesc.mStage + 1) + '-' + (this.mLevelDesc.mLevel + 1);
    this.mVerboseLevelString = 'LeVeL ' + (this.mLevelDesc.mStage + 1) + '-' + (this.mLevelDesc.mLevel + 1);
    this.mHaveReachedTarget = false;
    this.mLevelBeginScore = this.mScore;
    this.mTargetBarSize = 0;
    this.mCurTreasure = null; this.mTreasureEndFrame = 0; this.mTreasureZoomX = 0; this.mTreasureZoomY = 0; this.mTreasureZoomFrame = 0;
    this.mBarBlinkCount = 0; this.mAccuracyCount = 0; this.mLivesBlinkCount = 0; this.mNumClearsInARow = 0; this.mCurInARowBonus = 0;
    this.mFlashCount = 0; this.mLevelEndFrame = 0; this.mIsWinning = false;
    this.mGameState = ST_LEVELBEGIN;
    this.ClearHoleFlashes();
    this.targetReachedFrame = -1;
    this.vis.quake = false; this.vis.bgSprites = null;
    this.trDoLevelBegin(gameOver);
    if (this.mLevel > g.profile.mMaxLevel) g.profile.mMaxLevel = this.mLevel;
    if (this.mLevelDesc.mStage > g.profile.mMaxStage) g.profile.mMaxStage = this.mLevelDesc.mStage;
    this.mMaxStage = g.profile.mMaxStage;
    g.event('reset');
  }

  Pause(pause, dialog) {
    if (pause) { if (dialog) this.mDialogCount++; this.mPauseCount++; }
    else { if (dialog) this.mDialogCount--; this.mPauseCount--; }
    if (this.mPauseCount === 0) this.MouseMove(this.lastMouse[0], this.lastMouse[1]);
  }

  // ---------------------------------------------------------------- TransitionMgr (flow parts)
  trClear() {
    const tr = this.tr;
    tr.frogMoves = []; tr.frogScales = []; tr.curFrogAngle = 1; tr.resetFrame = 0; tr.count = 0;
    tr.levelFade = 0; tr.targetLevelFade = 0; tr.levelFadeInc = 1; tr.curFrogScale = 1;
    const V = this.vis;
    V.stamps = []; V.blurbs = [];
  }
  trDoLevelBegin(firstTime) {
    const tr = this.tr;
    let st = firstTime ? 150 : 20;
    if (this.mLevelDesc.mInSpace) st = 100;
    else for (let i = 0; i < this.mNumCurves; i++) st = this.mCurveMgr[i].DrawPathSparkles(0, st, true);
    if (firstTime) this.addSound('GAME_START', 1, 0);
    tr.resetFrame = st >= 300 ? st : 300;
    tr.state = TS_LEVELBEGIN; tr.count = 0;
    if (this.game.visual) {
      const F = G.ZumaFont, huge = F.getFont('HUGE'), brown = F.getFont('BROWNTITLE');
      const vw = huge.StringWidth(this.mVerboseLevelString);
      const left = 640 - vw - 50, top = 480 - 50;
      this.AddLetterStamp(this.mVerboseLevelString, left, top, 0xFFFFFF, 20, 'HUGE', tr.resetFrame - 40);
      const sw = brown.StringWidth(this.mLevelDesc.mDisplayName);
      this.AddLetterStamp(this.mLevelDesc.mDisplayName, left + vw - sw, top + brown.GetAscent() - brown.GetAscentPadding() + 4, 0xFFFFFF, 60, 'BROWNTITLE', tr.resetFrame - 90);
    }
  }
  trDoQuake() {
    const tr = this.tr, g = this.game, gun = this.gun;
    g.sound('EARTHQUAKE');
    const m1 = [gun.mCenterX, gun.mCenterY];
    let m3 = [this.mNextLevelDesc.mGunX, this.mNextLevelDesc.mGunY];
    if (tr.doTempleUp) m3 = [320, 200];
    const m2 = [Math.trunc((7 * m1[0] + 3 * m3[0]) / 10), Math.trunc((7 * m1[1] + 3 * m3[1]) / 10)];
    this.trAddFrogMove(m1, m2, 70, 80); this.trAddFrogMove(m2, m3, 40, 0);
    this.trAddFrogScale(1, 3, 50, 100);
    if (tr.doTempleUp) this.trAddFrogScale(3, 0.01, 125, 20);
    else { this.trAddFrogScale(3, 1, 75, 20); this.addSound('FROGLAND', 245, 0); }
    tr.state = TS_QUAKE; tr.count = 0;
    this.vis.quake = true;
  }
  trDoStageComplete() {
    const tr = this.tr, g = this.game, gun = this.gun;
    this.addSound('STAGE_COMPLETE', 20, 0);
    tr.targetLevelFade = 128;
    tr.count = 0; tr.state = TS_STAGECOMPLETE;
    const text = 'STAGE ' + (this.mLevelDesc.mStage + 1);
    const hugeF = G.ZumaFont ? G.ZumaFont.getFont('HUGE') : null;
    const cw = hugeF ? (ch => hugeF.CharWidth(ch)) : (() => 30);
    let tw = 0; for (const ch of text) tw += cw(ch);
    let letX = 320 - Math.trunc(tw / 2);
    let gx = gun.mCenterX, gy = gun.mCenterY, frogSt = 20, letterSt = 0;
    const stamps = [];
    for (const ch of text) {
      if (ch === ' ') { letX += cw(' '); continue; }
      const m1 = [gx, gy], m2 = [Math.trunc((gx + letX) / 2), Math.trunc((gy + 250) / 2)], m3 = [letX, 250];
      this.trAddFrogMove(m1, m2, 20, frogSt); this.trAddFrogScale(1, 2, 20, frogSt);
      this.trAddFrogMove(m2, m3, 15, 0); this.trAddFrogScale(2, 1, 15, 0);
      letterSt += frogSt + 35; frogSt = 0;
      stamps.push({ ch, x: m3[0], y: m3[1] - 100, stagger: letterSt, px: letX });
      gx = letX; gy = 250; letX += cw(ch);
    }
    this.trAddFrogMove([gx, 250], [150, 250], 20, 0);
    tr.stageCompleteFrame = letterSt + 20;
    this.trAddFrogMove([150, 250], [500, 250], 50, 0);
    this.trAddFrogMove([500, 250], [320, 250 + gun.mHeight], 30, 0);
    if (g.visual) {
      for (const st of stamps) {
        this.AddLetterStamp(st.ch, st.x, st.y, 0xFFFF00, st.stagger, 'HUGE', 0);
        this.TextParticles(st.ch, st.px, 150, st.stagger + 8);
      }
      const huge = G.ZumaFont.getFont('HUGE');
      const cw2 = huge.StringWidth('COMPLETE');
      let v28 = 0;
      for (let i = 0; i < 100; i++) {
        this.particles.AddSparkle((320 - Math.trunc(cw2 / 2)) + Math.trunc(v28 / 100), 250, 0, (g.Rand() % 5) / 10.0 + 0.25, 0,
          g.Rand() % 50 + 10, (tr.stageCompleteFrame + Math.trunc(i / 2)) + g.Rand() % 10, BRIGHT_BALL_COLORS[g.Rand() % 6]);
        v28 += cw2;
      }
    }
  }
  trDoTempleComplete() {
    const tr = this.tr, g = this.game;
    this.trClear();
    g.song('temple');
    this.addSound('TEMPLE_COMPLETE', 20, 0);
    tr.count = 0; tr.state = TS_TEMPLECOMPLETE;
    tr.resetFrame = this.TempleText(Math.trunc(this.mLevelDesc.mStage / 3));
  }
  trAddFrogMove(a, b, dur, st) { this.tr.frogMoves.push({ cnt: -st, dur, a, b }); }
  trAddFrogScale(a, b, dur, st) { this.tr.frogScales.push({ cnt: -st, dur, a, b }); }
  trMouseDown(x, y, cc) {
    const tr = this.tr;
    if (tr.state === TS_LEVELBEGIN) { if (this.game.soundSink) this.game.soundSink('killall', 0, 0); this.sounds.queue = []; this.StartLevel(); }
    else if (tr.state === TS_TEMPLECOMPLETE) {
      if (tr.count < tr.resetFrame) { for (const b of this.vis.blurbs) b.charNum = b.text.length; tr.resetFrame = tr.count; }
      this.gun.DoBlink(false);
    } else if (tr.state === TS_LOSING) {
      if (tr.resetFrame > 0 && this.mLives > 0) this.Reset(false, true);
    }
  }
  trUpdate() {
    const tr = this.tr, g = this.game;
    tr.count++;
    const fired = this.gun.GetFiredBullet();
    if (fired) { fired.destroy(); this.gun.EmptyBullets(); }
    if (tr.levelFade !== tr.targetLevelFade) {
      if (tr.levelFade >= tr.targetLevelFade) { tr.levelFade -= tr.levelFadeInc; if (tr.levelFade < tr.targetLevelFade) tr.levelFade = tr.targetLevelFade; }
      else { tr.levelFade += tr.levelFadeInc; if (tr.levelFade > tr.targetLevelFade) tr.levelFade = tr.targetLevelFade; }
    }
    // UpdateFrogMove / UpdateFrogScale
    if (tr.frogMoves.length) {
      const m = tr.frogMoves[0];
      m.cnt++;
      if (m.cnt >= 0) {
        const d = f32(m.cnt / m.dur);
        this.gun.SetPos(Math.trunc(f32(f32(f32(1 - d) * m.a[0]) + f32(d * m.b[0]))), Math.trunc(f32(f32(f32(1 - d) * m.a[1]) + f32(d * m.b[1]))));
        this.MouseMove(this.lastMouse[0], this.lastMouse[1]);
        if (m.cnt >= m.dur) tr.frogMoves.shift();
      }
    }
    if (tr.frogScales.length) {
      const s = tr.frogScales[0];
      s.cnt++;
      if (s.cnt >= 0) {
        const d = s.cnt / s.dur;
        tr.curFrogScale = (1 - d) * s.a + d * s.b;
        if (s.cnt >= s.dur) tr.frogScales.shift();
      }
    }
    // UpdateLetterStamp / UpdateTextBlurb
    const V = this.vis;
    if (V.stamps.length) V.stamps = V.stamps.filter(st => { st.cnt++; return st.dur <= 0 || st.cnt < st.dur; });
    for (const bl of V.blurbs) {
      let tick = 4;
      if (bl.charNum >= 0 && bl.charNum < bl.text.length) {
        const c = bl.text[bl.charNum], nx = bl.charNum < bl.text.length - 1 ? bl.text[bl.charNum + 1] : '';
        if ((c === '.' || c === '?' || c === '!') && nx !== '.' && nx !== '?' && nx !== '!') tick = 16;
      }
      bl.delay++;
      if (tick <= bl.delay) { bl.charNum++; bl.delay = 0; }
    }
    switch (tr.state) {
      case TS_LEVELBEGIN: if (tr.count > tr.resetFrame) this.StartLevel(); break;
      case TS_BONUS:
        if (tr.count >= tr.quakeFrame) {
          if (this.mNextLevelDesc.mStage !== this.mLevelDesc.mStage) this.trDoStageComplete();
          else this.trDoQuake();
        } else if (tr.count === tr.quakeFrame - 1) {
          g.sound('LEVEL_UP');
          this.mScoreDisplay = this.mScore;
          this.openStatsDialog('level');
        }
        break;
      case TS_STAGECOMPLETE:
        if (tr.count === tr.stageCompleteFrame + 100) this.gun.DoBlink(true);
        if (tr.count > tr.stageCompleteFrame + 125) this.trDoQuake();
        break;
      case TS_TEMPLECOMPLETE:
      {
        const ang = f32(f32(tr.count * SEXY_PI) / 180);
        this.gun.SetPos(Math.trunc(f32(f32(f32(f32(Math.sin(ang)) * f32(-1.5)) * 5) + 120)),
          Math.trunc(f32(f32(f32(f32(Math.cos(ang)) * f32(-1.5)) * 5) + 380)));
      }
        if (tr.count > tr.resetFrame && !this.pendingReveal && !this.mIsWinning) this.continueVisible = true;
        break;
      case TS_QUAKE:
        if (tr.count === 100) { tr.targetLevelFade = 0; this.vis.stamps = []; }
        // SpriteMgr::UpdateBackgroundTransition: AppRand jitter of the cracked background pieces
        if (tr.count <= 100) {
          for (let i = 0; i < this.bgSpriteCount; i++) {
            let a, b;
            if (tr.count > 50) { a = g.AppRand() % 5 - 2; b = g.AppRand() % 5 - 2; }
            else { a = g.AppRand() % 3 - 1; b = g.AppRand() % 3 - 1; }
            const sp = this.vis.bgSprites && this.vis.bgSprites[i];
            if (sp) this.BgMove(sp, a, b);
          }
        } else if (this.vis.bgSprites) for (const sp of this.vis.bgSprites) this.BgMove(sp, Math.trunc(f32(sp.vx * 5)), Math.trunc(f32(sp.vy * 5)));
        if (tr.doTempleUp) { if (tr.count >= 300) this.trDoTempleComplete(); }
        else if (tr.count >= 250) this.Reset(false, false);
        break;
      case TS_LOSING: this.trUpdateLosing(); break;
    }
  }
  trUpdateLosing() {
    const tr = this.tr, g = this.game;
    if (tr.resetFrame === 0 || tr.resetFrame - tr.count > 200) {
      if ((tr.count % 30) === 0) this.addSound('TRAIL_LIGHT', 0, Math.trunc(tr.count / 30));
    }
    if (tr.resetFrame > 0 && tr.resetFrame - tr.count === 205) {
      this.addSound('POP', 0, 0);
      this.addSound(this.mLives === 0 ? 'GAME_OVER' : 'LOST_LIFE', 20, 0);
    }
    if (tr.resetFrame !== 0) {
      if (tr.resetFrame === tr.count) {
        if (this.mLives <= 0) this.openStatsDialog('gameover');
        else {
          const lf = tr.levelFade;
          this.Reset(false, true);
          tr.levelFade = lf; tr.targetLevelFade = 0;
          this.trAddFrogMove([-100, -100], [this.mLevelDesc.mGunX, this.mLevelDesc.mGunY], 50, 0);
          this.gun.SetPos(-100, -100);
        }
      }
      return;
    }
    let can = true;
    for (let i = 0; i < this.mNumCurves; i++) { this.mCurveMgr[i].UpdateLosing(); if (!this.mCurveMgr[i].CanRestart()) can = false; }
    if (!can || tr.count <= 150) return;
    tr.resetFrame = tr.count + 300;
    const text = this.mLives <= 0 ? 'GAME OVER' : this.mLives === 1 ? 'LAST LIFE!' : this.mLives + ' LIVES LEFT';
    if (g.visual) {
      const huge = G.ZumaFont.getFont('HUGE');
      this.AddLetterStamp(text, 320 - Math.trunc(huge.StringWidth(text) / 2), 240, 0xFFFFFF, 110, 'HUGE', 160);
    }
    g.loop('ROLLOUT', false);
    tr.targetLevelFade = 128; tr.levelFadeInc = 2;
  }
  GetParBonus(t, par) { if (t > par) return 0; return 100 * Math.trunc(f32(f32(f32(1 - f32(t / par)) * 25000) / 100)) + 100; }
  openStatsDialog(kind) {
    this.Pause(true, true);
    let bonus = 0;
    if (kind === 'level') bonus = this.GetParBonus(Math.trunc(this.mLevelStats.mTimePlayed / 100), this.mLevelDesc.mParTime);
    else if (kind === 'final') bonus = 50000 * this.mLives;
    this.statsDialog = { kind, openTick: this.game.appTick, bonus, paid: 0, cnt: 0, score: kind === 'level' ? this.mScore - this.mLevelBeginScore : this.mScore };
    this.game.event('statsDialog');
  }
  closeStatsDialog() {
    if (!this.statsDialog) return;
    if (this.game.appTick - this.statsDialog.openTick < STATS_DIALOG_MIN) return;   // OK button slides in (WidgetMover, 20 updates)
    const kind = this.statsDialog.kind;
    if (this.statsDialog.bonus > this.statsDialog.paid) { this.IncScore(this.statsDialog.bonus - this.statsDialog.paid); this.mScoreDisplay = this.mScore; }
    this.statsDialog = null;
    if (kind === 'level') this.Pause(false, true);
    else this.game.event('gameEnd', kind);
  }
  // Board::ButtonDepress(1) (CONTINUE after a temple)
  pressContinue() {
    if (!this.continueVisible) return;
    this.mIsWinning = true;
    this.continueVisible = false;
    const aStage = this.mLevelDesc.mStage + 1;
    if (aStage === 13) { this.openStatsDialog('final'); }
    else if (aStage === 12 || aStage <= this.mMaxStage) this.Reset(false, false);
    else { this.pendingReveal = true; this.game.event('templeReveal', aStage); }   // adventure screen reveal -> next temple dialog -> saved game resumes
  }
}

// ------------------------------------------------------------------------------------------
// Game: owns the RNG, the parsed levels and a Board. Deterministic given (seed, inputs).
// ------------------------------------------------------------------------------------------
const CURVE_CACHE = new Map();
let PARSER = null;

class Game {
  constructor(opts) {
    opts = opts || {};
    const data = opts.data || G.GAMEDATA;
    this.data = data;
    if (!PARSER) PARSER = new LevelParser(data.levelsXml);
    this.parser = PARSER;
    this.visual = !!opts.visual;
    this.visRand = new MTRand((opts.seed >>> 0) ^ 0x5eed);
    this.soundSink = opts.soundSink || null;
    this.idGen = 0;
    this.appRand = new MTRand(opts.seed >>> 0);
    this.loaderRand = new CRand(1);
    this.profile = { mMaxLevel: 0, mMaxStage: 0 };
    this.gotPowerUp = [false, false, false, false];
    this.ballBlink = false;
    this.wasReset = false;
    this.appTick = 0;
    this.stats = { shots: 0, wasted: 0, sets: 0, coins: 0 };
    this.board = new Board(this);
    this.board.levelTimes = [];
    this.listeners = null;
  }
  AppRand() { return this.appRand.Next(); }
  Rand() { return this.visRand.Next(); }       // Sexy::Rand (visual-only effects)
  getCurve(path) {
    const key = path.toLowerCase().replace(/\\/g, '/');
    let c = CURVE_CACHE.get(key);
    if (!c) {
      const b64 = this.data.curves[key];
      if (!b64) throw new Error('curve not found ' + key);
      c = loadCurve(b64ToBytes(b64));
      CURVE_CACHE.set(key, c);
    }
    return c;
  }
  sound(id, pitch, vol) { if (this.soundSink) this.soundSink(id, 0, pitch || 0, vol); }
  loop(id, on) { if (this.soundSink) this.soundSink(on ? 'loop+' + id : 'loop-' + id, 0, 0); }
  // CircleShootApp::PlaySong / SwitchSong (audio only: mLastSong + 5 s minimum between switches; GetTickCount
  // approximated by app ticks)
  song(id) { this.lastSong = id; this.lastSongTick = this.appTick || 0; if (this.soundSink) this.soundSink('song:' + id, 0, 0); }
  switchSong(id) {
    if (this.lastSong === id) return;
    if (this.lastSongTick !== undefined && (this.appTick || 0) - this.lastSongTick < 500) return;
    this.lastSong = id; this.lastSongTick = this.appTick || 0;
    if (this.soundSink) this.soundSink('switch:' + id, 0, 0);
  }
  event(name, arg) { if (this.listeners) for (const l of this.listeners) l(name, arg); }

  startAdventure(stage) {
    const b = this.board;
    b.mStartLevel = this.parser.getLevelNumByStage(stage || 0);
    b.Reset(true, false);
  }
  startLevelIndex(level, opts) {   // jump directly to adventure level index (used by tools / practice)
    const b = this.board;
    b.mStartLevel = level;
    if (opts && opts.profile) Object.assign(this.profile, opts.profile);
    b.Reset(true, false);
  }

  // one 10 ms update; input = list of events applied before the update:
  //   ['m', x, y] mouse move, ['l'] left click, ['r'] right click (swap), ['ok'] close dialog, ['cont'] continue
  tick(events) {
    const b = this.board;
    if (events) {
      for (const e of events) {
        switch (e[0]) {
          case 'm': b.MouseMove(e[1], e[2]); break;
          case 'l': b.MouseDown(b.lastMouse[0], b.lastMouse[1], 1); break;
          case 'r': b.MouseDown(b.lastMouse[0], b.lastMouse[1], -1); break;
          case 'ok': b.closeStatsDialog(); break;
          case 'cont': b.pressContinue(); break;
          case 'next': if (b.pendingReveal) { b.pendingReveal = false; b.Reset(false, false); } break;
        }
      }
    }
    this.appTick++;
    b.Update();
  }

  // ---- state snapshot / restore for TAS search (deep copy of everything mutable)
  clone() {
    const map = new Map();
    const ss = this.soundSink, ls = this.listeners;
    this.soundSink = null; this.listeners = null;
    const c = deepClone(this, map);
    this.soundSink = ss; this.listeners = ls;
    return c;
  }
}

const SHARED = new Set(['data', 'parser', 'c', 'xs', 'ys', 'tun', 'pri']);
function deepClone(o, map) {
  if (o === null || typeof o !== 'object') return o;
  const m = map.get(o);
  if (m !== undefined) return m;
  if (Array.isArray(o)) {
    const a = new Array(o.length); map.set(o, a);
    for (let i = 0; i < o.length; i++) a[i] = deepClone(o[i], map);
    return a;
  }
  if (ArrayBuffer.isView(o)) { const a = o.slice(); map.set(o, a); return a; }
  if (o instanceof Map) {
    const a = new Map(); map.set(o, a);
    for (const [k, v] of o) a.set(k, deepClone(v, map));
    return a;
  }
  const r = Object.create(Object.getPrototypeOf(o)); map.set(o, r);
  for (const k of Object.keys(o)) {
    const v = o[k];
    r[k] = (SHARED.has(k) || typeof v !== 'object') ? v : deepClone(v, map);
  }
  return r;
}

G.ZumaSim = {
  Game, Board, CurveMgr, Ball, Bullet, Gun, WayPointMgr, LevelParser, MTRand, CRand, BList, loadCurve, b64ToBytes,
  f32, SEXY_PI, BALL_R, PT_BOMB, PT_SLOW, PT_ACC, PT_BACK, PT_NONE, BALL_ROWS, TEXT_BALL_COLORS, BALL_COLORS,
  BRIGHT_BALL_COLORS, DARK_BALL_COLORS,
  GS_NORMAL, GS_FIRING, GS_RELOADING, ST_NONE, ST_PLAYING, ST_LOSING, ST_LEVELUP, ST_LEVELBEGIN,
  TS_NONE, TS_LEVELBEGIN, TS_BONUS, TS_STAGECOMPLETE, TS_TEMPLECOMPLETE, TS_QUAKE, TS_LOSING, numCurves,
};
if (typeof module !== 'undefined') module.exports = G.ZumaSim;
})(typeof window !== 'undefined' ? window : global);
