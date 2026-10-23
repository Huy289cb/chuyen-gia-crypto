"""Pinned, public-only Binance Spot monthly klines; no trading dependencies.

Only the explicitly documented post-2025 microsecond archive format is accepted.
CSV parsing is streaming. A CSV's shape cannot prove its market: the manifest,
URL namespace, member name and checksum establish Spot provenance together.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import resource
import threading
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Iterator

from .models import Bar, MINUTE_US, HOUR_US

PARSER_VERSION = "binance-spot-monthly-microsecond-v1"
UNIT = "MICROSECONDS"
ORIGIN = "https://data.binance.vision/data/spot/monthly/klines"
INTERVALS = {"1m": MINUTE_US, "5m": 5 * MINUTE_US, "15m": 15 * MINUTE_US,
             "30m": 30 * MINUTE_US, "1h": HOUR_US}
DISK_CAP = 2 * 1024 ** 3
WALL_CAP = 20 * 60
CHUNK = 64 * 1024


class DatasetError(ValueError):
    pass


def _utc_us(value: str) -> int:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise DatasetError("UTC timestamp must be timezone-aware")
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    delta = dt.astimezone(timezone.utc) - epoch
    return (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds


def _iso(us: int) -> str:
    seconds, micros = divmod(us, 1_000_000)
    return datetime.fromtimestamp(seconds, timezone.utc).replace(microsecond=micros).isoformat()


def _month_bounds(month: str) -> tuple[int, int]:
    try:
        year, number = map(int, month.split("-"))
        first = datetime(year, number, 1, tzinfo=timezone.utc)
        following = datetime(year + (number == 12), number % 12 + 1, 1, tzinfo=timezone.utc)
    except (ValueError, TypeError) as exc:
        raise DatasetError(f"invalid archive month: {month}") from exc
    if month != f"{year:04d}-{number:02d}" or year < 2025:
        raise DatasetError("archive month must use YYYY-MM and documented microsecond era >= 2025")
    return _utc_us(first.isoformat()), _utc_us(following.isoformat())


def _months(start: int, end: int) -> list[str]:
    if start >= end:
        raise DatasetError("data start must precede exclusive end")
    current = datetime.fromtimestamp(start // 1_000_000, timezone.utc)
    if current.day != 1 or current.hour or current.minute or current.second or start % 1_000_000:
        raise DatasetError("monthly archive start must be a UTC month boundary")
    result = []
    while _utc_us(current.isoformat()) < end:
        month = current.strftime("%Y-%m")
        result.append(month)
        _, next_us = _month_bounds(month)
        current = datetime.fromtimestamp(next_us // 1_000_000, timezone.utc)
    if _utc_us(current.isoformat()) != end:
        raise DatasetError("monthly archive end must be an exclusive UTC month boundary")
    return result


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _spec(symbol: str, interval: str, month: str) -> dict:
    if not symbol.isascii() or not symbol.isalnum() or symbol.upper() != symbol:
        raise DatasetError(f"invalid symbol: {symbol}")
    if interval not in INTERVALS:
        raise DatasetError(f"unsupported fixed interval: {interval}")
    start, end = _month_bounds(month)
    name = f"{symbol}-{interval}-{month}.zip"
    url = f"{ORIGIN}/{symbol}/{interval}/{name}"
    return {"market": "spot", "pair": symbol, "interval": interval, "month": month,
            "unit": UNIT, "parser_version": PARSER_VERSION, "source_url": url,
            "checksum_url": url + ".CHECKSUM",
            "path": f"archives/{symbol}/{interval}/{name}",
            "expected_start_us": start, "expected_end_us_exclusive": end}


def _validate_record(record: dict) -> None:
    wanted = _spec(record["pair"], record["interval"], record["month"])
    for key, value in wanted.items():
        if record.get(key) != value:
            raise DatasetError(f"manifest provenance mismatch {key}: {record.get(key)!r}")
    digest = record.get("sha256", "")
    if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise DatasetError("manifest has invalid SHA256")


def _integer(value: str, label: str) -> int:
    if not value.isascii() or not value.isdigit():
        raise DatasetError(f"{label} must be a nonnegative integer")
    return int(value)


def _decimal(value: str, label: str, *, positive: bool = False) -> Decimal:
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise DatasetError(f"invalid Decimal {label}") from exc
    if not parsed.is_finite() or parsed < 0 or (positive and parsed == 0):
        raise DatasetError(f"invalid nonnegative/positive Decimal {label}")
    return parsed


def _parse_row(row: list[str], interval_us: int) -> Bar:
    if len(row) != 12:
        raise DatasetError(f"Spot kline requires exactly 12 columns, received {len(row)}")
    opened = _integer(row[0], "open_time")
    closed = _integer(row[6], "close_time")
    if opened < _utc_us("2025-01-01T00:00:00Z"):
        raise DatasetError("expected explicit post-2025 MICROSECONDS; millisecond/second values rejected")
    if opened % interval_us or closed != opened + interval_us - 1:
        raise DatasetError("microsecond timestamps not aligned, or close_time != open + interval - 1")
    o, h, low, c = (_decimal(row[i], name, positive=True)
                    for i, name in zip(range(1, 5), ("open", "high", "low", "close")))
    if not low <= min(o, c) <= max(o, c) <= h:
        raise DatasetError("OHLC ordering invalid")
    volume = _decimal(row[5], "volume")
    quote = _decimal(row[7], "quote_volume")
    trades = _integer(row[8], "trades")
    taker_base = _decimal(row[9], "taker_buy_base")
    taker_quote = _decimal(row[10], "taker_buy_quote")
    if taker_base > volume or taker_quote > quote:
        raise DatasetError("taker volume exceeds total volume")
    if _decimal(row[11], "unused") != 0:
        raise DatasetError("unexpected nonzero unused Spot CSV field")
    return Bar(opened, closed, o, h, low, c, volume, quote, trades)


def _iter_archive(path: Path, record: dict, deadline: float | None = None) -> Iterator[Bar]:
    interval = INTERVALS[record["interval"]]
    expected = record["expected_start_us"]
    end = record["expected_end_us_exclusive"]
    expected_member = path.name[:-4] + ".csv"
    try:
        with zipfile.ZipFile(path) as archive:
            members = archive.infolist()
            if len(members) != 1 or members[0].filename != expected_member:
                raise DatasetError(f"archive must contain only {expected_member}")
            if members[0].file_size > DISK_CAP:
                raise DatasetError("uncompressed archive exceeds safety cap")
            with archive.open(members[0]) as binary:
                reader = csv.reader(io.TextIOWrapper(binary, encoding="utf-8", newline=""))
                count = 0
                for line_number, row in enumerate(reader, 1):
                    if deadline is not None and line_number % 1000 == 0 and time.monotonic() >= deadline:
                        raise DatasetError("dataset wall cap reached during validation")
                    try:
                        bar = _parse_row(row, interval)
                    except DatasetError as exc:
                        raise DatasetError(f"{path.name}: row {line_number}: {exc}") from exc
                    if bar.open_us != expected:
                        raise DatasetError(f"{path.name}: row {line_number}: gap/duplicate/order; "
                                           f"expected {expected}, got {bar.open_us}")
                    if bar.open_us >= end:
                        raise DatasetError(f"{path.name}: row outside declared month")
                    expected += interval
                    count += 1
                    yield bar
                if expected != end:
                    raise DatasetError(f"{path.name}: incomplete month: {count} rows; stopped at {expected}")
    except (zipfile.BadZipFile, UnicodeError, csv.Error, EOFError) as exc:
        raise DatasetError(f"invalid ZIP/CSV {path}: {exc}") from exc


def _load_manifest(data_dir: Path) -> dict:
    try:
        manifest = json.loads((data_dir / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise DatasetError("missing or unreadable dataset manifest") from exc
    if manifest.get("parser_version") != PARSER_VERSION or manifest.get("unit") != UNIT:
        raise DatasetError("manifest parser/unit differs from pinned contract")
    if manifest.get("market") != "spot" or manifest.get("status") != "COMPLETE_VERIFIED":
        raise DatasetError("only COMPLETE_VERIFIED Spot manifests are readable")
    return manifest


def iter_bars(data_dir: Path, symbol: str, interval: str, start_us: int | None = None,
              end_us: int | None = None) -> Iterator[Bar]:
    """Yield [start_us,end_us) bars, validating selected full monthly archives.

    Each selected ZIP is checked against its pinned hash before any rows from it
    are emitted. Selected months are fully parsed, even outside the row slice.
    """
    data_dir = Path(data_dir)
    manifest = _load_manifest(data_dir)
    records = sorted((r for r in manifest["archives"]
                      if r["pair"] == symbol and r["interval"] == interval), key=lambda r: r["month"])
    if not records:
        raise DatasetError(f"no Spot archives for {symbol}:{interval}")
    if interval not in INTERVALS:
        raise DatasetError(f"unsupported interval {interval}")
    if start_us is not None and end_us is not None and start_us >= end_us:
        raise DatasetError("start_us must precede exclusive end_us")
    expected = None
    for record in records:
        _validate_record(record)
        if expected is not None and record["expected_start_us"] != expected:
            raise DatasetError("manifest has a missing/duplicate month")
        expected = record["expected_end_us_exclusive"]
    coverage = manifest.get("requested_coverage", {})
    first_us = records[0]["expected_start_us"]
    final_us = records[-1]["expected_end_us_exclusive"]
    if coverage.get("start_us") != first_us or coverage.get("end_us_exclusive") != final_us:
        raise DatasetError("manifest missing leading/trailing month for declared coverage")
    if (start_us is not None and start_us < first_us) or (end_us is not None and end_us > final_us):
        raise DatasetError("requested window extends outside verified dataset coverage")
    for record in records:
        if start_us is not None and record["expected_end_us_exclusive"] <= start_us:
            continue
        if end_us is not None and record["expected_start_us"] >= end_us:
            continue
        path = data_dir / record["path"]
        if path.stat().st_size != record["bytes"] or _sha256(path) != record["sha256"]:
            raise DatasetError(f"pinned archive bytes/hash changed: {path.name}")
        for bar in _iter_archive(path, record):
            if (start_us is None or bar.open_us >= start_us) and (end_us is None or bar.open_us < end_us):
                yield bar


class _Budget:
    def __init__(self, data_dir: Path, deadline: float):
        self.bytes = sum(p.stat().st_size for p in data_dir.rglob("*") if p.is_file())
        self.deadline = deadline
        self.lock = threading.Lock()
        self._check()

    def _check(self) -> None:
        if time.monotonic() >= self.deadline:
            raise DatasetError("dataset wall cap reached")
        if self.bytes > DISK_CAP:
            raise DatasetError("dataset disk cap exceeded")

    def add(self, amount: int) -> None:
        with self.lock:
            self.bytes += amount
            self._check()

    def release(self, amount: int) -> None:
        with self.lock:
            self.bytes -= amount


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise DatasetError("redirect rejected before any GET outside the fixed public archive origin")


def _get(url: str, path: Path, budget: _Budget, max_bytes: int) -> dict:
    """GET only, no credential discovery, 30s timeout, two finite retries."""
    if not url.startswith(ORIGIN + "/"):
        raise DatasetError("network URL outside fixed public Spot origin")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".partial")
    if temporary.exists():
        raise DatasetError(f"unregistered partial file exists: {temporary}")
    for attempt in range(3):
        amount = 0
        budget._check()
        try:
            request = urllib.request.Request(url, method="GET", headers={"User-Agent": PARSER_VERSION})
            remaining = budget.deadline - time.monotonic()
            with opener.open(request, timeout=min(30, remaining)) as response:
                if response.status != 200 or response.geturl() != url:
                    raise DatasetError("unexpected status/redirect from public archive source")
                declared = response.headers.get("Content-Length")
                if declared and int(declared) > max_bytes:
                    raise DatasetError("response exceeds declared per-file cap")
                metadata = {"retrieved_at": datetime.now(timezone.utc).isoformat(),
                            "last_modified": response.headers.get("Last-Modified"),
                            "etag": response.headers.get("ETag"), "get_attempts": attempt + 1}
                with temporary.open("xb") as handle:
                    while True:
                        budget._check()
                        chunk = response.read(CHUNK)
                        if not chunk:
                            break
                        amount += len(chunk)
                        budget.add(len(chunk))
                        if amount > max_bytes:
                            raise DatasetError("response exceeds per-file cap")
                        handle.write(chunk)
                    handle.flush()
                    os.fsync(handle.fileno())
                if declared is not None and amount != int(declared):
                    raise DatasetError("short Content-Length response")
            os.replace(temporary, path)
            return {**metadata, "bytes": amount}
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            if temporary.exists():
                temporary.unlink()
            budget.release(amount)
            if attempt == 2:
                raise DatasetError(f"public GET failed after 3 attempts: {url}: {exc}") from exc
        except BaseException:
            if temporary.exists():
                temporary.unlink()
            budget.release(amount)
            raise
    raise AssertionError("unreachable retry loop")


def _checksum(text: str, expected_name: str) -> str:
    fields = text.strip().split()
    if len(fields) != 2 or fields[1].lstrip("*") != expected_name:
        raise DatasetError("CHECKSUM must pin exactly the expected ZIP filename")
    digest = fields[0].lower()
    if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise DatasetError("invalid CHECKSUM SHA256")
    return digest


def _assert_pin(previous: dict | None, digest: str, byte_count: int) -> None:
    if previous and (previous["sha256"] != digest or previous["bytes"] != byte_count):
        raise DatasetError("archive revision differs from existing pinned SHA/bytes; explicit new dataset required")


def _fetch_record(data_dir: Path, spec: dict, previous: dict | None, budget: _Budget,
                  download: bool) -> dict:
    path = data_dir / spec["path"]
    checksum_path = path.with_name(path.name + ".CHECKSUM")
    if path.exists() and checksum_path.exists():
        digest = _checksum(checksum_path.read_text("ascii"), path.name)
        actual = _sha256(path)
        _assert_pin(previous, actual, path.stat().st_size)
        if actual != digest:
            raise DatasetError(f"cached archive checksum mismatch: {path.name}")
        return {**spec, **(previous or {}), "sha256": actual, "bytes": path.stat().st_size,
                "retrieved_at": (previous or {}).get("retrieved_at", "UNKNOWN_CACHED_RETRIEVAL"),
                "cache_reused": True}
    if path.exists() or checksum_path.exists():
        raise DatasetError(f"incomplete cached archive/checksum pair: {path.name}")
    if not download:
        raise DatasetError(f"archive missing; --download required: {path.name}")
    checksum_meta = _get(spec["checksum_url"], checksum_path, budget, 512)
    digest = _checksum(checksum_path.read_text("ascii"), path.name)
    if previous and previous["sha256"] != digest:
        raise DatasetError(f"remote archive revision differs from pinned dataset: {path.name}")
    metadata = _get(spec["source_url"], path, budget, 128 * 1024 ** 2)
    actual = _sha256(path)
    _assert_pin(previous, actual, metadata["bytes"])
    if actual != digest:
        raise DatasetError(f"downloaded archive SHA256 mismatch: {path.name}")
    return {**spec, **metadata, "sha256": actual, "checksum_retrieved_at": checksum_meta["retrieved_at"],
            "checksum_get_attempts": checksum_meta["get_attempts"], "cache_reused": False}


def _write_json(path: Path, value: dict) -> None:
    temporary = path.with_name(path.name + ".partial")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def _peak_rss() -> tuple[int, str]:
    # Some process launchers preserve a large pre-exec ru_maxrss watermark.
    # Linux VmHWM resets at exec and measures this Python workload instead.
    try:
        for line in Path("/proc/self/status").read_text("ascii").splitlines():
            if line.startswith("VmHWM:"):
                return int(line.split()[1]), "/proc/self/status:VmHWM_kB"
    except (OSError, ValueError):
        pass
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss, "getrusage:ru_maxrss_platform_units"


def prepare(protocol_path: Path, data_dir: Path, *, download: bool, verify: bool) -> dict:
    started = time.monotonic()
    deadline = started + WALL_CAP
    protocol_bytes = protocol_path.read_bytes()
    protocol = json.loads(protocol_bytes)
    definition = protocol["data"]
    if protocol["markets"]["market"] != "spot" or definition["archive_time_unit"] != "microsecond_explicit_since_2025":
        raise DatasetError("protocol does not specify the supported Spot microsecond archive contract")
    start = _utc_us(definition["start_utc"])
    end = _utc_us(definition["end_utc_exclusive"])
    months = _months(start, end)
    pairs = [entry.split(":") for entry in definition["required"]]
    if len({tuple(pair) for pair in pairs}) != len(pairs) or any(len(pair) != 2 for pair in pairs):
        raise DatasetError("duplicate or malformed required datasets")
    specs = [_spec(symbol, interval, month) for symbol, interval in pairs for month in months]
    data_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = data_dir / "manifest.json"
    previous = {}
    history = []
    if manifest_path.exists():
        old = json.loads(manifest_path.read_text("utf-8"))
        if old.get("protocol_sha256") != hashlib.sha256(protocol_bytes).hexdigest():
            raise DatasetError("existing dataset pinned to a different protocol")
        previous = {record["path"]: record for record in old["archives"]}
        for record in previous.values():
            _validate_record(record)
        history = old.get("run_history", [{"created_at": old["created_at"],
                   "status": old["status"], "elapsed_seconds": old.get("elapsed_seconds"),
                   "legacy_peak_rss_KiB": old.get("peak_process_rss_KiB"),
                   "legacy_memory_metric": "getrusage:ru_maxrss_includes_launcher_watermark"}])
    budget = _Budget(data_dir, deadline)
    manifest = {"schema_version": 1, "parser_version": PARSER_VERSION, "market": "spot", "unit": UNIT,
                "status": "INCOMPLETE", "protocol_path": str(protocol_path.resolve()),
                "protocol_sha256": hashlib.sha256(protocol_bytes).hexdigest(),
                "protocol_id": protocol["protocol_id"], "created_at": datetime.now(timezone.utc).isoformat(),
                "requested_coverage": {"start_us": start, "end_us_exclusive": end,
                                       "start_utc": _iso(start), "end_utc_exclusive": _iso(end)},
                "limits": {"network_threads": 2, "request_timeout_seconds": 30, "GET_retries": 2,
                           "disk_cap_bytes": DISK_CAP, "wall_cap_seconds": WALL_CAP}, "archives": []}
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(_fetch_record, data_dir, spec, previous.get(spec["path"]), budget, download)
                       for spec in specs]
            for future in futures:
                manifest["archives"].append(future.result())
        manifest["archives"].sort(key=lambda r: (r["pair"], r["interval"], r["month"]))
        if verify:
            totals = {}
            for record in manifest["archives"]:
                budget._check()
                _validate_record(record)
                path = data_dir / record["path"]
                if _sha256(path) != record["sha256"]:
                    raise DatasetError(f"archive changed before validation: {path.name}")
                count = 0
                first = last = None
                for bar in _iter_archive(path, record, deadline):
                    if first is None:
                        first = bar.open_us
                    last = bar.close_us
                    count += 1
                record["coverage"] = {"first_open_us": first, "last_close_us": last, "rows": count,
                                      "start_utc": _iso(first), "end_utc_exclusive": _iso(last + 1)}
                record["gaps"] = 0
                record["duplicates"] = 0
                record["ohlc_volume_errors"] = 0
                record["verified"] = True
                key = f"{record['pair']}:{record['interval']}"
                totals[key] = totals.get(key, 0) + count
                print(json.dumps({"verified": path.name, "rows": count}), flush=True)
            manifest["quality"] = {"archives": len(specs), "rows_by_dataset": totals,
                                   "total_rows": sum(totals.values()), "gaps": 0, "duplicates": 0,
                                   "ohlc_volume_errors": 0, "all_checksums_verified": True,
                                   "holdout_data_QA_only_no_strategy_or_PnL": True}
            manifest["status"] = "COMPLETE_VERIFIED"
        else:
            manifest["status"] = "DOWNLOADED_NOT_VALIDATED"
        manifest["elapsed_seconds"] = round(time.monotonic() - started, 3)
        peak, metric = _peak_rss()
        manifest["peak_process_rss_KiB"] = peak
        manifest["peak_process_rss_source"] = metric
        manifest["resource_ru_maxrss_KiB"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        manifest["disk_bytes"] = sum(p.stat().st_size for p in data_dir.rglob("*") if p.is_file())
        manifest["run_history"] = history + [{"created_at": manifest["created_at"],
                 "status": manifest["status"], "elapsed_seconds": manifest["elapsed_seconds"],
                 "download_requested": download, "verify_requested": verify,
                 "network_GET_attempts": sum(0 if r["cache_reused"] else
                     r.get("get_attempts", 0) + r.get("checksum_get_attempts", 0)
                     for r in manifest["archives"]),
                 "peak_process_rss_KiB": peak, "peak_process_rss_source": metric}]
        budget._check()
        _write_json(manifest_path, manifest)
        return manifest
    except BaseException as exc:
        manifest["status"] = "INCOMPLETE_FAILED"
        manifest["error"] = f"{type(exc).__name__}: {exc}"
        manifest["elapsed_seconds"] = round(time.monotonic() - started, 3)
        _write_json(manifest_path, manifest)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", required=True, type=Path)
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    manifest = prepare(args.protocol, args.data_dir, download=args.download, verify=args.verify)
    print(json.dumps({"status": manifest["status"], "manifest": str(args.data_dir / "manifest.json"),
                      "quality": manifest.get("quality"), "elapsed_seconds": manifest["elapsed_seconds"],
                      "peak_process_rss_KiB": manifest["peak_process_rss_KiB"],
                      "peak_process_rss_source": manifest["peak_process_rss_source"],
                      "disk_bytes": manifest["disk_bytes"]}, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
