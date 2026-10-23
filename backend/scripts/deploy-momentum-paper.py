#!/usr/bin/env python3
"""Publish only the reviewed paper module/router; keep all other deployed bytes."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

BACKEND = Path(__file__).resolve().parents[1]
PKG = BACKEND.parent / 'docs/audits/futures-quick-win/momentum-paper-implementation-20261014T043000Z'
DEPLOYMENT = PKG / 'deployment'
DIST = BACKEND / 'dist'
CANDIDATE = BACKEND / 'dist-portfolio-paper-candidate'
def inventory(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file()}
def command(*args):
    return subprocess.run(args,cwd=BACKEND,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=60)
def health():
    with urllib.request.urlopen('http://127.0.0.1:3000/health',timeout=5) as r: return r.status==200

assert json.loads((PKG/'receipts/independent-ledger-audit.json').read_text())['status']=='PASS'
assert json.loads((PKG/'outputs/report.json').read_text())['status']=='COMPLETE_ACCELERATED_PAPER_TESTBED'
assert (CANDIDATE/'portfolio/paper-worker.js').exists()
DEPLOYMENT.mkdir(parents=True,exist_ok=True)
with (BACKEND/'.measurement-release.lock').open('w') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    previous=inventory(DIST)
    (DEPLOYMENT/'baseline-inventory.json').write_text(json.dumps(previous,indent=2)+'\n')
    index=DIST/'routes/index.js'
    body=index.read_text()
    mount="router.use('/portfolio-paper', require('./portfolio-paper').default);"
    assert mount not in body and not (DIST/'portfolio').exists(), 'Paper release already exists; refuse an unregistered replacement'
    needle="router.use('/market', market_1.default);"
    assert body.count(needle)==1, 'Unexpected deployed router shape'
    reviewed=body.replace(needle,needle+'\n'+mount)
    shutil.copy2(index,DEPLOYMENT/'index.before.js')
    (DEPLOYMENT/'index.release.js').write_text(reviewed)
    assert health()
    command('pm2','stop','crypto-api')
    applied=False
    try:
        assert inventory(DIST)==previous, 'Deployed bytes changed during preflight'
        shutil.copytree(CANDIDATE/'portfolio',DIST/'portfolio')
        for p in (CANDIDATE/'routes').glob('portfolio-paper.*'): shutil.copy2(p,DIST/'routes'/p.name)
        temporary=index.with_suffix('.paper-stage.js')
        temporary.write_text(reviewed); os.replace(temporary,index)
        applied=True
        current=inventory(DIST)
        changed=[p for p,h in previous.items() if current.get(p)!=h]
        assert changed==['routes/index.js'], changed
        command('pm2','start','crypto-api')
        for _ in range(30):
            try:
                if health(): break
            except Exception: pass
            time.sleep(1)
        else: raise RuntimeError('API did not recover after paper-router release')
        with urllib.request.urlopen('http://127.0.0.1:3000/api/portfolio-paper',timeout=10) as r:
            status=json.load(r)
        assert status['success'] and status['data']['mode']=='paper' and status['data']['policy']['initialBalance']==100
        command('pm2','start','ecosystem.portfolio-paper.config.cjs','--only','crypto-portfolio-paper')
        command('pm2','save')
        receipt={'status':'DEPLOYED_PAPER_ONLY','utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
                 'oldRuntimeFilesUnchanged':len(previous)-1,'changedExistingFiles':changed,
                 'newFiles':{p:h for p,h in current.items() if p not in previous},
                 'apiHealth':True,'paperApi':True,'paperWorkerStarted':True,
                 'legacyWorkerRestarted':False,'privateOrdersSent':False,'envFileChanged':False,
                 'databaseMigration':False,'frontendVercelPublished':False,
                 'view':'/api/portfolio-paper/view','rollback':'restore deployment/index.before.js, stop crypto-portfolio-paper, restart crypto-api'}
        (DEPLOYMENT/'release.json').write_text(json.dumps(receipt,indent=2)+'\n')
        print(json.dumps(receipt,indent=2))
    except BaseException:
        if applied:
            command('pm2','stop','crypto-api')
            shutil.copy2(DEPLOYMENT/'index.before.js',index)
            shutil.rmtree(DIST/'portfolio',ignore_errors=True)
            for p in (DIST/'routes').glob('portfolio-paper.*'): p.unlink()
        command('pm2','start','crypto-api')
        raise
