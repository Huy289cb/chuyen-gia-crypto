"""One canonical, causal breakout/retest rule shared by replay and future paper.

Indicators use only closed Spot bars. No clock, broker, DB or model imports.
"""
from collections import deque
from dataclasses import dataclass
from decimal import Decimal, ROUND_FLOOR
import hashlib
from typing import Iterable, Iterator

from .models import Bar, HOUR_US, MINUTE_US

D = Decimal
RULE_VERSION = "spot-half-capital-breakout-retest-v1"
TICK = D("0.01")


def floor_tick(value: Decimal) -> Decimal:
    return (value / TICK).to_integral_value(rounding=ROUND_FLOOR) * TICK


@dataclass(frozen=True, slots=True)
class Signal:
    setup_id: str
    at_us: int
    breakout_us: int
    level: Decimal
    reference: Decimal
    stop: Decimal
    target: Decimal
    atr: Decimal
    context_ok: bool
    reason: str
    sol_hour_close_us: int | None
    btc_hour_close_us: int | None


class ClosedHour:
    def __init__(self):
        self.pending: list[Bar] = []
        self.closes = deque(maxlen=20)
        self.last_close: Decimal | None = None
        self.last_close_us: int | None = None

    def push(self, bar: Bar):
        hour_open = bar.open_us // HOUR_US * HOUR_US
        if self.pending and self.pending[0].open_us // HOUR_US * HOUR_US != hour_open:
            self.pending.clear()
        self.pending.append(bar)
        if bar.close_us + 1 != hour_open + HOUR_US:
            return
        if len(self.pending) == 4 and self.pending[0].open_us == hour_open:
            if all(b.open_us == hour_open + i * 15 * MINUTE_US for i, b in enumerate(self.pending)):
                self.last_close = bar.close
                self.last_close_us = bar.close_us
                self.closes.append(bar.close)
        self.pending.clear()

    def trend_ok(self) -> bool | None:
        if len(self.closes) < 20:
            return None
        return self.last_close >= sum(self.closes, D("0")) / D(20)


class WilderATR:
    def __init__(self):
        self.previous_close = None
        self.seed = []
        self.value = None

    def push(self, bar: Bar):
        prev = self.previous_close if self.previous_close is not None else bar.close
        tr = max(bar.high - bar.low, abs(bar.high - prev), abs(bar.low - prev))
        self.previous_close = bar.close
        if self.value is None:
            self.seed.append(tr)
            if len(self.seed) == 14:
                self.value = sum(self.seed, D("0")) / D(14)
        else:
            self.value = (self.value * D(13) + tr) / D(14)
        return self.value


def generate_signals(sol15: Iterable[Bar], btc15: Iterable[Bar]) -> Iterator[Signal]:
    """Yield first retests including consumed/rejected context, never future labels.

The newest simultaneously retested breakout wins; all other matched setups are
emitted as consumed rejections. No position/account state changes this stream.
"""
    prior_highs = deque(maxlen=20)
    active = []
    sol_hour, btc_hour, atr = ClosedHour(), ClosedHour(), WilderATR()
    btc_iter = iter(btc15)
    btc_next = next(btc_iter, None)
    for bar in sol15:
        while btc_next is not None and btc_next.close_us <= bar.close_us:
            btc_hour.push(btc_next)
            btc_next = next(btc_iter, None)
        sol_hour.push(bar)
        value = atr.push(bar)
        matched, retained = [], []
        for setup in active:
            age = setup["age"] + 1
            if bar.close <= setup["level"]:
                continue  # Invalidation before a later retest; never re-arm.
            if age <= 8 and bar.low <= setup["level"] < bar.close:
                matched.append(setup)
            elif age < 8:
                retained.append(dict(setup, age=age))
        active = retained
        matched.sort(key=lambda x: (-x["close_us"], x["id"]))
        for rank, setup in enumerate(matched):
            trend_sol, trend_btc = sol_hour.trend_ok(), btc_hour.trend_ok()
            ok = rank == 0 and trend_sol is True and trend_btc is True and value is not None
            if rank:
                reason = "CONCURRENT_SETUP_CONSUMED"
            elif value is None or trend_sol is None or trend_btc is None:
                reason = "CONTEXT_WARMUP_MISSING"
            elif not trend_sol or not trend_btc:
                reason = "CONTEXT_BELOW_SMA20"
            else:
                reason = "ELIGIBLE_CONTEXT"
            stop = floor_tick(bar.low - D("0.5") * value) if value is not None else D("0")
            target = floor_tick(bar.close + D(2) * (bar.close - stop))
            yield Signal(setup["id"], bar.close_us + 1, setup["close_us"], setup["level"],
                         bar.close, stop, target, value or D("0"), ok, reason,
                         sol_hour.last_close_us, btc_hour.last_close_us)
        if len(prior_highs) == 20:
            level = max(prior_highs)
            if bar.close > level:
                canonical_level = format(level.normalize(), "f")
                ident = hashlib.sha256(f"{RULE_VERSION}|SOLUSDT|{bar.close_us}|{canonical_level}".encode()).hexdigest()[:24]
                active.append({"id": ident, "close_us": bar.close_us, "level": level, "age": 0})
        prior_highs.append(bar.high)
