import csv
from pathlib import Path

CSV = Path(__file__).resolve().parents[1] / "tests/fixtures/cct-source-projection/daily-source.csv"
FEE = 0.0007

def load():
    with CSV.open() as handle:
        rows = list(csv.reader(handle))
    symbols = rows[0][1:]
    dates = []
    prices = []
    for row in rows[1:]:
        dates.append(row[0])
        day = {}
        for index, symbol in enumerate(symbols):
            raw = row[index + 1].strip()
            if raw:
                value = float(raw)
                if value > 0:
                    day[symbol] = value
        prices.append(day)
    return dates, symbols, prices

def run_macro(dates, symbols, prices, rebalance=3, stop=0.05, alloc=24.0):
    cash = 100.0
    held = []
    since = 0
    metrics = []

    def equity(px):
        unrealized = 0.0
        for symbol, entry, qty in held:
            unrealized += (px.get(symbol, entry) - entry) * qty
        return cash + unrealized

    for index in range(15, len(prices)):
        today = prices[index]
        start = equity(prices[index - 1])

        # Check Stop Loss on held positions (evaluated strictly at observed close)
        surviving = []
        for symbol, entry, qty in held:
            if symbol not in today:
                surviving.append((symbol, entry, qty))
                continue
            close = today[symbol]
            ret = (close - entry) / entry
            if ret <= -stop:
                exit_price = close # STRICT OBSERVED CLOSE FILL
                cash += (exit_price - entry) * qty - exit_price * qty * FEE
            else:
                surviving.append((symbol, entry, qty))
        held = surviving

        # Check Daily Breaker
        equity_now = equity(today)
        day_pnl = equity_now - start
        fired = day_pnl <= -12.0
        if fired:
            for symbol, entry, qty in held:
                exit_price = today.get(symbol, entry)
                cash += (exit_price - entry) * qty - exit_price * qty * FEE
            held = []
            equity_now = equity(today)
            day_pnl = equity_now - start

        metrics.append(day_pnl)

        since += 1
        if since >= rebalance and not fired:
            since = 0
            for symbol, entry, qty in held:
                exit_price = today.get(symbol, entry)
                cash += (exit_price - entry) * qty - exit_price * qty * FEE
            held = []

            past = prices[index - 14]
            scores = []
            for symbol in symbols:
                if symbol in today and symbol in past:
                    scores.append(((today[symbol] - past[symbol]) / past[symbol], symbol))
            scores.sort(reverse=True)

            for score, symbol in scores:
                if score <= 0.02:
                    break
                cash -= alloc * FEE
                held.append((symbol, today[symbol], alloc / today[symbol]))
                if len(held) == 2:
                    break

    final = equity(prices[-1])
    net = final - 100.0
    return {
        "days": len(metrics),
        "net": net,
        "mean": net / len(metrics),
        "worst": min(metrics),
        "breaches": sum(1 for value in metrics if value <= -12.0),
    }

def main():
    dates, symbols, prices = load()
    print("Zero-Breach Allocation Sweep under STRICT OBSERVED CLOSE (Cursor Rule):")
    print("-" * 85)
    for a in [20.0, 22.0, 24.0, 25.0, 28.0]:
        for r in [2, 3, 5]:
            for sl in [0.05, 0.08, 0.10, 0.12]:
                res = run_macro(dates, symbols, prices, rebalance=r, stop=sl, alloc=a)
                if res['breaches'] == 0:
                    print(f"Alloc=${a:2.0f}x2 (${a*2:2.0f}) | Reb={r}d | SL={sl*100:2.0f}% => Net=+{res['net']:5.1f}u | Mean=+{res['mean']:.4f}u/d (+{res['mean']*365:5.1f}%/yr) | Worst={res['worst']:6.2f}u | Breaches={res['breaches']}")

if __name__ == "__main__":
    main()
