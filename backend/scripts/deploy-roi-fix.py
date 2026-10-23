#!/usr/bin/env python3
"""One-time reviewed ROI release. Requires completed tests/backtests and a flat Binance account."""
import hashlib, json, os, pathlib, shutil, signal, subprocess, time, datetime
ROOT = pathlib.Path('/home/ubuntu/chuyen-gia-crypto/backend')
OUT = ROOT.parent/'docs/deployments/2026-09-06-roi-fix'
BACKUP = pathlib.Path('/home/ubuntu/.local/state/chuyen-gia-crypto/deployments/20260906-roi-fix')
os.chdir(ROOT)
def run(args, **kw): return subprocess.run(args, check=True, **kw)
def cmd(pid):
    try: return (pathlib.Path('/proc')/str(pid)/'cmdline').read_bytes().replace(b'\0',b' ').decode()
    except FileNotFoundError: return ''
def live(pid):
    try: return (pathlib.Path('/proc')/str(pid)/'stat').read_text().rsplit(')',1)[1].split()[0] != 'Z'
    except FileNotFoundError: return False
if not (OUT/'core-backtest.json').exists() or not (OUT/'adaptive-backtest.json').exists(): raise SystemExit('Backtests not complete')
tests = pathlib.Path('/tmp/roi-fix-acceptance-tests.log').read_text()
if '100 passed (100)' not in tests or 'failed' in tests.split('Test Files')[-1]: raise SystemExit('Acceptance tests not complete/green')
if pathlib.Path('/tmp/roi-fix-build-verified.log').read_text().strip(): raise SystemExit('Build reported errors')
for source in (ROOT/'src').rglob('*.ts'):
    if source.name.endswith(('.d.ts','.test.ts')): continue
    built=ROOT/'dist-candidate'/source.relative_to(ROOT/'src').with_suffix('.js')
    if not built.exists() or built.stat().st_mtime<source.stat().st_mtime: raise SystemExit('Build stale: '+str(source))
run(['node','scripts/check-roi-exchange.cjs'])
with (BACKUP/'immediate-predeploy.dump').open('wb') as f: run(['docker','exec','chuyen-gia-postgres','pg_dump','-U','crypto','-d','chuyen_gia','-Fc'],stdout=f)
os.chmod(BACKUP/'immediate-predeploy.dump',0o600)
shutil.copy2(ROOT/'.env',BACKUP/'immediate-predeploy.env');os.chmod(BACKUP/'immediate-predeploy.env',0o600)
# This release also repairs the inaccessible original PM2 session. Never start a second worker.
apps=json.loads(subprocess.check_output(['pm2','jlist']))
if apps: raise SystemExit('PM2 state changed: review process ownership before deployment')
old_daemon=2252
if 'PM2' not in cmd(old_daemon): raise SystemExit('Original daemon changed; review process ownership')
children=[]
for proc in pathlib.Path('/proc').iterdir():
    if not proc.name.isdigit(): continue
    try: parent=int((proc/'stat').read_text().rsplit(')',1)[1].split()[1])
    except (OSError,ValueError): continue
    if parent==old_daemon: children.append((int(proc.name),cmd(int(proc.name))))
if len(children)!=2 or not all(str(ROOT/'dist')+'/' in c for _,c in children): raise SystemExit('Unexpected apps on original daemon')
run(['pm2','kill']) # verified empty new daemon only
os.kill(old_daemon,signal.SIGTERM) # PM2 gracefully stops its registered apps
for _ in range(100):
    if not live(old_daemon) and not any(live(pid) for pid,_ in children): break
    time.sleep(0.2)
else: raise SystemExit('Old processes did not terminate; deployment stopped to prevent duplicate workers')
# Recheck after the old worker has stopped to close the preflight/startup race.
post_stop = subprocess.run(['node','scripts/check-roi-exchange.cjs'])
if post_stop.returncode:
    run(['pm2','start','ecosystem.config.cjs','--update-env'])
    run(['pm2','save'])
    raise SystemExit('Exchange changed or became unavailable; original runtime restored for review')
# Change only reviewed runtime controls. Preserve all other env values.
updates={'V3_ADAPTIVE_SETUP_MODE':'shadow','MINIMUM_LOT_STOP_NORMALIZATION_ENABLED':'false','V3_ADAPTIVE_FEE_PCT_PER_SIDE':'0.0005'}
lines=(ROOT/'.env').read_text().splitlines();seen=set();new=[]
for line in lines:
    key=line.split('=',1)[0].strip() if '=' in line and not line.lstrip().startswith('#') else ''
    if key in updates:
        if key not in seen:new.append(key+'='+updates[key]);seen.add(key)
    else:new.append(line)
new.extend(k+'='+v for k,v in updates.items() if k not in seen)
(ROOT/'.env').write_text('\n'.join(new)+'\n')
try:
    run(['node','scripts/apply-roi-ledger.cjs'])
    previous=ROOT/'dist-pre-roi-20260907'
    if previous.exists(): raise RuntimeError('Rollback directory already exists')
    (ROOT/'dist').rename(previous)
    (ROOT/'dist-candidate').rename(ROOT/'dist')
    run(['pm2','start','ecosystem.config.cjs','--update-env'])
    run(['pm2','save'])
except Exception:
    print('Deployment interrupted; backups preserved. Review state before any restart.',flush=True)
    raise
files={str(p.relative_to(ROOT/'dist')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'dist').rglob('*.js')}
manifest={'deployedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'runtimeControls':updates,
          'buildDigest':hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest(),'files':files,
          'rollbackBuild':str(ROOT/'dist-pre-roi-20260907'),'backup':str(BACKUP)}
(OUT/'deployment-manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({k:v for k,v in manifest.items() if k!='files'}))
