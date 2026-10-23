"""Offline regression checks for the diagnostic's causal ordering and accounting."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('audit', pathlib.Path(__file__).with_name('audit-blocked-barriers.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class BarrierTests(unittest.TestCase):
    def setUp(self):
        self.protocol = dict(horizon_hours=48, hypothetical_sl_fraction=.01,
                             hypothetical_rr=3, end_ms=180000,
                             fee_fraction_per_side=.0005,
                             slippage_round_trip_base=.001,
                             slippage_round_trip_stress=.002)
        self.bars = [[0, 100, 200, 1], [60000, 100, 100.5, 99.5], [120000, 100, 104, 100]]

    def run_plan(self, plan, funding=None):
        return audit.evaluate(plan, self.bars, [b[0] for b in self.bars], funding or [], self.protocol)

    def test_intraminute_ambiguity(self):
        self.assertEqual(audit.hit([0, 100, 105, 98], 'long', 99, 104), ('ambiguous', None))

    def test_gap_precedes_later_target(self):
        self.assertEqual(audit.hit([0, 98, 105, 97], 'long', 99, 104), ('sl_first', 98))

    def test_short_target(self):
        self.assertEqual(audit.hit([0, 100, 101, 95], 'short', 102, 96), ('tp_first', 96))

    def test_no_predecision_fill_or_outcome(self):
        result = self.run_plan(dict(kind='hypothetical_core', decision_ms=1, side='long'))
        self.assertEqual((result['entry_ms'], result['outcome']), (60000, 'tp_first'))

    def test_fee_slippage_funding_accounting(self):
        result = self.run_plan(dict(kind='hypothetical_core', decision_ms=1, side='long'),
                               [dict(fundingTime=90000, markPrice='100', fundingRate='.001')])
        self.assertAlmostEqual(result['gross_usd'], .003)
        self.assertAlmostEqual(result['fees_usd'], .0001015)
        self.assertAlmostEqual(result['funding_usd'], .0001)
        self.assertAlmostEqual(result['net_base'], .0026985)
        self.assertAlmostEqual(result['net_stress'], .0025985)

    def test_unfilled_is_censored_when_ttl_incomplete(self):
        result = self.run_plan(dict(kind='stored_levels', decision_ms=1, side='long', entry=98, sl=97, tp=101))
        self.assertEqual(result['outcome'], 'censored_before_fill')

    def test_fill_bar_order_is_not_invented(self):
        result = self.run_plan(dict(kind='stored_levels', decision_ms=1, side='long', entry=100, sl=99.6, tp=104))
        self.assertEqual(result['outcome'], 'entry_bar_ambiguous')

    def test_unresolved_not_labeled_loss(self):
        self.bars[-1] = [120000, 100, 100.5, 99.5]
        result = self.run_plan(dict(kind='hypothetical_core', decision_ms=1, side='long'))
        self.assertEqual(result['outcome'], 'censored')

    def test_postgres_fraction_and_explicit_offset(self):
        self.assertEqual(audit.timestamp('2026-09-08T13:36:32.77'), audit.timestamp('2026-09-08T13:36:32.770Z'))
        self.assertEqual(audit.timestamp('2026-09-08T20:36:32.77+07:00'), audit.timestamp('2026-09-08T13:36:32.77Z'))


if __name__ == '__main__':
    unittest.main()
