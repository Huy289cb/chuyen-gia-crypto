#!/usr/bin/env python3
"""Public Binance archives only. SHA-verified, resumable, fail on gaps/duplicates."""
import pathlib,json,hashlib,urllib.request,zipfile,io,csv,datetime,math
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/audits/2026-09-22-structure-led-m5/holdout-2022'
CACHE=OUT/'archives';BASE='https://data.binance.vision/data/futures/um/monthly/'
def fetch(url):
 with urllib.request.urlopen(url,timeout=45) as f:return f.read()
def records(path):
 with zipfile.ZipFile(path) as z:
  with z.open(z.namelist()[0]) as f:
   reader=csv.reader(io.TextIOWrapper(f));first=next(reader)
   if first[0].strip().isdigit():
    # Older Binance kline archives have no header; never drop their first candle.
    fields=['open_time','open','high','low','close','volume','close_time','quote_volume','count','taker_buy_volume','taker_buy_quote_volume','ignore']
    if len(first)!=len(fields):raise ValueError('unexpected headerless archive columns')
    yield dict(zip(fields,first))
   else:fields=first
   for row in reader:
    if len(row)!=len(fields):raise ValueError('archive column mismatch')
    yield dict(zip(fields,row))
def stamp(s):return int(datetime.datetime.fromisoformat(s).replace(tzinfo=datetime.timezone.utc).timestamp()*1000)
def main():
 freeze=json.loads((OUT/'freeze.json').read_text());CACHE.mkdir(exist_ok=True)
 mp=OUT/'download-manifest.json';manifest=json.loads(mp.read_text()) if mp.exists() else {}
 periods=['2021-12']+[f'2022-{m:02}' for m in range(1,12)]
 for month in periods:
  for kind in ['klines','markPriceKlines','fundingRate']:
   tag='fundingRate' if kind=='fundingRate' else '1m';interval='' if kind=='fundingRate' else '/1m'
   filename=f'BTCUSDT-{tag}-{month}.zip';url=BASE+f'{kind}/BTCUSDT{interval}/{filename}';path=CACHE/f'{kind}-{filename}'
   key=f'{kind}/{month}'
   if path.exists() and key in manifest:
    if hashlib.sha256(path.read_bytes()).hexdigest()!=manifest[key]['sha256']:raise ValueError('cached archive changed')
    continue
   checksum=fetch(url+'.CHECKSUM').decode().split()[0];data=fetch(url)
   if hashlib.sha256(data).hexdigest()!=checksum:raise ValueError('archive checksum mismatch')
   with zipfile.ZipFile(io.BytesIO(data)) as z:
    if z.testzip() is not None:raise ValueError('corrupt zip')
   path.write_bytes(data);manifest[key]={'url':url,'file':str(path),'sha256':checksum,'fetchedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
   mp.write_text(json.dumps(manifest,indent=2));print('verified',key,flush=True)
 for split,(begin,end) in freeze['splits'].items():
  months=['2021-12']+[f'2022-{m:02}' for m in range(1,7)] if split=='holdout_h1' else [f'2022-{m:02}' for m in range(6,12)]
  minutes=[];marks={};funding=[]
  for month in months:
   for r in records(pathlib.Path(manifest[f'klines/{month}']['file'])):
    b=[int(r['open_time'])]+[float(r[k]) for k in ['open','high','low','close','volume']]
    if not all(math.isfinite(v) for v in b) or b[0]%60000 or min(b[1:5])<=0 or b[3]>min(b[1],b[4]) or b[2]<max(b[1],b[4]) or (minutes and b[0]-minutes[-1][0]!=60000):raise ValueError('invalid candles or gap')
    minutes.append(b)
   for r in records(pathlib.Path(manifest[f'markPriceKlines/{month}']['file'])):
    t=int(r['open_time']);v=float(r['open'])
    if t in marks or not math.isfinite(v) or v<=0:raise ValueError('invalid mark')
    marks[t]=v
  missing_times=set(b[0] for b in minutes)-set(marks)
  repair_path=OUT/'mark-repair-manifest.json';repairs=json.loads(repair_path.read_text()) if repair_path.exists() else {}
  for day in sorted(set(datetime.datetime.fromtimestamp(t/1000,datetime.timezone.utc).strftime('%Y-%m-%d') for t in missing_times)):
   path=CACHE/f'mark-repair-{day}.zip';url=f'https://data.binance.vision/data/futures/um/daily/markPriceKlines/BTCUSDT/1m/BTCUSDT-1m-{day}.zip'
   if day not in repairs or not path.exists():
    checksum=fetch(url+'.CHECKSUM').decode().split()[0];raw=fetch(url)
    if hashlib.sha256(raw).hexdigest()!=checksum:raise ValueError('repair checksum mismatch')
    path.write_bytes(raw);repairs[day]={'url':url,'sha256':checksum,'file':str(path)};repair_path.write_text(json.dumps(repairs,indent=2))
   if hashlib.sha256(path.read_bytes()).hexdigest()!=repairs[day]['sha256']:raise ValueError('repair changed')
   for r in records(path):
    t=int(r['open_time']);v=float(r['open'])
    if not math.isfinite(v) or v<=0:raise ValueError('bad repair mark')
    if t in marks and marks[t]!=v:raise ValueError('conflicting daily mark')
    if t in missing_times:marks[t]=v
   print('repaired mark day',day,flush=True)
  if set(marks)!=set(b[0] for b in minutes):
   missing=sorted(set(b[0] for b in minutes)-set(marks));extra=sorted(set(marks)-set(b[0] for b in minutes))
   (OUT/(split+'-mark-coverage.json')).write_text(json.dumps({'missingCount':len(missing),'extraCount':len(extra),'missingDays':sorted(set(datetime.datetime.fromtimestamp(t/1000,datetime.timezone.utc).strftime('%Y-%m-%d') for t in missing)),'firstMissing':missing[:10],'firstExtra':extra[:10]},indent=2))
   raise ValueError('mark coverage mismatch')
  for month in months:
   for r in records(pathlib.Path(manifest[f'fundingRate/{month}']['file'])):
    t=int(r['calc_time']);rate=float(r['last_funding_rate']);mark=marks.get(t//60000*60000)
    if mark is None or not math.isfinite(rate) or (funding and t<=funding[-1]['time']):raise ValueError('invalid funding')
    funding.append({'time':t,'rate':rate,'markPrice':mark})
  bytf={'1m':minutes}
  for tf,n in [('5m',5),('15m',15),('1h',60),('4h',240)]:
   bars=[]
   for i in range(0,len(minutes),n):
    group=minutes[i:i+n]
    if len(group)!=n or group[0][0]%(60000*n):raise ValueError('partial aggregate')
    bars.append([group[0][0],group[0][1],max(b[2] for b in group),min(b[3] for b in group),group[-1][4],sum(b[5] for b in group)])
   bytf[tf]=bars
  if minutes[0][0]>stamp(begin)-20*86400000 or minutes[-1][0]+60000!=stamp(end):raise ValueError('bad interval')
  path=OUT/(split+'-data.json');raw=json.dumps({'byTf':bytf,'funding':funding,'fundingMarkApproximation':'mark1m open at settlement minute'},separators=(',',':')).encode();path.write_bytes(raw)
  (OUT/(split+'-manifest.json')).write_text(json.dumps({'sha256':hashlib.sha256(raw).hexdigest(),'file':str(path),'scored':[begin,end],'rows':{tf:len(v) for tf,v in bytf.items()},'fundingRows':len(funding)},indent=2))
  print('dataset ready',split,flush=True)
if __name__=='__main__':main()
