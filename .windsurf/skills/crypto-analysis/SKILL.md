---
name: crypto-analysis
description: Use when working on market analysis workflows for this repo, especially ICT Smart Money or Kim Nghia analysis, bias review, liquidity and structure reading, confidence scoring, invalidation logic, or converting raw market context into actionable analysis output for BTC and ETH.
---

## Khi sử dụng
- Dùng khi cần phân tích BTC hoặc ETH theo ICT hoặc Kim Nghia.
- Dùng khi cần đánh giá bias, structure, liquidity, OB, FVG, BOS, CHOCH, Fibonacci, hoặc volume.
- Dùng khi cần biến market context thành kết quả phân tích có confidence, risk, narrative, và key levels.

## Input yêu cầu
- `method_id`: `ict` hoặc `kim_nghia`.
- Giá hiện tại, biến động theo timeframe, và nếu có thì OHLC 15m, 1h, 4h, 1d.
- Nếu có trade đang mở: open positions, pending orders, risk constraints, prediction history.
- Nếu thiếu dữ liệu, phải nói rõ dữ liệu nào đang thiếu.

## Quy trình
1. Xác nhận repo state trước khi phân tích.
   - `kim_nghia` đang là method active.
   - `ict` được giữ trong code nhưng đang disabled ở scheduler.
   - AI position management hiện tại ưu tiên BTC; ETH có thể bị tạm dừng trong một số flow.
2. Chọn framework đúng với `method_id`.
   - `ict`: ưu tiên HTF bias, liquidity sweep, MSS hoặc CHOCH, OB hoặc FVG, killzone, multi-timeframe alignment.
   - `kim_nghia`: ưu tiên H4 hoặc H1 bias, M15 execution, volume confirmation, Fibonacci confluence, liquidity và structure.
3. Đọc market structure từ trên xuống dưới.
   - HTF bias trước.
   - Sau đó map liquidity, structure break, và các vùng reaction.
4. Xác định kế hoạch giao dịch chỉ khi có thesis rõ ràng.
   - Long thesis: bias tăng, discount hoặc support, đã quét sell-side, có BOS hoặc CHOCH hay confluence hợp lý.
   - Short thesis: bias giảm, premium hoặc resistance, đã quét buy-side, có BOS hoặc CHOCH hay confluence hợp lý.
   - Nếu tín hiệu xung đột, output `hold`.
5. Tính confidence theo method.
   - `ict`: dựa trên HTF alignment, liquidity sweep, BOS hoặc CHOCH, structure clarity, invalidation rõ ràng.
   - `kim_nghia`: dùng scoring 100 điểm:
     - HTF Alignment: 30
     - Liquidity & Structure: 30
     - SMC/Fibonacci Confluence: 20
     - Volume Confirmation: 20
6. Kiểm tra risk trước khi đề xuất signal.
   - Phải có invalidation level.
   - Phải kiểm tra RR tối thiểu theo method.
   - Không đề xuất entry nếu SL hoặc TP placement phi logic.
7. Tạo narrative ngắn, rõ, có lý do.
   - Nói price đang ở đâu.
   - Vừa xảy ra sự kiện gì.
   - Liquidity nằm ở đâu.
   - Kỳ vọng đi về mức nào.
   - Điều kiện nào vô hiệu hóa thesis.

## Output
- Nếu user muốn market analysis tổng hợp, trả về:
  - `bias`
  - `action`
  - `confidence`
  - `narrative`
  - `key_levels`
  - `risk` hoặc `invalidation`
- Nếu user muốn JSON cho app hoặc runtime, dùng schema phù hợp với method:
```json
{
  "bias": "bullish|bearish|neutral",
  "action": "buy|sell|hold",
  "confidence": 0.0,
  "narrative": "string",
  "suggested_entry": 0,
  "suggested_stop_loss": 0,
  "suggested_take_profit": 0,
  "expected_rr": 0
}
```

## Quy tắc bắt buộc
- Không được khẳng định chắc chắn 100%.
- Không được tạo mức giá, structure, volume, hay liquidity nếu input không có.
- `ict` và `kim_nghia` phải được tách logic rõ ràng; không trộn threshold của hai method.
- Luôn ưu tiên tính nhất quán giữa bias, action, risk, và invalidation.
- Nếu repo state xác nhận method đang disabled, không mô tả nó như đang live.

## Không được làm
- Không viết phân tích kiểu cảm tính mà không chỉ ra structure hoặc liquidity.
- Không đề xuất buy hoặc sell khi signal xung đột mà không giải thích.
- Không bỏ qua risk management hoặc confidence scoring.
- Không copy nguyên một prompt dài; phải theo workflow này và bám dữ liệu thực tế.

## Tài nguyên
- `backend/src/config/methods.js`
- `backend/src/analyzers/analyzerFactory.js`
- `backend/src/services/autoEntryLogic.js`
- `docs/architecture.md`
- `docs/ai-position-management.md`
