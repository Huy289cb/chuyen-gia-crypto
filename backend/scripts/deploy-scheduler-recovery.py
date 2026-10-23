"""Deploy scheduler missed-tick recovery; keep the active position and protection on exchange."""
import pathlib,subprocess,json,hashlib,os,datetime,shutil,re
ROOT=pathlib.Path('/home/ubuntu/chuyen-gia-crypto/backend');os.chdir(ROOT)
OUT=ROOT.parent/'docs/deployments/2026-09-08-scheduler-recovery'
stems=['schedulers/market-scan.scheduler','schedulers/llm-dispatch.scheduler']
old=ROOT/'dist-pre-scheduler-recovery-20260908';stage=ROOT/'dist-scheduler-recovery-staged'
if old.exists() or stage.exists():raise SystemExit('Existing deployment state requires inspection')
for name,passed in [('final-tests.log','23 passed')]:
    s=(OUT/name).read_text()
    if passed not in s or re.search(r'(?:Test Files|Tests)\s+[^\n]*\d+ failed',s):raise SystemExit('Tests not green '+name)
if (OUT/'build-final.log').read_text().strip():raise SystemExit('Build diagnostics present')
for stem in stems:
    src=ROOT/'src'/(stem+'.ts');built=ROOT/'dist-scheduler-recovery-candidate'/(stem+'.js')
    if not built.exists() or built.stat().st_mtime<src.stat().st_mtime:raise SystemExit('Stale build '+stem)
daemon=int(pathlib.Path('/home/ubuntu/.pm2/pm2.pid').read_text())
for app in ['crypto-api','crypto-worker']:
    files=list(pathlib.Path('/home/ubuntu/.pm2/pids').glob(app+'-*.pid'));assert len(files)==1
    pid=int(files[0].read_text())
    assert int(pathlib.Path('/proc',str(pid),'stat').read_text().rsplit(')',1)[1].split()[1])==daemon
subprocess.run(['node','scripts/check-open-costs-exchange.cjs'],env={**os.environ,'OPEN_COSTS_CHECK_FILE':str(OUT/'exchange-before.json')},check=True,timeout=60)
shutil.copytree(ROOT/'dist',stage)
for stem in stems:
    for suffix in ['.js','.js.map','.d.ts','.d.ts.map']:
        src=ROOT/'dist-scheduler-recovery-candidate'/(stem+suffix)
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
 'envChanges':{},'riskCapUsd':1,'strategyChanges':False,'rollbackBuild':str(old),
 'sourceHashes':{stem:hashlib.sha256((ROOT/'src'/(stem+'.ts')).read_bytes()).hexdigest() for stem in stems},
 'files':{str(p.relative_to(ROOT/'dist')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'dist').rglob('*.js')}}
(OUT/'deployment-manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({k:v for k,v in manifest.items() if k not in ['files','sourceHashes']}))
