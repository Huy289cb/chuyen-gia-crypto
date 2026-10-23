"""Offline correctness tests for the public Spot dataset boundary."""
import json
import tempfile
import unittest
import zipfile
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
import spot_aggressive_v3.dataset as dataset_module
from spot_backtest.models import Bar, MINUTE_US, HOUR_US

from spot_aggressive_v3.dataset import (DatasetError, INTERVALS, PARSER_VERSION, UNIT,
                                  _assert_pin, _checksum, _iter_archive, _parse_row,
                                  _sha256, _spec, _validate_record, iter_bars, validate_aggregation)


def row(opened, interval=INTERVALS["15m"], raw_unit="MICROSECONDS"):
    scale = 1000 if raw_unit == "MILLISECONDS" else 1
    return [str(opened // scale), "100.000000001", "101.1", "99.9", "100.2", "0.123456789",
            str((opened + interval - 1) // scale), "12.3456789", "3", "0.01", "1.00", "0"]


class DatasetTests(unittest.TestCase):
    def setUp(self):
        self.spec = _spec("SOLUSDT", "15m", "2026-09")
        self.opened = self.spec["expected_start_us"]

    def test_decimal_values_preserve_exact_precision(self):
        bar = _parse_row(row(self.opened), INTERVALS["15m"], "MICROSECONDS")
        self.assertEqual(bar.open, Decimal("100.000000001"))
        self.assertEqual(bar.volume, Decimal("0.123456789"))
        self.assertEqual(bar.close_us, self.opened + INTERVALS["15m"] - 1)

    def test_explicit_units_across_era_boundary_preserve_inclusive_endpoint(self):
        old = _spec("SOLUSDT", "4h", "2024-12")
        new = _spec("SOLUSDT", "4h", "2025-01")
        self.assertEqual(old["raw_timestamp_unit"], "MILLISECONDS")
        self.assertEqual(new["raw_timestamp_unit"], "MICROSECONDS")
        start = new["expected_start_us"]
        before = _parse_row(row(start - 4 * HOUR_US, 4 * HOUR_US, "MILLISECONDS"),
                            4 * HOUR_US, "MILLISECONDS")
        after = _parse_row(row(start, 4 * HOUR_US), 4 * HOUR_US, "MICROSECONDS")
        self.assertEqual(before.close_us + 1, after.open_us)
        self.assertEqual(before.close_us % 1000, 999)
        with self.assertRaisesRegex(DatasetError, "era mismatch"):
            _parse_row(row(start), 4 * HOUR_US, "MILLISECONDS")
        with self.assertRaisesRegex(DatasetError, "era mismatch"):
            _parse_row(row(start - 4 * HOUR_US, 4 * HOUR_US, "MILLISECONDS"),
                       4 * HOUR_US, "MICROSECONDS")

    def test_real_documented_archive_samples_normalize_to_same_bar_contract(self):
        old = "1733011200000,96407.99000000,96672.49000000,96260.00000000,96340.60000000,532.95388000,1733014799999,51410648.79613400,154693,246.27919000,23756467.10209110,0".split(",")
        new = "1735689600000000,3337.78000000,3365.71000000,3335.84000000,3363.70000000,8894.44440000,1735693199999999,29821272.00821100,54290,5447.53240000,18265028.78115900,0".split(",")
        for values, unit in ((old, "MILLISECONDS"), (new, "MICROSECONDS")):
            bar = _parse_row(values, HOUR_US, unit)
            self.assertEqual(bar.close_us + 1 - bar.open_us, HOUR_US)
        old[6] = str(int(old[6]) + 1)
        with self.assertRaisesRegex(DatasetError, "raw millisecond close_time"):
            _parse_row(old, HOUR_US, "MILLISECONDS")

    def test_leap_month_is_complete_and_mixed_units_are_rejected(self):
        spec = _spec("SOLUSDT", "4h", "2024-02")
        interval = 4 * HOUR_US
        opened, end = spec["expected_start_us"], spec["expected_end_us_exclusive"]
        self.assertEqual((end - opened) // interval, 29 * 6)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / Path(spec["path"]).name
            timestamps = range(opened, end, interval)
            valid_rows = [row(t, interval, "MILLISECONDS") for t in timestamps]
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr(path.stem + ".csv", "\n".join(",".join(v) for v in valid_rows))
            self.assertEqual(len(list(_iter_archive(path, spec))), 174)
            valid_rows[5] = row(opened + 5 * interval, interval, "MICROSECONDS")
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr(path.stem + ".csv", "\n".join(",".join(v) for v in valid_rows))
            with self.assertRaisesRegex(DatasetError, "era mismatch"):
                list(_iter_archive(path, spec))

    def test_aggregation_checks_every_field_and_detects_missing_minute(self):
        base = _spec("SOLUSDT", "4h", "2025-01")["expected_start_us"]
        minutes = [Bar(base + i * MINUTE_US, base + (i + 1) * MINUTE_US - 1,
                       Decimal("100"), Decimal("101"), Decimal("99"), Decimal("100"),
                       Decimal("2"), Decimal("200"), 1) for i in range(240)]
        coarse = Bar(base, base + 4 * HOUR_US - 1, Decimal("100"), Decimal("101"),
                     Decimal("99"), Decimal("100"), Decimal("480"), Decimal("48000"), 240)
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            manifest = {"parser_version": PARSER_VERSION, "unit": UNIT, "market": "spot",
                        "status": "COMPLETE_VERIFIED", "source_sha256": _sha256(Path(dataset_module.__file__)),
                        "protocol_sha256": "b" * 64, "archives": []}
            (directory / "manifest.json").write_text(json.dumps(manifest))
            with patch("spot_aggressive_v3.dataset.iter_bars",
                       side_effect=lambda _, __, interval: iter(minutes if interval == "1m" else [coarse])):
                result = validate_aggregation(directory)
                self.assertEqual(result["status"], "EXACT_MATCH")
                self.assertEqual(result["aggregated_minute_rows"], 240)
                self.assertEqual(result["expected_manifest_sha256"], _sha256(directory / "manifest.json"))
            wrong = Bar(coarse.open_us, coarse.close_us, coarse.open, coarse.high, coarse.low,
                        coarse.close, coarse.volume, coarse.quote_volume + 1, coarse.trades)
            with patch("spot_aggressive_v3.dataset.iter_bars",
                       side_effect=lambda _, __, interval: iter(minutes if interval == "1m" else [wrong])):
                with self.assertRaisesRegex(DatasetError, "quote_volume"):
                    validate_aggregation(directory)
            with patch("spot_aggressive_v3.dataset.iter_bars",
                       side_effect=lambda _, __, interval: iter(minutes[:100] + minutes[101:] if interval == "1m" else [coarse])):
                with self.assertRaisesRegex(DatasetError, "gapped minute"):
                    validate_aggregation(directory)

    def test_reject_millisecond_and_mixed_timestamp_units(self):
        values = row(self.opened)
        values[0] = str(self.opened // 1000)
        values[6] = str((self.opened + INTERVALS["15m"] - 1) // 1000)
        with self.assertRaisesRegex(DatasetError, "MICROSECONDS"):
            _parse_row(values, INTERVALS["15m"], "MICROSECONDS")
        values = row(self.opened)
        values[6] = str(self.opened + INTERVALS["15m"] - 1000)
        with self.assertRaisesRegex(DatasetError, "close_time"):
            _parse_row(values, INTERVALS["15m"], "MICROSECONDS")

    def test_reject_shape_and_invalid_ohlc_volume(self):
        for values in (row(self.opened)[:-1], row(self.opened) + ["funding"],
                       row(self.opened)[:2] + ["99"] + row(self.opened)[3:]):
            with self.assertRaises(DatasetError):
                _parse_row(values, INTERVALS["15m"], "MICROSECONDS")
        for index, value in ((5, "NaN"), (7, "-1"), (9, "2"), (8, "1.0")):
            values = row(self.opened)
            values[index] = value
            with self.assertRaises(DatasetError):
                _parse_row(values, INTERVALS["15m"], "MICROSECONDS")

    def test_futures_manifest_and_url_are_rejected_despite_similar_csv_shape(self):
        record = {**self.spec, "sha256": "a" * 64}
        for change in ({"market": "futures"},
                       {"source_url": self.spec["source_url"].replace("/spot/", "/futures/um/")},
                       {"unit": "MILLISECONDS"}):
            with self.assertRaises(DatasetError):
                _validate_record({**record, **change})

    def test_streaming_archive_detects_gap_duplicate_and_truncated_month(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / Path(self.spec["path"]).name
            for timestamps in ([self.opened, self.opened + 2 * INTERVALS["15m"]],
                               [self.opened, self.opened], [self.opened]):
                with zipfile.ZipFile(path, "w") as archive:
                    archive.writestr(path.stem + ".csv", "\n".join(",".join(row(t)) for t in timestamps))
                with self.assertRaisesRegex(DatasetError, "gap/duplicate/order|incomplete month"):
                    list(_iter_archive(path, self.spec))

    def test_revision_hash_and_checksum_filename_cannot_change_silently(self):
        _assert_pin({"sha256": "a" * 64, "bytes": 100}, "a" * 64, 100)
        with self.assertRaisesRegex(DatasetError, "revision"):
            _assert_pin({"sha256": "a" * 64, "bytes": 100}, "b" * 64, 100)
        with self.assertRaisesRegex(DatasetError, "revision"):
            _assert_pin({"sha256": "a" * 64, "bytes": 100}, "a" * 64, 101)
        self.assertEqual(_checksum("a" * 64 + "  file.zip\n", "file.zip"), "a" * 64)
        with self.assertRaises(DatasetError):
            _checksum("a" * 64 + "  other.zip", "file.zip")

    def test_iter_bars_checks_revision_before_emitting_rows(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            path = directory / self.spec["path"]
            path.parent.mkdir(parents=True)
            path.write_bytes(b"not a zip")
            record = {**self.spec, "sha256": _sha256(path), "bytes": path.stat().st_size}
            manifest = {"parser_version": PARSER_VERSION, "unit": UNIT, "market": "spot",
                        "status": "COMPLETE_VERIFIED", "source_sha256": _sha256(Path(dataset_module.__file__)), "archives": [record],
                        "requested_coverage": {"start_us": self.opened,
                            "end_us_exclusive": self.spec["expected_end_us_exclusive"]}}
            (directory / "manifest.json").write_text(json.dumps(manifest))
            path.write_bytes(b"changed zip")
            with self.assertRaisesRegex(DatasetError, "hash changed"):
                next(iter_bars(directory, "SOLUSDT", "15m"))

    def test_complete_month_stream_and_exclusive_slice(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            path = directory / self.spec["path"]
            path.parent.mkdir(parents=True)
            interval = INTERVALS["15m"]
            end = self.spec["expected_end_us_exclusive"]
            with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr(path.stem + ".csv", "\n".join(",".join(row(t))
                                  for t in range(self.opened, end, interval)))
            record = {**self.spec, "sha256": _sha256(path), "bytes": path.stat().st_size}
            manifest = {"parser_version": PARSER_VERSION, "unit": UNIT, "market": "spot",
                        "status": "COMPLETE_VERIFIED", "source_sha256": _sha256(Path(dataset_module.__file__)), "archives": [record],
                        "requested_coverage": {"start_us": self.opened, "end_us_exclusive": end}}
            manifest_path = directory / "manifest.json"
            manifest_path.write_text(json.dumps(manifest))
            bars = list(iter_bars(directory, "SOLUSDT", "15m",
                                  start_us=self.opened + interval, end_us=self.opened + 3 * interval))
            self.assertEqual([b.open_us for b in bars], [self.opened + interval, self.opened + 2 * interval])
            manifest["requested_coverage"]["start_us"] -= 31 * 24 * 60 * INTERVALS["1m"]
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(DatasetError, "leading/trailing"):
                next(iter_bars(directory, "SOLUSDT", "15m"))


if __name__ == "__main__":
    unittest.main()
