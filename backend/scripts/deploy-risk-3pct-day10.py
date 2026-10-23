"""Apply explicit user request: 1h trading cooldowns, daily 10%, per-trade 3%."""
import pathlib,subprocess,json,hashlib,os,datetime,shutil
ROOT=pathlib.Path('/home/ubuntu/chuyen-gia-crypto/backend');os.chdir(ROOT)
OUT=ROOT.parent/'docs/deployments/2026-09-08-risk-3pct-day10'
updates=json.loads((OUT/'plan.json').read_text())['updates']
assert json.loads((OUT/'preflight.json').read_text())['passed']
backup=pathlib.Path('/home/ubuntu/.local/state/chuyen-gia-crypto/deployments/20260908-risk-3pct-day10')
backup.mkdir(mode=0o700,parents=True,exist_ok=False)
shutil.copy2(ROOT/'.env',backup/'before.env');os.chmod(backup/'before.env',0o600)
daemon=int(pathlib.Path('/home/ubuntu/.pm2/pm2.pid').read_text())
for app in ['crypto-api','crypto-worker']:
 files=list(pathlib.Path('/home/ubuntu/.pm2/pids').glob(app+'-*.pid'));assert len(files)==1
 pid=int(files[0].read_text());assert int(pathlib.Path('/proc',str(pid),'stat').read_text().rsplit(')',1)[1].split()[1])==daemon
before={str(p.relative_to(ROOT/'dist')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'dist').rglob('*.js')}
subprocess.run(['node','scripts/check-open-costs-exchange.cjs'],env={**os.environ,'OPEN_COSTS_CHECK_FILE':str(OUT/'exchange-before.json')},check=True,timeout=60)
lines=(ROOT/'.env').read_text().splitlines();seen={}
for line in lines:
 key,sep,value=line.partition('=')
 if sep and key in updates:seen[key]=value
try:
 subprocess.run(['pm2','stop','crypto-api','crypto-worker'],check=True,timeout=30)
 subprocess.run(['node','scripts/check-open-costs-exchange.cjs'],env={**os.environ,'OPEN_COSTS_CHECK_FILE':str(OUT/'exchange-after-stop.json')},check=True,timeout=60)
 lines=[line for line in lines if line.partition('=')[0] not in updates]
 lines.extend(key+'='+value for key,value in updates.items())
 (ROOT/'.env').write_text('\n'.join(lines)+'\n')
 subprocess.run(['pm2','start','ecosystem.config.cjs','--update-env'],check=True,timeout=45)
 subprocess.run(['pm2','save'],check=True,timeout=30)
except BaseException:
 shutil.copy2(backup/'before.env',ROOT/'.env')
 subprocess.run(['pm2','start','ecosystem.config.cjs','--update-env'],timeout=45)
 raise
assert before=={str(p.relative_to(ROOT/'dist')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'dist').rglob('*.js')}
manifest={'deployedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'envChanges':{k:{'before':seen.get(k),'after':v} for k,v in updates.items()},'files':before,'codeChanged':False,'backup':str(backup/'before.env'),'authorization':'Explicit user request: cooldown 1h, max ngày 10%, max 1 lệnh 3%'}
(OUT/'deployment-manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps({k:v for k,v in manifest.items() if k!='files'}))
