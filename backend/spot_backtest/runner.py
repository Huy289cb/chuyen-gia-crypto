"""Finite offline replay. Prices are scenario proxies, never historical receipts."""
from __future__ import annotations

import argparse
from collections import Counter, deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import time
from typing import Iterable

from .account import SpotAccount, STEP, floor_step
from .dataset import iter_bars
from .features import Signal, generate_signals
from .models import Bar, MINUTE_US, HOUR_US, DAY_US

D = Decimal


@dataclass(frozen=True)
class Case:
    name: str
    slip: Decimal = D('.001')
    delay_seconds: int = 30
    min_notional: Decimal = D('5')
    partial_fraction: Decimal = D('1')


def utc_us(value: str) -> int:
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = dt - datetime(1970, 1, 1, tzinfo=timezone.utc)
    return (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds


def iso(timestamp: int) -> str:
    return datetime.fromtimestamp(timestamp // 1_000_000, timezone.utc).isoformat()


def json_default(value):
    if isinstance(value, D):
        return str(value)
    raise TypeError(type(value).__name__)


def save_json(path: Path, value):
    path.write_text(json.dumps(value, indent=2, default=json_default) + '\n')


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def linux_memory_kib() -> int | None:
    # ru_maxrss can inherit the launcher watermark across exec; use this process.
    for line in Path('/proc/self/status').read_text().splitlines():
        if line.startswith('VmHWM:'):
            return int(line.split()[1])
    return None


def run_replay(bars: Iterable[Bar], signals: Iterable[Signal], case: Case,
               start_us: int, end_us: int) -> dict:
    """One continuous 15 USDT ledger; caller may provide prior five warmup bars.

    Signal.at_us is retest close+1us. At open: day rollover, latched/expiry exit,
    candidate consumption, due entry. Only then are this minute's H/L inspected.
    Five prior complete 1m candles supply a CONDITIONAL reference-price proxy.
    This is not the exchange's unarchived historical reference price.
    """
    account = SpotAccount(min_notional=case.min_notional, slip=case.slip,
                          partial_fraction=case.partial_fraction)
    candidates = iter(signals)
    next_signal = next(candidates, None)
    history = deque(maxlen=5)
    pending = position = None
    seen = set()
    skips, exits = Counter(), Counter()
    decisions, trades, daily, hourly, monthly = [], [], {}, {}, {}
    day = None
    day_start = D('15')
    day_paused = False
    peak = D('15')
    max_dd = max_dd_fraction = D('0')
    minutes_exposed = 0
    candidate_count = context_count = 0
    last_bar = None
    market_first = market_last = None
    benchmark = SpotAccount(min_notional=case.min_notional, slip=case.slip)
    benchmark_started = False
    benchmark_receipts = []

    def reference() -> Decimal | None:
        if len(history) != 5 or any(history[i].open_us + MINUTE_US != history[i+1].open_us
                                    for i in range(4)):
            return None
        volume = sum((b.volume for b in history), D('0'))
        return sum((b.quote_volume for b in history), D('0')) / volume if volume > 0 else None

    def filter_ok(quantity: Decimal, proxy: Decimal | None) -> bool:
        return proxy is not None and quantity * proxy >= case.min_notional

    def conditional_nav(ledger: SpotAccount, ref: Decimal) -> Decimal:
        # A blocked reference-price minimum must also block liquidation value.
        # Book NAV remains the separate, unconstrained mark of owned inventory.
        quantity = floor_step(ledger.inventory, STEP)
        if not filter_ok(quantity, reference()):
            return ledger.cash
        return ledger.nav(ref)

    def record_skip(signal: Signal, reason: str, at: int):
        skips[reason] += 1
        decisions.append({'setup_id': signal.setup_id, 'timestamp_us': at,
                          'signal_us': signal.at_us, 'breakout_us': signal.breakout_us,
                          'decision': 'SKIP', 'reason': reason})

    def exit_position(ref: Decimal, at: int, reason: str):
        nonlocal position
        if position is None:
            return
        proxy = reference()
        if not filter_ok(floor_step(account.inventory, STEP), proxy):
            result = {'eligible': False, 'reasons': ['exit_reference_minimum_or_unknown']}
        else:
            result = account.sell(ref, at, reason)
        if not result['eligible']:
            position['latched_exit'] = reason
            if reason not in position['blocked_reasons']:
                position['blocked_reasons'].add(reason)
                skips['EXIT_BLOCKED:' + result['reasons'][0]] += 1
                decisions.append({'setup_id': position['setup_id'], 'timestamp_us': at,
                                  'decision': 'EXIT_BLOCKED', 'reason': result['reasons'][0]})
            return
        # Before entry and after a normal exit, remaining inventory is dust below
        # LOT step. Both executable values are zero, so cash delta is economic PnL.
        pnl = account.cash - position['cash_before']
        trades.append({'setup_id': position['setup_id'], 'entry_us': position['entry_us'],
                       'exit_us': at, 'exit_reason': reason, 'net_pnl': pnl,
                       'entry_price': position['entry_price'], 'exit_price': result['price'],
                       'stop': position['stop'], 'target': position['target'],
                       'hold_seconds': D(at - position['entry_us']) / D(1_000_000),
                       'planned_stop_loss': position['planned_stop_loss'],
                       'partial_stranded_at_stop': position['partial_stranded_at_stop'],
                       'dust_sol_after': account.inventory})
        exits[reason] += 1
        position = None

    for bar in bars:
        if bar.open_us >= end_us:
            break
        if bar.open_us < start_us:
            history.append(bar)
            continue
        last_bar = bar
        if market_first is None:
            market_first = bar.open
        market_last = bar.close
        current_day = (bar.open_us + 7 * HOUR_US) // DAY_US
        if current_day != day:
            day = current_day
            day_start = conditional_nav(account, bar.open)
            day_paused = False
        daily_limit = min(D('1.50'), day_start * D('.10'))
        # The open mark preserves overnight gaps and owned exposure at rollover.
        current_loss = max(D('0'), day_start - conditional_nav(account, bar.open))
        if current_loss >= daily_limit:
            day_paused = True
        if position is not None:
            if position['latched_exit']:
                exit_position(bar.open, bar.open_us, position['latched_exit'])
            elif bar.open_us >= position['entry_us'] + DAY_US:
                exit_position(bar.open, bar.open_us, 'TIME_24H')

        while next_signal is not None and next_signal.at_us <= bar.open_us:
            signal = next_signal
            next_signal = next(candidates, None)
            if signal.at_us < start_us or signal.breakout_us < start_us:
                continue
            candidate_count += 1
            if signal.setup_id in seen:
                record_skip(signal, 'DUPLICATE_SETUP', bar.open_us)
                continue
            seen.add(signal.setup_id)
            if not signal.context_ok:
                record_skip(signal, signal.reason, bar.open_us)
                continue
            context_count += 1
            if pending is not None or position is not None:
                record_skip(signal, 'POSITION_OR_PENDING_OCCUPIED', bar.open_us)
            elif day_paused:
                record_skip(signal, 'DAILY_PAUSE', bar.open_us)
            else:
                pending = signal
                decisions.append({'setup_id': signal.setup_id, 'timestamp_us': bar.open_us,
                                  'signal_us': signal.at_us, 'decision': 'PENDING',
                                  'due_us': signal.at_us + case.delay_seconds * 1_000_000})

        if pending is not None and bar.open_us >= pending.at_us + case.delay_seconds * 1_000_000:
            signal, pending = pending, None  # Attempt is consumed, even if rejected.
            nav = conditional_nav(account, bar.open)
            loss = max(D('0'), day_start - nav)
            headroom = max(D('0'), daily_limit - loss)
            if day_paused or headroom <= 0:
                record_skip(signal, 'DAILY_PAUSE_AT_FILL', bar.open_us)
            elif reference() is None:
                record_skip(signal, 'MISSING_REFERENCE_FILTER_INPUT', bar.open_us)
            else:
                plan = account.plan_buy(bar.open, signal.stop, signal.target,
                                        min(D('.50'), nav / D(30)), headroom)
                if not plan['eligible']:
                    record_skip(signal, '|'.join(plan['reasons']), bar.open_us)
                elif not filter_ok(plan['quantity'], reference()):
                    record_skip(signal, 'ENTRY_REFERENCE_BELOW_MINIMUM', bar.open_us)
                else:
                    before_cash = account.cash
                    receipt = account.buy(plan, bar.open_us, signal.setup_id)
                    if not receipt['eligible']:
                        record_skip(signal, '|'.join(receipt['reasons']), bar.open_us)
                    else:
                        position = {'setup_id': signal.setup_id, 'entry_us': bar.open_us,
                                    'entry_price': receipt['price'], 'cash_before': before_cash,
                                    'stop': signal.stop, 'target': signal.target,
                                    'planned_stop_loss': plan['stop_loss'],
                                    'partial_stranded_at_stop': receipt['partial_stranded_at_stop'],
                                    'latched_exit': None, 'blocked_reasons': set()}
                        decisions.append({'setup_id': signal.setup_id, 'timestamp_us': bar.open_us,
                                          'decision': 'BUY', 'stop': signal.stop,
                                          'target': signal.target, 'reference_proxy': reference()})

        if not benchmark_started:
            # Registered comparator: same 12 USDT exposure cap +3 USDT cash,
            # same fees/slip/step, no stop or strategy sizing, one initial BUY.
            price = benchmark._price(bar.open, buy=True)
            quantity = floor_step(D('12') / price, STEP)
            if filter_ok(quantity, reference()):
                receipt = benchmark.apply_fill({'fill_id': 'BUY_HOLD_ENTRY', 'side': 'BUY',
                           'timestamp_us': bar.open_us, 'quantity': quantity, 'price': price,
                           'reason': 'BUY_HOLD', 'setup_id': 'BUY_HOLD'})
                benchmark_receipts.append(receipt)
            else:
                benchmark_receipts.append({'eligible': False, 'reasons': ['initial_reference_unavailable_or_below_minimum']})
            benchmark_started = True

        if position is not None:
            minutes_exposed += 1
            if not position['latched_exit']:
                stop, target = position['stop'], position['target']
                if bar.open <= stop:
                    exit_position(bar.open, bar.open_us, 'STOP_GAP')
                elif bar.open >= target:
                    # The known open gives ordering before later minute H/L.
                    exit_position(target, bar.open_us, 'TARGET_GAP')
                elif bar.low <= stop:
                    exit_position(stop, bar.close_us, 'STOP')
                elif bar.high >= target:
                    # No favorable target-gap credit; stop-first when both touched.
                    exit_position(target, bar.close_us, 'TARGET')

        history.append(bar)  # Current candle is now closed, available to marks.
        nav = conditional_nav(account, bar.close)
        peak = max(peak, nav)
        dd = peak - nav
        max_dd = max(max_dd, dd)
        max_dd_fraction = max(max_dd_fraction, dd / peak if peak else D('0'))
        if max(D('0'), day_start - nav) >= daily_limit:
            day_paused = True
        stamp = iso(bar.open_us)
        vn_date = iso(bar.open_us + 7 * HOUR_US)[:10]
        daily[vn_date] = nav
        if (bar.close_us + 1) % HOUR_US == 0:
            hourly[stamp[:13] + ':00:00+00:00'] = nav
        monthly[stamp[:7]] = nav

    if last_bar is None:
        raise ValueError('empty replay window')
    if position is not None:
        exit_position(last_bar.close, last_bar.close_us, 'END_OF_DATA')
    if pending is not None:
        record_skip(pending, 'PENDING_AT_END_OF_DATA', end_us)
    if filter_ok(floor_step(benchmark.inventory, STEP), reference()):
        benchmark_end = benchmark.sell(last_bar.close, last_bar.close_us, 'BUY_HOLD_END')
    else:
        benchmark_end = {'eligible': False, 'reasons': ['exit_reference_minimum_or_unknown']}
    benchmark_receipts.append(benchmark_end)
    final_nav = conditional_nav(account, last_bar.close)
    daily[iso(last_bar.open_us + 7 * HOUR_US)[:10]] = final_nav
    monthly[iso(last_bar.open_us)[:7]] = final_nav
    peak = max(peak, final_nav)
    max_dd = max(max_dd, peak - final_nav)
    max_dd_fraction = max(max_dd_fraction, (peak - final_nav) / peak)
    wins = [t['net_pnl'] for t in trades if t['net_pnl'] > 0]
    losses = [t['net_pnl'] for t in trades if t['net_pnl'] < 0]
    total_win, total_loss = sum(wins, D(0)), -sum(losses, D(0))
    month_rows, previous = [], D('15')
    for month, value in sorted(monthly.items()):
        matching = [t for t in trades if iso(t['exit_us'])[:7] == month]
        month_rows.append({'month': month, 'start_nav': previous, 'end_nav': value,
                           'net_pnl': value - previous, 'closed_trades': len(matching)})
        previous = value
    daily_rows, previous = [], D('15')
    for date, value in sorted(daily.items()):
        daily_rows.append({'date_vn': date, 'end_nav': value, 'net_pnl': value - previous})
        previous = value
    entry_days = {iso(e['timestamp_us'] + 7 * HOUR_US)[:10]
                  for e in account.events if e['side'] == 'BUY'}
    max_losing_streak = streak = 0
    for trade in trades:
        streak = streak + 1 if trade['net_pnl'] < 0 else 0
        max_losing_streak = max(max_losing_streak, streak)
    return {'case': asdict(case), 'start_us': start_us, 'end_us_exclusive': end_us,
            'initial_cash': D('15'), 'final_executable_nav': final_nav,
            'final_book_nav': account.book_nav(last_bar.close), 'final_cash': account.cash,
            'final_inventory_sol': account.inventory, 'net_pnl': final_nav - D('15'),
            'net_return_fraction': final_nav / D('15') - D('1'),
            'max_drawdown': max_dd, 'max_drawdown_fraction': max_dd_fraction,
            'candidates': candidate_count, 'context_eligible': context_count,
            'entries': sum(e['side'] == 'BUY' for e in account.events),
            'closed_trades': len(trades), 'open_position_at_end': position is not None,
            'win_rate': D(len(wins)) / D(len(trades)) if trades else None,
            'average_win': total_win / D(len(wins)) if wins else None,
            'average_loss': -total_loss / D(len(losses)) if losses else None,
            'expectancy': sum((t['net_pnl'] for t in trades), D(0)) / D(len(trades)) if trades else None,
            'profit_factor': total_win / total_loss if total_loss else None,
            'max_losing_streak': max_losing_streak, 'minutes_exposed': minutes_exposed,
            'days_without_entry': len(daily) - len(entry_days),
            'skips': dict(skips), 'exit_reasons': dict(exits),
            'buy_fee_sol': sum((e['base_fee'] for e in account.events), D(0)),
            'sell_fee_usdt': sum((e['quote_fee'] for e in account.events), D(0)),
            'ai_calls': 0, 'ai_actual_cost': D('0'),
            'ai_cost_sensitivity': {str(c): final_nav - D('15') - c for c in (D('.10'), D('.25'), D('.50'))},
            'incremental_vps_cost': None, 'full_allocated_vps_cost': None,
            'buy_hold_final_nav': conditional_nav(benchmark, last_bar.close),
            'buy_hold_net_pnl': conditional_nav(benchmark, last_bar.close) - D('15'),
            'buy_hold_receipts': benchmark_receipts,
            'market_first': market_first, 'market_last': market_last,
            'monthly': month_rows, 'daily': daily_rows,
            'hourly': [{'at': at, 'nav': nav} for at, nav in sorted(hourly.items())],
            'events': account.events, 'decisions': decisions, 'trades': trades}


CASES = [Case('base'), Case('stress', D('.003'), 120),
         Case('minimum10_base', min_notional=D('10')),
         Case('minimum10_stress', D('.003'), 120, D('10')),
         Case('partial50_base', partial_fraction=D('.50')),
         Case('partial50_stress', D('.003'), 120, partial_fraction=D('.50'))]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--protocol', type=Path, required=True)
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--mode', choices=['qa', 'register', 'full'], required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    protocol = json.loads(args.protocol.read_text())
    design = {k: v for k, v in protocol.items() if k != 'design_sha256'}
    design_hash = hashlib.sha256(json.dumps(design, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    if design_hash != protocol.get('design_sha256') or design_hash != 'e69882a64c45d5f3f44d997ff92bd4fd04f445bf7efa101dceb99934fbe7c85b':
        raise SystemExit('only the original locked Spot protocol is supported')
    data_start = utc_us(protocol['data']['start_utc'])
    data_end = utc_us(protocol['data']['end_utc_exclusive'])
    oos_start = utc_us('2026-04-01')
    package = Path(__file__).parent
    # Post-run presentation is not imported by the replay engine; its hash is
    # reported separately. This pins every core and adversarial-test source.
    sources = {str(p.relative_to(package)): sha(p) for p in sorted(package.rglob('*.py'))
               if p.name != 'report.py'}
    manifest_path = args.data_dir / 'manifest.json'
    identity = {'protocol_sha256': sha(args.protocol), 'data_manifest_sha256': sha(manifest_path),
                'source_sha256': sources}
    registration_path = args.output_dir / 'run-registration.json'
    if args.mode == 'register':
        if registration_path.exists():
            raise SystemExit('registration immutable; select a new run directory')
        if not (args.output_dir / 'qa.json').exists():
            raise SystemExit('development QA required before registration')
        qa = json.loads((args.output_dir / 'qa.json').read_text())
        if qa.get('status') != 'PASS' or any(qa.get(k) != v for k, v in identity.items()):
            raise SystemExit('development QA source/data identity differs')
        validation = json.loads((args.data_dir / 'aggregation-validation.json').read_text())
        if validation.get('status') != 'EXACT_MATCH' or validation.get('manifest_sha256') != identity['data_manifest_sha256']:
            raise SystemExit('aggregation validation required')
        save_json(registration_path, {'registered_at_utc': datetime.now(timezone.utc).isoformat(),
                  **identity, 'cases': [asdict(c) for c in CASES],
                  'secondary_sep_standalone': ['base', 'stress'],
                  'qa_sha256': sha(args.output_dir / 'qa.json'),
                  'aggregation_validation_sha256': sha(args.data_dir / 'aggregation-validation.json'),
                  'technical_clarifications': {
                      'runtime': 'single offline Python3 standard-library streaming process; no production imports',
                      'analysis_source': 'report.py is presentation-only, not imported by replay; record its separate hash in report artifacts',
                      'reference_filter': 'conditional prior5-complete-minute volume-weighted proxy; no claim historical exchange reference reconstructed',
                      'intrabar_exit_timestamp': 'close_us proxy; open gaps/expiry exact open; stop first',
                      'unexecutable_exit': 'latch exit intention and retry at later minute opens; never manufacture a fill',
                      'buy_hold': 'one12USDT maximum-cost purchase plus3cash at first OOSopen; same fee/slip/step/min',
                      'daily': 'VNcalendar marks; pause when loss ceiling touched; owned exposure crosses boundary',
                      'month': 'UTCmonths, one continuous ledger; Sepstandalone secondary only',
                      'bootstrap': 'seed1729,2000 resamples of daily PnL using circular blocks lengths1and7; diagnostic only',
                      'infra_costs': 'unknown separately; positive exchange PnL alone cannot pass unknown economic costs',
                      'sample': '15m setups only; no strategy optimization or OOS reruns for profit'}})
        print(json.dumps({'status': 'REGISTERED_BEFORE_OOS', **identity}), flush=True)
        return
    if args.mode == 'full':
        registration = json.loads(registration_path.read_text())
        if any(registration.get(k) != v for k, v in identity.items()):
            raise SystemExit('frozen source/data/protocol identity changed')
        if (args.output_dir / 'execution.json').exists():
            raise SystemExit('full run already attempted; no silent rerun')
        save_json(args.output_dir / 'execution.json', {'status': 'RUNNING',
                  'started_at_utc': datetime.now(timezone.utc).isoformat(), **identity})
    started = time.monotonic()
    feature_end = utc_us('2025-10-08') if args.mode == 'qa' else data_end
    signals = list(generate_signals(iter_bars(args.data_dir, 'SOLUSDT', '15m', data_start, feature_end),
                                    iter_bars(args.data_dir, 'BTCUSDT', '15m', data_start, feature_end)))
    if args.mode == 'qa':
        if registration_path.exists():
            raise SystemExit('registration frozen; development QA cannot overwrite')
        qa_start, qa_end = utc_us('2025-10-03'), utc_us('2025-10-08')
        result = run_replay(iter_bars(args.data_dir, 'SOLUSDT', '1m', qa_start - 5*MINUTE_US, qa_end),
                            signals, Case('development_qa'), qa_start, qa_end)
        save_json(args.output_dir / 'qa.json', {'status': 'PASS', 'development_only': True, **identity,
                  'wall_seconds': time.monotonic() - started, 'peak_memory_kib': linux_memory_kib(),
                  'result': result})
        print(json.dumps({'status': 'QA_PASS_DEVELOPMENT_ONLY', 'wall_seconds': time.monotonic()-started,
                          'peak_memory_kib': linux_memory_kib()}), flush=True)
        return
    summaries = []
    for case in CASES + [Case('sep_standalone_base'), Case('sep_standalone_stress', D('.003'), 120)]:
        if time.monotonic() - started >= 7200:
            raise SystemExit('finite full-stage wall cap reached')
        start = utc_us('2026-09-01') if case.name.startswith('sep_standalone') else oos_start
        print(json.dumps({'status': 'CASE_STARTED', 'case': case.name}), flush=True)
        result = run_replay(iter_bars(args.data_dir, 'SOLUSDT', '1m', start - 5*MINUTE_US, data_end),
                            signals, case, start, data_end)
        save_json(args.output_dir / (case.name + '.json'), result)
        summaries.append({k: result[k] for k in ('case', 'net_pnl', 'final_executable_nav', 'closed_trades',
                                                'profit_factor', 'max_drawdown', 'open_position_at_end')})
        print(json.dumps({'status': 'CASE_COMPLETE', **summaries[-1]}, default=json_default), flush=True)
    save_json(args.output_dir / 'execution.json', {'status': 'COMPLETE',
              'completed_at_utc': datetime.now(timezone.utc).isoformat(), **identity,
              'wall_seconds': time.monotonic()-started, 'peak_memory_kib': linux_memory_kib(),
              'summaries': summaries})


if __name__ == '__main__':
    main()
