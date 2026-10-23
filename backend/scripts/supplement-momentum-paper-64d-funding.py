#!/usr/bin/env python3
"""One bounded public retry for funding marks, with pre-revision bytes retained."""
from __future__ import annotations

import argparse
import importlib.util
import json
from decimal import Decimal
from pathlib import Path

spec = importlib.util.spec_from_file_location('collector64', Path(__file__).with_name('collect-momentum-paper-64d.py'))
assert spec and spec.loader
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


def rewrite(path: Path, body: bytes) -> None:
    temp = path.with_name(path.name + '.supplement.tmp')
    with temp.open('xb') as output:
        output.write(body)
    temp.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', required=True)
    args = parser.parse_args()
    directory = Path(args.directory).resolve()
    assert directory != c.OLD and c.OLD not in directory.parents, 'Refuse original data mutation'
    manifest_path = directory / 'manifest.json'
    original_body = manifest_path.read_bytes()
    manifest = json.loads(original_body)
    assert manifest['status'] == 'PUBLIC_DATA_COMPLETE_NO_FINANCIAL_RUN'
    package = directory.parent
    assert not (package / 'protocol.json').exists(), 'Financial protocol already registered; refuse input revision'
    assert not (directory / 'funding-supplement.json').exists(), 'Supplement already completed; no retry loop'
    before = directory / 'revision-before-funding-supplement'
    c.retain(before / 'manifest.json', original_body)
    c.retain(before / 'acquisition-provenance.json', (directory / 'acquisition-provenance.json').read_bytes())
    original_fallbacks = manifest['fundingMarkFallbacks']
    attempts = []
    improved = []
    original_files = {row['path']: row for row in manifest['files']}
    for symbol in manifest['symbols']:
        path = directory / f'{symbol}-funding.json'
        old_body = path.read_bytes()
        funding = json.loads(old_body)
        if all('markPrice' in row for row in funding):
            continue
        c.retain(before / path.name, old_body)
        c.retain(before / 'symbol-receipts' / f'{symbol}.json', (directory / 'symbol-receipts' / f'{symbol}.json').read_bytes())
        c.retain(before / 'funding-acquisition' / f'{symbol}.json', (directory / 'funding-acquisition' / f'{symbol}.json').read_bytes())
        url = f'https://fapi.binance.com/fapi/v1/fundingRate?symbol={symbol}&limit=500'
        attempt = {'symbol': symbol, 'url': url, 'attemptedUtc': c.utc()}
        try:
            raw, transport = c.get(url, retries=1)
            rows = json.loads(raw)
            assert isinstance(rows, list) and rows, 'No funding response'
            assert len(rows) < 500 or int(rows[0]['fundingTime']) <= c.START, 'Latest500 page does not cover registeredstart'
            selected = [row for row in rows if c.START <= int(row['fundingTime']) < c.SPLIT]
            expected = [row for row in funding if c.START <= row['time'] < c.SPLIT]
            assert [int(row['fundingTime']) for row in selected] == [row['time'] for row in expected], 'Exact archive timestamp coverage differs'
            for row, event in zip(selected, expected):
                assert row['symbol'] == symbol and Decimal(row['fundingRate']) == Decimal(event['rate']), 'Official archive rate differs'
            receipt = c.raw_receipt(directory, raw, transport)
            manifest['requests'].append(receipt)
            attempt['receipt'] = receipt
            replacements = {int(row['fundingTime']): row for row in selected if row.get('markPrice') and Decimal(row['markPrice']) > 0}
            count = 0
            for event in funding:
                if 'markPrice' not in event and event['time'] in replacements:
                    event['markPrice'] = str(replacements[event['time']]['markPrice'])
                    c.positive(event['markPrice'])
                    count += 1
            attempt['status'] = 'PUBLIC_REST_ARCHIVE_CROSSCHECK_PASS'
            attempt['fundingMarksRecovered'] = count
            if count:
                rewrite(path, c.compact(funding) + b'\n')
                improved.append({'symbol': symbol, 'fundingMarksRecovered': count,
                                 'priorFundingSha256': original_files[path.name]['sha256'],
                                 'newFundingSha256': c.sha(path.read_bytes())})
        except (RuntimeError, AssertionError, ValueError) as exc:
            attempt['status'] = 'PUBLIC_QUERY_UNAVAILABLE_OR_INCOMPLETE_RETAIN_EXPLICIT_FALLBACK'
            attempt['reason'] = str(exc)
        attempts.append(attempt)
        print(json.dumps({'symbol': symbol, 'status': attempt['status'],
                          'fundingMarksRecovered': attempt.get('fundingMarksRecovered', 0)}), flush=True)
    for row in manifest['files']:
        body = (directory / row['path']).read_bytes()
        row['bytes'], row['sha256'] = len(body), c.sha(body)
    manifest['fundingMarkFallbacks'] = sum('markPrice' not in event for symbol in manifest['symbols'] for event in json.loads((directory / f'{symbol}-funding.json').read_text()))
    record = {'status': 'COMPLETE_DATA_QUALITY_SUPPLEMENT_BEFORE_PNL', 'createdUtc': c.utc(),
              'initialManifestSha256': c.sha(original_body),
              'initialFundingMarkFallbacks': original_fallbacks,
              'finalFundingMarkFallbacks': manifest['fundingMarkFallbacks'],
              'preservedBeforeRevisionDirectory': before.name,
              'changedFundingFiles': improved, 'attempts': attempts,
              'noFinancialRun': True, 'maxAlternateAttemptsPerSymbol': 1,
              'manifestUnchanged': original_fallbacks == manifest['fundingMarkFallbacks']}
    c.retain(directory / 'funding-supplement.json', json.dumps(record, indent=2).encode() + b'\n')
    manifest['fundingSupplementProvenance'] = 'funding-supplement.json'
    if original_fallbacks == manifest['fundingMarkFallbacks']:
        # Data bytes and original manifest remain unchanged if all public retriesfail.
        pass
    else:
        rewrite(manifest_path, json.dumps(manifest, indent=2).encode() + b'\n')
    print(json.dumps({'status': record['status'], 'initialFallbacks': original_fallbacks,
                      'finalFallbacks': manifest['fundingMarkFallbacks'],
                      'manifestSha256': c.sha(manifest_path.read_bytes()),
                      'changedFundingFiles': len(improved)}), flush=True)


if __name__ == '__main__':
    main()
