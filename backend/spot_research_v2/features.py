"""Locked v2 research signals from closed, aligned Spot four-hour bars only.

No account, execution, exchange, clock, provider or financial-result dependency.
The output records attempts even when the reversion context rejects an excursion.
"""
from collections import deque
from dataclasses import dataclass
from decimal import Decimal, ROUND_FLOOR, localcontext
import hashlib
from typing import Iterable, Iterator

from .models import Bar, HOUR_US

D = Decimal
FOUR_HOURS_US = 4 * HOUR_US
RULE_VERSION = "spot-two-new-mechanisms-v2"
TICK = D("0.01")
MODELS = frozenset(("trend4h", "reversion4h"))


def floor_tick(value: Decimal) -> Decimal:
    with localcontext() as context:
        context.prec = 50
        return (value / TICK).to_integral_value(rounding=ROUND_FLOOR) * TICK


@dataclass(frozen=True, slots=True)
class ResearchEvent:
    model_id: str
    setup_id: str
    at_us: int
    kind: str
    reference: Decimal
    stop: Decimal | None
    target: Decimal | None
    hurdle_price: Decimal | None
    context_ok: bool = True
    reason: str = ""


class WilderATR:
    """ATR14 seeded by fourteen true ranges, then Wilder RMA; Decimal only."""

    def __init__(self):
        self.previous_close: Decimal | None = None
        self.seed: list[Decimal] = []
        self.value: Decimal | None = None

    def push(self, bar: Bar) -> Decimal | None:
        previous = self.previous_close if self.previous_close is not None else bar.close
        self.previous_close = bar.close
        with localcontext() as context:
            context.prec = 50
            true_range = max(bar.high - bar.low, abs(bar.high - previous), abs(bar.low - previous))
            if self.value is None:
                self.seed.append(true_range)
                if len(self.seed) == 14:
                    self.value = sum(self.seed, D("0")) / D(14)
            else:
                self.value = (self.value * D(13) + true_range) / D(14)
        return self.value


def _validate_bar(bar: Bar, previous: Bar | None, symbol: str) -> None:
    if bar.open_us % FOUR_HOURS_US or bar.close_us + 1 != bar.open_us + FOUR_HOURS_US:
        raise ValueError(f"{symbol}: unaligned or incomplete closed4h bar")
    if previous is not None and bar.open_us != previous.close_us + 1:
        raise ValueError(f"{symbol}: gapped, duplicate or unordered closed4h bars")
    prices = (bar.open, bar.high, bar.low, bar.close)
    if any(not isinstance(value, D) or not value.is_finite() or value <= 0 for value in prices):
        raise ValueError(f"{symbol}: prices require finite positive Decimal")
    if not bar.low <= min(bar.open, bar.close) <= max(bar.open, bar.close) <= bar.high:
        raise ValueError(f"{symbol}: invalid closed4h OHLC")


def _mean(values: Iterable[Decimal]) -> Decimal:
    numbers = tuple(values)
    with localcontext() as context:
        context.prec = 50
        return sum(numbers, D("0")) / D(len(numbers))


def _lower_band(values: Iterable[Decimal]) -> tuple[Decimal, Decimal]:
    numbers = tuple(values)
    with localcontext() as context:
        context.prec = 50
        mean = sum(numbers, D("0")) / D(20)
        variance = sum(((value - mean) ** 2 for value in numbers), D("0")) / D(20)
        return mean, mean - D(2) * variance.sqrt()


def _setup_id(model_id: str, bar: Bar) -> str:
    with localcontext() as context:
        context.prec = 50
        reference = format(bar.close.normalize(), "f")
    identity = f"{RULE_VERSION}|{model_id}|SOLUSDT|{bar.close_us}|{reference}"
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]


def generate_events(sol4h: Iterable[Bar], btc4h: Iterable[Bar], model_id: str) -> Iterator[ResearchEvent]:
    """Emit chronological entry/trail/exit events after each closed SOL four-hour bar.

Both streams must consist of complete, contiguous UTC-aligned four-hour bars.
BTC updates are applied only while its close timestamp is at or before SOL's.
Equal-time BTC context is required; a hole fails the run rather than silently
turning an unknown regime into a signal. Indicator warmup itself may be absent.
"""
    if model_id not in MODELS:
        raise ValueError(f"unknown locked mechanism: {model_id}")
    sol_closes: deque[Decimal] = deque(maxlen=60)
    btc_closes: deque[Decimal] = deque(maxlen=60)
    prior_twenty: deque[Decimal] = deque(maxlen=20)
    atr = WilderATR()
    btc_iter = iter(btc4h)
    btc_next = next(btc_iter, None)
    last_sol: Bar | None = None
    last_btc: Bar | None = None
    joint_regime = False
    episode_id: str | None = None
    episode_stop: Decimal | None = None
    episode_hurdle: Decimal | None = None
    in_excursion = False

    for bar in sol4h:
        _validate_bar(bar, last_sol, "SOLUSDT")
        last_sol = bar
        while btc_next is not None and btc_next.close_us <= bar.close_us:
            _validate_bar(btc_next, last_btc, "BTCUSDT")
            last_btc = btc_next
            btc_closes.append(btc_next.close)
            btc_next = next(btc_iter, None)
        if last_btc is None or last_btc.close_us != bar.close_us:
            raise ValueError("BTCUSDT: missing aligned closed4h context")
        sol_closes.append(bar.close)
        value = atr.push(bar)
        at_us = bar.close_us + 1
        with localcontext() as context:
            context.prec = 50
            proposed_stop = floor_tick(bar.close - D(2) * value) if value is not None else None
            hurdle = floor_tick(bar.close + D(4) * value) if value is not None else None

        if model_id == "trend4h":
            ready = len(sol_closes) == 60 and len(btc_closes) == 60 and value is not None
            now_on = bool(ready and _mean(tuple(sol_closes)[-20:]) > _mean(sol_closes)
                          and _mean(tuple(btc_closes)[-20:]) > _mean(btc_closes))
            if now_on and not joint_regime:
                episode_id = _setup_id(model_id, bar)
                episode_stop, episode_hurdle = proposed_stop, hurdle
                yield ResearchEvent(model_id, episode_id, at_us, "ENTRY", bar.close,
                                    episode_stop, None, episode_hurdle, reason="JOINT_REGIME_ON")
            elif now_on:
                episode_stop = max(episode_stop, proposed_stop)
                yield ResearchEvent(model_id, episode_id, at_us, "TRAIL_UPDATE", bar.close,
                                    episode_stop, None, episode_hurdle, reason="CLOSED4H_TRAIL")
            elif joint_regime:
                yield ResearchEvent(model_id, episode_id, at_us, "REGIME_EXIT", bar.close,
                                    episode_stop, None, episode_hurdle, reason="JOINT_REGIME_OFF")
                episode_id = episode_stop = episode_hurdle = None
            joint_regime = now_on
        elif len(prior_twenty) == 20 and value is not None:
            mean, lower = _lower_band(prior_twenty)
            below = bar.close < lower
            if below and not in_excursion:
                ready = len(btc_closes) == 60
                context_ok = ready and last_btc.close >= _mean(btc_closes)
                reason = ("BTC_CONTEXT_WARMUP_MISSING" if not ready else
                          "BTC_CONTEXT_BELOW_SMA60" if not context_ok else "DOWNSIDE_EXCURSION")
                target = floor_tick(mean)
                yield ResearchEvent(model_id, _setup_id(model_id, bar), at_us, "ENTRY", bar.close,
                                    proposed_stop, target, target, context_ok, reason)
            in_excursion = below
        prior_twenty.append(bar.close)
