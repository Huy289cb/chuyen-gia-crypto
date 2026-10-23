import unittest
from prospective_review_audit import review_links,known_cost
C={'quota-0-1.json':{'time':0,'hour':0}}
R={'result-0.json':{'claim':{'day':0,'slot':1,'hour':0}}}
class ReviewAuditTests(unittest.TestCase):
 def test_exact_link(self):self.assertTrue(review_links(C,R)['reviewJournalComplete'])
 def test_equal_counts_do_not_hide_orphan_and_missing_response(self):
  r=review_links(C,{'result-1.json':{'claim':{'day':0,'slot':1,'hour':1}}})
  self.assertEqual(r['claimsWithoutResult'],1);self.assertEqual(r['orphanOrInvalidResults'],['result-1.json'])
 def test_duplicate_and_invalid_claim(self):
  r=review_links(C,{**R,'result-copy.json':R['result-0.json']})
  self.assertEqual(r['duplicateResultClaims'],['quota-0-1.json'])
  self.assertEqual(review_links({'quota-1-1.json':C['quota-0-1.json']},{})['invalidClaims'],['quota-1-1.json'])
 def test_cost_is_finite_nonnegative_number_not_boolean(self):
  for x in [True,None,-1,float('nan'),float('inf'),'0']:self.assertFalse(known_cost(x))
  self.assertTrue(known_cost(0));self.assertTrue(known_cost(.01))
if __name__=='__main__':unittest.main()
