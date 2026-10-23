import unittest
from opportunity_rejection_report import summarize
class RejectionReportTests(unittest.TestCase):
    def test_denominators_and_unknown_reason(self):
        r=summarize({'candidateDiagnostics':{'snapshots':10,'no_confirmed_setup':8,'x:candidate':3,'x:structural_bounds':1,'x:quantity_or_exposure':1,'x:new_guard':1},'trades':0})
        self.assertEqual(r['noSetupPercent'],80)
        self.assertEqual(r['setups']['x']['groups'],{'target_room':1,'quantity_or_exposure':1,'other':1})
        self.assertAlmostEqual(r['setups']['x']['percentOfCandidates']['target_room'],100/3)
    def test_incomplete_counter_is_not_silently_accepted(self):
        with self.assertRaises(ValueError): summarize({'candidateDiagnostics':{'x:candidate':2,'x:accepted':1}})
    def test_missing_is_not_zero(self):
        self.assertFalse(summarize({})['available'])
        self.assertIsNone(summarize({'candidateDiagnostics':{}})['noSetupPercent'])
    def test_invalid_counts(self):
        for value in [-1,True,1.5]:
            with self.assertRaises(ValueError): summarize({'candidateDiagnostics':{'snapshots':value}})
if __name__=='__main__': unittest.main()
