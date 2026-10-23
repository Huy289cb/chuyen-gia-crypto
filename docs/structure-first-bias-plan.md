# Structure-First Bias Permission — Plan

**Date:** 2026-08-12
**Status:** Phase A+B implemented (code + env). Phase C deferred.
**Context:** Four longs into one multi-day downswing from HH ~65.5k → three full SLs + one scratch. Soft LLM “memory” did not change behavior. Prior patch ideas (only longer cooldown / same-side lock) treat symptoms.

---

## 1. Problem statement

The live V3 funnel is **inverted**:

1. LTF playbook (`breakout_volume` / `liquidity_sweep_reclaim`) fires on local setup.
2. LLM picks **side** (`buy` @ high conf).
3. Post-LLM gates are **directionally weak**:
   - `evaluateHtfSideAlign` **fail-opens** when HTF regime ≠ `trend` (typical stair-step dump = `range`).
   - `V3_REQUIRE_HTF_TREND` checks regime **label**, not direction.
   - Breakout regime bypass can promote LTF chop → `gateRegime=trend`.
4. No HH/HL vs LH/LL / BOS state. “Trend” ≈ SMA slope + stack on a short window — relief rallies re-label bullish and re-arm longs.
5. Memory / reflections are **prompt text only** — they do not disable sides or playbooks.

So the bot is repeatedly allowed to **long counter-structure**. That is a permission bug, not “market tricks” or bad luck.

### Evidence (Aug 2026 wave)

| Time (UTC) | Entry | Result | Note |
|------------|-------|--------|------|
| 08-08 | 65050 long | +0.06 scratch | Near local high |
| 09-09 | 65250 long | −1.68 SL | Chase higher |
| 08-11 | 64250 long | −1.57 SL | Late fill into dump |
| 08-12 | 64150 long | −1.55 SL | Instant fill, still counter-swing |

Swing high ~65483 (1h) → last ~63600 (−2.8%). Account after wave: ~$31.8, 12W/16L, `consL=3`.

Pending TTL 45m (shipped) correctly cancelled one dead limit — **does not** fix bias.

---

## 2. What already exists (reuse — do not reinvent)

| Piece | Path | Role |
|-------|------|------|
| Regime SMA/slope | `src/analyzers/market-regime.analyzer.ts` | `trendDirection` bullish/bearish — not swing structure |
| HTF side align | `src/config/v3-entry-policy.ts` → `evaluateHtfSideAlign` | Only hard directional gate today; fail-open on non-trend |
| HTF trend require | same | Regime label only |
| Playbooks | `setup-gate.analyzer.ts`, LS/BO analyzers | Local window; direction not bound to LLM side |
| Swing points | `src/utils/fibonacci.ts` → `detectSwingPoints` | **Unused by V3 entry** — seed for structure |
| Adverse structure (exit) | `src/utils/position-invalidation.ts` | Post-fill only |
| Expectancy circuit | `account-circuit.service.ts` | Account-level sum R kill — **not per-side** |
| Loss cooldowns | `pending-order-policy` / risk tiers | Timeouts; do not encode structure |
| Memory | `memory.service.ts` | Prompt context only |

**Absent today:** HH/HL/LH/LL classifier, BOS/CHOCH as code, playbook↔side match, per-side expectancy disable, pre-LLM structure permission.

---

## 3. Rejected / deprioritized approaches

| Approach | Why not primary |
|----------|-----------------|
| Longer `POST_LOSS` / consL hours only | Reactive; re-opens longs mid-downswing after N hours |
| “Better LLM reflections” | Already writing template lessons; next decision still `buy` |
| Anti-chase price alone | Helps one chase case; not wave bias |
| New ML / new deps | Violates ponytail; structure rules suffice |
| Separate LLM “bias manager” | Cost, flip-flop, fights hard gates |

Cooldowns remain **safety nets**, not the learning system.

---

## 4. Target architecture (structure-first)

```
OHLCV 4h/1h
    │
    ▼
Structure bias (bull | bear | transition)     ← HARD, pre-LLM
    │
    ├─ long forbidden / unclear → no_trade (no LLM burn)
    │
    ▼
Playbook must match allowed side
    │
    ▼
LLM confirms timing + levels only (not invent adverse side)
    │
    ▼
Existing RR / SL / pullback / funding gates
    │
    ▼
Execute
```

**Principle:** Bias permission is deterministic code. LLM is a confirmer inside an open door, not the door.

---

## 5. Implementation phases

### Phase A — Structure bias (core) — **do first**

**Goal:** Classify swing structure on HTF (default **4h**); block longs in `bear` / `transition`.

| Item | Detail |
|------|--------|
| Classifier | Pure fn: from swings (`detectSwingPoints` or equivalent) → last two swing highs/lows → `bull` (HH+HL) / `bear` (LH+LL) / `transition` |
| Permission | `bull` → long allowed (short optional/stricter); `bear` → short allowed, **long blocked**; `transition` → **flat** |
| Wire | Pre-LLM in signal-gate or early `groq-dispatch` (prefer pre-LLM). Also keep post-LLM assert. |
| Config | e.g. `V3_STRUCTURE_BIAS_ENABLED=true`, `V3_STRUCTURE_BIAS_TF=4h`, `V3_STRUCTURE_BIAS_LOOKBACK` |
| Tests | Unit: synthetic HH/HL vs LH/LL series; assert long blocked on bear |
| Would block wave? | **Yes** — all four longs while LH/LL from Aug 9 high |

### Phase B — Close existing gate holes — **same ship window as A if small**

| Item | Detail |
|------|--------|
| Side-align fail-closed | If HTF not `trend` **or** `trendDirection` null → **do not** auto-pass for entries (or require structure bias + SMA stack agree) |
| Playbook ↔ side | LLM `buy`/`sell` must match BO `direction` / LS `sweepType`; mismatch → `no_trade` |
| Breakout bypass | Grade A breakout may pass range; **structure still blocks wrong side** |
| Would block wave? | **Yes** — range fail-open + unconstrained LLM buy |

### Phase C — Real learning: per-side expectancy — **after A lives**

| Item | Detail |
|------|--------|
| Extend | `CIRCUIT_EXPECTANCY_*` → **per-side** sum R over window |
| Action | If long sum R < min → disable **long** until structure flips to `bull` (or cooldown hours) |
| Not | Blind “pause all trading 2h then long again” |
| Would block wave? | **Yes** after 2–3 −1R longs — locks side until structure flip |

---

## 6. Ship order

1. **A** (structure bias) — mandatory
2. **B** (fail-closed align + playbook side match + bypass siết) — strongly recommended with A
3. **C** (per-side expectancy) — after A proven in logs

Do **not** ship “same-side loss lock only” as the main fix; optional thin safety net later if needed.

---

## 7. Env sketch (names final at implement time)

```env
# Phase A
V3_STRUCTURE_BIAS_ENABLED=true
V3_STRUCTURE_BIAS_TF=4h
# V3_STRUCTURE_BIAS_LOOKBACK=...

# Phase B (tighten existing)
V3_REQUIRE_HTF_SIDE_ALIGN=true
V3_HTF_SIDE_ALIGN_FAIL_CLOSED=true   # range/chop veto only if structure is transition
V3_REQUIRE_PLAYBOOK_SIDE_MATCH=true  # new
V3_BREAKOUT_REGIME_BYPASS=true       # Grade A breakout; structure gates side

# Phase C
CIRCUIT_EXPECTANCY_PER_SIDE=true
CIRCUIT_EXPECTANCY_WINDOW=10
CIRCUIT_EXPECTANCY_MIN_SUM_R=-2
# clear / reopen when structure bias flips
```

Document flags in `backend/.env.example` when implementing.

---

## 8. Verify after deploy

- Logs: `structure_bias=bear` → `no_trade` **before** LLM (or immediate block reason containing structure).
- No new long `entry_order_filled` while 4h prints LH/LL under prior HH.
- Side mismatch / fail-closed align reasons appear in `trade_decisions.reason`.
- Phase C: after N long losses, long blocked; short still eligible if structure allows.
- Regression: unit tests for classifier + side-align fail-closed; existing `v3-entry-policy` tests still green.

---

## 9. Success criteria

- Stop repeating **same-side full SL ladder** down one swing without a structure flip.
- Fewer LLM calls on clearly forbidden bias (cost + noise).
- Learning path is **code state** (bias + per-side R), not prompt folklore.

---

## 10. Out of scope (this plan)

- Changing TP/SL / RR / trail knobs
- Retraining / swapping LLM provider
- Frontend dashboard (optional later: show `structure_bias` on risk panel)
- Full ICT BOS/CHOCH engine beyond swing sequence needed for bull/bear/transition
