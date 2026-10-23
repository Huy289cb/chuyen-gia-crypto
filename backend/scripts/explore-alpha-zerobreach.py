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

def run_test(dates, symbols, prices, lookback=14, rebalance=2, stop=0.10, alloc=25.0, btc_filter_period=0, n_coins=2):
    cash = 100.0
    held = []
    since = 0
    metrics = []

    def equity(px):
        unrealized = 0.0
        for symbol, entry, qty in held:
            unrealized += (px.get(symbol, entry) - entry) * qty
        return cash + unrealized

    start_idx = max(55, lookback + 5, btc_filter_period + 5)
    for index in range(start_idx, len(prices)):
        today = prices[index]
        start = equity(prices[index - 1])

        # Regime filter:
        bullish = True
        if btc_filter_period > 0:
            btc_past = [prices[index - k].get("BTCUSDT", 0) for k in range(btc_filter_period)]
            btc_sma = sum(btc_past) / btc_filter_period if btc_past and all(p > 0 for p in btc_past) else 0
            bullish = today.get("BTCUSDT", 0) >= btc_sma

        # Check exits at observed close (NO PHANTOM)
        surviving = []
        for symbol, entry, qty in held:
            if symbol not in today:
                surviving.append((symbol, entry, qty))
                continue
            close = today[symbol]
            ret = (close - entry) / entry
            if ret <= -stop:
                exit_price = close
                cash += (exit_price - entry) * qty - exit_price * qty * FEE
            else:
                surviving.append((symbol, entry, qty))
        held = surviving

        # Breaker check
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

            if not bullish:
                continue

            past = prices[index - lookback]
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
                if len(held) == n_coins:
                    break

    final = equity(prices[-1])
    net = final - 100.0
    return {
        "days": len(metrics),
        "net": net,
        "mean": net / len(metrics),
        "worst": min(metrics),
        "breaches": sum(1 for v in metrics if v <= -12.0),
    }

def main():
    dates, symbols, prices = load()
    print("Testing Multi-Coin Baskets (n_coins in [2, 3, 4]):")
    best = []
    for n in [2, 3, 4]:
        for alloc in [15.0, 18.0, 20.0, 22.0, 25.0]:
            total_exp = n * alloc
            if total_exp > 75.0:
                continue
            for lb in [7, 10, 14]:
                for reb in [1, 2, 3]:
                    for sl in [0.08, 0.10, 0.12]:
                        for btc in [0, 20, 50]:
                            res = run_test(dates, symbols, prices, lookback=lb, rebalance=reb, stop=sl, alloc=alloc, btc_filter_period=btc, n_coins=n)
                            if res["breaches"] == 0 and res["worst"] >= -12.0:
                                best.append((res["mean"], res, n, alloc, total_exp, lb, reb, sl, btc))

    best.sort(reverse=True)
    print(f"Total zero-breach configurations found: {len(best)}")
    for mean, res, n, alloc, total_exp, lb, reb, sl, btc in best[:25]:
        print(f"Top {n} coins (${alloc:.0f}x{n}=${total_exp:.0f}) | LB={lb:2d}d | Reb={reb}d | SL={sl*100:.0f}% | BTC_SMA={btc:2d}d => Net=+{res['net']:6.2f}u | Mean=+{res['mean']:.4f}u/d (+{res['mean']*365:5.1f}%/yr) | Worst={res['worst']:6.2f}u | Breaches={res['breaches']}")

if __name__ == "__main__":
    main()
