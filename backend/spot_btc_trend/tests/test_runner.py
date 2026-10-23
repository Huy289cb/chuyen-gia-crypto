import unittest
import copy
import json
from pathlib import Path
import tempfile
import sys
from unittest.mock import patch
from dataclasses import replace
from decimal import Decimal

from spot_backtest.models import Bar, HOUR_US, MINUTE_US
from spot_btc_trend.runner import (Case, run_replay, PARAMETERS, validate_protocol,
                                   required_runtime_paths, sha, verify_completed_identity)
from spot_btc_trend.strategy import Signal
from spot_btc_trend import runner

D = Decimal
START = 2 * HOUR_US


def minute(opened, price='60000', high=None, low=None, volume='1'):
    p = D(price)
    return Bar(opened, opened + MINUTE_US - 1, p, D(high) if high else p,
               D(low) if low else p, p, D(volume), p * D(volume))


def fixture(length=10):
    return [minute(START + i * MINUTE_US) for i in range(-5, length)]


def signal(kind='ENTRY', at=START, identity='entry', episode='entry'):
    return Signal(identity, episode, kind, at, D('60000'), D('59900'),
                  D('59900'), D('60000'))


def replay(bars, signals=None, case=None):
    return run_replay(bars, signals or [signal()], case or Case('base'),
                      START, bars[-1].close_us + 1)


class RunnerTests(unittest.TestCase):
    def test_latency_fees_rounding_continuous_cash_and_terminal(self):
        result = replay(fixture())
        self.assertEqual(result['entries'], 1)
        self.assertEqual(result['closed_trades'], 1)
        buy, sell = result['events']
        self.assertEqual(buy['timestamp_us'], START + MINUTE_US)
        self.assertEqual(buy['fee_asset'], 'BTC')
        self.assertEqual(sell['fee_asset'], 'USDT')
        self.assertEqual(buy['quantity'] % D('.00001'), 0)
        self.assertEqual(result['trades'][0]['exit_reason'], 'END_OF_DATA')
        self.assertEqual(result['net_pnl'], result['total_closed_cash_pnl'])
        self.assertEqual(result['monthly'][0]['start_nav'], D(15))
        self.assertEqual(result['daily'][0]['start_nav'], D(15))
        self.assertLess(result['net_pnl'], 0)
        self.assertEqual(result['cap_violations'], [])
        self.assertFalse(result['all_cost_roi_validated'])
        self.assertEqual(PARAMETERS['risk_max'], '3')
        self.assertEqual(PARAMETERS['nav_risk_divisor'], '5')

    def test_stress_latency_has_later_fill(self):
        result = replay(fixture(), case=Case('stress', D('.003'), 120))
        self.assertEqual(result['events'][0]['timestamp_us'], START + 2 * MINUTE_US)
        self.assertGreater(result['events'][0]['price'], D(60000))

    def test_terminal_hour_snapshot_has_one_final_valuation(self):
        result = replay(fixture(60))
        timestamps = [row['timestamp_us'] for row in result['hourly']]
        self.assertEqual(len(timestamps), len(set(timestamps)))
        self.assertEqual(result['hourly'][-1]['nav'], result['final_executable_nav'])
        self.assertEqual(result['hourly'][-1]['book_nav'], result['final_book_nav'])

    def test_old_stop_then_high_update_next_minute_and_entry_interval_excluded(self):
        bars = fixture()
        # Entry at minute 1 ignores its unverified intrabar range.
        bars[6] = minute(START + MINUTE_US, high='120000', low='100')
        # At minute 2 the new high must NOT apply before that same minute's low.
        bars[7] = minute(START + 2 * MINUTE_US, high='100000', low='55000')
        result = replay(bars)
        trade = result['trades'][0]
        self.assertEqual(trade['exit_reason'], 'STOP_GAP')
        self.assertEqual(trade['exit_us'], START + 3 * MINUTE_US)
        self.assertEqual(trade['final_stop'], D(85000))
        self.assertGreater(trade['final_stop'], trade['initial_stop'])

    def test_old_stop_wins_when_minute_hits_stop_and_static_target(self):
        bars = fixture()
        bars[7] = minute(START + 2 * MINUTE_US, high='700000', low='50000')
        result = replay(bars)
        self.assertEqual(result['trades'][0]['exit_reason'], 'STOP')
        self.assertEqual(result['trades'][0]['exit_us'], START + 3 * MINUTE_US)

    def test_pending_model_exit_keeps_gap_stop_active(self):
        bars = fixture(65)
        bars[65] = minute(START + HOUR_US, price='45000')
        for i in range(66, len(bars)):
            bars[i] = minute(bars[i].open_us, price='45000')
        result = replay(bars, [signal(), signal('EXIT', START + HOUR_US, 'exit')])
        self.assertEqual(result['trades'][0]['exit_reason'], 'STOP_GAP')
        self.assertEqual(result['trades'][0]['exit_us'], START + HOUR_US)

    def test_exit_latch_retries_without_manufactured_sale(self):
        bars = fixture()
        bars[7] = minute(START + 2 * MINUTE_US, price='20000')
        for i in range(8, len(bars)):
            bars[i] = minute(bars[i].open_us, price='40000')
        result = replay(bars)
        self.assertEqual(result['closed_trades'], 1)
        self.assertEqual(result['events'][1]['timestamp_us'], START + 3 * MINUTE_US)
        self.assertTrue(any(row['decision'] == 'EXIT_BLOCKED' for row in result['decisions']))

    def test_terminal_stranded_inventory_is_reported_as_open(self):
        bars = fixture()
        for i in range(7, len(bars)):
            bars[i] = minute(bars[i].open_us, price='20000')
        result = replay(bars)
        self.assertEqual(result['entries'], 1)
        self.assertEqual(result['closed_trades'], 0)
        self.assertTrue(result['open_position_at_end'])
        self.assertEqual(len(result['events']), 1)
        self.assertGreater(result['final_book_nav'], result['final_executable_nav'])
        self.assertEqual(result['final_executable_nav'], result['final_cash'])

    def test_duplicates_occupied_episode_and_global_exit(self):
        bars = fixture(125)
        events = [signal(), signal(), signal(at=START + HOUR_US, identity='ignored', episode='ignored'),
                  signal('EXIT', START + 2 * HOUR_US, 'exit', 'ignored')]
        result = replay(bars, events)
        self.assertEqual(result['entries'], 1)
        self.assertEqual(result['skips']['DUPLICATE_SIGNAL'], 1)
        self.assertEqual(result['skips']['POSITION_OR_PENDING_OCCUPIED'], 1)
        self.assertEqual(result['trades'][0]['episode_id'], 'entry')
        self.assertEqual(result['trades'][0]['exit_reason'], 'EMA_EXIT')

    def test_daily_loss_pause_cooldown_and_nonreset_cash(self):
        bars = fixture(190)
        for i in range(7, len(bars)):
            bars[i] = minute(bars[i].open_us, price='30000')
        events = [signal(), signal(at=START + HOUR_US, identity='too_early'),
                  signal(at=START + 2 * HOUR_US, identity='day_loss')]
        result = replay(bars, events)
        self.assertEqual(result['entries'], 1)
        self.assertEqual(result['skips']['COOLDOWN_1H'], 1)
        self.assertEqual(result['skips']['DAILY_LOSS_PAUSE'], 1)
        self.assertLess(result['final_cash'], D(15))
        self.assertEqual(result['monthly'][0]['end_nav'], result['final_executable_nav'])

    def test_missing_proxy_and_changed_filters_fail_closed(self):
        bars = [minute(START + i * MINUTE_US) for i in range(4)]
        result = replay(bars)
        self.assertEqual(result['entries'], 0)
        self.assertEqual(result['skips']['MISSING_REFERENCE_FILTER_INPUT'], 1)
        self.assertEqual(result['final_cash'], D(15))
        for bad_case in (Case('bad', D('.002')), Case('partial', partial_fraction=D('.5')),
                         Case('min', min_notional=D(10))):
            with self.assertRaises(ValueError):
                replay(fixture(), case=bad_case)

    def test_future_signal_gap_and_incomplete_window_fail_closed(self):
        result = replay(fixture(), [signal(at=START + HOUR_US)])
        self.assertEqual(result['entries'], 0)
        bars = fixture()
        with self.assertRaises(ValueError):
            replay(bars[:7] + bars[8:])
        with self.assertRaises(ValueError):
            run_replay(bars, [signal()], Case('base'), START, bars[-1].close_us + MINUTE_US + 1)
        with self.assertRaises(ValueError):
            replay(bars, [replace(signal(), model_id='other')])

    def protocol_fixture(self, directory):
        folder = Path(directory)
        (folder / 'manifest.json').write_text(json.dumps({'status': 'COMPLETE_VERIFIED', 'market': 'spot'}))
        extra = folder / 'extra_dependency.py'
        extra.write_text('EXTRA = 1\n')
        registered = {source: sha(Path(source)) for source in required_runtime_paths()}
        registered[str(extra)] = sha(extra)
        return {
            'protocol_id': 'spot-btc-ema600-v1', 'parameters': copy.deepcopy(PARAMETERS),
            'data': {'data_dir': str(folder), 'manifest_sha256': sha(folder / 'manifest.json'),
                     'start_utc': '2023-04-01T00:00:00Z', 'end_utc_exclusive': '2025-10-01T00:00:00Z'},
            'replay': {'start_utc': '2024-01-01T00:00:00Z', 'end_utc_exclusive': '2025-10-01T00:00:00Z'},
            'source_sha256': registered,
            'cases': [
                {'name': 'base', 'slip': '.001', 'delay_seconds': 30, 'min_notional': '5', 'partial_fraction': '1'},
                {'name': 'stress', 'slip': '.003', 'delay_seconds': 120, 'min_notional': '5', 'partial_fraction': '1'},
            ],
            'run_limits': {'wall_cap_seconds': 1200},
        }

    def test_registration_requires_all_runtime_dependencies_and_exact_types(self):
        with tempfile.TemporaryDirectory() as directory:
            protocol = self.protocol_fixture(directory)
            path = Path(directory) / 'protocol.json'
            path.write_text(json.dumps(protocol))
            validate_protocol(path, sha(path))
            mutations = []
            absent_dependency = copy.deepcopy(protocol)
            del absent_dependency['source_sha256'][next(p for p in required_runtime_paths() if p.endswith('dataset.py'))]
            mutations.append(absent_dependency)
            numeric_alias = copy.deepcopy(protocol)
            numeric_alias['parameters']['ema_period'] = 600.0
            mutations.append(numeric_alias)
            bool_alias = copy.deepcopy(protocol)
            bool_alias['parameters']['reset_cash_between_months'] = 0
            mutations.append(bool_alias)
            latency_alias = copy.deepcopy(protocol)
            latency_alias['cases'][0]['delay_seconds'] = 30.0
            mutations.append(latency_alias)
            for changed in mutations:
                path.write_text(json.dumps(changed))
                with self.assertRaises(ValueError):
                    validate_protocol(path, sha(path))

    def test_terminal_rechecks_registered_source_data_and_protocol(self):
        with tempfile.TemporaryDirectory() as directory:
            protocol = self.protocol_fixture(directory)
            folder = Path(directory)
            path = folder / 'protocol.json'
            path.write_text(json.dumps(protocol))
            expected = sha(path)
            _, identity = validate_protocol(path, expected)
            verify_completed_identity(path, expected, identity)
            extra = folder / 'extra_dependency.py'
            extra.write_text('EXTRA = 2\n')
            with self.assertRaises(ValueError):
                verify_completed_identity(path, expected, identity)
            extra.write_text('EXTRA = 1\n')
            manifest = folder / 'manifest.json'
            original_manifest = manifest.read_bytes()
            manifest.write_text(json.dumps({'status': 'COMPLETE_VERIFIED', 'market': 'futures'}))
            with self.assertRaises(ValueError):
                verify_completed_identity(path, expected, identity)
            manifest.write_bytes(original_manifest)
            path.write_text(json.dumps(protocol) + '\n')
            with self.assertRaises(ValueError):
                verify_completed_identity(path, expected, identity)

    def test_rejected_startup_protocol_retains_failed_terminal(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            protocol = self.protocol_fixture(directory)
            protocol['parameters']['ema_period'] = 800
            path = folder / 'protocol.json'
            path.write_text(json.dumps(protocol))
            output = folder / 'run'
            argv = ['runner', '--protocol', str(path), '--protocol-sha256', sha(path),
                    '--output-dir', str(output)]
            with patch.object(sys, 'argv', argv), self.assertRaises(ValueError):
                runner.main()
            execution = json.loads((output / 'execution.json').read_text())
            self.assertEqual(execution['status'], 'FAILED_INCOMPLETE')
            self.assertFalse(execution['source_verified'])
            self.assertFalse(execution['partial_results_valid_for_roi'])
            self.assertEqual(execution['partial_case_summaries'], [])

    def test_changed_source_during_case_stops_before_next_case(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            protocol = self.protocol_fixture(directory)
            path = folder / 'protocol.json'
            path.write_text(json.dumps(protocol))
            output = folder / 'run'
            argv = ['runner', '--protocol', str(path), '--protocol-sha256', sha(path),
                    '--output-dir', str(output)]
            def fake_case(*args, **kwargs):
                (folder / 'extra_dependency.py').write_text('EXTRA = 2\n')
                return {}
            with (patch.object(sys, 'argv', argv),
                  patch.object(runner, 'iter_bars', return_value=iter(())),
                  patch.object(runner, 'generate_signals', return_value=iter(())),
                  patch.object(runner, 'run_replay', side_effect=fake_case) as invoked,
                  patch('builtins.print'),
                  self.assertRaises(ValueError)):
                runner.main()
            self.assertEqual(invoked.call_count, 1)
            execution = json.loads((output / 'execution.json').read_text())
            self.assertEqual(execution['status'], 'FAILED_INCOMPLETE')
            self.assertEqual(execution['attempted_case'], 'base')
            self.assertFalse(execution['partial_results_valid_for_roi'])
            self.assertFalse((output / 'base.json').exists())


if __name__ == '__main__':
    unittest.main()
