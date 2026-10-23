"""Causal diagnostic/planner/registration checks; no real market scan."""
from collections import Counter
from dataclasses import replace
from datetime import datetime, timezone
from decimal import Decimal
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from spot_aggressive_v3.account import ResearchAccount
from spot_backtest.models import Bar, HOUR_US, MINUTE_US
from spot_selective_lab.feasibility import (
    EXPECTED_PARAMETERS, SCHEMA, QuoteCursor, _source_paths, checked_stream,
    diagnose, load_registration, run_registered, sha256, signal_to_proposal, utc_us,
)
from spot_selective_lab.recovery import MECHANISM_ID, RecoverySignal

D = Decimal
START = 5 * HOUR_US


def candle(open_us, price="99", volume="10"):
    price, volume = D(price), D(volume)
    return Bar(open_us, open_us + MINUTE_US - 1, price, price + 1, price - 1, price,
               volume, volume * price, 1)


def signal():
    return RecoverySignal("candidate", "episode", MECHANISM_ID, START, D(99), D(96), D(110), None,
                          {"context1h_close_us": START - 1,
                           "context4h_close_us": 4 * HOUR_US - 1,
                           "hurdle_role": "cost_diagnostic_only", "rsi14": D(40)})


def bars():
    return [candle(START + i * MINUTE_US) for i in range(-5, 5)]


class FeasibilityTests(unittest.TestCase):
    def test_adapter_preserves_real_source_identity_closed_context_and_hurdle(self):
        proposal = signal_to_proposal(signal())
        self.assertEqual(proposal.candidate_id, "candidate")
        self.assertEqual(proposal.episode_id, "episode")
        self.assertEqual(proposal.signal_us, START)
        self.assertIsNone(proposal.target)
        self.assertEqual(proposal.evidence[0].available_us, START)
        actual = sha256(Path(__file__).parents[1] / "recovery.py")
        self.assertEqual(proposal.evidence[0].values["generator_source_sha256"], actual)
        self.assertFalse(proposal.evidence[0].values["financial_outcomes_present"])
        with self.assertRaises(ValueError):
            signal_to_proposal(signal(), "0" * 64)

    def test_adapter_future_stale_context_and_invalid_semantics_rejected(self):
        s = signal()
        changes = [{"signal_us": START + 1}, {"mechanism_id": "different"}, {"target": D(110)},
                   {"stop": D(100)}, {"reference": 99.0},
                   {"evidence": {**s.evidence, "context1h_close_us": START + HOUR_US - 1}},
                   {"evidence": {**s.evidence, "context4h_close_us": -1}},
                   {"evidence": {**s.evidence, "context1h_close_us": True}}]
        for change in changes:
            with self.subTest(change=change):
                with self.assertRaises(ValueError):
                    signal_to_proposal(replace(s, **change))

    def test_first_delayed_open_and_only_prior_five_minutes_wap(self):
        cursor = QuoteCursor(bars())
        base = cursor.at_or_after(START + 30_000_000)
        stress = cursor.at_or_after(START + 120_000_000)
        self.assertEqual(base["available_us"], START + MINUTE_US)
        self.assertEqual(stress["available_us"], START + 2 * MINUTE_US)
        self.assertEqual(base["wap5m"], D(99))
        self.assertEqual(base["wap5m_volume_sol"], D(50))
        self.assertEqual(base["wap5m_last_close_us"], base["available_us"] - 1)
        self.assertEqual(base["wap5m_first_open_us"], base["available_us"] - 5 * MINUTE_US)
        self.assertNotIn("high", base)
        self.assertNotIn("close", base)
        cursor.validate_suffix()

    def test_current_unfinished_minute_and_future_prices_do_not_change_quote(self):
        values = bars()
        expected = QuoteCursor(values).at_or_after(START + 30_000_000)
        values[6] = replace(values[6], high=D(999999), close=D(10000), volume=D(1000000),
                            quote_volume=D(999999999999))
        values[7:] = [replace(bar, high=D(999999)) for bar in values[7:]]
        got = QuoteCursor(values).at_or_after(START + 30_000_000)
        self.assertEqual(got, expected)

    def test_quote_suffix_gap_missing_quote_zero_volume_and_invalid_due(self):
        values = bars()
        cursor = QuoteCursor(values[:8] + values[9:])
        cursor.at_or_after(START + 30_000_000)
        with self.assertRaises(ValueError):
            cursor.validate_suffix()
        self.assertIsNone(QuoteCursor(values).at_or_after(START + 99 * MINUTE_US))
        zero = [replace(bar, volume=D(0), quote_volume=D(0)) for bar in values]
        self.assertIsNone(QuoteCursor(zero).at_or_after(START + 30_000_000)["wap5m"])
        for due in (-1, True, 1.0):
            with self.assertRaises(ValueError):
                QuoteCursor(values).at_or_after(due)

    def test_planner_and_reference_gate_leave_exact_cash_inventory_unchanged(self):
        proposal = signal_to_proposal(signal())
        quote = QuoteCursor(bars()).at_or_after(START + 30_000_000)
        account = ResearchAccount()
        with patch.object(account, "buy", side_effect=AssertionError("buy forbidden")), \
                patch.object(account, "sell", side_effect=AssertionError("sell forbidden")):
            row = diagnose(proposal, quote, account, 30)
        self.assertTrue(row["planner_admissible"])
        self.assertTrue(row["admissible"])
        self.assertFalse(row["hurdle_is_exit_target"])
        self.assertIsNone(row["plan"]["target"])
        self.assertEqual(row["profitability"], "NOT_MEASURED")
        self.assertEqual((account.cash, account.inventory, account.events), (D(15), D(0), []))

    def test_reference_minimum_is_separate_from_planner_and_missing_quote_explicit(self):
        proposal = signal_to_proposal(signal())
        account = ResearchAccount()
        quote = QuoteCursor(bars()).at_or_after(START + 30_000_000)
        for wap, reason in ((D(1), "REFERENCE_MINIMUM_BELOW_5_USDT"),
                            (None, "REFERENCE_MINIMUM_UNKNOWN_OR_INCOMPLETE")):
            row = diagnose(proposal, {**quote, "wap5m": wap}, account, 30)
            self.assertTrue(row["planner_admissible"])
            self.assertFalse(row["admissible"])
            self.assertIn(reason, row["reasons"])
        self.assertEqual(diagnose(proposal, None, account, 30)["reasons"], ["NO_QUOTE_WITHIN_COVERAGE"])
        with self.assertRaises(ValueError):
            diagnose(proposal, {**quote, "available_us": START + 2 * MINUTE_US}, account, 30)
        with self.assertRaises(ValueError):
            diagnose(proposal, {**quote, "wap5m_last_close_us": START + 2 * MINUTE_US}, account, 30)

    def test_empty_wallet_precondition_and_bad_planner_outcome(self):
        proposal = signal_to_proposal(signal())
        quote = QuoteCursor(bars()).at_or_after(START + 30_000_000)
        account = ResearchAccount()
        account.cash = D(14)
        with self.assertRaises(ValueError):
            diagnose(proposal, quote, account, 30)
        row = diagnose(replace(proposal, hurdle=D("99.01")), quote, ResearchAccount(), 30)
        self.assertFalse(row["planner_admissible"])
        self.assertFalse(row["admissible"])
        self.assertIn("invalid_entry_stop_hurdle", row["reasons"])

    def test_full_coverage_empty_truncated_and_cutoff(self):
        metrics = Counter()
        values = bars()
        self.assertEqual(list(checked_stream(values, values[0].open_us, values[-1].close_us + 1,
                                             MINUTE_US, time.monotonic() + 10, metrics, "test")), values)
        self.assertEqual(metrics["test"], 10)
        for broken in ([], values[:-1], values[:2] + values[3:]):
            with self.assertRaises(ValueError):
                list(checked_stream(broken, values[0].open_us, values[-1].close_us + 1,
                                    MINUTE_US, time.monotonic() + 10, Counter(), "test"))
        with self.assertRaises(TimeoutError):
            list(checked_stream(values, values[0].open_us, values[-1].close_us + 1,
                                MINUTE_US, time.monotonic() - 1, Counter(), "test"))

    def test_registration_exact_parameters_hashes_and_dependency_pins(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            data = root / "data"
            data.mkdir()
            manifest = {"status": "COMPLETE_VERIFIED", "requested_coverage": {
                "start_us": utc_us(EXPECTED_PARAMETERS["warmup_start_utc"]),
                "end_us_exclusive": utc_us(EXPECTED_PARAMETERS["main_end_utc_exclusive"])}}
            (data / "manifest.json").write_text(json.dumps(manifest))
            protocol = {"schema_version": SCHEMA, "mode": "F_ONLY_NO_OUTCOMES", "registration_id": "syntheticQA",
                        "registered_at_utc": datetime.now(timezone.utc).isoformat(), "data_dir": str(data),
                        "manifest_sha256": sha256(data / "manifest.json"),
                        "source_sha256": {path: sha256(Path(path)) for path in _source_paths()},
                        "parameters": EXPECTED_PARAMETERS}
            path = root / "protocol.json"
            def write(value):
                path.write_text(json.dumps(value))
                return sha256(path)
            self.assertEqual(load_registration(path, write(protocol)), protocol)
            with self.assertRaises(ValueError):
                load_registration(path, "0" * 64)
            for changed in ({**protocol, "parameters": {**EXPECTED_PARAMETERS, "wall_cap_seconds": 601}},
                            {**protocol, "parameters": {**EXPECTED_PARAMETERS, "wall_cap_seconds": 600.0}},
                            {**protocol, "source_sha256": {}},
                            {**protocol, "manifest_sha256": "0" * 64}):
                with self.subTest(changed=changed.keys()):
                    with self.assertRaises(ValueError):
                        load_registration(path, write(changed))

    def test_failed_or_cutoff_startup_records_terminal_and_never_reads_market(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            path = root / "missing.json"
            with patch("spot_selective_lab.feasibility.iter_bars", side_effect=AssertionError("market read forbidden")):
                failed = run_registered(path, "0" * 64, root / "failure")
                cutoff = run_registered(path, "0" * 64, root / "cutoff", started=time.monotonic() - 601)
            self.assertEqual(failed["status"], "FAILED")
            self.assertEqual(cutoff["status"], "INCOMPLETE")
            self.assertTrue(failed["partial_counts_invalid_for_strategy_conclusion"])
            self.assertEqual(failed["profitability"], "NOT_MEASURED")
            self.assertEqual(failed["fills"], 0)
            self.assertTrue((root / "failure" / "summary.json").is_file())
            with self.assertRaises(FileExistsError):
                run_registered(path, "0" * 64, root / "failure")


if __name__ == "__main__":
    unittest.main()
