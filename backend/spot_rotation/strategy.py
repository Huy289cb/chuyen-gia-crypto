"""One fixed, causal daily momentum hypothesis; no account or outcome access.

This is an independently specified daily, single-position adaptation of the
momentum idea, not a reproduction of a weekly portfolio paper's return. Every
input candle must be a complete canonical hour. The executor owns affordability,
fees, latency, stop placement, cash reserve and the rule against same-leader
top-ups. A decision with no target means cash; an unaffordable winner does not
authorize a lower-ranked substitute.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from decimal import Decimal, localcontext
import hashlib
from itertools import chain, zip_longest
import json
from pathlib import Path
from typing import Iterable, Iterator, Mapping

from spot_backtest.models import Bar, DAY_US, HOUR_US
from spot_btc_trend.strategy import Signal, validate_bar

D = Decimal
MODEL_ID = 'spot_rotation_7d_v1'
SYMBOLS = ('ADAUSDT', 'BNBUSDT', 'BTCUSDT', 'DOGEUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT')
MOMENTUM_DAYS = 7
ATR_PERIOD = 14
STOP_ATR_MULTIPLIER = D(2)
DECIMAL_PRECISION = 50
CONTROL_ID = 'V1_RULES_CONTROL_100_2025_2026'
CONTROL_SOURCE_SHA256 = '488ed9c15f0e1380e3a9eadd3ff02b68531bacf32c2015c3b18aa5083282a917'
CONTROL_SEED_START_US = 1680307200000000  # 2023-04-01 00:00:00 UTC
STRATEGY_PARAMETERS = {
    'symbols': list(SYMBOLS), 'decision_timezone': 'UTC',
    'momentum_days': MOMENTUM_DAYS, 'momentum_closes': MOMENTUM_DAYS + 1,
    'atr_period': ATR_PERIOD, 'atr_seed': 'SMA_first_14_true_ranges',
    'atr_update': '(13*previous_ATR+current_TR)/14',
    'first_true_range': 'high-low', 'stop_atr_multiplier': '2',
    'stop_kind': 'static_actual_fill_minus_2_ATR_tick_floor',
    'positive_btc_momentum_required': True, 'positive_winner_momentum_required': True,
    'tie_break': 'lexicographic_symbol_ascending', 'rank_fallback': False,
    'same_leader_resize': False, 'take_profit': None, 'trailing_stop': False,
    'decimal_precision': DECIMAL_PRECISION,
}


class FrozenDict(dict):
    """Snapshot mapping compatible with JSON and dataclasses.asdict.

    Normal mutation operations fail. Like other Python frozen data structures,
    this is an API guard, not protection against deliberately bypassing it.
    """
    def _deny(self, *args, **kwargs):
        raise TypeError('decision snapshot is immutable')

    __setitem__ = __delitem__ = clear = pop = popitem = setdefault = update = __ior__ = _deny


@dataclass(frozen=True, slots=True)
class DailyDecision:
    at_us: int
    target_symbol: str | None
    momentum: dict[str, Decimal]
    atr14: dict[str, Decimal]
    decision_id: str
    model_id: str = MODEL_ID


def aggregate_daily(bars: Iterable[Bar]) -> Iterator[Bar]:
    """Stream UTC daily OHLCV from exactly 24 consecutive closed hourly bars.

    A partial initial/final day, a gap, duplicate, or malformed candle is an
    error. No missing day is imputed and no later hour contributes to a yield.
    """
    previous_open = None
    first = None
    count = 0
    high = low = volume = quote_volume = None
    trades = 0
    for bar in bars:
        validate_bar(bar, HOUR_US, previous_open)
        previous_open = bar.open_us
        if count == 0:
            if bar.open_us % DAY_US:
                raise ValueError('daily stream must begin at UTC midnight')
            first = bar
            high, low = bar.high, bar.low
            volume, quote_volume, trades = D(0), D(0), 0
        high, low = max(high, bar.high), min(low, bar.low)
        with localcontext() as context:
            context.prec = DECIMAL_PRECISION
            volume += bar.volume
            quote_volume += bar.quote_volume
        trades += bar.trades
        count += 1
        if count == 24:
            daily = Bar(first.open_us, bar.close_us, first.open, high, low,
                        bar.close, volume, quote_volume, trades)
            count = 0
            # No local Decimal context survives across a yield.
            yield daily
    if count:
        raise ValueError('incomplete final UTC day')


def iter_decisions(hourly_by_symbol: Mapping[str, Iterable[Bar]]) -> Iterator[DailyDecision]:
    """Yield at daily close + 1 microsecond once all seven symbols are ready.

    Seven-day momentum uses eight completed daily closes. ATR requires fourteen
    daily true ranges and keeps its Wilder state across every subsequent day.
    All seven streams must share their full daily range. Decisions do not inspect
    execution feasibility and are never replaced with a lower-ranked symbol.
    """
    if set(hourly_by_symbol) != set(SYMBOLS) or len(hourly_by_symbol) != len(SYMBOLS):
        raise ValueError('exactly the seven registered symbols are required')
    streams = [aggregate_daily(hourly_by_symbol[symbol]) for symbol in SYMBOLS]
    missing = object()
    closes = {symbol: deque(maxlen=MOMENTUM_DAYS + 1) for symbol in SYMBOLS}
    previous_close = {symbol: None for symbol in SYMBOLS}
    atr = {symbol: None for symbol in SYMBOLS}
    tr_totals = {symbol: D(0) for symbol in SYMBOLS}
    day_count = 0
    for daily_bars in zip_longest(*streams, fillvalue=missing):
        if any(bar is missing for bar in daily_bars):
            raise ValueError('symbol daily ranges differ')
        times = {bar.close_us for bar in daily_bars}
        if len(times) != 1:
            raise ValueError('symbol daily closes are not synchronized')
        day_count += 1
        with localcontext() as context:
            context.prec = DECIMAL_PRECISION
            for symbol, bar in zip(SYMBOLS, daily_bars):
                prior = previous_close[symbol]
                tr = bar.high - bar.low if prior is None else max(
                    bar.high - bar.low, abs(bar.high - prior), abs(bar.low - prior))
                if day_count <= ATR_PERIOD:
                    tr_totals[symbol] += tr
                    if day_count == ATR_PERIOD:
                        atr[symbol] = tr_totals[symbol] / D(ATR_PERIOD)
                else:
                    atr[symbol] = (D(ATR_PERIOD - 1) * atr[symbol] + tr) / D(ATR_PERIOD)
                previous_close[symbol] = bar.close
                closes[symbol].append(bar.close)
            if day_count < ATR_PERIOD:
                continue
            momentum = {symbol: closes[symbol][-1] / closes[symbol][0] - D(1)
                        for symbol in SYMBOLS}
            # SYMBOLS is sorted: min over the maximum ratio provides the tie rule.
            best = max(momentum.values())
            winner = min(symbol for symbol in SYMBOLS if momentum[symbol] == best)
            target = winner if best > 0 and momentum['BTCUSDT'] > 0 else None
            at_us = daily_bars[0].close_us + 1
            identity = {'model_id': MODEL_ID, 'at_us': at_us, 'target_symbol': target,
                        'parameters': STRATEGY_PARAMETERS,
                        'momentum': {s: str(momentum[s]) for s in SYMBOLS},
                        'atr14': {s: str(atr[s]) for s in SYMBOLS}}
            decision_id = hashlib.sha256(json.dumps(identity, sort_keys=True,
                                                     separators=(',', ':')).encode()).hexdigest()
            decision = DailyDecision(at_us, target, FrozenDict(momentum),
                                     FrozenDict(atr), decision_id)
        yield decision


def generate_control_signals(bars: Iterable[Bar]) -> Iterator[Signal]:
    """Delegate to frozen BTC v1 rules with the original April 2023 EMA seed.

    The caller concatenates original hourly history with the new period, then
    filters execution dates. Financial sizing at 100/115 USDT is a new control,
    not a reproduction of v1's 15-USDT result. Its signal objects are unchanged.
    """
    import spot_btc_trend.strategy as frozen
    if hashlib.sha256(Path(frozen.__file__).read_bytes()).hexdigest() != CONTROL_SOURCE_SHA256:
        raise ValueError('frozen BTC strategy source identity changed')
    iterator = iter(bars)
    first = next(iterator, None)
    if first is None or first.open_us != CONTROL_SEED_START_US:
        raise ValueError('BTC control requires original 2023-04-01 hourly seed prefix')
    yield from frozen.generate_signals(chain((first,), iterator))
