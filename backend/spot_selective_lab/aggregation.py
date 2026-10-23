"""Exact bounded-memory UTC aggregation; only complete closed candles emit.

Inputs are already canonical Binance Spot microsecond Bar objects. This adapter
never guesses raw timestamp units or fills missing minutes.
"""
from __future__ import annotations

from decimal import Decimal, localcontext
from typing import Iterable, Iterator

from spot_backtest.models import Bar, HOUR_US, MINUTE_US

D = Decimal
ALLOWED_DURATIONS = frozenset((5 * MINUTE_US, HOUR_US))


def validate_minute(bar: Bar, previous: Bar | None = None) -> None:
    if (type(bar.open_us) is not int or type(bar.close_us) is not int
            or bar.open_us < 0 or bar.open_us % MINUTE_US
            or bar.close_us + 1 != bar.open_us + MINUTE_US):
        raise ValueError("SOLUSDT1m: unaligned or incomplete closed UTC candle")
    if previous is not None and bar.open_us != previous.close_us + 1:
        raise ValueError("SOLUSDT1m: missing, duplicate or unordered minute")
    if any(not isinstance(value, D) or not value.is_finite() or value <= 0
           for value in (bar.open, bar.high, bar.low, bar.close)):
        raise ValueError("SOLUSDT1m: positive finite Decimal OHLC required")
    if not bar.low <= min(bar.open, bar.close) <= max(bar.open, bar.close) <= bar.high:
        raise ValueError("SOLUSDT1m: invalid OHLC bounds")
    if any(not isinstance(value, D) or not value.is_finite() or value < 0
           for value in (bar.volume, bar.quote_volume)):
        raise ValueError("SOLUSDT1m: nonnegative finite Decimal volume required")
    if type(bar.trades) is not int or bar.trades < 0:
        raise ValueError("SOLUSDT1m: nonnegative integer trades required")


def aggregate_minutes(bars: Iterable[Bar], duration_us: int) -> Iterator[Bar]:
    """Aggregate complete contiguous 1m inputs to closed UTC 5m or 1h bars.

A stream must begin at an aggregation boundary and end after a full bucket.
Prefix results never inspect another bucket's prices. Exhaustion checks detect
an incomplete trailing bucket, so callers must exhaust before declaring valid
coverage. State consists of one aggregate and the previous minute.
"""
    if type(duration_us) is not int or duration_us not in ALLOWED_DURATIONS:
        raise ValueError("only exact UTC 5m and 1h aggregation is registered")
    expected_count = duration_us // MINUTE_US
    previous = None
    count = 0
    opened = first = high = low = closed = volume = quote_volume = trades = None
    for bar in bars:
        validate_minute(bar, previous)
        previous = bar
        if not count:
            if bar.open_us % duration_us:
                raise ValueError("aggregation stream starts inside an incomplete bucket")
            opened, first, high, low = bar.open_us, bar.open, bar.high, bar.low
            volume = quote_volume = D(0)
            trades = 0
        high, low, closed = max(high, bar.high), min(low, bar.low), bar.close
        with localcontext() as context:
            context.prec = 50
            volume += bar.volume
            quote_volume += bar.quote_volume
        trades += bar.trades
        count += 1
        if count == expected_count:
            result = Bar(opened, bar.close_us, first, high, low, closed,
                         volume, quote_volume, trades)
            count = 0
            yield result
    if count:
        raise ValueError("aggregation stream ends with an incomplete closed bucket")
