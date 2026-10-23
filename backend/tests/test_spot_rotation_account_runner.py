"""Synthetic account/execution QA; no financial-history outcomes read."""
from copy import deepcopy
from dataclasses import replace
from decimal import Decimal, localcontext
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from pathlib import Path

from spot_backtest.models import Bar, DAY_US, HOUR_US, MINUTE_US
from spot_rotation.account import Account
from spot_rotation.runner import CASES, PARAMETERS, State, run_cases, utc_us, verify_registration

D = Decimal
START = utc_us('2025-09-01T00:00:00Z')  # Excluded development period, not financialmain.


def metadata(symbols=('BTCUSDT', 'ETHUSDT')):
    return {'symbols': [{'symbol': symbol, 'status': 'TRADING', 'filters': [
        {'filterType': 'LOT_SIZE', 'stepSize': '.001', 'minQty': '.001', 'maxQty': '100000'},
        {'filterType': 'PRICE_FILTER', 'tickSize': '.01'},
        {'filterType': 'NOTIONAL', 'minNotional': '5', 'avgPriceMins': 5}]} for symbol in symbols]}


def bar(at, price='100', low=None, high=None):
    price = D(price)
    return Bar(at, at + MINUTE_US - 1, price, D(high) if high is not None else price + 1,
               D(low) if low is not None else price - 1, price, D(10), price * D(10), 1)


def decision(at, target='BTCUSDT', atr='5', identity=None):
    return SimpleNamespace(at_us=at, target_symbol=target,
        momentum={'BTCUSDT': D('.1'), 'ETHUSDT': D('.2')},
        atr14={'BTCUSDT': D(atr), 'ETHUSDT': D(atr)}, decision_id=identity or str(at))


def stream(end_minutes, special=None, symbols=('BTCUSDT', 'ETHUSDT')):
    special = special or {}
    def rows(symbol):
        for i in range(-5, end_minutes):
            yield special.get((symbol, i), bar(START + i * MINUTE_US))
    return {symbol: rows(symbol) for symbol in symbols}


def empty_bar(at, price='100'):
    price = D(price)
    return Bar(at, at + MINUTE_US - 1, price, price, price, price, D(0), D(0), 0)


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.account = Account(metadata(), D('.001'))
        self.references = {'BTCUSDT': D(100), 'ETHUSDT': D(100)}
        self.proxies = dict(self.references)

    def plan(self, headroom='20', distance='10'):
        return self.account.plan_entry('BTCUSDT', D(100), D(distance), D(headroom), self.references, self.proxies)

    def test_shared_cash_proportional_caps_and_second_active_buy_blocked(self):
        plan = self.plan()
        self.assertTrue(plan['eligible'])
        self.assertLessEqual(plan['reserved_cost'], D(80))
        self.assertLessEqual(plan['planned_risk'], D(20))
        receipt = self.account.buy(plan, START, 'first')
        self.assertTrue(receipt['eligible'])
        self.assertGreaterEqual(self.account.cash, D(20))
        second = self.account.plan_entry('ETHUSDT', D(100), D(10), D(20), self.references, self.proxies)
        self.assertEqual(second['reasons'], ['ACTIVE_POSITION_OCCUPIED'])

    def test_fee_dust_cash_identity_and_carry_owned_dust_into_second_buy(self):
        self.account.buy(self.plan(), START, 'first')
        sale = self.account.sell('BTCUSDT', D(100), D(100), START + HOUR_US, 'TEST')
        self.assertTrue(sale['eligible'])
        dust = self.account.inventory['BTCUSDT']
        self.assertGreater(dust, 0)
        self.assertLess(dust, D('.001'))
        self.assertEqual(self.account.nav(self.references, self.proxies), self.account.cash)
        self.assertEqual(self.account.nav(self.references, self.proxies, book=True), self.account.cash + dust * 100)
        before = self.account.cash
        plan = self.plan()
        self.account.buy(plan, START + 2 * HOUR_US, 'second')
        self.assertEqual(self.account.inventory['BTCUSDT'], dust + plan['net_bought_base'])
        self.assertEqual(self.account.cash, before - plan['reserved_cost'])

    def test_blocked_exit_never_creates_cash_and_position_remains(self):
        self.account.buy(self.plan(), START, 'first')
        before = self.account.cash
        inventory = dict(self.account.inventory)
        sale = self.account.sell('BTCUSDT', D(1), D(1), START + HOUR_US, 'STOP')
        self.assertFalse(sale['eligible'])
        self.assertEqual(self.account.cash, before)
        self.assertEqual(self.account.inventory, inventory)
        self.assertEqual(self.account.active_symbol, 'BTCUSDT')

    def test_reference_minimum_unknown_daily_headroom_and_tiny_atr_reject(self):
        unknown = self.account.plan_entry('BTCUSDT', D(100), D(10), D(20), self.references, {'BTCUSDT': None})
        self.assertEqual(unknown['reasons'], ['ENTRY_REFERENCE_MINIMUM_UNKNOWN'])
        self.assertFalse(self.plan(headroom='0')['eligible'])
        tiny = self.plan(distance='.01')
        self.assertEqual(tiny['reasons'], ['STATIC_STOP_ALREADY_TRIGGERED_AT_OPEN'])
        constrained = self.plan(headroom='1')
        if constrained['eligible']: self.assertLessEqual(constrained['planned_risk'], D(1))

    def test_mutated_plan_and_nested_duplicate_request_cannot_change_ledger(self):
        plan = self.plan(); modified = deepcopy(plan); modified['reserved_cost'] += 1
        self.assertFalse(self.account.buy(modified, START, 'first')['eligible'])
        self.account.buy(plan, START, 'first')
        self.assertTrue(self.account.buy(deepcopy(plan), START, 'first')['duplicate'])
        before = self.account.cash
        plan['proxies']['BTCUSDT'] = D(999)
        bad = self.account.buy(plan, START, 'first')
        self.assertEqual(bad['reasons'], ['MODIFIED_DUPLICATE_PLAN'])
        self.assertEqual(self.account.cash, before)

    def test_largest_risk_quantity_binary_search_matches_brute_force(self):
        # Same pure planner policy on a small synthetic budget/step domain.
        self.account.markets['BTCUSDT']['step'] = D('.1')
        self.account.markets['BTCUSDT']['min_qty'] = D('.1')
        for remaining in ('2', '5', '20'):
            plan = self.plan(headroom=remaining)
            best = None
            for lots in range(1, 9):
                quantity = D('.1') * lots
                buy = self.account.price('BTCUSDT', D(100), buy=True)
                cost = quantity * buy
                if cost > 80: continue
                from spot_rotation.account import ceil, FEE, FEE_QUANTUM
                new = quantity - ceil(quantity * FEE, FEE_QUANTUM)
                stop = plan.get('stop', buy - 10)
                stop_liq = self.account.liquidation('BTCUSDT', new, stop, D(100))
                flat_liq = self.account.liquidation('BTCUSDT', new, D(100), D(100))
                risk = cost - stop_liq['net']
                if stop_liq['eligible'] and flat_liq['eligible'] and risk <= D(remaining): best = quantity
            self.assertEqual(plan['quantity'] if plan['eligible'] else None, best)


class RunnerTests(unittest.TestCase):
    def run_small(self, minutes, decisions=(), controls=(), special=None, include_controls=True):
        return run_cases(stream(minutes, special), decisions, controls, metadata(), START,
                         START + minutes * MINUTE_US, time.monotonic() + 30,
                         include_controls=include_controls)

    def test_four_accounts_share_market_pass_but_keep_independent100_cash(self):
        results = self.run_small(10, [decision(START)])
        self.assertEqual(set(results), {case.name for case in CASES})
        for name in ('rotation_base', 'rotation_stress'):
            result = results[name]
            self.assertEqual(result['initial_cash'], D(100))
            self.assertEqual(result['closed_trades'], 1)
            self.assertEqual(result['events'][-1]['reason'], 'END_OF_DATA')
            self.assertFalse(result['stranded_active_position'])
            self.assertEqual(result['cap_violations'], [])
        self.assertEqual(results['control_base']['final_cash'], D(100))
        self.assertEqual(results['control_stress']['final_cash'], D(100))

    def test_entry_minute_static_stop_uses_end_cash_and_no_reentry(self):
        special = {('BTCUSDT', 1): bar(START + MINUTE_US, low='80'),
                   ('BTCUSDT', 2): bar(START + 2 * MINUTE_US, low='80')}
        results = self.run_small(80, [decision(START)], special=special)
        for name in ('rotation_base', 'rotation_stress'):
            result = results[name]; buy, sale = result['events']
            self.assertEqual(sale['reason'], 'STOP')
            self.assertEqual(sale['timestamp_us'], buy['timestamp_us'] + MINUTE_US)
            self.assertEqual(sale['ledger_proceeds_available_us'], sale['timestamp_us'])
            self.assertFalse(sale['true_intrabar_trigger_time_known'])
            self.assertEqual(result['filled_entries'], 1)

    def test_due_open_model_exit_precedes_later_low_stop_and_events_never_backwards(self):
        signal = SimpleNamespace(signal_id='controlEntry', kind='ENTRY', at_us=START)
        leave = SimpleNamespace(signal_id='controlExit', kind='EXIT', at_us=START + HOUR_US)
        for name, due_minute in (('control_base', 61), ('control_stress', 62)):
            special = {('BTCUSDT', due_minute): bar(START + due_minute * MINUTE_US, low='80')}
            results = self.run_small(65, controls=[signal, leave], special=special)
            events = results[name]['events']
            self.assertEqual(events[-1]['reason'], 'EMA_EXIT')
            self.assertEqual(events[-1]['reference'], D(100))
            self.assertEqual([e['timestamp_us'] for e in events], sorted(e['timestamp_us'] for e in events))

    def test_rotation_sells_first_then_waits_hour_plus_second_delay(self):
        decisions = [decision(START), decision(START + DAY_US, 'ETHUSDT', identity='rotate')]
        result = self.run_small(1440 + 70, decisions, include_controls=False)
        for name in ('rotation_base', 'rotation_stress'):
            events = result[name]['events']
            self.assertEqual([e['side'] for e in events], ['BUY', 'SELL', 'BUY', 'SELL'])
            self.assertEqual(events[1]['reason'], 'ROTATION_EXIT')
            self.assertEqual(events[2]['symbol'], 'ETHUSDT')
            delay = 30 if name.endswith('base') else 120
            self.assertGreaterEqual(events[2]['timestamp_us'], events[1]['timestamp_us'] + HOUR_US + delay * 1_000_000)
            self.assertGreater(events[2]['timestamp_us'], events[1]['timestamp_us'])
            self.assertGreater(events[2]['inventories_before']['BTCUSDT'], 0)

    def test_terminal_costs_in_last_complete_utc_daily_return(self):
        results = self.run_small(1440, [decision(START)], include_controls=False)
        for result in results.values():
            self.assertEqual(len(result['daily_UTC']), 1)
            self.assertEqual(result['daily_UTC'][-1]['end_nav'], result['final_executable_nav'])
            self.assertEqual(result['daily_UTC'][-1]['net_pnl'], result['net_pnl'])
            self.assertEqual(result['daily_UTC'][-1]['daily_equity_return'], result['final_executable_nav'] / 100 - 1)
            self.assertEqual(result['mean_net_USDT_per_UTC_day'], result['net_pnl'])
            self.assertFalse(result['all_system_target_validated'])

    def test_control_new_buy_does_not_use_entry_minute_high_or_low(self):
        signal = SimpleNamespace(signal_id='controlEntry', kind='ENTRY', at_us=START)
        for name, entry_minute in (('control_base', 1), ('control_stress', 2)):
            special = {('BTCUSDT', entry_minute): bar(START + entry_minute * MINUTE_US, low='50', high='200')}
            result = self.run_small(entry_minute + 1, controls=[signal], special=special)
            events = result[name]['events']
            self.assertEqual(events[-1]['reason'], 'END_OF_DATA')
            self.assertEqual(result[name]['trades'][-1]['initial_stop'], result[name]['trades'][-1]['final_stop'])

    def test_empty_current_quote_defers_pending_without_consuming_attempt(self):
        special = {('BTCUSDT', i): empty_bar(START + i * MINUTE_US) for i in (1, 2, 3)}
        results = self.run_small(6, [decision(START)], special=special)
        for name in ('rotation_base', 'rotation_stress'):
            result = results[name]
            self.assertEqual(result['filled_entries'], 1)
            self.assertEqual(result['events'][0]['timestamp_us'], START + 4 * MINUTE_US)
            self.assertGreater(result['empty_minute_counts']['pending_entry_deferred_minutes'], 0)
            waiting = [d for d in result['decisions'] if d['decision'] == 'WAIT']
            self.assertEqual(len(waiting), 1)
            self.assertFalse(waiting[0]['entry_attempt_consumed'])

    def test_entire_empty_target_expires_original_ttl_without_fill(self):
        special = {('BTCUSDT', i): empty_bar(START + i * MINUTE_US) for i in range(1, 125)}
        results = self.run_small(125, [decision(START)], special=special)
        for name in ('rotation_base', 'rotation_stress'):
            result = results[name]
            self.assertEqual(result['events'], [])
            self.assertEqual(result['final_cash'], D(100))
            self.assertEqual(result['skips']['TARGET_TTL_EXPIRED'], 1)

    def test_empty_position_bar_cannot_stop_or_trail_and_terminal_stays_owned(self):
        special = {('BTCUSDT', 3): empty_bar(START + 3 * MINUTE_US, '50')}
        results = self.run_small(4, [decision(START)], special=special)
        for name in ('rotation_base', 'rotation_stress'):
            result = results[name]
            self.assertEqual([e['side'] for e in result['events']], ['BUY'])
            self.assertTrue(result['stranded_active_position'])
            self.assertGreater(result['final_inventories']['BTCUSDT'], 0)
            self.assertEqual(result['final_cash'], D(100) - result['events'][0]['gross_quote'])
            self.assertGreater(result['owned_inventory_book_value'], 0)
            self.assertEqual(result['owned_dust_book_mark'], 0)
            self.assertIsNone(result['primary_1pct_daily_equity_mean_met_retrospectively'])
            self.assertFalse(result['terminal_owned_asset_quote_evidence']['BTCUSDT']['current_minute_traded'])

    def test_zero_trade_positive_volume_quote_also_cannot_fill(self):
        special = {('BTCUSDT', i): replace(bar(START + i * MINUTE_US), trades=0) for i in (1, 2)}
        results = self.run_small(4, [decision(START)], special=special)
        for name in ('rotation_base', 'rotation_stress'):
            self.assertEqual(results[name]['events'][0]['timestamp_us'], START + 3 * MINUTE_US)

    def test_refresh_same_target_precedes_model_retry_but_not_protective_retry(self):
        for latch, expected in (('ROTATION_EXIT', False), ('STOP', True)):
            state = State(CASES[0], metadata())
            refs = proxies = {'BTCUSDT': D(100), 'ETHUSDT': D(100)}
            state.boundaries(START, refs, proxies)
            state.candidate(decision(START), START)
            initial_bars = {'BTCUSDT': bar(START + MINUTE_US), 'ETHUSDT': bar(START + MINUTE_US)}
            state.actions(initial_bars, refs, proxies)
            state.position['latched_exit'] = latch
            state.position['model_exit_due'] = START
            at = START + DAY_US
            bars = {s: bar(at) for s in refs}
            state.boundaries(at, refs, proxies)
            state.gap_protection(bars, refs, proxies)
            state.candidate(decision(at, identity='fresh'), at)
            state.actions(bars, refs, proxies)
            self.assertEqual(any(e['side'] == 'SELL' for e in state.account.events), expected)
            if not expected: self.assertIsNotNone(state.position)

    def test_empty_minute_cannot_release_cash_for_rotation(self):
        state = State(CASES[0], metadata())
        refs = proxies = {'BTCUSDT': D(100), 'ETHUSDT': D(100)}
        state.boundaries(START, refs, proxies); state.candidate(decision(START), START)
        state.actions({s: bar(START + MINUTE_US) for s in refs}, refs, proxies)
        cash_before = state.account.cash
        at = START + DAY_US
        state.boundaries(at, refs, proxies); state.candidate(decision(at, 'ETHUSDT', identity='rotate'), at)
        empty_at = at + MINUTE_US
        empty = {'BTCUSDT': empty_bar(empty_at), 'ETHUSDT': bar(empty_at)}
        state.gap_protection(empty, refs, proxies); state.actions(empty, refs, proxies)
        self.assertEqual(state.account.cash, cash_before)
        self.assertEqual(state.account.active_symbol, 'BTCUSDT')
        self.assertEqual(state.pending['symbol'], 'ETHUSDT')
        valid_at = empty_at + MINUTE_US
        state.actions({s: bar(valid_at) for s in refs}, refs, proxies)
        self.assertIsNone(state.position)
        self.assertEqual(state.account.events[-1]['reason'], 'ROTATION_EXIT')
        self.assertGreaterEqual(state.pending['due_us'], valid_at + HOUR_US + 30_000_000)

    def test_blocked_gap_cannot_sell_at_old_stop_above_entire_market_bar(self):
        special = {('BTCUSDT', 3): bar(START + 3 * MINUTE_US, '1', low='1', high='1')}
        result = self.run_small(4, [decision(START)], special=special)
        for name in ('rotation_base', 'rotation_stress'):
            self.assertEqual([e['side'] for e in result[name]['events']], ['BUY'])
            self.assertTrue(result[name]['stranded_active_position'])
            self.assertGreater(result[name]['final_inventories']['BTCUSDT'], 0)
            self.assertEqual(result[name]['final_cash'], 100 - result[name]['events'][0]['gross_quote'])

    def test_blocked_protective_sale_retries_actual_next_traded_open(self):
        special = {('BTCUSDT', 3): bar(START + 3 * MINUTE_US, '1', low='1', high='1')}
        result = self.run_small(6, [decision(START)], special=special)
        for name in ('rotation_base', 'rotation_stress'):
            sale = result[name]['events'][-1]
            self.assertEqual(sale['reason'], 'STOP_RETRY_OPEN')
            self.assertEqual(sale['execution_reference_kind'], 'OPEN_RETRY')
            self.assertEqual(sale['reference'], D(100))
            self.assertEqual(sale['timestamp_us'], START + 4 * MINUTE_US)
            self.assertFalse(result[name]['stranded_active_position'])

    def test_control_empty_high_does_not_raise_future_stop(self):
        signal = SimpleNamespace(signal_id='entry', kind='ENTRY', at_us=START)
        special = {('BTCUSDT', 3): replace(bar(START + 3 * MINUTE_US, low='50', high='200'), volume=D(0), quote_volume=D(0), trades=0)}
        result = self.run_small(5, controls=[signal], special=special)
        for name in ('control_base', 'control_stress'):
            self.assertEqual(result[name]['events'][-1]['reason'], 'END_OF_DATA')
            self.assertLess(result[name]['trades'][-1]['final_stop'], D(90))

    def test_old_stop_precedes_take_profit_when_both_touched_intrabar(self):
        signal = SimpleNamespace(signal_id='entry', kind='ENTRY', at_us=START)
        special = {('BTCUSDT', 3): bar(START + 3 * MINUTE_US, low='50', high='2000')}
        results = self.run_small(5, controls=[signal], special=special)
        for name in ('control_base', 'control_stress'):
            self.assertEqual(results[name]['events'][-1]['reason'], 'STOP')
            self.assertEqual(results[name]['events'][-1]['timestamp_us'], START + 4 * MINUTE_US)

    def test_control_high_raises_stop_only_for_next_minute_actual_gap_open(self):
        signal = SimpleNamespace(signal_id='entry', kind='ENTRY', at_us=START)
        special = {('BTCUSDT', 2): bar(START + 2 * MINUTE_US, low='90', high='200')}
        result = self.run_small(4, controls=[signal], special=special)['control_base']
        self.assertEqual(result['events'][-1]['reason'], 'STOP_GAP')
        self.assertEqual(result['events'][-1]['reference'], D(100))
        self.assertEqual(result['events'][-1]['timestamp_us'], START + 3 * MINUTE_US)
        self.assertEqual(result['trades'][-1]['final_stop'], D(170))

    def test_blocked_old_rotation_exit_cancelled_by_fresh_same_target_but_stop_sticky(self):
        state = State(CASES[0], metadata())
        state.position = {'symbol': 'BTCUSDT', 'model_exit_due': START, 'latched_exit': 'ROTATION_EXIT'}
        state.candidate(decision(START), START)
        self.assertIsNone(state.position['model_exit_due'])
        self.assertIsNone(state.position['latched_exit'])
        state.position['latched_exit'] = 'STOP'
        state.candidate(decision(START + DAY_US), START + DAY_US)
        self.assertEqual(state.position['latched_exit'], 'STOP')

    def test_empty_truncated_gap_stream_duplicate_signal_and_cutoff_fail(self):
        for streams in ({'BTCUSDT': [], 'ETHUSDT': []}, stream(9)):
            with self.assertRaises(ValueError):
                run_cases(streams, [], [], metadata(), START, START + 10 * MINUTE_US, time.monotonic() + 10)
        with self.assertRaises(ValueError):
            self.run_small(10, [decision(START), decision(START)])
        with self.assertRaises(TimeoutError):
            run_cases(stream(10), [], [], metadata(), START, START + 10 * MINUTE_US, time.monotonic() - 1)

    def test_registration_cannot_omit_mandatory_source_dependencies(self):
        from spot_rotation.strategy import STRATEGY_PARAMETERS
        protocol = {'protocol_id': 'spot-rotation100-v1', 'parameters': deepcopy(PARAMETERS),
                    'strategy_parameters': deepcopy(STRATEGY_PARAMETERS),
                    'main_start_utc': '2025-10-01T00:00:00Z',
                    'main_end_utc_exclusive': '2026-10-01T00:00:00Z',
                    'registered_at_utc': '2026-10-11T00:00:00Z', 'source_sha256': {}}
        with patch('spot_rotation.runner.sha', return_value='a' * 64):
            with self.assertRaisesRegex(ValueError, 'mandatorysource'):
                verify_registration(protocol, Path('/tmp/synthetic-registration'), 'a' * 64)

    def test_registration_numeric_or_boolean_coercion_does_not_match_parameters(self):
        from spot_rotation.strategy import STRATEGY_PARAMETERS
        for key, changed in (('wall_cap_seconds', 1800.0), ('deposit_confirmed', 0)):
            parameters = deepcopy(PARAMETERS); parameters[key] = changed
            protocol = {'protocol_id': 'spot-rotation100-v1', 'parameters': parameters,
                        'strategy_parameters': deepcopy(STRATEGY_PARAMETERS),
                        'main_start_utc': '2025-10-01T00:00:00Z',
                        'main_end_utc_exclusive': '2026-10-01T00:00:00Z'}
            with patch('spot_rotation.runner.sha', return_value='a' * 64):
                with self.assertRaises(ValueError):
                    verify_registration(protocol, Path('/tmp/synthetic-registration'), 'a' * 64)


if __name__ == '__main__': unittest.main()
