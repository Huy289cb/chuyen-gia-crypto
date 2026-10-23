"""One registered recovery entry diagnostic, never a financial backtest.

Three independent streaming 1m passes supply 5m/1h candles and delayed opens.
Accounts remain at 15 USDT/zero SOL: an admission is an independent empty-wallet
upper bound, not a fill, exit or PnL. No provider, network or broker is called.
"""
from __future__ import annotations
import time
MODULE_STARTED = time.monotonic()

import argparse
from collections import Counter, deque
from dataclasses import asdict
from datetime import datetime, timezone
from decimal import Decimal, localcontext
import hashlib
import json
from pathlib import Path
import resource
import sys
from typing import Any, Iterable, Iterator

from spot_aggressive_v3.account import ResearchAccount
from spot_aggressive_v3.dataset import iter_bars
from spot_backtest.models import Bar, HOUR_US, MINUTE_US
from .aggregation import aggregate_minutes, validate_minute
from .core import Evidence, Proposal, canonical, serial
from .recovery import MECHANISM_ID, RecoverySignal, generate_signals

D = Decimal
SCHEMA = "recovery5m-feasibility-v1"
EXPECTED_PARAMETERS = {
    "mechanism_id": "recovery5m_v1", "symbol": "SOLUSDT",
    "warmup_start_utc": "2023-04-01T00:00:00Z",
    "main_start_utc": "2024-01-01T00:00:00Z",
    "main_end_utc_exclusive": "2025-10-01T00:00:00Z",
    "initial_cash_usdt": "15", "initial_inventory_sol": "0",
    "independent_empty_wallet_per_episode": True,
    "max_cost_usdt": "12", "cash_reserve_usdt": "3",
    "risk_limit_usdt": "1.50", "daily_headroom_usdt": "1.50",
    "buy_fee_sol_fraction": "0.001", "sell_fee_usdt_fraction": "0.001",
    "min_notional_usdt": "5", "tick_usdt": "0.01", "step_sol": "0.001",
    "partial_fraction": "1", "wall_cap_seconds": 600,
    "quote_policy": "FIRST_1M_OPEN_AT_OR_AFTER_SIGNAL_PLUS_DELAY",
    "reference_minimum_policy": "QUANTITY_X_PRIOR_FIVE_COMPLETED_1M_VOLUME_WEIGHTED_PRICE_GE_5",
    "stop_policy": "SIGNAL_CLOSE_MINUS_2_ATR14_FLOORED_TO_TICK",
    "hurdle_policy": "SIGNAL_CLOSE_PLUS_4_ATR14_COST_DIAGNOSTIC_NOT_EXIT_TARGET",
    "exit_policy": None, "profitability": "NOT_MEASURED",
    "scenarios": [{"name": "base", "slip_fraction_per_side": "0.001", "delay_seconds": 30},
                  {"name": "stress", "slip_fraction_per_side": "0.003", "delay_seconds": 120}],
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def utc_us(value: str) -> int:
    date = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if date.tzinfo is None or date.utcoffset().total_seconds() != 0:
        raise ValueError("explicit UTC timestamp required")
    delta = date - datetime(1970, 1, 1, tzinfo=timezone.utc)
    return (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds


def iso(value: int) -> str:
    seconds, microseconds = divmod(value, 1_000_000)
    return datetime.fromtimestamp(seconds, timezone.utc).replace(microsecond=microseconds).isoformat()


def _source_paths() -> set[str]:
    backend = Path(__file__).resolve().parents[1]
    names = ("spot_selective_lab/__init__.py", "spot_selective_lab/aggregation.py",
             "spot_selective_lab/feasibility.py", "spot_selective_lab/core.py",
             "spot_selective_lab/recovery.py", "spot_aggressive_v3/__init__.py",
             "spot_aggressive_v3/account.py", "spot_aggressive_v3/dataset.py",
             "spot_backtest/__init__.py", "spot_backtest/account.py", "spot_backtest/models.py")
    return {str(backend / name) for name in names}


def _verify_pins(protocol: dict[str, Any]) -> None:
    pins = protocol.get("source_sha256")
    if not isinstance(pins, dict) or not _source_paths() <= set(pins):
        raise ValueError("registration must pin all runner, generator and planner dependencies")
    for name, expected in pins.items():
        if (not isinstance(name, str) or str(Path(name).resolve()) != name
                or not isinstance(expected, str) or len(expected) != 64
                or sha256(Path(name)) != expected):
            raise ValueError(f"registered source/dependency hash mismatch: {name}")
    data_dir = Path(protocol["data_dir"])
    if str(data_dir.resolve()) != protocol["data_dir"]:
        raise ValueError("absolute data directory required")
    if sha256(data_dir / "manifest.json") != protocol["manifest_sha256"]:
        raise ValueError("registered dataset manifest changed")
    manifest = json.loads((data_dir / "manifest.json").read_text())
    if manifest.get("status") != "COMPLETE_VERIFIED":
        raise ValueError("COMPLETE_VERIFIED dataset required")
    requested = manifest.get("requested_coverage", {})
    if (requested.get("start_us") != utc_us(EXPECTED_PARAMETERS["warmup_start_utc"])
            or requested.get("end_us_exclusive") != utc_us(EXPECTED_PARAMETERS["main_end_utc_exclusive"])):
        raise ValueError("dataset does not cover the exact registered warmup/main range")


def load_registration(path: Path, expected_sha256: str) -> dict[str, Any]:
    if sha256(path) != expected_sha256:
        raise ValueError("registration file hash differs from launch fingerprint")
    protocol = json.loads(path.read_text())
    if (protocol.get("schema_version") != SCHEMA or protocol.get("mode") != "F_ONLY_NO_OUTCOMES"
            or not isinstance(protocol.get("registration_id"), str) or not protocol["registration_id"]
            or canonical(protocol.get("parameters")) != canonical(EXPECTED_PARAMETERS)):
        raise ValueError("registration schema/mode or exact fixed parameters differ")
    registered_us = utc_us(protocol["registered_at_utc"])
    if registered_us > utc_us(datetime.now(timezone.utc).isoformat()):
        raise ValueError("registration timestamp is in the future")
    _verify_pins(protocol)
    return protocol


def signal_to_proposal(signal: RecoverySignal, source_sha256: str | None = None) -> Proposal:
    """Trusted adapter preserves identity and exact closed-context availability.

The source hash identifies the actual local generator, not a profitable strategy
or cryptographic authentication of arbitrary caller-created RecoverySignals.
"""
    source = Path(__file__).with_name("recovery.py")
    actual_sha256 = sha256(source)
    if source_sha256 is not None and source_sha256 != actual_sha256:
        raise ValueError("recovery generator source differs from registered adapter")
    if (signal.mechanism_id != MECHANISM_ID or not signal.signal_id or not signal.episode_id
            or type(signal.signal_us) is not int or signal.signal_us < 0
            or signal.signal_us % (5 * MINUTE_US) or signal.target is not None):
        raise ValueError("invalid recovery identity, closed5m time or target")
    for key, duration in (("context1h_close_us", HOUR_US), ("context4h_close_us", 4 * HOUR_US)):
        close_us = signal.evidence.get(key)
        if type(close_us) is not int or close_us != signal.signal_us // duration * duration - 1:
            raise ValueError("recovery context is future-dated, stale or unavailable")
    if (any(not isinstance(value, D) or not value.is_finite() for value in
            (signal.reference, signal.stop, signal.hurdle))
            or not D(0) < signal.stop < signal.reference < signal.hurdle
            or signal.evidence.get("hurdle_role") != "cost_diagnostic_only"):
        raise ValueError("invalid recovery reference, stop or diagnostic hurdle")
    values = {**signal.evidence, "generator_source_sha256": actual_sha256,
              "source_status": "RESEARCH_ONLY", "financial_outcomes_present": False}
    serial(values)
    return Proposal(signal.signal_id, signal.mechanism_id, signal.episode_id, "SOLUSDT",
                    signal.signal_us, signal.reference, signal.stop, signal.hurdle, None,
                    (Evidence("recovery:" + signal.episode_id, signal.signal_us, values),))


def _deadline(deadline: float) -> None:
    if time.monotonic() >= deadline:
        raise TimeoutError("registered 600 second startup-and-scan wall cap reached")


def checked_stream(bars: Iterable[Bar], start_us: int, end_us: int, duration_us: int,
                   deadline: float, metrics: Counter, label: str) -> Iterator[Bar]:
    """Full coverage and contiguous endpoints, including empty/truncated streams."""
    expected = start_us
    for index, bar in enumerate(bars):
        if index % 512 == 0:
            _deadline(deadline)
        if (bar.open_us != expected or bar.close_us + 1 != expected + duration_us
                or bar.open_us >= end_us):
            raise ValueError(f"{label}: unexpected open/close or coverage")
        expected += duration_us
        metrics[label] += 1
        yield bar
    if expected != end_us:
        raise ValueError(f"{label}: empty or incomplete trailing coverage")
    _deadline(deadline)


class QuoteCursor:
    """Delayed open and WAP from the five minutes completed before that open.

Current candle H/L/close/volume/trades never enter the quote or WAP returned.
The caller exhausts this stream to validate the suffix after its last candidate.
"""
    def __init__(self, bars: Iterable[Bar]):
        self.bars = iter(bars)
        self.current: Bar | None = None
        self.previous: Bar | None = None
        self.history: deque[Bar] = deque(maxlen=5)
        self.exhausted = False
        self.last_due_us = -1

    def _advance(self) -> None:
        if self.current is not None:
            self.history.append(self.current)
        bar = next(self.bars, None)
        if bar is not None:
            validate_minute(bar, self.previous)
            self.previous = bar
        else:
            self.exhausted = True
        self.current = bar

    def at_or_after(self, due_us: int) -> dict[str, Any] | None:
        if type(due_us) is not int or due_us < 0 or due_us < self.last_due_us:
            raise ValueError("nonnegative monotonically increasing quote cutoff required")
        self.last_due_us = due_us
        while not self.exhausted and (self.current is None or self.current.open_us < due_us):
            self._advance()
        bar = self.current
        if bar is None:
            return None
        with localcontext() as context:
            context.prec = 50
            volume = sum((value.volume for value in self.history), D(0))
            quote_volume = sum((value.quote_volume for value in self.history), D(0))
            valid = len(self.history) == 5 and volume > 0
            wap = quote_volume / volume if valid else None
        return {"symbol": "SOLUSDT", "reference": bar.open, "available_us": bar.open_us,
                "snapshot_id": f"SOLUSDT:1m-open:{bar.open_us}",
                "prior_completed_minutes": len(self.history),
                "wap5m": wap, "wap5m_volume_sol": volume,
                "wap5m_quote_volume_usdt": quote_volume,
                "wap5m_first_open_us": self.history[0].open_us if self.history else None,
                "wap5m_last_close_us": self.history[-1].close_us if self.history else None}

    def validate_suffix(self) -> None:
        while not self.exhausted:
            self._advance()


def diagnose(proposal: Proposal, quote: dict[str, Any] | None, account: ResearchAccount,
             delay_seconds: int) -> dict[str, Any]:
    """Pure planning plus explicit reference-minimum gate, no ledger mutation."""
    if (account.initial_cash != D(15) or account.cash != D(15) or account.inventory != 0
            or account.events or account.partial_fraction != 1):
        raise ValueError("diagnostic requires unchanged independent 15 USDT empty-wallet scenario")
    base = {"candidate_id": proposal.candidate_id, "episode_id": proposal.episode_id,
            "symbol": proposal.symbol, "mechanism_id": proposal.mechanism_id,
            "signal_us": proposal.signal_us, "signal_utc": iso(proposal.signal_us),
            "signal_reference": proposal.reference, "stop": proposal.stop,
            "hurdle": proposal.hurdle, "target": None,
            "hurdle_is_exit_target": False,
            "evidence": [asdict(item) for item in proposal.evidence],
            "quote": quote, "planner_admissible": False, "admissible": False,
            "reference_minimum": None, "plan": None,
            "profitability": "NOT_MEASURED", "fills": 0, "execution_permitted": False,
            "independent_empty_wallet_per_episode": True}
    if quote is None:
        return {**base, "reasons": ["NO_QUOTE_WITHIN_COVERAGE"]}
    due_us = proposal.signal_us + delay_seconds * 1_000_000
    earliest_us = ((due_us + MINUTE_US - 1) // MINUTE_US) * MINUTE_US
    if (quote["symbol"] != proposal.symbol or quote["available_us"] != earliest_us
            or not D(0) < quote["reference"]):
        raise ValueError("quote is not the earliest known1m open at/after registered delay")
    plan = account.plan_entry(quote["reference"], proposal.stop, None, D("1.50"),
                              D("1.50"), proposal.hurdle)
    reasons = list(plan["reasons"])
    minimum = {"policy": "CONDITIONAL_PRIOR5_COMPLETED_1M_WAP_PROXY",
               "exchange_historical_filter_verified": False, "eligible": False,
               "quantity_x_wap_usdt": None, "min_notional_usdt": account.min_notional}
    if plan["eligible"]:
        wap = quote["wap5m"]
        if wap is None or quote["prior_completed_minutes"] != 5:
            reasons.append("REFERENCE_MINIMUM_UNKNOWN_OR_INCOMPLETE")
        else:
            if (quote["wap5m_last_close_us"] != quote["available_us"] - 1
                    or quote["wap5m_first_open_us"] != quote["available_us"] - 5 * MINUTE_US):
                raise ValueError("reference minimum proxy contains future or noncontiguous minutes")
            with localcontext() as context:
                context.prec = 50
                conditional_notional = plan["quantity"] * wap
            minimum["quantity_x_wap_usdt"] = conditional_notional
            minimum["eligible"] = conditional_notional >= account.min_notional
            if not minimum["eligible"]:
                reasons.append("REFERENCE_MINIMUM_BELOW_5_USDT")
    return {**base, "plan": plan, "planner_admissible": plan["eligible"],
            "reference_minimum": minimum, "admissible": not reasons,
            "reasons": sorted(set(reasons))}


def _save(path: Path, value: Any) -> None:
    path.write_text(json.dumps(serial(value), indent=2, sort_keys=True) + "\n")


def run_registered(protocol_path: Path, expected_sha256: str, output_dir: Path,
                   *, started: float | None = None) -> dict[str, Any]:
    started = time.monotonic() if started is None else started
    deadline = started + EXPECTED_PARAMETERS["wall_cap_seconds"]
    output_dir.mkdir(parents=True, exist_ok=False)
    began_utc = datetime.now(timezone.utc).isoformat()
    terminal: dict[str, Any] = {"schema_version": SCHEMA, "mode": "F_ONLY_NO_OUTCOMES",
                              "status": "INCOMPLETE", "started_at_utc": began_utc,
                              "protocol_path": str(protocol_path.resolve()),
                              "protocol_sha256": expected_sha256,
                              "profitability": "NOT_MEASURED", "financial_backtest_performed": False,
                              "provider_calls": 0, "network_calls": 0, "fills": 0,
                              "cash_unchanged": True, "inventory_unchanged": True,
                              "counts_are_empty_wallet_upper_bounds_not_fills": True,
                              "retrospective_history_not_fresh_holdout": True,
                              "parameters": EXPECTED_PARAMETERS, "episodes": 0,
                              "stream_rows": {}, "scenarios": {}}
    metrics: Counter = Counter()
    accounts: dict[str, ResearchAccount] = {}
    totals = {case["name"]: {"episodes": 0, "planner_admissible": 0, "admissible": 0,
                            "reasons": Counter(), "months": {}}
              for case in EXPECTED_PARAMETERS["scenarios"]}
    for result in totals.values():
        for year in (2024, 2025):
            for month in range(1, 13 if year == 2024 else 10):
                result["months"][f"{year}-{month:02d}"] = {
                    "episodes": 0, "planner_admissible": 0, "admissible": 0, "reasons": Counter()}
    try:
        _deadline(deadline)
        protocol = load_registration(protocol_path, expected_sha256)
        _save(output_dir / "registration.json", protocol)
        terminal["registration_id"] = protocol["registration_id"]
        data_dir = Path(protocol["data_dir"])
        first_us = utc_us(EXPECTED_PARAMETERS["warmup_start_utc"])
        start_us = utc_us(EXPECTED_PARAMETERS["main_start_utc"])
        end_us = utc_us(EXPECTED_PARAMETERS["main_end_utc_exclusive"])
        def bars(interval: str, start: int, label: str) -> Iterator[Bar]:
            duration = MINUTE_US if interval == "1m" else 4 * HOUR_US
            return checked_stream(iter_bars(data_dir, "SOLUSDT", interval, start, end_us),
                                  start, end_us, duration, deadline, metrics, label)
        sol5m = aggregate_minutes(bars("1m", first_us, "SOL1m_to5m"), 5 * MINUTE_US)
        sol1h = aggregate_minutes(bars("1m", first_us, "SOL1m_to1h"), HOUR_US)
        signals = generate_signals(sol5m, sol1h, bars("4h", first_us, "SOL4h_context"))
        quotes = QuoteCursor(bars("1m", start_us - 5 * MINUTE_US, "SOL1m_quotes"))
        generator_path = str(Path(__file__).with_name("recovery.py").resolve())
        generator_hash = protocol["source_sha256"][generator_path]
        accounts = {case["name"]: ResearchAccount(slip=D(case["slip_fraction_per_side"]),
                                                 buy_fee=D(".001"), sell_fee=D(".001"))
                    for case in EXPECTED_PARAMETERS["scenarios"]}
        previous_signal_us = -1
        handles = {name: (output_dir / f"{name}-episodes.jsonl").open("x") for name in accounts}
        try:
            for signal in signals:
                _deadline(deadline)
                if signal.signal_us < start_us or signal.signal_us >= end_us:
                    continue
                if signal.signal_us <= previous_signal_us:
                    raise ValueError("duplicate or unordered recovery episode")
                previous_signal_us = signal.signal_us
                proposal = signal_to_proposal(signal, generator_hash)
                terminal["episodes"] += 1
                month = iso(signal.signal_us)[:7]
                for case in EXPECTED_PARAMETERS["scenarios"]:
                    name = case["name"]
                    quote = quotes.at_or_after(signal.signal_us + case["delay_seconds"] * 1_000_000)
                    row = {"scenario": name, **diagnose(proposal, quote, accounts[name], case["delay_seconds"])}
                    handles[name].write(canonical(row) + "\n")
                    handles[name].flush()
                    for group in (totals[name], totals[name]["months"][month]):
                        group["episodes"] += 1
                        group["planner_admissible"] += int(row["planner_admissible"])
                        group["admissible"] += int(row["admissible"])
                        group["reasons"].update(row["reasons"])
            quotes.validate_suffix()
        finally:
            for handle in handles.values():
                handle.close()
        _verify_pins(protocol)
        if sha256(protocol_path) != expected_sha256:
            raise ValueError("launch registration changed during scan")
        _deadline(deadline)
        if any(account.cash != D(15) or account.inventory != 0 or account.events for account in accounts.values()):
            raise ValueError("diagnostic ledger was unexpectedly mutated")
        terminal["status"] = "COMPLETE"
        terminal["input_integrity"] = "PASS_FULL_SELECTED_STREAMS_EXHAUSTED_AND_PINNED"
    except Exception as exc:
        terminal["status"] = "INCOMPLETE" if isinstance(exc, TimeoutError) else "FAILED"
        terminal["error"] = {"type": type(exc).__name__, "message": str(exc)}
        terminal["partial_counts_invalid_for_strategy_conclusion"] = True
        terminal["input_integrity"] = "NOT_ESTABLISHED"
    terminal["cash_unchanged"] = all(account.cash == D(15) for account in accounts.values())
    terminal["inventory_unchanged"] = all(account.inventory == 0 for account in accounts.values())
    terminal["ledger_events"] = sum(len(account.events) for account in accounts.values())
    terminal["stream_rows"] = dict(metrics)
    terminal["scenarios"] = totals
    terminal["elapsed_seconds"] = format(D(str(time.monotonic() - started)), "f")
    terminal["finished_at_utc"] = datetime.now(timezone.utc).isoformat()
    terminal["peak_process_rss_KiB"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    terminal["python_version"] = sys.version
    terminal["accounts_final"] = {name: {"cash_usdt": account.cash,
                                         "inventory_sol": account.inventory,
                                         "ledger_events": len(account.events)}
                                  for name, account in accounts.items()}
    terminal["episode_artifacts"] = {str(path.name): {"sha256": sha256(path), "bytes": path.stat().st_size}
                                     for path in sorted(output_dir.glob("*-episodes.jsonl"))}
    _save(output_dir / "summary.json", terminal)
    return serial(terminal)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", required=True, type=Path)
    parser.add_argument("--protocol-sha256", required=True)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    result = run_registered(args.protocol, args.protocol_sha256, args.output_dir, started=MODULE_STARTED)
    print(json.dumps({key: result[key] for key in ("status", "episodes", "elapsed_seconds", "profitability")}), flush=True)
    raise SystemExit(0 if result["status"] == "COMPLETE" else 2)


if __name__ == "__main__":
    main()
