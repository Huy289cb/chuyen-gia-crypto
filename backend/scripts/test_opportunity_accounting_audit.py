import unittest
from opportunity_accounting_audit import audit_run

def fixture():
 return {'summary':{'initialWallet':100,'trades':1,'wins':0,'wallet':99,'equity':99,'netCashUsd':-1,'roiEquityPercent':-1,'open':False,'pending':False},'events':[{'type':'reserve','plan':{'id':'x','riskUsd':1}}], 'closes':[{'planId':'x','time':1,'netUsd':-1,'netR':-1,'wallet':99,'feesUsd':.1,'slippageUsd':.1}]}

class AccountingTests(unittest.TestCase):
 def test_consistent_run(self): self.assertEqual(audit_run(fixture()), [])
 def test_detects_wrong_cash_and_roi(self):
  f=fixture();f['closes'][0]['wallet']=100;f['summary']['roiEquityPercent']=1
  self.assertEqual(audit_run(f), ['close_wallet_mismatch','roi_mismatch'])
 def test_detects_missing_reservation_duplicate_and_risk(self):
  f=fixture();f['closes'][0]['netR']=2
  self.assertIn('net_r_mismatch',audit_run(f))
  f['events']=[];f['closes']*=2
  self.assertIn('duplicate_close',audit_run(f));self.assertIn('close_without_reservation',audit_run(f))

if __name__ == '__main__': unittest.main()
