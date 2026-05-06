---
name: backend-refactor
description: Use when refactoring or extending the backend of this repo, especially analyzers, schedulers, trading services, SQLite flows, Binance integration, validation layers, or API routes where behavior must stay stable and risk-sensitive logic cannot regress.
---

## Khi sử dụng
- Dùng khi sửa backend cho repo này.
- Dùng khi động vào `backend/src/analyzers`, `services`, `db`, `routes`, hoặc `scheduler`.
- Dùng khi cần tách logic, giảm duplicate, hoặc làm rõ boundaries mà không được phá vỡ trading flow.

## Input yêu cầu
- Mục tiêu thay đổi rõ ràng.
- Files hoặc flow bị ảnh hưởng.
- API contract, DB contract, và test scope liên quan.
- Nếu có bug: reproducible case, log, hoặc behavior mong đợi.

## Quy trình
1. Map luồng hiện tại trước khi sửa.
   - Input vào từ route hoặc scheduler nào.
   - Service nào xử lý.
   - DB hoặc API nào bị ảnh hưởng.
2. Xác định boundary của thay đổi.
   - Runtime prompt hoặc config.
   - Validation layer.
   - Position engine hoặc Binance engine.
   - Database read hoặc write path.
3. Chọn refactor nhỏ nhất để đạt mục tiêu.
   - Reuse helper đã có trước khi thêm abstraction mới.
   - Tách function theo business boundary, không tách theo nice-to-have.
4. Bảo toàn invariant quan trọng.
   - Tách biệt `ict` và `kim_nghia`.
   - Bảo toàn side, bias, SL, TP, và risk logic.
   - Không làm mất `method_id` filtering.
   - Không phá async hoặc non-blocking behavior.
5. Update tests khi behavior thay đổi.
   - Trading logic: ưu tiên unit hoặc integration tests liên quan.
   - Database hoặc schema changes: có migration hoặc compatibility path.
6. Verify bằng command phù hợp nếu có thể.
   - Test file liên quan.
   - Build hoặc lint nếu thực sự cần.

## Output
- Change set ngắn, gồm:
  - mục tiêu refactor
  - files chính đã sửa
  - invariant đã giữ
  - test đã chạy hoặc chưa chạy

## Quy tắc bắt buộc
- Minimal change set.
- Không thêm dependency nếu chưa cần.
- Không đổi API hoặc DB shape ngầm mà không nói rõ.
- Khi sửa trading logic, phải xem nó là correctness issue, không chỉ là cleanup.
- Nếu có file prompt hoặc runtime dài, chỉ refactor khi vẫn giữ nguyên behavior app.

## Không được làm
- Không copy-paste logic giữa analyzer, scheduler, paper trading, và testnet engine.
- Không revert thay đổi của người khác nếu không liên quan task.
- Không sửa schema SQLite mà không kiểm soát migration hoặc compatibility.
- Không kết luận safe nếu chưa đọc method config và validation path.

## Tài nguyên
- `backend/src/analyzers/analyzerFactory.js`
- `backend/src/config/methods.js`
- `backend/src/services/autoEntryLogic.js`
- `backend/src/services/paperTradingEngine.js`
- `backend/src/services/testnetEngine.js`
- `backend/src/db/database.js`
- `docs/architecture.md`
- `docs/api-paper-trading.md`
