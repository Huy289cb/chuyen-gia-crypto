Đã hoàn tất sửa lỗi, kiểm thử, backtest, triển khai và thiết lập monitor ngày 07/09/2026. Bản mới chạy từ 10:20 ICT; kiểm tra cuối lúc 15:16 ICT xác nhận API khỏe, API/worker không restart, monitor không có cảnh báo. Chưa có bằng chứng đủ mạnh để khẳng định hệ thống đạt ROI dương bền vững.

**Kế toán đã khớp giao dịch thực**

36 vòng giao dịch đã đóng được đối soát theo lượng khớp thực, gồm phí vào/ra và funding có dấu. Gross PnL −0,27719996 USDT, commission 5,17056329 USDT, funding cost 0,27509036 USDT; net **−5,72285361 USDT**, tương ứng **−14,3071%** trên vốn gốc 40 USDT. Số dư Binance là **34,27714639 USDT**, không có vị thế, lệnh thường hay lệnh algo tại thời điểm kiểm tra. Net cũ −3,26438849 USDT đã đánh giá kết quả cao hơn thực tế 2,45846512 USDT.

Đã lưu bằng chứng fills/funding cho 36/36 giao dịch, cập nhật position/outcome/account và chạy lại đối soát với 0 cập nhật. Phân trang lịch sử không âm thầm bỏ dữ liệu; ID thu nhập lớn được giữ dạng chuỗi trước khi parse JSON. Xem [accounting-replay.json](accounting-replay.json), [ledger-applied.json](ledger-applied.json), [exchange-final.json](exchange-final.json), [income-id-verification.json](income-id-verification.json).

**Các thay đổi đã triển khai**

- Tính rủi ro trước lệnh gồm tổn thất tại SL, phí hai chiều và dự phòng trượt giá; kiểm tra trần 2% và ngân sách lỗ ngày còn lại. Giữ mức SL/TP theo cấu trúc, loại bỏ việc bóp SL để vừa minimum lot hoặc kéo TP để làm đẹp RR.
- Đưa mọi market scan mới vào quan sát adaptive, kể cả khi core gate chặn; dùng regime HTF quan sát thực. Nhánh trend live vẫn phải qua core gate. Adaptive chạy **shadow** để thu bằng chứng cơ hội mới.
- Dùng PnL ròng đã xác minh cho thống kê; không ghi lợi nhuận thực từ ước lượng chưa xác minh. Đối soát các lệnh đóng gần đây định kỳ, giữ nguyên mốc vốn gốc.
- Đếm request LLM tại provider, phân biệt với decision; cost API hiển thị coverage và dữ liệu thiếu. Tại kiểm tra cuối, coverage phí là 36/36 và chưa có request LLM mới sau triển khai do các gate đang chặn.

**Kiểm thử và backtest**

Full suite đạt **100 files / 592 tests**. Các kiểm thử bổ sung telemetry, ID int64, phân trang và batch reconciliation đều đạt; tổng cộng 597 test khác nhau đã được chạy qua các lượt. TypeScript build thành công; 175 file JavaScript đang chạy khớp manifest, không có hash sai lệch. Log lưu cùng thư mục: acceptance-tests.log, additional-tests.log, batch-tests.log, typecheck-build.log.

Replay core 60 ngày, chốt dữ liệu trước 06/09/2026 UTC; phí 0,05% mỗi chiều và trượt giá tổng 0,10%:

| Biến thể | Điều kiện vốn/lệnh | Số lệnh | Net USDT | Profit factor | Max drawdown USDT |
|---|---|---:|---:|---:|---:|
| Core hiện tại | Notional cố định 100 USDT | 4 | +3,1273 | 3,46 | 0,9996 |
| Core hiện tại | Ví 34,2771 USDT, lot 0,001 BTC, trần risk 2% | 1 | −0,6496 | 0 | 0,6496 |
| Pullback 0,50, nghiên cứu | Notional cố định 100 USDT | 8 | +5,5249 | 2,69 | 2,0000 |
| Pullback 0,50, nghiên cứu | Ví 34,2771 USDT, lot 0,001 BTC, trần risk 2% | 3 | +0,1351 | 1,11 | 1,2707 |

Replay adaptive 180 ngày, định giá lại cùng fills với phí và slippage trên: range sweep/reclaim có 11 lệnh, +1,248R, PF 1,20; aligned micro BOS có 20 lệnh, +2,0005R, PF 1,15; early structure flip chỉ có 1 lệnh thua. R là đơn vị rủi ro của mô hình, không phải ROI tài khoản.

Đây là mô phỏng signal/SL/TP với mẫu nhỏ, chưa bao gồm funding hay đầy đủ hành vi LLM, limit fills, order book và trailing của live. Hai dòng notional cố định có một lệnh đóng cưỡng bức ở cuối kỳ; hai dòng kiểm tra theo ví không có. Adaptive chưa được chứng minh khả thi với minimum lot và vốn thực qua các số R này. Xem [core-backtest.json](core-backtest.json), [adaptive-backtest.json](adaptive-backtest.json), [adaptive-cost-sensitivity.json](adaptive-cost-sensitivity.json).

**Đánh giá cơ hội tăng ROI và tần suất lệnh**

Ưu tiên đã thực hiện là đo đúng net và mở đường quan sát các setup bị core bỏ qua. Lợi thế mô phỏng suy giảm rõ khi thêm chi phí; tăng số lệnh tự nó không bảo đảm cải thiện ROI. Pullback live giữ **0,25**, adaptive giữ **shadow**, không tăng trần rủi ro.

Vốn/lot là nút thắt thực: với BTC quanh 80.000 USDT, lot 0,001 BTC và SL 0,8%, cộng khoảng 0,2% phí/slippage cho rủi ro xấp xỉ 0,8 USDT, khoảng 2,33% ví hiện tại, vượt trần 2%. Đòn bẩy không làm giảm khoản lỗ này. Khi đánh giá khả năng thực thi cần dùng giá, lot, chi phí và vốn tại thời điểm lệnh; không bóp SL hoặc tăng risk chỉ để có thêm lệnh.

Bước nghiên cứu tiếp theo hợp lý là tích lũy kết quả shadow/out-of-sample, so net expectancy, drawdown và tỷ lệ setup thực thi được theo vốn. Chỉ cân nhắc đưa range hoặc pullback rộng hơn vào live khi có đủ bằng chứng sau chi phí. Trong gần 5 giờ quan sát chưa có adaptive candidate mới, nên chưa thể xác nhận tăng số lệnh thực tế.

**Triển khai và giám sát**

Manifest ghi bản triển khai lúc 03:20:01 UTC (10:20 ICT). Snapshot runtime xác nhận 59 chu kỳ MarketScan và 59 chu kỳ LLMDispatch đã hoàn tất sau thời điểm này, 0 restart ở cả hai tiến trình, không thấy lỗi nghiêm trọng được kiểm tra trong log sau deploy. Health lúc 15:16 ICT đạt ok. LLMDispatch hoàn tất không đồng nghĩa đã gọi provider hoặc đã vào lệnh.

Trong triển khai có gián đoạn do PM2 mất kết nối socket và reconciliation chạm quota Binance. Đã phục hồi quản lý tiến trình, đổi sang lấy lịch sử chung một lần cho cả batch, hoàn tất 32 rồi 4 bản ghi còn lại, đối soát lại không phát sinh cập nhật. Không còn lỗi quota trong phần log sau triển khai được kiểm tra.

Cron chạy monitor chỉ đọc mỗi phút, kiểm tra tiến trình, API, scheduler stale, coverage ledger và chênh lệch vốn/net khi không có vị thế. Lưu trạng thái tại `/home/ubuntu/.local/state/chuyen-gia-crypto/roi-monitor/latest.json`, thay đổi tại `changes.jsonl`, log cron tại `cron.log`. Monitor không tự sửa hệ thống, không gửi thông báo ngoài và không đặt lệnh. Snapshot cuối [monitor-final.json](monitor-final.json) không có cảnh báo; xem thêm [api-final.json](api-final.json), [final-runtime-verification.json](final-runtime-verification.json), [deployment-manifest.json](deployment-manifest.json).

Backup code/build, DB, env và cấu hình PM2 trước triển khai được lưu riêng tại `/home/ubuntu/.local/state/chuyen-gia-crypto/deployments/20260906-roi-fix/`; build cũ tại `backend/dist-pre-roi-20260907`. Không phục hồi DB cũ một cách tự động sau khi có giao dịch mới. Các thay đổi có sẵn trong working tree được giữ nguyên; chưa tạo commit hay PR.
