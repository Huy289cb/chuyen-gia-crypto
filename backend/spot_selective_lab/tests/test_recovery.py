"""Synthetic mechanism and causality checks; no financial replay or provider."""
from dataclasses import replace
from decimal import Decimal, getcontext
import unittest

from spot_backtest.models import Bar, HOUR_US, MINUTE_US
from spot_selective_lab.recovery import (
    FIVE_MINUTES_US, FOUR_HOURS_US, MECHANISM_ID, generate_signals,
)

D = Decimal


def candle(open_us, duration, close):
    close = D(str(close))
    return Bar(open_us, open_us + duration - 1, close, close + D(1), close - D(1),
               close, D(10), close * D(10), 1)


def fixture():
    # Flat base; a washout ages out of SMA21 exactly when the last close falls.
    # This creates one mathematical recovery cross with RSI below 50, without
    # taking any data or outcomes from a market/backtest.
    values = [100] * 200 + [50] + [100] * 19 + [108, 99]
    start = 800 * HOUR_US
    five = [candle(start + i * FIVE_MINUTES_US, FIVE_MINUTES_US, v)
            for i, v in enumerate(values)]
    one = [candle(i * HOUR_US, HOUR_US, 72 if i % 2 == 0 else 88) for i in range(821)]
    four = [candle(i * FOUR_HOURS_US, FOUR_HOURS_US, 75) for i in range(206)]
    return five, one, four


class RecoveryTests(unittest.TestCase):
    def test_exact_closed_recovery_cross_emits_once(self):
        five, one, four = fixture()
        signals = list(generate_signals(five, one, four))
        self.assertEqual(len(signals), 1)
        signal = signals[0]
        self.assertEqual(signal.signal_us, five[-1].close_us + 1)
        self.assertEqual(signal.mechanism_id, MECHANISM_ID)
        self.assertEqual(signal.signal_id, signal.episode_id)
        self.assertIsNone(signal.target)
        self.assertEqual(signal.reference, D(99))
        self.assertLess(signal.stop, signal.reference)
        self.assertGreater(signal.hurdle, signal.reference)
        self.assertEqual(signal.stop % D("0.01"), D(0))
        self.assertLess(signal.evidence["rsi14"], D(50))
        self.assertLess(signal.evidence["context1h_close_us"], signal.signal_us)
        self.assertLess(signal.evidence["context4h_close_us"], signal.signal_us)
        self.assertEqual(signal.evidence["hurdle_role"], "cost_diagnostic_only")
        self.assertGreater(signal.evidence["bbwidth20_population_1h"], D("0.06"))

    def test_no_repeat_while_fast_average_stays_above(self):
        five, one, four = fixture()
        base = list(generate_signals(five, one, four))
        next_open = five[-1].close_us + 1
        five += [candle(next_open + i * FIVE_MINUTES_US, FIVE_MINUTES_US, 100) for i in range(20)]
        extended = list(generate_signals(five, one, four))
        self.assertEqual(extended, base)

    def test_prefix_does_not_change_with_future_prices_or_context(self):
        five, one, four = fixture()
        cutoff = five[-1].close_us + 1
        base = list(generate_signals(five, one, four))
        # Replace context records that cannot yet be known with enormous prices.
        one = [bar if bar.close_us < cutoff else candle(bar.open_us, HOUR_US, 1000000)
               for bar in one]
        four = [bar if bar.close_us < cutoff else candle(bar.open_us, FOUR_HOURS_US, 2000000)
                for bar in four]
        five += [candle(cutoff + i * FIVE_MINUTES_US, FIVE_MINUTES_US, 50000) for i in range(12)]
        got = [signal for signal in generate_signals(five, one, four) if signal.signal_us <= cutoff]
        self.assertEqual(got, base)

    def test_context_same_close_is_available_but_unfinished_hour_is_not(self):
        five, one, four = fixture()
        signal = list(generate_signals(five, one, four))[0]
        cutoff = signal.signal_us
        expected_hour = cutoff // HOUR_US * HOUR_US - 1
        self.assertEqual(signal.evidence["context1h_close_us"], expected_hour)
        # The in-progress 1h candle spans the final5m signal, so it cannot feed EMA/BB.
        one = [candle(bar.open_us, HOUR_US, 999999) if bar.open_us == expected_hour + 1 else bar
               for bar in one]
        self.assertEqual(list(generate_signals(five, one, four)), [signal])

    def test_no_fake_crossover_at_sma_warmup(self):
        five, one, four = fixture()
        # Merely first becoming SMA-ready does not create a signal.
        self.assertEqual(list(generate_signals(five[:200], one, four)), [])

    def test_context_warmup_needs_200_real_bars(self):
        five, one, four = fixture()
        # Keep exact latest context coverage, but start 4h history too late for EMA200.
        self.assertEqual(list(generate_signals(five, one, four[10:])), [])

    def test_positive_context_and_nontrivial_width_are_required(self):
        five, one, four = fixture()
        flat_one = [candle(bar.open_us, HOUR_US, 80) for bar in one]
        expensive_four = [candle(bar.open_us, FOUR_HOURS_US, 150) for bar in four]
        self.assertEqual(list(generate_signals(five, flat_one, four)), [])
        self.assertEqual(list(generate_signals(five, one, expensive_four)), [])

    def test_incomplete_unaligned_unordered_missing_duplicate_fail(self):
        five, one, four = fixture()
        broken_cases = [
            [replace(five[0], close_us=five[0].close_us - 1)] + five[1:],
            [replace(five[0], open_us=five[0].open_us + 1)] + five[1:],
            five[:10] + five[11:],
            five[:10] + [five[10], five[10]] + five[11:],
            five[:10] + [five[11], five[10]] + five[12:],
        ]
        for broken in broken_cases:
            with self.subTest(first=broken[0], size=len(broken)):
                with self.assertRaises(ValueError):
                    list(generate_signals(broken, one, four))

    def test_context_gaps_and_truncated_latest_context_fail(self):
        five, one, four = fixture()
        for broken in (one[:210] + one[211:], one[:810]):
            with self.assertRaises(ValueError):
                list(generate_signals(five, broken, four))
        with self.assertRaises(ValueError):
            list(generate_signals(five, [], four))
        with self.assertRaises(ValueError):
            list(generate_signals(five, one, []))

    def test_invalid_context_future_suffix_is_validated_without_feature_use(self):
        five, one, four = fixture()
        bad_one = one[:-1] + [replace(one[-1], high=D(0))]
        with self.assertRaises(ValueError):
            list(generate_signals(five, bad_one, four))
        bad_four = four[:-1] + [replace(four[-1], close_us=four[-1].close_us - 1)]
        with self.assertRaises(ValueError):
            list(generate_signals(five, one, bad_four))

    def test_bad_prices_volumes_and_trades_fail(self):
        five, one, four = fixture()
        for field, value in (("close", D("NaN")), ("low", D(101)),
                             ("volume", D(-1)), ("quote_volume", D("Infinity")),
                             ("trades", -1), ("open", 100.0)):
            with self.subTest(field=field):
                broken = [replace(five[0], **{field: value})] + five[1:]
                with self.assertRaises(ValueError):
                    list(generate_signals(broken, one, four))

    def test_decimal_context_restored_and_input_iterators_supported(self):
        five, one, four = fixture()
        expected = list(generate_signals(five, one, four))
        precision = getcontext().prec
        iterator = generate_signals(iter(five), iter(one), iter(four))
        self.assertEqual(next(iterator), expected[0])
        self.assertEqual(getcontext().prec, precision)
        self.assertEqual(list(iterator), [])


if __name__ == "__main__":
    unittest.main()
