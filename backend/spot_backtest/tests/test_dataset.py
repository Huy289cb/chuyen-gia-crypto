"""Offline correctness tests for the public Spot dataset boundary."""
import json
import tempfile
import unittest
import zipfile
from decimal import Decimal
from pathlib import Path

from spot_backtest.dataset import (DatasetError, INTERVALS, PARSER_VERSION, UNIT,
                                  _assert_pin, _checksum, _iter_archive, _parse_row,
                                  _sha256, _spec, _validate_record, iter_bars)


def row(opened, interval=INTERVALS["15m"]):
    return [str(opened), "100.000000001", "101.1", "99.9", "100.2", "0.123456789",
            str(opened + interval - 1), "12.3456789", "3", "0.01", "1.00", "0"]


class DatasetTests(unittest.TestCase):
    def setUp(self):
        self.spec = _spec("SOLUSDT", "15m", "2026-09")
        self.opened = self.spec["expected_start_us"]

    def test_decimal_values_preserve_exact_precision(self):
        bar = _parse_row(row(self.opened), INTERVALS["15m"])
        self.assertEqual(bar.open, Decimal("100.000000001"))
        self.assertEqual(bar.volume, Decimal("0.123456789"))
        self.assertEqual(bar.close_us, self.opened + INTERVALS["15m"] - 1)

    def test_reject_millisecond_and_mixed_timestamp_units(self):
        values = row(self.opened)
        values[0] = str(self.opened // 1000)
        values[6] = str((self.opened + INTERVALS["15m"] - 1) // 1000)
        with self.assertRaisesRegex(DatasetError, "MICROSECONDS"):
            _parse_row(values, INTERVALS["15m"])
        values = row(self.opened)
        values[6] = str(self.opened + INTERVALS["15m"] - 1000)
        with self.assertRaisesRegex(DatasetError, "close_time"):
            _parse_row(values, INTERVALS["15m"])

    def test_reject_shape_and_invalid_ohlc_volume(self):
        for values in (row(self.opened)[:-1], row(self.opened) + ["funding"],
                       row(self.opened)[:2] + ["99"] + row(self.opened)[3:]):
            with self.assertRaises(DatasetError):
                _parse_row(values, INTERVALS["15m"])
        for index, value in ((5, "NaN"), (7, "-1"), (9, "2"), (8, "1.0")):
            values = row(self.opened)
            values[index] = value
            with self.assertRaises(DatasetError):
                _parse_row(values, INTERVALS["15m"])

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
                        "status": "COMPLETE_VERIFIED", "archives": [record],
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
                        "status": "COMPLETE_VERIFIED", "archives": [record],
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
