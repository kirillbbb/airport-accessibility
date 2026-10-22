"""Optional corroboration archives, never used as automatic interval boundaries."""
import datetime as dt
import hashlib
import json
import re
import urllib.request
from collect import WORK, START, CUTOFF, MSK, parse_page

CHANNELS=[('SVO','svo_online','https://www.svo.aero/','official'),
          ('DME','dmepress','https://www.dme.ru/','official'),
          ('ZIA','ziaaero','https://zia.aero/','official'),
          ('VKO','vnukovoairport_VKO','https://www.vnukovo.ru/','candidate')]

def main():
    dest=WORK/'airport-crosscheck-raw';dest.mkdir(parents=True,exist_ok=True)
    for airport,channel,homepage,provenance in CHANNELS:
        rows,pages={},[]
        before=None
        for index in range(40):
            url=f'https://t.me/s/{channel}'+(f'?before={before}' if before else '')
            path=dest/f'{channel}-{index+1}.html'
            if not path.exists():
                req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
                with urllib.request.urlopen(req,timeout=40) as res: path.write_bytes(res.read())
            raw=path.read_bytes();posts=parse_page(raw.decode())
            if not posts: raise RuntimeError(f'No parseable messages: {url}')
            for post in posts:
                at=dt.datetime.fromisoformat(post['published_at'])
                if START<=at<CUTOFF and re.search(r'ограничен|ков[её]р|возобнов|по согласован|прекрат|не принима|при[её]м.{0,20}выпуск',post['text'],re.I):
                    rows[post['id']]={**post,'published_msk':at.astimezone(MSK).isoformat(),'airport':airport,'source':channel}
            oldest=min(posts,key=lambda p:int(p['id'].split('/')[-1]))
            pages.append({'url':url,'file':path.name,'sha256':hashlib.sha256(raw).hexdigest(),
                          'oldest_post':oldest['id'],'oldest_at':oldest['published_at']})
            if dt.datetime.fromisoformat(oldest['published_at'])<START: break
            before=int(oldest['id'].split('/')[-1])
        else: raise RuntimeError(f'Archive boundary not reached: {channel}')
        suffix='candidate' if provenance=='candidate' else 'official'
        value={'source':channel,'airport':airport,'channel_url':f'https://t.me/s/{channel}',
               'official_channel_link_evidence':homepage if provenance=='official' else None,
               'provenance':provenance,'scope_start':START.isoformat(),'cutoff':CUTOFF.isoformat(),
               'pages':pages,'records':sorted(rows.values(),key=lambda p:p['published_at']),
               'limitations':['Keyword candidates, not restriction counts.','Publication timestamps, not effective times.',
                    'VKO airport-site backlink unverified; not part of primary metrics.' if provenance=='candidate' else 'Source reporting can be incomplete.']}
        (WORK/f'{airport.lower()}-{suffix}-crosscheck.json').write_text(json.dumps(value,ensure_ascii=False,indent=2))
        print(airport,len(pages),'pages,',len(rows),'candidate messages',flush=True)

if __name__=='__main__':main()
