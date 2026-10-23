from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True, slots=True)
class Bar:
    open_us: int
    close_us: int
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal
    quote_volume: Decimal
    trades: int = 0


MINUTE_US = 60_000_000
HOUR_US = 60 * MINUTE_US
DAY_US = 24 * HOUR_US
