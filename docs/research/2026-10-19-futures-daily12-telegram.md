# Trần 12u/ngày và Telegram theo từng lệnh — 19/10/2026

Đã áp dụng vào giao dịch thật theo yêu cầu người dùng, khoảng **08:52–08:53 ICT ngày 19/10**. Worker và API đã restart lần lượt, PM2 đã lưu. Không chuyển tiền, tạo lệnh kiểm tra hoặc reset ví.

## Ngân sách mới

| Khoản | Trước | Đang chạy |
|---|---:|---:|
| Lỗ ngày tối đa theo chính sách | 15u | **12u** |
| Dự phòng đóng lệnh và biến động | 6,1u | **6,1u** |
| Ngưỡng bảo vệ sớm | −8,9u | **−5,9u** |

Ngân sách tính từ mốc đầu ngày Việt Nam, gồm phí, funding và lãi/lỗ lệnh mở; không phải ngân sách riêng mỗi lệnh hoặc cửa sổ24giờ trượt. Dự phòng thực thi còn được kiểm tra tại thời điểm chuẩn bị lệnh, nên có thể bắt đầu đóng trước đúng −5,9u. Giữ guard mất giám sát15giây và các kiểm tra quyền sở hữu, lệnh chưa rõ kết quả, margin, dữ liệu và nguồn nhân quả. Không đổi chiến lược B5, sizing, lịch nguồn hoặc SL/TP riêng từng lệnh.

Migration chỉ nhận đúng cấu hình cũ15/−8,9/6,1 của cùng tài khoản, policy và handoff đã xác thực. Ghi12u bền vững trước khi đọc sàn; lỗi đọc không đổi ngược ngân sách. Có receipt `riskBudgetChanges` một lần. Cấu hình bất kỳ khác hoặc cố đưa về15 sau migration đều bị chặn.

Vốn đầu31,47744546u, tiền, phí, funding, toàn bộ khớp/intents, anchor ngày, worstPnL, source cursor và khóa tiền được giữ. Nếu cùng ngày đã quan sát lỗ vượt ngưỡng mới thì giữ bảo vệ thay vì cấp lại ngân sách; không hồi tố ngưỡng mới sang ngày đã kết thúc. Các ngày lịch sử vẫn là dữ liệu của cấu hình lúc đó. Tên owner/thư mục `DAILY15` được giữ để tiếp nối sổ và quyền đặt lệnh, **không đại diện trần đang chạy**; numeric config và receipt mới là nguồn hiện hành.

Ngân sách là ngưỡng điều khiển phần mềm; gap/slippage/mất máy vẫn có thể vượt mức thực tế. Backtest128ngày với15u/soft−8,9u cũ không chứng nhận lợi nhuận cấu hình12u mới; lượt này không chạy lại nghiên cứu PnL.

## Telegram dễ đọc

Tin mở/đóng ghi rõ **MUA hoặc BÁN, coin, số tiền**, phần đóng lãi/lỗ sau phân bổ phí mở và đóng. Kèm trạng thái coin đang giữ tại mốc cập nhật: chiều, khối lượng, đang lãi/lỗ bao nhiêu theo giá. Báo ngày, rủi ro và phục hồi có danh sách từng coin đang giữ.

Lãi/lỗ vị thế mở được ghi rõ **theo giá, chưa tính phí giao dịch và phí giữ lệnh**; tổng PnL ngày vẫn dùng số net của sổ thật. Không trộn tiền đã chốt với phần còn nổi. Mốc giao dịch và mốc trạng thái hiện tại được tách riêng. Giá thiếu/sai, snapshot trước giao dịch hoặc khớp chưa đối soát thì ghi chờ, không giả thành0 hoặc báo nhầm đã hết vị thế. Không dùng ACK đơn thuần thay cho khớp thật.

Giữ nhịp important-only, không thêm báo giá/PnL định kỳ dày hơn. Lỗi đọc tài khoản chính xác `GET /fapi/v3/account ... (request_failed)` được nhận diện là kết nối tạm và đợi60giây như lỗi mạng đã biết; UNKNOWN/POST, truy vấn kết quả order, lỗi có mã sàn, tiền và đối soát vẫn cảnh báo ngay. Không làm im tất cả `request_failed` chung. Giới hạn mới trong mọi tin mới đọc từ config; tin lịch sử đã ACK được giữ nguyên theo thời điểm gửi.

Telegram đã ACK một tin phục hồi thực sau deploy, có `Giới hạn lỗ ...12,00 USDT/ngày` và4 dòng MUA BNB/ETH/SOL/XRP kèm lãi/lỗ hiện tại; đây là sự kiện vận hành thật, không phải tin giả để thử. Chưa có fill mới hoặc mốc21giờ sau deploy trong cửa sổ nghiệm thu; tin mở/đóng và báo ngày mới được kiểm chứng ngoại tuyến. Health lúc08:57: important-only,0pending/0failed,5uncertain lịch sử đã ACK,12 sự kiện ưu tiên thấp bị im lặng.

## Kiểm chứng và giới hạn

**43 trường hợp mục tiêu PASS** bằng Node strict assert trên module emit thực:13 trường hợp giao dịch/rủi ro (8 migration và5 bảo vệ có sẵn),25 formatter,5 phân loại lỗi thông báo. Test body lấy từ file kiểm thử hiện hành và chạy qua bộ nối matcher nhỏ có kiểm tra bằng `node:assert/strict`; không gọi đây là toàn bộ Vitest PASS. Có ca giữ đầy đủ sổ tiền, timeout sau migration, cap/config sai, chặn15u trở lại, khóa tiền không tự phục hồi, worst loss đã vượt12, softstop mới, đổi ngày, UNKNOWN không gửi lại, nạp tiền không làm đẹp PnL, monitoringgap và thiếu boundary. Formatter kiểm long/short/lỗ, phí thực, khớp thiếu, giá thiếu/sai, snapshot khác thời điểm và không sửa ví.

Hai lượt Vitest đầy đủ/thu hẹp phải dừng khi kiểm soát tài nguyên chạm9giây; lưu nguyên receipt, không báo PASS. Lượt nhẹ43cases dùng heap64MB,32giây, gap quan sát cao nhất3916ms, không bị dừng. Full semantic TypeScript chưa chạy lại trên máy đang giữ lệnh. Emit6module bằng esbuild theo target/options production và kiểm cú pháp cả6 JavaScript đều PASS; source khóa hash. Rà soát rủi ro độc lập xác nhận cap mới đi qua hardstop, reserve, projector và recovery; API được sửa ưu tiên config ví đã lưu để tránh báo mức cũ khi chuyển phiên.

## Nghiệm thu tiền thật

Worker2480846→2613549; config thật12/−5,9/6,1. API HTTP08:56 xác nhận cả top-level config và wallet config đều12u, status active. Fileenv không đổi; legacy/paper/post-exit giữ stopped. Mọi khớp/intents cũ, ngày đã lưu, anchor29,87137846u, cursor/source và ACK cũ được đối chiếu bảo toàn. Trước/sau deploy **91khớp/79intents**, không có lệnh mới do cập nhật.

GET độc lập **08:54:52 ICT** có9checks PASS: cash/fees/realized/funding/trade IDs/vị thế khớp, mọiintent đối soát, không order thường/algo chờ. Cash31,54916990u, equity31,52869985u, net toàn kỳ+0,05125439u gồm nổi−0,02047005u; phí0,73002204u, gross đã chốt+0,80448997u, funding−0,00274349u. Đây là snapshot ngắn, chưa trừ phí thoát giả định và chưa chứng minh kỳ vọng lợi nhuận. Không quy phần PnL dương này cho cấu hình12u vừa deploy.

Nghiệm thu31mẫu khoảng08:54–08:55 có cả active và một đoạn reconciliation_required, gap cao nhất **12079ms**, cuối cửa sổ active/reconciled/delta0, không khóa mới hoặc thay số lệnh. Vì vậy **chưa kết luận giám sát đã ổn định**. API lần GET đầu timeout, lần sau trả đúng config; không che kết quả chưa tốt bằng cách chỉ báo mẫu sạch.

[Nghiên cứu ổn định giám sát](2026-10-19-futures-monitoring-stability-research.md) đã có bằng chứng máy chịu áp lực, sự cố25,395giây sáng nay và các đối chứng cụ thể: đo phase, thử xuất status không chặn, thử lấy WS mới nhất sau REST, rồi đánh giá máy riêng nếu cần. Các ứng viên này chưa được áp dụng vào vòng giám sát trong lượt này. Không nới15giây hoặc bỏ fsync sổ tiền để tránh báo lỗi.

Gói mới `docs/audits/futures-quick-win/daily12-telegram-20261019` giữ checksum, source, checks, receipts và số liệu đã bỏ định danh; checkpoint ví/outbox đầy đủ giữ private ngoài repo. Không sửa gói cũ. Nếu cần rollback giao diện/thông báo thì giữ service12u và sổ hiện tại; không phục hồi wallet/config15u hoặc bản service15u để vượt yêu cầu mới.
