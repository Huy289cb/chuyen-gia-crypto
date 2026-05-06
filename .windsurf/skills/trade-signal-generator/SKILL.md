---
name: trade-signal-generator
description: Use when generating or reviewing trade signals, entry, stop-loss, take-profit plans, auto-entry decisions, position management actions, pending order decisions, or signal validation for the crypto trading flows in this repo.
---

## Khi sử dụng
- Dùng khi cần sinh signal mua, bán, hoặc hold cho repo này.
- Dùng khi cần đánh giá `suggested_entry`, `suggested_stop_loss`, `suggested_take_profit`, `expected_rr`.
- Dùng khi cần review hoặc tạo `position_decisions` và `pending_order_decisions`.
- Dùng khi cần kiểm tra signal có đủ điều kiện để vào lệnh paper trading hoặc Binance flow hay không.

## Input yêu cầu
- `method_id`, `analysis`, `current_price`.
- Account context: balance, cooldown, consecutive losses, enabled symbols, volume limits.
- Open positions và pending orders hiện có.
- Nếu có: method config từ `backend/src/config/methods.js`.

## Quy trình
1. Xác nhận signal scope.
   - Signal mới.
   - Review signal cũ.
   - Position management.
   - Pending order management.
2. Đọc threshold đúng method.
   - `ict`: confidence, RR, required timeframes, liquidity hoặc session constraints.
   - `kim_nghia`: confidence, RR, confluence, volume, H4 hoặc H1 alignment.
3. Kiểm tra bias-action consistency.
   - `bullish -> buy`
   - `bearish -> sell`
   - `neutral -> hold`
   - Nếu không nhất quán, reject signal.
4. Kiểm tra cấu trúc giá cho signal.
   - Long phải có `SL < entry < TP`.
   - Short phải có `TP < entry < SL`.
   - SL phải cách entry tối thiểu theo method config.
5. Kiểm tra khả năng vào lệnh.
   - Confidence đạt ngưỡng.
   - RR đạt ngưỡng.
   - Symbol được phép.
   - Account không trong cooldown.
   - Không vượt giới hạn volume.
   - Không trùng signal hoặc không vào lệnh ở invalid zone.
6. Phân loại order type.
   - Nếu giá đã chạm entry hợp lý, coi như market execution.
   - Nếu chưa chạm, coi như pending limit order.
7. Nếu đang xử lý lệnh mở, tạo `position_decisions`.
   - `hold`
   - `close_early`
   - `close_partial`
   - `move_sl`
   - `reverse`
8. Nếu đang xử lý pending order, tạo `pending_order_decisions`.
   - `hold`
   - `cancel`
   - `modify`
9. Trả kết quả ngắn, có lý do, có field đủ để backend xử lý tiếp.

## Output
```json
{
  "should_enter": true,
  "action": "enter_long|enter_short|no_trade",
  "order_type": "market|limit",
  "reason": "string",
  "confidence": 0,
  "suggested_position": {
    "side": "long|short",
    "entry_price": 0,
    "stop_loss": 0,
    "take_profit": 0,
    "expected_rr": 0
  },
  "position_decisions": [],
  "pending_order_decisions": []
}
```

## Quy tắc bắt buộc
- Không được trả về signal khi side, bias, action mâu thuẫn nhau.
- Không được tạo long hoặc short với SL hoặc TP placement sai.
- Không được bỏ qua cooldown, volume limit, duplicate signal, hoặc entry alignment checks.
- `close_early` hoặc `reverse` chỉ hợp lệ nếu bias đảo chiều hoặc structure đã vỡ.
- Mức giá phải thực tế, gần current price, và không được fake precision ngoài nhu cầu cần thiết.

## Không được làm
- Không cho lệnh chỉ vì confidence cao mà bỏ qua RR hoặc risk.
- Không modify pending order mà không validate logic entry-SL-TP.
- Không đề xuất ETH real-trading flow nếu code path hiện tại đang ưu tiên BTC-only.
- Không nói signal hợp lệ nếu chưa check method config thực tế.

## Tài nguyên
- `backend/src/config/methods.js`
- `backend/src/services/autoEntryLogic.js`
- `backend/src/services/paperTradingEngine.js`
- `backend/src/services/testnetEngine.js`
- `docs/ai-position-management.md`
- `docs/binance-testnet-integration.md`
