"""Collect the public Rosaviatsiya channel with an auditable, cached pagination trail.
Python standard library only. Run from any directory; raw snapshots stay in work/.
"""
import concurrent.futures
import datetime as dt
import hashlib
import json
import re
import time
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'research'
RAW = WORK / 'raw'
MSK = dt.timezone(dt.timedelta(hours=3))
START = dt.datetime(2026, 9, 23, tzinfo=MSK)
# One immutable cutoff for this one-off snapshot (current day is partial).
CUTOFF = dt.datetime(2026, 10, 23, 0, 51, tzinfo=MSK)
AIRPORTS = {'SVO': 'Шереметьево', 'VKO': 'Внуково', 'DME': 'Домодедово', 'ZIA': 'Жуковский'}

class Element:
    def __init__(self, tag='', attrs=(), parent=None):
        self.tag, self.attrs, self.parent, self.children = tag, dict(attrs), parent, []
    def has(self, cls):
        return cls in self.attrs.get('class', '').split()
    def find(self, predicate):
        out = []
        for c in self.children:
            if isinstance(c, Element):
                if predicate(c): out.append(c)
                out.extend(c.find(predicate))
        return out
    def text(self):
        return ' '.join(c.text() if isinstance(c, Element) else c for c in self.children)

class Tree(HTMLParser):
    VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Element()
        self.current = self.root
        self.feed(html)
    def handle_starttag(self, tag, attrs):
        e = Element(tag, attrs, self.current)
        self.current.children.append(e)
        if tag not in self.VOID: self.current = e
    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID: self.handle_endtag(tag)
    def handle_endtag(self, tag):
        e = self.current
        while e.parent:
            if e.tag == tag:
                self.current = e.parent
                return
            e = e.parent
    def handle_data(self, data):
        self.current.children.append(data)

def parse_page(html):
    tree = Tree(html).root
    posts = []
    for e in tree.find(lambda x: x.has('tgme_widget_message') and 'data-post' in x.attrs):
        # Replies can contain earlier message bodies; only use the post's OWN body.
        bodies = e.find(lambda x: x.has('tgme_widget_message_text') and x.has('js-message_text'))
        dates = e.find(lambda x: x.tag == 'time' and 'datetime' in x.attrs)
        if not dates: continue
        text = re.sub(r'\s+', ' ', bodies[0].text()).strip() if bodies else ''
        post_id = e.attrs['data-post']
        posts.append({'id': post_id, 'url': 'https://t.me/'+post_id,
                      'published_at': dates[-1].attrs['datetime'], 'text': text})
    return posts

def fetch(before=None):
    filename = 'favt-latest.html' if before is None else f'favt-before-{before}.html'
    dest = RAW / filename
    url = 'https://t.me/s/favt_info' + (f'?before={before}' if before else '')
    if dest.exists() and dest.stat().st_size > 10000:
        content = dest.read_bytes()
    else:
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (public archive research)'})
                with urllib.request.urlopen(req, timeout=40) as res: content = res.read()
                if len(content) < 10000: raise ValueError('Short response')
                dest.write_bytes(content)
                break
            except Exception:
                if attempt == 3: raise
                time.sleep(1 + attempt)
    return parse_page(content.decode()), {'url': url, 'file': filename, 'sha256': hashlib.sha256(content).hexdigest(),
                                        'bytes': len(content)}

def main():
    RAW.mkdir(parents=True, exist_ok=True)
    posts, manifest = {}, []
    first, meta = fetch()
    manifest.append(meta)
    for p in first: posts[p['id']] = p
    oldest = min(int(p['id'].split('/')[-1]) for p in first)
    # A fixed 20-ID window, with actual page metadata retained, fetches several
    # independent public pages at once. Overlap is deduplicated by post ID.
    cursor = oldest
    finished = False
    while not finished:
        cursors = [cursor - 20*i for i in range(6)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(fetch, cursors))
        for batch, meta in results:
            manifest.append(meta)
            for p in batch: posts[p['id']] = p
        earliest = min(dt.datetime.fromisoformat(p['published_at']) for p in posts.values())
        print(f'{len(posts)} messages; oldest {earliest.isoformat()}', flush=True)
        # Collect two days before the requested period for carried-in restrictions.
        finished = earliest < START - dt.timedelta(days=2)
        cursor -= 120
        if cursor < oldest - 6000: raise RuntimeError('Pagination did not reach start')
    all_posts = sorted(posts.values(), key=lambda p: int(p['id'].split('/')[-1]))
    (WORK/'posts.json').write_text(json.dumps(all_posts, ensure_ascii=False, indent=2))
    (WORK/'collection-manifest.json').write_text(json.dumps({'cutoff':CUTOFF.isoformat(), 'start':START.isoformat(),
        'collected_at':dt.datetime.now(MSK).isoformat(), 'pages':manifest}, ensure_ascii=False, indent=2))
    print(json.dumps({'messages':len(all_posts),'pages':len(manifest),'first':all_posts[0]['published_at'],
                      'last':all_posts[-1]['published_at']},ensure_ascii=False))

if __name__ == '__main__': main()
