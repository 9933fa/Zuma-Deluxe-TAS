"""Build ZumaTAS assets from your own copy of Zuma Deluxe (original 640x480 resolution).

The game's art, sounds, music, fonts and level data are copyrighted by PopCap/EA and are NOT part of this
repository. This script converts them from a local installation:

- images/*: colour file + PopCap alpha mask (_name.gif / name_.gif / alphaimage / alphagrid) -> RGBA PNG
- levels/*: background jpgs, cutout / background-alpha masks (alpha png), curve .dat (base64 in gamedata.js)
- fonts/*: PopCap ImageFont descriptors -> JSON (gamedata.js) + RGBA PNG
- sounds: copied as-is (ogg)
- music: the 8 sub-songs of music/zuma.mo3 rendered to OGG (needs openmpt123 + ffmpeg), or copied from a
  folder of already rendered song0.ogg..song7.ogg (--music-dir). Without either the game runs silently.

Usage:
  python tools/build_assets.py --game "C:/Program Files (x86)/Steam/steamapps/common/Zuma Deluxe"
  python tools/build_assets.py --game <dir> --openmpt <openmpt123 exe> --ffmpeg <ffmpeg exe>
  python tools/build_assets.py --game <dir> --music-dir <folder with song0.ogg..song7.ogg>
"""
import os, sys, re, json, base64, shutil, argparse, hashlib, subprocess, tempfile
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'assets')
SRC = os.path.join(os.path.dirname(ROOT), 'Zuma Deluxe')     # overridden by --game
# checksums of the data the TAS recording was made with (a different game version can desync the replay)
KNOWN_SHA256 = {
    'levels/levels.xml': '6dc79d14afb3e01873fda0237dcee23a3770625897670854582d60572cce2d9e',
    'properties/resources.xml': '7ba21dfcdb8eae875b4551d2228e90db0ef5a7f4cb0b7441e3a397610fedcf4a',
}


def find_ci(folder, name):
    low = name.lower()
    if not os.path.isdir(folder):
        return None
    for f in os.listdir(folder):
        if f.lower() == low:
            return os.path.join(folder, f)
    return None


def find_img(folder, base):
    for ext in ['.png', '.jpg', '.gif']:
        p = find_ci(folder, base + ext)
        if p:
            return p
    return None


def read_rgb(path):
    return np.array(Image.open(path).convert('RGB'))


def read_alpha(path):
    return np.array(Image.open(path).convert('RGB'))[..., 0]   # PopCap uses the red channel


def save_rgba(path, rgb, a):
    out = np.dstack([rgb, a]).astype(np.uint8)
    Image.fromarray(out, 'RGBA').save(path, optimize=True)


# --------------------------------------------------------------------------------------
# resources.xml
# --------------------------------------------------------------------------------------
def parse_resources():
    txt = open(os.path.join(SRC, 'properties', 'resources.xml'), encoding='latin-1').read()
    txt = re.sub(r'<!--.*?-->', '', txt, flags=re.S)
    res = []
    defaults = {'path': '', 'idprefix': ''}
    for m in re.finditer(r'<(SetDefaults|Image|Font|Sound)\s+([^>]*?)/?>', txt):
        tag, body = m.group(1), m.group(2)
        attrs = dict((k, v1 if v1 is not None and v1 != '' else v2) for k, v1, v2 in
                     re.findall(r'(\w+)\s*=\s*(?:"([^"]*)"|([^\s/>]+))', body))
        if tag == 'SetDefaults':
            defaults = attrs
            continue
        attrs['tag'] = tag
        attrs['id'] = defaults.get('idprefix', '') + attrs['id']
        attrs['dir'] = defaults.get('path', '')
        res.append(attrs)
    return res


def build_image(src_dir, path, alphaimage=None, alphagrid=None):
    """Mimics SexyAppBase::GetImage alpha rules. Returns (rgb, a) arrays."""
    col = find_img(src_dir, path)
    base = os.path.basename(path)
    alpha = None
    if alphaimage:
        alpha = read_alpha(find_img(src_dir, alphaimage))
    elif alphagrid:
        cell = read_alpha(find_img(src_dir, alphagrid))
        alpha = cell
    else:
        for cand in ['_' + base, base + '_']:
            p = find_img(src_dir, cand)
            if p and (col is None or os.path.normcase(p) != os.path.normcase(col)):
                alpha = read_alpha(p)
                break
    if col is None:
        if alpha is None:
            raise FileNotFoundError(path)
        rgb = np.full(alpha.shape + (3,), 255, np.uint8)
    else:
        im = Image.open(col)
        if alpha is None and im.mode == 'P' and 'transparency' in im.info:
            rgba = np.array(im.convert('RGBA'))
            return rgba[..., :3], rgba[..., 3]
        rgb = read_rgb(col)
    if alpha is None:
        alpha = np.full(rgb.shape[:2], 255, np.uint8)
    if alphagrid and alpha.shape != rgb.shape[:2]:
        reps = (rgb.shape[0] // alpha.shape[0], rgb.shape[1] // alpha.shape[1])
        alpha = np.tile(alpha, reps)
        if alpha.shape != rgb.shape[:2]:
            pad = np.zeros(rgb.shape[:2], np.uint8)
            h, w = min(alpha.shape[0], pad.shape[0]), min(alpha.shape[1], pad.shape[1])
            pad[:h, :w] = alpha[:h, :w]
            alpha = pad
    if alpha.shape != rgb.shape[:2]:
        a2 = np.zeros(rgb.shape[:2], np.uint8)
        h, w = min(alpha.shape[0], a2.shape[0]), min(alpha.shape[1], a2.shape[1])
        a2[:h, :w] = alpha[:h, :w]
        alpha = a2
    return rgb, alpha


EXTRA_IMAGES = ['nebula1', 'happyending', 'GauntScreen']   # loaded by code, not in the manifest


def build_images(res):
    odir = os.path.join(OUT, 'img')
    os.makedirs(odir, exist_ok=True)
    out = {}
    for r in res:
        if r['tag'] != 'Image' or r['path'].startswith('!'):
            continue
        src_dir = os.path.join(SRC, r['dir'])
        rgb, a = build_image(src_dir, r['path'], r.get('alphaimage'), r.get('alphagrid'))
        fname = r['id'].lower().replace('image_', '') + '.png'
        save_rgba(os.path.join(odir, fname), rgb, a)
        out[r['id']] = {'file': 'img/' + fname, 'w': int(rgb.shape[1]), 'h': int(rgb.shape[0]),
                        'rows': int(r.get('rows', 1)), 'cols': int(r.get('cols', 1))}
    for name in EXTRA_IMAGES:
        p = find_img(os.path.join(SRC, 'images'), name)
        if not p:
            continue
        rgb, a = build_image(os.path.join(SRC, 'images'), name)
        fname = name.lower() + '.png'
        save_rgba(os.path.join(odir, fname), rgb, a)
        out['IMAGE_' + name.upper()] = {'file': 'img/' + fname, 'w': int(rgb.shape[1]), 'h': int(rgb.shape[0]),
                                        'rows': 1, 'cols': 1}
    print('images', len(out))
    return out


# --------------------------------------------------------------------------------------
# levels
# --------------------------------------------------------------------------------------
def build_levels():
    ldir = os.path.join(SRC, 'levels')
    odir = os.path.join(OUT, 'levels')
    os.makedirs(odir, exist_ok=True)
    curves, images = {}, {}
    for d in sorted(os.listdir(ldir)):
        dp = os.path.join(ldir, d)
        if not os.path.isdir(dp) or d == 'perm_thumbnails':
            continue
        for f in sorted(os.listdir(dp)):
            key = 'levels/%s/%s' % (d.lower(), os.path.splitext(f)[0].lower())
            fp = os.path.join(dp, f)
            if f.lower().endswith('.dat'):
                curves[key] = base64.b64encode(open(fp, 'rb').read()).decode()
            elif f.lower().endswith('.jpg'):
                fn = '%s_%s.jpg' % (d.lower(), os.path.splitext(f)[0].lower())
                shutil.copyfile(fp, os.path.join(odir, fn))
                w, h = Image.open(fp).size
                images[key] = {'file': 'levels/' + fn, 'w': w, 'h': h}
            elif f.lower().endswith('.gif') and f.startswith('_'):
                # alpha-only mask (Cutout / BackgroundAlpha): white rgb + alpha
                a = read_alpha(fp)
                fn = '%s_%s.png' % (d.lower(), os.path.splitext(f)[0].lower().lstrip('_'))
                save_rgba(os.path.join(odir, fn), np.full(a.shape + (3,), 255, np.uint8), a)
                images['levels/%s/%s' % (d.lower(), os.path.splitext(f)[0].lower().lstrip('_'))] = {
                    'file': 'levels/' + fn, 'w': int(a.shape[1]), 'h': int(a.shape[0])}
    print('curves', len(curves), 'level images', len(images))
    return curves, images


# --------------------------------------------------------------------------------------
# PopCap font descriptors
# --------------------------------------------------------------------------------------
TOK = re.compile(r"""\s*(?:("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(-?\d+\.?\d*)|([A-Za-z_]\w*)|([(),;]))""")


def unescape(s):
    out, i = [], 0
    while i < len(s):
        if s[i] == '\\' and i + 1 < len(s):
            i += 1
        out.append(s[i]); i += 1
    return ''.join(out)


def tokenize(s):
    pos, out = 0, []
    s = s.strip()
    while pos < len(s):
        m = TOK.match(s, pos)
        if not m:
            raise ValueError('bad font token at %r' % s[pos:pos + 20])
        if m.group(1):
            out.append(('s', unescape(m.group(1)[1:-1])))
        elif m.group(2):
            out.append(('n', float(m.group(2))))
        elif m.group(3):
            out.append(('i', m.group(3)))
        else:
            out.append(('p', m.group(4)))
        pos = m.end()
        while pos < len(s) and s[pos].isspace():
            pos += 1
    return out


def parse_font(path):
    toks = tokenize(open(path, encoding='latin-1').read())
    i = 0
    defs, layers, order = {}, {}, []
    charmap = {}
    misc = {}

    def value():
        nonlocal i
        t = toks[i]
        if t == ('p', '('):
            i += 1
            lst = []
            while toks[i] != ('p', ')'):
                lst.append(value())
                if toks[i] == ('p', ','):
                    i += 1
            i += 1
            return lst
        i += 1
        if t[0] == 'i' and t[1] in defs:
            return defs[t[1]]
        return t[1]

    while i < len(toks):
        cmd = toks[i][1]; i += 1
        args = []
        while toks[i] != ('p', ';'):
            args.append(value())
        i += 1
        if cmd == 'Define':
            defs[args[0]] = args[1]
        elif cmd == 'CreateLayer':
            layers[args[0]] = {'name': args[0], 'chars': {}, 'kern': {}, 'offset': [0, 0], 'colorMult': [1, 1, 1, 1],
                               'colorAdd': [0, 0, 0, 0], 'baseOrder': 0, 'tags': [], 'excl': [], 'ascent': 0,
                               'ascentPadding': 0, 'lineSpacingOffset': 0, 'height': 0, 'spacing': 0,
                               'pointSize': 0, 'drawMode': -1}
            order.append(args[0])
        elif cmd.startswith('Layer'):
            L = layers[args[0]]
            k = cmd[5:]
            if k == 'SetImage':
                L['image'] = args[1]
            elif k == 'SetAscent':
                L['ascent'] = args[1]
            elif k == 'SetAscentPadding':
                L['ascentPadding'] = args[1]
            elif k == 'SetLineSpacingOffset':
                L['lineSpacingOffset'] = args[1]
            elif k == 'SetHeight':
                L['height'] = args[1]
            elif k == 'SetSpacing':
                L['spacing'] = args[1]
            elif k == 'SetPointSize':
                L['pointSize'] = args[1]
            elif k == 'SetDrawMode':
                L['drawMode'] = args[1]
            elif k == 'SetCharWidths':
                for ch, w in zip(args[1], args[2]):
                    L['chars'].setdefault(ch, {})['w'] = w
            elif k == 'SetImageMap':
                for ch, r in zip(args[1], args[2]):
                    L['chars'].setdefault(ch, {})['r'] = r
            elif k == 'SetCharOffsets':
                for ch, o in zip(args[1], args[2]):
                    L['chars'].setdefault(ch, {})['o'] = o
            elif k == 'SetKerningPairs':
                for pr, v in zip(args[1], args[2]):
                    L['kern'][pr] = v
            elif k == 'SetOffset':
                L['offset'] = args[1]
            elif k == 'SetColorMult':
                L['colorMult'] = args[1]
            elif k == 'SetColorAdd':
                L['colorAdd'] = args[1]
            elif k == 'SetBaseOrder':
                L['baseOrder'] = args[1]
            elif k == 'RequireTags':
                L['tags'] = args[1]
            elif k == 'ExcludeTags':
                L['excl'] = args[1]
            else:
                misc.setdefault('unknown', []).append(cmd)
        elif cmd == 'SetCharMap':
            for a, b in zip(args[0], args[1]):
                charmap[a] = b
        elif cmd == 'SetDefaultPointSize':
            misc['pointSize'] = args[0]
        else:
            misc.setdefault('unknown', []).append(cmd)
    if misc.get('unknown'):
        print('  font', os.path.basename(path), 'ignored commands', sorted(set(misc['unknown'])))
    return {'layers': [layers[n] for n in order], 'charmap': charmap}


def build_fonts():
    fdir = os.path.join(SRC, 'fonts')
    odir = os.path.join(OUT, 'fonts')
    os.makedirs(odir, exist_ok=True)
    fonts, done = {}, set()
    for f in sorted(os.listdir(fdir)):
        if not f.endswith('.txt'):
            continue
        fd = parse_font(os.path.join(fdir, f))
        for L in fd['layers']:
            img = L['image']
            L['image'] = 'fonts/' + img.lower() + '.png'
            if img.lower() in done:
                continue
            done.add(img.lower())
            col = find_ci(fdir, img + '.gif')
            alp = find_ci(fdir, '_' + img + '.gif')
            a = read_alpha(alp)
            rgb = read_rgb(col) if col else np.full(a.shape + (3,), 255, np.uint8)
            save_rgba(os.path.join(odir, img.lower() + '.png'), rgb, a)
        fonts[os.path.splitext(f)[0].lower()] = fd
    print('fonts', len(fonts))
    return fonts


def build_sounds(res):
    odir = os.path.join(OUT, 'sounds')
    os.makedirs(odir, exist_ok=True)
    out = {}
    for r in res:
        if r['tag'] != 'Sound':
            continue
        p = find_ci(os.path.join(SRC, 'sounds'), r['path'] + '.ogg')
        fn = r['path'].lower() + '.ogg'
        shutil.copyfile(p, os.path.join(odir, fn))
        out[r['id']] = {'file': 'sounds/' + fn, 'volume': float(r.get('volume', 1.0))}
    build_music()
    print('sounds', len(out))
    return out


def build_music():
    mdir = os.path.join(OUT, 'music')
    os.makedirs(mdir, exist_ok=True)
    if ARGS.music_dir:
        n = 0
        for i in range(8):
            p = os.path.join(ARGS.music_dir, 'song%d.ogg' % i)
            if os.path.isfile(p): shutil.copyfile(p, os.path.join(mdir, 'song%d.ogg' % i)); n += 1
        print('music: copied', n, 'songs from', ARGS.music_dir)
        return
    mo3 = find_ci(os.path.join(SRC, 'music'), 'zuma.mo3')
    openmpt = ARGS.openmpt or shutil.which('openmpt123')
    ffmpeg = ARGS.ffmpeg or shutil.which('ffmpeg')
    if not (mo3 and openmpt and ffmpeg):
        print('music: SKIPPED (need music/zuma.mo3 plus openmpt123 and ffmpeg, or --music-dir); the game runs without music')
        return
    with tempfile.TemporaryDirectory() as tmp:
        shutil.copyfile(mo3, os.path.join(tmp, 'zuma.mo3'))
        for i in range(8):
            subprocess.run([openmpt, '-q', '--render', '--no-float', '--samplerate', '44100', '--subsong', str(i),
                            '--output-type', 'wav', 'zuma.mo3'], cwd=tmp, check=True)
            subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', os.path.join(tmp, 'zuma.mo3.wav'),
                            '-c:a', 'libvorbis', '-q:a', '5', os.path.join(mdir, 'song%d.ogg' % i)], check=True)
            os.remove(os.path.join(tmp, 'zuma.mo3.wav'))
    print('music: rendered 8 songs')


def check_versions():
    for rel, want in KNOWN_SHA256.items():
        p = os.path.join(SRC, *rel.split('/'))
        h = hashlib.sha256(open(p, 'rb').read()).hexdigest()
        if want and h != want:
            print('WARNING: %s differs from the version the TAS was recorded with; the replay may desync' % rel)
        else:
            print('%s sha256 %s%s' % (rel, h, ' (matches)' if want else ''))


def main():
    global SRC, ARGS
    ap = argparse.ArgumentParser(description='Build ZumaTAS assets from your own Zuma Deluxe installation.')
    ap.add_argument('--game', default=os.environ.get('ZUMA_DIR', SRC), help='Zuma Deluxe folder (contains properties/, images/, levels/ ...)')
    ap.add_argument('--music-dir', help='folder with pre-rendered song0.ogg..song7.ogg')
    ap.add_argument('--openmpt', help='path to openmpt123 (renders music/zuma.mo3)')
    ap.add_argument('--ffmpeg', help='path to ffmpeg with libvorbis')
    ARGS = ap.parse_args()
    SRC = os.path.abspath(ARGS.game)
    if not os.path.isfile(os.path.join(SRC, 'properties', 'resources.xml')):
        sys.exit('Not a Zuma Deluxe folder (properties/resources.xml missing): ' + SRC)
    check_versions()
    res = parse_resources()
    images = build_images(res)
    curves, limages = build_levels()
    fonts = build_fonts()
    sounds = build_sounds(res)
    font_ids = {r['id']: r['path'].lower().replace('.txt', '') for r in res if r['tag'] == 'Font'}
    xml = open(os.path.join(SRC, 'levels', 'levels.xml'), encoding='latin-1').read()
    # 1-bit alpha mask of the HUGE font image (DrawTextParticles samples opaque glyph pixels)
    a = read_alpha(find_ci(os.path.join(SRC, 'fonts'), '_NativeAlien48.gif'))
    bits = np.packbits((a >= 255).astype(np.uint8).reshape(-1), bitorder='little')
    masks = {'nativealien48': {'w': int(a.shape[1]), 'h': int(a.shape[0]), 'b64': base64.b64encode(bits.tobytes()).decode()}}
    data = {'levelsXml': xml, 'curves': curves, 'images': images, 'levelImages': limages,
            'fonts': fonts, 'fontIds': font_ids, 'sounds': sounds, 'fontMasks': masks}
    js = ('(function(g){g.GAMEDATA=' + json.dumps(data, separators=(',', ':')) +
          ';})(typeof window!=="undefined"?window:global);\n')
    open(os.path.join(ROOT, 'js', 'gamedata.js'), 'w', encoding='utf-8').write(js)
    print('gamedata.js', len(js) // 1024, 'KB')


if __name__ == '__main__':
    main()
