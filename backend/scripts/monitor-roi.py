#!/usr/bin/env python3
"""Read-only deployment monitor. Writes only meaningful state changes; never trades or sends messages."""
import datetime, fcntl, json, os, pathlib, subprocess, urllib.request
STATE = pathlib.Path('/home/ubuntu/.local/state/chuyen-gia-crypto/roi-monitor')
STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
lock = (STATE / 'lock').open('w')
try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError: raise SystemExit(0)
now = datetime.datetime.now(datetime.timezone.utc)
alerts = []
def http(path):
    with urllib.request.urlopen('http://127.0.0.1:3000'+path, timeout=15) as response:
        return json.load(response)
# Reading PID files avoids `pm2 jlist`, which can start an empty daemon when its socket is unavailable.
processes = {}
try: daemon_pid = int(pathlib.Path('/home/ubuntu/.pm2/pm2.pid').read_text().strip())
except (OSError, ValueError): daemon_pid = 0
for name, entry in [('crypto-api','server.js'), ('crypto-worker','worker.js')]:
    live = []
    for pid_file in pathlib.Path('/home/ubuntu/.pm2/pids').glob(name+'-*.pid'):
        try:
            pid = int(pid_file.read_text().strip())
            command = (pathlib.Path('/proc')/str(pid)/'cmdline').read_bytes().replace(b'\0',b' ').decode()
            if '/home/ubuntu/chuyen-gia-crypto/backend/dist/'+entry in command:
                live.append(pid)
                parent = int((pathlib.Path('/proc')/str(pid)/'stat').read_text().rsplit(')',1)[1].split()[1])
                if parent != daemon_pid: alerts.append(name+'_not_managed_by_current_pm2')
        except (OSError, ValueError): pass
    processes[name] = {'status':'online' if len(live)==1 else 'unavailable', 'pids': sorted(live)}
    if len(live)!=1: alerts.append(name+'_process_unavailable_or_duplicate')
try:
    health = http('/health')
    if health.get('status') != 'ok': alerts.append('api_unhealthy')
except Exception: health = {}; alerts.append('api_unhealthy')
query = """SELECT json_build_object(
'heartbeats',(SELECT json_agg(json_build_object('name',name,'age_seconds',extract(epoch from now()-last_run))) FROM scheduler_heartbeats),
'account',(SELECT json_build_object('balance',current_balance,'baseline',starting_balance,'net_pnl',realized_pnl,'trades',total_trades) FROM testnet_accounts WHERE symbol='BTC' AND method_id='kim_nghia'),
'open_positions',(SELECT count(*) FROM testnet_positions WHERE status='open' AND size_qty>0),
'ledger_verified',(SELECT count(DISTINCT position_id) FROM testnet_trade_events WHERE event_type='pnl_ledger_v2'),
'closed_positions',(SELECT count(*) FROM testnet_positions WHERE status='closed' AND size_qty>0 AND binance_order_id IS NOT NULL),
'adaptive_candidates',(SELECT count(*) FROM testnet_trade_events WHERE event_type='transition_retest_candidate' AND timestamp>now()-interval '1 day'),
'provider_calls',(SELECT count(*) FROM testnet_trade_events WHERE event_type='llm_provider_request' AND timestamp>now()-interval '1 day'),
'range_funnel',(SELECT json_build_object(
'live_candidates',count(*) FILTER (WHERE event_type='transition_retest_candidate' AND event_data::json->>'mode'='live'),
'live_confirmed',count(*) FILTER (WHERE event_type='transition_retest_confirmed' AND event_data::json->>'mode'='live'),
'llm_dispatches',count(*) FILTER (WHERE event_type='transition_retest_live_dispatch'),
'execution_successes',count(*) FILTER (WHERE event_type='transition_retest_live_dispatch' AND event_data::json->>'execution_success'='true'))
FROM testnet_trade_events WHERE timestamp >= '2026-09-07T15:21:51Z' AND event_data::json->>'candidate_kind'='range_sweep_reclaim'),
'range_realized',(SELECT json_build_object('closed_trades',count(*),'net_usdt',coalesce(sum(o.realized_pnl),0)) FROM trade_outcomes o JOIN (
SELECT DISTINCT (event_data::json->>'decision_id')::integer AS decision_id FROM testnet_trade_events
WHERE event_type='transition_retest_live_dispatch' AND timestamp >= '2026-09-07T15:21:51Z'
AND event_data::json->>'candidate_kind'='range_sweep_reclaim' AND event_data::json->>'execution_success'='true'
) d ON d.decision_id=o.decision_id))"""
try:
    raw = subprocess.check_output(['docker','exec','-e','PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=10000','chuyen-gia-postgres','psql','-U','crypto','-d','chuyen_gia','-Atc',query], timeout=20)
    db = json.loads(raw)
    hb = {h['name']: h['age_seconds'] for h in db['heartbeats'] or []}
    for name in ('MarketScan', 'LLMDispatch'):
        if hb.get(name, 99999) > 720: alerts.append('stale_'+name)
    a = db['account']
    if a and not db['open_positions'] and abs(a['balance']-a['baseline']-a['net_pnl'])>0.01: alerts.append('wallet_net_ledger_gap')
    if db['ledger_verified'] < db['closed_positions']: alerts.append('ledger_coverage_incomplete')
except Exception: db = {}; alerts.append('database_unavailable')
result = {'checked_at':now.isoformat(),'alerts':sorted(alerts),'processes':processes,'db':db}
previous = {}
try: previous=json.loads((STATE/'latest.json').read_text())
except Exception: pass
signature = lambda x: { 'alerts':x.get('alerts'), 'processes':x.get('processes'),
    'trades':x.get('db',{}).get('account',{}).get('trades'), 'open_positions':x.get('db',{}).get('open_positions'), 'adaptive_candidates':x.get('db',{}).get('adaptive_candidates'), 'range_funnel':x.get('db',{}).get('range_funnel'), 'range_realized':x.get('db',{}).get('range_realized'), 'provider_calls':x.get('db',{}).get('provider_calls') }
if signature(previous) != signature(result):
    with (STATE/'changes.jsonl').open('a') as out: out.write(json.dumps(result)+'\n')
    print(json.dumps(result))
temp = STATE/'latest.tmp'
temp.write_text(json.dumps(result, indent=2)); os.chmod(temp,0o600); temp.replace(STATE/'latest.json')
