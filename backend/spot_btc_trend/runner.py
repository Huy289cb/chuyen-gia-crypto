"""One frozen, rules-only BTC Spot replay; no provider, broker or private API.

Protection on the entry minute is unverified and starts next minute. Thereafter
the old stop is checked before the minute high raises the stop for the NEXT
minute. Terminal liquidation uses the last known close after that minute is
complete. Fill timestamps for intrabar triggers are bar-endpoint proxies.
"""
from __future__ import annotations

import time
MODULE_STARTED = time.monotonic()

import argparse
from collections import Counter, deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from decimal import Decimal, localcontext
import hashlib
import json
from pathlib import Path
import resource
from typing import Iterable

from spot_backtest.models import Bar, MINUTE_US, HOUR_US, DAY_US
from spot_aggressive_v3.dataset import iter_bars
from .account import BTCAccount, STEP, TICK, floor_step
from .strategy import Signal, MODEL_ID, generate_signals, validate_bar

D = Decimal
PARAMETERS = {
    'ema_period': 600, 'startup_bars': 1300, 'exit_factor': '.98',
    'trail_factor': '.85', 'static_target_factor': '11',
    'diagnostic_hurdle_factor': '1.50', 'risk_max': '3',
    'nav_risk_divisor': '5', 'buy_cap': '12', 'cash_reserve': '3',
    'cooldown_seconds': 3600, 'daily_loss_fraction': '.20',
    'daily_loss_max': '3', 'buy_fee': '.001', 'sell_fee': '.001',
    'reference_window_minutes': 5,
    'entry_minute_protection': 'UNVERIFIED_START_NEXT_MINUTE',
    'trail_policy': 'OLD_STOP_FIRST_THEN_HIGH_NEXT_MINUTE',
    'daily_timezone': 'Asia/Ho_Chi_Minh', 'initial_cash': '15',
    'reset_cash_between_months': False,
}


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
        raise ValueError('timezone-aware timestamps required')
    delta = dt.astimezone(timezone.utc) - datetime(1970, 1, 1, tzinfo=timezone.utc)
    return (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds


def iso(at: int) -> str:
    seconds, micros = divmod(at, 1_000_000)
    return datetime.fromtimestamp(seconds, timezone.utc).replace(microsecond=micros).isoformat()


def json_default(value):
    if isinstance(value, D):
        return str(value)
    raise TypeError(type(value).__name__)


def save_json(path: Path, value) -> None:
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, default=json_default) + '\n')
    temporary.replace(path)


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(65536), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _validate_case(case: Case) -> None:
    if (case.slip, case.delay_seconds) not in ((D('.001'), 30), (D('.003'), 120)):
        raise ValueError('unregistered slippage/latency pair')
    if isinstance(case.delay_seconds, bool) or case.min_notional != D(5) or case.partial_fraction != D(1):
        raise ValueError('fixed exact filters/full-fill case required')
    if not isinstance(case.slip, D) or not isinstance(case.min_notional, D):
        raise ValueError('exact Decimal costs required')


def run_replay(bars: Iterable[Bar], signals: Iterable[Signal], case: Case,
               start_us: int, end_us: int, deadline: float | None = None) -> dict:
    """Run one continuous 15-USDT wallet and an independent buy/hold wallet.

    Prices and fills are scenario proxies. Closed-trade PnL is cash change
    between the entry and sale, including any carried dust sold with that
    episode; starting/ending inventory is retained explicitly. Executable NAV
    values unsellable dust at zero; book NAV marks the same owned dust separately.
    """
    _validate_case(case)
    if any(isinstance(v, bool) or not isinstance(v, int) for v in (start_us, end_us)):
        raise ValueError('integer replay boundaries required')
    if not 0 <= start_us < end_us or start_us % MINUTE_US or end_us % MINUTE_US:
        raise ValueError('ordered minute-aligned replay boundaries required')
    with localcontext() as context:
        context.prec = 50
        return _replay(bars, signals, case, start_us, end_us, deadline)


def _replay(bars, signals, case, start_us, end_us, deadline):
    account = BTCAccount(min_notional=case.min_notional, slip=case.slip,
                         buy_fee=D('.001'), sell_fee=D('.001'),
                         partial_fraction=D(1))
    benchmark = BTCAccount(min_notional=case.min_notional, slip=case.slip,
                           buy_fee=D('.001'), sell_fee=D('.001'))
    if account.cash != D(15) or STEP != D('.00001') or TICK != D('.01'):
        raise ValueError('BTC account/filter contract mismatch')
    signal_iter = iter(signals)
    next_signal = next(signal_iter, None)
    previous_signal_us = -1
    history = deque(maxlen=5)
    history_volume = history_quote = D(0)
    proxy = None
    pending = position = None
    seen = set()
    decisions, trades, benchmark_receipts = [], [], []
    skips, exit_reasons = Counter(), Counter()
    daily, monthly, hourly = {}, {}, {}
    day_key = month_key = None
    day_start = peak = book_peak = D(15)
    max_dd = max_dd_fraction = book_max_dd = D(0)
    day_paused = False
    cooldown_until = 0
    previous_bar_open = None
    last_bar = None
    entry_count = exit_signal_count = minutes_exposed = 0
    cap_violations = []
    benchmark_started = False
    market_first = None

    def append_history(bar):
        nonlocal history_volume, history_quote, proxy
        if len(history) == 5:
            old = history[0]
            history_volume -= old.volume
            history_quote -= old.quote_volume
        history.append(bar)
        history_volume += bar.volume
        history_quote += bar.quote_volume
        proxy = history_quote / history_volume if len(history) == 5 and history_volume > 0 else None

    def filter_ok(quantity):
        return proxy is not None and quantity >= STEP and quantity * proxy >= case.min_notional

    def executable_nav(ledger, reference):
        if not filter_ok(floor_step(ledger.inventory, STEP)):
            return ledger.cash
        return ledger.nav(reference)

    def update_valuation(reference, at):
        nonlocal peak, book_peak, max_dd, max_dd_fraction, book_max_dd, day_paused
        nav = executable_nav(account, reference)
        book = account.book_nav(reference)
        peak = max(peak, nav)
        max_dd = max(max_dd, peak - nav)
        max_dd_fraction = max(max_dd_fraction, (peak - nav) / peak)
        book_peak = max(book_peak, book)
        book_max_dd = max(book_max_dd, book_peak - book)
        if day_start - nav >= min(D(3), day_start * D('.20')):
            day_paused = True
        daily[day_key].update(end_nav=nav, book_end_nav=book)
        monthly[month_key].update(end_nav=nav, book_end_nav=book)
        if at % HOUR_US == 0:
            hourly[at] = {'timestamp_us': at, 'nav': nav, 'book_nav': book}
        return nav

    def skip(signal, reason, at):
        skips[reason] += 1
        decisions.append({'signal_id': signal.signal_id, 'episode_id': signal.episode_id,
                          'signal_us': signal.at_us, 'timestamp_us': at,
                          'decision': 'SKIP', 'reason': reason})

    def exit_position(reference, at, reason):
        nonlocal position, cooldown_until
        if position is None:
            return
        if filter_ok(floor_step(account.inventory, STEP)):
            receipt = account.sell(reference, at, reason)
        else:
            receipt = {'eligible': False, 'reasons': ['exit_reference_minimum_or_unknown']}
        if not receipt['eligible']:
            position['latched_exit'] = position['latched_exit'] or reason
            failure = '|'.join(receipt['reasons'])
            if (reason, failure) not in position['blocked_reasons']:
                position['blocked_reasons'].add((reason, failure))
                skips['EXIT_BLOCKED:' + failure] += 1
                decisions.append({'episode_id': position['episode_id'], 'timestamp_us': at,
                                  'decision': 'EXIT_BLOCKED', 'reason': reason,
                                  'filter_reason': failure, 'reference_proxy': proxy})
            return
        pnl = account.cash - position['cash_before']
        trades.append({
            'episode_id': position['episode_id'], 'entry_us': position['entry_us'],
            'exit_us': at, 'exit_reason': reason, 'net_pnl': pnl,
            'pnl_convention': 'CASH_CHANGE_INCLUDING_CARRIED_DUST',
            'entry_price': position['entry_price'], 'exit_price': receipt['price'],
            'entry_cost': position['entry_cost'], 'initial_stop': position['initial_stop'],
            'final_stop': position['stop'], 'static_target': position['target'],
            'diagnostic_hurdle': position['hurdle'], 'planned_risk': position['planned_risk'],
            'starting_inventory_btc': position['starting_inventory'],
            'ending_inventory_btc': account.inventory,
            'cash_before_entry': position['cash_before'], 'cash_after_sale': account.cash,
            'hold_seconds': D(at - position['entry_us']) / D(1_000_000),
            'loss_exceeded_planned_risk': -pnl > position['planned_risk'],
        })
        exit_reasons[reason] += 1
        daily[day_key]['exits'] += 1
        monthly[month_key]['closed_trades'] += 1
        cooldown_until = at + HOUR_US
        position = None

    for index, bar in enumerate(bars):
        if index % 4096 == 0 and deadline is not None and time.monotonic() >= deadline:
            raise TimeoutError('whole-run wall cap reached')
        validate_bar(bar, MINUTE_US, previous_bar_open)
        previous_bar_open = bar.open_us
        if bar.open_us >= end_us:
            break
        if bar.open_us < start_us:
            append_history(bar)
            continue
        if last_bar is None and bar.open_us != start_us:
            raise ValueError('replay starts after registered boundary')
        last_bar = bar
        market_first = bar.open if market_first is None else market_first
        current_day = iso(bar.open_us + 7 * HOUR_US)[:10]
        current_month = iso(bar.open_us)[:7]
        if current_day != day_key:
            day_key = current_day
            day_start = executable_nav(account, bar.open)
            day_paused = False
            daily[day_key] = {'date_vn': day_key, 'end_nav': day_start,
                              'book_end_nav': account.book_nav(bar.open),
                              'entries': 0, 'exits': 0, 'minutes_exposed': 0}
        if current_month != month_key:
            month_key = current_month
            monthly[month_key] = {'month_utc': month_key, 'end_nav': executable_nav(account, bar.open),
                                  'book_end_nav': account.book_nav(bar.open),
                                  'entries': 0, 'closed_trades': 0}
        daily_limit = min(D(3), day_start * D('.20'))
        opening_nav = executable_nav(account, bar.open)
        if day_start - opening_nav >= daily_limit:
            day_paused = True

        # Signals are consumed before any current-minute high/low inspection.
        while next_signal is not None and next_signal.at_us <= bar.open_us:
            signal = next_signal
            next_signal = next(signal_iter, None)
            if (signal.model_id != MODEL_ID or signal.kind not in ('ENTRY', 'EXIT') or
                    isinstance(signal.at_us, bool) or not isinstance(signal.at_us, int) or
                    signal.at_us % HOUR_US or signal.at_us < previous_signal_us):
                raise ValueError('unregistered or nonchronological signal stream')
            previous_signal_us = signal.at_us
            if signal.at_us < start_us:
                continue
            if signal.signal_id in seen:
                skip(signal, 'DUPLICATE_SIGNAL', bar.open_us)
                continue
            seen.add(signal.signal_id)
            if signal.kind == 'EXIT':
                exit_signal_count += 1
                if pending is not None:
                    skip(pending, 'EXIT_SIGNAL_BEFORE_ENTRY_FILL', bar.open_us)
                    pending = None
                if position is not None:
                    position['exit_due'] = signal.at_us + case.delay_seconds * 1_000_000
                    decisions.append({'signal_id': signal.signal_id, 'episode_id': position['episode_id'],
                                      'signal_us': signal.at_us, 'timestamp_us': bar.open_us,
                                      'decision': 'EXIT_PENDING', 'due_us': position['exit_due']})
                continue
            entry_count += 1
            if position is not None or pending is not None:
                skip(signal, 'POSITION_OR_PENDING_OCCUPIED', bar.open_us)
            elif bar.open_us < cooldown_until:
                skip(signal, 'COOLDOWN_1H', bar.open_us)
            elif day_paused:
                skip(signal, 'DAILY_LOSS_PAUSE', bar.open_us)
            else:
                pending = signal
                decisions.append({'signal_id': signal.signal_id, 'episode_id': signal.episode_id,
                                  'signal_us': signal.at_us, 'timestamp_us': bar.open_us,
                                  'decision': 'ENTRY_PENDING',
                                  'due_us': signal.at_us + case.delay_seconds * 1_000_000})

        if position is not None:
            # An existing protective gap stop takes priority at this open.
            if bar.open <= position['stop']:
                exit_position(bar.open, bar.open_us, 'STOP_GAP')
            if position is not None and position['latched_exit'] is not None:
                exit_position(bar.open, bar.open_us, position['latched_exit'])
            elif position is not None and position['exit_due'] is not None and bar.open_us >= position['exit_due']:
                exit_position(bar.open, bar.open_us, 'EMA_EXIT')

        if pending is not None and bar.open_us >= pending.at_us + case.delay_seconds * 1_000_000:
            signal, pending = pending, None
            nav = executable_nav(account, bar.open)
            headroom = max(D(0), daily_limit - max(D(0), day_start - nav))
            if day_paused or headroom <= 0:
                skip(signal, 'DAILY_LOSS_PAUSE_AT_FILL', bar.open_us)
            elif position is not None:
                skip(signal, 'POSITION_OCCUPIED_AT_FILL', bar.open_us)
            elif bar.open_us < cooldown_until:
                skip(signal, 'COOLDOWN_AT_FILL', bar.open_us)
            elif proxy is None:
                skip(signal, 'MISSING_REFERENCE_FILTER_INPUT', bar.open_us)
            else:
                buy_price = account._price(bar.open, buy=True)
                stop = floor_step(buy_price * D('.85'), TICK)
                hurdle = floor_step(bar.open * D('1.50'), TICK)
                plan = account.plan_entry(bar.open, stop, None, min(D(3), nav / D(5)), headroom, hurdle)
                if not plan['eligible']:
                    skip(signal, '|'.join(plan['reasons']), bar.open_us)
                elif not filter_ok(plan['quantity']):
                    skip(signal, 'ENTRY_REFERENCE_BELOW_MINIMUM', bar.open_us)
                else:
                    before_cash, before_inventory = account.cash, account.inventory
                    receipt = account.buy(plan, bar.open_us, signal.episode_id)
                    if not receipt['eligible']:
                        skip(signal, '|'.join(receipt['reasons']), bar.open_us)
                    else:
                        if (receipt['gross_quote'] > D(12) or account.cash < D(3) or
                                plan['effective_planned_risk'] > min(D(3), nav / D(5), headroom)):
                            cap_violations.append({'timestamp_us': bar.open_us, 'reason': 'ENTRY_CAP_VIOLATION'})
                            raise ValueError('entry cash/risk cap violation')
                        position = {
                            'episode_id': signal.episode_id, 'entry_us': bar.open_us,
                            'entry_price': receipt['price'], 'cash_before': before_cash,
                            'starting_inventory': before_inventory, 'entry_cost': receipt['gross_quote'],
                            'initial_stop': floor_step(receipt['price'] * D('.85'), TICK),
                            'stop': floor_step(receipt['price'] * D('.85'), TICK),
                            'target': floor_step(receipt['price'] * D(11), TICK),
                            'hurdle': plan['hurdle_price'], 'planned_risk': plan['effective_planned_risk'],
                            'latched_exit': None, 'exit_due': None, 'blocked_reasons': set(),
                        }
                        daily[day_key]['entries'] += 1
                        monthly[month_key]['entries'] += 1
                        decisions.append({
                            'signal_id': signal.signal_id, 'episode_id': signal.episode_id,
                            'signal_us': signal.at_us, 'timestamp_us': bar.open_us, 'decision': 'BUY',
                            'quantity': plan['quantity'], 'reference_open': bar.open,
                            'reference_proxy': proxy, 'plan': plan,
                            'entry_minute_protection': 'UNVERIFIED_START_NEXT_MINUTE',
                        })

        if not benchmark_started:
            price = benchmark._price(bar.open, buy=True)
            quantity = floor_step(min(D(12), benchmark.cash - D(3)) / price, STEP)
            if filter_ok(quantity):
                receipt = benchmark.apply_fill({
                    'fill_id': 'BUY_HOLD_ENTRY', 'side': 'BUY', 'timestamp_us': bar.open_us,
                    'quantity': quantity, 'price': price, 'reason': 'BUY_HOLD', 'setup_id': 'BUY_HOLD'})
                benchmark_receipts.append(receipt)
                benchmark_started = receipt['eligible']

        if position is not None:
            minutes_exposed += 1
            daily[day_key]['minutes_exposed'] += 1
            if bar.open_us != position['entry_us']:
                old_stop = position['stop']
                if bar.open >= position['target']:
                    exit_position(position['target'], bar.open_us, 'TARGET_GAP')
                elif bar.open > old_stop and bar.low <= old_stop:
                    exit_position(old_stop, bar.close_us + 1, 'STOP')
                elif bar.high >= position['target']:
                    exit_position(position['target'], bar.close_us + 1, 'TARGET_11X_PRICE')
                if position is not None:
                    position['stop'] = max(old_stop, floor_step(bar.high * D('.85'), TICK))
        append_history(bar)
        update_valuation(bar.close, bar.close_us + 1)

    if last_bar is None or last_bar.close_us + 1 != end_us:
        raise ValueError('empty or incomplete registered replay window')
    if position is not None:
        exit_position(last_bar.close, end_us, 'END_OF_DATA')
    if pending is not None:
        skip(pending, 'PENDING_AT_END_OF_DATA', end_us)
    benchmark_end = (benchmark.sell(last_bar.close, end_us, 'BUY_HOLD_END')
                     if filter_ok(floor_step(benchmark.inventory, STEP))
                     else {'eligible': False, 'reasons': ['exit_reference_minimum_or_unknown']})
    benchmark_receipts.append(benchmark_end)
    final_nav = update_valuation(last_bar.close, end_us)
    final_book = account.book_nav(last_bar.close)
    month_rows, daily_rows = [], []
    previous_nav = previous_book = D(15)
    for row in monthly.values():
        month_rows.append({**row, 'start_nav': previous_nav, 'net_pnl': row['end_nav'] - previous_nav,
                           'book_start_nav': previous_book, 'book_net_pnl': row['book_end_nav'] - previous_book})
        previous_nav, previous_book = row['end_nav'], row['book_end_nav']
    previous_nav = previous_book = D(15)
    for row in daily.values():
        daily_rows.append({**row, 'start_nav': previous_nav, 'net_pnl': row['end_nav'] - previous_nav,
                           'book_start_nav': previous_book, 'book_net_pnl': row['book_end_nav'] - previous_book})
        previous_nav, previous_book = row['end_nav'], row['book_end_nav']
    wins = [trade['net_pnl'] for trade in trades if trade['net_pnl'] > 0]
    losses = [trade['net_pnl'] for trade in trades if trade['net_pnl'] < 0]
    total_win, total_loss = sum(wins, D(0)), -sum(losses, D(0))
    net = final_nav - D(15)
    entries = sum(event['side'] == 'BUY' for event in account.events)
    return {
        'status': 'COMPLETE', 'profitability_label': 'RETROSPECTIVE_SCENARIO_ONLY',
        'case': asdict(case), 'model_id': MODEL_ID, 'parameters': PARAMETERS,
        'start_us': start_us, 'end_us_exclusive': end_us, 'initial_cash': D(15),
        'final_cash': account.cash, 'final_inventory_btc': account.inventory,
        'final_executable_nav': final_nav, 'final_book_nav': final_book,
        'owned_inventory_book_mark': account.inventory * last_bar.close,
        'book_minus_executable_nav': final_book - final_nav,
        'net_pnl': net, 'net_return_fraction': net / D(15),
        'book_net_pnl': final_book - D(15),
        'max_drawdown': max_dd, 'max_drawdown_fraction': max_dd_fraction,
        'book_max_drawdown': book_max_dd, 'drawdown_sampling': 'ONE_MINUTE_CLOSE_AND_TERMINAL',
        'entry_episodes': entry_count, 'exit_signals': exit_signal_count, 'entries': entries,
        'closed_trades': len(trades), 'open_position_at_end': position is not None,
        'stranded_active_position': position is not None,
        'expectancy': sum((trade['net_pnl'] for trade in trades), D(0)) / D(len(trades)) if trades else None,
        'profit_factor': total_win / total_loss if total_loss else None,
        'win_rate': D(len(wins)) / D(len(trades)) if trades else None,
        'total_closed_cash_pnl': sum((trade['net_pnl'] for trade in trades), D(0)),
        'minutes_exposed': minutes_exposed, 'cap_violations': cap_violations,
        'losses_above_planned_risk': sum(trade['loss_exceeded_planned_risk'] for trade in trades),
        'daily_calendar': 'Asia/Ho_Chi_Minh; partial boundary days included',
        'positive_days': sum(row['net_pnl'] > 0 for row in daily_rows),
        'negative_days': sum(row['net_pnl'] < 0 for row in daily_rows),
        'days_without_entry': sum(row['entries'] == 0 for row in daily_rows),
        'days_without_fills': sum(row['entries'] + row['exits'] == 0 for row in daily_rows),
        'skips': dict(skips), 'exit_reasons': dict(exit_reasons),
        'buy_fee_btc': sum((event['base_fee'] for event in account.events), D(0)),
        'sell_fee_usdt': sum((event['quote_fee'] for event in account.events), D(0)),
        'ai_calls': 0, 'ai_actual_cost': D(0),
        'incremental_vps_cost': None, 'full_allocated_vps_cost': None,
        'all_cost_roi_validated': False, 'historical_filters_or_fills_verified': False,
        'buy_hold_final_executable_nav': executable_nav(benchmark, last_bar.close),
        'buy_hold_final_book_nav': benchmark.book_nav(last_bar.close),
        'buy_hold_net_pnl': executable_nav(benchmark, last_bar.close) - D(15),
        'buy_hold_inventory_btc': benchmark.inventory,
        'buy_hold_receipts': benchmark_receipts,
        'benchmark_risk_comparison': '12_USDT_BUY_PLUS_3_CASH; DIFFERENT_STOP_RISK',
        'market_first': market_first, 'market_last': last_bar.close, 'final_reference_proxy': proxy,
        'monthly': month_rows, 'daily': daily_rows, 'hourly': list(hourly.values()),
        'events': account.events, 'decisions': decisions, 'trades': trades,
    }


def required_runtime_paths() -> set[str]:
    backend = Path(__file__).resolve().parents[1]
    packages = {
        'spot_btc_trend': ('__init__.py', 'account.py', 'strategy.py', 'runner.py'),
        'spot_backtest': ('__init__.py', 'account.py', 'models.py'),
        'spot_aggressive_v3': ('__init__.py', 'account.py', 'dataset.py', 'models.py'),
    }
    return {str((backend / package / name).resolve())
            for package, names in packages.items() for name in names}


def canonical_json(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def validate_protocol(path: Path, expected_sha: str) -> tuple[dict, dict]:
    if sha(path) != expected_sha:
        raise ValueError('protocol file hash mismatch')
    protocol = json.loads(path.read_text())
    if (protocol.get('protocol_id') != 'spot-btc-ema600-v1' or
            canonical_json(protocol.get('parameters')) != canonical_json(PARAMETERS)):
        raise ValueError('unregistered protocol/parameters')
    wanted_cases = [
        {'name': 'base', 'slip': '.001', 'delay_seconds': 30, 'min_notional': '5', 'partial_fraction': '1'},
        {'name': 'stress', 'slip': '.003', 'delay_seconds': 120, 'min_notional': '5', 'partial_fraction': '1'},
    ]
    if canonical_json(protocol.get('cases')) != canonical_json(wanted_cases):
        raise ValueError('cases differ from frozen two-case contract')
    source_hashes = protocol.get('source_sha256')
    required = required_runtime_paths()
    if not isinstance(source_hashes, dict) or not required.issubset(source_hashes):
        raise ValueError('critical source registration absent')
    for source, expected in source_hashes.items():
        if not Path(source).is_absolute() or sha(Path(source)) != expected:
            raise ValueError('source hash mismatch: ' + source)
    data = protocol['data']
    data_dir = Path(data['data_dir'])
    if sha(data_dir / 'manifest.json') != data['manifest_sha256']:
        raise ValueError('data manifest hash mismatch')
    manifest = json.loads((data_dir / 'manifest.json').read_text())
    if manifest.get('status') != 'COMPLETE_VERIFIED' or manifest.get('market') != 'spot':
        raise ValueError('verified Spot data required')
    start, end = map(utc_us, (protocol['replay']['start_utc'], protocol['replay']['end_utc_exclusive']))
    warmup, data_end = map(utc_us, (data['start_utc'], data['end_utc_exclusive']))
    if warmup > start - 1300 * HOUR_US or end != data_end:
        raise ValueError('insufficient warmup or incompatible end boundary')
    if type(protocol['run_limits']['wall_cap_seconds']) is not int or protocol['run_limits']['wall_cap_seconds'] != 1200:
        raise ValueError('whole two-case wall cap must be 1200 seconds')
    return protocol, {'protocol_sha256': expected_sha, 'data_manifest_sha256': data['manifest_sha256'],
                      'source_sha256': source_hashes}


def verify_completed_identity(path: Path, expected_sha: str, initial_identity: dict) -> None:
    """A terminal COMPLETE receipt requires unchanged protocol/source/data."""
    _, final_identity = validate_protocol(path, expected_sha)
    if canonical_json(final_identity) != canonical_json(initial_identity):
        raise ValueError('registered identity changed during the run')


def main():
    launched = MODULE_STARTED
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--protocol', type=Path, required=True)
    parser.add_argument('--protocol-sha256', required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=False)
    execution_path = args.output_dir / 'execution.json'
    identity = {'requested_protocol_sha256': args.protocol_sha256,
                'protocol_path': str(args.protocol.resolve()), 'source_verified': False}
    save_json(execution_path, {'status': 'RUNNING', 'started_at_utc': datetime.now(timezone.utc).isoformat(),
                               **identity, 'financial_interpretation': 'RETROSPECTIVE_SCENARIO_ONLY'})
    summaries = []
    attempted_case = None
    try:
        deadline = launched + 1200
        if time.monotonic() >= deadline:
            raise TimeoutError('whole-run wall cap before protocol validation')
        protocol, verified_identity = validate_protocol(args.protocol, args.protocol_sha256)
        identity = {**verified_identity, 'source_verified': True}
        start, end = map(utc_us, (protocol['replay']['start_utc'], protocol['replay']['end_utc_exclusive']))
        warmup = utc_us(protocol['data']['start_utc'])
        data_dir = Path(protocol['data']['data_dir'])
        if time.monotonic() >= deadline:
            raise TimeoutError('whole-run wall cap before signal generation')
        verify_completed_identity(args.protocol, args.protocol_sha256, verified_identity)
        signals = list(generate_signals(iter_bars(data_dir, 'BTCUSDT', '1h', warmup, end)))
        verify_completed_identity(args.protocol, args.protocol_sha256, verified_identity)
        if time.monotonic() >= deadline:
            raise TimeoutError('whole-run wall cap reached while generating signals')
        save_json(args.output_dir / 'signals.json', [asdict(signal) for signal in signals])
        for configured in protocol['cases']:
            if time.monotonic() >= deadline:
                raise TimeoutError('whole-run wall cap before next case')
            verify_completed_identity(args.protocol, args.protocol_sha256, verified_identity)
            case = Case(configured['name'], D(configured['slip']), configured['delay_seconds'],
                        D(configured['min_notional']), D(configured['partial_fraction']))
            attempted_case = case.name
            print(json.dumps({'status': 'CASE_STARTED', 'case': case.name}), flush=True)
            result = run_replay(iter_bars(data_dir, 'BTCUSDT', '1m', start - 5 * MINUTE_US, end),
                                signals, case, start, end, deadline)
            verify_completed_identity(args.protocol, args.protocol_sha256, verified_identity)
            if time.monotonic() >= deadline:
                raise TimeoutError('whole-run wall cap after case replay')
            save_json(args.output_dir / (case.name + '.json'), result)
            summary = {key: result[key] for key in (
                'net_pnl', 'final_executable_nav', 'final_book_nav', 'entries', 'closed_trades',
                'profit_factor', 'max_drawdown', 'max_drawdown_fraction', 'open_position_at_end')}
            summaries.append({'case': case.name, **summary})
            print(json.dumps({'status': 'CASE_COMPLETE', **summaries[-1]}, default=json_default), flush=True)
        verify_completed_identity(args.protocol, args.protocol_sha256, verified_identity)
        if time.monotonic() >= deadline:
            raise TimeoutError('whole-run wall cap reached before completion receipt')
        save_json(execution_path, {'status': 'COMPLETE', 'completed_at_utc': datetime.now(timezone.utc).isoformat(),
                                   **identity, 'wall_seconds': time.monotonic() - launched,
                                   'peak_memory_kib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                                   'financial_interpretation': 'RETROSPECTIVE_SCENARIO_ONLY', 'summaries': summaries})
    except BaseException as exc:
        save_json(execution_path, {'status': 'FAILED_INCOMPLETE', 'error': repr(exc),
                                   **identity, 'wall_seconds': time.monotonic() - launched,
                                   'peak_memory_kib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                                   'attempted_case': attempted_case,
                                   'partial_case_summaries': summaries,
                                   'partial_results_valid_for_roi': False})
        raise


if __name__ == '__main__':
    main()
