# Groq Levels Adapter (Key 2) — Plan & Tracking

**Mục tiêu:** Khi LLM chính trả **trade** nhưng vi phạm kiểm soát rủi ro thực thi, gọi thêm **tối đa một lần Groq / tình huống** với **`GROQ_API_KEY_2`** (*execution risk / levels specialist*):

- **Step 5a — SL quá gần:** `|entry−SL|/entry < MIN_SL_DISTANCE_PERCENT` → đề xuất **SL+TP mới** thỏa min SL **và** min R:R.
- **Step 5b — R:R từ giá thấp (SL đã OK):** sau `reconcileExpectedRr`, nếu R:R từ giá `< minRr` → đề xuất **chỉ TP mới** (SL cố định).

**Phạm vi:** Cả 5a và 5b dùng chung `GROQ_LEVELS_ADAPTER_ENABLED=true` và `GROQ_API_KEY_2` (không thêm env tách Phase 2).

**Nguyên tắc PnL+:** Chỉ gọi API phụ khi gate tương ứng fail; model phụ dùng `preferredModels` (1 model) + `maxRetries` thấp. Một lần `dispatch` có thể gọi key2 **tối đa hai lần** (fail 5a rồi sửa SL; sau đó nếu vẫn fail 5b thì sửa TP) — mỗi lần chỉ khi gate đó fail.

---

## Tracking (cập nhật khi hoàn thành từng bước)

| ID | Hạng mục | Trạng thái | Ngày / Ghi chú |
|----|----------|-------------|-----------------|
| P1 | Viết plan + bảng tracking (file này) | `done` | 2026-05-20 |
| P2 | Xác nhận `groq-client`: `preferredModels`, `export cleanJSONResponse` | `done` | Đã có sẵn trong repo |
| P3 | Thêm biến môi trường + mô tả trong `backend/.env.example` | `done` | `GROQ_LEVELS_ADAPTER_ENABLED`, `GROQ_MODEL_LEVELS_ADAPTER` |
| P4 | Module `groq-levels-adapter.service.ts` (key2 only, JSON SL/TP, validate) | `done` | `backend/src/services/groq-levels-adapter.service.ts` |
| P5 | Tích hợp `groq-dispatch.service.ts` Step 5a (thử adapter trước khi `no_trade`) | `done` | Import + `let analysis` + retry SL check |
| P6 | Ghi `reason_summary` / audit trail khi adapter sửa levels | `done` | `[LevelsAdapter:key2]` (5a); `[LevelsAdapter:key2:rr-tp]` (5b) |
| P7 | `npm run build` backend | `done` | 2026-05-20 — `prisma generate && tsc` exit 0 |
| P8 | Double-check checklist (dưới đây) | `done` | 2026-05-20 — xem checklist đã tick |
| P9 | Phase 2: Step 5b — `tryRepairTpForMinRrWithSecondaryKey` + dispatch | `done` | 2026-05-20 |
| P10 | `npm run build` sau Phase 2 | `done` | 2026-05-20 |

**Trạng thái hợp lệ:** `pending` | `in_progress` | `done` | `skipped` | `blocked`

---

## Chi tiết thiết kế

### Luồng (sau Step 4 — có `analysis` hợp lệ)

1. Tính `checkMinSlDistance(entry, sl, minSlPct)`.
2. Nếu **OK** → giữ nguyên (như hiện tại).
3. Nếu **FAIL** và `GROQ_LEVELS_ADAPTER_ENABLED=true` và có `GROQ_API_KEY_2`:
   - Gọi **Levels Adapter** (client chỉ `[GROQ_API_KEY_2]`, `preferredModels: [GROQ_MODEL_LEVELS_ADAPTER || GROQ_MODEL_PRIMARY || default]`).
   - Parse JSON: `suggested_stop_loss`, `suggested_take_profit`, `adjustment_note` (optional).
   - Validate cấu trúc lệnh long/short + `checkMinSlDistance` + `computeExpectedRrFromPrices >= minRr` (method `kim_nghia`).
   - Nếu pass → ghi đè `analysis.suggested_stop_loss` / `suggested_take_profit`, chạy `reconcileExpectedRr`, **tiếp tục** pipeline (5b, 5, 6…).
4. Nếu adapter tắt / lỗi / không pass validate → **giữ hành vi cũ**: lưu `no_trade` + lý do SL như hiện tại.

### Luồng Step 5b (min R:R từ giá)

1. `reconcileExpectedRr` → `computedRr`, `analysis.expected_rr` đồng bộ giá.
2. Nếu `computedRr >= minRr` → OK.
3. Nếu `computedRr < minRr` và adapter bật + key2: gọi **`tryRepairTpForMinRrWithSecondaryKey`** (chỉ khi `checkMinSlDistance` đã OK trên SL hiện tại).
4. Parse JSON: chỉ cần `suggested_take_profit` (+ `adjustment_note`); SL giữ nguyên; validate geometry long/short, min SL (invariant), `computeExpectedRrFromPrices >= minRr`.
5. Nếu pass → merge, `reconcileExpectedRr` lại; nếu vẫn `< minRr` → `no_trade` như cũ.
6. Audit: `[LevelsAdapter:key2:rr-tp]` trong `reason_summary`; log prefix `[LevelsAdapter:RR]`.

### JSON contract (adapter output)

Chỉ một object, ví dụ:

```json
{
  "suggested_stop_loss": 76300.12,
  "suggested_take_profit": 75800.00,
  "adjustment_note": "Widened SL to meet 0.5% min; kept bearish structure"
}
```

**Step 5b (TP-only):** một object, ví dụ:

```json
{
  "suggested_take_profit": 98500.0,
  "adjustment_note": "Extended TP to meet min R:R; SL unchanged"
}
```

*(Model có thể trả thêm field; server chỉ tinh chỉnh TP và giữ SL từ pipeline.)*

---

## Double-check checklist (sau implement)

- [x] `GROQ_LEVELS_ADAPTER_ENABLED=false` → hành vi giống trước (không gọi key2). *Xác minh code:* `isGroqLevelsAdapterConfigured()` yêu cầu `=== 'true'` **và** key2; nếu không → `tryRepairLevelsWithSecondaryKey` return `null` ngay.
- [x] `true` + không có `GROQ_API_KEY_2` → không crash, fallback no_trade. *Xác minh code:* `isGroqLevelsAdapterConfigured` false khi thiếu key2; dispatch chỉ merge khi `repaired` truthy.
- [x] `true` + key2 + SL tight → log `[LevelsAdapter]` và hoặc pass hoặc fail rõ. *Xác minh code:* `console.warn` / `console.log` prefix `[LevelsAdapter]` trong `groq-levels-adapter.service.ts`.
- [x] `npm run build` trong `backend/` pass. *(2026-05-20)*
- [x] Không thêm dependency npm mới. *(chỉ thêm service + wiring; không đổi `package.json`.)*
- [x] Step 5b: R:R thấp + adapter bật → thử TP-only; log `[LevelsAdapter:RR]`; audit `[LevelsAdapter:key2:rr-tp]`. *(code review + build 2026-05-20)*

---

## Liên kết code

| Thành phần | File dự kiến |
|-------------|----------------|
| Client Groq | `backend/src/services/groq-client.ts` |
| Adapter | `backend/src/services/groq-levels-adapter.service.ts` (mới) |
| Dispatch | `backend/src/services/groq-dispatch.service.ts` |
| R:R / SL helpers | `backend/src/utils/trade-levels.ts`, `backend/src/config/methods.ts` |
| Env mẫu | `backend/.env.example` |

---

## Lịch sử cập nhật

| Ngày (UTC) | Thay đổi |
|-------------|----------|
| 2026-05-20 | P7 build OK; P8 checklist double-check theo code + build; tracking cập nhật. |
| 2026-05-20 | Phase 2 (P9): Step 5b TP-only adapter; P10 build OK; doc + `.env.example`. |
| 2026-05-20 | Adapter prompts: inject `policy_floor_sl` / `policy_min_tp` + SELF-CHECK; deterministic fallback when key2 math fails. |
