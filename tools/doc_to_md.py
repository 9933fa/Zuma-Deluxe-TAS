# Generate docs/TAS.md (GitHub-readable) from docs/tas_doc.html, so both stay in sync.
# The per-level tables (filled by JavaScript in the HTML page) are built from tas/movie.js and tas/wr_times.js.
# usage: python tools/doc_to_md.py
import json, os, re
from html.parser import HTMLParser

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
VOID = {'br', 'meta', 'link', 'img', 'hr', 'input'}


class Node:
    def __init__(self, tag, attrs, parent):
        self.tag, self.attrs, self.parent, self.kids = tag, dict(attrs), parent, []


class Tree(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node('root', [], None)
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        n = Node(tag, attrs, self.cur)
        self.cur.kids.append(n)
        if tag not in VOID:
            self.cur = n

    def handle_endtag(self, tag):
        n = self.cur
        while n is not None and n.tag != tag:
            n = n.parent
        if n is not None and n.parent is not None:
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.kids.append(data)


def find(n, pred):
    out = []
    for k in n.kids:
        if isinstance(k, Node):
            if pred(k):
                out.append(k)
            out.extend(find(k, pred))
    return out


def inline(n):
    s = ''
    for k in n.kids:
        if isinstance(k, str):
            s += re.sub(r'\s+', ' ', k)
            continue
        t = inline(k)
        if k.tag == 'b':
            s += '<b>' + t.strip() + '</b>'
        elif k.tag == 'code':
            s += '`' + t + '`'
        elif k.tag == 'a':
            href = k.attrs.get('href', '')
            s += '[' + t + '](' + href + ')'
        elif k.tag == 'br':
            s += '  \n'
        else:
            s += t
    return s


def raw_text(n):
    s = ''
    for k in n.kids:
        s += k if isinstance(k, str) else raw_text(k)
    return s


def level_rows(lang):
    w = {}
    exec_js = open(os.path.join(ROOT, 'tas', 'movie.js'), encoding='utf8').read()
    movie = json.loads(exec_js[exec_js.index('=') + 1:].strip().rstrip(';'))
    wr_js = open(os.path.join(ROOT, 'tas', 'wr_times.js'), encoding='utf8').read()
    wr = json.loads(re.search(r'dialog:\s*(\{.*?\})', wr_js, re.S).group(1))
    zh = lang == 'zh'
    head = '| 关卡 | 地图 | Claude | 世界纪录 | 比较 |' if zh else '| Level | Map | Claude | World record | Result |'
    rows = [head, '|---|---|---|---|---|']
    tot = 0
    for L in movie['levels']:
        ours = L['playTicks'] / 100
        tot += L['playTicks']
        s = wr.get(L['label'])
        if s is None:
            cmp_, wrs = '', '—'
        else:
            wrs = '0:%02d' % s
            f = int(ours)
            cmp_ = ('更快' if zh else 'faster') if f < s else (('同一秒' if zh else 'same second') if f == s else ('更慢' if zh else 'slower'))
        rows.append('| %s | %s | %.2f | %s | %s |' % (L['label'], L['name'], ours, wrs, cmp_))
    t = tot / 100
    rows.append('| **%s** | | **%d:%05.2f** | **11:22** | |' % ('合计' if zh else 'Total', t // 60, t % 60))
    return '\n'.join(rows)


def block(n, lang, out):
    for k in n.kids:
        if isinstance(k, str):
            if k.strip():
                out.append(k.strip() + '\n')
            continue
        cls = k.attrs.get('class', '')
        if k.tag == 'h2':
            out.append('<a name="%s"></a>\n\n## %s\n' % (k.attrs.get('id', ''), inline(k).strip()))
        elif k.tag == 'h3':
            out.append('### ' + inline(k).strip() + '\n')
        elif k.tag == 'p':
            out.append(inline(k).strip() + '\n')
        elif k.tag in ('ul', 'ol'):
            i = 0
            items = []
            for li in k.kids:
                if isinstance(li, Node) and li.tag == 'li':
                    i += 1
                    items.append(('%d. ' % i if k.tag == 'ol' else '- ') + inline(li).strip())
            out.append('\n'.join(items) + '\n')
        elif k.tag == 'table':
            if k.attrs.get('id', '').endswith('-table'):
                out.append(level_rows(lang) + '\n')
                continue
            trs = find(k, lambda x: x.tag == 'tr')
            lines = []
            for r, tr in enumerate(trs):
                cells = [inline(c).strip().replace('|', '\\|') for c in tr.kids if isinstance(c, Node) and c.tag in ('td', 'th')]
                lines.append('| ' + ' | '.join(cells) + ' |')
                if r == 0:
                    lines.append('|' + '---|' * len(cells))
            out.append('\n'.join(lines) + '\n')
        elif k.tag == 'nav':
            links = [a for a in find(k, lambda x: x.tag == 'a')]
            out.append(' · '.join('[%s](%s)' % (inline(a).strip(), a.attrs.get('href')) for a in links) + '\n')
        elif k.tag == 'div' and 'big' in cls:
            boxes = [d for d in k.kids if isinstance(d, Node) and d.tag == 'div']
            vals = [inline(next(c for c in b.kids if isinstance(c, Node) and c.tag == 'b')).strip() for b in boxes]
            caps = [inline(next(c for c in b.kids if isinstance(c, Node) and c.tag == 'span')).strip() for b in boxes]
            out.append('| ' + ' | '.join('**%s**' % v for v in vals) + ' |\n|' + '---|' * len(vals) + '\n| ' + ' | '.join(caps) + ' |\n')
        elif k.tag == 'div' and 'note' in cls:
            out.append('> ' + inline(k).strip().replace('  \n', '  \n> ') + '\n')
        elif k.tag == 'div' and 'tree' in cls:
            out.append('```\n' + raw_text(k).strip('\n') + '\n```\n')
        elif k.tag == 'div' and 'scroll' in cls:
            block(k, lang, out)
        else:
            block(k, lang, out)


def main():
    html = open(os.path.join(ROOT, 'docs', 'tas_doc.html'), encoding='utf8').read()
    t = Tree(); t.feed(html)
    secs = find(t.root, lambda x: x.tag == 'section')
    md = ['# Claude TAS · Zuma Deluxe\n',
          '[中文](#中文) · [English](#english)\n',
          '<!-- generated from docs/tas_doc.html by tools/doc_to_md.py; edit the HTML and re-run -->\n']
    for s in secs:
        lang = s.attrs.get('data-lang')
        md.append('---\n')
        md.append('<a name="%s"></a>\n\n# %s\n' % ('中文' if lang == 'zh' else 'english', '中文' if lang == 'zh' else 'English'))
        md.append(('一个电脑“工具辅助速通”是怎样想出来、怎样打出来的\n') if lang == 'zh' else 'How a computer-made tool-assisted speedrun of Zuma Deluxe was planned and played\n')
        out = []
        block(s, lang, out)
        md.extend(out)
    text = '\n'.join(md)
    text = re.sub(r'\n{3,}', '\n\n', text)
    open(os.path.join(ROOT, 'docs', 'TAS.md'), 'w', encoding='utf8').write(text)
    print('wrote docs/TAS.md', len(text), 'chars')


if __name__ == '__main__':
    main()
