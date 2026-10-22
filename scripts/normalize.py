"""Reconstruct explicitly announced states, retaining uncertain observations separately."""
import csv
import datetime as dt
import json
import re
from pathlib import Path
from collect import ROOT, WORK, START, CUTOFF, AIRPORTS, MSK

def iso(value): return value.astimezone(MSK).isoformat()
def parse(value): return dt.datetime.fromisoformat(value)

def classify(post):
    text = post['text'].upper().replace('Ё', 'Е')
    names = {code: name.upper().replace('Ё','Е') for code,name in AIRPORTS.items()}
    mentioned = [a for a,n in names.items() if n in text]
    if not mentioned: return [], None
    marker = re.search(r'СНЯТЫ\s+ОГРАНИЧЕНИЯ|ВВЕДЕНЫ\s+(?:ДОПОЛНИТЕЛЬНЫЕ.{0,12})?ВРЕМЕННЫЕ\s+ОГРАНИЧЕНИЯ|ПРИНИМА(?:ЕТ|ЮТ) И ОТПРАВЛЯ(?:ЕТ|ЮТ) РЕЙСЫ ПО СОГЛАСОВАНИЮ',text)
    airport_index = text.find('АЭРОПОРТ')
    if not marker or airport_index < 0 or airport_index > 50 or marker.start() < airport_index:
        observed = mentioned
        if post['id'] == 'favt_info/8518': observed = ['ZIA']
        if post['id'] == 'favt_info/8797': observed = list(AIRPORTS)
        return [], {'id':post['id'], 'airports':observed, 'published_at':iso(parse(post['published_at'])),
                    'url':post['url'], 'text':post['text'], 'kind':'context',
                    'reason':'Нет сообщения с однозначными границами перехода. Не включено в расчёт длительности.'}
    subject = text[airport_index:marker.start()]
    airports = [a for a,n in names.items() if n in subject]
    status = 'open' if marker.group().startswith('СНЯТЫ') else 'suspended' if marker.group().startswith('ВВЕДЕНЫ') else 'coordinated'
    events = [{'id':post['id'].replace('/','-')+'-'+a, 'post_id':post['id'], 'airport':a,
               'status':status,'at':iso(parse(post['published_at'])), 'url':post['url'],
               'time_basis':'publication', 'source':'Росавиация',
               'excerpt':' '.join(post['text'].split()[:18])+'…'} for a in airports]
    return events, None

def reconstruct(events, start=START, cutoff=CUTOFF):
    segments, episodes, orphan_lifts = [], [], []
    for airport in AIRPORTS:
        relevant = sorted([e for e in events if e['airport']==airport and parse(e['at'])<cutoff],key=lambda e:(e['at'],e['id']))
        active, episode = None, None
        for event in relevant:
            at = parse(event['at'])
            if active and active['status'] == event['status']:
                active['evidence'].append(event['id'])
                continue
            if active:
                active['end'] = event['at']
                active['end_event'] = event['id']
                segments.append(active)
                active = None
            if event['status'] == 'open':
                if episode:
                    episode['end'] = event['at']
                    episode['end_event'] = event['id']
                    episodes.append(episode)
                    episode = None
                else:
                    orphan_lifts.append(event)
                continue
            if episode is None:
                episode = {'id':'ep-'+event['id'],'airport':airport,'start':event['at'],'end':None,
                           'start_event':event['id'],'end_event':None,'segment_ids':[]}
            active = {'id':'seg-'+event['id'],'airport':airport,'status':event['status'],
                      'start':event['at'],'end':None,'start_event':event['id'],'end_event':None,
                      'episode_id':episode['id'],'evidence':[event['id']]}
            episode['segment_ids'].append(active['id'])
        if active: segments.append(active)
        if episode: episodes.append(episode)
    filtered = []
    for seg in segments:
        end = parse(seg['end']) if seg['end'] else cutoff
        if end <= start or parse(seg['start']) >= cutoff: continue
        seg['clipped_start'] = iso(max(start,parse(seg['start'])))
        seg['clipped_end'] = iso(min(cutoff,end))
        seg['start_clipped'] = parse(seg['start']) < start
        seg['end_unknown'] = seg['end'] is None
        # An unclosed segment is shown as censored exposure, not a complete duration.
        seg['duration_minutes'] = (min(cutoff,end)-max(start,parse(seg['start']))).total_seconds()/60
        filtered.append(seg)
    ids = {s['episode_id'] for s in filtered}
    return filtered,[e for e in episodes if e['id'] in ids],orphan_lifts

def main():
    posts = json.loads((WORK/'posts.json').read_text())
    events, observations = [], []
    relevant_posts = []
    for post in posts:
        es, observation = classify(post)
        events.extend(es)
        if START <= parse(post['published_at']) < CUTOFF and (es or observation):
            relevant_posts.append(post)
            if observation: observations.append(observation)
    segments, episodes, orphan_lifts = reconstruct(events)
    required_ids = {s[k] for s in segments for k in ('start_event','end_event') if s[k]}
    required_ids |= {e for s in segments for e in s['evidence']}
    kept_events = [e for e in events if START <= parse(e['at']) < CUTOFF or e['id'] in required_ids]
    crosschecks = []
    for filename, airport in [('svo-official-crosscheck.json','SVO'),('dme-official-crosscheck.json','DME'),('vko-candidate-crosscheck.json','VKO')]:
        path = WORK/filename
        if not path.exists(): continue
        value = json.loads(path.read_text())
        rows = value if isinstance(value,list) else value.get('messages',value.get('records',value.get('posts',[])))
        for row in rows:
            if not START <= parse(row['published_at']) < CUTOFF: continue
            if not re.search(r'ков[её]р|воздушн|при[её]м.{0,35}выпуск|принима.{0,20}рейс|закрыт|снят.{0,30}огранич|прекра',row['text'],re.I): continue
            crosschecks.append({**row,'airport':airport,'provenance':'candidate' if airport=='VKO' else 'official'})
    manifest=json.loads((WORK/'collection-manifest.json').read_text())
    dataset = {'meta':{'title':'Воздушное окно','start':iso(START),'cutoff':iso(CUTOFF),
        'timezone':'Europe/Moscow','partial_last_day':True,'source':'https://t.me/s/favt_info',
        'collected_at':manifest['collected_at'],'archive_messages':len(posts), 'archive_pages':len(manifest['pages']),
        'moscow_source_messages':len(relevant_posts),'time_basis':'publication',
        'coverage':'Восстановленные интервалы по сообщениям Росавиации. Полнота фактических ограничений не гарантирована.',
        'limitations':[
            'Время публикации не равно точному времени начала и окончания работы аэропорта в указанном режиме.',
            'Отсутствие сообщений не доказывает отсутствие ограничений. По непарным сводкам длительность не вычисляется.',
            '23 октября представлен только до 00:51 МСК; это неполный день.',
            'Сигнал «ковёр» сам по себе не доказывает полное прекращение полётов. Причина БПЛА не присваивается автоматически.',
            'Длительность — интервалы между публикациями, а не задержки рейсов. История отдельных рейсов не собрана.'
        ]},
        'airports':[{'code':a,'name':n} for a,n in AIRPORTS.items()],
        'events':sorted(kept_events,key=lambda e:e['at']), 'segments':sorted(segments,key=lambda s:s['start']),
        'episodes':sorted(episodes,key=lambda e:e['start']), 'observations':observations,
        'airport_reports':crosschecks,
        'quality':{'orphans_in_period':[e for e in orphan_lifts if START<=parse(e['at'])<CUTOFF],
                   'unclosed_segments':[s['id'] for s in segments if s['end_unknown']]}}
    dest=ROOT/'dist/data'
    dest.mkdir(parents=True,exist_ok=True)
    (dest/'dataset.json').write_text(json.dumps(dataset,ensure_ascii=False,indent=2))
    (dest/'collection-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    (dest/'source-messages.json').write_text(json.dumps(relevant_posts,ensure_ascii=False,indent=2))
    with (dest/'intervals.csv').open('w',newline='',encoding='utf-8-sig') as f:
        fields=['airport','status','start','end','clipped_start','clipped_end','duration_minutes','episode_id','start_event','end_event','start_clipped','end_unknown']
        writer=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore'); writer.writeheader();writer.writerows(segments)
    print(json.dumps({'source_messages':len(relevant_posts),'events':len(kept_events),'segments':len(segments),
        'episodes':len(episodes),'observations':len(observations),'airport_reports':len(crosschecks),
        'quality':dataset['quality']},ensure_ascii=False))
    for a in AIRPORTS:
        ss=[s for s in segments if s['airport']==a]
        print(a,'episodes',len([e for e in episodes if e['airport']==a]),
              'hours',round(sum(s['duration_minutes'] for s in ss)/60,2))

if __name__=='__main__': main()
