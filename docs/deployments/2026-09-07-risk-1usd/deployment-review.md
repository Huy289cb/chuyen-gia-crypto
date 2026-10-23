Đã triển khai trần rủi ro cố định **1 USDT mỗi lệnh BTC**, theo yêu cầu người dùng ngày 07/09/2026. Trần này gồm tổn thất dự kiến tại SL, phí hai chiều và slippage dự phòng; không phải mức lỗ được bảo đảm trong mọi điều kiện thị trường.

Bản triển khai lúc **19:45:48 ICT**. Biến `MAX_EFFECTIVE_RISK_PER_TRADE_USD=1` được xác nhận trong cả API và worker. Khi có giá trị USD hợp lệ, nó thay thế trần theo phần trăm cho kiểm tra rủi ro mỗi lệnh; biến phần trăm cũ chỉ làm fallback nếu bỏ cấu hình USD. Giữ nguyên mục tiêu sizing, minimum SL, kiểm tra SL theo cấu trúc, ngân sách lỗ ngày, giới hạn vị thế và tổng notional. Không chuyển sang ETH.

Ví dụ BTC 79.425 USDT, lot 0,001 BTC, SL 0,8%: long có tổng dự phòng khoảng 0,79425 USDT, short khoảng 0,7948854 USDT. Hai lệnh này qua trần USD mới thay vì bị chặn bởi 2% của ví 34,28 USDT. Lệnh vẫn phải qua các gate tín hiệu và ngân sách lỗ ngày còn lại. Một stop chỉ mất giá 0,90 USDT có thể vượt trần 1 USDT sau chi phí và vẫn bị chặn.

Kiểm thử: **43 tests / 6 files** liên quan đều đạt. Có kiểm thử long/short theo giá/ví thực, giữ trần USD khi số dư thay đổi, từ chối trên trần sau phí, từ chối vượt ngân sách ngày, fallback percent và invalid inputs; tất cả order calls trong tests được mock. TypeScript build thành công. 175 JavaScript files đang chạy khớp manifest. API `/api/metrics/risk` trả `max_effective_risk_per_trade_usd: 1`, `effective_risk_cap_mode: usd`; dashboard API cũng cung cấp mode và USD cap.

Đã đối chiếu Binance trước khi dừng worker và sau khi dừng: ví 34,27714639 USDT, không có vị thế/lệnh thường/lệnh algo. Chỉ restart các tiến trình đang quản lý bởi PM2, lưu PM2 cho lần khởi động sau. Không đặt lệnh kiểm thử thật, không thay đổi ledger. Monitor mỗi phút tiếp tục chạy và snapshot hậu triển khai không có cảnh báo.

Bằng chứng: [tests.log](tests.log), [additional-tests.log](additional-tests.log), [build.log](build.log), [deployment-manifest.json](deployment-manifest.json), [api-after-deploy.json](api-after-deploy.json), [runtime-verification.json](runtime-verification.json), [exchange-predeploy.json](exchange-predeploy.json).

Backup riêng tại `/home/ubuntu/.local/state/chuyen-gia-crypto/deployments/20260907-risk-1usd/`; build cũ `backend/dist-pre-risk-1usd-20260907`. Giữ các thay đổi có sẵn trong working tree, chưa tạo commit/PR.

Phần kiểm tra cơ hội BTC vẫn tiếp tục: [screen 60 ngày với risk 1 USDT](../../audits/2026-09-07-entry-risk-1usd/screen-cost-sensitivity.json). Các kết quả và lý do blocked của nghiên cứu risk 2% trước đó đã bị thay thế về giả định vốn bởi yêu cầu mới này. Chưa nới pullback live khi chưa hoàn tất đánh giá giai đoạn khác; adaptive vẫn shadow.
