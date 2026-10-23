import json,pathlib,unittest
from research_ict_fvg import scan,observe_touches,pivots
ROOT=pathlib.Path(__file__).resolve().parents[2]
DATA=json.loads((ROOT/'docs/audits/2026-09-15-ict-opportunities/candles.json').read_text())
class ResearchTests(unittest.TestCase):
 def test_prefix_invariance(self):
  full=scan(DATA)['candidates']
  for i in range(50,len(DATA['candles']['15m'])):
   end=DATA['candles']['15m'][i]['closeTime']+1
   prefix={'asOf':end,'candles':{tf:[b for b in bs if b['closeTime']<end] for tf,bs in DATA['candles'].items()}}
   self.assertEqual(scan(prefix)['candidates'],[c for c in full if c['confirmedAt']<end],i)
 def test_confirmation_and_geometry(self):
  candidates=scan(DATA)['candidates'];self.assertTrue(candidates)
  for c in candidates:
   self.assertLess(c['sweepAt'],c['mssAt']);self.assertLess(c['mssAt'],c['confirmedAt'])
   self.assertGreaterEqual(abs(c['entry']-c['stopLoss'])/c['entry'],.008-1e-12)
   self.assertLessEqual(c['target']['confirmedAt'],c['confirmedAt'])
   self.assertIsNone(c['roi']);self.assertIsNone(c['probability'])
  self.assertTrue(any(c['rr']<1 for c in candidates))
 def test_no_confirmation_bar_fill(self):
  c={'id':'fixture','confirmedAt':99,'entry':10,'stopLoss':8,'side':'long'}
  d={'asOf':101,'candles':{'15m':[{'timestamp':0,'closeTime':99,'low':9,'high':11}]}}
  self.assertEqual(observe_touches({'candidates':[c]},d)[0]['state'],'pending_observation')
 def test_ambiguous_touch(self):
  c={'id':'fixture','confirmedAt':99,'entry':10,'stopLoss':8,'side':'long'}
  d={'asOf':201,'candles':{'15m':[{'timestamp':100,'closeTime':199,'low':7,'high':11}]}}
  self.assertEqual(observe_touches({'candidates':[c]},d)[0]['state'],'ambiguous_touch_invalidation')
 def test_pivot_needs_two_right_bars(self):
  bs=[{'high':h,'low':0,'closeTime':i} for i,h in enumerate([1,2,5,2,1])]
  self.assertEqual(pivots(bs[:4]),[]);self.assertEqual(pivots(bs)[0]['confirmedAt'],4)
if __name__=='__main__':unittest.main()
