"""Deploy the reviewed measurement package; preserve environment and rollback on failed smoke."""
import pathlib, os, json, subprocess, hashlib, datetime, time, urllib.request, importlib.util, sys
ROOT=pathlib.Path('/home/ubuntu/chuyen-gia-crypto/backend'); os.chdir(ROOT)
OUT=ROOT.parent/'docs/deployments/2026-09-15-entry-measurement'; OUT.mkdir(exist_ok=True)
PKG=ROOT/'releases/measurement-20260914'
spec=importlib.util.spec_from_file_location('control',ROOT/'scripts/measurement-release-control.py'); control=importlib.util.module_from_spec(spec);spec.loader.exec_module(control)
POLICY=json.loads((ROOT.parent/'docs/deployments/2026-09-08-risk-3pct-day10/plan.json').read_text())['updates']
POLICY['RISK_PER_TRADE_PERCENT']='0.5'
def save(name,data): (OUT/(name+'.json')).write_text(json.dumps(data,indent=2)+'\n')
def run(args,**kw): return subprocess.run(args,check=True,timeout=60,**kw)
def processes():
 daemon=int(pathlib.Path('/home/ubuntu/.pm2/pm2.pid').read_text());result={}
 for app in ['crypto-api','crypto-worker']:
  files=list(pathlib.Path('/home/ubuntu/.pm2/pids').glob(app+'-*.pid'));assert len(files)==1,app
  pid=int(files[0].read_text());proc=pathlib.Path('/proc',str(pid))
  assert int((proc/'stat').read_text().rsplit(')',1)[1].split()[1])==daemon,'Wrong daemon'
  assert (proc/'cwd').resolve()==ROOT/'dist','Wrong cwd'
  env=dict(x.split('=',1) for x in (proc/'environ').read_text().split('\0') if '=' in x)
  for k,v in POLICY.items(): assert env.get(k)==v,'Runtime policy mismatch '+app+' '+k
  result[app]={'pid':pid,'verifiedEnv':{k:env.get(k) for k in POLICY}}
 return result

def exchange(name):
 run(['node','scripts/check-open-costs-exchange.cjs'],env={**os.environ,'OPEN_COSTS_CHECK_FILE':str(OUT/(name+'.json'))})
 data=json.loads((OUT/(name+'.json')).read_text())
 assert not any(data[k] for k in ['positions','orders','algos']),'Exchange not flat; no code switch'
 db=run(['node','-e',"require('dotenv').config({quiet:true});const {prisma}=require('./dist/lib/prisma');(async()=>{const positions=await prisma.testnetPosition.count({where:{status:'open'}});const pending=await prisma.testnetPendingOrder.count({where:{status:'pending'}});console.log(JSON.stringify({positions,pending}));if(positions||pending)process.exitCode=1})().finally(()=>prisma.$disconnect())"],capture_output=True,text=True)
 # dotenv may print an informational line; retain only the result.
 save(name+'-db',json.loads(db.stdout.strip().splitlines()[-1]))

def http(path):
 with urllib.request.urlopen('http://127.0.0.1:'+port+path,timeout=15) as r:return json.load(r)

# Verify the seal, including archived candidate inputs and the test evidence.
seal=json.loads((PKG/'package-checksums.json').read_text())['sha256']
for name,h in seal.items():assert hashlib.sha256((PKG/name).read_bytes()).hexdigest()==h,'Seal mismatch '+name
manifest=control.verify(PKG);assert control.inventory(ROOT/'dist')==manifest['baseline'],'Runtime drift'
assert json.loads((PKG/'rollback-rehearsal.json').read_text())['rehearsalPassed']
assert json.loads((PKG/'guard-tests.json').read_text())['runningProcessRejected']
fileenv=json.loads(run(['node','-e',"console.log(JSON.stringify(require('dotenv').parse(require('fs').readFileSync('.env'))))"],capture_output=True,text=True).stdout)
for k,v in POLICY.items():assert fileenv.get(k)==v,'File policy mismatch '+k
port=fileenv.get('PORT','3000');envhash=hashlib.sha256((ROOT/'.env').read_bytes()).hexdigest()
save('preflight',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'processes':processes(),'health':http('/health'),'baselineMatches':True,'packageSealVerified':True})
exchange('exchange-before')
if '--apply' not in sys.argv:print('Preflight passed; no mutation');sys.exit(0)
assert not (OUT/'deployment-manifest.json').exists(),'Deployment already recorded'
stopped=False;switched=False
try:
 stopped=True
 run(['pm2','stop','crypto-worker','crypto-api'])
 exchange('exchange-after-stop')
 result=control.switch(PKG,ROOT/'dist','apply');switched=True;save('code-switch',result)
 run(['pm2','start','ecosystem.config.cjs','--update-env'])
 last=None
 for attempt in range(12):
  try:
   health=http('/health');assert health['status']=='ok'
   trace=http('/api/metrics/entry-traces?days=1');risk=http('/api/metrics/risk')
   verified=processes();break
  except Exception as e:last=e;time.sleep(2)
 else:raise RuntimeError('Post-deployment smoke failed') from last
 assert hashlib.sha256((ROOT/'.env').read_bytes()).hexdigest()==envhash,'Environment file changed'
 assert control.inventory(ROOT/'dist')==manifest['release'],'Release checksum changed'
 save('verification',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'processes':verified,'health':health,'entryTraces':trace,'risk':risk,'releaseMatches':True,'envUnchanged':True})
 run(['pm2','save'])
 save('deployment-manifest',{'deployedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'package':str(PKG),'changedFiles':manifest['changedFiles'],'environmentChanged':False,'strategyRulesChanged':False,'rollback':str(PKG/'baseline'),'authorization':'User continue after reviewed measurement package and controlled deployment next step'})
 print('DEPLOYED_AND_VERIFIED')
except BaseException:
 if stopped:
  run(['pm2','stop','crypto-worker','crypto-api'])
  if switched or not (ROOT/'dist').exists():save('rollback',control.switch(PKG,ROOT/'dist','rollback'))
  run(['pm2','start','ecosystem.config.cjs','--update-env'])
 raise
