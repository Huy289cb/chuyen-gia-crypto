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

def run_macro_tp(dates, symbols, prices, rebalance=3, stop=0.08, tp=0.15, alloc=28.0):
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

        # Check exits (SL and TP) at observed close
        surviving = []
        for symbol, entry, qty in held:
            if symbol not in today:
                surviving.append((symbol, entry, qty))
                continue
            close = today[symbol]
            ret = (close - entry) / entry
            if ret <= -stop or ret >= tp:
                exit_price = close
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
    print("Testing Take-Profit + Strict Observed Close:")
    print("-" * 80)
    for a in [24.0, 25.0, 26.0, 28.0, 30.0]:
        for r in [2, 3]:
            for sl in [0.06, 0.08, 0.10]:
                for tp in [0.10, 0.15, 0.20]:
                    res = run_macro_tp(dates, symbols, prices, rebalance=r, stop=sl, tp=tp, alloc=a)
                    if res['breaches'] == 0 and res['mean'] >= 0.14:
                        print(f"Alloc=${a}x2 | Reb={r}d | SL={sl*100:.0f}% | TP={tp*100:.0f}% => Net=+{res['net']:5.1f}u | Mean=+{res['mean']:.4f}u/d (+{res['mean']*365:5.1f}%/yr) | Worst={res['worst']:6.2f}u | Breaches={res['breaches']}")

if __name__ == "__main__":
    main()
