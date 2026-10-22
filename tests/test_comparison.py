import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from compare import msk_comparison,airports_comparison,benzin_comparison,DATA

class ComparisonTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.data=json.loads((DATA/'dataset.json').read_text())
    def test_msk_event_identity_and_boundary_definition(self):
        result=msk_comparison(self.data)
        self.assertEqual(result['exact_event_matches'],result['event_count'])
        dme=result['stats']['DME']
        self.assertEqual(dme['ours_intersecting_episodes']-dme['site_episode_count'],1)
        self.assertEqual(dme['ours_starts_in_period'],dme['site_episode_count'])
    def test_closed_monthly_copy_beats_ongoing_copy(self):
        result=airports_comparison(self.data)
        self.assertEqual(len(result['monthly_export_conflicts']),1)
        self.assertTrue(result['monthly_export_conflicts'][0]['start'].startswith('2026-09-30T19:56'))
        self.assertFalse(any(r['start'].startswith('2026-09-30T19:56') for r in result['different_endings']))
        self.assertLess(result['per_airport']['DME']['site_hours_from_boundaries'],200)
        self.assertEqual(len(result['missing_in_csv']),13)
        self.assertEqual(len(result['different_endings']),4)
    def test_wrong_airport_assignments_are_not_consensus(self):
        result=benzin_comparison(self.data)
        rows=result['other_source_assignments']
        self.assertTrue(any(r['airport']=='ZIA' and r['source_url'].endswith('/8422') for r in rows))
        self.assertEqual({r['airport'] for r in rows if r['source_url'].endswith('/8518')},{'SVO','VKO','DME','ZIA'})
        self.assertEqual(len(self.data['episodes']),98)

if __name__=='__main__':unittest.main()
