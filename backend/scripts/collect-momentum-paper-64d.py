#!/usr/bin/env python3
"""Acquire a new64ICT-day dataset without replaying or modifying old results.

Missing50days use Binance official monthly ZIPs and their published SHA256
CHECKSUMs. Actual funding REST settlements are crosschecked to the official
funding archive; explicit missing markPrice fallback remains visible. The old
14day CSV segment, daily signal input and filter snapshot are retained exactly.
The raw JSON receipt format is the existing loader's representation; archive
receipts explicitly distinguish derived JSON bytes from downloaded ZIP bytes.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import os
import threading
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OLD = ROOT / 'docs/audits/futures-quick-win/momentum-paper-implementation-20261014T043000Z/data'
START = int(datetime(2026, 8, 10, 17, tzinfo=timezone.utc).timestamp() * 1000)
SPLIT = int(datetime(2026, 9, 29, 17, tzinfo=timezone.utc).timestamp() * 1000)
END = int(datetime(2026, 10, 13, 17, tzinfo=timezone.utc).timestamp() * 1000)
STEP = 300_000
MONTHS = ('2026-08', '2026-09')
VISION = 'https://data.binance.vision/data/futures/um/monthly'
HEADER = 'openTimeMs,tradeOpen,tradeHigh,tradeLow,tradeClose,markOpen,markHigh,markLow,markClose'
LOCK = threading.Lock()


def sha(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def utc() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def compact(value: object) -> bytes:
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()


def retain(path: Path, body: bytes) -> None:
    """Never replace a disagreeing previously saved acquisition artifact."""
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open('xb') as output:
            output.write(body)
    except FileExistsError:
        assert path.read_bytes() == body, f'Existing bytes differ: {path}'


def get(url: str, retries: int = 3) -> tuple[bytes, dict]:
    previous = None
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'momentum-paper-public-data/1.0'})
            with urllib.request.urlopen(request, timeout=25) as response:
                body = response.read()
                return body, {'url': url, 'httpStatus': response.status, 'receivedUtc': utc(),
                              'bytes': len(body), 'sha256': sha(body)}
        except (urllib.error.URLError, TimeoutError) as exc:
            previous = exc
            if attempt + 1 < retries:
                time.sleep(min(4, 0.5 * 2**attempt))
    raise RuntimeError(f'Public acquisition failed: {url}: {previous}')


def archive(directory: Path, symbol: str, kind: str, month: str) -> tuple[list[list[str]], dict]:
    if kind == 'fundingRate':
        name = f'{symbol}-fundingRate-{month}.zip'
        url = f'{VISION}/{kind}/{symbol}/{name}'
    else:
        name = f'{symbol}-5m-{month}.zip'
        url = f'{VISION}/{kind}/{symbol}/5m/{name}'
    base = directory / 'archives' / kind / name
    receipt_path = base.with_suffix('.receipt.json')
    if base.exists() and receipt_path.exists() and Path(str(base) + '.CHECKSUM').exists():
        zipped = base.read_bytes()
        check = Path(str(base) + '.CHECKSUM').read_bytes()
        meta = json.loads(receipt_path.read_text())
    else:
        zipped, zip_receipt = get(url)
        check, checksum_receipt = get(url + '.CHECKSUM')
        meta = {'archive': zip_receipt, 'checksum': checksum_receipt,
                'archiveFile': str(base.relative_to(directory)),
                'checksumFile': str(Path(str(base) + '.CHECKSUM').relative_to(directory))}
        retain(base, zipped)
        retain(Path(str(base) + '.CHECKSUM'), check)
        retain(receipt_path, compact(meta) + b'\n')
    expected, listed = check.decode().strip().split()[:2]
    assert listed.lstrip('*') == name, f'Checksum archive filename mismatch {url}'
    assert sha(zipped) == expected == meta['archive']['sha256'], f'Archive checksum mismatch {url}'
    assert sha(check) == meta['checksum']['sha256'], f'Checksum receipt mismatch {url}'
    with zipfile.ZipFile(io.BytesIO(zipped)) as z:
        assert len(z.namelist()) == 1 and z.namelist()[0] == name.replace('.zip', '.csv'), f'Unexpected ZIP entries {url}'
        text = z.read(z.namelist()[0]).decode()
    rows = list(csv.reader(io.StringIO(text)))
    if rows and not rows[0][0].isdigit():
        rows.pop(0)
    assert rows, f'Empty archive {url}'
    return rows, meta


def raw_receipt(directory: Path, body: bytes, meta: dict) -> dict:
    receipt = {**meta, 'bytes': len(body), 'sha256': sha(body),
               'rawFile': f'raw/{sha(body)}.json.gz'}
    # Fixed gzip timestamp means cached derived receipt bytes remain stable.
    retain(directory / receipt['rawFile'], gzip.compress(body, mtime=0))
    return receipt


def positive(value: str) -> None:
    assert math.isfinite(float(value)) and Decimal(value) > 0, f'Invalid price {value}'


def candle(row: list[str], symbol: str) -> list:
    assert len(row) >= 7, f'Malformed candle {symbol}'
    t, close_t = int(row[0]), int(row[6])
    assert t % STEP == 0 and close_t == t + STEP - 1, f'Misaligned candle {symbol}:{t}'
    o, h, l, c = row[1:5]
    for value in (o, h, l, c):
        positive(value)
    assert Decimal(l) <= min(Decimal(o), Decimal(c)) <= max(Decimal(o), Decimal(c)) <= Decimal(h), f'Bad OHLC {symbol}:{t}'
    return [t, o, h, l, c, row[5], close_t]


def collect_symbol(directory: Path, symbol: str) -> dict:
    receipts: list[dict] = []
    archives: list[dict] = []
    bars: dict[str, dict[int, list]] = {'klines': {}, 'markPriceKlines': {}}
    for kind in bars:
        for month in MONTHS:
            rows, meta = archive(directory, symbol, kind, month)
            archives.append(meta)
            parsed = [candle(row, symbol) for row in rows]
            assert all(parsed[i][0] - parsed[i - 1][0] == STEP for i in range(1, len(parsed))), f'Archive candle gap {symbol}:{kind}:{month}'
            for row in parsed:
                assert row[0] not in bars[kind], f'Duplicate archive candle {symbol}:{kind}'
                bars[kind][row[0]] = row
            derived = compact(parsed)
            transport = meta['archive']
            receipts.append(raw_receipt(directory, derived, {
                'url': transport['url'], 'httpStatus': transport['httpStatus'],
                'receivedUtc': transport['receivedUtc'],
                'representation': 'DERIVED_JSON_FROM_CHECKSUM_VERIFIED_OFFICIAL_ARCHIVE_CSV',
                'transportBytes': transport['bytes'], 'transportSha256': transport['sha256'],
                'archiveFile': meta['archiveFile'], 'checksumFile': meta['checksumFile'],
            }))
            del rows, parsed, derived
    old_text = (OLD / f'{symbol}-5m.csv').read_text()
    old_lines = old_text.splitlines()
    assert old_lines[0] == HEADER and len(old_lines) == 4033, f'Old segment schema mismatch {symbol}'
    overlaps = 0
    for line in old_lines[1:]:
        fields = line.split(',')
        t = int(fields[0])
        if t in bars['klines']:
            merged = [t, *bars['klines'][t][1:5], *bars['markPriceKlines'][t][1:5]]
            assert all(Decimal(str(a)) == Decimal(b) for a, b in zip(merged, fields)), f'Official/archive old REST overlap mismatch {symbol}:{t}'
            overlaps += 1
    # Keep the old14day suffix text exactly, including numeric precision.
    new_lines = []
    for t in range(START, SPLIT, STEP):
        assert t in bars['klines'] and t in bars['markPriceKlines'], f'Missing prior50day candle {symbol}:{t}'
        merged = [t, *bars['klines'][t][1:5], *bars['markPriceKlines'][t][1:5]]
        new_lines.append(','.join(map(str, merged)))
    body = (HEADER + '\n' + '\n'.join(new_lines) + '\n' + '\n'.join(old_lines[1:]) + '\n').encode()
    assert body.splitlines()[-4032:] == old_text.encode().splitlines()[1:], f'Old candle suffix changed {symbol}'
    retain(directory / f'{symbol}-5m.csv', body)
    new_count = len(new_lines)
    # Keep acquisition memory bounded on the shared VPS before funding I/O.
    del bars, new_lines, body

    archived_funding: dict[int, tuple[str, str]] = {}
    for month in MONTHS:
        rows, meta = archive(directory, symbol, 'fundingRate', month)
        archives.append(meta)
        for row in rows:
            assert len(row) == 3, f'Funding archive schema mismatch {symbol}'
            t = int(row[0])
            assert t not in archived_funding, f'Duplicate archive settlement {symbol}:{t}'
            assert Decimal(row[1]) > 0 and math.isfinite(float(row[2])), f'Invalid archived funding {symbol}:{t}'
            archived_funding[t] = (row[2], row[1])

    funding_url = f'https://fapi.binance.com/fapi/v1/fundingRate?symbol={symbol}&startTime={START}&endTime={SPLIT - 1}&limit=1000'
    funding_meta_path = directory / 'funding-acquisition' / f'{symbol}.json'
    if funding_meta_path.exists():
        acquisition = json.loads(funding_meta_path.read_text())
        if acquisition['mode'] == 'REST_ACTUAL_MARK':
            receipt = acquisition['receipt']
            raw = gzip.decompress((directory / receipt['rawFile']).read_bytes())
            assert sha(raw) == receipt['sha256'], 'Existing funding raw hash mismatch'
            response = json.loads(raw)
            receipts.append(receipt)
        else:
            response = None
    else:
        try:
            raw, meta = get(funding_url)
            response = json.loads(raw)
            assert isinstance(response, list) and len(response) < 1000, f'Funding pagination needed {symbol}'
            receipt = raw_receipt(directory, raw, meta)
            receipts.append(receipt)
            acquisition = {'mode': 'REST_ACTUAL_MARK', 'receipt': receipt}
        except RuntimeError as exc:
            response = None
            acquisition = {'mode': 'OFFICIAL_ARCHIVE_EXPLICIT_MARK_FALLBACK', 'restFailure': str(exc), 'attemptedUrl': funding_url}
        retain(funding_meta_path, compact(acquisition) + b'\n')
    expected = {t: row for t, row in archived_funding.items() if START <= t < SPLIT}
    assert expected, f'No archived funding in prior50day segment {symbol}'
    if response is not None:
        assert [int(row['fundingTime']) for row in response] == sorted(expected), f'Funding REST/archive exact timestamp coverage mismatch {symbol}'
        for row in response:
            assert row['symbol'] == symbol and Decimal(row['fundingRate']) == Decimal(expected[int(row['fundingTime'])][0]), f'Funding REST/archive rate mismatch {symbol}'
        funding = [{'id': f'binance-funding:{symbol}:{row["fundingTime"]}', 'symbol': symbol,
                    'time': int(row['fundingTime']), 'rate': str(row['fundingRate']),
                    **({'markPrice': str(row['markPrice'])} if row.get('markPrice') and Decimal(row['markPrice']) > 0 else {})}
                   for row in response]
    else:
        funding = [{'id': f'binance-funding:{symbol}:{t}', 'symbol': symbol,
                    'time': t, 'rate': row[0]} for t, row in sorted(expected.items())]
    old_funding = json.loads((OLD / f'{symbol}-funding.json').read_text())
    for event in old_funding:
        t = event['time']
        if t in archived_funding:
            assert Decimal(event['rate']) == Decimal(archived_funding[t][0]), f'Old REST funding/archive rate mismatch {symbol}:{t}'
    all_funding = funding + old_funding
    assert all(START <= row['time'] < END for row in all_funding), f'Funding outside registered period {symbol}'
    assert all(all_funding[i]['time'] > all_funding[i - 1]['time'] for i in range(1, len(all_funding))), f'Funding gap/order issue {symbol}'
    retain(directory / f'{symbol}-funding.json', compact(all_funding) + b'\n')
    result = {'symbol': symbol, 'bars': new_count + len(old_lines) - 1,
              'newBars': new_count, 'retainedBars': len(old_lines) - 1,
              'overlapTradeMarkBarsVerified': overlaps,
              'fundingEvents': len(all_funding), 'fundingNew': len(funding),
              'fundingMarkFallbacks': sum('markPrice' not in row for row in all_funding),
              'fundingRestArchiveCrosscheck': response is not None,
              'requests': receipts, 'archives': archives}
    retain(directory / 'symbol-receipts' / f'{symbol}.json', compact(result) + b'\n')
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', required=True)
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    directory = Path(args.directory).resolve()
    assert directory != OLD and OLD not in directory.parents and not (directory / 'manifest.json').exists(), 'Refuse modifying/finalized dataset'
    assert 1 <= args.workers <= 4
    directory.mkdir(parents=True, exist_ok=True)
    old_manifest = json.loads((OLD / 'manifest.json').read_text())
    assert old_manifest['startTimeMs'] == SPLIT and old_manifest['endTimeMs'] == END
    for item in old_manifest['files']:
        assert sha((OLD / item['path']).read_bytes()) == item['sha256'], f'Original data changed: {item["path"]}'
    for name in ('exchange-info.json', 'daily-source.csv'):
        retain(directory / name, (OLD / name).read_bytes())
    for receipt in old_manifest['requests']:
        raw = (OLD / receipt['rawFile']).read_bytes()
        assert sha(gzip.decompress(raw)) == receipt['sha256'], 'Original raw receipt changed'
        retain(directory / receipt['rawFile'], raw)
    symbols = old_manifest['symbols']
    started = time.monotonic()
    completed = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(collect_symbol, directory, symbol): symbol for symbol in symbols}
        for future in as_completed(futures):
            result = future.result()
            completed.append(result)
            print(json.dumps({'completed': len(completed), 'total': len(symbols),
                              'symbol': result['symbol'], 'fundingFallbacks': result['fundingMarkFallbacks'],
                              'elapsedSeconds': round(time.monotonic() - started, 2)}), flush=True)
    results = {row['symbol']: row for row in completed}
    files = []
    for name in ['exchange-info.json', 'daily-source.csv', *[item for symbol in symbols for item in (f'{symbol}-5m.csv', f'{symbol}-funding.json')]]:
        body = (directory / name).read_bytes()
        files.append({'path': name, 'bytes': len(body), 'sha256': sha(body)})
    provenance = {'createdUtc': utc(), 'noFinancialRun': True, 'sourceOriginal14Directory': str(OLD.relative_to(ROOT)),
                  'sourceOriginal14ManifestSha256': sha((OLD / 'manifest.json').read_bytes()),
                  'retainedOriginal14Bars': 4032 * len(symbols),
                  'officialArchiveChecksumsVerified': sum(len(row['archives']) for row in completed),
                  'officialArchiveRestOverlapTradeMarkBarsVerified': sum(row['overlapTradeMarkBarsVerified'] for row in completed),
                  'fundingRestArchiveCrosscheckedSymbols': sum(row['fundingRestArchiveCrosscheck'] for row in completed),
                  'fundingMarkFallbacks': sum(row['fundingMarkFallbacks'] for row in completed),
                  'representationExplanation': 'manifest requests with representation DERIVED_JSON_FROM_CHECKSUM_VERIFIED_OFFICIAL_ARCHIVE_CSV hash the derived candle JSON, not HTTP ZIP payload. Original transportBytes/transportSha256 and exact ZIP+CHECKSUM are preserved separately.',
                  'elapsedSeconds': time.monotonic() - started,
                  'symbols': [{key: value for key, value in results[symbol].items() if key not in ('requests', 'archives')} for symbol in symbols]}
    retain(directory / 'acquisition-provenance.json', json.dumps(provenance, indent=2).encode() + b'\n')
    manifest = {**{key: value for key, value in old_manifest.items() if key not in ('files', 'requests')},
                'startTimeMs': START, 'endTimeMs': END,
                'barsPerSymbol': (END - START) // STEP,
                'rawCandles': 2 * len(symbols) * ((END - START) // STEP),
                'fundingEvents': sum(row['fundingEvents'] for row in completed),
                'fundingMarkFallbacks': sum(row['fundingMarkFallbacks'] for row in completed),
                'files': files, 'requests': [*old_manifest['requests'], *[r for symbol in symbols for r in results[symbol]['requests']]],
                'acquisitionProvenance': 'acquisition-provenance.json',
                'limitations': [*old_manifest['limitations'],
                    'Prior50days candles come from Binance official monthly archives; transport ZIPs/checksums and explicitly derived loader JSON are preserved.',
                    'The frozen last14days CSV values/filter/daily inputs are retained; the full64days form an extended retrospective period, not untouched prospective evidence.']}
    assert all(results[symbol]['bars'] == 18432 for symbol in symbols), 'Incomplete64day bars'
    retain(directory / 'manifest.json', json.dumps(manifest, indent=2).encode() + b'\n')
    print(json.dumps({'status': manifest['status'], 'barsPerSymbol': manifest['barsPerSymbol'],
                      'rawCandles': manifest['rawCandles'], 'fundingEvents': manifest['fundingEvents'],
                      'fundingMarkFallbacks': manifest['fundingMarkFallbacks'],
                      'manifestSha256': sha((directory / 'manifest.json').read_bytes()),
                      'elapsedSeconds': time.monotonic() - started}), flush=True)


if __name__ == '__main__':
    main()
