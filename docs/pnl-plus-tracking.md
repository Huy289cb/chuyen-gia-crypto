# PnL+ Tracking

**Cập nhật:** 2026-06-04 (live VPS)  
**Roadmap chi tiết:** [pnl-plus-roadmap.md](./pnl-plus-roadmap.md) · **P0:** [pnl-plus-p0-plan.md](./pnl-plus-p0-plan.md)

---

## Snapshot (2026-06-04, post-phantom-fix)

Nguồn: `GET http://127.0.0.1:3000/api/account/balance?symbol=BTC`, `npm run testnet:reconcile-wallet`, `npm run testnet:reconcile-position-pnl -- --dry-run`, PostgreSQL `testnet_positions`.

| Metric | Giá trị | Ghi chú |
|--------|---------|---------|
| `starting_balance` | $5,000 | Baseline testnet |
| `totalBalance` / wallet | $4,965.73 | Khớp Binance sau wallet-reconcile |
| **walletPnl** | **−$34.27** | `totalBalance − starting` — **số đo chính** |
| `binanceRealizedPnl` (income) | −$21.06 | REALIZED_PNL từ income API |
| `dbPositionPnlSum` | **−$23.09** | Σ `realized_pnl` closed (post-phantom zero) |
| **dbPositionPnlGap** | **−$11.18** (abs **$11.18**) | wallet − DB sum (wallet **lỗ nặng hơn** DB sum) |
| `dbPositionPnlTrusted` | **false** | Ngưỡng ±$5; gap còn ≈ phí **$13.06** + funding **$0.15** vs fill-sum |
| Wallet ↔ Binance income | ✅ ~0 | `wallet-reconcile` `gapAfterFix` ≈ 0 |
| Closed positions (BTC) | 24 | 0 open |
| `trade_outcomes` | 23 | Reflection có data; edge chưa đủ tin |
| Position reconcile (live 2026-06-04) | 23 scanned, **19 verified**, **4 skipped** (`no_close_fills`) | 3 merged phantom `realized_pnl=0` + `;phantom_no_close_fill_pnl_zeroed` |

**Quy tắc đo (giữ nguyên):** Đánh giá PnL bằng **walletPnl** + Binance income. Không dùng win-rate DB / sum position cho quyết định strategy.

---

## Checklist — điểm còn cần cải thiện

Ưu tiên: P0 = critical path · Owner mặc định **dev** nếu không ghi.

### 1. Measurement (wallet vs DB, fill proof)

| # | Hạng mục | Status | Priority | Ghi chú |
|---|----------|--------|----------|---------|
| M1 | Wallet ↔ Binance baseline | ✅ Done | P0 | `testnet:reconcile-wallet`; gap ≈ 0 |
| M2 | API/Telegram **wallet-first** (`walletPnl`, `dbPositionPnlTrusted`) | ✅ Done (VPS API) | P0 | PM2 đã trả field; xem `account-summary.service.ts` |
| M3 | Dashboard UI wallet-first | ⏳ Pending | P1 | `TestnetBalancePanel.tsx` **chưa push Vercel** (local uncommitted) |
| M4 | `dbPositionPnlTrusted` = true | ⏳ Pending | P0 | abs gap **$11.18** — cần **account-summary fee-aware gap** hoặc nâng ngưỡng (xem §5 P3); **không implement** trừ one-liner đã có sẵn |
| M5 | Fill-verified closes ≥95% | 🔄 In progress | P0 | **~83%** (19/23); 4 `no_close_fills` (3 merged + 1 recon-not-on-binance) |
| M6 | `posSum` vs `binanceRealized` <5% | 🔄 In progress | P1 | Post-phantom: −$23.09 vs income −$21.06 (~10%); gap wallet còn phí/funding |

**Lệnh đo:**

```bash
curl -sS "http://127.0.0.1:3000/api/account/balance?symbol=BTC" | jq '.data | {walletPnl, dbPositionPnlSum, dbPositionPnlGap, dbPositionPnlTrusted}'
cd backend && npm run testnet:reconcile-wallet
npm run testnet:reconcile-position-pnl -- --dry-run
```

---

### 2. Close path / taxonomy (P2)

| # | Hạng mục | Status | Priority | Ghi chú |
|---|----------|--------|----------|---------|
| C1 | `binance-fill-pnl` → `closeLocalPosition` | ✅ Done | P0 | P1.5.1 |
| C2 | `close-reason-resolve.service.ts` (SL/TP/market taxonomy) | 🔄 In progress | P0 | **Local uncommitted**; DB vẫn 0× `binance_sl`/`binance_tp` |
| C3 | `reconciliation_fill` + userTrades backfill | ✅ Done | P0 | 19/24 closes; script `testnet:reconcile-position-pnl` |
| C4 | Income-attributed close (P2.2) | ⏳ Pending | P1 | Gap wallet vs fill-sum vẫn ~$11 sau khi bỏ phantom |
| C5 | WS ORDER_TRADE_UPDATE qty sync (P2.3) | ⏳ Pending | P1 | |
| C6 | Pending E2E / modify limit / orphan limit (P2.4–2.6) | ⏳ Pending | P2 | Roadmap tuần 3 |

**Close reason DB (2026-06-04):**

| `close_reason` | Count | Σ PnL |
|----------------|-------|-------|
| `reconciliation_fill` | 19 | −$23.09 |
| `merged_into_pos_1780034477094_29zw45` | 3 | **$0** (zeroed post-fix) |
| `reconciliation_closed_not_on_binance` | 1 | $0 |
| `pipeline_event_anchor` | 1 | $0 |

Realized PnL thật trên survivor: `pos_1780034477094_29zw45`.

---

### 3. Trading gates (playbook, TF, long/short)

| # | Hạng mục | Status | Priority | Ghi chú |
|---|----------|--------|----------|---------|
| T1 | P0 trend-only / range block | ✅ Done | P0 | `V3_ALLOWED_REGIMES=trend` — [v3-operations.md](./v3-operations.md) |
| T2 | HTF 1h guard | ✅ Done | P0 | `V3_REQUIRE_HTF_TREND=1h` |
| T3 | PositionMonitor reduce/exit off | ✅ Done | P0 | Chỉ emergency / exchange SL/TP |
| T4 | Protective orders fill-accurate (P1.6) | ✅ Done | P0 | Deploy 2026-06-04 |
| T5 | Dừng overtrade playbook/TF/side xấu | ⏳ Pending | P1 | **Config/evidence** — cần ≥30 verified closes (P4) |
| T6 | Cooldown từ Binance income (P3.2) | ⏳ Pending | P2 | Hiện cooldown theo DB path |

---

### 4. Frontend Vercel

| # | Hạng mục | Status | Priority |
|---|----------|--------|----------|
| F1 | Push `frontend/` wallet PnL panel | ⏳ Pending | P1 |

Files local (chưa commit): `TestnetBalancePanel.tsx`, `v3DashboardFetchers.ts`.

---

### 5. Phantom positions / backfill

| # | Hạng mục | Status | Priority | Ghi chú |
|---|----------|--------|----------|---------|
| P1 | `PHANTOM_REOPEN_ENABLED=false` | ✅ Done | P0 | |
| P2 | 3× `merged_into_pos_1780034477094_29zw45` | ✅ Done | P0 | Zeroed: `pos_1780006562752_eroczl`, `pos_1780006262766_pd75h5`, `pos_1779995133272_vk3ogv`; PnL trên `pos_1780034477094_29zw45` |
| P3 | `dbPositionPnlTrusted` (fee-aware gap) | ⏳ Pending | **P0** | abs gap $11.18 > $5 — next: account-summary trừ phí/funding khỏi gap **hoặc** nâng `PNL_DB_GAP_TRUST_USD`; document only |
| P4 | `reconciliation_reopened` logs | ✅ Done | P0 | Không thấy gần đây |

**Tiêu chí xong:** `dbPositionPnlGap` ≤ $5 → `dbPositionPnlTrusted: true` (còn ~$11 sau phantom fix).

---

### 6. P3 entry quality / P4 learning

| # | Hạng mục | Status | Priority |
|---|----------|--------|----------|
| L1 | HTF guard linh hoạt, exposure pre-check, R:R reject (P3) | ⏳ Pending | P2 |
| L2 | Reflection / auto-block playbook (P4) | 🚫 Blocked | — | Cần P2.1 + ≥30 verified closes |
| L3 | Telegram daily từ verified stats | 🔄 In progress | P1 | Wallet PnL ✅; verified stats ⏳ |

---

### 7. Operational

| # | Hạng mục | Status | Ghi chú |
|---|----------|--------|---------|
| O1 | `CONSECUTIVE_LOSS_COOLDOWN` / exposure % | ✅ P0 env | `.env.example` |
| O2 | Git: wallet-first backend + frontend | 🔄 In progress | **Uncommitted** trên VPS — deploy `DEPLOY_SKIP_PULL=1` sau review |
| O3 | Paper 7 ngày chỉ đo (roadmap tuần 3) | ⏳ Pending | Sau M4/M5 |

---

## Success criteria (4 tuần) — trạng thái

| Metric | Target | Hiện tại (2026-06-04) |
|--------|--------|------------------------|
| Wallet vs income net trading | <1% lệch | ✅ |
| % close có fill proof | ≥95% | 🔄 ~83% |
| `posSum` vs `binance_realized` | <5% lệch | 🔄 ~10% (sau bỏ phantom) |
| Monitor reduce/exit churn | 0 | ✅ (env off) |
| Phantom reopen | 0 | ✅ |
| `dbPositionPnlTrusted` | true | ❌ abs gap $11.18 (phantom ✅; fee-aware gap ⏳) |
| Strategy tune | ≥30 verified | 🚫 ~19 verified fills |

---

## Git / deploy (2026-06-04)

**Uncommitted (local, chưa push):**

- `backend`: `account-summary`, `position-close`, `position-pnl-reconcile`, `dashboard`, telegram, **`close-reason-resolve.service.ts`** (new)
- `frontend`: `TestnetBalancePanel`, `v3DashboardFetchers`

**Đã chạy trên VPS:** API balance trả `walletPnl` / `dbPositionPnlTrusted` (wallet-first đã live trên PM2).

---

## Tham chiếu nhanh

```bash
cd backend
npm run testnet:reconcile-wallet
npm run testnet:reconcile-wallet -- --cleanup-algo
npm run testnet:reconcile-position-pnl -- --dry-run
npm run testnet:backfill-pnl -- --dry-run
./scripts/deploy.sh   # sau khi commit; DEPLOY_SKIP_PULL=1 nếu deploy local
```
