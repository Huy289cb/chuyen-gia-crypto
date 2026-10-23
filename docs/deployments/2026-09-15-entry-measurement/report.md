# Triển khai đo lường entry — 15/09/2026

Đã triển khai gói `measurement-20260914` lúc **11:03 ICT ngày 15/09/2026** theo yêu cầu tiếp tục sau khi gói đã được kiểm chứng. Runtime khớp checksum release; API và worker khởi động lại thành công, PM2 đã lưu.

## Bằng chứng

- Gói: 16 file JavaScript thay đổi; 56 kiểm tra trước triển khai, diễn tập rollback và kiểm tra từ chối target bị sửa/đang chạy đã qua. Đã kiểm tra toàn bộ checksum trong seal trước triển khai.
- Exchange trước và sau dừng worker/API: không có vị thế, lệnh thường hoặc algo. Wallet/equity 33,59964603 USDT, unrealized PnL 0. DB không có vị thế mở hoặc pending.
- Health API OK; `/api/metrics/entry-traces` và `/api/metrics/risk` trả JSON thành công.
- API PID 2052984, worker PID 2052991 tại thời điểm xác minh. Cả hai giữ cooldown 1h, ngày 10%, trần mỗi lệnh 3%, target 0,5%, cap USD rỗng. `.env` không thay đổi.
- Bản ghi funnel sau triển khai đã xuất `measurement_version: 2` và `legacy_control_fields_preserved: true`.
- Endpoint trace dùng cửa sổ ngày có thể bao gồm dữ liệu trước triển khai. Dùng `post-start-observation.json`, lọc từ `deployedAt`, để đánh giá cohort mới. Số 0 chi phí khi không có request không phải bằng chứng chi phí AI bằng 0.

## Giới hạn và bước tiếp theo

Chưa đủ dữ liệu live để xác minh toàn chuỗi signal → AI → admission → fill, cải thiện retest hay ROI. Không tạo lệnh/AI request nhân tạo để kiểm tra. Quan sát vận hành 24h tính từ 11:03 ICT ngày 15/09 đến 11:03 ICT ngày 16/09; đây là cửa sổ đánh giá, chưa thiết lập tác vụ tự động giám sát nền.

Chạy lại công cụ chỉ đọc từ `backend` để thu bằng chứng mới:

```bash
node scripts/observe-entry-measurement.cjs
```

Đánh giá heartbeat theo cron thực, restart/memory/lỗi mới, độ đầy đủ trace và chi phí unknown; không dùng số lượng lệnh như tiêu chí thành công vận hành. Khi dữ liệu ổn định mới so sánh tỷ lệ kế hoạch hợp lệ và khoảng TP trước/sau retest, rồi chọn một giả thuyết nghiên cứu đóng băng. Không thay đổi đồng thời SMC, Fibonacci và AI selection trong cửa sổ này.

## Rollback

Baseline còn trong gói đã niêm phong. Nếu cần rollback, dừng worker/API trên đúng PM2 daemon, dùng `measurement-release-control.py rollback` theo [runbook](../../../backend/releases/measurement-20260914/README.md), xác minh checksum baseline rồi khởi động lại cùng môi trường. Không rollback DB hoặc xóa lịch sử rủi ro.

[Manifest](deployment-manifest.json) · [Xác minh](verification.json) · [Quan sát sau triển khai](post-start-observation.json) · [Exchange sau dừng](exchange-after-stop.json)

## Kiểm tra chu kỳ đầu

Đến 11:06:18 ICT, heartbeat LLMDispatch và PositionMonitor đã cập nhật sau triển khai. Dispatch hoàn tất bình thường: 5m bị signal gate chặn, 15m/1h bị chặn do trạng thái nến trùng. DB có 0 vị thế active và 0 pending blocking; cohort mới có 1 bản ghi funnel, chưa có trace AI/fill. Không thấy dòng lỗi mới sau triển khai trong hai error log được kiểm tra. Kiểm tra cuối xác nhận runtime vẫn khớp release và cả hai tiến trình đang chạy.
