"""Synthetic causality, data-integrity and rule-boundary tests only."""
from dataclasses import asdict, FrozenInstanceError
from decimal import Decimal, getcontext, localcontext
import json
import unittest
from unittest.mock import patch

from spot_backtest.models import Bar, DAY_US, HOUR_US
from spot_rotation.strategy import (
    aggregate_daily, iter_decisions, generate_control_signals,
    SYMBOLS, MODEL_ID, CONTROL_ID, CONTROL_SEED_START_US,
)

D = Decimal
START = 1751328000000000  # 2025-07-01 UTC, synthetic candles only.


def hours(prices, start=START):
    for day, price in enumerate(prices):
        price = D(price)
        for hour in range(24):
            at = start + day * DAY_US + hour * HOUR_US
            yield Bar(at, at + HOUR_US - 1, price, price + 1, price - 1,
                      price, D(1), D(1000), 1)


def universe(prices_by_symbol=None, days=14):
    table = {symbol: [D(100 + i) for i in range(days)] for symbol in SYMBOLS}
    table.update(prices_by_symbol or {})
    return {symbol: hours(prices) for symbol, prices in table.items()}


class DailyAggregationTests(unittest.TestCase):
    def test_complete_day_retains_ohlcv_and_exact_availability(self):
        bars = [Bar(START + i * HOUR_US, START + (i + 1) * HOUR_US - 1,
                    D(100+i), D(102+i), D(99+i), D(101+i),
                    D(i+1), D(100+i), i) for i in range(24)]
        daily, = aggregate_daily(bars)
        self.assertEqual((daily.open, daily.high, daily.low, daily.close),
                         tuple(map(D, (100, 125, 99, 124))))
        self.assertEqual((daily.volume, daily.quote_volume, daily.trades),
                         (D(300), D(2676), 276))
        self.assertEqual(daily.close_us + 1, START + DAY_US)

    def test_partial_day_gap_duplicate_and_midday_start_are_rejected(self):
        full = list(hours([100]))
        for bad in (full[:-1], full[1:], full[:4] + full[5:], full[:4] + full[3:]):
            with self.subTest(length=len(bad)):
                with self.assertRaises(ValueError):
                    list(aggregate_daily(bad))

    def test_non_decimal_and_invalid_ohlc_are_rejected(self):
        for close in (100.0, D(103), D('NaN')):
            first = Bar(START, START + HOUR_US - 1, D(100), D(101), D(99),
                        close, D(1), D(1), 1)
            with self.subTest(close=str(close)), self.assertRaises(ValueError):
                list(aggregate_daily([first]))


class RotationRulesTests(unittest.TestCase):
    def test_seven_day_return_uses_eight_closes(self):
        eth = [D(100)] * 7 + [D(200)] * 6 + [D(300)]
        decision, = iter_decisions(universe({'ETHUSDT': eth}))
        self.assertEqual(decision.momentum['ETHUSDT'], D(2))
        self.assertEqual(decision.target_symbol, 'ETHUSDT')
        with localcontext() as ctx:
            ctx.prec = 50
            btc_expected = D(113) / D(106) - 1
        self.assertEqual(decision.momentum['BTCUSDT'], btc_expected)
        self.assertEqual(decision.at_us, START + 14 * DAY_US)
        self.assertEqual(decision.model_id, MODEL_ID)

    def test_btc_positive_gate_includes_zero_boundary(self):
        for btc in ([100] * 14, list(range(114, 100, -1))):
            decision, = iter_decisions(universe({'BTCUSDT': btc,
                                                 'ETHUSDT': list(range(100, 128, 2))}))
            self.assertGreater(decision.momentum['ETHUSDT'], 0)
            self.assertIsNone(decision.target_symbol)
        decision, = iter_decisions({s: hours(list(range(114, 100, -1))) for s in SYMBOLS})
        self.assertLess(max(decision.momentum.values()), 0)
        self.assertIsNone(decision.target_symbol)

    def test_ties_use_symbol_order_not_input_order(self):
        data = universe({'ETHUSDT': list(range(100, 128, 2)),
                         'SOLUSDT': list(range(100, 128, 2))})
        decision, = iter_decisions(dict(reversed(list(data.items()))))
        self.assertEqual(decision.target_symbol, 'ETHUSDT')
        self.assertEqual(decision.momentum['ETHUSDT'], decision.momentum['SOLUSDT'])

    def test_atr_seed_gap_true_range_and_wilder_state(self):
        decisions = list(iter_decisions(universe({'ADAUSDT': [100] + [110] * 13 + [129]}, days=15)))
        with localcontext() as ctx:
            ctx.prec = 50
            seed = D(37) / D(14)  # first TR2, gap TR11, twelve further TR2.
            updated = (13 * seed + 20) / 14
        self.assertEqual(decisions[0].atr14['ADAUSDT'], seed)
        self.assertEqual(decisions[1].atr14['ADAUSDT'], updated)
        self.assertNotEqual(decisions[1].atr14['ADAUSDT'], decisions[0].atr14['ADAUSDT'])

    def test_warmup_does_not_emit_false_cash_decisions(self):
        self.assertEqual(list(iter_decisions(universe(days=13))), [])
        self.assertEqual(len(list(iter_decisions(universe(days=14)))), 1)

    def test_first_decision_cannot_read_any_future_hour(self):
        def guarded():
            yield from hours(list(range(100, 114)))
            raise AssertionError('future data read before first daily decision')
        generator = iter_decisions({s: guarded() for s in SYMBOLS})
        precision = getcontext().prec
        decision = next(generator)
        self.assertEqual(decision.at_us, START + 14 * DAY_US)
        self.assertEqual(getcontext().prec, precision)
        generator.close()

    def test_snapshot_is_stable_and_serializable(self):
        first, = iter_decisions(universe())
        second, = iter_decisions(universe())
        self.assertEqual(first.decision_id, second.decision_id)
        with self.assertRaises(TypeError):
            first.momentum['BTCUSDT'] = D(999)
        with self.assertRaises(TypeError):
            first.atr14.update({'BTCUSDT': D(999)})
        with self.assertRaises(FrozenInstanceError):
            first.target_symbol = None
        serialized = json.loads(json.dumps(asdict(first), default=str))
        self.assertEqual(serialized['decision_id'], first.decision_id)
        self.assertEqual(set(serialized['momentum']), set(SYMBOLS))

    def test_universe_and_history_alignment_are_mandatory(self):
        missing = universe()
        missing.pop('ADAUSDT')
        unequal = universe()
        unequal['ADAUSDT'] = hours(list(range(100, 115)))
        shifted = universe()
        shifted['ADAUSDT'] = hours(list(range(100, 114)), start=START + DAY_US)
        for bad in (missing, unequal, shifted):
            with self.assertRaises(ValueError):
                list(iter_decisions(bad))


class FrozenControlTests(unittest.TestCase):
    def test_control_preserves_frozen_crossings_and_signal_identity(self):
        prices = [D(100)] * 1300 + [D(101), D(97)]
        bars = [Bar(CONTROL_SEED_START_US + i*HOUR_US,
                    CONTROL_SEED_START_US + (i+1)*HOUR_US - 1,
                    p, p, p, p, D(1), p, 1) for i, p in enumerate(prices)]
        entry, exit_ = generate_control_signals(bars)
        self.assertEqual((entry.kind, exit_.kind), ('ENTRY', 'EXIT'))
        self.assertEqual(entry.at_us, CONTROL_SEED_START_US + 1301*HOUR_US)
        self.assertEqual(exit_.at_us, CONTROL_SEED_START_US + 1302*HOUR_US)
        self.assertEqual(entry.episode_id, exit_.episode_id)
        self.assertEqual(entry.model_id, 'btc_ema600_2pct_v1')
        self.assertNotEqual(entry.model_id, CONTROL_ID)
        with localcontext() as ctx:
            ctx.prec = 50
            expected_ema = D(100) + D(2) / D(601)
        self.assertEqual(entry.ema, expected_ema)

    def test_control_refuses_missing_original_seed_and_changed_source_pin(self):
        with self.assertRaises(ValueError):
            list(generate_control_signals(hours([100])))
        with patch('spot_rotation.strategy.CONTROL_SOURCE_SHA256', '0'*64):
            with self.assertRaises(ValueError):
                list(generate_control_signals([]))


if __name__ == '__main__':
    unittest.main()
