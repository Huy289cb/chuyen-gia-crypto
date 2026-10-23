#!/usr/bin/env python3
"""
DOWNLOAD HOURLY UNIVERSE FOR PHASE 2 RESEARCH
Downloads complete 1h OHLCV klines from Binance USDT-Margined Futures public API.
Period: 2022-09-01 00:00:00 UTC to 2026-10-23 23:00:00 UTC (~36,300 hours)
Universe: BTCUSDT, ETHUSDT, SOLUSDT, DOGEUSDT, XRPUSDT, BNBUSDT, ADAUSDT, LINKUSDT, AVAXUSDT, NEARUSDT
"""

from __future__ import annotations
import json
import time
import urllib.request
from pathlib import Path
from datetime import datetime, timezone

CACHE_DIR = Path(__file__).resolve().parents[1] / "data" / "backtest-cache" / "hourly-universe"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

SYMBOLS = [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "DOGEUSDT",
    "XRPUSDT",
    "BNBUSDT",
    "ADAUSDT",
    "LINKUSDT",
    "AVAXUSDT",
    "NEARUSDT",
]

START_TIME_MS = int(datetime(2022, 9, 1, 0, 0, 0, tzinfo=timezone.utc).timestamp() * 1000)
END_TIME_MS = int(datetime(2026, 10, 23, 23, 59, 59, tzinfo=timezone.utc).timestamp() * 1000)

def fetch_symbol_hourly(symbol: str) -> list[dict]:
    cache_path = CACHE_DIR / f"{symbol}_1h_2022_2026.json"
    if cache_path.exists():
        try:
            with cache_path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list) and len(data) > 30000:
                print(f"[{symbol}] Loaded {len(data)} cached 1h candles ({data[0]['dt']} to {data[-1]['dt']})")
                return data
        except Exception:
            pass

    print(f"[{symbol}] Fetching 1h candles from Binance ({datetime.fromtimestamp(START_TIME_MS/1000, timezone.utc).isoformat()} to {datetime.fromtimestamp(END_TIME_MS/1000, timezone.utc).isoformat()})...")
    current_start = START_TIME_MS
    all_candles = []

    while current_start < END_TIME_MS:
        url = f"https://fapi.binance.com/fapi/v1/klines?symbol={symbol}&interval=1h&limit=1500&startTime={current_start}&endTime={END_TIME_MS}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                batch = json.loads(res.read().decode("utf-8"))
        except Exception as e:
            print(f"[{symbol}] Retrying after error: {e}")
            time.sleep(1.0)
            continue

        if not batch:
            break

        for row in batch:
            open_time = row[0]
            if open_time > END_TIME_MS:
                break
            all_candles.append({
                "t": open_time,
                "dt": datetime.fromtimestamp(open_time / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M"),
                "o": float(row[1]),
                "h": float(row[2]),
                "l": float(row[3]),
                "c": float(row[4]),
                "v": float(row[5]),
            })

        last_open_time = batch[-1][0]
        if last_open_time <= current_start:
            break
        current_start = last_open_time + 3600000
        print(f"[{symbol}] Fetched up to {all_candles[-1]['dt']} (total {len(all_candles)} candles)...", end="\r")
        time.sleep(0.08)

    print(f"\n[{symbol}] Completed: {len(all_candles)} candles. Saving to cache...")
    with cache_path.open("w", encoding="utf-8") as f:
        json.dump(all_candles, f)
    return all_candles

def main():
    print(f"Starting download for {len(SYMBOLS)} symbols from 2022-09-01 to 2026-10-23...")
    stats = {}
    for sym in SYMBOLS:
        candles = fetch_symbol_hourly(sym)
        stats[sym] = len(candles)
    print("\nDownload Summary:")
    for sym, count in stats.items():
        print(f"  {sym:10s}: {count:6d} candles")
    print("Done!")

if __name__ == "__main__":
    main()
