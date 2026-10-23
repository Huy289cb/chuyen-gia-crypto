"""Report completed offline rules replays; no runner, market or provider calls."""

from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import math
from pathlib import Path
import random
from typing import Any, Mapping


D = Decimal
INITIAL = D("15")
DAY_US = D("86400000000")
CASES = ("base", "stress", "minimum10_base", "minimum10_stress",
         "partial50_base", "partial50_stress", "sep_standalone_base", "sep_standalone_stress")
SOURCES = (
    ("Binance public Spot archives, CHECKSUM và timestamp units", "https://github.com/binance/binance-public-data"),
    ("Binance Spot filters", "https://developers.binance.com/en/docs/products/spot/filters"),
    ("Binance commission", "https://developers.binance.com/en/docs/products/spot/faqs/commission_faq"),
    ("Binance MARKET fills", "https://developers.binance.com/en/docs/products/spot/faqs/market_orders_faq"),
    ("Binance reference price/execution rules", "https://developers.binance.com/en/docs/products/spot/faqs/price_range_execution_rules"),
)


def number(value: Any) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (str, int, Decimal)):
        raise ValueError("exact financial decimal missing")
    try:
        result = D(value)
    except (ValueError, InvalidOperation):
        raise ValueError("invalid financial decimal") from None
    if not result.is_finite():
        raise ValueError("nonfinite financial decimal")
    return result


def integer(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError("nonnegative integer missing")
    return value


def serial(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {key: serial(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [serial(item) for item in value]
    return value


def iso_us(value: Any) -> str:
    return datetime.fromtimestamp(integer(value) // 1_000_000, timezone.utc).isoformat()


def load(path: Path, errors: list[str]) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text())
        if not isinstance(value, dict):
            raise ValueError("JSON object required")
        return value
    except (OSError, ValueError) as exc:
        errors.append(f"{path.name}: {type(exc).__name__}")
        return None


def bootstrap_total(daily_pnl: list[Decimal], block_length: int,
                    samples: int = 2000, seed: int = 1729) -> dict[str, Any] | None:
    """Circular block bootstrap of marked daily PnL; diagnostic float arithmetic.

    Resampling PnL does not rerun the capital-dependent strategy or prove future
    profitability. Calendar observations can include partial boundary days.
    """
    if not daily_pnl:
        return None
    values = [float(value) for value in daily_pnl]
    if not all(math.isfinite(value) for value in values):
        raise ValueError("bootstrap finite values required")
    rng = random.Random(seed)
    n = len(values)
    totals = []
    for _ in range(samples):
        total, remaining = 0.0, n
        while remaining:
            start = rng.randrange(n)
            take = min(block_length, remaining)
            total += sum(values[(start + offset) % n] for offset in range(take))
            remaining -= take
        totals.append(total)
    totals.sort()

    def percentile(p: float) -> float:
        position = (samples - 1) * p
        low = int(position)
        fraction = position - low
        return totals[low] * (1.0 - fraction) + totals[min(low + 1, samples - 1)] * fraction

    return {"method": "circular_daily_pnl_blocks", "block_length_calendar_rows": block_length,
            "samples": samples, "seed": seed, "daily_rows": n,
            "total_pnl_ci95_usdt": [percentile(.025), percentile(.975)],
            "arithmetic": "float_diagnostic_only", "replays_strategy": False}


def summarize(raw: Mapping[str, Any]) -> dict[str, Any]:
    initial = number(raw["initial_cash"])
    if initial != INITIAL:
        raise ValueError("main/secondary scenario must initialize 15 USDT")
    net = number(raw["net_pnl"])
    final = number(raw["final_executable_nav"])
    if final - initial != net:
        raise ValueError("NAV/net reconciliation failed")
    start, end = integer(raw["start_us"]), integer(raw["end_us_exclusive"])
    duration = D(end - start) / DAY_US
    if duration <= 0:
        raise ValueError("invalid replay duration")
    trades, daily, monthly = raw["trades"], raw["daily"], raw["monthly"]
    if not all(isinstance(rows, list) for rows in (trades, daily, monthly)):
        raise ValueError("trade/daily/monthly rows missing")
    pnls = [number(trade["net_pnl"]) for trade in trades]
    wins, losses = [p for p in pnls if p > 0], [p for p in pnls if p < 0]
    positive, negative = sum(wins, D(0)), -sum(losses, D(0))
    closed = integer(raw["closed_trades"])
    if closed != len(trades) or len({trade["setup_id"] for trade in trades}) != closed:
        raise ValueError("closed setup count mismatch/duplicate")
    factor = positive / negative if negative else None
    factor_status = "FINITE" if negative else "INFINITE_NO_LOSSES" if positive else "UNDEFINED_NO_PROFIT"
    previous = initial
    for row in monthly:
        if number(row["start_nav"]) != previous or number(row["end_nav"]) - previous != number(row["net_pnl"]):
            raise ValueError("monthly ledger reset/reconciliation error")
        previous = number(row["end_nav"])
    if not monthly or previous != final:
        raise ValueError("monthly final NAV missing/mismatch")
    previous = initial
    daily_pnl = []
    for row in daily:
        value, change = number(row["end_nav"]), number(row["net_pnl"])
        if value - previous != change:
            raise ValueError("daily NAV reconciliation error")
        daily_pnl.append(change)
        previous = value
    if not daily or previous != final:
        raise ValueError("daily final NAV missing/mismatch")
    ai_calls, ai_cost = integer(raw["ai_calls"]), number(raw["ai_actual_cost"])
    if ai_calls != 0 or ai_cost != 0:
        raise ValueError("registered historical rules stage must have zero AI calls/cost")
    vps_incremental = raw.get("incremental_vps_cost")
    vps_full = raw.get("full_allocated_vps_cost")
    economic_net = None if vps_incremental is None else net - ai_cost - number(vps_incremental)
    full_economic = None if vps_full is None else net - ai_cost - number(vps_full)
    top3 = sum(sorted(wins, reverse=True)[:3], D(0))
    benchmark_receipts = raw.get("buy_hold_receipts", [])
    benchmark_buys = [receipt for receipt in benchmark_receipts if receipt.get("side") == "BUY" and receipt.get("eligible") is True]
    benchmark_valid = len(benchmark_buys) == 1
    if benchmark_valid:
        receipt = benchmark_buys[0]
        benchmark_valid = number(receipt["gross_quote"]) <= D("12") and number(receipt["cash_after"]) >= D("3")
    book = number(raw["final_book_nav"])
    sept = [row for row in monthly if row.get("month") == "2026-09"]
    return {"case": raw["case"], "start_us": start, "end_us_exclusive": end,
            "initial_cash_usdt": initial, "duration_full_utc_days": duration,
            "final_cash_usdt": number(raw["final_cash"]), "final_executable_nav_usdt": final,
            "final_book_nav_usdt": book, "book_minus_executable_usdt": book - final,
            "final_inventory_sol": number(raw["final_inventory_sol"]),
            "trading_net_usdt": net, "trading_return_percent": net / initial * D(100),
            "mean_trading_net_usdt_per_full_utc_day": net / duration,
            "incremental_vps_cost_usdt": None if vps_incremental is None else number(vps_incremental),
            "full_allocated_vps_cost_usdt": None if vps_full is None else number(vps_full),
            "economic_net_after_incremental_vps_usdt": economic_net,
            "economic_net_after_full_vps_usdt": full_economic,
            "ai_calls": ai_calls, "actual_ai_cost_usdt": ai_cost,
            "ai_fixed_cost_sensitivity_not_actual_usdt": {str(cost): net - cost for cost in (D('.10'), D('.25'), D('.50'))},
            "candidates": integer(raw["candidates"]), "context_eligible": integer(raw["context_eligible"]),
            "entries": integer(raw["entries"]), "closed_trades": closed,
            "open_position_at_end": raw["open_position_at_end"],
            "wins": len(wins), "losses": len(losses), "zero_pnl_trades": sum(p == 0 for p in pnls),
            "win_rate": D(len(wins)) / D(closed) if closed else None,
            "average_win_usdt": positive / D(len(wins)) if wins else None,
            "average_loss_usdt": -negative / D(len(losses)) if losses else None,
            "expectancy_per_closed_trade_usdt": sum(pnls, D(0)) / D(closed) if closed else None,
            "profit_factor": factor, "profit_factor_status": factor_status,
            "gross_winning_trade_pnl_usdt": positive, "gross_losing_trade_pnl_usdt": negative,
            "max_drawdown_usdt": number(raw["max_drawdown"]),
            "max_drawdown_percent": number(raw["max_drawdown_fraction"]) * D(100),
            "max_losing_streak": integer(raw["max_losing_streak"]),
            "minutes_exposed": integer(raw["minutes_exposed"]),
            "days_without_entry": integer(raw["days_without_entry"]),
            "buy_fee_sol": number(raw["buy_fee_sol"]), "sell_fee_usdt": number(raw["sell_fee_usdt"]),
            "skips": raw["skips"], "exit_reasons": raw["exit_reasons"],
            "top3_winner_sum_usdt": top3,
            "top3_share_of_gross_wins": top3 / positive if positive else None,
            "net_without_top3_winners_usdt": net - top3,
            "without_top3_is_attribution_not_strategy_rerun": True,
            "daily_rows_vn_including_partial_boundary_days": len(daily),
            "daily_positive_rows": sum(p > 0 for p in daily_pnl),
            "daily_negative_rows": sum(p < 0 for p in daily_pnl), "daily_zero_rows": sum(p == 0 for p in daily_pnl),
            "september_continuous_ledger_net_usdt": number(sept[0]["net_pnl"]) if len(sept) == 1 else None,
            "buy_hold_comparator_valid_12_plus_3": benchmark_valid,
            "buy_hold_net_usdt": number(raw["buy_hold_net_pnl"]) if benchmark_valid else None,
            "buy_hold_final_executable_nav_usdt": number(raw["buy_hold_final_nav"]) if benchmark_valid else None,
            "buy_hold_receipts": benchmark_receipts, "monthly": monthly,
            "bootstrap_diagnostic": {str(block): bootstrap_total(daily_pnl, block) for block in (1, 7)}}


def evaluate(execution: Mapping[str, Any] | None, registration: Mapping[str, Any] | None,
             metrics: Mapping[str, Any], input_errors: list[str]) -> dict[str, Any]:
    uncertainty, failures, gates = list(input_errors), [], {}
    if execution is None or execution.get("status") != "COMPLETE":
        uncertainty.append("Execution chưa COMPLETE; không chứng nhận kết quả toàn bộ phiên.")
    if registration is None:
        uncertainty.append("Thiếu run-registration trước OOS.")
    elif execution is not None:
        for key in ("protocol_sha256", "data_manifest_sha256", "source_sha256"):
            if not registration.get(key) or registration.get(key) != execution.get(key):
                uncertainty.append(f"Identity registration/execution không khớp: {key}.")
    if set(CASES) - set(metrics):
        uncertainty.append("Thiếu một hoặc nhiều main/sensitivity/secondary case hợp lệ.")
    base, stress = metrics.get("base"), metrics.get("stress")
    if base is not None and stress is not None:
        expected_start = int(datetime(2026, 4, 1, tzinfo=timezone.utc).timestamp()) * 1_000_000
        expected_end = int(datetime(2026, 10, 1, tzinfo=timezone.utc).timestamp()) * 1_000_000
        for name, case in (("base", base), ("stress", stress)):
            if (case["start_us"], case["end_us_exclusive"]) != (expected_start, expected_end):
                uncertainty.append(f"{name}: không phải full Apr–Sep stitched window 183 ngày UTC.")
            if case["open_position_at_end"]:
                uncertainty.append(f"{name}: inventory vị thế vẫn chưa thoát ở cuối dữ liệu.")
            if case["economic_net_after_incremental_vps_usdt"] is None or case["economic_net_after_full_vps_usdt"] is None:
                uncertainty.append(f"{name}: chi phí VPS incremental/full allocated chưa biết; economic PnL chưa đầy đủ.")
            if not case["buy_hold_comparator_valid_12_plus_3"]:
                uncertainty.append(f"{name}: buy-and-hold matching 12+3 chưa được xác nhận.")
            for block, interval in case["bootstrap_diagnostic"].items():
                if interval is None or interval["total_pnl_ci95_usdt"][0] <= 0:
                    uncertainty.append(f"{name}: CI diagnostic block {block} chưa có lower bound dương.")
            if case["trading_net_usdt"] > 0 and case["net_without_top3_winners_usdt"] <= 0:
                uncertainty.append(f"{name}: lợi nhuận phụ thuộc ba winner lớn nhất.")
        factor_ok = base["profit_factor_status"] == "INFINITE_NO_LOSSES" or (base["profit_factor"] is not None and base["profit_factor"] >= D("1.2"))
        gates = {"base_trading_net_positive": base["trading_net_usdt"] > 0,
                 "base_profit_factor_at_least_1_2": factor_ok,
                 "stress_trading_net_nonnegative": stress["trading_net_usdt"] >= 0,
                 "september_base_nonnegative": None if base["september_continuous_ledger_net_usdt"] is None else base["september_continuous_ledger_net_usdt"] >= 0,
                 "september_stress_nonnegative": None if stress["september_continuous_ledger_net_usdt"] is None else stress["september_continuous_ledger_net_usdt"] >= 0,
                 "base_max_drawdown_at_most_3_usdt": base["max_drawdown_usdt"] <= 3,
                 "stress_max_drawdown_at_most_3_usdt": stress["max_drawdown_usdt"] <= 3,
                 "base_closed_setups_at_least_30": base["closed_trades"] >= 30,
                 "stress_closed_setups_at_least_30": stress["closed_trades"] >= 30}
        for key, passed in gates.items():
            if passed is None:
                uncertainty.append(f"Thiếu metric gate {key}.")
            elif not passed:
                if "closed_setups" in key or (key == "base_trading_net_positive" and base["trading_net_usdt"] == 0):
                    uncertainty.append(f"Chưa đạt gate {key}.")
                elif key == "base_profit_factor_at_least_1_2" and not base["closed_trades"]:
                    uncertainty.append("Không có closed trade để đánh giá PF.")
                else:
                    failures.append(key)
        for name, case in (("base", base), ("stress", stress)):
            value = case["economic_net_after_incremental_vps_usdt"]
            if value is not None and (value <= 0 if name == "base" else value < 0):
                failures.append(f"{name}_net_after_known_incremental_vps_not_qualified")
    identity_matched = (registration is not None and execution is not None
                        and all(registration.get(key) and registration.get(key) == execution.get(key)
                                for key in ("protocol_sha256", "data_manifest_sha256", "source_sha256")))
    trustworthy = (execution is not None and execution.get("status") == "COMPLETE"
                   and identity_matched and not input_errors)
    if failures and trustworthy:
        verdict = "FAIL"
    elif uncertainty or failures or not gates:
        verdict = "INCONCLUSIVE"
    else:
        verdict = "PASS_PAPER_ONLY"
    return {"verdict": verdict, "live_authorized": False, "llm_edge_demonstrated": False,
            "historical_paid_ai_calls": 0, "scope": "offline_rules_only_conditional_historical_simulation",
            "gates": gates, "failed_gates": failures, "uncertainties": sorted(set(uncertainty)),
            "bootstrap_is_diagnostic_not_statistical_proof": True,
            "historical_fees_filters_reference_prices_verified": False,
            "metrics": metrics, "execution": execution,
            "registration_identity": None if registration is None else {key: registration.get(key) for key in ("registered_at_utc", "protocol_sha256", "data_manifest_sha256", "source_sha256")}}


def fmt(value: Any, places: int = 6) -> str:
    if value is None:
        return "unknown"
    if isinstance(value, Decimal):
        return format(value, f".{places}f")
    return str(value)


def markdown(result: Mapping[str, Any]) -> str:
    metrics, execution = result["metrics"], result["execution"] or {}
    lines = ["# Kết quả backtest Spot — bucket riêng 15 USDT", "",
             f"**Verdict: {result['verdict']}.** Không cho phép live. Đây là kết quả mô phỏng lịch sử rules-only, không phải giao dịch thật hoặc bằng chứng LLM chọn lệnh tốt hơn.", "",
             "Main base/stress là một ledger Apr–Sep liên tục, bắt đầu 15 USDT và không reset ví giữa tháng. Futures không nằm trong PnL, không top-up hoặc rebalance. Cap mua 12/cash 3; risk min(0.50, NAV/30), headroom ngày min(1.50, 10% NAV đầu ngày Việt Nam).", "",
             "| Case | Net theo NAV bán được USDT | ROI % | Net/ngày UTC | Closed | PF | DD USDT | Sep continuous net |",
             "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for name in CASES:
        case = metrics.get(name)
        if case is None:
            lines.append(f"| {name} | missing | | | | | | |")
            continue
        factor = "∞ (no losses)" if case["profit_factor_status"] == "INFINITE_NO_LOSSES" else fmt(case["profit_factor"])
        lines.append(f"| {name} | {fmt(case['trading_net_usdt'])} | {fmt(case['trading_return_percent'], 3)} | {fmt(case['mean_trading_net_usdt_per_full_utc_day'])} | {case['closed_trades']} | {factor} | {fmt(case['max_drawdown_usdt'])} | {fmt(case['september_continuous_ledger_net_usdt'])} |")
    lines += ["", "Minimum10/partial50 là sensitivity đã đăng ký, không phải nhánh để chọn winner. Sep standalone là secondary với ví 15 mới; gate September dùng dòng tháng Sep của main continuous ledger.", "",
              "## Thu nhập ngày, benchmark và chi phí", "",
              "Main OOS đủ 183 ngày UTC. Mean net/ngày = net/183, không chia cho số dòng ngày Việt Nam hoặc số ngày có trade. Daily series có các ngày biên không đủ 24 giờ; đếm dưới đây chỉ mô tả lịch đánh dấu. Mục tiêu 1–3 USDT/ngày trên 15 USDT tương đương 6.67–20% vốn ban đầu mỗi ngày; kết quả lịch sử không phải dự báo bảo đảm thu nhập.", ""]
    for name in ("base", "stress"):
        if name not in metrics:
            continue
        case = metrics[name]
        lines += [f"**{name}:** candidates {case['candidates']}, context eligible {case['context_eligible']}, entries {case['entries']}, closed {case['closed_trades']}; win rate {fmt(case['win_rate'])}, expectancy/closed {fmt(case['expectancy_per_closed_trade_usdt'])} USDT, avg win/loss {fmt(case['average_win_usdt'])}/{fmt(case['average_loss_usdt'])}, losing streak {case['max_losing_streak']}, exposure {case['minutes_exposed']} phút.", "",
                  f"Daily rows Việt Nam {case['daily_rows_vn_including_partial_boundary_days']}: dương {case['daily_positive_rows']}, âm {case['daily_negative_rows']}, zero {case['daily_zero_rows']}; ngày không entry {case['days_without_entry']}. Duration UTC thực của case {fmt(case['duration_full_utc_days'], 2)} ngày.", "",
                  f"Buy-and-hold: tối đa 12 USDT purchase + ít nhất 3 cash, cùng fees/slip/step/minimum và cùng window; valid receipt = {case['buy_hold_comparator_valid_12_plus_3']}; executable net {fmt(case['buy_hold_net_usdt'])} USDT. Comparator không có stop hoặc strategy sizing.", "",
                  f"AI calls {case['ai_calls']}, actual historical AI cost {fmt(case['actual_ai_cost_usdt'])}. Fixed-cost sensitivity 0.10/0.25/0.50 USD (giả định 1 USD = 1 USDT) → net {', '.join(fmt(value) for value in case['ai_fixed_cost_sensitivity_not_actual_usdt'].values())} USDT. Đây là subtract-cost scenario, không có AI decisions hoặc hóa đơn giả; không phải tỷ giá thực đã đo.", "",
                  f"VPS incremental {fmt(case['incremental_vps_cost_usdt'])}; full allocated {fmt(case['full_allocated_vps_cost_usdt'])}. Economic net tương ứng {fmt(case['economic_net_after_incremental_vps_usdt'])}/{fmt(case['economic_net_after_full_vps_usdt'])}. Unknown không được coi là 0.", "",
                  f"Phí BUY cộng {fmt(case['buy_fee_sol'], 8)} SOL; SELL cộng {fmt(case['sell_fee_usdt'], 8)} USDT. BUY fee đã giảm inventory, không trừ lại vào PnL lần nữa.", ""]
    lines += ["## Ledger tháng, dust và bất định", "", "| Case | Tháng UTC | NAV đầu | NAV cuối | Net tháng | Closed |", "|---|---|---:|---:|---:|---:|"]
    for name in ("base", "stress"):
        if name not in metrics:
            continue
        for row in metrics[name]["monthly"]:
            lines.append(f"| {name} | {row['month']} | {fmt(number(row['start_nav']))} | {fmt(number(row['end_nav']))} | {fmt(number(row['net_pnl']))} | {row['closed_trades']} |")
    lines.append("")
    for name in ("base", "stress"):
        if name not in metrics:
            continue
        case = metrics[name]
        lines += [f"**{name} cuối kỳ:** cash {fmt(case['final_cash_usdt'])}, executable NAV {fmt(case['final_executable_nav_usdt'])}, book NAV {fmt(case['final_book_nav_usdt'])}, inventory {fmt(case['final_inventory_sol'], 8)} SOL; book−executable {fmt(case['book_minus_executable_usdt'])}. Unsellable inventory có executable mark 0, book value báo riêng; open position chưa thoát = {case['open_position_at_end']}.", "",
                  f"Ba winner lớn nhất cộng {fmt(case['top3_winner_sum_usdt'])} USDT ({fmt(case['top3_share_of_gross_wins'])} của gross winning PnL); net trừ ba winner {fmt(case['net_without_top3_winners_usdt'])}. Đây là attribution arithmetic, không replay account sau bỏ trade.", ""]
        for block, diagnostic in case["bootstrap_diagnostic"].items():
            interval = diagnostic["total_pnl_ci95_usdt"] if diagnostic else None
            lines.append(f"Bootstrap diagnostic {name}, circular daily blocks {block}, seed 1729, 2,000 samples: 95% total-PnL interval {interval} USDT.")
        lines += ["", f"Skip counts: `{json.dumps(case['skips'], sort_keys=True)}`. Exit counts: `{json.dumps(case['exit_reasons'], sort_keys=True)}`.", ""]
    lines += ["### Inventory chưa thoát ở sensitivity partial50", "",
              "| Case | Cash | NAV bán được | NAV sổ sách | SOL còn sở hữu | Vị thế chưa thoát |",
              "|---|---:|---:|---:|---:|---|"]
    for name in ("partial50_base", "partial50_stress"):
        if name not in metrics:
            continue
        case = metrics[name]
        lines.append(f"| {name} | {fmt(case['final_cash_usdt'])} | {fmt(case['final_executable_nav_usdt'])} | {fmt(case['final_book_nav_usdt'])} | {fmt(case['final_inventory_sol'], 8)} | {case['open_position_at_end']} |")
    lines += ["", "SOL mắc lại vẫn là tài sản sở hữu, không bị xóa hoặc coi đã mất toàn bộ giá trị. Net ở bảng đầu dùng NAV có thể bán ngay theo minimum và proxy đã đăng ký; NAV sổ sách đánh dấu toàn bộ SOL theo giá cuối. Không đồng nhất phần inventory chưa bán được với lỗ đã thực hiện, và không dùng book value làm tiền dùng được cho lệnh mới.", "",
              "Bootstrap dùng float diagnostic, giữ block calendar 1 và 7; không rerun strategy phụ thuộc vốn, không chứng minh thống kê hoặc dự báo. Ít closed setups, CI chứa 0, concentration hoặc inventory stranded làm giảm sức mạnh kết luận.", "",
              "## Gates, assumptions và provenance", ""]
    for key, value in result["gates"].items():
        lines.append(f"- {key}: {value}")
    lines.append("")
    for label, values in (("Failed gates", result["failed_gates"]), ("Unknown/uncertainty", result["uncertainties"])):
        lines.append(f"**{label}:**")
        lines.extend(["", *[f"- {value}" for value in values]] if values else ["Không có trong các kiểm tra đã thực hiện."])
        lines.append("")
    memory = execution.get("peak_memory_kib")
    lines += [f"Execution status {execution.get('status', 'missing')}; wall seconds {execution.get('wall_seconds', 'unknown')}; process peak RSS/VmHWM {memory if memory is not None else 'unknown'} KiB. Đo process runner, không phải tổng RAM VPS.", "",
              f"Reporter SHA256: `{result.get('reporter_sha256', 'unknown')}`. Presentation module được hash riêng, không thuộc frozen replay core.", "",
              "Fees baseline 0.1% mỗi phía theo signed snapshot hiện tại, không BNB discount; lịch phí quá khứ chưa verified. Slippage 0.1%/side base, 0.3% stress là giả định, không measurement; delay 30s/120s. Tick 0.01, step 0.001, minimum chính 5 và sensitivity 10 dùng current-filter scenarios; historical filters chưa verified. Entry partial50 chỉ fill một phần rồi cancel remainder; exit không chế tạo fill khi dưới minimum.", "",
              "Prior five complete 1m volume-weighted candles là conditional filter-reference proxy. Exchange reference price/execution rules lịch sử không được archive/reconstruct; OHLC taker fills, intrabar timestamp và stop-first là approximation. Gap/latched exit theo runner, không bảo đảm stop thực thi tại mức dự kiến. Closed setup count không tự chứng minh edge. Positive trading net không thay economic PnL khi VPS unknown. LLM chưa được đánh giá trong historical stage.", "",
              "Protocol/data-manifest/source SHA identity có trong verdict.json; CSV giữ case riêng, không cộng PnL của nhiều ví thành một danh mục. Nguồn dữ liệu chính thức:", ""]
    lines.extend(f"- [{title}]({url})" for title, url in SOURCES)
    return "\n".join(lines) + "\n"


def write_csvs(output_dir: Path, raw_cases: Mapping[str, Mapping[str, Any]]) -> None:
    with (output_dir / "equity.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(("case", "frequency", "at", "executable_nav_usdt", "period_net_usdt"))
        for name, raw in raw_cases.items():
            for row in raw.get("daily", []):
                writer.writerow((name, "VN_calendar_day_including_partial_boundaries", row["date_vn"], row["end_nav"], row["net_pnl"]))
            previous = INITIAL
            for row in raw.get("hourly", []):
                value = number(row["nav"])
                writer.writerow((name, "UTC_hour", row["at"], value, value - previous))
                previous = value
    fields = ("setup_id", "entry_us", "exit_us", "exit_reason", "entry_price", "exit_price", "stop", "target",
              "hold_seconds", "net_pnl", "planned_stop_loss", "partial_stranded_at_stop", "dust_sol_after")
    with (output_dir / "trades.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(("case", *fields, "entry_utc", "exit_utc"))
        for name, raw in raw_cases.items():
            for row in raw.get("trades", []):
                writer.writerow((name, *(row.get(field) for field in fields), iso_us(row["entry_us"]), iso_us(row["exit_us"])))


def build_report(output_dir: Path) -> dict[str, Any]:
    """Read result JSON only; never import or execute the strategy runner."""
    errors: list[str] = []
    execution = load(output_dir / "execution.json", errors)
    registration = load(output_dir / "run-registration.json", errors)
    metrics, raw_cases = {}, {}
    for name in CASES:
        raw = load(output_dir / f"{name}.json", errors)
        if raw is None:
            continue
        try:
            metrics[name] = summarize(raw)
            raw_cases[name] = raw
        except (KeyError, TypeError, ValueError, InvalidOperation, ArithmeticError) as exc:
            errors.append(f"{name}.json invalid metrics: {type(exc).__name__}: {exc}")
    result = evaluate(execution, registration, metrics, errors)
    result["reporter_sha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    result["artifact_sha256"] = {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                                  for path in sorted(output_dir.glob("*.json")) if path.name != "verdict.json"}
    output_dir.mkdir(parents=True, exist_ok=True)
    write_csvs(output_dir, raw_cases)
    (output_dir / "report.md").write_text(markdown(result))
    (output_dir / "verdict.json").write_text(json.dumps(serial(result), indent=2, ensure_ascii=False) + "\n")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    result = build_report(args.output_dir)
    print(json.dumps({"verdict": result["verdict"], "live_authorized": False,
                      "main_net_usdt": {name: str(result["metrics"][name]["trading_net_usdt"])
                                        for name in ("base", "stress") if name in result["metrics"]},
                      "output_dir": str(args.output_dir)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
