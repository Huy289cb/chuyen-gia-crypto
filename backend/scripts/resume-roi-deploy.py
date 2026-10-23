#!/usr/bin/env python3
"""Resume the reviewed release after the batch reconciliation fix; never restart old workers."""
import pathlib,subprocess,json,hashlib,os,datetime
ROOT=pathlib.Path('/home/ubuntu/chuyen-gia-crypto/backend');os.chdir(ROOT)
OUT=ROOT.parent/'docs/deployments/2026-09-06-roi-fix'
for source in (ROOT/'src').rglob('*.ts'):
    if source.name.endswith(('.d.ts','.test.ts')):continue
    built=ROOT/'dist-candidate'/source.relative_to(ROOT/'src').with_suffix('.js')
    if not built.exists() or built.stat().st_mtime<source.stat().st_mtime:raise SystemExit('Candidate build stale')
if pathlib.Path('/tmp/roi-fix-build-verified.log').read_text().strip():raise SystemExit('Build errors')
for proc in pathlib.Path('/proc').iterdir():
    if not proc.name.isdigit():continue
    try:
        command=(proc/'cmdline').read_bytes().replace(b'\0',b' ').decode()
        if command.startswith('node '+str(ROOT/'dist')) and ('/server.js' in command or '/worker.js' in command):
            raise SystemExit('Existing application process found; review ownership')
    except (OSError,UnicodeDecodeError):pass
subprocess.run(['node','scripts/check-roi-exchange.cjs'],check=True)
subprocess.run(['node','scripts/apply-roi-ledger.cjs'],check=True)
previous=ROOT/'dist-pre-roi-20260907'
if previous.exists():raise SystemExit('Rollback build already exists; review release state')
(ROOT/'dist').rename(previous);(ROOT/'dist-candidate').rename(ROOT/'dist')
subprocess.run(['pm2','start','ecosystem.config.cjs','--update-env'],check=True)
subprocess.run(['pm2','save'],check=True)
files={str(p.relative_to(ROOT/'dist')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'dist').rglob('*.js')}
manifest={'deployedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
'runtimeControls':{'V3_ADAPTIVE_SETUP_MODE':'shadow','MINIMUM_LOT_STOP_NORMALIZATION_ENABLED':'false','V3_ADAPTIVE_FEE_PCT_PER_SIDE':'0.0005'},
'buildDigest':hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest(),'files':files,
'rollbackBuild':str(previous),'backup':'/home/ubuntu/.local/state/chuyen-gia-crypto/deployments/20260906-roi-fix'}
(OUT/'deployment-manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps({k:v for k,v in manifest.items() if k!='files'}))
