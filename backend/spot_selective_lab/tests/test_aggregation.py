"""Closed-candle aggregation guarantees, using synthetic minutes only."""
from dataclasses import replace
from decimal import Decimal, getcontext
import unittest

from spot_backtest.models import Bar, HOUR_US, MINUTE_US
from spot_selective_lab.aggregation import aggregate_minutes

D = Decimal


def minute(index, start=0):
    price = D(100 + index)
    return Bar(start + index * MINUTE_US, start + (index + 1) * MINUTE_US - 1,
               price, price + 2, price - 2, price + 1,
               D(index + 1), D(index + 1) * price, index + 1)


class AggregationTests(unittest.TestCase):
    def test_exact_5m_ohlc_volumes_trades(self):
        bars = [minute(i) for i in range(10)]
        got = list(aggregate_minutes(iter(bars), 5 * MINUTE_US))
        self.assertEqual(len(got), 2)
        self.assertEqual(got[0], Bar(0, 5 * MINUTE_US - 1, D(100), D(106), D(98), D(105),
                                     D(15), sum((b.quote_volume for b in bars[:5]), D(0)), 15))
        self.assertEqual(got[1].open_us, 5 * MINUTE_US)
        self.assertEqual(got[1].close_us + 1, 10 * MINUTE_US)

    def test_hour_boundary_has_sixty_complete_minutes(self):
        got = list(aggregate_minutes((minute(i, HOUR_US) for i in range(120)), HOUR_US))
        self.assertEqual(len(got), 2)
        self.assertEqual(got[0].open_us, HOUR_US)
        self.assertEqual(got[0].close_us + 1, 2 * HOUR_US)
        self.assertEqual(got[0].volume, D(1830))

    def test_no_peek_into_next_bucket_and_future_prefix_invariant(self):
        reads = []
        def source():
            for i in range(10):
                reads.append(i)
                yield minute(i)
        iterator = aggregate_minutes(source(), 5 * MINUTE_US)
        first = next(iterator)
        self.assertEqual(reads, list(range(5)))
        changed = [minute(i) for i in range(5)] + [replace(minute(i), high=D(999999)) for i in range(5, 10)]
        self.assertEqual(list(aggregate_minutes(changed, 5 * MINUTE_US))[0], first)

    def test_gaps_duplicates_order_and_partial_buckets_rejected(self):
        bars = [minute(i) for i in range(10)]
        broken = [bars[:2] + bars[3:], bars[:2] + [bars[2], bars[2]] + bars[3:],
                  bars[:2] + [bars[3], bars[2]] + bars[4:], bars[:-1], bars[1:]]
        for values in broken:
            with self.subTest(length=len(values)):
                with self.assertRaises(ValueError):
                    list(aggregate_minutes(values, 5 * MINUTE_US))

    def test_bad_minute_shape_or_values_rejected(self):
        bars = [minute(i) for i in range(5)]
        changes = ({"close_us": bars[0].close_us - 1}, {"open_us": 1}, {"open_us": True},
                   {"open": 100.0}, {"high": D(0)}, {"volume": D(-1)},
                   {"quote_volume": D("NaN")}, {"trades": True})
        for change in changes:
            with self.subTest(change=change):
                with self.assertRaises(ValueError):
                    list(aggregate_minutes([replace(bars[0], **change)] + bars[1:], 5 * MINUTE_US))

    def test_supported_durations_and_precision_scope(self):
        for duration in (MINUTE_US, 15 * MINUTE_US, True, float(HOUR_US)):
            with self.assertRaises(ValueError):
                list(aggregate_minutes([], duration))
        precision = getcontext().prec
        iterator = aggregate_minutes((minute(i) for i in range(5)), 5 * MINUTE_US)
        next(iterator)
        self.assertEqual(getcontext().prec, precision)
        self.assertEqual(list(iterator), [])


if __name__ == "__main__":
    unittest.main()
