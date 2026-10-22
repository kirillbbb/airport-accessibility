import datetime as dt
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from collect import parse_page, MSK, START, CUTOFF, ROOT, WORK
from normalize import classify, reconstruct, parse

def event(ident,status,at,airport='SVO'):
    return {'id':ident,'airport':airport,'status':status,'at':at,'url':'https://example.org'}

class DataTests(unittest.TestCase):
    def test_reply_and_timezone(self):
        p=parse_page((WORK/'raw/favt-latest.html').read_text())
        p={x['id']:x for x in p}
        events,_=classify(p['favt_info/8872'])
        self.assertEqual({e['status'] for e in events},{'open'})
        self.assertEqual(len(events),4)
        self.assertTrue(events[0]['at'].startswith('2026-10-22T05:19:56'))
        self.assertEqual(classify(p['favt_info/8870'])[0][0]['status'],'suspended')
    def test_transition_dedup_and_clip(self):
        es=[event('a','coordinated','2026-09-22T23:00:00+03:00'),
            event('b','coordinated','2026-09-23T00:10:00+03:00'),
            event('c','suspended','2026-09-23T01:00:00+03:00'),
            event('d','open','2026-09-23T02:00:00+03:00')]
        ss,eps,orphan=reconstruct(es)
        self.assertEqual(len(eps),1); self.assertEqual(len(ss),2)
        self.assertEqual(ss[0]['evidence'],['a','b'])
        self.assertTrue(ss[0]['start_clipped'])
        self.assertEqual(sum(s['duration_minutes'] for s in ss),120)
        self.assertFalse(orphan)
    def test_orphan_and_unknown_end(self):
        ss,eps,orphans=reconstruct([event('a','open','2026-09-23T01:00:00+03:00'),
                                  event('b','suspended','2026-10-23T00:30:00+03:00')])
        self.assertEqual(len(orphans),1)
        self.assertTrue(ss[0]['end_unknown']);self.assertIsNone(eps[0]['end'])
        self.assertEqual(ss[0]['duration_minutes'],21)
    def test_non_template_observation_is_not_interval(self):
        posts=json.loads((WORK/'posts.json').read_text())
        post=next(p for p in posts if p['id']=='favt_info/8797')
        events,observation=classify(post)
        self.assertEqual(events,[])
        self.assertEqual(set(observation['airports']),{'SVO','VKO','DME','ZIA'})
        data=json.loads((ROOT/'dist/data/dataset.json').read_text())
        self.assertTrue(any(o['id']==post['id'] for o in data['observations']))
        self.assertFalse(any(post['id'].replace('/','-') in s['start_event'] for s in data['segments']))
    def test_real_dataset_integrity(self):
        data=json.loads((ROOT/'dist/data/dataset.json').read_text())
        self.assertEqual(len(data['episodes']),98)
        self.assertEqual(len(data['segments']),130)
        event_ids={e['id'] for e in data['events']}
        for airport in ['SVO','VKO','DME','ZIA']:
            ss=sorted([s for s in data['segments'] if s['airport']==airport],key=lambda s:s['start'])
            for s in ss:
                self.assertIn(s['start_event'],event_ids);self.assertIn(s['end_event'],event_ids)
                self.assertLess(parse(s['start']),parse(s['end']))
            for a,b in zip(ss,ss[1:]):self.assertLessEqual(parse(a['end']),parse(b['start']))
        self.assertEqual(data['quality']['unclosed_segments'],[])
        self.assertEqual(data['quality']['orphans_in_period'],[])

if __name__=='__main__':unittest.main()
