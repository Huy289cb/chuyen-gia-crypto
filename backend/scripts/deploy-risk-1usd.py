"""Deploy explicit user-authorized 1 USDT total risk cap. No ledger/order mutations."""
import pathlib,subprocess,json,hashlib,os,datetime,shutil
ROOT=pathlib.Path('/home/ubuntu/chuyen-gia-crypto/backend');os.chdir(ROOT)
OUT=ROOT.parent/'docs/deployments/2026-09-07-risk-1usd'
backup=pathlib.Path('/home/ubuntu/.local/state/chuyen-gia-crypto/deployments/20260907-risk-1usd')
for name in ['tests.log','additional-tests.log']:
    content=(OUT/name).read_text()
    if 'passed' not in content or 'failed' in content.lower():raise SystemExit('Tests not green: '+name)
if (OUT/'build.log').read_text().strip():raise SystemExit('Build errors')
for source in (ROOT/'src').rglob('*.ts'):
    if source.name.endswith(('.d.ts','.test.ts')):continue
    built=ROOT/'dist-risk-1usd'/source.relative_to(ROOT/'src').with_suffix('.js')
    if not built.exists() or built.stat().st_mtime<source.stat().st_mtime:raise SystemExit('Candidate stale: '+str(source))
daemon=int(pathlib.Path('/home/ubuntu/.pm2/pm2.pid').read_text())
assert pathlib.Path('/proc',str(daemon)).exists()
for app in ['crypto-api','crypto-worker']:
    files=list(pathlib.Path('/home/ubuntu/.pm2/pids').glob(app+'-*.pid'))
    assert len(files)==1
    pid=int(files[0].read_text());stat=pathlib.Path('/proc',str(pid),'stat').read_text()
    assert int(stat.rsplit(')',1)[1].split()[1])==daemon
subprocess.run(['node','scripts/check-risk-1usd-exchange.cjs'],check=True,timeout=60)
old=ROOT/'dist-pre-risk-1usd-20260907'
if old.exists():raise SystemExit('Rollback directory exists; review before retry')
shutil.copy2(ROOT/'.env',backup/'immediate-predeploy.env');os.chmod(backup/'immediate-predeploy.env',0o600)
subprocess.run(['pm2','stop','crypto-api','crypto-worker'],check=True,timeout=30)
try:
    # Recheck after worker stops so no scan can create a trade during the swap.
    subprocess.run(['node','scripts/check-risk-1usd-exchange.cjs'],check=True,timeout=60)
    lines=(ROOT/'.env').read_text().splitlines()
    lines=[l for l in lines if not l.startswith('MAX_EFFECTIVE_RISK_PER_TRADE_USD=')]
    lines.append('MAX_EFFECTIVE_RISK_PER_TRADE_USD=1')
    (ROOT/'.env').write_text('\n'.join(lines)+'\n')
    (ROOT/'dist').rename(old)
    shutil.copytree(ROOT/'dist-risk-1usd',ROOT/'dist')
    subprocess.run(['pm2','start','ecosystem.config.cjs','--update-env'],check=True,timeout=40)
    subprocess.run(['pm2','save'],check=True,timeout=30)
except Exception:
    if old.exists():
        if (ROOT/'dist').exists():shutil.rmtree(ROOT/'dist')
        old.rename(ROOT/'dist')
    shutil.copy2(backup/'immediate-predeploy.env',ROOT/'.env')
    subprocess.run(['pm2','start','ecosystem.config.cjs','--update-env'],timeout=40)
    raise
files={str(p.relative_to(ROOT/'dist')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'dist').rglob('*.js')}
manifest={'deployedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'userAuthorizedRiskCapUsd':1,'mode':'fixed_usd_overrides_percent','includes':'SL price risk + fee reserve + slippage reserve','adaptiveMode':'shadow','files':files,'rollbackBuild':str(old)}
(OUT/'deployment-manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({k:v for k,v in manifest.items() if k!='files'}))
