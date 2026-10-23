#!/usr/bin/env python3
"""Download ONLY predeclared TRAIN archives; verify Binance SHA256 before storing.
No keys, account API, DB or order endpoints. Idempotent and resumable.
"""
import hashlib, json, pathlib, urllib.request, zipfile, io, datetime, sys
ROOT = pathlib.Path(__file__).resolve().parents[2]
VALIDATION = sys.argv[1:] == ['--validation']
INDEPENDENT = sys.argv[1:] == ['--independent-2023']
SUPPLEMENTAL = sys.argv[1:] == ['--supplemental-2024']
if sys.argv[1:] and not (VALIDATION or SUPPLEMENTAL or INDEPENDENT): raise ValueError('unknown split')
SPLIT = 'independent-2023' if INDEPENDENT else 'supplemental-2024' if SUPPLEMENTAL else 'validation' if VALIDATION else 'train'
OUT = ROOT / 'docs/audits/2026-09-11-opportunity-testbed'
if VALIDATION or SUPPLEMENTAL or INDEPENDENT:
    OUT = OUT / SPLIT
    if not (OUT/'freeze.json').exists(): raise ValueError('freeze candidate before validation access')
CACHE = OUT / 'train-archives'
BASE = 'https://data.binance.vision/data/futures/um/monthly/'

def fetch(url):
    with urllib.request.urlopen(url, timeout=45) as response:
        return response.read()

def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / (SPLIT+'-download-manifest.json')
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    periods = ['2022-12'] + [f'2023-{m:02}' for m in range(1,7)] if INDEPENDENT else [f'{2024 if SUPPLEMENTAL else 2025}-{m:02}' for m in (range(6,13) if SUPPLEMENTAL else range(6,10) if VALIDATION else range(1,7))]
    for period in periods:
        for kind in ['klines', 'markPriceKlines', 'fundingRate']:
            interval = '' if kind == 'fundingRate' else '/1m'
            tag = 'fundingRate' if kind == 'fundingRate' else '1m'
            name = f'BTCUSDT-{tag}-{period}.zip'
            relative = f'{kind}/BTCUSDT{interval}/{name}'
            target = CACHE / f'{kind}-{name}'
            if target.exists() and relative in manifest:
                assert hashlib.sha256(target.read_bytes()).hexdigest() == manifest[relative]['sha256']
                print('cached', relative, flush=True)
                continue
            checksum = fetch(BASE + relative + '.CHECKSUM').decode().split()[0]
            data = fetch(BASE + relative)
            actual = hashlib.sha256(data).hexdigest()
            if checksum != actual: raise ValueError('checksum mismatch: ' + relative)
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                if archive.testzip() is not None: raise ValueError('invalid archive')
            temporary = target.with_suffix('.part')
            temporary.write_bytes(data); temporary.replace(target)
            manifest[relative] = {'sha256':actual,'bytes':len(data),'file':str(target.relative_to(ROOT)),
                'url':BASE+relative,'fetched_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
            temp_manifest = manifest_path.with_suffix('.tmp')
            temp_manifest.write_text(json.dumps(manifest, indent=2)+'\n'); temp_manifest.replace(manifest_path)
            print('verified', relative, len(data), flush=True)
    print(SPLIT.upper()+' download complete; reserved October-December test not accessed', flush=True)
if __name__ == '__main__': main()
