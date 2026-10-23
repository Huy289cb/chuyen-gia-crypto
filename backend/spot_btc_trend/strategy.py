"""Fixed EMA600 / 2% exit hypothesis adapted from the pinned public source.

Only completed 1h candles contribute. This is an adaptation with exact Decimal
arithmetic, not a bitwise recreation of TA-Lib or of the published backtest.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, localcontext
import hashlib
from typing import Iterable, Iterator

from spot_backtest.models import Bar, HOUR_US

D = Decimal
MODEL_ID = 'btc_ema600_2pct_v1'
SOURCE_COMMIT = 'b68a5518b4a3eba2fde1733160d7d7de356023b5'
EMA_PERIOD = 600
STARTUP_BARS = 1300
EXIT_FACTOR = D('.98')


@dataclass(frozen=True, slots=True)
class Signal:
    signal_id: str
    episode_id: str
    kind: str
    at_us: int
    reference: Decimal
    ema: Decimal
    previous_reference: Decimal
    previous_ema: Decimal
    model_id: str = MODEL_ID


def validate_bar(bar: Bar, interval_us: int, previous_open: int | None = None) -> None:
    for value in (bar.open_us, bar.close_us, bar.trades):
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError('nonnegative exact candle timestamps/trades required')
    if bar.open_us % interval_us or bar.close_us != bar.open_us + interval_us - 1:
        raise ValueError('candle interval/alignment mismatch')
    if previous_open is not None and bar.open_us != previous_open + interval_us:
        raise ValueError('candle gap, duplicate or ordering error')
    for value in (bar.open, bar.high, bar.low, bar.close, bar.volume, bar.quote_volume):
        if not isinstance(value, D) or not value.is_finite() or value < 0:
            raise ValueError('finite nonnegative Decimal OHLCV required')
    if min(bar.open, bar.high, bar.low, bar.close) <= 0:
        raise ValueError('positive OHLC required')
    if not bar.low <= min(bar.open, bar.close) <= max(bar.open, bar.close) <= bar.high:
        raise ValueError('invalid OHLC ordering')


def generate_signals(bars: Iterable[Bar]) -> Iterator[Signal]:
    """Emit stable ENTRY/EXIT crossings after 1300 completed warmup bars.

    EXIT is a global BTC signal. Its episode ID identifies the latest upward
    cross, but an executor must still exit an older held position if an
    intervening ENTRY was skipped while that position occupied the account.
    """
    count = 0
    total = D(0)
    ema = previous_ema = previous_close = None
    previous_open = None
    latest_episode = None
    for bar in bars:
        validate_bar(bar, HOUR_US, previous_open)
        previous_open = bar.open_us
        count += 1
        with localcontext() as context:
            context.prec = 50
            if count <= EMA_PERIOD:
                total += bar.close
                if count == EMA_PERIOD:
                    ema = total / D(EMA_PERIOD)
            else:
                ema += D(2) / D(EMA_PERIOD + 1) * (bar.close - ema)
            kind = None
            if count >= STARTUP_BARS and previous_ema is not None:
                if bar.close > ema and previous_close <= previous_ema and bar.volume > 0:
                    kind = 'ENTRY'
                elif bar.close < EXIT_FACTOR * ema and previous_close >= EXIT_FACTOR * previous_ema:
                    kind = 'EXIT'
        # The Decimal context has ended before yielding to the caller.
        if kind is not None:
            at = bar.close_us + 1
            identity = f'{MODEL_ID}:{SOURCE_COMMIT}:{kind}:{at}:{bar.close}:{ema}'
            signal_id = hashlib.sha256(identity.encode()).hexdigest()
            if kind == 'ENTRY':
                latest_episode = signal_id
            yield Signal(signal_id, latest_episode or signal_id, kind, at,
                         bar.close, ema, previous_close, previous_ema)
        previous_close, previous_ema = bar.close, ema
