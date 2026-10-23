import unittest
from replay_ict_1m import replay
C={'id':'test','confirmedAt':59999,'side':'long','entry':100,'stopLoss':99,'target':{'price':102}}
def bar(t,lo=100.2,hi=100.8,op=100.5,cl=100.5):return {'timestamp':t,'open':op,'low':lo,'high':hi,'close':cl}
class ReplayTests(unittest.TestCase):
 def test_expiry_zero_cost(self):
  r=replay(C,[bar(t) for t in range(60000,3660000,60000)],3660000);self.assertEqual(r['state'],'expired_without_fill');self.assertEqual(r['netBaseUsd'],0)
 def test_gaps_not_zero_trades(self):
  self.assertEqual(replay(C,[],3660000)['state'],'missing_data')
 def test_touch_without_penetration(self):
  self.assertEqual(replay(C,[bar(60000),bar(120000,100)],180000)['state'],'pending')
 def test_latency(self):
  self.assertEqual(replay(C,[bar(60000,99.5),bar(120000)],180000)['state'],'pending')
 def test_same_minute_ambiguity(self):
  self.assertEqual(replay(C,[bar(60000),bar(120000,99.5,102.5)],180000)['state'],'ambiguous_entry_exit_same_minute')
 def test_target_within_tick_is_invalid_not_ambiguous(self):
  c={**C,'target':{'price':100.05}}
  r=replay(c,[bar(60000),bar(120000,99.5,102.5)],180000)
  self.assertEqual(r['state'],'invalid_levels');self.assertEqual(r.get('reason'),'target_within_tick')
 def test_costs_and_funding_coverage(self):
  bs=[bar(60000),bar(120000,99.5),bar(180000),bar(240000,100.2,102.2)]
  r=replay(C,bs,300000);self.assertIsNone(r['netBaseUsd'])
  r=replay(C,bs,300000,{'from':0,'through':300000,'rows':[]});self.assertIsNotNone(r['netBaseUsd']);self.assertGreater(r['netBaseUsd'],r['netStressUsd']);self.assertAlmostEqual(r['costs']['Base']['commissionUsd'],.0005*.001*(100+102*(1-.0005)))
 def test_missing_exit_data(self):
  self.assertEqual(replay(C,[bar(60000),bar(120000,99.5)],4000000)['state'],'missing_data')
 def test_mirror_short(self):
  c={**C,'side':'short','stopLoss':101,'target':{'price':98}}
  r=replay(c,[bar(60000,99.2,99.8,99.5,99.5),bar(120000,99.2,100.5,99.5,99.5),bar(180000,97.5,99.8,99.5,99.5)],240000,{'from':0,'through':240000,'rows':[]})
  self.assertEqual(r['state'],'closed_assumed_fill');self.assertGreater(r['netBaseUsd'],0)
if __name__=='__main__':unittest.main()
