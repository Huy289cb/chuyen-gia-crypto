# Overnight V3 Run Review — 2026-05-20 → 2026-05-21 (UTC)

**Review window:** `2026-05-20T00:00:00Z` through `2026-05-21T02:00:00Z` (log tail at review time)  
**Evidence sources:** PM2 (`crypto-api`, `crypto-worker` v1.2.37), `backend/logs/*.log`, Neon Postgres (Prisma), live `http://127.0.0.1:3000/api/*`, Vercel proxy spot-check  
**Stable V3 worker period:** last deploy restart cluster around `2026-05-20T14:53:27Z`; PM2 uptime ~11h at review  

---

## 1. Executive summary

Overnight, the V3 worker **ran continuously** on schedule: MarketScan every ~5 minutes, LLMDispatch every 15 minutes, PositionMonitor every minute. The market was predominantly **Grade D / blocked**; a short burst of **PASS** signals on 15m/1h led to **four Groq validations (all succeeded)** and **two real Binance testnet fills** (short 22:32 UTC, long 01:32 UTC). A third LLM trade at 01:47 UTC **failed at Binance** (`-4003` quantity ≤ 0) because sizing normalized to zero while a long was already open.

**Signal Gate** blocked LLM on most cycles (expected). **No duplicate-cache log lines** appeared overnight; historical duplicate `no_trade` rows in DB (17) are **legacy**, not from last night. **No overnight duplicate spam** in `trade_decisions` (only 5 rows since May 20).

**PositionMonitor** was active; it managed the short (partial reduces, then full exit at 00:05 UTC) but hit **~90 minutes of Binance `-1111` precision errors** on reduce/close attempts before a successful close. One **long remains open**; monitor reports healthy.

**Dashboard** is mostly aligned with DB/logs for account, warmup, live signal gate, LLM today, and events. Gaps: **stale no-trade reason aggregates**, **PositionMonitor scheduler status uses DB fallback not real cron runs**, **orders panel empty by design** (only `pending`), **synthetic pipeline row in trades**, **`candle_hash` never populated**.

**Verdict: PARTIAL** — pipelines and Groq work; execution sizing/precision and dashboard scheduler/no-trade aggregates need fixes.

---

## 2. Overnight scheduler summary

| Pipeline | Cron (configured) | Ran overnight? | Outcome |
|----------|-------------------|----------------|---------|
| **MarketScan** | `*/5 * * * *` | **Yes** — 364 starts in logs (May 20–21) | ~933 TF evaluations; **mostly BLOCK (Grade D)**; **16 PASS** (9×15m, 7×1h); 0×4h PASS |
| **LLMDispatch** | `2,17,32,47 * * * *` | **Yes** — 103 starts | **~304 signal-gate skips**; **5 Groq validations (all passed)**; **2 risk no_trade**; **2 Binance fills**; **1 Binance fail (-4003)** |
| **PositionMonitor** | `*/1 * * * *` | **Yes** — every minute | **1436×** “0 open”; **121×** “1 open”; short managed then closed; long monitored |
| **Price sync** | 30s | Yes | Regular `[WorkerScheduler] Price sync completed for BTC` |
| **Snapshot** | `*/5 * * * *` | Yes | e.g. `23:55:02 Snapshot job completed` |
| **Prediction validation** | `0 * * * *` | Yes | Hourly, 0 expired updated |
| **Maintenance** | `0 3 * * *` | Not in window tail | — |

**Blocked vs ran:** MarketScan always *ran* but **blocked** low-grade setups. LLMDispatch *ran* but **skipped Groq** when in-memory scan result failed gate. PositionMonitor *ran* always; meaningful actions only when positions existed.

**Deploy restarts (May 20):** Worker scheduler restarted at 05:03, 05:20, 05:29, 05:35, 05:39, 05:48, 08:41, 09:19, 13:14, 14:14, 14:45, **14:53** (current stable boot). Brief Prisma errors at **05:00–05:19** during restart churn.

---

## 3. Log evidence

### 3.1 PM2 / process health

```
crypto-api     online  pid 409807  uptime ~11h  restarts 10  mem ~43MB
crypto-worker  online  pid 409796  uptime ~11h  restarts 13  mem ~57MB
```

- No scheduler lines in `api-out.log` for May 20–21 (API does not run V3 crons — correct split).
- All pipeline evidence is in `worker-out.log` / `worker-error.log`.

### 3.2 MarketScan

- Typical cycle: fetch 100 candles × (15m, 1h, 4h) from Binance → evaluate → **BLOCK — Grade D below minimum B**.
- **PASS examples (log):**
  - `2026-05-20T22:30:53` BTC 15m PASS
  - `2026-05-21T01:20:55` – `01:55:57` BTC 1h PASS (cluster before LLM trades)
- **Duplicate scan behavior:** 8 log lines with `(duplicate)` or `kept prior fresh signal for LLM (same bar)` — intentional merge, not errors.
- **0** `[SignalGate] Duplicate signal detected` lines overnight (in-memory gate cache not logged as hit, or not triggered).

### 3.3 Signal Gate → LLMDispatch

- Dominant log: `[LLMDispatch] BTC {tf}: Signal gate blocked, skipping` (~304 lines).
- Gate did **not** persist decisions overnight (`trade_decisions` with `Signal gate:` since May 20 = **0**).

### 3.4 Groq / LLMDispatch

| Time (UTC) | TF | Groq | Outcome |
|------------|-----|------|---------|
| 05:32:03 | 15m | ✅ `Successfully validated response` | NO_TRADE — risk SL 0.32% < min 0.50% |
| 14:02:02 | 15m | ✅ | NO_TRADE — risk SL 0.22% < min 0.50% |
| 22:32:02 | 15m | ✅ | TRADE sell 85% → Binance order `13169982603` |
| 01:32:02 | 1h | ✅ | TRADE buy 85% → Binance order `13170553523` |
| 01:47:02 | 1h | ✅ | TRADE buy 85% → **FAILED** qty `0.000097… → 0` (stepSize 0.0001) |

- **Groq JSON/shape failures overnight:** **0** in logs (`invalidJsonCount` today = 0).
- Historical `LLM: invalid JSON or failed validation after retries` ×10 in DB — **not from last night**.

### 3.5 PositionMonitor

- **22:33** — Found 1 short; WARNING reduce 50% (`qty 0.0129`).
- **22:34 – 00:04** — Repeated `Binance API Error -1111: Precision is over the maximum` on MARKET CLOSE/reduce (**~90+ error lines** in `worker-error.log`).
- **00:05:02** — Successful close: `MARKET ORDER PLACED … qty=0.0129` → `position_monitor_exit` PnL **-2.74**.
- **01:47** — Long HEALTHY, hold.
- **22:32:24** — `[BinanceReconciliation] quantity mismatch: local=0.0258, binance=-0.0129` after partial reduce.

### 3.6 Errors / spam

| Issue | Count (May 20–21) | Severity |
|-------|-------------------|----------|
| Prisma connection (restart window) | 2 bursts ~05:00, 05:19 | Transient |
| Binance -1111 precision | ~90+ | **High** during short management |
| Binance -4003 qty ≤ 0 | 1 (01:47) | **High** — blocked second long |
| Telegram ETIMEDOUT | 1 | Low |
| Log spam | PositionMonitor WARNING/reduce every minute while short stressed | Noisy, not DB spam |

---

## 4. Database evidence

### 4.1 Row counts

| Table | Total | Since 2026-05-20 |
|-------|-------|------------------|
| `ohlcv_candles` | 21,849 | **+3,257** |
| `testnet_accounts` | 1 | — |
| `testnet_positions` | 4 | **+3** (incl. synthetic anchor) |
| `testnet_pending_orders` | 4 | **+2** (both `executed`) |
| `testnet_trade_events` | 8 | **+6** |
| `trade_decisions` | 47 | **+5** |
| `trade_outcomes` | 0 | 0 |
| `trade_reflections` | 0 | 0 |
| `testnet_account_snapshots` | 999 | **+309** |

### 4.2 Testnet account (id=1, `kim_nghia`)

- **Initialized:** yes  
- `starting_balance` 10000.01 → `current_balance` / `equity` **4984.44**  
- `total_trades` **2** (matches two overnight executions)  
- `consecutive_losses` **2**, `cooldown_until` null (API risk: unlocked)

### 4.3 Positions / orders (overnight-relevant)

| position_id | Side | Status | Entry | Close | Reason |
|-------------|------|--------|-------|-------|--------|
| `pos_1779316326511_co5lgr` | short | closed | 77428.7 | 77640.83 | position_monitor_exit |
| `pos_1779327124730_jtrnad` | long | **open** | 77828.7 | — | — |
| `pipeline_v3_kim_nghia` | NONE | closed | 0 | — | synthetic event anchor |

**Pending orders:** both overnight orders `executed`; **0** rows with `status=pending` → API `/account/orders` correctly returns `[]` for “active” filter.

### 4.4 Trade decisions (since May 20)

| decision | grade | count |
|----------|-------|-------|
| trade | A | 3 |
| no_trade | A | 2 |

- **No overnight `Signal gate:` rows persisted.**
- **`candle_hash`:** 47/47 rows **NULL** — dedup not stored.
- **Duplicate groups (May 20+):** 1h `trade` ×2 (01:32 + 01:47 same session); 15m `no_trade` ×2 — not mass spam, but **repeat LLM rows without hash dedup**.

### 4.5 Trade events (overnight)

- `entry_order_filled` ×2  
- `position_closed` ×1 (short)  
- `execution_blocked` ×3 (2× risk pre-exec, 1× Binance -4003)

---

## 5. API evidence

Live checks at review time (`127.0.0.1:3000`):

| Endpoint | Matches logs/DB? | Notes |
|----------|------------------|-------|
| `/api/dashboard/system` | ✅ | worker healthy, DB healthy, unlocked |
| `/api/dashboard/schedulers` | ⚠️ Partial | Last runs use **DB fallbacks** (candle/decision/event), not worker in-memory heartbeat |
| `/api/dashboard/warmup` | ✅ | 21,852 candles, warmed |
| `/api/dashboard/signals` | ✅ | Live Grade D BLOCK aligns with logs |
| `/api/dashboard/no-trade-reasons` | ❌ Stale | Top reason “Duplicate signal” ×17 — **historical** last-100 `no_trade`, **0** since May 20 |
| `/api/dashboard/risk` | ✅ | streak 2, daily loss ~2.74, unlocked |
| `/api/dashboard/llm` | ✅ | `callsToday: 2`, last 01:47, `invalidJsonCount: 0`, lastEngaged shows -4003 block |
| `/api/dashboard/memory` | ⚠️ | Shows 3 PENDING trades; playbook `unknown` |
| `/api/account/balance` | ✅ | initialized, ~4984 equity |
| `/api/account/positions` | ✅ | 1 open long matches DB |
| `/api/account/orders` | ✅ (semantic) | Empty — no **pending** orders in DB |
| `/api/account/trades` | ⚠️ | Includes synthetic `pipeline_v3_kim_nghia` row |
| `/api/market/candles` | ✅ | Binance-sourced latest candle |
| `/api/dashboard/events` | ✅ | Matches `trade_decisions` + `testnet_trade_events` |

Vercel proxy (`download-money-moi.vercel.app/api/dashboard/system`): ✅ same healthy payload.

---

## 6. Frontend evidence

- **Not browser-tested** in this review; inferred from API contracts used by dashboard.
- **Warmup:** should show warmed (API `isWarmedUp: true`) — truthful.
- **Signal gate:** live Grade D / block — **truthful** vs overnight PASS spikes on 1h only briefly.
- **LLM panel:** “2 calls today” — **truthful** for UTC day (decisions 46, 47); does not count 22:32 May 20 trade in “today”.
- **Account:** balance + 1 position — **truthful**; orders empty — **truthful** if UI labels “active/pending orders”.
- **Trades/history:** may show **pipeline anchor** row — **misleading**.
- **Event log:** recent events match DB; **no duplicate flood** overnight (5 decision-related + 6 testnet events since May 20).
- **Scheduler UI:** may show PositionMonitor **idle / 14m ago** while worker runs it **every minute** — **misleading** (see §9).

---

## 7. What worked

| Area | Status | Evidence |
|------|--------|----------|
| Worker uptime (post-14:53) | ✅ | 11h PM2, continuous cron logs |
| MarketScan + OHLCV ingest | ✅ | 364 scans; +3257 candles |
| Signal gate blocking low grade | ✅ | ~304 LLM skips; live API Grade D |
| Groq validation | ✅ | 5/5 `Successfully validated response` |
| Risk engine pre-block | ✅ | SL distance blocks at 05:32, 14:02; events `pre_execution` |
| Testnet execution (sized orders) | ✅ | Short + long entries on Binance |
| PositionMonitor close | ✅ | Short closed 00:05 despite prior -1111 |
| Event log / execution_blocked | ✅ | te-10 matches -4003 at 01:47 |
| Empty pending orders API | ✅ | DB has 0 pending |

---

## 8. What failed

| Issue | Subsystem | Symptom | Evidence | Fix priority |
|-------|-----------|---------|----------|--------------|
| **Second entry qty → 0** | `V3TradeExecution` / Binance sizing | 01:47 TRADE blocked | Log: `quantity 0.000097… -> 0 (stepSize: 0.0001)`; te-10 `-4003` | **Now** |
| **Close/reduce precision -1111** | `PositionMonitor` / `BinanceClient` | ~90 failed MARKET CLOSE | `worker-error.log` 22:34–00:04 | **Now** |
| **Stale no-trade dashboard** | `dashboard.ts` `/no-trade-reasons` | Shows duplicate ×17, invalid JSON ×10 | DB: 0 signal-gate rows since May 20; API still aggregates last 100 historical | Later |
| **Scheduler heartbeat split** | `scheduler-heartbeat.ts` + API | PositionMonitor “idle” while running | API uses `lastTradeEvent` fallback, not monitor cron | Later |

---

## 9. What was only partially working

| Area | Status | Detail |
|------|--------|--------|
| LLMDispatch | ⚠️ | Ran on schedule but **called Groq only 5×**; rest gated |
| Signal duplicate cache | ⚠️ | Code exists; **0 overnight log hits**; historical 17 DB dup reasons |
| Position partial reduce | ⚠️ | Logged reduces; Binance reconciliation mismatch; precision errors |
| Dashboard LLM “calls today” | ⚠️ | UTC-day scoped; misses May 20 22:32 trade in “today” |
| `trade_decisions` memory | ⚠️ | Only LLM-path persists; no gate rows; no `candle_hash` |
| `/account/trades` | ⚠️ | Mixes real closes with `pipeline_v3_kim_nghia` synthetic |

---

## 10. Root causes

1. **-4003 quantity ≤ 0:** After open long, second 1h TRADE computed size below `stepSize` (0.0001 BTC); normalization rounded to **0** — no guard before `LIMIT ORDER`.
2. **-1111 precision:** Partial-close quantities (e.g. 0.00645, 0.0129) not normalized to exchange `stepSize`/`tickSize` on MARKET CLOSE path in PositionMonitor.
3. **Stale no-trade reasons:** Endpoint aggregates last 100 `no_trade` rows **without time filter** — surfaces pre-May-20 duplicate/invalid-JSON rows.
4. **PositionMonitor scheduler display:** `crypto-api` never calls `recordSchedulerRun`; fallback timestamp tracks **last trade event**, not monitor tick → **false idle**.
5. **Duplicate decision rows (1h ×2):** Two Groq TRADE decisions 15m apart; `candle_hash` always null → no DB dedup.

---

## 11. Fixes needed

| # | Fix | When |
|---|-----|------|
| 1 | Reject/order-skip when normalized qty &lt; minQty before Binance call; block second same-side entry when position open | **Now** |
| 2 | Apply exchange precision to **all** PositionMonitor close/reduce quantities | **Now** |
| 3 | Filter `/no-trade-reasons` to last 24h or “since UTC midnight” | Later |
| 4 | Persist scheduler last-run to DB or Redis read by API | Later |
| 5 | Populate `candle_hash` on `trade_decisions`; dedupe LLM persist per bar | Later |
| 6 | Exclude `pipeline_v3_kim_nghia` from `/account/trades` | Later |

---

## 12. Remaining gaps

- **Unverified:** Live Vercel UI rendering (only API proxy checked).
- **trade_outcomes / reflections:** Empty — learning loop not recording closes.
- **Signal gate duplicate cache:** No overnight log proof of hit (may be working silently via scan merge).
- **4h PASS:** None overnight — only 15m/1h briefly passed.

---

## 13. Specific questions (A–F)

### A. Did MarketScan run overnight?

**Yes.** ~**364** starts (~every 5 min). **Mostly BLOCK** (Grade D / no A-B setup). **16 PASS** total (9×15m, 7×1h). Main block reason: **Grade D below minimum B**, regime range, no liquidity sweep / breakout.

### B. Did Signal Gate behave correctly?

**Mostly yes** for blocking; **mostly Grade D** on live API. **Duplicate cache:** 0 `[SignalGate] Duplicate signal detected` logs; 8 MarketScan “duplicate / kept prior” merges. **Incorrect persist:** **No** overnight gate `no_trade` rows; **no duplicate spam** (5 decisions since May 20). Dashboard duplicate ×17 is **historical aggregate**, not overnight behavior.

### C. Did LLMDispatch run? Groq?

**Yes — 103 cycles.** Groq engaged **5×**, **all validation passed**. **No invalid JSON overnight.** **2** risk no_trades, **2** successful Binance orders, **1** failed order (qty zero). **1 open long** from successful dispatch.

### D. Did PositionMonitor do anything meaningful?

**Yes** when positions existed: short reduce/exit (closed 00:05), long hold/healthy. **Idle 0-position minutes** are expected. **Not idle** during errors — actively attempted closes with -1111 until success.

### E. Did testnet account state advance?

**Yes.** Initialized; balance dropped ~50% (realized loss + open long margin); **2** counted trades; **1 open long**, **1 closed short** overnight; snapshots +309. Empty orders = **truthful** (all executed).

### F. Is the dashboard truthful?

| Panel | Verdict |
|-------|---------|
| System / warmup / live signals / balance / positions | ✅ Truthful |
| LLM today / events | ✅ Mostly truthful |
| No-trade reasons | ❌ Misleading (stale) |
| Scheduler PositionMonitor | ⚠️ Misleading idle |
| Orders empty | ✅ If labeled pending-only |
| Trades list | ⚠️ Synthetic row |

---

## 14. Final verdict

### **PARTIAL**

V3 overnight operation is **real and mostly healthy**: schedulers ran, gate blocked noise, Groq succeeded when called, testnet advanced with two fills and one open position. **Execution precision and post-entry sizing** failed in ways that leave risk and operator confusion. Dashboard **core account/market state is truthful**; **aggregates and scheduler idle state are not**.

### Top 5 remaining issues

1. **Binance -4003** — second 1h entry sized to zero while long open (`V3TradeExecution` / sizing).  
2. **Binance -1111** — PositionMonitor close/reduce precision (~90 failures before short closed).  
3. **Stale `/no-trade-reasons`** — historical duplicate/invalid JSON dominates UI.  
4. **PositionMonitor scheduler status** — API fallback hides per-minute activity.  
5. **`candle_hash` null + duplicate LLM decision rows** — memory/dedup not enforced on persist.

---

*Report generated from VPS evidence only; no code changes made.*
