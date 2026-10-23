> **Cập nhật 2026-09-07:** execution live đã bỏ chuẩn hóa SL theo kích thước ví. SL/TP gốc được giữ nguyên; phí và dự phòng trượt giá được cộng vào rủi ro trước khi kiểm tra trần. `MINIMUM_LOT_STOP_NORMALIZATION_ENABLED` chỉ còn phục vụ mã/nghiên cứu cũ, không mở lại hành vi thu hẹp stop trong `executeV3Trade`. Nội dung dưới đây ghi lại thiết kế trước bản sửa ROI.

# Minimum-lot stop normalization

## Purpose

On a small wallet, Binance's minimum quantity can make the smallest executable
BTC order larger than the risk-sized quantity. A structurally valid LLM trade
can then be rejected because its original stop risks more than the hard wallet
cap after quantity rounding.

The normalization is deliberately narrow:

- it runs only when quantity was raised to the smallest executable lot;
- it never raises `MAX_EFFECTIVE_RISK_PER_TRADE_PERCENT`;
- it requires a tick-valid stop at or above `MIN_SL_DISTANCE_PERCENT`;
- it caps the chosen stop at `MINIMUM_LOT_NORMALIZED_STOP_MAX_PERCENT`;
- it recomputes TP at the setup's required minimum R:R;
- it fails closed when the feasible band is empty.

Runtime events use `minimum_lot_stop_normalized` and include original/new
levels plus effective wallet risk.

## Dedicated replay

Command:

```bash
npm run eval:minimum-lot-stop -- \
  --days=720 \
  --validation-days=240 \
  --end=2026-09-06T01:44:25.571Z
```

This closed-candle, stateful replay covers the currently validated
`range_sweep_reclaim` long/5m family at 1.5R, includes 0.04% fee per side,
uses conservative SL-first same-bar ordering, and splits the last 240 days as
validation.

| Stop | Validation n | Validation net R | Validation PF | Full n | Full net R | Full PF | Full max DD |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.80% | 11 | +2.900 | 1.527 | 52 | +12.154 | 1.460 | 3.500R |
| 0.82% | 11 | +2.927 | 1.533 | 51 | +13.357 | 1.529 | 3.293R |
| 0.84% | 11 | +2.952 | 1.539 | 50 | +9.551 | 1.363 | 4.615R |
| 0.858% | 11 | +2.974 | 1.544 | 50 | +8.206 | 1.312 | 3.746R |
| 0.86% | 11 | +2.977 | 1.545 | 50 | +8.215 | 1.313 | 3.744R |

At the reference balance 34.27714639 USDT, BTC price 79,894.5 and quantity
0.001, the 2% hard cap permits at most a 0.85806% stop. Production uses a
0.84% preferred maximum to retain execution/tick headroom instead of consuming
the entire hard cap.

## Interpretation and limitation

The whole tested band remained positive in both train and validation, so the
0.84% normalization point is not an isolated optimum. This is evidence for the
stop geometry of the validated range setup, not a guarantee that arbitrary LLM
setups are profitable. Signal, structure, playbook, LLM, circuit and exposure
gates remain unchanged; live outcomes must be monitored separately.
