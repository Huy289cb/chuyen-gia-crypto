"""Deploy the reviewed BTC range opportunity policy and its tested dispatch fixes."""
import pathlib, subprocess, json, hashlib, os, datetime, shutil
ROOT=pathlib.Path('/home/ubuntu/chuyen-gia-crypto/backend');os.chdir(ROOT)
OUT=ROOT.parent/'docs/deployments/2026-09-07-btc-range'
AUDIT=ROOT.parent/'docs/audits/2026-09-07-btc-range-promotion'
PLAN=json.loads((OUT/'plan.json').read_text())
backup=pathlib.Path('/home/ubuntu/.local/state/chuyen-gia-crypto/deployments/20260907-btc-range')
old=ROOT/'dist-pre-btc-range-20260907';stage=ROOT/'dist-btc-range-staged'
if old.exists() or stage.exists():raise SystemExit('Existing deployment state requires inspection')
tests=(AUDIT/'live-path-final-tests.log').read_text()
if '54 passed' not in tests or 'failed' in tests.lower():raise SystemExit('Final tests not green')
if (AUDIT/'build.log').read_text().strip():raise SystemExit('Build diagnostics present')
sources={}
for stem in PLAN['files']:
    src=ROOT/'src'/(stem+'.ts');built=ROOT/'dist-btc-range-candidate'/(stem+'.js')
    if not built.exists() or built.stat().st_mtime<src.stat().st_mtime:raise SystemExit('Missing or stale build '+stem)
    sources[str(src.relative_to(ROOT))]=hashlib.sha256(src.read_bytes()).hexdigest()
daemon=int(pathlib.Path('/home/ubuntu/.pm2/pm2.pid').read_text())
assert pathlib.Path('/proc',str(daemon)).exists()
for app in ['crypto-api','crypto-worker']:
    files=list(pathlib.Path('/home/ubuntu/.pm2/pids').glob(app+'-*.pid'));assert len(files)==1
    pid=int(files[0].read_text());stat=pathlib.Path('/proc',str(pid),'stat').read_text()
    assert int(stat.rsplit(')',1)[1].split()[1])==daemon
subprocess.run(['node','scripts/check-btc-range-exchange.cjs'],check=True,timeout=60)
backup.mkdir(parents=True,exist_ok=False,mode=0o700)
shutil.copy2(ROOT/'.env',backup/'predeploy.env');os.chmod(backup/'predeploy.env',0o600)
# Preserve every previously deployed module; replace only the reviewed live dependency set.
shutil.copytree(ROOT/'dist',stage)
for stem in PLAN['files']:
    for suffix in ['.js','.js.map','.d.ts','.d.ts.map']:
        src=ROOT/'dist-btc-range-candidate'/(stem+suffix)
        if src.exists():
            dest=stage/(stem+suffix);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest)
subprocess.run(['pm2','stop','crypto-api','crypto-worker'],check=True,timeout=30)
try:
    env={**os.environ,'BTC_RANGE_CHECK_FILE':str(OUT/'exchange-after-stop.json')}
    subprocess.run(['node','scripts/check-btc-range-exchange.cjs'],env=env,check=True,timeout=60)
    changes=PLAN['liveEnvChanges']
    lines=[l for l in (ROOT/'.env').read_text().splitlines() if l.split('=',1)[0] not in changes]
    lines.extend(k+'='+v for k,v in changes.items());(ROOT/'.env').write_text('\n'.join(lines)+'\n')
    (ROOT/'dist').rename(old);stage.rename(ROOT/'dist')
    subprocess.run(['pm2','start','ecosystem.config.cjs','--update-env'],check=True,timeout=40)
    subprocess.run(['pm2','save'],check=True,timeout=30)
except BaseException:
    if old.exists():
        if (ROOT/'dist').exists():shutil.rmtree(ROOT/'dist')
        old.rename(ROOT/'dist')
    shutil.copy2(backup/'predeploy.env',ROOT/'.env')
    subprocess.run(['pm2','start','ecosystem.config.cjs','--update-env'],timeout=40)
    raise
files={str(p.relative_to(ROOT/'dist')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'dist').rglob('*.js')}
manifest={'deployedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'riskCapUsd':1,
          'envChanges':PLAN['liveEnvChanges'],'changedModules':PLAN['files'],'sourceHashes':sources,
          'files':files,'rollbackBuild':str(old),'backupEnv':str(backup/'predeploy.env')}
(OUT/'deployment-manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({k:v for k,v in manifest.items() if k not in ['files','sourceHashes']}))
