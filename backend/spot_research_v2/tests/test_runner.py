"""Causal execution and inventory invariants; no historical PnL optimization."""
from dataclasses import replace
from decimal import Decimal
import unittest
from spot_research_v2.models import Bar, MINUTE_US, HOUR_US, DAY_US
from spot_research_v2.features import ResearchEvent
from spot_research_v2.runner import Case, run_replay, utc_us
D=Decimal
START=utc_us('2024-01-01')

def bars(count=8, price='100'):
    p=D(price)
    return [Bar(START+i*MINUTE_US,START+(i+1)*MINUTE_US-1,p,p+D('.1'),p-D('.1'),p,D(10),p*D(10),10)
            for i in range(-5,count)]

def event(model='trend4h',at=START,kind='ENTRY',setup='s1',stop='98',target=None,hurdle='108'):
    return ResearchEvent(model,setup,at,kind,D(100),None if stop is None else D(stop),
                         None if target is None else D(target),None if hurdle is None else D(hurdle))

def replay(bs,es,case=None,end=None):
    return run_replay(bs,es,case or Case('test'),START,end or bs[-1].close_us+1)

class ExecutionTests(unittest.TestCase):
    def test_entry_waits_until_first_open_after_delay(self):
        r=replay(bars(),[event()])
        self.assertEqual(r['entries'],1)
        self.assertEqual(r['events'][0]['timestamp_us'],START+MINUTE_US)
        r2=replay(bars(),[event()],Case('stress',delay_seconds=120))
        self.assertEqual(r2['events'][0]['timestamp_us'],START+2*MINUTE_US)

    def test_trend_hurdle_does_not_cap_winner(self):
        bs=bars()
        bs[7]=replace(bs[7],high=D(130))
        r=replay(bs,[event()])
        self.assertEqual(r['trades'][0]['exit_reason'],'END_OF_DATA')
        self.assertIsNone(r['trades'][0]['target'])

    def test_trail_only_effective_after_timestamp(self):
        bs=bars()
        # Minute1 dips below the FUTURE stop101 but above the active stop98.
        bs[6]=replace(bs[6],low=D(99))
        r=replay(bs,[event(),event(at=START+2*MINUTE_US,kind='TRAIL_UPDATE',stop='101')])
        self.assertEqual(r['trades'][0]['exit_us'],START+2*MINUTE_US)
        self.assertEqual(r['trades'][0]['exit_reason'],'STOP_GAP')
        self.assertEqual(r['trades'][0]['stop'],D(101))

    def test_trail_cannot_reduce_stop(self):
        r=replay(bars(),[event(),event(at=START+2*MINUTE_US,kind='TRAIL_UPDATE',stop='97')])
        self.assertEqual(r['trades'][0]['stop'],D(98))

    def test_model_exit_delayed_while_stop_stays_active(self):
        bs=bars()
        bs[8]=replace(bs[8],low=D(97))
        r=replay(bs,[event(),event(at=START+3*MINUTE_US,kind='REGIME_EXIT')],Case('delay',delay_seconds=120))
        self.assertEqual(r['trades'][0]['exit_reason'],'STOP')
        self.assertLess(r['trades'][0]['exit_us'],START+5*MINUTE_US)

    def test_model_exit_uses_due_open(self):
        r=replay(bars(),[event(),event(at=START+2*MINUTE_US,kind='REGIME_EXIT')])
        self.assertEqual(r['trades'][0]['exit_reason'],'REGIME_OFF')
        self.assertEqual(r['trades'][0]['exit_us'],START+3*MINUTE_US)

    def test_previously_due_exit_releases_position_before_new_event(self):
        r=replay(bars(),[event(),event(at=START+2*MINUTE_US,kind='REGIME_EXIT'),
                         event(at=START+3*MINUTE_US,setup='s2')])
        self.assertEqual(r['entries'],2)
        self.assertEqual(r['trades'][0]['exit_us'],START+3*MINUTE_US)
        self.assertEqual(r['events'][2]['timestamp_us'],START+4*MINUTE_US)

    def test_same_minute_stop_before_fixed_target(self):
        bs=bars()
        bs[6]=replace(bs[6],low=D(97),high=D(109))
        r=replay(bs,[event('reversion4h',target='108')],Case('r','reversion4h'))
        self.assertEqual(r['trades'][0]['exit_reason'],'STOP')

    def test_gap_stop_uses_worse_open(self):
        bs=bars()
        bs[7]=replace(bs[7],open=D(95),low=D(94),high=D(100))
        r=replay(bs,[event()])
        self.assertEqual(r['trades'][0]['exit_reason'],'STOP_GAP')
        self.assertEqual(r['trades'][0]['exit_price'],D('94.90'))

    def test_duplicate_attempt_not_reentered(self):
        r=replay(bars(),[event(),event(at=START+2*MINUTE_US)])
        self.assertEqual(r['entries'],1)
        self.assertEqual(r['skips']['DUPLICATE_SETUP'],1)

    def test_partial_unsellable_remains_owned(self):
        r=replay(bars(),[event()],Case('partial',partial_fraction=D('.5'),min_notional=D(10)))
        self.assertEqual(r['entries'],1)
        self.assertTrue(r['open_position_at_end'])
        self.assertGreater(r['final_inventory_sol'],0)
        self.assertEqual(r['final_executable_nav'],r['final_cash'])
        self.assertGreater(r['final_book_nav'],r['final_executable_nav'])
        self.assertEqual(r['closed_trades'],0)

    def test_missing_reference_prevents_entry(self):
        r=replay([b for b in bars() if b.open_us>=START],[event()])
        self.assertEqual(r['entries'],0)
        self.assertEqual(r['skips']['MISSING_REFERENCE_FILTER_INPUT'],1)

    def test_benchmark_obeys_same_reference_filter(self):
        r=replay([b for b in bars() if b.open_us>=START],[])
        self.assertFalse(r['buy_hold_receipts'][0]['eligible'])
        self.assertEqual(r['buy_hold_net_pnl'],0)

    def test_cash_no_reset_at_midnight_or_month(self):
        # Shift to January31 just before UTC midnight.
        shift=utc_us('2024-01-31T23:58:00Z')-START
        bs=[replace(b,open_us=b.open_us+shift,close_us=b.close_us+shift) for b in bars()]
        r=run_replay(bs,[event(at=START+shift)],Case('test'),START+shift,bs[-1].close_us+1)
        self.assertEqual(r['entries'],1)
        self.assertEqual(len(r['monthly']),2)
        self.assertEqual(r['monthly'][1]['start_nav'],r['monthly'][0]['end_nav'])
        self.assertEqual(sum((x['net_pnl'] for x in r['monthly']),D(0)),r['net_pnl'])

    def test_deadline_is_enforced_inside_replay(self):
        with self.assertRaises(TimeoutError):
            run_replay(bars(),[event()],Case('test'),START,START+8*MINUTE_US,0)

if __name__=='__main__':unittest.main()
