"""One shared streaming market pass; four independent conditional100USDT books.

Gap stops precede delayedOPEN model actions. IntrabarLOW stops followOPEN
actions and release proceeds only at the completed minuteEND.
A rotation buy at minuteopen gets that minute's low protection; control buys
start protection next minute, preserving the frozen control's declared caveat.
"""
from __future__ import annotations
import time
MODULE_STARTED = time.monotonic()
import argparse
from collections import Counter, deque
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, localcontext
import hashlib
import json
from pathlib import Path
import resource
import signal
from typing import Iterable, Mapping

from spot_backtest.models import Bar, MINUTE_US, HOUR_US, DAY_US
from spot_aggressive_v3.dataset import iter_bars
from spot_btc_trend.strategy import validate_bar
from .account import Account, D, floor

PARAMETERS = {
    'capital_total_spot_usdt': '100', 'deposit_confirmed': False,
    'deployment_fraction': '.80', 'cash_reserve_fraction': '.20',
    'per_entry_risk_fraction': '.20', 'VN_daily_loss_fraction': '.20',
    'fixed_USDT_risk_cap': None, 'buy_fee_base_fraction': '.001', 'sell_fee_quote_fraction': '.001',
    'fee_quantum': '.00000001', 'one_active_position': True, 'carried_owned_dust': True,
    'cooldown_seconds_after_any_sale': 3600, 'entry_target_TTL_seconds': 7200,
    'candidate_entry_attempts_per_daily_decision': 1,
    'candidate_reentry_on_UTC_stop_day': False, 'candidate_initial_stop': 'ACTUAL_FILL_MINUS_2_CLOSED_DAILY_ATR14',
    'candidate_exit': 'DAILY_TARGET_CHANGE_OR_CASH_REGIME_OR_STATIC_STOP',
    'control_rule_identity': 'V1_RULES_CONTROL_100_2025_2026',
    'control_initial_stop_factor': '.85', 'control_trail_factor': '.85', 'control_target_factor': '11',
    'control_entry_minute_protection': 'UNVERIFIED_START_NEXT_MINUTE',
    'protection_priority': 'GAP_STOP_AT_OPEN_THEN_DUE_OPEN_ACTIONS_THEN_INTRABAR_LOW_STOP_AT_END',
    'intrabar_fill_time': 'MINUTE_END;UNKNOWN_TRUE_TRIGGER_TIME_WITH_RECORDED_INTERVAL',
    'tiny_ATR_stop_above_raw_OPEN': 'REJECT_ALREADY_TRIGGERED_SETUP',
    'control_executor_is_exact_frozen15baseline': False,
    'control_trail': 'CURRENT_HIGH_RAISES_STOP_ONLY_FOR_NEXT_MINUTE',
    'rotation_sell_before_buy': True, 'new_target_buy_after_sale': 'ONE_HOUR_COOLDOWN_PLUS_SECOND_CASE_DELAY',
    'minimum_reference': 'PRIOR5_COMPLETED_1M_QUOTE_VOLUME_DIV_BASE_VOLUME',
    'historical_or_actual_exchange_avgPrice_verified': False,
    'current_minute_execution_gate': 'BASE_VOLUME_GT0_AND_TRADE_COUNT_GT0',
    'empty_entry_quote': 'WAIT_FOR_NEXT_TRADED_MINUTE_WITHIN_ORIGINAL_TTL_NOT_AN_ENTRY_ATTEMPT',
    'empty_owned_mark': 'STALE_BOOK_PRICE_WITH_UNKNOWN_EXECUTION;NO_FILL_OR_TRAIL_UPDATE',
    'NAV_definition': 'CONDITIONAL_MODELED_LIQUIDATION_MARK_NOT_ACTUAL_FILLABLE_CASH',
    'latched_model_exit_priority': 'AFTER_FRESH_DAILY_DECISION;SAME_TARGET_CANCELS_ROTATION_EXIT',
    'old_hurdle_4xdrag_and_arbitrary_lot_gate': False,
    'daily_return_convention': '365_FULL_UTC_DAYS_SEPARATE_FROM366_VN_BOUNDARY_GUARD_ROWS',
    'terminal': 'LAST_COMPLETED_1M_CLOSE_WITH_MODELED_FEES_SLIPPAGE_AND_REFERENCE_MINIMUM',
    'wall_cap_seconds': 1800,
}

@dataclass(frozen=True)
class Case:
    name: str
    kind: str
    slip: Decimal
    delay_seconds: int

CASES = (Case('rotation_base', 'rotation', D('.001'), 30),
         Case('rotation_stress', 'rotation', D('.003'), 120),
         Case('control_base', 'control', D('.001'), 30),
         Case('control_stress', 'control', D('.003'), 120))


def iso(at: int) -> str:
    second, micro = divmod(at, 1_000_000)
    return datetime.fromtimestamp(second, timezone.utc).replace(microsecond=micro).isoformat()


def utc_us(value: str) -> int:
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is None or dt.utcoffset().total_seconds() != 0:
        raise ValueError('explicitUTC required')
    delta = dt - datetime(1970, 1, 1, tzinfo=timezone.utc)
    return (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds


def encode(value):
    if isinstance(value, D):
        if not value.is_finite(): raise ValueError('nonfinite output')
        return str(value)
    if isinstance(value, Mapping): return {k: encode(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)): return [encode(v) for v in value]
    if type(value) in (str, int, bool) or value is None: return value
    raise ValueError('float or unknown output type')


def save(path: Path, value) -> None:
    path.write_text(json.dumps(encode(value), indent=2, sort_keys=True) + '\n')


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(65536), b''): digest.update(chunk)
    return digest.hexdigest()


class History:
    def __init__(self):
        self.bars = deque(maxlen=5)
        self.volume = self.quote = D(0)
        self.proxy = None
    def append(self, bar: Bar):
        with localcontext() as context:
            context.prec = 50
            if len(self.bars) == 5:
                old = self.bars[0]
                self.volume -= old.volume; self.quote -= old.quote_volume
            self.bars.append(bar)
            self.volume += bar.volume; self.quote += bar.quote_volume
            self.proxy = self.quote / self.volume if len(self.bars) == 5 and self.volume > 0 else None


def traded(bar: Bar) -> bool:
    """A carried price on a minute with no trades is not an executable quote."""
    return bar.volume > 0 and bar.trades > 0


class State:
    def __init__(self, case: Case, metadata):
        self.case = case
        self.account = Account(metadata, case.slip)
        self.position = self.pending = None
        self.cooldown_until = 0
        self.stop_UTC_day = None
        self.current_VN_day = None
        self.current_month = None
        self.day_start = D(100)
        self.day_paused = False
        self.decisions = []; self.trades = []
        self.skips = Counter(); self.exits = Counter()
        self.seen = set()
        self.VN_daily = {}; self.monthly = {}; self.hourly = []; self.UTC_daily = []
        self.peak = self.book_peak = D(100)
        self.max_dd = self.max_dd_fraction = self.book_max_dd = D(0)
        self.minutes_exposed = self.signal_count = 0
        self.last_nav = self.last_book = D(100)
        self.cap_violations = []
        self.empty_counts = Counter()
        self.last_quote_evidence = {}

    def skip(self, identity, reason, at, **extra):
        self.skips[reason] += 1
        self.decisions.append({'decision_id': identity, 'timestamp_us': at, 'decision': 'SKIP', 'reason': reason, **extra})

    def boundaries(self, at, references, proxies):
        day = (at + 7 * HOUR_US) // DAY_US
        if day != self.current_VN_day:
            self.current_VN_day = day
            self.day_start = self.account.nav(references, proxies)
            self.day_paused = False
            self.VN_daily[day] = {'date_VN': iso(at + 7 * HOUR_US)[:10],
                                  'guard_start_nav': self.day_start, 'loss_budget': self.day_start * D('.20'),
                                  'entries': 0, 'exits': 0, 'minutes_exposed': 0}
        if self.current_month is None or at % DAY_US == 0:
            self.current_month = iso(at)[:7]
            if self.current_month not in self.monthly:
                self.monthly[self.current_month] = {'month_UTC': self.current_month, 'entries': 0, 'closed_trades': 0}

    def headroom(self, references, proxies):
        nav = self.account.nav(references, proxies)
        remaining = max(D(0), self.day_start * D('.20') - max(D(0), self.day_start - nav))
        if remaining <= 0: self.day_paused = True
        return D(0) if self.day_paused else remaining

    def exit(self, reference, at, reason, references, proxies, minute_open_us, current_bar):
        if self.position is None: return False
        p = self.position; symbol = p['symbol']
        if current_bar.open_us != minute_open_us or not current_bar.open_us <= at <= current_bar.close_us + 1:
            raise ValueError('exit quote does not cover event time')
        receipt = (self.account.sell(symbol, reference, proxies.get(symbol), at, reason)
                   if traded(current_bar) else {'eligible': False, 'reasons': ['CURRENT_MINUTE_HAS_NO_TRADES']})
        if receipt['eligible'] is not True:
            if reason.startswith('STOP') or p['latched_exit'] is None: p['latched_exit'] = reason
            codes = '|'.join(receipt['reasons'])
            if (reason, codes) not in p['blocked']:
                p['blocked'].add((reason, codes))
                self.decisions.append({'timestamp_us': at, 'decision': 'EXIT_BLOCKED', 'symbol': symbol,
                                       'reason': reason, 'filter_reasons': receipt['reasons'],
                                       'reference': reference, 'reference_proxy': proxies.get(symbol)})
                self.skips['EXIT_BLOCKED:' + codes] += 1
            return False
        self.account.events[-1]['execution_reference_kind'] = (
            'OPEN_RETRY' if reason == 'STOP_RETRY_OPEN' else
            'TERMINAL_CLOSE' if reason == 'END_OF_DATA' else
            'MINUTE_OPEN' if at == current_bar.open_us else 'INTRABAR_PROTECTIVE_LEVEL')
        pnl = self.account.cash - p['cash_before']
        self.trades.append({'symbol': symbol, 'episode_id': p['identity'], 'entry_us': p['entry_us'], 'exit_us': at,
                            'entry_price': p['entry_price'], 'exit_price': receipt['price'],
                            'entry_cost': p['entry_cost'], 'cash_before_entry': p['cash_before'],
                            'cash_after_sale': self.account.cash, 'net_cash_pnl': pnl,
                            'pnl_convention': 'CASH_CHANGE_INCLUDING_OWNED_CARRIED_DUST',
                            'planned_risk': p['planned_risk'], 'loss_exceeded_planned_risk': -pnl > p['planned_risk'],
                            'initial_stop': p['initial_stop'], 'final_stop': p['stop'],
                            'hold_seconds': D(at - p['entry_us']) / D(1_000_000), 'exit_reason': reason})
        self.exits[reason] += 1
        self.VN_daily[self.current_VN_day]['exits'] += 1
        self.monthly[iso(minute_open_us)[:7]]['closed_trades'] += 1
        self.cooldown_until = at + HOUR_US
        self.position = None
        if reason.startswith('STOP'):
            self.stop_UTC_day = minute_open_us // DAY_US
            if self.pending:
                self.skip(self.pending['identity'], 'STOP_CANCELLED_PENDING_TARGET', at)
                self.pending = None
        elif self.pending:
            self.pending['due_us'] = max(self.pending['due_us'], self.cooldown_until + self.case.delay_seconds * 1_000_000)
        return True

    def gap_protection(self, bars, references, proxies):
        p = self.position
        if p is None: return
        bar = bars[p['symbol']]
        if not traded(bar): return
        if p['latched_exit'] and p['latched_exit'].startswith('STOP'):
            self.exit(bar.open, bar.open_us, 'STOP_RETRY_OPEN', references, proxies, bar.open_us, bar)
            if self.position is None: return
            p = self.position
        if bar.open <= p['stop']:
            self.exit(bar.open, bar.open_us, 'STOP_GAP', references, proxies, bar.open_us, bar)

    def intrabar_protection(self, bars, references, proxies):
        p = self.position
        if p is None: return
        bar = bars[p['symbol']]
        if not traded(bar): return
        if self.case.kind == 'control' and p['entry_us'] == bar.open_us: return
        # A failed gap exit cannot be retried at a higher old stop later in the
        # same candle. Its actual quote was the OPEN, and its STOP remains latched.
        if bar.open <= p['stop']: return
        if p['target'] is not None and bar.open >= p['target']:
            self.exit(p['target'], bar.open_us, 'TARGET_GAP', references, proxies, bar.open_us, bar)
        elif bar.low <= p['stop']:
            before = len(self.account.events)
            self.exit(p['stop'], bar.close_us + 1, 'STOP', references, proxies, bar.open_us, bar)
            if len(self.account.events) > before:
                self.account.events[-1]['trigger_reference_interval_us'] = [bar.open_us, bar.close_us]
                self.account.events[-1]['true_intrabar_trigger_time_known'] = False
                self.account.events[-1]['ledger_proceeds_available_us'] = bar.close_us + 1
        elif p['target'] is not None and bar.high >= p['target']:
            before = len(self.account.events)
            self.exit(p['target'], bar.close_us + 1, 'TARGET_INTRABAR', references, proxies, bar.open_us, bar)
            if len(self.account.events) > before:
                self.account.events[-1]['trigger_reference_interval_us'] = [bar.open_us, bar.close_us]
                self.account.events[-1]['true_intrabar_trigger_time_known'] = False
                self.account.events[-1]['ledger_proceeds_available_us'] = bar.close_us + 1

    def candidate(self, decision, at):
        identity = decision.decision_id
        if identity in self.seen: raise ValueError('duplicateDailyDecision')
        self.seen.add(identity); self.signal_count += 1
        target = decision.target_symbol
        self.decisions.append({'decision_id': identity, 'timestamp_us': at, 'signal_us': decision.at_us,
                               'decision': 'DAILY_TARGET', 'target_symbol': target,
                               'momentum': dict(decision.momentum), 'daily_atr14': dict(decision.atr14)})
        if self.pending:
            self.skip(self.pending['identity'], 'SUPERSEDED_BY_NEW_DAILY_DECISION', at)
            self.pending = None
        if self.position is not None and self.position['symbol'] == target:
            self.position['model_exit_due'] = None
            if self.position['latched_exit'] == 'ROTATION_EXIT':
                self.position['latched_exit'] = None
                self.decisions.append({'decision_id': identity, 'timestamp_us': at, 'decision': 'CANCEL_SUPERSEDED_ROTATION_EXIT'})
            self.decisions.append({'decision_id': identity, 'timestamp_us': at, 'decision': 'HOLD', 'symbol': target})
            return
        if self.position is not None:
            self.position['model_exit_due'] = at + self.case.delay_seconds * 1_000_000
        if target is None: return
        if self.stop_UTC_day == at // DAY_US:
            self.skip(identity, 'NO_REENTRY_ON_UTC_STOP_DAY', at); return
        self.pending = {'identity': identity, 'symbol': target, 'signal_us': decision.at_us,
                        'atr14': decision.atr14[target], 'expiry_us': decision.at_us + 2 * HOUR_US,
                        'due_us': max(at + self.case.delay_seconds * 1_000_000,
                                      self.cooldown_until + self.case.delay_seconds * 1_000_000)}

    def control(self, signal, at):
        if signal.signal_id in self.seen: raise ValueError('duplicateControlSignal')
        self.seen.add(signal.signal_id); self.signal_count += 1
        if signal.kind == 'EXIT':
            if self.pending:
                self.skip(self.pending['identity'], 'CONTROL_EXIT_CANCELLED_PENDING', at); self.pending = None
            if self.position is not None:
                self.position['model_exit_due'] = at + self.case.delay_seconds * 1_000_000
            return
        if signal.kind != 'ENTRY': raise ValueError('unknownControlSignal')
        if self.position is not None or self.pending:
            self.skip(signal.signal_id, 'POSITION_OR_PENDING_OCCUPIED', at); return
        self.pending = {'identity': signal.signal_id, 'symbol': 'BTCUSDT', 'signal_us': signal.at_us,
                        'atr14': None, 'expiry_us': signal.at_us + 2 * HOUR_US,
                        'due_us': max(at + self.case.delay_seconds * 1_000_000,
                                      self.cooldown_until + self.case.delay_seconds * 1_000_000)}

    def actions(self, bars, references, proxies):
        at = next(iter(bars.values())).open_us
        p = self.position
        if p is not None and p['latched_exit'] and not p['latched_exit'].startswith('STOP'):
            bar = bars[p['symbol']]
            self.exit(bar.open, at, p['latched_exit'], references, proxies, at, bar)
            p = self.position
        if p is not None and p['model_exit_due'] is not None and at >= p['model_exit_due']:
            self.exit(bars[p['symbol']].open, at, 'ROTATION_EXIT' if self.case.kind == 'rotation' else 'EMA_EXIT',
                      references, proxies, at, bars[p['symbol']])
        pending = self.pending
        if pending is None: return
        if at > pending['expiry_us']:
            self.skip(pending['identity'], 'TARGET_TTL_EXPIRED', at); self.pending = None; return
        if at < pending['due_us'] or self.position is not None: return
        if at < self.cooldown_until:
            pending['due_us'] = self.cooldown_until + self.case.delay_seconds * 1_000_000; return
        if self.case.kind == 'rotation' and self.stop_UTC_day == at // DAY_US:
            self.skip(pending['identity'], 'NO_REENTRY_ON_UTC_STOP_DAY', at); self.pending = None; return
        symbol = pending['symbol']; bar = bars[symbol]
        if not traded(bar):
            self.empty_counts['pending_entry_deferred_minutes'] += 1
            pending['empty_wait_minutes'] = pending.get('empty_wait_minutes', 0) + 1
            if pending['empty_wait_minutes'] == 1:
                self.decisions.append({'decision_id': pending['identity'], 'timestamp_us': at,
                                       'decision': 'WAIT', 'reason': 'CURRENT_MINUTE_HAS_NO_TRADES',
                                       'entry_attempt_consumed': False, 'expiry_us': pending['expiry_us']})
            return
        headroom = self.headroom(references, proxies)
        distance = (2 * pending['atr14'] if self.case.kind == 'rotation'
                    else self.account.price(symbol, bar.open, buy=True) * D('.15'))
        plan = self.account.plan_entry(symbol, bar.open, distance, headroom, references, proxies)
        self.pending = None  # One actual entry attempt, including rejected plans.
        if plan['eligible'] is not True:
            self.skip(pending['identity'], '|'.join(plan['reasons']), at, plan=plan); return
        cash_before = self.account.cash
        receipt = self.account.buy(plan, at, pending['identity'])
        if receipt['eligible'] is not True:
            raise ValueError('registered planner produced unapplicable buy')
        self.position = {'symbol': symbol, 'identity': pending['identity'], 'entry_us': at,
                         'entry_price': receipt['price'], 'entry_cost': receipt['gross_quote'],
                         'cash_before': cash_before, 'planned_risk': plan['planned_risk'],
                         'initial_stop': plan['stop'], 'stop': plan['stop'],
                         'target': receipt['price'] * 11 if self.case.kind == 'control' else None,
                         'model_exit_due': None, 'latched_exit': None, 'blocked': set()}
        self.VN_daily[self.current_VN_day]['entries'] += 1
        self.monthly[iso(at)[:7]]['entries'] += 1
        if (receipt['cash_after'] < plan['cash_reserve_required'] or plan['reserved_cost'] > plan['before_nav'] * D('.80')
                or plan['planned_risk'] > min(plan['before_nav'] * D('.20'), headroom)):
            self.cap_violations.append({'timestamp_us': at, 'plan': plan})
        self.decisions.append({'decision_id': pending['identity'], 'signal_us': pending['signal_us'],
                               'timestamp_us': at, 'decision': 'BUY', 'symbol': symbol,
                               'reference_open': bar.open, 'reference_proxy': proxies.get(symbol),
                               'plan': plan, 'empty_quote_wait_minutes': pending.get('empty_wait_minutes', 0),
                               'entry_minute_protection': self.case.kind == 'rotation'})

    def valuation(self, references, proxies, at, minute_open_us, bars):
        nav = self.account.nav(references, proxies); book = self.account.nav(references, proxies, book=True)
        evidence = {s: {'current_minute_traded': traded(bars[s]), 'prior5_minimum_proxy_known': proxies.get(s) is not None,
                        'owned_quantity': q, 'mark_is_execution_evidence': traded(bars[s]) and proxies.get(s) is not None}
                    for s, q in self.account.inventory.items() if q >= self.account.markets[s]['min_qty']}
        self.last_quote_evidence = evidence
        for s, item in evidence.items():
            if not item['current_minute_traded']: self.empty_counts['owned_' + s + '_empty_mark_minutes'] += 1
            if not item['prior5_minimum_proxy_known']: self.empty_counts['owned_' + s + '_unknown_proxy_mark_minutes'] += 1
        verified = all(item['mark_is_execution_evidence'] for item in evidence.values())
        self.peak = max(self.peak, nav); self.book_peak = max(self.book_peak, book)
        self.max_dd = max(self.max_dd, self.peak - nav)
        self.max_dd_fraction = max(self.max_dd_fraction, (self.peak - nav) / self.peak)
        self.book_max_dd = max(self.book_max_dd, self.book_peak - book)
        if self.day_start - nav >= self.day_start * D('.20'): self.day_paused = True
        self.last_nav, self.last_book = nav, book
        self.VN_daily[self.current_VN_day].update(end_nav=nav, book_end_nav=book, day_paused=self.day_paused)
        self.monthly[self.current_month].update(end_nav=nav, book_end_nav=book)
        if at % HOUR_US == 0:
            self.hourly.append({'timestamp_us': at, 'nav': nav, 'book_nav': book,
                                'conditional_mark_has_current_execution_evidence': verified,
                                'owned_asset_quote_evidence': evidence})
        if at % DAY_US == 0:
            self.UTC_daily.append({'end_us': at, 'date_UTC': iso(at - DAY_US)[:10],
                                   'end_nav': nav, 'book_end_nav': book,
                                   'conditional_mark_has_current_execution_evidence': verified,
                                   'owned_asset_quote_evidence': evidence})

    def finish(self, references, proxies, end_us, bars):
        if self.position is not None:
            symbol = self.position['symbol']
            bar = bars[symbol]
            self.exit(references[symbol], end_us, 'END_OF_DATA', references, proxies, bar.open_us, bar)
        if self.pending:
            self.skip(self.pending['identity'], 'PENDING_AT_END_OF_DATA', end_us); self.pending = None
        nav = self.account.nav(references, proxies); book = self.account.nav(references, proxies, book=True)
        self.last_nav, self.last_book = nav, book
        self.last_quote_evidence = {s: {'current_minute_traded': traded(bars[s]),
                                       'prior5_minimum_proxy_known': proxies.get(s) is not None,
                                       'owned_quantity': q,
                                       'mark_is_execution_evidence': traded(bars[s]) and proxies.get(s) is not None}
                                   for s, q in self.account.inventory.items() if q >= self.account.markets[s]['min_qty']}
        verified = all(item['mark_is_execution_evidence'] for item in self.last_quote_evidence.values())
        # Terminal liquidation belongs to the final completed UTC day/month,
        # never creates an additional day or duplicates the last hour.
        self.VN_daily[self.current_VN_day].update(end_nav=nav, book_end_nav=book)
        self.monthly[iso(end_us - 1)[:7]].update(end_nav=nav, book_end_nav=book)
        if self.hourly and self.hourly[-1]['timestamp_us'] == end_us:
            self.hourly[-1].update(nav=nav, book_nav=book,
                                  conditional_mark_has_current_execution_evidence=verified,
                                  owned_asset_quote_evidence=self.last_quote_evidence)
        if self.UTC_daily and self.UTC_daily[-1]['end_us'] == end_us:
            self.UTC_daily[-1].update(end_nav=nav, book_end_nav=book,
                                     conditional_mark_has_current_execution_evidence=verified,
                                     owned_asset_quote_evidence=self.last_quote_evidence)
        self.peak = max(self.peak, nav); self.max_dd = max(self.max_dd, self.peak - nav)
        self.max_dd_fraction = max(self.max_dd_fraction, (self.peak - nav) / self.peak)
        self.book_peak = max(self.book_peak, book); self.book_max_dd = max(self.book_max_dd, self.book_peak - book)

    def result(self, start_us, end_us, references, proxies):
        with localcontext() as context:
            context.prec = 50
            previous = previous_book = D(100)
            previous_verified = True
            for row in self.UTC_daily:
                row.update(start_nav=previous, net_pnl=row['end_nav'] - previous,
                           daily_equity_return=row['end_nav'] / previous - 1,
                           complete_UTC_24h_day=row['end_us'] - DAY_US >= start_us,
                           return_interval_start_us=max(start_us, row['end_us'] - DAY_US),
                           daily_equity_return_has_execution_evidence=previous_verified and row['conditional_mark_has_current_execution_evidence'],
                           book_start_nav=previous_book, book_net_pnl=row['book_end_nav'] - previous_book)
                previous, previous_book = row['end_nav'], row['book_end_nav']
                previous_verified = row['conditional_mark_has_current_execution_evidence']
            previous = previous_book = D(100)
            for row in self.monthly.values():
                row.update(start_nav=previous, net_pnl=row['end_nav'] - previous,
                           book_start_nav=previous_book, book_net_pnl=row['book_end_nav'] - previous_book)
                previous, previous_book = row['end_nav'], row['book_end_nav']
            days = D(end_us - start_us) / D(DAY_US)
            net = self.last_nav - D(100)
            full_daily = [r for r in self.UTC_daily if r['complete_UTC_24h_day']]
            daily_mean = (sum((r['daily_equity_return'] for r in full_daily), D(0)) / D(len(full_daily))
                          if full_daily else None)
            wins = [t['net_cash_pnl'] for t in self.trades if t['net_cash_pnl'] > 0]
            losses = [-t['net_cash_pnl'] for t in self.trades if t['net_cash_pnl'] < 0]
            target_evidence = (self.position is None and bool(full_daily)
                               and all(r['daily_equity_return_has_execution_evidence'] for r in full_daily))
            return {'status': 'COMPLETE', 'case': {'name': self.case.name, 'kind': self.case.kind,
                    'slip': self.case.slip, 'delay_seconds': self.case.delay_seconds},
                    'capital_is_conditional_not_deposit_receipt': True, 'initial_cash': D(100),
                    'start_us': start_us, 'end_us_exclusive': end_us, 'UTC_elapsed_days': days,
                    'final_cash': self.account.cash, 'final_inventories': dict(self.account.inventory),
                    'final_executable_nav': self.last_nav, 'final_book_nav': self.last_book,
                    'final_conditional_liquidation_nav': self.last_nav,
                    'NAV_definition': PARAMETERS['NAV_definition'],
                    'modeled_nav_minus_actual_cash': self.last_nav - self.account.cash,
                    'owned_inventory_book_value': self.last_book - self.account.cash,
                    'book_minus_executable_nav': self.last_book - self.last_nav,
                    'book_minus_conditional_exec_nav': self.last_book - self.last_nav,
                    'owned_dust_book_mark': sum((q * references[s] for s, q in self.account.inventory.items()
                                                if s != self.account.active_symbol), D(0)),
                    'owned_inventory_book_by_symbol': {s: q * references[s] for s, q in self.account.inventory.items()},
                    'terminal_active_symbol': self.account.active_symbol,
                    'stranded_active_position': self.position is not None,
                    'net_pnl': net, 'net_return_fraction': net / 100,
                    'mean_net_USDT_per_UTC_day': net / days,
                    'fixed_initial_average_daily_fraction': net / (100 * days),
                    'mean_daily_start_equity_return': daily_mean,
                    'geometric_daily_equivalent_return': ((self.last_nav / 100).ln() / days).exp() - 1 if self.last_nav > 0 else D(-1),
                    'primary_1pct_daily_equity_mean_met_retrospectively': daily_mean >= D('.01') if target_evidence else None,
                    'secondary_initial1USDT_daily_average_met_retrospectively': net / days >= 1 if target_evidence else None,
                    'target_execution_evidence_status': 'SCENARIO_ENDPOINTS_VERIFIED' if target_evidence else 'UNVALIDATED_UNKNOWN_QUOTE_OR_STRANDED_POSITION',
                    'all_system_target_validated': False, 'all_system_roi': 'UNKNOWN_VPS_COST',
                    'closed_trades': len(self.trades), 'filled_entries': sum(e['side'] == 'BUY' for e in self.account.events),
                    'signals': self.signal_count, 'profit_factor': sum(wins) / sum(losses) if losses else None,
                    'closed_trade_expectancy': sum((t['net_cash_pnl'] for t in self.trades), D(0)) / len(self.trades) if self.trades else None,
                    'minutes_exposed': self.minutes_exposed, 'max_drawdown': self.max_dd,
                    'max_drawdown_fraction': self.max_dd_fraction, 'book_max_drawdown': self.book_max_dd,
                    'drawdown_sampling': 'ONE_MINUTE_CLOSE_AND_POST_TERMINAL',
                    'daily_UTC': self.UTC_daily, 'daily_VN_guards': list(self.VN_daily.values()),
                    'full_UTC_24h_daily_return_count': len(full_daily),
                    'monthly': list(self.monthly.values()), 'hourly': self.hourly,
                    'events': self.account.events, 'trades': self.trades, 'decisions': self.decisions,
                    'skips': dict(self.skips), 'exit_reasons': dict(self.exits), 'cap_violations': self.cap_violations,
                    'fees_base_by_symbol': {s: sum((e['base_fee'] for e in self.account.events if e['symbol'] == s), D(0)) for s in self.account.markets},
                    'fees_USDT': sum((e['quote_fee'] for e in self.account.events), D(0)),
                    'terminal_references': dict(references), 'terminal_reference_proxies': dict(proxies),
                    'terminal_owned_asset_quote_evidence': self.last_quote_evidence,
                    'empty_minute_counts': dict(self.empty_counts),
                    'market_filter_scenario': self.account.markets,
                    'fees_slippage_rounding_already_in_NAV': True,
                    'historical_filters_fills_or_actual_avgPrice_verified': False,
                    'provider_calls': 0, 'financial_interpretation': 'RETROSPECTIVE_SCENARIO_ONLY'}


def run_cases(streams: Mapping[str, Iterable[Bar]], candidate_decisions: Iterable,
              control_signals: Iterable, metadata: Mapping, start_us: int, end_us: int,
              deadline: float, *, include_controls: bool = True) -> dict:
    if start_us % MINUTE_US or end_us % MINUTE_US or start_us >= end_us:
        raise ValueError('aligned nonempty minute interval')
    states = [State(case, metadata) for case in CASES if include_controls or case.kind != 'control']
    if set(streams) != set(states[0].account.markets): raise ValueError('marketstream/metadata mismatch')
    if include_controls and 'BTCUSDT' not in streams: raise ValueError('BTCcontrolstream required')
    iterators = {s: iter(source) for s, source in streams.items()}
    histories = {s: History() for s in streams}
    previous = {s: None for s in streams}
    candidates, controls = iter(candidate_decisions), iter(control_signals)
    next_candidate = next(candidates, None); next_control = next(controls, None) if include_controls else None
    previous_candidate = previous_control = -1
    first_expected = None
    main_rows = 0
    references = {}; proxies = {}; last_close = None; bars_last = None
    while True:
        if main_rows % 256 == 0 and time.monotonic() >= deadline: raise TimeoutError('whole4case1800second wall cap reached')
        bars = {symbol: next(iterator, None) for symbol, iterator in iterators.items()}
        if all(bar is None for bar in bars.values()): break
        if any(bar is None for bar in bars.values()): raise ValueError('marketstreams end at different timestamps')
        at = next(iter(bars.values())).open_us
        if first_expected is None: first_expected = at
        if at >= end_us: raise ValueError('minute beyond registered exclusiveend')
        for symbol, bar in bars.items():
            validate_bar(bar, MINUTE_US, previous[symbol]); previous[symbol] = bar.open_us
            if bar.open_us != at: raise ValueError('unsynchronizedmarketstreams')
        if at < start_us:
            for symbol, bar in bars.items(): histories[symbol].append(bar)
            continue
        if main_rows == 0 and at != start_us: raise ValueError('missing leadingmain minute')
        main_rows += 1; last_close = at + MINUTE_US; bars_last = bars
        references = {symbol: bar.open for symbol, bar in bars.items()}
        proxies = {symbol: histories[symbol].proxy for symbol in bars}
        for state in states:
            state.boundaries(at, references, proxies)
            state.gap_protection(bars, references, proxies)
        while next_candidate is not None and next_candidate.at_us <= at:
            decision = next_candidate
            if decision.at_us <= previous_candidate: raise ValueError('unorderedDailyDecision')
            previous_candidate = decision.at_us
            if decision.at_us >= start_us:
                if decision.at_us != at or decision.at_us % DAY_US: raise ValueError('lateorunaligneddailydecision')
                for state in states:
                    if state.case.kind == 'rotation': state.candidate(decision, at)
            next_candidate = next(candidates, None)
        while next_control is not None and next_control.at_us <= at:
            signal = next_control
            if signal.at_us <= previous_control: raise ValueError('unorderedControlSignal')
            previous_control = signal.at_us
            if signal.at_us >= start_us:
                if signal.at_us != at or signal.at_us % HOUR_US: raise ValueError('lateorunalignedcontrolsignal')
                for state in states:
                    if state.case.kind == 'control': state.control(signal, at)
            next_control = next(controls, None)
        for state in states:
            state.actions(bars, references, proxies)
            if state.position is not None:
                state.minutes_exposed += 1
                state.VN_daily[state.current_VN_day]['minutes_exposed'] += 1
            state.intrabar_protection(bars, references, proxies)
            if state.position is not None:
                if state.case.kind == 'control' and state.position['entry_us'] != at:
                    p = state.position; tick = state.account.markets[p['symbol']]['tick']
                    if traded(bars[p['symbol']]):
                        p['stop'] = max(p['stop'], floor(bars[p['symbol']].high * D('.85'), tick))
        for symbol, bar in bars.items(): histories[symbol].append(bar)
        references = {symbol: bar.close for symbol, bar in bars.items()}
        proxies = {symbol: histories[symbol].proxy for symbol in bars}
        for state in states: state.valuation(references, proxies, at + MINUTE_US, at, bars)
    if last_close != end_us or main_rows != (end_us - start_us) // MINUTE_US:
        raise ValueError('emptyorincomplete fullmaincoverage')
    # Exhaust future signal suffixes for structural validation only; no outcome
    # features enter past choices. Signals outsidemain are never executed.
    for unused in candidates: pass
    if include_controls:
        for unused in controls: pass
    if time.monotonic() >= deadline: raise TimeoutError('whole4case1800second wall cap reached')
    for state in states: state.finish(references, proxies, end_us, bars_last)
    return {state.case.name: state.result(start_us, end_us, references, proxies) for state in states}


def required_source_paths():
    backend = Path(__file__).resolve().parents[1]
    names = ('spot_rotation/account.py', 'spot_rotation/runner.py', 'spot_rotation/strategy.py',
             'spot_aggressive_v3/dataset.py', 'spot_aggressive_v3/__init__.py',
             'spot_backtest/models.py', 'spot_backtest/__init__.py',
             'spot_btc_trend/strategy.py', 'spot_btc_trend/__init__.py')
    result = {str(backend / name) for name in names}
    optional_init = backend / 'spot_rotation/__init__.py'
    if optional_init.is_file(): result.add(str(optional_init))
    return result


def verify_registration(protocol, path, expected):
    from .strategy import STRATEGY_PARAMETERS, SYMBOLS
    if sha(path) != expected: raise ValueError('launchprotocolhash mismatch')
    canonical = lambda value: json.dumps(encode(value), sort_keys=True, separators=(',', ':'))
    if (canonical(protocol.get('parameters')) != canonical(PARAMETERS)
            or canonical(protocol.get('strategy_parameters')) != canonical(STRATEGY_PARAMETERS)
            or protocol.get('protocol_id') != 'spot-rotation100-v1'
            or protocol.get('main_start_utc') != '2025-10-01T00:00:00Z'
            or protocol.get('main_end_utc_exclusive') != '2026-10-01T00:00:00Z'):
        raise ValueError('registeredparameters/strategy/mainrange mismatch')
    registered = utc_us(protocol['registered_at_utc'])
    if registered > utc_us(datetime.now(timezone.utc).isoformat()): raise ValueError('future registration')
    pins = protocol.get('source_sha256')
    if not isinstance(pins, dict) or not required_source_paths() <= set(pins):
        raise ValueError('mandatorysource/dependency pins missing')
    for name, fingerprint in pins.items():
        if (str(Path(name).resolve()) != name or type(fingerprint) is not str
                or len(fingerprint) != 64 or sha(Path(name)) != fingerprint):
            raise ValueError('sourcepin mismatch:' + name)
    ranges = {'minute': ('2025-09-01T00:00:00Z', '2026-10-01T00:00:00Z'),
              'hourly': ('2025-07-01T00:00:00Z', '2026-10-01T00:00:00Z'),
              'old_BTC_hourly': ('2023-04-01T00:00:00Z', '2025-10-01T00:00:00Z')}
    if set(protocol['datasets']) != set(ranges): raise ValueError('exactdatasets required')
    for name, dataset in protocol['datasets'].items():
        data_dir = Path(dataset['data_dir'])
        if str(data_dir.resolve()) != dataset['data_dir']: raise ValueError('absolute datadirectory required')
        manifest_path = data_dir / 'manifest.json'
        if sha(manifest_path) != dataset['manifest_sha256']: raise ValueError('datamanifestpin mismatch')
        manifest = json.loads(manifest_path.read_text())
        coverage = manifest.get('requested_coverage', {})
        begin, end = ranges[name]
        if (manifest.get('status') != 'COMPLETE_VERIFIED' or manifest.get('market') != 'spot'
                or coverage.get('start_us') != utc_us(begin) or coverage.get('end_us_exclusive') != utc_us(end)):
            raise ValueError('complete pinnedSpotdataset range mismatch:' + name)
        for record in manifest['archives']:
            archive = data_dir / record['path']
            if archive.stat().st_size != record['bytes'] or sha(archive) != record['sha256']:
                raise ValueError('registeredarchive bytes/hash mismatch:' + str(archive))
    metadata_path = Path(protocol['metadata_path'])
    if str(metadata_path.resolve()) != protocol['metadata_path'] or sha(metadata_path) != protocol['metadata_sha256']:
        raise ValueError('absolute pinnedmarketmetadata required')
    metadata = json.loads(metadata_path.read_text())
    if sorted(record['symbol'] for record in metadata['symbols']) != list(SYMBOLS):
        raise ValueError('exactfixedsevenmarketmetadata required')


def main():
    from .strategy import iter_decisions, generate_control_signals
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--protocol', required=True, type=Path)
    parser.add_argument('--protocol-sha256', required=True)
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=False)
    deadline = MODULE_STARTED + 1800
    def hard_timeout(number, frame):
        raise TimeoutError('whole4case1800second process wall cap reached')
    signal.signal(signal.SIGALRM, hard_timeout)
    signal.setitimer(signal.ITIMER_REAL, max(.001, deadline - time.monotonic()))
    began = datetime.now(timezone.utc).isoformat()
    terminal = {'status': 'INCOMPLETE', 'started_at_utc': began, 'protocol_sha256': args.protocol_sha256,
                'provider_calls': 0, 'capital_is_conditional_not_deposit_receipt': True,
                'all_system_target_validated': False, 'cases_completed': []}
    try:
        if time.monotonic() >= deadline: raise TimeoutError('startupwallcap reached')
        protocol = json.loads(args.protocol.read_text()); verify_registration(protocol, args.protocol, args.protocol_sha256)
        start, end = utc_us(protocol['main_start_utc']), utc_us(protocol['main_end_utc_exclusive'])
        minute = protocol['datasets']['minute']; hourly = protocol['datasets']['hourly']; old = protocol['datasets']['old_BTC_hourly']
        metadata = json.loads(Path(protocol['metadata_path']).read_text())
        symbols = sorted(record['symbol'] for record in metadata['symbols'])
        streams = {s: iter_bars(Path(minute['data_dir']), s, '1m', start - 5 * MINUTE_US, end) for s in symbols}
        daily_streams = {s: iter_bars(Path(hourly['data_dir']), s, '1h', utc_us('2025-07-01T00:00:00Z'), end) for s in symbols}
        def control_hourly():
            yield from iter_bars(Path(old['data_dir']), 'BTCUSDT', '1h', utc_us('2023-04-01T00:00:00Z'), start)
            yield from iter_bars(Path(hourly['data_dir']), 'BTCUSDT', '1h', start, end)
        results = run_cases(streams, iter_decisions(daily_streams), generate_control_signals(control_hourly()),
                            metadata, start, end, deadline)
        verify_registration(protocol, args.protocol, args.protocol_sha256)
        for name, result in results.items():
            save(args.output_dir / (name + '.json'), result); terminal['cases_completed'].append(name)
        verify_registration(protocol, args.protocol, args.protocol_sha256)
        if time.monotonic() >= deadline: raise TimeoutError('wallcap includingoutputs reached')
        terminal['status'] = 'COMPLETE'
        terminal['artifact_hashes'] = {name + '.json': sha(args.output_dir / (name + '.json')) for name in results}
    except Exception as exc:
        terminal['status'] = 'INCOMPLETE' if isinstance(exc, TimeoutError) else 'FAILED'
        terminal['error'] = {'type': type(exc).__name__, 'message': str(exc)}
        terminal['partial_outputs_invalid_for_financial_conclusion'] = True
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    terminal.update(finished_at_utc=datetime.now(timezone.utc).isoformat(),
                    elapsed_seconds=D(str(time.monotonic() - MODULE_STARTED)),
                    peak_rss_KiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    save(args.output_dir / 'execution.json', terminal)
    print(json.dumps(encode(terminal), sort_keys=True), flush=True)
    raise SystemExit(0 if terminal['status'] == 'COMPLETE' else 2)

if __name__ == '__main__': main()
