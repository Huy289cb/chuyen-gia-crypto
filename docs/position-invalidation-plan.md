# Position Invalidation Management — Plan & Evaluation

**Date:** 2026-07-17  
**Status:** Phase A implemented (rule-based). Phase B deferred.  
**Context:** Long hold ~2.5d with +2.86% peak then SL (−$2.39) showed profit-protect gap (now shipped) **and** a second gap: MarketScan already sees regime/sweep/HTF while open, but nothing acts on “thesis broken.”

---

## 1. Problem statement

While a position is open, the live system historically:

1. Trusted **exchange SL/TP only** (`DEFER_TO_EXCHANGE_SLTP=true`).
2. Ran **MarketScan every 5m** (regime, liquidity sweep, breakout, HTF) — **entry gate only**.
3. Skipped new entries (`scale-in` off) — **does not manage the open book**.
4. Opposite flip only when a **new reverse entry** is attempted.

So a long can stay green for days while HTF flips / chop appears / adverse sweep prints — then give back all profit to the original SL.

Profit-protect (BE/trail) fixes “give-back when price alone is enough.”  
Invalidation management fixes “structure no longer supports the trade.”

---

## 2. What already exists (do not reinvent)

| Layer | Role | Open-position? |
|-------|------|----------------|
| Binance SL/TP | Hard exit | Yes |
| Profit-protect | BE @ 1R, trail @ +1.5%/0.8%, time-stop BE @ 24h | Yes |
| PositionMonitor | Mark + profit-protect + health (mostly HOLD) | Yes |
| Protective audit / lifecycle guard | Anti-race emergency close | Yes |
| Opposite flip | Groq close opposite **at new entry** | Indirect |
| Pending LLM review | Unfilled limits only | No |
| MarketScan + SignalGate | Regime / sweep / breakout / HTF | **Signals yes, consumer no** |
| Legacy `position_decisions` / `ai-position-management.md` | Kim Nghĩa-era LLM manage | **Not wired in v3** |
| `position-management.service` stub | Dead code | No |

---

## 3. Options evaluated

### Option X — Separate LLM “position manager” process

**Idea:** Cron + Groq every N minutes: `hold|exit|partial|reverse`.

| Pros | Cons |
|------|------|
| Flexible narrative reasoning | Second “brain” fights trail/BE |
| Matches legacy docs | Cost, latency, flip-flop on ~45U wallet |
| | Race with protective/audit (already burned money once) |
| | Hard to test / attribute PnL |

**Verdict: No** for now. Revisit only as Phase B referee after rules prove stable.

### Option Y — Extend PositionMonitor with rule invalidation (recommended)

**Idea:** Reuse `getScanResult` cache. Pure rules → primarily **tighten SL to BE** when green + adverse structure. No new scheduler. No LLM in Phase A.

| Pros | Cons |
|------|------|
| Same loop as profit-protect | Rules can false-trigger chop |
| Cheap, deterministic, testable | Cannot “understand” subtle narrative |
| No naked window if amend pattern reused | When red, cannot safely place BE (SL past mark) |
| Aligns with ponytail / YAGNI | |

**Verdict: Yes — Phase A.**

### Option Z — Enable `ALLOW_EXIT` / health reduce globally

Health analyzer only exits on **loss near SL**, not on adverse structure while green. Enabling flags alone **does not** solve the green-then-SL case.

**Verdict: Not sufficient.**

---

## 4. Recommended architecture

```
MarketScan (*/5) ──► in-memory scanResults
                         │
PositionMonitor (*/1)
  1. mark refresh
  2. profit-protect (price-based BE/trail)     [done]
  3. invalidation rules (structure-based)     [Phase A]
       └─ if action=tighten_be & green → amend SL to entry
  4. health / unhedged emergency              [existing]
```

**Single pipeline.** No parallel manager process.

### Action policy (Phase A — conservative)

| Evidence | uPnL | Action |
|----------|------|--------|
| Adverse structure (see §5) | **> 0** | `tighten_be` — SL → entry (if tighter) |
| Adverse structure | ≤ 0 | `hold` — log only (cannot place BE without instant stop) |
| No evidence | any | `hold` |

**Explicitly out of Phase A:** market exit, reverse, partial fill, LLM.

### Phase B (deferred)

LLM referee only when Phase A scores `review` (e.g. ≥2 signals, still red, age high):  
`hold | tighten_be | exit`, conf ≥ threshold, ≤1 call / position / 30–60m.  
Flag: `INVALIDATION_LLM_REFEREE=true` (default off).

### Phase C (not planned)

Full reverse-on-signal; independent AI manager cron; restore legacy `position_decisions` wholesale.

---

## 5. Phase A signal definitions

Inputs: open position `{side, entry, mark, age}` + scan snapshots `1h` (primary) and `15m` (secondary).

| Signal ID | Condition | Weight |
|-----------|-----------|--------|
| `htf_chop` | 1h regime = `chop` | 2 |
| `htf_trend_against` | 1h regime = `trend` AND `trendDirection` against side (long↔bearish, short↔bullish) | 2 |
| `htf_lost_trend` | 1h regime ∈ {`range`,`chop`} AND age ≥ `INVALIDATION_HTF_LOST_MIN_HOURS` (default 6h) AND uPnL% < 0.5× initial risk % | 1 |
| `adverse_sweep` | Liquidity sweep grade A/B **against** side: long + `highSweep`, short + `lowSweep` (1h or 15m) | 2 |
| `adverse_breakout` | Breakout playbook grade A/B with close direction against side (if metrics expose side; else skip) | 1 |

**Fire `tighten_be` when** total weight ≥ `INVALIDATION_MIN_SCORE` (default **2**) AND uPnL > 0 AND age ≥ min minutes.

Cooldown: score 2 = one strong signal (chop / against-trend / adverse A-sweep) or two soft signals.

---

## 6. Interaction with profit-protect

| Concern | Rule |
|---------|------|
| Order of ops | Profit-protect **first**, invalidation **second** (can only tighten further) |
| Never loosen | Same as profit-protect: candidate SL must be tighter |
| Duplicate amend | Shared `amendProtectiveStopLoss`; min move % shared |
| Cooldown | `INVALIDATION_COOLDOWN_MS` (default 15m) per position after successful amend |
| Logging | Event `position_invalidation` + console `[Invalidation]` |

---

## 7. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| False chop → premature BE | Min score 2; BE only when green; trail still manages if price continues |
| BE when barely green → scratched by noise | `INVALIDATION_MIN_UPNL_PCT` (default 0.15%) |
| Race naked exposure | Place new SL before cancel old (same as profit-protect) |
| Stale scan cache | Use latest `getScanResult`; if missing 1h snapshot → no HTF signals |
| Fight with user mental model | Flag `INVALIDATION_ENABLED` (default **true** after ship; set false to kill) |
| Over-tighten kills R:R winners | Phase A never market-exits; TP remains; only locks BE |

---

## 8. Success metrics (2 weeks)

- Count of `tighten_be` events vs later outcomes (win/BE/loss).
- No increase in emergency `ProtectiveExposureAudit closed=1` races.
- Fewer “peak green multi-day → full SL” events on similar setups.
- OpenRouter cost unchanged (Phase A = 0 LLM).

---

## 9. Implementation checklist

### Phase A (this change)

- [x] Docs: this plan
- [x] `config/position-invalidation-policy.ts`
- [x] `utils/position-invalidation.ts` (pure score)
- [x] Shared SL amend helper used by profit-protect + invalidation
- [x] Wire after profit-protect in `position-monitor.scheduler.ts`
- [x] Unit tests
- [x] `.env` / `.env.example` knobs
- [ ] Observe live logs `[Invalidation]` for 1–2 weeks

### Phase B (deferred)

- [x] Rule market exit when red + score≥min (`INVALIDATION_ALLOW_EXIT`, no LLM)
- [ ] `review` score band + LLM referee service
- [ ] Dashboard event surface (partial: exit event in live feed)

### Explicit non-goals

- Separate PM2 process / agent for position management  
- Restoring full legacy `position_decisions` path without gates  
- Partial TP in Phase A  

---

## 10. Decision

| Question | Answer |
|----------|--------|
| Need abnormal-market reaction while open? | **Yes** |
| Separate LLM manager now? | **No** |
| Implement rule invalidation in monitor? | **Yes (Phase A)** |
| Default action | **Tighten BE when green + score≥2** |
| Replace profit-protect? | **No — complement** |

Legacy doc [`ai-position-management.md`](./ai-position-management.md) describes Kim Nghĩa-era LLM arrays; **v3 source of truth for open-position policy is this document + profit-protect**.
