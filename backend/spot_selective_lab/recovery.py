"""Pure, closed-candle minimal adaptation of NFI X8's enabled tag 161.

Source commit 918b34e3730496839a9aac670fee5c5b05039b84, core lines
20195-20210. Hundreds of NFI protection clauses, 15m Aroon/StochRSI,
portfolio modes, DCA and NFI exits are deliberately outside this adaptation.
This module creates hypotheses, never orders, forecasts or financial results.
"""
from collections import deque
from dataclasses import dataclass
from decimal import Decimal, ROUND_FLOOR, localcontext
import hashlib
from typing import Iterable, Iterator

from spot_backtest.models import Bar, HOUR_US, MINUTE_US

D = Decimal
FIVE_MINUTES_US = 5 * MINUTE_US
FOUR_HOURS_US = 4 * HOUR_US
MECHANISM_ID = "recovery5m_v1"
TICK = D("0.01")  # SOLUSDT research tick scenario; not exchange metadata.


@dataclass(frozen=True, slots=True)
class RecoverySignal:
    signal_id: str
    episode_id: str
    mechanism_id: str
    signal_us: int
    reference: Decimal
    stop: Decimal
    hurdle: Decimal
    target: None
    evidence: dict[str, Decimal | int | str]


def _validate(bar: Bar, previous: Bar | None, duration: int, label: str) -> None:
    if (type(bar.open_us) is not int or type(bar.close_us) is not int
            or bar.open_us < 0 or bar.open_us % duration
            or bar.close_us + 1 != bar.open_us + duration):
        raise ValueError(f"{label}: unaligned or incomplete UTC closed candle")
    if previous is not None and bar.open_us != previous.close_us + 1:
        raise ValueError(f"{label}: missing, duplicate or unordered candle")
    if any(not isinstance(v, D) or not v.is_finite() or v <= 0
           for v in (bar.open, bar.high, bar.low, bar.close)):
        raise ValueError(f"{label}: positive finite Decimal OHLC required")
    if not bar.low <= min(bar.open, bar.close) <= max(bar.open, bar.close) <= bar.high:
        raise ValueError(f"{label}: invalid OHLC bounds")
    if any(not isinstance(v, D) or not v.is_finite() or v < 0
           for v in (bar.volume, bar.quote_volume)):
        raise ValueError(f"{label}: finite nonnegative Decimal volumes required")
    if type(bar.trades) is not int or bar.trades < 0:
        raise ValueError(f"{label}: nonnegative integer trades required")


class _EMA200:
    """SMA200 seed followed by EMA alpha 2/201; bounded memory."""

    def __init__(self) -> None:
        self.count = 0
        self.total = D(0)
        self.value: Decimal | None = None

    def push(self, value: Decimal) -> Decimal | None:
        self.count += 1
        if self.count <= 200:
            self.total += value
            if self.count == 200:
                self.value = self.total / D(200)
        else:
            self.value += D(2) / D(201) * (value - self.value)
        return self.value


class _RSI14:
    """Wilder RSI seeded with fourteen close-to-close differences."""

    def __init__(self) -> None:
        self.previous: Decimal | None = None
        self.count = 0
        self.gain = D(0)
        self.loss = D(0)

    def push(self, close: Decimal) -> Decimal | None:
        previous, self.previous = self.previous, close
        if previous is None:
            return None
        change = close - previous
        gain, loss = max(change, D(0)), max(-change, D(0))
        self.count += 1
        if self.count <= 14:
            self.gain += gain
            self.loss += loss
            if self.count < 14:
                return None
            self.gain /= D(14)
            self.loss /= D(14)
        else:
            self.gain = (self.gain * D(13) + gain) / D(14)
            self.loss = (self.loss * D(13) + loss) / D(14)
        if self.gain == self.loss == 0:
            return D(50)
        return D(100) * self.gain / (self.gain + self.loss)


class _ATR14:
    """Wilder ATR seeded with fourteen ranges; first TR is high-low."""

    def __init__(self) -> None:
        self.previous: Decimal | None = None
        self.count = 0
        self.total = D(0)
        self.value: Decimal | None = None

    def push(self, bar: Bar) -> Decimal | None:
        previous = bar.close if self.previous is None else self.previous
        self.previous = bar.close
        tr = max(bar.high - bar.low, abs(bar.high - previous), abs(bar.low - previous))
        self.count += 1
        if self.count <= 14:
            self.total += tr
            if self.count == 14:
                self.value = self.total / D(14)
        else:
            self.value = (self.value * D(13) + tr) / D(14)
        return self.value


def _width(closes: deque[Decimal]) -> Decimal | None:
    if len(closes) != 20:
        return None
    mean = sum(closes, D(0)) / D(20)
    variance = sum(((v - mean) ** 2 for v in closes), D(0)) / D(20)
    # BB upper/lower = mean +/- 2 population std; width is a ratio.
    return D(4) * variance.sqrt() / mean


def _floor(value: Decimal) -> Decimal:
    return (value / TICK).to_integral_value(rounding=ROUND_FLOOR) * TICK


class _Context:
    """Only compute features for context candles available before the signal."""

    def __init__(self, bars: Iterable[Bar], duration: int, label: str) -> None:
        self.iterator = iter(bars)
        self.next = next(self.iterator, None)
        self.duration, self.label = duration, label
        self.last: Bar | None = None
        self.ema = _EMA200()
        self.closes: deque[Decimal] = deque(maxlen=20)

    def advance(self, available_us: int) -> None:
        if self.last is None and self.next is None:
            raise ValueError(f"{self.label}: missing entire context stream")
        while self.next is not None and self.next.close_us < available_us:
            bar = self.next
            _validate(bar, self.last, self.duration, self.label)
            self.last = bar
            self.ema.push(bar.close)
            self.closes.append(bar.close)
            self.next = next(self.iterator, None)
        # Before the first context candle closes, warmup is simply unavailable.
        # Once started, the newest expected completed candle must exist.
        expected_close = available_us // self.duration * self.duration - 1
        if self.last is not None and self.last.close_us != expected_close:
            raise ValueError(f"{self.label}: missing or stale latest closed context")

    def validate_suffix(self) -> None:
        """Validate future records structurally without computing their features."""
        previous = self.last
        while self.next is not None:
            _validate(self.next, previous, self.duration, self.label)
            previous = self.next
            self.next = next(self.iterator, None)


def generate_signals(sol5m: Iterable[Bar], sol1h: Iterable[Bar], sol4h: Iterable[Bar]) -> Iterator[RecoverySignal]:
    """Generate recovery hypotheses at 5m close+1us from complete UTC candles.

All streams must be internally contiguous and valid. Available 1h/4h records
must exactly cover the latest completed context interval once context begins.
Future suffixes are validated at exhaustion but do not feed past indicators.
No fake crossover occurs at SMA/context warmup. The hurdle is a 4ATR cost
diagnostic, never a take-profit target or predicted future price.
"""
    one_hour = _Context(sol1h, HOUR_US, "SOLUSDT1h")
    four_hours = _Context(sol4h, FOUR_HOURS_US, "SOLUSDT4h")
    closes: deque[Decimal] = deque(maxlen=200)
    bb_closes: deque[Decimal] = deque(maxlen=20)
    rsi, atr = _RSI14(), _ATR14()
    previous_bar: Bar | None = None
    previous_sma21: Decimal | None = None
    previous_sma200: Decimal | None = None

    for bar in sol5m:
        _validate(bar, previous_bar, FIVE_MINUTES_US, "SOLUSDT5m")
        previous_bar = bar
        available_us = bar.close_us + 1
        with localcontext() as context:
            context.prec = 50
            one_hour.advance(available_us)
            four_hours.advance(available_us)
            closes.append(bar.close)
            bb_closes.append(bar.close)
            rsi_value, atr_value = rsi.push(bar.close), atr.push(bar)
            sma21 = sum(tuple(closes)[-21:], D(0)) / D(21) if len(closes) >= 21 else None
            sma200 = sum(closes, D(0)) / D(200) if len(closes) == 200 else None
            cross = (previous_sma21 is not None and previous_sma200 is not None
                     and previous_sma21 < previous_sma200 and sma21 > sma200)
            previous_sma21, previous_sma200 = sma21, sma200
            ema1h, ema4h = one_hour.ema.value, four_hours.ema.value
            width5m, width1h = _width(bb_closes), _width(one_hour.closes)
            ready = (rsi_value is not None and atr_value is not None
                     and ema1h is not None and ema4h is not None
                     and width5m is not None and width1h is not None)
            if not (cross and ready and rsi_value < D(50)
                    and bar.close > ema1h and bar.close > ema4h
                    and width5m > D("0.015") and width1h > D("0.06")):
                continue
            stop, hurdle = _floor(bar.close - D(2) * atr_value), _floor(bar.close + D(4) * atr_value)
            if not D(0) < stop < bar.close < hurdle:
                continue
            identity = f"{MECHANISM_ID}|SOLUSDT|{available_us}|{format(bar.close.normalize(), 'f')}"
            episode_id = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
            signal = RecoverySignal(
                signal_id=episode_id, episode_id=episode_id, mechanism_id=MECHANISM_ID,
                signal_us=available_us, reference=bar.close, stop=stop, hurdle=hurdle, target=None,
                evidence={"source_mode": "NFI_X8_tag161_minimal_adaptation",
                          "sma21": sma21, "sma200": sma200,
                          "rsi14": rsi_value, "atr14": atr_value,
                          "ema200_1h": ema1h, "ema200_4h": ema4h,
                          "bbwidth20_population_5m": width5m,
                          "bbwidth20_population_1h": width1h,
                          "context1h_close_us": one_hour.last.close_us,
                          "context4h_close_us": four_hours.last.close_us,
                          "hurdle_role": "cost_diagnostic_only"},
            )
        # Decimal precision context must not remain active across a yield.
        yield signal
    one_hour.validate_suffix()
    four_hours.validate_suffix()
