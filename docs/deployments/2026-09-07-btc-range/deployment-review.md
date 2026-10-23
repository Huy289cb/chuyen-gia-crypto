Đã triển khai lúc **22:21:51 ngày 07/09/2026 ICT**; 54 kiểm thử đạt, build thành công. Ngày 08/09 đã có lệnh range đầu tiên khớp trên Binance production. Xem [bằng chứng thực thi và ROI hiện tại](../../audits/2026-09-08-live-range/report.md).

Bản ứng viên bổ sung đường vào BTC long 5m khi thị trường 1h đang range. Giữ sweep/reclaim A/B, retest trên nến đóng sau đó, nến từ chối giảm, 4h không bear, AI xác nhận ≥75%, RR 1,5 và SL tối thiểu 0,8%. Bỏ yêu cầu micro-BOS bổ sung ở nến retest; nhánh này trước đó chỉ ghi nhận shadow. Trần tổng rủi ro mỗi lệnh vẫn **1 USDT** gồm SL + dự phòng phí/slippage, cùng ngân sách ngày, cooldown, drawdown và expectancy circuit.

Sửa hai điểm có thể chặn sai đường thực thi: AI nhận đúng mô tả range mean reversion cùng entry/SL/TP thực sự dùng, với ngoại lệ RR1,5 rõ ràng trong system prompt; không tái dùng quyết định trend trên cùng nến cho ứng viên range. TP sinh theo policy làm tròn ra ngoài đến cent để RR không tụt dưới ngưỡng do làm tròn. Trường hợp range context sai loại/chiều/RR đóng đường dispatch. HOLD và veto ngược chiều vẫn có hiệu lực.

Kết quả sàng lọc native ledger cho nhánh đã chọn (wallet khởi đầu 34,27714639 USDT, lot BTC, cap1, phí 0,05%/chiều, slippage tổng 0,1%, funding lịch sử):

| Giai đoạn | Lệnh mô phỏng | Net USDT |
|---|---:|---:|
| 11/09/2025–10/03/2026 | 15 | +0,1700 |
| 10/03/2026–06/09/2026 | 21 | +2,0297 |
| 60 ngày gần nhất trong giai đoạn sau | 8 | +0,0976 |

Mẫu nhỏ và phần lợi thế gần đây mỏng. Tăng slippage tổng lên 0,2% cho nhánh độc lập 180 ngày sau còn +0,5685 USDT; 60 ngày gần nhất âm. Đây là lý do cần đo kết quả thực tế và không tuyên bố bảo đảm ROI+.

Kiểm tra tương tác *chuỗi tín hiệu cố định* cùng chiến lược core trên 180 ngày sau, dùng chung ví và một vị thế, phí/funding theo thời điểm, ngân sách ngày, loss cooldown, expectancy và drawdown lấy mẫu mỗi 5m:

| Cấu hình | Lệnh | Net cơ sở | Net slippage 0,2% | Max DD cơ sở / stress |
|---|---:|---:|---:|---:|
| Core hiện tại | 15 | +5,8284 | +4,7477 | 9,34% / 10,00% |
| Core + range đã chọn | 35 | +7,1499 | +4,6789 | 9,17% / 9,88% |

Một tín hiệu range bị ngân sách ngày chặn. Kết quả stress gần bằng core, không chứng minh tăng lợi nhuận khi chi phí cao. Đây **không phải** backtest portfolio đầy đủ: tín hiệu lấy từ hai replay riêng, chưa tái sinh mọi candidate bị vị thế khác chặn; chưa mô phỏng veto AI, độ trễ, limit fill hay đỉnh drawdown intrabar. Các khoảng lịch sử đã được nghiên cứu, không phải tập dữ liệu tương lai chưa từng xem. Số lệnh dự kiến vẫn thưa, khoảng 35/180 ngày trong mô hình; không hứa có lệnh hằng ngày.

Bộ lọc bắt TP nằm trong range đã được triển khai dưới dạng tùy chọn tắt mặc định và có kiểm thử; không bật trong policy được chọn vì replay không cho cải thiện ròng nhất quán. AI nhận range bounds để kiểm tra TP có căn cứ, vẫn được HOLD. Các nhánh micro-BOS/early-flip vẫn shadow, không mở ETH.

Đây là bản review trước triển khai. Trạng thái triển khai, kiểm thử và runtime cuối cùng được ghi riêng trong manifest/verification, không suy ra từ tài liệu này.
