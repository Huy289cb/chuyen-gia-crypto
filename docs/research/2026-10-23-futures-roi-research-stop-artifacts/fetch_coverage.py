#!/usr/bin/env python3
"""Public Binance Vision coverage for USD-M metrics and premium index.

No API key, no orders, no signal, no PnL. Checksums are sha256 of the zip.
"""
import hashlib
import io
import json
import threading
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
SYMS = ('BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT')
START = date(2022, 1, 1)
END = date(2026, 10, 13)  # frozen 512-day window ends this ICT date's UTC daily files
DEV = (date(2022, 9, 5), date(2025, 5, 19))
TEST = (date(2025, 5, 20), date(2026, 10, 13))
METRICS_HEADER = (
    'create_time,symbol,sum_open_interest,sum_open_interest_value,'
    'count_toptrader_long_short_ratio,sum_toptrader_long_short_ratio,'
    'count_long_short_ratio,sum_taker_long_short_vol_ratio'
)
PREMIUM_HEADER = (
    'open_time,open,high,low,close,volume,close_time,quote_volume,count,'
    'taker_buy_volume,taker_buy_quote_volume,ignore'
)
VALUE_COLS = (2, 3, 4, 5, 6, 7)  # empty is missing, not zero
WORKERS = 8
BASE = 'https://data.binance.vision/data/futures/um'


def self_check() -> None:
    empty = '""'
    metrics = (
        METRICS_HEADER + '\n'
        + f'2022-09-05 00:00:00,BTCUSDT,{empty},{empty},{empty},{empty},2.5,0.9\n'
        + f'2022-09-05 00:05:00,BTCUSDT,1.6,11.0,1.1,1.2,2.4,{empty}\n'
    )
    summary = parse_metrics(metrics)
    assert summary['rows'] == 2, summary
    assert summary['blank'][2] == 1 and summary['blank'][4] == 1 and summary['blank'][7] == 1, summary
    assert summary['gap_steps'] == 0, summary
    premium = (
        PREMIUM_HEADER + '\n'
        '1661990400000,-0.0004,0.0002,-0.0012,-0.0003,0,1661993999999,0,720,0,0,0\n'
        '1661994000000,-0.0003,0.0001,-0.0010,-0.0002,0,1661997599999,0,720,0,0,0\n'
    )
    got = parse_premium(premium)
    assert got['rows'] == 2 and got['gap_steps'] == 0, got
    assert abs(got['last_close'] - (-0.0002)) < 1e-12
    bare = '1661990400000,-0.0004,0.0002,-0.0012,-0.0003,0,1661993999999,0,720,0,0,0\n'
    assert parse_premium(bare)['rows'] == 1
    blob = b'abc'
    digest = hashlib.sha256(blob).hexdigest()
    assert parse_checksum(f'{digest}  sample.zip\n', 'sample.zip') == digest
    try:
        parse_checksum(f'{digest}  other.zip\n', 'sample.zip')
        raise AssertionError('checksum name mismatch must fail')
    except ValueError:
        pass
    print('self_check PASS')


def parse_checksum(text: str, filename: str) -> str:
    parts = text.strip().split()
    if len(parts) != 2 or parts[1] != filename:
        raise ValueError(f'checksum line does not name {filename}: {text!r}')
    return parts[0]


def metric_minute(stamp: str) -> int:
    # YYYY-MM-DD HH:MM:SS. Faster than strptime across a few million rows.
    return int(datetime(int(stamp[0:4]), int(stamp[5:7]), int(stamp[8:10]),
                        int(stamp[11:13]), int(stamp[14:16]), tzinfo=timezone.utc).timestamp() // 60)


def parse_metrics(text: str) -> dict:
    lines = [line for line in text.splitlines() if line]
    if not lines:
        raise ValueError('empty metrics file')
    if lines[0] == METRICS_HEADER:
        lines = lines[1:]
    elif len(lines[0].split(',')) != 8:
        raise ValueError(f'unexpected metrics header: {lines[:1]}')
    blank = {i: 0 for i in VALUE_COLS}
    prev = None
    gaps = 0
    rows = 0
    for line in lines:
        cols = line.split(',')
        if len(cols) != 8:
            raise ValueError(f'metrics width {len(cols)}')
        minute = metric_minute(cols[0])
        if prev is not None and minute - prev != 5:
            gaps += 1
        prev = minute
        rows += 1
        for i in VALUE_COLS:
            if cols[i] in ('', '""'):
                blank[i] += 1
            else:
                float(cols[i])
    return {'rows': rows, 'blank': blank, 'gap_steps': gaps, 'first': None, 'last': None}


def parse_premium(text: str) -> dict:
    lines = [line for line in text.splitlines() if line]
    if not lines:
        raise ValueError('empty premium file')
    # Older monthly files start at the first candle and have no header.
    if lines[0] == PREMIUM_HEADER:
        lines = lines[1:]
    elif not lines[0].split(',')[0].lstrip('-').isdigit():
        raise ValueError(f'unexpected premium header: {lines[:1]}')
    prev = None
    gaps = 0
    first = last = None
    last_close = None
    rows = 0
    for line in lines:
        if not line:
            continue
        cols = line.split(',')
        if len(cols) != 12:
            raise ValueError(f'premium width {len(cols)}')
        ts = int(cols[0])
        if first is None:
            first = ts
        if prev is not None and ts - prev != 3_600_000:
            gaps += 1
        prev = ts
        last = ts
        last_close = float(cols[4])
        rows += 1
    return {'rows': rows, 'gap_steps': gaps, 'first': first, 'last': last, 'last_close': last_close}


def days_in(a: date, b: date):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


def months_in(a: date, b: date):
    y, m = a.year, a.month
    while (y, m) <= (b.year, b.month):
        yield f'{y:04d}-{m:02d}'
        m += 1
        if m == 13:
            y, m = y + 1, 1


def get(url: str) -> bytes | None:
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=40) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            if attempt == 3 or exc.code not in (429, 500, 502, 503, 504):
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == 3:
                raise
        time.sleep(1.5 * (attempt + 1))
    return None


def fetch_zip(url: str, dest: Path) -> str:
    dest.parent.mkdir(parents=True, exist_ok=True)
    name = dest.name
    checksum_url = url + '.CHECKSUM'
    # ponytail: a file here was checksum-verified before the first write. Resume parses it.
    if dest.exists() and zipfile.is_zipfile(dest):
        return 'cached'
    blob = get(url)
    if blob is None:
        return 'missing'
    remote = get(checksum_url)
    if remote is None:
        raise RuntimeError(f'zip without checksum: {url}')
    digest = parse_checksum(remote.decode(), name)
    if hashlib.sha256(blob).hexdigest() != digest:
        raise RuntimeError(f'checksum mismatch: {url}')
    dest.write_bytes(blob)
    return 'downloaded'


def read_zip_text(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != 1:
            raise ValueError(f'{path} has {names}')
        return archive.read(names[0]).decode()


def jobs():
    for sym in SYMS:
        for day in days_in(START, END):
            label = day.isoformat()
            url = f'{BASE}/daily/metrics/{sym}/{sym}-metrics-{label}.zip'
            dest = DATA / 'metrics' / sym / f'{sym}-metrics-{label}.zip'
            yield ('metrics', sym, label, url, dest)
        for month in months_in(START, date(2026, 9, 1)):
            url = f'{BASE}/monthly/premiumIndexKlines/{sym}/1h/{sym}-1h-{month}.zip'
            dest = DATA / 'premium' / sym / f'{sym}-1h-{month}.zip'
            yield ('premium', sym, month, url, dest)
        for day in days_in(date(2026, 10, 1), END):
            label = day.isoformat()
            url = f'{BASE}/daily/premiumIndexKlines/{sym}/1h/{sym}-1h-{label}.zip'
            dest = DATA / 'premium' / sym / 'daily' / f'{sym}-1h-{label}.zip'
            yield ('premium', sym, label, url, dest)


def window_days(symbol_days: dict, span: tuple[date, date]) -> dict:
    a, b = span
    expected = list(days_in(a, b))
    present = [d for d in expected if d.isoformat() in symbol_days]
    missing = [d.isoformat() for d in expected if d.isoformat() not in symbol_days]
    return {
        'expectedDays': len(expected),
        'presentDays': len(present),
        'missingDays': len(missing),
        'missingSample': missing[:12],
    }


def coverage_from(records: list[dict]) -> dict:
    out = {'status': 'COVERAGE_ONLY_NO_SIGNAL_NO_PNL', 'symbols': {}}
    for sym in SYMS:
        ok = ('cached', 'downloaded')
        metrics = [r for r in records if r['kind'] == 'metrics' and r['symbol'] == sym and r['state'] in ok]
        missing_metrics = [r['label'] for r in records if r['kind'] == 'metrics' and r['symbol'] == sym and r['state'] == 'missing']
        parse_errors = [r['label'] for r in records if r['symbol'] == sym and r['state'] == 'parse_error']
        premium = sorted(
            (r for r in records if r['kind'] == 'premium' and r['symbol'] == sym and r['state'] in ok),
            key=lambda r: r['first_ms'] or 0,
        )
        boundary_gaps = 0
        for left, right in zip(premium, premium[1:]):
            if left['last_ms'] is None or right['first_ms'] is None:
                continue
            if right['first_ms'] - left['last_ms'] != 3_600_000:
                boundary_gaps += 1
        present = {r['label']: r for r in metrics}
        rows = sum(r['rows'] for r in metrics)
        blanks = {str(i): sum(r['blank'][i] for r in metrics) for i in VALUE_COLS}
        out['symbols'][sym] = {
            'metrics': {
                'files': len(metrics),
                'missingFiles': len(missing_metrics),
                'missingSample': missing_metrics[:12],
                'parseErrors': parse_errors[:12],
                'rows': rows,
                'internalGapSteps': sum(r['gap_steps'] for r in metrics),
                'blankTopTraderCells': blanks,
                'blankFrac': {k: (v / rows if rows else None) for k, v in blanks.items()},
                'dev': window_days(present, DEV),
                'test512': window_days(present, TEST),
            },
            'premium1h': {
                'files': len(premium),
                'rows': sum(r['rows'] for r in premium),
                'internalGapSteps': sum(r['gap_steps'] for r in premium),
                'boundaryGaps': boundary_gaps,
                'firstOpenMs': min((r['first_ms'] for r in premium), default=None),
                'lastOpenMs': max((r['last_ms'] for r in premium), default=None),
            },
        }
    return out


def main() -> None:
    self_check()
    pending = list(jobs())
    print(f'jobs {len(pending)}', flush=True)
    records = []
    lock = threading.Lock()
    done = 0

    def one(item):
        kind, sym, label, url, dest = item
        state = fetch_zip(url, dest)
        record = {'kind': kind, 'symbol': sym, 'label': label, 'state': state, 'rows': 0,
                  'blank': {i: 0 for i in VALUE_COLS}, 'gap_steps': 0, 'first_ms': None, 'last_ms': None}
        if state != 'missing':
            try:
                text = read_zip_text(dest)
                if kind == 'metrics':
                    parsed = parse_metrics(text)
                    record['rows'] = parsed['rows']
                    record['blank'] = parsed['blank']
                    record['gap_steps'] = parsed['gap_steps']
                else:
                    parsed = parse_premium(text)
                    record['rows'] = parsed['rows']
                    record['gap_steps'] = parsed['gap_steps']
                    record['first_ms'] = parsed['first']
                    record['last_ms'] = parsed['last']
            except (ValueError, IndexError, zipfile.BadZipFile, KeyError) as exc:
                record['state'] = 'parse_error'
                record['error'] = str(exc)[:180]
        return record

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = [pool.submit(one, item) for item in pending]
        for future in as_completed(futures):
            record = future.result()
            with lock:
                records.append(record)
                done += 1
                if done % 250 == 0 or done == len(pending):
                    print(f'progress {done}/{len(pending)}', flush=True)
    report = coverage_from(records)
    report['jobs'] = len(pending)
    report['downloadedOrCached'] = sum(1 for r in records if r['state'] != 'missing')
    report['missing'] = sum(1 for r in records if r['state'] == 'missing')
    (ROOT / 'coverage.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({sym: report['symbols'][sym]['metrics']['dev'] | {
        'testMissing': report['symbols'][sym]['metrics']['test512']['missingDays'],
        'premiumRows': report['symbols'][sym]['premium1h']['rows'],
        'premiumGaps': report['symbols'][sym]['premium1h']['internalGapSteps'],
        'topTraderBlankFrac': report['symbols'][sym]['metrics']['blankFrac'],
    } for sym in SYMS}, indent=2))


if __name__ == '__main__':
    main()
