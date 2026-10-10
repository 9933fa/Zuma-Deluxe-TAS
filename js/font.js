// PopCap ImageFont (SexyAppFramework/ImageFont.cpp): layer metrics + drawing.
// Metrics work everywhere (the simulation lays out floating text with them); drawing needs a canvas.
(function (G) {
'use strict';

const FONT_FILES = {
  HUGE: 'nativealien48', MONODIGIT: 'cancun13', BROWNTITLE: 'nativealienextended16', MAIN12: 'cancun12',
  MAIN8: 'cancun8', MAIN10: 'cancun10', FLOAT: 'cancunfloat14', TITLE: 'nativealienextended18', PLAIN: 'arial12bold',
  UPSELL: 'cancun22', SMALL_ARIAL: 'arial9bold',
};
// program fonts: DIALOG = MAIN10 + "Shadow1"; MAIN10OUTLINE* are all replaced by the DIALOG font (original bug);
// MAIN8OUTLINE = MAIN8 + "Outline"
const FONT_TAGS = { DIALOG: ['MAIN10', ['Shadow1']], MAIN10OUTLINE: ['MAIN10', ['Shadow1']], MAIN10OUTLINE2: ['MAIN10', ['Shadow1']],
  MAIN10OUTLINE3: ['MAIN10', ['Shadow1']], MAIN8OUTLINE: ['MAIN8', ['Outline']] };

class ImageFont {
  constructor(data, tags) {
    this.data = data; this.tags = tags || [];
    this.layers = [];
    this.mAscent = 0; this.mAscentPadding = 0; this.mHeight = 0; this.mLineSpacingOffset = 0;
    let first = true;
    for (const L of data.layers) {
      let active = true;
      for (const t of L.tags) if (this.tags.indexOf(t) < 0) active = false;
      for (const t of this.tags) if ((L.excl || []).indexOf(t) >= 0) active = false;
      if (!active) continue;
      // default height: max(rect.h + offset.y) over chars (LayerSetImageMap)
      let dh = 0;
      for (const ch in L.chars) { const c = L.chars[ch]; if (c.r) { const h = c.r[3] + (c.o ? c.o[1] : 0); if (h > dh) dh = h; } }
      L._defH = dh;
      this.layers.push(L);
      if (L.ascent > this.mAscent) this.mAscent = L.ascent;
      const h = L.height !== 0 ? L.height : dh;
      if (h > this.mHeight) this.mHeight = h;
      if (first || L.ascentPadding < this.mAscentPadding) this.mAscentPadding = L.ascentPadding;
      if (first || L.lineSpacingOffset > this.mLineSpacingOffset) this.mLineSpacingOffset = L.lineSpacingOffset;
      first = false;
    }
  }
  map(ch) { const m = this.data.charmap[ch]; return m !== undefined ? m : ch; }
  GetAscent() { return this.mAscent; }
  GetAscentPadding() { return this.mAscentPadding; }
  GetHeight() { return this.mHeight; }
  GetLineSpacing() { return this.mHeight + this.mLineSpacingOffset; }
  charW(L, ch) { const c = L.chars[ch]; return c && c.w !== undefined ? c.w : 0; }
  kern(L, a, b) { const v = L.kern[a + b]; return v || 0; }
  CharWidthKern(ch, prev) {
    ch = this.map(ch);
    if (prev) prev = this.map(prev);
    let mx = 0;
    for (const L of this.layers) {
      const w = this.charW(L, ch) + (prev ? L.spacing + this.kern(L, prev, ch) : 0);
      if (w > mx) mx = w;
    }
    return mx;
  }
  CharWidth(ch) { return this.CharWidthKern(ch, null); }
  StringWidth(s) {
    let w = 0, prev = null;
    for (const ch of s) { w += this.CharWidthKern(ch, prev); prev = ch; }
    return w;
  }
  // returns list of draw commands {img, sx, sy, sw, sh, dx, dy, color:[r,g,b,a], order}
  layout(x, y, s, color) {
    const cmds = [];
    let cur = x;
    for (let i = 0; i < s.length; i++) {
      const ch = this.map(s[i]);
      const nx = i < s.length - 1 ? this.map(s[i + 1]) : null;
      let maxX = cur;
      for (const L of this.layers) {
        const c = L.chars[ch] || {};
        const o = c.o || [0, 0];
        const ix = cur + L.offset[0] + o[0];
        const iy = y - (L.ascent - L.offset[1] - o[1]);
        const w = c.w || 0;
        const sp = nx ? L.spacing + this.kern(L, ch, nx) : 0;
        const m = L.colorMult, a = L.colorAdd;
        const col = [
          Math.min(Math.trunc(color[0] * Math.trunc(m[0] * 255) / 255) + Math.trunc(a[0] * 255), 255),
          Math.min(Math.trunc(color[1] * Math.trunc(m[1] * 255) / 255) + Math.trunc(a[1] * 255), 255),
          Math.min(Math.trunc(color[2] * Math.trunc(m[2] * 255) / 255) + Math.trunc(a[2] * 255), 255),
          Math.min(Math.trunc(color[3] * Math.trunc(m[3] * 255) / 255) + Math.trunc(a[3] * 255), 255)];
        if (c.r && c.r[2] > 0 && c.r[3] > 0)
          cmds.push({ img: L.image, sx: c.r[0], sy: c.r[1], sw: c.r[2], sh: c.r[3], dx: ix, dy: iy, color: col, order: L.baseOrder, mode: L.drawMode });
        const lx = cur + w + sp;
        if (lx > maxX) maxX = lx;
      }
      cur = maxX;
    }
    cmds.sort((p, q) => p.order - q.order);   // stable
    return cmds;
  }
}

const FONTS = {};
function getFont(id) {
  if (FONTS[id]) return FONTS[id];
  const data = (G.GAMEDATA || {}).fonts;
  let f;
  if (FONT_TAGS[id]) { const [base, tags] = FONT_TAGS[id]; f = new ImageFont(data[FONT_FILES[base]], tags); }
  else f = new ImageFont(data[FONT_FILES[id]], []);
  FONTS[id] = f;
  return f;
}

G.ZumaFont = { ImageFont, getFont, FONT_FILES };
if (typeof module !== 'undefined') module.exports = G.ZumaFont;
})(typeof window !== 'undefined' ? window : global);
