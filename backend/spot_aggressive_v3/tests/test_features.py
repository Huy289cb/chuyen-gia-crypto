"""Causal mechanism and episode contracts, without financial-result inputs."""
from dataclasses import replace
from decimal import Decimal, localcontext
import unittest

from spot_aggressive_v3.features import (FOUR_HOURS_US, ResearchEvent, WilderATR,
                                     _lower_band, floor_tick, generate_events)
from spot_aggressive_v3.models import Bar

D = Decimal


def bars(closes, *, start=0, widths=None):
    result = []
    for index, close in enumerate(closes):
        close = D(str(close))
        width = D(str(widths[index])) if widths else D("1")
        opened = start + index * FOUR_HOURS_US
        result.append(Bar(opened, opened + FOUR_HOURS_US - 1, close, close + width,
                          close - width, close, D("1"), close, 1))
    return result


class FeaturesTests(unittest.TestCase):
    def test_first_ready_joint_trend_is_one_episode_without_finite_target(self):
        series = bars(range(100, 165))
        events = list(generate_events(series, series, "trend4h"))
        self.assertEqual([event.kind for event in events], ["ENTRY"] + ["TRAIL_UPDATE"] * 5)
        self.assertEqual(len({event.setup_id for event in events}), 1)
        entry = events[0]
        self.assertIsInstance(entry, ResearchEvent)
        self.assertEqual(entry.at_us, series[59].close_us + 1)
        self.assertIsNone(entry.target)
        self.assertEqual(entry.stop, D("155.00"))
        self.assertEqual(entry.hurdle_price, D("167.00"))

    def test_trail_never_decreases_even_as_atr_expands(self):
        closes = list(range(100, 162)) + [160, 159, 160]
        widths = [1] * 62 + [40, 30, 20]
        series = bars(closes, widths=widths)
        events = list(generate_events(series, series, "trend4h"))
        self.assertTrue(any(event.kind == "TRAIL_UPDATE" for event in events))
        stops = [event.stop for event in events if event.kind in ("ENTRY", "TRAIL_UPDATE")]
        self.assertEqual(stops, sorted(stops))
        self.assertEqual(events[-1].stop, events[2].stop)

    def test_regime_exit_and_rearm_create_independent_setup_ids(self):
        closes = list(range(100, 165)) + [20] * 65 + list(range(20, 100))
        series = bars(closes)
        events = list(generate_events(series, series, "trend4h"))
        entries = [event for event in events if event.kind == "ENTRY"]
        exits = [event for event in events if event.kind == "REGIME_EXIT"]
        self.assertEqual(len(entries), 2)
        self.assertEqual(len(exits), 1)
        self.assertEqual(exits[0].setup_id, entries[0].setup_id)
        self.assertNotEqual(entries[0].setup_id, entries[1].setup_id)
        self.assertLess(exits[0].at_us, entries[1].at_us)

    def test_btc_joint_regime_is_required_for_trend(self):
        sol = bars(range(100, 180))
        btc = bars(range(200, 120, -1))
        self.assertEqual(list(generate_events(sol, btc, "trend4h")), [])

    def test_future_sol_and_btc_changes_cannot_change_prefix_events(self):
        series = bars(range(100, 180))
        cutoff = 65
        expected = list(generate_events(series[:cutoff], series[:cutoff], "trend4h"))
        sol_changed = series[:cutoff] + bars([2] * 15, start=cutoff * FOUR_HOURS_US)
        btc_changed = series[:cutoff] + bars([1000] * 15, start=cutoff * FOUR_HOURS_US)
        actual = [event for event in generate_events(sol_changed, btc_changed, "trend4h")
                  if event.at_us <= series[cutoff - 1].close_us + 1]
        self.assertEqual(actual, expected)

    def test_reversion_uses_prior_mean_and_consumes_rejected_context(self):
        sol = bars([100] * 60 + [90, 89, 100, 100, 80])
        btc = bars(range(200, 135, -1))
        events = list(generate_events(sol, btc, "reversion4h"))
        self.assertEqual([event.at_us for event in events],
                         [sol[60].close_us + 1, sol[64].close_us + 1])
        self.assertFalse(events[0].context_ok)
        self.assertEqual(events[0].reason, "BTC_CONTEXT_BELOW_SMA60")
        self.assertEqual(events[0].target, D("100.00"))
        self.assertEqual(events[0].hurdle_price, events[0].target)
        self.assertNotEqual(events[0].setup_id, events[1].setup_id)
        # Including the signal90 in the mean would produce99.5, which is forbidden.
        self.assertNotEqual(events[0].target, D("99.50"))

    def test_reversion_context_accepts_equality_and_rearms_at_band(self):
        sol = bars([100] * 60 + [90, 89, 100, 100, 80])
        btc = bars([100] * len(sol))
        events = list(generate_events(sol, btc, "reversion4h"))
        self.assertEqual(len(events), 2)
        self.assertTrue(all(event.context_ok for event in events))
        self.assertTrue(all(event.target is not None for event in events))

    def test_warmup_rejected_reversion_excursion_is_not_retried_at_btc_ready(self):
        sol = bars([100] * 20 + [90] * 45)
        btc = bars([100] * len(sol))
        events = list(generate_events(sol, btc, "reversion4h"))
        self.assertEqual(len(events), 1)
        self.assertFalse(events[0].context_ok)
        self.assertEqual(events[0].reason, "BTC_CONTEXT_WARMUP_MISSING")

    def test_population_standard_deviation_uses_twenty_not_nineteen(self):
        values = [D("100")] * 10 + [D("102")] * 10
        mean, lower = _lower_band(values)
        self.assertEqual(mean, D("101"))
        self.assertEqual(lower, D("99"))

    def test_atr_seed_and_wilder_recursion_are_closed_bar_decimal(self):
        series = bars([100] * 14 + [105])
        indicator = WilderATR()
        values = [indicator.push(bar) for bar in series]
        self.assertTrue(all(value is None for value in values[:13]))
        self.assertEqual(values[13], D("2"))
        with localcontext() as context:
            context.prec = 50
            self.assertEqual(values[14], D(32) / D(14))

    def test_event_ids_are_stable_and_models_have_separate_namespaces(self):
        series = bars(range(100, 165))
        first = list(generate_events(series, series, "trend4h"))
        second = list(generate_events(iter(series), iter(series), "trend4h"))
        self.assertEqual(first, second)
        self.assertEqual(len(first[0].setup_id), 24)

    def test_incomplete_unaligned_and_gapped_bars_fail_without_silent_context(self):
        series = bars(range(100, 165))
        invalids = (series[:3] + series[4:],
                    [replace(series[0], close_us=series[0].close_us - 1)] + series[1:],
                    [replace(series[0], open_us=1)] + series[1:])
        for invalid in invalids:
            with self.subTest(invalid=invalid[:1]), self.assertRaises(ValueError):
                list(generate_events(invalid, series, "trend4h"))
        with self.assertRaisesRegex(ValueError, "missing aligned"):
            list(generate_events(series, series[1:], "trend4h"))
        with self.assertRaisesRegex(ValueError, "missing aligned|gapped"):
            list(generate_events(series, series[:3] + series[4:], "trend4h"))

    def test_unknown_mechanism_and_float_ohlc_fail(self):
        series = bars([100])
        with self.assertRaisesRegex(ValueError, "unknown locked mechanism"):
            list(generate_events(series, series, "optimized_winner"))
        invalid = [replace(series[0], close=100.0)]
        with self.assertRaisesRegex(ValueError, "Decimal"):
            list(generate_events(invalid, series, "trend4h"))
        self.assertEqual(floor_tick(D("99.999")), D("99.99"))


if __name__ == "__main__":
    unittest.main()
