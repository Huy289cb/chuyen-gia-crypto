# Testnet PnL backfill

Repairs historical rows where positions were closed without `close_price`, `realized_pnl`, or `trade_outcomes` (e.g. old `reconciliation_closed_not_on_binance` or `merged_into_*` paths).

## When to run

- After deploying `closeLocalPosition` / merge PnL fixes.
- When dashboard shows `trade_outcomes = 0` but wallet moved on Binance Demo.
- Safe to re-run: skips rows that already have `|realized_pnl| > 0.01` and valid `close_price`.

## What it does

1. Finds `testnet_positions` with `status = closed` missing PnL/price (excludes pipeline anchor `pipeline_v3_kim_nghia` and zero-size rows).
2. Sets `close_price` from existing `close_price` → `current_price` → `entry_price`.
3. Computes `realized_pnl` from entry/close/qty/side.
4. Calls `recordTradeOutcomeOnClose` (links `decision_id` via pending pipeline events when possible).
5. Recomputes `testnet_accounts` stats (`total_trades`, wins/losses, `realized_pnl` sum).
6. Syncs wallet/equity from Binance when `BINANCE_ENABLED=true`.

## Limitations

- **Estimated close** for old reconciliation closes — not Binance fill history (no income API wired yet).
- Sum of position PnL may **differ slightly** from wallet delta (fees, funding, partial fills).
- Wallet balance after run is synced from Binance; `account.realized_pnl` is sum of backfilled rows.

## Commands

```bash
cd backend

# Preview only
npm run testnet:backfill-pnl -- --dry-run

# Apply
npm run testnet:backfill-pnl
```

Optional env:

```env
BACKFILL_SYMBOL=BTC
BACKFILL_METHOD_ID=kim_nghia
```

## Verify

```bash
cd backend && node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const outcomes = await p.tradeOutcome.count();
  const nullClose = await p.testnetPosition.count({ where: { status: 'closed', close_price: null } });
  const acct = await p.testnetAccount.findFirst({ where: { symbol: 'BTC', method_id: 'kim_nghia' } });
  console.log({ outcomes, nullClose, trades: acct?.total_trades, realized: acct?.realized_pnl, balance: acct?.current_balance });
  await p.\$disconnect();
})();
"
```

## Merge PnL (runtime fix)

Duplicate open rows consolidated into one primary now call `closeDuplicateForMerge()` → full `closeLocalPosition()` (PnL + outcome) instead of only setting `status: closed`.

Module: `position-close.service.ts` (`closeDuplicateForMerge`), used from `binance-reconciliation.ts`.

Close reason on merged duplicates: `merged_into_<primary_position_id>`.

## Exclusions

Backfill **never** touches:

- `pipeline_v3_kim_nghia` (`PIPELINE_EVENT_POSITION_ID`) — pipeline event anchor, not a trade
- Rows with `size_qty` ≤ 0

If an older backfill run included the pipeline row by mistake:

```bash
cd backend && npm run testnet:fix-pipeline-backfill
```

This deletes a bogus `trade_outcome` (`decision_id=1`, `close_reason=backfill_pnl`, `realized_pnl=0`), resets the anchor row, and recomputes account stats.
