"""Bounded offline Spot replay of two preregistered mechanisms. No broker I/O."""
from __future__ import annotations
import argparse
from collections import Counter, deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import shutil
import time
from typing import Iterable
from spot_backtest.account import SpotAccount, STEP, floor_step
from .account import ResearchAccount
from .dataset import iter_bars
from .features import ResearchEvent, generate_events
from .models import Bar, MINUTE_US, HOUR_US, DAY_US
D = Decimal

@dataclass(frozen=True)
class Case:
    name: str
    model_id: str = 'trend4h'
    slip: Decimal = D('.001')
    delay_seconds: int = 30
    min_notional: Decimal = D('5')
    partial_fraction: Decimal = D('1')

def utc_us(value: str) -> int:
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = dt - datetime(1970, 1, 1, tzinfo=timezone.utc)
    return (delta.days*86400 + delta.seconds)*1_000_000 + delta.microseconds

def iso(timestamp: int) -> str:
    return datetime.fromtimestamp(timestamp//1_000_000, timezone.utc).isoformat()

def json_default(value):
    if isinstance(value, D):
        return str(value)
    raise TypeError(type(value).__name__)

def save_json(path: Path, value):
    path.write_text(json.dumps(value, indent=2, default=json_default)+'\n')

def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def linux_memory_kib():
    for line in Path('/proc/self/status').read_text().splitlines():
        if line.startswith('VmHWM:'):
            return int(line.split()[1])


def run_replay(bars: Iterable[Bar], events: Iterable[ResearchEvent], case: Case,
               start_us: int, end_us: int, deadline: float | None = None) -> dict:
    """Continuous15USDT. All event updates precede inspection of current1m H/L.

    Prior five completed minutes provide a conditional reference filter proxy.
    Entry/model exits use the registered delay, protective stops remain active.
    An unexecutable exit is latched and retried, never manufactured.
    """
    if case.model_id not in ('trend4h', 'reversion4h'):
        raise ValueError('unregistered model')
    account = ResearchAccount(min_notional=case.min_notional, slip=case.slip,
                              partial_fraction=case.partial_fraction)
    candidate_iter = iter(events)
    next_event = next(candidate_iter, None)
    history = deque(maxlen=5)
    history_volume = history_quote = D(0)
    proxy = None
    pending = position = None
    seen = set()
    skips, exits = Counter(), Counter()
    decisions, trades, daily, hourly, monthly = [], [], {}, {}, {}
    day = None
    day_start = peak = book_peak = D(15)
    day_paused = False
    max_dd = max_dd_fraction = book_max_dd = D(0)
    minutes_exposed = candidate_count = context_count = 0
    last_bar = None
    market_first = market_last = None
    benchmark = SpotAccount(min_notional=case.min_notional, slip=case.slip)
    benchmark_started = False
    benchmark_receipts = []
    current_vn_date = current_month = None
    daily_book,monthly_book={},{}

    def append_history(bar):
        nonlocal history_volume, history_quote, proxy
        if history and history[-1].open_us + MINUTE_US != bar.open_us:
            history.clear()
            history_volume = history_quote = D(0)
        if len(history) == 5:
            old = history[0]
            history_volume -= old.volume
            history_quote -= old.quote_volume
        history.append(bar)
        history_volume += bar.volume
        history_quote += bar.quote_volume
        proxy = history_quote/history_volume if len(history)==5 and history_volume>0 else None

    def filter_ok(quantity):
        return proxy is not None and quantity*proxy >= case.min_notional

    def conditional_nav(ledger, reference):
        quantity = floor_step(ledger.inventory, STEP)
        if quantity < STEP or not filter_ok(quantity):
            return ledger.cash
        return ledger.nav(reference)

    def record_skip(event, reason, at):
        skips[reason] += 1
        decisions.append({'setup_id':event.setup_id,'timestamp_us':at,'signal_us':event.at_us,
                          'decision':'SKIP','reason':reason})

    def exit_position(reference, at, reason):
        nonlocal position
        if position is None:
            return
        if filter_ok(floor_step(account.inventory, STEP)):
            receipt = account.sell(reference, at, reason)
        else:
            receipt = {'eligible':False,'reasons':['exit_reference_minimum_or_unknown']}
        if not receipt['eligible']:
            position['latched_exit'] = reason
            if reason not in position['blocked_reasons']:
                position['blocked_reasons'].add(reason)
                skips['EXIT_BLOCKED:'+receipt['reasons'][0]] += 1
                decisions.append({'setup_id':position['setup_id'],'timestamp_us':at,
                                  'decision':'EXIT_BLOCKED','reason':receipt['reasons'][0]})
            return
        pnl = account.cash-position['cash_before']
        trades.append({'setup_id':position['setup_id'],'entry_us':position['entry_us'],
                       'exit_us':at,'exit_reason':reason,'net_pnl':pnl,
                       'entry_price':position['entry_price'],'exit_price':receipt['price'],
                       'initial_stop':position['initial_stop'],'stop':position['stop'],
                       'target':position['target'],'cost_hurdle':position['cost_hurdle'],
                       'hold_seconds':D(at-position['entry_us'])/D(1_000_000),
                       'planned_stop_loss':position['planned_stop_loss'],
                       'effective_planned_risk':position['effective_planned_risk'],
                       'partial_stranded_at_stop':position['partial_stranded_at_stop'],
                       'dust_sol_after':account.inventory})
        exits[reason] += 1
        position = None

    for index,bar in enumerate(bars):
        if index%4096 == 0 and deadline is not None and time.monotonic()>=deadline:
            raise TimeoutError('finite replay wall cap reached')
        if bar.open_us>=end_us:
            break
        if bar.open_us<start_us:
            append_history(bar)
            continue
        last_bar = bar
        if market_first is None:
            market_first = bar.open
        market_last = bar.close
        current_day=(bar.open_us+7*HOUR_US)//DAY_US
        if current_day != day:
            day = current_day
            current_vn_date=iso(bar.open_us+7*HOUR_US)[:10]
            day_start=conditional_nav(account,bar.open)
            day_paused=False
        # UTC month changes can occur inside a Vietnam day.
        if bar.open_us%DAY_US==0 or current_month is None:
            current_month=iso(bar.open_us)[:7]
        daily_limit=min(D('1.50'),day_start*D('.10'))
        if max(D(0),day_start-conditional_nav(account,bar.open))>=daily_limit:
            day_paused=True

        if position is not None:
            if position['latched_exit']:
                exit_position(bar.open,bar.open_us,position['latched_exit'])
            elif position['model_exit_due'] is not None and bar.open_us>=position['model_exit_due']:
                exit_position(bar.open,bar.open_us,'REGIME_OFF')
            elif bar.open_us>=position['entry_us']+position['max_hold_us']:
                exit_position(bar.open,bar.open_us,'TIME_30D' if case.model_id=='trend4h' else 'TIME_48H')


        while next_event is not None and next_event.at_us<=bar.open_us:
            event=next_event
            next_event=next(candidate_iter,None)
            if event.at_us<start_us:
                continue
            if event.model_id!=case.model_id:
                raise ValueError('mixed model event stream')
            if event.kind=='TRAIL_UPDATE':
                if position is not None and position['setup_id']==event.setup_id:
                    if event.stop is None:
                        raise ValueError('trail without stop')
                    old_stop=position['stop']
                    position['stop']=max(old_stop,event.stop)
                    if position['stop']!=old_stop:
                        decisions.append({'setup_id':event.setup_id,'timestamp_us':bar.open_us,
                                          'signal_us':event.at_us,'decision':'TRAIL_UPDATE',
                                          'old_stop':old_stop,'stop':position['stop']})
                continue
            if event.kind=='REGIME_EXIT':
                if pending is not None and pending.setup_id==event.setup_id:
                    record_skip(pending,'REGIME_OFF_BEFORE_FILL',bar.open_us)
                    pending=None
                if position is not None and position['setup_id']==event.setup_id:
                    position['model_exit_due']=event.at_us+case.delay_seconds*1_000_000
                    decisions.append({'setup_id':event.setup_id,'timestamp_us':bar.open_us,
                                      'signal_us':event.at_us,'decision':'MODEL_EXIT_PENDING',
                                      'due_us':position['model_exit_due']})
                continue
            if event.kind!='ENTRY':
                raise ValueError('unknown event kind')
            candidate_count+=1
            if event.setup_id in seen:
                record_skip(event,'DUPLICATE_SETUP',bar.open_us)
                continue
            seen.add(event.setup_id)
            if not event.context_ok:
                record_skip(event,event.reason or 'CONTEXT_REJECT',bar.open_us)
                continue
            context_count+=1
            if pending is not None or position is not None:
                record_skip(event,'POSITION_OR_PENDING_OCCUPIED',bar.open_us)
            elif day_paused:
                record_skip(event,'DAILY_PAUSE',bar.open_us)
            else:
                pending=event
                decisions.append({'setup_id':event.setup_id,'timestamp_us':bar.open_us,
                                  'signal_us':event.at_us,'decision':'PENDING',
                                  'due_us':event.at_us+case.delay_seconds*1_000_000})


        if pending is not None and bar.open_us>=pending.at_us+case.delay_seconds*1_000_000:
            event,pending=pending,None
            nav=conditional_nav(account,bar.open)
            headroom=max(D(0),daily_limit-max(D(0),day_start-nav))
            if day_paused or headroom<=0:
                record_skip(event,'DAILY_PAUSE_AT_FILL',bar.open_us)
            elif proxy is None:
                record_skip(event,'MISSING_REFERENCE_FILTER_INPUT',bar.open_us)
            else:
                plan=account.plan_entry(bar.open,event.stop,event.target,
                                        min(D('1.50'),nav/D(10)),headroom,event.hurdle_price)
                if not plan['eligible']:
                    record_skip(event,'|'.join(plan['reasons']),bar.open_us)
                elif not filter_ok(plan['quantity']):
                    record_skip(event,'ENTRY_REFERENCE_BELOW_MINIMUM',bar.open_us)
                else:
                    before_cash=account.cash
                    receipt=account.buy(plan,bar.open_us,event.setup_id)
                    if not receipt['eligible']:
                        record_skip(event,'|'.join(receipt['reasons']),bar.open_us)
                    else:
                        position={'setup_id':event.setup_id,'entry_us':bar.open_us,
                                  'entry_price':receipt['price'],'cash_before':before_cash,
                                  'initial_stop':plan['stop'],'stop':plan['stop'],'target':plan['target'],
                                  'cost_hurdle':plan['hurdle_price'],
                                  'planned_stop_loss':plan['stop_loss'],
                                  'effective_planned_risk':plan['effective_planned_risk'],
                                  'partial_stranded_at_stop':receipt['partial_stranded_at_stop'],
                                  'latched_exit':None,'model_exit_due':None,'blocked_reasons':set(),
                                  'max_hold_us':(720 if case.model_id=='trend4h' else 48)*HOUR_US}
                        decisions.append({'setup_id':event.setup_id,'timestamp_us':bar.open_us,
                                          'decision':'BUY','stop':plan['stop'],'target':plan['target'],
                                          'cost_hurdle':plan['hurdle_price'],'reference_proxy':proxy,
                                          'net_reward_risk':plan['net_reward_risk'],
                                          'roundtrip_drag':plan['roundtrip_drag'],
                                          'entry_reference':bar.open,'requested_risk':min(D('1.50'),nav/D(10)),
                                          'daily_headroom':headroom,'effective_risk_limit':plan['effective_risk_limit'],
                                          'solo_stop_loss':plan['solo_stop_loss'],
                                          'solo_hurdle_profit':plan['solo_hurdle_profit'],
                                          'solo_flat_net':plan['solo_flat_net'],
                                          'hurdle_benefit_over_flat':plan['hurdle_benefit_over_flat']})

        if not benchmark_started:
            price=benchmark._price(bar.open,buy=True)
            quantity=floor_step(D(12)/price,STEP)
            if filter_ok(quantity):
                receipt=benchmark.apply_fill({'fill_id':'BUY_HOLD_ENTRY','side':'BUY',
                         'timestamp_us':bar.open_us,'quantity':quantity,'price':price,
                         'reason':'BUY_HOLD','setup_id':'BUY_HOLD'})
            else:
                receipt={'eligible':False,'reasons':['initial_reference_unavailable_or_below_minimum']}
            benchmark_receipts.append(receipt)
            benchmark_started=True

        if position is not None:
            minutes_exposed+=1
            if not position['latched_exit']:
                stop,target=position['stop'],position['target']
                if bar.open<=stop:
                    exit_position(bar.open,bar.open_us,'STOP_GAP')
                elif target is not None and bar.open>=target:
                    exit_position(target,bar.open_us,'TARGET_GAP')
                elif bar.low<=stop:
                    exit_position(stop,bar.close_us,'STOP')
                elif target is not None and bar.high>=target:
                    exit_position(target,bar.close_us,'TARGET')

        append_history(bar)
        nav=conditional_nav(account,bar.close)
        peak=max(peak,nav)
        dd=peak-nav
        max_dd=max(max_dd,dd)
        max_dd_fraction=max(max_dd_fraction,dd/peak if peak else D(0))
        if max(D(0),day_start-nav)>=daily_limit:
            day_paused=True
        book_value=account.book_nav(bar.close) if account.inventory else account.cash
        book_peak=max(book_peak,book_value)
        book_max_dd=max(book_max_dd,book_peak-book_value)
        daily_book[current_vn_date]=book_value
        monthly_book[current_month]=book_value
        daily[current_vn_date]=nav
        if (bar.close_us+1)%HOUR_US==0:
            hourly[iso(bar.open_us)[:13]+':00:00+00:00']=nav
        monthly[current_month]=nav

    if last_bar is None:
        raise ValueError('empty replay window')
    if position is not None:
        exit_position(last_bar.close,last_bar.close_us,'END_OF_DATA')
    if pending is not None:
        record_skip(pending,'PENDING_AT_END_OF_DATA',end_us)
    if filter_ok(floor_step(benchmark.inventory,STEP)):
        benchmark_end=benchmark.sell(last_bar.close,last_bar.close_us,'BUY_HOLD_END')
    else:
        benchmark_end={'eligible':False,'reasons':['exit_reference_minimum_or_unknown']}
    benchmark_receipts.append(benchmark_end)
    final_nav=conditional_nav(account,last_bar.close)
    final_book=account.book_nav(last_bar.close)
    book_peak=max(book_peak,final_book)
    book_max_dd=max(book_max_dd,book_peak-final_book)
    daily_book[current_vn_date]=final_book
    monthly_book[current_month]=final_book
    daily[current_vn_date]=final_nav
    monthly[current_month]=final_nav
    peak=max(peak,final_nav)
    max_dd=max(max_dd,peak-final_nav)
    max_dd_fraction=max(max_dd_fraction,(peak-final_nav)/peak)
    wins=[t['net_pnl'] for t in trades if t['net_pnl']>0]
    losses=[t['net_pnl'] for t in trades if t['net_pnl']<0]
    total_win,total_loss=sum(wins,D(0)),-sum(losses,D(0))
    month_rows=[]
    previous=previous_book=D(15)
    for month,value in sorted(monthly.items()):
        matching=[t for t in trades if iso(t['exit_us'])[:7]==month]
        month_rows.append({'month':month,'start_nav':previous,'end_nav':value,
                           'net_pnl':value-previous,'closed_trades':len(matching),
                           'book_start_nav':previous_book,'book_end_nav':monthly_book[month],
                           'book_net_pnl':monthly_book[month]-previous_book})
        previous=value
        previous_book=monthly_book[month]
    daily_rows=[]
    previous=previous_book=D(15)
    for date,value in sorted(daily.items()):
        daily_rows.append({'date_vn':date,'end_nav':value,'net_pnl':value-previous,
                           'book_end_nav':daily_book[date],'book_net_pnl':daily_book[date]-previous_book})
        previous=value
        previous_book=daily_book[date]
    entry_days={iso(e['timestamp_us']+7*HOUR_US)[:10] for e in account.events if e['side']=='BUY'}
    streak=max_streak=0
    for trade in trades:
        streak=streak+1 if trade['net_pnl']<0 else 0
        max_streak=max(max_streak,streak)
    before_confirm=next((row['end_nav'] for row in month_rows if row['month']=='2024-12'),None)
    return {'case':asdict(case),'start_us':start_us,'end_us_exclusive':end_us,
            'initial_cash':D(15),'final_executable_nav':final_nav,'final_book_nav':final_book,
            'final_cash':account.cash,'final_inventory_sol':account.inventory,'net_pnl':final_nav-D(15),
            'net_return_fraction':final_nav/D(15)-D(1),'max_drawdown':max_dd,
            'max_drawdown_fraction':max_dd_fraction,'book_max_drawdown':book_max_dd,'candidates':candidate_count,'context_eligible':context_count,
            'entries':sum(e['side']=='BUY' for e in account.events),'closed_trades':len(trades),
            'open_position_at_end':position is not None,'win_rate':D(len(wins))/D(len(trades)) if trades else None,
            'average_win':total_win/D(len(wins)) if wins else None,
            'average_loss':-total_loss/D(len(losses)) if losses else None,
            'expectancy':sum((t['net_pnl'] for t in trades),D(0))/D(len(trades)) if trades else None,
            'profit_factor':total_win/total_loss if total_loss else None,'max_losing_streak':max_streak,
            'minutes_exposed':minutes_exposed,'days_without_entry':len(daily)-len(entry_days),
            'confirmation_net_pnl':final_nav-before_confirm if before_confirm is not None else None,
            'skips':dict(skips),'exit_reasons':dict(exits),
            'buy_fee_sol':sum((e['base_fee'] for e in account.events),D(0)),
            'sell_fee_usdt':sum((e['quote_fee'] for e in account.events),D(0)),
            'ai_calls':0,'ai_actual_cost':D(0),
            'ai_cost_sensitivity':{str(c):final_nav-D(15)-c for c in (D('.10'),D('.25'),D('.50'))},
            'incremental_vps_cost':None,'full_allocated_vps_cost':None,
            'buy_hold_final_nav':conditional_nav(benchmark,last_bar.close),
            'buy_hold_net_pnl':conditional_nav(benchmark,last_bar.close)-D(15),
            'buy_hold_receipts':benchmark_receipts,'market_first':market_first,'market_last':market_last,'final_reference_proxy':proxy,
            'monthly':month_rows,'daily':daily_rows,'hourly':[{'at':at,'nav':nav} for at,nav in sorted(hourly.items())],
            'events':account.events,'decisions':decisions,'trades':trades}


def source_identity(package:Path)->dict:
    sources={str(p.relative_to(package)):sha(p) for p in sorted(package.rglob('*.py')) if p.name!='report.py'}
    legacy=package.parent/'spot_backtest'
    for name in ('account.py','models.py'):
        sources['dependency/spot_backtest/'+name]=sha(legacy/name)
    return sources

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--protocol',type=Path,required=True)
    parser.add_argument('--data-dir',type=Path,required=True)
    parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--mode',choices=['qa','register','full'],required=True)
    args=parser.parse_args()
    args.output_dir.mkdir(parents=True,exist_ok=True)
    protocol=json.loads(args.protocol.read_text())
    design={k:v for k,v in protocol.items() if k!='design_sha256'}
    if hashlib.sha256(json.dumps(design,sort_keys=True,separators=(',',':')).encode()).hexdigest()!=protocol['design_sha256']:
        raise SystemExit('protocol canonical hash mismatch')
    if protocol['protocol_id']!='spot-two-mechanisms-aggressive-v3' or protocol['design_sha256']!='0bd81f2178eaeb3cf6574bd36077a3aea23928a9249cac2bb67ee3e2fb3d29eb':
        raise SystemExit('unrecognized protocol')
    identity={'protocol_sha256':sha(args.protocol),'data_manifest_sha256':sha(args.data_dir/'manifest.json'),
              'source_sha256':source_identity(Path(__file__).parent)}
    cases=[Case(model+'_'+c['suffix'],model,D(c['slip']),c['delay_seconds'],D(c['min_notional']),D(c['partial_fraction']))
           for model in protocol['mechanisms'] for c in protocol['cases']]
    registration_path=args.output_dir/'run-registration.json'
    if args.mode=='register':
        if registration_path.exists():
            raise SystemExit('registration immutable; no overwrite')
        qa=json.loads((args.output_dir/'qa.json').read_text())
        if qa['status']!='PASS' or any(qa.get(k)!=v for k,v in identity.items()):
            raise SystemExit('QA/source/data identity differs')
        aggregation=json.loads((args.data_dir/'aggregation-validation.json').read_text())
        if aggregation['status']!='EXACT_MATCH' or aggregation['expected_manifest_sha256']!=identity['data_manifest_sha256']:
            raise SystemExit('aggregation validation missing/mismatched')
        save_json(registration_path,{'registered_at_utc':datetime.now(timezone.utc).isoformat(),**identity,
                  'cases':[asdict(c) for c in cases],'qa_sha256':sha(args.output_dir/'qa.json'),
                  'tests_log_sha256':sha(args.output_dir/'qa-tests.log'),
                  'aggregation_sha256':sha(args.data_dir/'aggregation-validation.json'),
                  'interpretation':protocol['split']['interpretation']})
        snapshot=args.output_dir/'source-snapshot'
        for relative in identity['source_sha256']:
            source=(Path(__file__).parent/relative) if not relative.startswith('dependency/') else Path(__file__).parent.parent/relative[len('dependency/'):]
            target=snapshot/relative
            target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(source,target)
        print(json.dumps({'status':'REGISTERED_BEFORE_NEW_PNL','cases':len(cases)}),flush=True)
        return
    if args.mode=='full':
        registration=json.loads(registration_path.read_text())
        if any(registration.get(k)!=v for k,v in identity.items()):
            raise SystemExit('frozen sources/data/protocol changed')
        if (args.output_dir/'execution.json').exists():
            raise SystemExit('full stage already attempted; no silent rerun')
        save_json(args.output_dir/'execution.json',{'status':'RUNNING','started_at_utc':datetime.now(timezone.utc).isoformat(),**identity})
    elif registration_path.exists():
        raise SystemExit('cannot overwrite QA after freeze')
    started=time.monotonic()
    data_start=utc_us(protocol['data']['start_utc'])
    data_end=utc_us(protocol['data']['end_utc_exclusive'])
    qa_start=utc_us('2023-05-15')
    qa_end=utc_us('2023-05-22')
    feature_end=qa_end if args.mode=='qa' else data_end
    event_sets={model:list(generate_events(iter_bars(args.data_dir,'SOLUSDT','4h',data_start,feature_end),
                iter_bars(args.data_dir,'BTCUSDT','4h',data_start,feature_end),model)) for model in protocol['mechanisms']}
    if args.mode=='qa':
        results=[]
        for model,events in event_sets.items():
            result=run_replay(iter_bars(args.data_dir,'SOLUSDT','1m',qa_start-5*MINUTE_US,qa_end),
                              events,Case('development_qa_'+model,model),qa_start,qa_end)
            results.append({'model':model,'entries':result['entries'],'closed_trades':result['closed_trades'],
                            'ledger_fills':len(result['events'])})
        save_json(args.output_dir/'qa.json',{'status':'PASS','development_only':True,**identity,
                  'wall_seconds':time.monotonic()-started,'peak_memory_kib':linux_memory_kib(),'checks':results})
        print(json.dumps({'status':'QA_PASS_DEVELOPMENT_ONLY','checks':results}),flush=True)
        return
    summaries=[]
    try:
        for case in cases:
            print(json.dumps({'status':'CASE_STARTED','case':case.name}),flush=True)
            start=utc_us(protocol['split']['main_start'])
            result=run_replay(iter_bars(args.data_dir,'SOLUSDT','1m',start-5*MINUTE_US,data_end),
                              event_sets[case.model_id],case,start,data_end,started+protocol['run_limits']['full_replay_wall_cap_seconds'])
            save_json(args.output_dir/(case.name+'.json'),result)
            summaries.append({k:result[k] for k in ('case','net_pnl','final_executable_nav','closed_trades','profit_factor','max_drawdown','confirmation_net_pnl','open_position_at_end')})
            print(json.dumps({'status':'CASE_COMPLETE',**summaries[-1]},default=json_default),flush=True)
        save_json(args.output_dir/'execution.json',{'status':'COMPLETE','completed_at_utc':datetime.now(timezone.utc).isoformat(),**identity,
                  'wall_seconds':time.monotonic()-started,'peak_memory_kib':linux_memory_kib(),'summaries':summaries})
    except BaseException as exc:
        save_json(args.output_dir/'execution.json',{'status':'FAILED_INCOMPLETE','error':repr(exc),**identity,
                  'wall_seconds':time.monotonic()-started,'summaries':summaries})
        raise

if __name__=='__main__':
    main()
