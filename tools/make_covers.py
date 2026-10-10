# Cover images for the Claude TAS run: 4:3 (1440x1080) and 16:9 (1920x1080).
# Built from the game's own art (loading screen with the ZUMA DELUXE logo, balls, frog) plus a drawn
# Claude spark badge and the record time.  usage: python tools/make_covers.py
import math, os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), '..')
IMG = os.path.join(ROOT, 'assets', 'img')
OUT = os.path.join(ROOT, 'docs')
FONTS = 'C:/Windows/Fonts/'
S = 2.25          # 640x480 art -> 1440x1080


def load(name):
    return Image.open(os.path.join(IMG, name)).convert('RGBA')


def ball(color, size):
    strip = load(color + '_ball.png')
    fr = strip.crop((0, 0, 32, 32))
    return fr.resize((size, size), Image.LANCZOS)


def vgrad(w, h, stops):
    """vertical gradient through (pos, (r,g,b)) stops"""
    g = Image.new('RGBA', (w, h))
    px = g.load()
    for y in range(h):
        t = y / max(1, h - 1)
        for i in range(len(stops) - 1):
            if stops[i][0] <= t <= stops[i + 1][0]:
                a, b = stops[i], stops[i + 1]
                u = (t - a[0]) / max(1e-6, b[0] - a[0])
                c = tuple(int(a[1][k] + (b[1][k] - a[1][k]) * u) for k in range(3))
                break
        for x in range(w):
            px[x, y] = c + (255,)
    return g


def fancy_text(base, text, font, center, stops, stroke, stroke_col=(45, 18, 0), glow=0, glow_col=(0, 0, 0), shadow=(0, 0), tracking=0):
    """gold-gradient text with a dark stroke, soft glow and drop shadow, centred on `center`"""
    W, H = base.size
    d0 = ImageDraw.Draw(base)
    # measure (with optional letter spacing)
    chars = list(text)
    widths = [d0.textlength(c, font=font) for c in chars]
    tw = sum(widths) + tracking * (len(chars) - 1)
    asc, desc = font.getmetrics()
    th = asc + desc
    x0 = center[0] - tw / 2
    y0 = center[1] - th / 2
    pad = stroke + glow * 3 + 20
    lw, lh = int(tw + 2 * pad), int(th + 2 * pad)

    def draw_mask(sw):
        m = Image.new('L', (lw, lh), 0)
        d = ImageDraw.Draw(m)
        x = pad
        for c, w in zip(chars, widths):
            d.text((x, pad), c, font=font, fill=255, stroke_width=sw, stroke_fill=255)
            x += w + tracking
        return m

    fill_m = draw_mask(0)
    stroke_m = draw_mask(stroke)
    ox, oy = int(x0 - pad), int(y0 - pad)
    if glow:
        gm = draw_mask(stroke + glow).filter(ImageFilter.GaussianBlur(glow))
        gl = Image.new('RGBA', (lw, lh), glow_col + (255,))
        gl.putalpha(gm.point(lambda v: int(v * 0.85)))
        base.alpha_composite(gl, (ox, oy))
    if shadow != (0, 0):
        sh = Image.new('RGBA', (lw, lh), (0, 0, 0, 255))
        sh.putalpha(stroke_m.filter(ImageFilter.GaussianBlur(3)).point(lambda v: int(v * 0.7)))
        base.alpha_composite(sh, (ox + shadow[0], oy + shadow[1]))
    st = Image.new('RGBA', (lw, lh), stroke_col + (255,))
    st.putalpha(stroke_m)
    base.alpha_composite(st, (ox, oy))
    # gradient body spanning the glyph box
    gr = vgrad(lw, lh, [(0, stops[0][1])] + [(pad / lh + (lh - 2 * pad) / lh * p, c) for p, c in stops] + [(1, stops[-1][1])])
    gr.putalpha(fill_m)
    base.alpha_composite(gr, (ox, oy))
    # thin highlight on the upper edge
    hl = Image.new('RGBA', (lw, lh), (255, 255, 230, 255))
    edge = fill_m.filter(ImageFilter.GaussianBlur(1.5))
    shifted = Image.new('L', (lw, lh), 0); shifted.paste(fill_m, (0, 3))
    from PIL import ImageChops
    top = ImageChops.subtract(fill_m, shifted).filter(ImageFilter.GaussianBlur(1))
    hl.putalpha(top.point(lambda v: int(v * 0.6)))
    base.alpha_composite(hl, (ox, oy))
    return (x0, y0, tw, th)


def claude_badge(d, label=True):
    """round badge with a Claude-style spark: d = output diameter"""
    k = 4                              # supersampling
    D = d * k
    im = Image.new('RGBA', (D, D + (D // 3 if label else 0)), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    c = D / 2
    # gold rim + cream disc
    dr.ellipse((0, 0, D - 1, D - 1), fill=(150, 95, 20, 255))
    dr.ellipse((D * 0.035, D * 0.035, D * 0.965, D * 0.965), fill=(255, 214, 90, 255))
    dr.ellipse((D * 0.07, D * 0.07, D * 0.93, D * 0.93), fill=(246, 241, 230, 255))
    # spark: tapered rays of uneven length and angle
    R = D * 0.36
    rays = [(-90, 1.00), (-58, 0.80), (-27, 0.93), (4, 0.78), (34, 0.97), (66, 0.82), (97, 0.95),
            (128, 0.79), (158, 0.96), (190, 0.81), (221, 0.92), (251, 0.84)]
    col = (217, 119, 87, 255)
    for ang, ln in rays:
        a = math.radians(ang)
        L = R * ln
        w = R * 0.115
        tipx, tipy = c + math.cos(a) * L, c + math.sin(a) * L
        px, py = -math.sin(a), math.cos(a)
        bx, by = c + math.cos(a) * R * 0.12, c + math.sin(a) * R * 0.12
        poly = [(bx + px * w, by + py * w), (tipx + px * w * 0.45, tipy + py * w * 0.45),
                (tipx - px * w * 0.45, tipy - py * w * 0.45), (bx - px * w, by - py * w)]
        dr.polygon(poly, fill=col)
        r2 = w * 0.45
        dr.ellipse((tipx - r2, tipy - r2, tipx + r2, tipy + r2), fill=col)
    dr.ellipse((c - R * 0.2, c - R * 0.2, c + R * 0.2, c + R * 0.2), fill=col)
    out = im.resize((d, im.height // k), Image.LANCZOS)
    return out


def claude_badge_labeled(d):
    # spark in the upper part of the disc, "Claude" underneath
    k = 4
    D = d * k
    im = Image.new('RGBA', (D, D), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    dr.ellipse((0, 0, D - 1, D - 1), fill=(150, 95, 20, 255))
    dr.ellipse((D * 0.035, D * 0.035, D * 0.965, D * 0.965), fill=(255, 214, 90, 255))
    dr.ellipse((D * 0.07, D * 0.07, D * 0.93, D * 0.93), fill=(246, 241, 230, 255))
    spark = claude_badge(int(D * 1.0), label=False)
    # cut the spark out of a plain badge render: draw only the orange pixels, scaled down
    sp = spark.resize((int(D * 0.78), int(D * 0.78)), Image.LANCZOS)
    r, g, b, a = sp.split()
    orange = Image.new('RGBA', sp.size, (217, 119, 87, 255))
    m = Image.eval(Image.merge('RGB', (r, g, b)).convert('L'), lambda v: 0)
    px = sp.load(); om = Image.new('L', sp.size, 0); opx = om.load()
    for y in range(sp.height):
        for x in range(sp.width):
            R_, G_, B_, A_ = px[x, y]
            if A_ and R_ > 180 and G_ < 160 and B_ < 130: opx[x, y] = A_
    orange.putalpha(om)
    im.alpha_composite(orange, (int((D - sp.width) / 2), int(D * 0.04)))
    f = ImageFont.truetype(FONTS + 'georgiab.ttf', int(D * 0.17))
    tw = dr.textlength('Claude', font=f)
    dr.text(((D - tw) / 2, D * 0.66), 'Claude', font=f, fill=(60, 45, 35, 255))
    return im.resize((d, d), Image.LANCZOS)


def balls_along(base, pts, colors, size):
    for (x, y), col in zip(pts, colors):
        sh = Image.new('RGBA', (size + 20, size + 20), (0, 0, 0, 0))
        ImageDraw.Draw(sh).ellipse((10, 14, size + 10, size + 18), fill=(0, 0, 0, 110))
        base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(4)), (int(x - size / 2 - 10), int(y - size / 2 - 10)))
        base.alpha_composite(ball(col, size), (int(x - size / 2), int(y - size / 2)))


def scene_4x3():
    src = load('loading_screen.png')
    # paint over the PopCap logo (bottom right) with the mirrored stone wall from the bottom left
    patch = src.crop((0, 370, 110, 480)).transpose(Image.FLIP_LEFT_RIGHT)
    m = Image.new('L', patch.size, 0)
    ImageDraw.Draw(m).ellipse((8, 8, 150, 150), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(6))
    src.paste(patch, (530, 370), m)
    return src.resize((1440, 1080), Image.LANCZOS)


def compose(W, H):
    art = scene_4x3()
    if W == 1440:
        base = art.copy()
        ox = 0
    else:
        # 16:9: blurred, darkened fill behind the 4:3 art, which fades out at its sides
        fill = art.resize((W, int(W * 0.75)), Image.LANCZOS)
        fill = fill.crop((0, (fill.height - H) // 2, W, (fill.height - H) // 2 + H)).filter(ImageFilter.GaussianBlur(18))
        dark = Image.new('RGBA', (W, H), (20, 10, 0, 90))
        base = fill.copy(); base.alpha_composite(dark)
        ox = (W - 1440) // 2
        mask = Image.new('L', (1440, 1080), 255)
        md = ImageDraw.Draw(mask)
        for i in range(140):
            v = int(255 * i / 140)
            md.line((i, 0, i, 1080), fill=v); md.line((1439 - i, 0, 1439 - i, 1080), fill=v)
        a2 = art.copy(); a2.putalpha(mask)
        base.alpha_composite(a2, (ox, 0))

    # cover the PopCap logo corner with the Claude badge
    cx, cy = ox + int(578 * S), int(412 * S)
    patch = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(patch).ellipse((cx - 165, cy - 165, cx + 165, cy + 165), fill=(30, 14, 0, 150))
    base.alpha_composite(patch.filter(ImageFilter.GaussianBlur(20)))
    badge = claude_badge_labeled(260)
    base.alpha_composite(badge, (cx - 130, cy - 130))

    # chains of balls rolling in along the stone frame
    cols = ['red', 'red', 'yellow', 'blue', 'blue', 'green', 'purple', 'purple', 'yellow', 'white', 'green', 'green', 'red', 'blue']
    sz = 64
    pts = [(ox + int(24 * S) + i * (sz - 2), int(318 * S)) for i in range(5)]
    balls_along(base, pts, cols[:5], sz)
    pts = [(ox + int(616 * S) - i * (sz - 2), int(318 * S)) for i in range(5)]
    balls_along(base, pts, cols[7:12], sz)

    # TAS 新纪录
    f1 = ImageFont.truetype(FONTS + 'msyhbd.ttc', 150)
    gold = [(0.0, (255, 250, 200)), (0.45, (255, 214, 64)), (0.75, (255, 150, 20)), (1.0, (190, 80, 0))]
    fancy_text(base, 'TAS 新纪录', f1, (ox + 720, int(262 * S)), gold, stroke=11, glow=14, shadow=(6, 8), tracking=6)

    # 09:38 inside the stone frame
    f2 = ImageFont.truetype(FONTS + 'impact.ttf', 300)
    fancy_text(base, '09:38', f2, (ox + int(322 * S), int(372 * S)), gold, stroke=14, glow=18, shadow=(8, 10), tracking=10)

    if W != 1440:
        # side decorations for the wide cover: the frog and more balls
        # frog on the left, mouth towards the centre
        frog = load('shooter_bottom.png').resize((270, 270), Image.LANCZOS).rotate(90, resample=Image.BICUBIC, expand=True)
        base.alpha_composite(frog, (8, 650))
        # a touching chain of balls rolling down an arc on the right
        rcols = ['yellow', 'yellow', 'blue', 'red', 'red', 'green', 'green', 'purple', 'white', 'white', 'blue']
        size, R0, ccx, ccy = 70, 330, W + 80, 380
        pts, t = [], -1.0
        for i in range(len(rcols)):
            pts.append((ccx - R0 * math.cos(t), ccy + R0 * math.sin(t)))
            t += (size - 3) / R0
        balls_along(base, pts, rcols, size)
    return base.convert('RGB')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    compose(1440, 1080).save(os.path.join(OUT, 'cover_4x3.png'))
    compose(1920, 1080).save(os.path.join(OUT, 'cover_16x9.png'))
    print('saved docs/cover_4x3.png, docs/cover_16x9.png')
