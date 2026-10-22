"""Offline reconciliation with captured public aggregator snapshots.
No percentage is a claim about operational truth, only agreement of published data.
"""
import csv
import datetime as dt
import hashlib
import json
import re
import shutil
from pathlib import Path
from collect import ROOT, START, CUTOFF, MSK, AIRPORTS, Tree

BASE=ROOT/'research/comparison'
DATA=ROOT/'dist/data'
def at(value):return dt.datetime.fromisoformat(value)
def minute(value):return at(value).astimezone(MSK).strftime('%Y-%m-%d %H:%M')
def stamp(value):return dt.datetime.strptime(value,'%Y-%m-%d %H:%M').replace(tzinfo=MSK)

def msk_comparison(data):
    tree=Tree((BASE/'msk-history.html').read_text()).root
    events=[]
    mapping={'open':'open','closed':'suspended','limited':'coordinated'}
    for e in tree.find(lambda e:e.tag=='li' and 'data-id' in e.attrs):
        airport,epoch=e.attrs['data-id'].split('-')
        state=next((k for k in mapping if e.has(k)),None)
        if state:events.append({'airport':airport.upper(),'status':mapping[state],
                                 'at':dt.datetime.fromtimestamp(int(epoch),MSK).isoformat()})
    own={(e['airport'],e['status'],e['at']) for e in data['events']}
    unmatched=[e for e in events if (e['airport'],e['status'],e['at']) not in own]
    stats={}
    pages={'/sheremetyevo':'SVO','/vnukovo':'VKO','/domodedovo':'DME','/zhukovsky':'ZIA'}
    for e in tree.find(lambda e:e.tag=='a' and e.attrs.get('href') in pages):
        text=re.sub(r'\s+',' ',e.text())
        m=re.search(r'(\d+) раз.*?в сумме (\d+)\s*ч',text)
        if not m:continue
        airport=pages[e.attrs['href']]
        eps=[ep for ep in data['episodes'] if ep['airport']==airport]
        new=[ep for ep in eps if at(ep['start'])>=START]
        seg=[s for s in data['segments'] if s['airport']==airport]
        newids={ep['id'] for ep in new}
        stats[airport]={'ours_intersecting_episodes':len(eps),'ours_starts_in_period':len(new),
                        'site_episode_count':int(m[1]),'site_displayed_whole_hours':int(m[2]),
                        'ours_hours':sum(s['duration_minutes'] for s in seg)/60,
                        'ours_hours_new_starts_only':sum(s['duration_minutes'] for s in seg if s['episode_id'] in newids)/60}
    return {'source':'msk-airports.ru','url':'https://msk-airports.ru/history','basis':'Росавиация',
        'event_count':len(events),'exact_event_matches':len(events)-len(unmatched),'unmatched':unmatched,
        'visible_from':min(e['at'] for e in events),'visible_to':max(e['at'] for e in events),
        'stats':stats,'interpretation':'Все показанные события сверены по аэропорту, режиму и секунде. Это 120 показанных записей, не весь месяц.',
        'boundary_note':'DME: сайт считает 30 новых начал; у нас 31 пересекающий период эпизод, включая перенос с 22 сентября. При исключении переноса 115,29 ч вместо 117,29 ч.'}

def airports_comparison(data):
    rows={}
    month_conflicts=[]
    for filename in ['airports-september.csv','airports-october.csv']:
        with (BASE/filename).open(encoding='utf-8-sig') as f:
            for row in csv.DictReader(f,delimiter=';'):
                if row['iata'] not in AIRPORTS:continue
                start=stamp(row['start_msk']);end=stamp(row['end_msk']) if row['end_msk'] else CUTOFF
                if end<=START or start>=CUTOFF:continue
                status={'restricted':'suspended','partial':'coordinated'}[row['kind']]
                key=(row['iata'],status,row['start_msk'])
                # Monthly CSVs repeat a carried interval, one version cut at month end.
                closed=bool(row['end_msk'])
                if key in rows:
                    old=rows[key]
                    if old['end_known']!=closed:
                        month_conflicts.append({'airport':row['iata'],'status':status,'start':start.isoformat(),
                           'note':'Один месячный экспорт помечает эпизод ongoing без окончания, другой даёт закрытое окончание. Для сопоставления выбран закрытый вариант.'})
                    if old['end_known'] and not closed:continue
                    if old['end_known']==closed and at(old['end'])>=end:continue
                rows[key]={'airport':row['iata'],'status':status,'start':start.isoformat(),'end':end.isoformat(),'end_known':closed}
    external=list(rows.values())
    lookup={(e['airport'],e['status'],minute(e['start'])):e for e in external}
    missing,divergent=[],[]
    matched=good=0
    per_airport={}
    event_urls={e['id']:e['url'] for e in data['events']}
    for s in data['segments']:
        key=(s['airport'],s['status'],minute(s['start']))
        ext=lookup.get(key)
        if not ext:
            missing.append({**{k:s[k] for k in ['airport','status','start','end']},
                            'start_source':event_urls[s['start_event']],'end_source':event_urls[s['end_event']]})
            continue
        matched+=1
        delta=abs((at(s['end'])-at(ext['end'])).total_seconds())/60
        if delta<1:good+=1
        else:divergent.append({'airport':s['airport'],'status':s['status'],'start':s['start'],
             'ours_end':s['end'],'site_end':ext['end'],'end_delta_minutes':delta,
             'start_source':event_urls[s['start_event']],'end_source':event_urls[s['end_event']]})
    for airport in AIRPORTS:
        ss=[s for s in data['segments'] if s['airport']==airport]
        ee=[e for e in external if e['airport']==airport]
        per_airport[airport]={'ours_segments':len(ss),'site_segments':len(ee),
            'both_boundaries_match':sum(1 for s in ss if (ext:=lookup.get((airport,s['status'],minute(s['start']))))
                 and abs((at(s['end'])-at(ext['end'])).total_seconds())<60),
            'ours_hours':sum(s['duration_minutes'] for s in ss)/60,
            'site_hours_from_boundaries':sum((min(CUTOFF,at(e['end']))-max(START,at(e['start']))).total_seconds()/3600 for e in ee)}
    return {'source':'Airports.ru','url':'https://airports.ru/history/','basis':'Росавиация',
      'export_urls':['https://airports.ru/history/?month=2026-09&format=csv','https://airports.ru/history/?month=2026-10&format=csv'],
      'comparison_window':[START.isoformat(),CUTOFF.isoformat()],'ours_segments':len(data['segments']),
      'site_segments':len(external),'matched_starts':matched,'matching_both_boundaries':good,
      'agreement_percent_of_our_segments':good/len(data['segments'])*100,
      'missing_in_csv':missing,'different_endings':divergent,'per_airport':per_airport,
      'monthly_export_conflicts':month_conflicts,
      'method':'Аэропорт + тип + начало в той же московской минуте; окончание с допуском менее 60 секунд. Месячные копии объединены по началу; закрытое окончание имеет приоритет перед ongoing. kind partial сопоставлен согласовательному режиму по объявлениям.'}

def benzin_comparison(data):
    raw=json.loads((BASE/'benzinmap-data.json').read_text())
    own={(e['airport'],e['url']):e for e in data['events']}
    matches,extras,wrong_status=[],[],[]
    site_counts={}
    for airport in raw['airports']:
        a=airport['iata']
        if a not in AIRPORTS:continue
        site_counts[a]=len(airport['history'])
        for event in airport['history']:
            source=event['source_url'];o=own.get((a,source))
            status={'closed':'suspended','coordination':'coordinated','open':'open'}.get(event['status'],event['status'])
            record={'airport':a,'at':at(event['at']).astimezone(MSK).isoformat(),'status':status,'source_url':source}
            if o and o['status']==status:matches.append(record)
            elif o:wrong_status.append({**record,'ours_status':o['status']})
            else:
                reason='Нет типового события в нашем ряду; требуется чтение источника.'
                if source.endswith('/8518'):
                    reason='Непарное наблюдение о ZIA.' if a=='ZIA' else 'Источник прямо говорит, что SVO/VKO/DME открыты, а согласовательный режим относится к ZIA.'
                if source.endswith('/8422') and a=='ZIA':reason='ZIA упомянут в ссылке на табло; в перечне аэропортов режима только VKO и DME.'
                if source.endswith(('/8792','/8793')):reason='Сводка/закрепление перечисляет другие города и говорит о работе остальных аэропортов; DME/VKO в списке ограничений нет.'
                if source.endswith('/8797'):reason='Непарная сводка: режим упомянут, но непрерывность до следующей отмены не доказана.'
                assessment='unpaired_observation' if (source.endswith('/8518') and a=='ZIA') or source.endswith('/8797') else 'contradicted_by_source'
                extras.append({**record,'reason':reason,'assessment':assessment})
    intervals=[]
    for airport in AIRPORTS:
        tree=Tree((BASE/f'benzinmap-{airport.lower()}.html').read_text()).root
        table=tree.find(lambda e:e.tag=='table')[0]
        for row in table.find(lambda e:e.tag=='tr'):
            cells=[e for e in row.children if hasattr(e,'tag') and e.tag=='td']
            if len(cells)<2:continue
            times=[re.search(r'(\d{2}\.\d{2}\.\d{4} \d{2}:\d{2})',e.text()) for e in cells[:2]]
            if not all(times):continue
            start,end=[dt.datetime.strptime(x[1],'%d.%m.%Y %H:%M').replace(tzinfo=MSK) for x in times]
            intervals.append({'airport':airport,'start':start.isoformat(),'end':end.isoformat(),
                              'duration_hours':(end-start).total_seconds()/3600})
    return {'source':'BenzinMap','url':'https://benzinmap.ru/airports/','basis':raw['source'],
      'api_url':'https://benzinmap.ru/airports/data.json','updated_at':raw['updated_at'],
      'coverage':{k:raw[k] for k in ['monitoring_coverage_start_at','history_coverage_start_at','monitoring_continuous_since']},
      'per_airport_history_counts':site_counts,'matching_source_assignments':len(matches),
      'other_source_assignments':extras,'wrong_status':wrong_status,'displayed_intervals':intervals,
      'warning':'Суммы разных периодов не сравниваются как полное месячное покрытие. Проверены отдельные присвоения аэропортам и конкретные интервалы.'}

def main():
    data=json.loads((DATA/'dataset.json').read_text())
    out={'meta':{'compared_at':dt.datetime.now(MSK).isoformat(),'start':START.isoformat(),'cutoff':CUTOFF.isoformat(),
        'meaning':'Совпадение опубликованных рядов, не процент достоверности реальных ограничений.',
        'independence':'Все три агрегатора аэропортов используют Росавиацию; они проверяют обработку, а не дают три независимых первичных свидетельства.'},
        'msk_airports':msk_comparison(data),'airports_ru':airports_comparison(data),'benzinmap':benzin_comparison(data),
        'regional_alerts':json.loads((ROOT/'research/comparison-rschs/findings.json').read_text())}
    (DATA/'comparison.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
    for source,target in [('COMPARISON.md','comparison-report.md'),('RSCHS-AUDIT.md','rschs-audit.md')]:
        shutil.copy2(ROOT/'docs'/source,DATA/target)
    manifest=[]
    for p in sorted(BASE.iterdir()):
        if p.is_file() and p.name!='manifest.json':manifest.append({'file':p.name,'bytes':p.stat().st_size,
          'captured_at':dt.datetime.fromtimestamp(p.stat().st_mtime,MSK).isoformat(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
    (BASE/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    print('MSK exact',out['msk_airports']['exact_event_matches'],'/',out['msk_airports']['event_count'])
    a=out['airports_ru'];print('AirportsRU',a['site_segments'],'vs',a['ours_segments'],'starts',a['matched_starts'],'both',a['matching_both_boundaries'],'missing',len(a['missing_in_csv']),'enddiff',len(a['different_endings']))
    b=out['benzinmap'];print('BenzinMap',b['matching_source_assignments'],'matching source assignments,',len(b['other_source_assignments']),'others,',len(b['wrong_status']),'status diffs')

if __name__=='__main__':main()
