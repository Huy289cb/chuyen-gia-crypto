"""Deploy consistent structural target bounds; keep the active position and protection on exchange."""
import pathlib,subprocess,json,hashlib,os,datetime,shutil,re
ROOT=pathlib.Path('/home/ubuntu/chuyen-gia-crypto/backend');os.chdir(ROOT)
OUT=ROOT.parent/'docs/deployments/2026-09-09-target-bound'
stems=['services/groq-levels-adapter.service']
old=ROOT/'dist-pre-target-bound-20260909';stage=ROOT/'dist-target-bound-staged'
if old.exists() or stage.exists():raise SystemExit('Existing deployment state requires inspection')
for name,passed in [('tests.log','13 passed')]:
    s=(OUT/name).read_text()
    if passed not in s or re.search(r'(?:Test Files|Tests)\s+[^\n]*\d+ failed',s):raise SystemExit('Tests not green '+name)
if (OUT/'build.log').read_text().strip():raise SystemExit('Build diagnostics present')
for stem in stems:
    src=ROOT/'src'/(stem+'.ts');built=ROOT/'dist-target-bound-candidate'/(stem+'.js')
    if not built.exists() or built.stat().st_mtime<src.stat().st_mtime:raise SystemExit('Stale build '+stem)
approved=json.loads((ROOT.parent/'docs/deployments/2026-09-08-risk-3pct-day10/plan.json').read_text())['updates']
file_env=dict(line.split('=',1) for line in (ROOT/'.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
assert all(file_env.get(k)==v for k,v in approved.items()), 'Pinned risk configuration mismatch'
daemon=int(pathlib.Path('/home/ubuntu/.pm2/pm2.pid').read_text())
for app in ['crypto-api','crypto-worker']:
    files=list(pathlib.Path('/home/ubuntu/.pm2/pids').glob(app+'-*.pid'));assert len(files)==1
    pid=int(files[0].read_text())
    live_env=dict(row.split('=',1) for row in pathlib.Path('/proc',str(pid),'environ').read_bytes().decode().split('\0') if '=' in row)
    assert all(live_env.get(k)==v for k,v in approved.items()), 'Live pinned policy mismatch'
    assert int(pathlib.Path('/proc',str(pid),'stat').read_text().rsplit(')',1)[1].split()[1])==daemon
subprocess.run(['node','scripts/check-open-costs-exchange.cjs'],env={**os.environ,'OPEN_COSTS_CHECK_FILE':str(OUT/'exchange-before.json')},check=True,timeout=60)
shutil.copytree(ROOT/'dist',stage)
for stem in stems:
    for suffix in ['.js','.js.map','.d.ts','.d.ts.map']:
        src=ROOT/'dist-target-bound-candidate'/(stem+suffix)
        if src.exists():shutil.copy2(src,stage/(stem+suffix))
subprocess.run(['pm2','stop','crypto-api','crypto-worker'],check=True,timeout=30)
try:
    subprocess.run(['node','scripts/check-open-costs-exchange.cjs'],env={**os.environ,'OPEN_COSTS_CHECK_FILE':str(OUT/'exchange-after-stop.json')},check=True,timeout=60)
    (ROOT/'dist').rename(old);stage.rename(ROOT/'dist')
    subprocess.run(['pm2','start','ecosystem.config.cjs','--update-env'],check=True,timeout=40)
    subprocess.run(['pm2','save'],check=True,timeout=30)
except BaseException:
    if old.exists():
        if (ROOT/'dist').exists():shutil.rmtree(ROOT/'dist')
        old.rename(ROOT/'dist')
    subprocess.run(['pm2','start','ecosystem.config.cjs','--update-env'],timeout=40)
    raise
manifest={'deployedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'changedModules':stems,
 'envChanges':{},'riskCapUsd':None,'riskCapPercent':3,'dailyLossLimitPercent':10,'cooldownHours':1,'strategyChanges':False,'rollbackBuild':str(old),
 'sourceHashes':{stem:hashlib.sha256((ROOT/'src'/(stem+'.ts')).read_bytes()).hexdigest() for stem in stems},
 'files':{str(p.relative_to(ROOT/'dist')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'dist').rglob('*.js')}}
(OUT/'deployment-manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({k:v for k,v in manifest.items() if k not in ['files','sourceHashes']}))
