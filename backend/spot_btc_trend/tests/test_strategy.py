import unittest
from decimal import Decimal, getcontext

from spot_backtest.models import Bar, HOUR_US
from spot_btc_trend.strategy import generate_signals, MODEL_ID

D = Decimal


def hour(index, close, volume=D(1)):
    opened = index * HOUR_US
    value = D(close)
    return Bar(opened, opened + HOUR_US - 1, value, value, value, value,
               volume, value * volume)


class StrategyTests(unittest.TestCase):
    def test_exact_crosses_after_warmup_and_stable_episode(self):
        bars = [hour(i, '60000') for i in range(1300)]
        bars.extend([hour(1300, '60100'), hour(1301, '60200'), hour(1302, '58000')])
        signals = list(generate_signals(bars))
        self.assertEqual([event.kind for event in signals], ['ENTRY', 'EXIT'])
        self.assertEqual(signals[0].at_us, 1301 * HOUR_US)
        self.assertEqual(signals[1].episode_id, signals[0].episode_id)
        expected = D(60000) + D(2) / D(601) * D(100)
        self.assertAlmostEqual(signals[0].ema, expected, places=20)
        self.assertEqual(signals[0].model_id, MODEL_ID)
        self.assertEqual(signals, list(generate_signals(bars)))

    def test_no_seed_or_startup_false_cross(self):
        self.assertEqual(list(generate_signals([hour(i, '60000') for i in range(1500)])), [])
        bars = [hour(i, '60000') for i in range(600)]
        bars.extend(hour(i, '60100') for i in range(600, 1299))
        self.assertEqual(list(generate_signals(bars)), [])

    def test_zero_volume_entry_is_not_emitted(self):
        bars = [hour(i, '60000') for i in range(1300)]
        bars.append(hour(1300, '61000', D(0)))
        self.assertEqual(list(generate_signals(bars)), [])

    def test_prefix_invariance_with_extreme_future_and_context_restore(self):
        bars = [hour(i, '60000') for i in range(1300)] + [hour(1300, '60100')]
        prefix = list(generate_signals(bars))
        before = getcontext().prec
        full = list(generate_signals(bars + [hour(1301, '90000000'), hour(1302, '1')]))
        self.assertEqual([event for event in full if event.at_us <= prefix[0].at_us], prefix)
        self.assertEqual(getcontext().prec, before)
        iterator = generate_signals(bars)
        next(iterator)
        self.assertEqual(getcontext().prec, before)
        iterator.close()

    def test_bad_candle_time_gap_duplicate_and_float_fail_closed(self):
        from dataclasses import replace
        good = hour(0, '60000')
        for invalid in (
                replace(good, close_us=good.close_us - 1),
                replace(good, open_us=True),
                replace(good, low=D('70000')),
                replace(good, volume=1.0)):
            with self.subTest(bar=invalid), self.assertRaises(ValueError):
                list(generate_signals([invalid]))
        for suffix in (good, hour(2, '60000')):
            with self.assertRaises(ValueError):
                list(generate_signals([good, suffix]))


if __name__ == '__main__':
    unittest.main()
