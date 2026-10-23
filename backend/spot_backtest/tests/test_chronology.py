"""Synthetic chronology invariants; no historical data or strategy returns."""
from dataclasses import replace
from datetime import datetime, timezone
from decimal import Decimal
import unittest

from spot_backtest.features import generate_signals
from spot_backtest.models import Bar, MINUTE_US
from spot_backtest.features import Signal
from spot_backtest.runner import Case, run_replay, utc_us

D = Decimal
START_US = int(datetime(2026, 4, 1, tzinfo=timezone.utc).timestamp()) * 1_000_000
INTERVAL_US = 15 * MINUTE_US


def candles(count=112, price="10", high="11", low="9"):
    result = []
    for i in range(count):
        opened = START_US + i * INTERVAL_US
        result.append(Bar(opened, opened + INTERVAL_US - 1, D(price), D(high),
                          D(low), D(price), D("100"), D("1000"), 10))
    return result


def set_bar(bars, i, close, high, low):
    bars[i] = replace(bars[i], open=D(close), close=D(close), high=D(high), low=D(low))


def fixture(retest_age=1, count=112):
    sol = candles(count)
    btc = candles(count, price="100", high="101", low="99")
    breakout_i = 84  # Twenty complete closed hours of context already exist.
    set_bar(sol, breakout_i, "12", "13", "10")
    for age in range(1, min(retest_age, 9)):
        set_bar(sol, breakout_i + age, "12", "12.5", "11.2")
    if retest_age is not None:
        set_bar(sol, breakout_i + retest_age, "11.5", "12", "11")
    return sol, btc, breakout_i


def from_breakout(signals, sol, breakout_i):
    return [s for s in signals if s.breakout_us == sol[breakout_i].close_us]


class FeatureChronologyTests(unittest.TestCase):
    def test_breakout_low_is_not_its_own_retest(self):
        sol, btc, i = fixture(retest_age=9)
        self.assertEqual(from_breakout(list(generate_signals(sol, btc)), sol, i), [])

    def test_eighth_followup_is_eligible_but_ninth_is_not(self):
        sol, btc, i = fixture(retest_age=8)
        found = from_breakout(list(generate_signals(sol, btc)), sol, i)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0].at_us, sol[i + 8].close_us + 1)
        self.assertTrue(found[0].context_ok)
        sol9, btc9, i9 = fixture(retest_age=9)
        self.assertEqual(from_breakout(list(generate_signals(sol9, btc9)), sol9, i9), [])

    def test_prior_close_exactly_level_permanently_invalidates(self):
        sol, btc, i = fixture(retest_age=2)
        set_bar(sol, i + 1, "11", "12", "10.5")
        self.assertEqual(from_breakout(list(generate_signals(sol, btc)), sol, i), [])

    def test_reference_excludes_breakout_high(self):
        sol, btc, i = fixture()
        found = from_breakout(list(generate_signals(sol, btc)), sol, i)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0].level, D("11"))
        self.assertNotEqual(found[0].level, sol[i].high)

    def test_first_retest_context_rejection_cannot_retry(self):
        sol, btc, i = fixture()
        for j in range(80, 84):
            set_bar(btc, j, "90", "101", "89")
        for j in range(84, 88):
            set_bar(btc, j, "110", "111", "99")
        for j in range(i + 2, i + 5):
            set_bar(sol, j, "12", "12.5", "11.2")
        set_bar(sol, i + 5, "11.5", "12", "11")
        found = from_breakout(list(generate_signals(sol, btc)), sol, i)
        self.assertEqual(len(found), 1)
        self.assertFalse(found[0].context_ok)
        self.assertEqual(found[0].reason, "CONTEXT_BELOW_SMA20")
        self.assertEqual(found[0].at_us, sol[i + 1].close_us + 1)

    def test_partial_hour_is_not_context(self):
        sol, btc, i = fixture()
        for j in range(84, 88):
            set_bar(btc, j, "10", "101", "9")
        found = from_breakout(list(generate_signals(sol, btc)), sol, i)
        self.assertEqual(len(found), 1)
        self.assertTrue(found[0].context_ok)
        self.assertEqual(found[0].btc_hour_close_us, btc[83].close_us)
        self.assertEqual(found[0].sol_hour_close_us, sol[83].close_us)
        self.assertLess(found[0].btc_hour_close_us, found[0].at_us)

    def test_exactly_closed_hour_can_be_context(self):
        sol, btc, i = fixture(retest_age=3)
        found = from_breakout(list(generate_signals(sol, btc)), sol, i)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0].btc_hour_close_us, btc[i + 3].close_us)
        self.assertEqual(found[0].sol_hour_close_us, sol[i + 3].close_us)
        self.assertTrue(found[0].context_ok)

    def test_missing_context_warmup_is_consumed_rejection(self):
        sol, btc, _ = fixture()
        set_bar(sol, 24, "12", "13", "10")
        set_bar(sol, 25, "11.5", "12", "11")
        found = from_breakout(list(generate_signals(sol, btc)), sol, 24)
        self.assertEqual(len(found), 1)
        self.assertFalse(found[0].context_ok)
        self.assertEqual(found[0].reason, "CONTEXT_WARMUP_MISSING")

    def test_concurrent_newest_selected_older_consumed(self):
        sol, btc, i = fixture()
        set_bar(sol, i + 1, "14", "15", "12")
        set_bar(sol, i + 2, "14.4", "15", "10.9")
        set_bar(sol, i + 3, "14", "15", "10.9")
        signals = list(generate_signals(sol, btc))
        simultaneous = [s for s in signals if s.at_us == sol[i + 2].close_us + 1]
        self.assertEqual(len(simultaneous), 2)
        self.assertEqual(simultaneous[0].breakout_us, sol[i + 1].close_us)
        self.assertTrue(simultaneous[0].context_ok)
        self.assertEqual(simultaneous[1].breakout_us, sol[i].close_us)
        self.assertFalse(simultaneous[1].context_ok)
        self.assertEqual(simultaneous[1].reason, "CONCURRENT_SETUP_CONSUMED")
        self.assertEqual(len(from_breakout(signals, sol, i)), 1)
        self.assertEqual(len(from_breakout(signals, sol, i + 1)), 1)

    def test_future_values_do_not_change_signal_prefix_or_levels(self):
        sol, btc, i = fixture()
        prefix_size = i + 2
        expected = list(generate_signals(sol[:prefix_size], btc[:prefix_size]))
        altered_sol, altered_btc = list(sol), list(btc)
        for j in range(prefix_size, len(sol)):
            set_bar(altered_sol, j, "9999", "10000", "0.01")
            set_bar(altered_btc, j, "1", "10000", "0.01")
        cutoff = sol[prefix_size - 1].close_us + 1
        actual = [s for s in generate_signals(altered_sol, altered_btc) if s.at_us <= cutoff]
        self.assertEqual(actual, expected)
        chosen = from_breakout(actual, sol, i)[0]
        self.assertEqual(chosen.reference, sol[i + 1].close)
        raw_target = chosen.reference + D(2) * (chosen.reference - chosen.stop)
        self.assertLessEqual(chosen.target, raw_target)
        self.assertLess(raw_target - chosen.target, D("0.01"))

    def test_zero_volume_does_not_create_undeclared_volume_gate(self):
        sol, btc, i = fixture()
        sol[i + 1] = replace(sol[i + 1], volume=D("0"), quote_volume=D("0"), trades=0)
        found = from_breakout(list(generate_signals(sol, btc)), sol, i)
        self.assertEqual(len(found), 1)
        self.assertTrue(found[0].context_ok)

    def test_equivalent_decimal_precision_preserves_setup_id(self):
        sol, btc, i = fixture()
        canonical = from_breakout(list(generate_signals(sol, btc)), sol, i)[0]
        alternate = [replace(b, open=b.open.quantize(D("0.00000001")),
                             high=b.high.quantize(D("0.00000001")),
                             low=b.low.quantize(D("0.00000001")),
                             close=b.close.quantize(D("0.00000001"))) for b in sol]
        equivalent = from_breakout(list(generate_signals(alternate, btc)), alternate, i)[0]
        self.assertEqual(canonical.level, equivalent.level)
        self.assertEqual(canonical.setup_id, equivalent.setup_id)


def minute_bars(count, start=START_US):
    """Include the required five closed, volume-valid warmup bars."""
    return [Bar(start + i * MINUTE_US, start + (i + 1) * MINUTE_US - 1,
                D("100"), D("101"), D("99"), D("100"),
                D("100"), D("10000"), 10) for i in range(-5, count)]


def minute_replace(bars, offset, *, opened="100", high="101", low="99", close="100"):
    index = offset + 5
    bars[index] = replace(bars[index], open=D(opened), high=D(high), low=D(low), close=D(close))


def synthetic_signal(at, ident="first", breakout=None):
    return Signal(ident, at, START_US if breakout is None else breakout,
                  D("99"), D("100"), D("98"), D("104"), D("4"), True,
                  "ELIGIBLE_CONTEXT", at - MINUTE_US, at - MINUTE_US)


class RunnerChronologyTests(unittest.TestCase):
    def replay(self, bars, signals, count, start=START_US, delay=30):
        return run_replay(bars, signals, Case("synthetic", slip=D("0"), delay_seconds=delay),
                          start, start + count * MINUTE_US)

    def buys(self, result):
        return [e for e in result["events"] if e["side"] == "BUY"]

    def sells(self, result):
        return [e for e in result["events"] if e["side"] == "SELL"]

    def test_delay_uses_next_eligible_minute_open(self):
        for delay, expected_minute in ((30, 16), (120, 17)):
            with self.subTest(delay=delay):
                result = self.replay(minute_bars(25), [synthetic_signal(START_US + 15 * MINUTE_US)],
                                     25, delay=delay)
                self.assertEqual(len(self.buys(result)), 1)
                self.assertEqual(self.buys(result)[0]["timestamp_us"],
                                 START_US + expected_minute * MINUTE_US)

    def test_pending_and_owned_position_each_occupy_sole_slot(self):
        signals = [synthetic_signal(START_US + 15 * MINUTE_US),
                   synthetic_signal(START_US + 15 * MINUTE_US + 30_000_000, "while_pending"),
                   synthetic_signal(START_US + 20 * MINUTE_US, "while_owned")]
        result = self.replay(minute_bars(30), signals, 30)
        self.assertEqual([e["setup_id"] for e in self.buys(result)], ["first"])
        for ident in ("while_pending", "while_owned"):
            rejected = [e for e in result["decisions"] if e["setup_id"] == ident]
            self.assertEqual(len(rejected), 1)
            self.assertEqual(rejected[0]["reason"], "POSITION_OR_PENDING_OCCUPIED")

    def test_duplicate_setup_never_attempted_again(self):
        result = self.replay(minute_bars(30),
                             [synthetic_signal(START_US + 15 * MINUTE_US),
                              synthetic_signal(START_US + 20 * MINUTE_US)], 30)
        self.assertEqual(len(self.buys(result)), 1)
        duplicates = [e for e in result["decisions"] if e.get("reason") == "DUPLICATE_SETUP"]
        self.assertEqual(len(duplicates), 1)

    def test_target_is_fixed_from_signal_not_rebuilt_from_future_entry(self):
        bars = minute_bars(25)
        minute_replace(bars, 16, opened="102", high="103", low="101", close="102")
        minute_replace(bars, 17, opened="102", high="105", low="101", close="104")
        result = self.replay(bars, [synthetic_signal(START_US + 15 * MINUTE_US)], 25)
        buy_decision = [e for e in result["decisions"] if e["decision"] == "BUY"]
        self.assertEqual(len(buy_decision), 1)
        self.assertEqual(buy_decision[0]["stop"], D("98"))
        self.assertEqual(buy_decision[0]["target"], D("104"))
        self.assertEqual(self.sells(result)[0]["price"], D("104"))
        self.assertEqual(self.sells(result)[0]["timestamp_us"], bars[17 + 5].close_us)

    def test_invalid_delayed_entry_does_not_search_later_good_price(self):
        for entry in ("105", "97"):
            with self.subTest(entry=entry):
                bars = minute_bars(25)
                minute_replace(bars, 16, opened=entry, high=str(D(entry) + 1),
                               low=str(D(entry) - 1), close=entry)
                result = self.replay(bars, [synthetic_signal(START_US + 15 * MINUTE_US)], 25)
                self.assertEqual(self.buys(result), [])
                skips = [e for e in result["decisions"] if e["decision"] == "SKIP"]
                self.assertEqual(len(skips), 1)
                self.assertEqual(skips[0]["timestamp_us"], START_US + 16 * MINUTE_US)

    def test_expiry_minute_exits_at_open_before_later_target_high(self):
        bars = minute_bars(1470)
        expiry_minute = 16 + 24 * 60
        minute_replace(bars, expiry_minute, high="105", low="99", close="104")
        result = self.replay(bars, [synthetic_signal(START_US + 15 * MINUTE_US)], 1470)
        sells = self.sells(result)
        self.assertEqual(len(sells), 1)
        self.assertEqual(sells[0]["reason"], "TIME_24H")
        self.assertEqual(sells[0]["timestamp_us"], START_US + expiry_minute * MINUTE_US)
        self.assertEqual(sells[0]["price"], D("100"))

    def test_unknown_intrabar_order_uses_stop_first(self):
        bars = minute_bars(25)
        minute_replace(bars, 16, high="105", low="97", close="100")
        result = self.replay(bars, [synthetic_signal(START_US + 15 * MINUTE_US)], 25)
        sells = self.sells(result)
        self.assertEqual(len(sells), 1)
        self.assertEqual(sells[0]["reason"], "STOP")
        self.assertEqual(sells[0]["price"], D("98"))
        self.assertEqual(sells[0]["timestamp_us"], bars[16 + 5].close_us)

    def test_known_stop_gap_uses_worse_open(self):
        bars = minute_bars(25)
        minute_replace(bars, 17, opened="90", high="105", low="89", close="100")
        result = self.replay(bars, [synthetic_signal(START_US + 15 * MINUTE_US)], 25)
        sell = self.sells(result)[0]
        self.assertEqual(sell["reason"], "STOP_GAP")
        self.assertEqual(sell["timestamp_us"], START_US + 17 * MINUTE_US)
        self.assertEqual(sell["price"], D("90"))

    def test_known_target_gap_precedes_later_stop_low(self):
        bars = minute_bars(25)
        minute_replace(bars, 17, opened="105", high="106", low="97", close="100")
        result = self.replay(bars, [synthetic_signal(START_US + 15 * MINUTE_US)], 25)
        sell = self.sells(result)[0]
        self.assertIn("TARGET", sell["reason"])
        self.assertEqual(sell["timestamp_us"], START_US + 17 * MINUTE_US)
        self.assertEqual(sell["price"], D("104"))

    def test_development_breakout_is_not_carried_to_oos(self):
        signal = synthetic_signal(START_US + 15 * MINUTE_US, breakout=START_US - 1)
        result = self.replay(minute_bars(25), [signal], 25)
        self.assertEqual(self.buys(result), [])
        self.assertEqual(result["decisions"], [])

    def test_month_boundary_preserves_owned_position_and_cash(self):
        start = utc_us("2026-04-30T23:40:00Z")
        first = synthetic_signal(start + 5 * MINUTE_US, breakout=start)
        second = synthetic_signal(utc_us("2026-05-01T00:05:00Z"), "after_month", breakout=start)
        result = self.replay(minute_bars(40, start), [first, second], 40, start=start)
        self.assertEqual(len(self.buys(result)), 1)
        self.assertEqual(len(self.sells(result)), 1)
        self.assertEqual(self.sells(result)[0]["reason"], "END_OF_DATA")
        self.assertEqual(self.sells(result)[0]["cash_before"], self.buys(result)[0]["cash_after"])
        self.assertEqual([e["month"] for e in result["monthly"]], ["2026-04", "2026-05"])
        self.assertEqual(result["monthly"][1]["start_nav"], result["monthly"][0]["end_nav"])
        rejected = [e for e in result["decisions"] if e["setup_id"] == "after_month"]
        self.assertEqual(rejected[0]["reason"], "POSITION_OR_PENDING_OCCUPIED")

    def test_vietnam_midnight_preserves_owned_exposure(self):
        start = utc_us("2026-04-01T16:40:00Z")
        first = synthetic_signal(start + 5 * MINUTE_US, breakout=start)
        second = synthetic_signal(utc_us("2026-04-01T17:05:00Z"), "after_midnight", breakout=start)
        result = self.replay(minute_bars(40, start), [first, second], 40, start=start)
        self.assertEqual(len(self.buys(result)), 1)
        self.assertEqual([e["date_vn"] for e in result["daily"]], ["2026-04-01", "2026-04-02"])
        rejected = [e for e in result["decisions"] if e["setup_id"] == "after_midnight"]
        self.assertEqual(rejected[0]["reason"], "POSITION_OR_PENDING_OCCUPIED")

    def test_missing_reference_warmup_consumes_attempt(self):
        bars = minute_bars(25)[5:]
        signal = synthetic_signal(START_US)
        result = self.replay(bars, [signal], 25)
        self.assertEqual(self.buys(result), [])
        skipped = [e for e in result["decisions"] if e["decision"] == "SKIP"]
        self.assertEqual(len(skipped), 1)
        self.assertEqual(skipped[0]["reason"], "MISSING_REFERENCE_FILTER_INPUT")

    def test_pending_at_dataset_end_has_no_future_fill(self):
        signal = synthetic_signal(START_US + 24 * MINUTE_US)
        result = self.replay(minute_bars(25), [signal], 25)
        self.assertEqual(self.buys(result), [])
        skipped = [e for e in result["decisions"] if e["decision"] == "SKIP"]
        self.assertEqual(len(skipped), 1)
        self.assertEqual(skipped[0]["reason"], "PENDING_AT_END_OF_DATA")

    def test_pending_order_carries_across_month_and_vietnam_day(self):
        for start in (utc_us("2026-04-30T23:58:00Z"), utc_us("2026-04-01T16:58:00Z")):
            with self.subTest(start=start):
                first = synthetic_signal(start + MINUTE_US, breakout=start)
                second = synthetic_signal(start + 2 * MINUTE_US, "at_boundary", breakout=start)
                result = self.replay(minute_bars(10, start), [first, second], 10,
                                     start=start, delay=120)
                self.assertEqual(len(self.buys(result)), 1)
                self.assertEqual(self.buys(result)[0]["timestamp_us"], start + 3 * MINUTE_US)
                rejected = [e for e in result["decisions"] if e["setup_id"] == "at_boundary"]
                self.assertEqual(rejected[0]["reason"], "POSITION_OR_PENDING_OCCUPIED")

    def test_daily_loss_pause_blocks_new_entry_then_rolls_vietnam_day(self):
        bars = minute_bars(1040)
        minute_replace(bars, 17, opened="85", high="101", low="84", close="100")
        signals = [synthetic_signal(START_US + 15 * MINUTE_US),
                   synthetic_signal(START_US + 20 * MINUTE_US, "same_day"),
                   synthetic_signal(START_US + 1025 * MINUTE_US, "next_vietnam_day")]
        result = self.replay(bars, signals, 1040)
        self.assertEqual([e["setup_id"] for e in self.buys(result)],
                         ["first", "next_vietnam_day"])
        paused = [e for e in result["decisions"] if e["setup_id"] == "same_day"]
        self.assertEqual(len(paused), 1)
        self.assertEqual(paused[0]["reason"], "DAILY_PAUSE")
        self.assertEqual(self.sells(result)[0]["reason"], "STOP_GAP")

    def test_partial_inventory_below_minimum_never_gets_fabricated_exit(self):
        bars = minute_bars(30)
        minute_replace(bars, 17, high="100", low="97", close="99")
        signals = [synthetic_signal(START_US + 15 * MINUTE_US),
                   synthetic_signal(START_US + 20 * MINUTE_US, "after_blocked_exit")]
        case = Case("synthetic_partial", slip=D("0"), delay_seconds=30,
                    min_notional=D("10"), partial_fraction=D("0.50"))
        result = run_replay(bars, signals, case, START_US, START_US + 30 * MINUTE_US)
        self.assertEqual(len(self.buys(result)), 1)
        self.assertEqual(self.sells(result), [])
        self.assertTrue(result["open_position_at_end"])
        self.assertGreater(result["final_inventory_sol"], D("0"))
        blocked = [e for e in result["decisions"] if e["decision"] == "EXIT_BLOCKED"]
        self.assertTrue(blocked)
        rejected = [e for e in result["decisions"] if e["setup_id"] == "after_blocked_exit"]
        self.assertEqual(rejected[0]["reason"], "POSITION_OR_PENDING_OCCUPIED")

    def test_reference_blocked_inventory_has_zero_executable_mark(self):
        # A quantity can pass the BUY reference minimum but fall below it after
        # base fee/LOT flooring. Large earlier volume keeps the causal 5m proxy
        # near76 despite an executable current-price stop/close near100.
        bars = minute_bars(2)
        for j in range(len(bars) - 1):
            bars[j] = replace(bars[j], open=D("76"), high=D("77"), low=D("75"),
                              close=D("76"), volume=D("1000000"), quote_volume=D("76000000"))
        minute_replace(bars, 1, opened="100", high="101", low="93", close="100")
        bars[-1] = replace(bars[-1], volume=D("1"), quote_volume=D("100"))
        signal = replace(synthetic_signal(START_US), stop=D("94"), target=D("112"))
        result = self.replay(bars, [signal], 2)
        self.assertEqual(len(self.buys(result)), 1)
        self.assertEqual(self.sells(result), [])
        blocked = [e for e in result["decisions"] if e["decision"] == "EXIT_BLOCKED"]
        self.assertTrue(blocked)
        self.assertEqual(blocked[0]["reason"], "exit_reference_minimum_or_unknown")
        self.assertTrue(result["open_position_at_end"])
        self.assertGreater(result["final_inventory_sol"], D("0"))
        self.assertEqual(result["final_executable_nav"], result["final_cash"])
        self.assertGreater(result["final_book_nav"], result["final_cash"])


if __name__ == "__main__":
    unittest.main()
