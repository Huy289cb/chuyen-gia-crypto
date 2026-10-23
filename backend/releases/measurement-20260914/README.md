# Gói đo lường entry — 14/09/2026

Trạng thái: đã đóng gói và kiểm tra; **chưa triển khai**. Gói ghép 16 file JavaScript đo lường vào bản `dist` đang chạy, loại 16 file khác của candidate. Không có migration hoặc thay đổi môi trường.

## Phạm vi và kết quả kiểm chứng

- Nối trace tín hiệu → AI → admission → pending order → fill; giữ thiếu liên kết lịch sử là thiếu dữ liệu, không suy đoán bằng timestamp.
- Bổ sung phân loại thiếu dữ liệu/setup/TP, min lot, exposure và risk. `diagnostic_gates` và `diagnostic_blocks` dành cho báo cáo; các trường funnel cũ vẫn phục vụ quyết định với giá trị cũ. Đây là điểm quan trọng vì retest đang sử dụng funnel để điều khiển giao dịch.
- Đo khoảng SL/TP hợp lệ và trước/sau retest. Core SL 0,8%, RR3 tương ứng TP tối thiểu 2,4% trước chi phí; số đo này không phải bằng chứng ROI dương.
- Loại khỏi gói: AI opportunity lane, đổi cách chọn nến SMA, guard quantity mới và thay đổi hành vi các trường funnel cũ.
- 56 kiểm tra qua: checksum/cú pháp/phụ thuộc; đối chiếu AST điều khiển executor; 30 trường hợp quantity, 10 executor, 12 funnel. Exchange và DB được giả lập, không gửi lệnh thật. Đây là kiểm tra tương đương trong phạm vi đã thử, không phải chứng minh mọi hành vi runtime.
- Diễn tập apply → rollback trong thư mục tạm khôi phục chính xác baseline. Có kiểm tra từ chối target bị sửa hoặc còn tiến trình chạy.
- Decision 997 đã tái lập ở audit trước: SL khoảng 0,664%, RR khoảng 1,068; không đủ core floor/RR. Hai provider call lịch sử chưa có liên kết nhân quả, không gán vào decision bằng suy đoán.

## Kiểm tra gói

Chạy từ thư mục repository:

```bash
python3 backend/scripts/measurement-release-control.py verify --package backend/releases/measurement-20260914
python3 backend/scripts/measurement-release-control.py preflight --package backend/releases/measurement-20260914 --target backend/dist
python3 backend/scripts/measurement-release-control.py rehearse --package backend/releases/measurement-20260914
```

Preflight chỉ đọc. Gói có `baseline/`, `release/`, toàn bộ checksum trong `manifest.json`, đầu vào candidate và `measurement.patch`. Builder lưu kèm cho phép dựng lại từ baseline và candidate-inputs. Không chạy build toàn bộ source bẩn vào `dist`. Baseline là JavaScript thực tế đang triển khai, không phải Git HEAD; source map không chứa source gốc. Các bản sửa rộng hơn vẫn ở candidate riêng.

## Trình tự triển khai có kiểm soát

1. Kiểm tra lại trực tiếp vị thế và lệnh chờ trên exchange ngay trước cửa sổ triển khai; snapshot trước đó không thay thế kiểm tra này. Đối chiếu DB và môi trường thực API/worker với `docs/runtime-risk-policy.md`: BTC, cooldown 1h, ngày 10%, mỗi lệnh tối đa 3% gồm phí/trượt giá, target sizing 0,5%, cap USD rỗng. Không in secret.
2. Xác định đúng PM2 daemon quản lý `crypto-api` và `crypto-worker`. Dừng worker rồi API, bảo đảm không có cơ chế khác tự khởi động lại trong lúc thay thư mục. Công cụ không tự dừng hoặc khởi động PM2.
3. Chạy preflight: target phải khớp baseline và `stopped: true`. Sau đó:

```bash
python3 backend/scripts/measurement-release-control.py apply --package backend/releases/measurement-20260914 --target backend/dist
```

4. Kiểm tra target khớp release rồi khởi động lại API/worker bằng `backend/ecosystem.config.cjs` với `--update-env` trên đúng daemon; xác minh riêng môi trường hai tiến trình, health, scheduler, trace và lỗi log trước khi lưu PM2. Không gửi lệnh để smoke test. `/entry-traces` dưới router metrics chỉ có sau triển khai.
5. Theo dõi tính đầy đủ trace, latency, memory, lỗi DB/provider trong 24h. Chi phí AI chưa biết phải là unknown, không tính bằng 0. Retest có thêm truy vấn dữ liệu H4; telemetry có thêm xử lý response/ghi sự kiện nên vẫn cần theo dõi overhead.

Nếu cần rollback: dừng worker/API, giữ chúng dừng trong toàn bộ quá trình, chạy lệnh dưới đây rồi xác minh baseline và khởi động lại cùng môi trường đã kiểm tra:

```bash
python3 backend/scripts/measurement-release-control.py rollback --package backend/releases/measurement-20260914 --target backend/dist
```

Công cụ giữ bản code vừa thay trong thư mục backup cạnh target. Việc đổi thư mục gồm hai rename; nếu bị ngắt giữa chừng và target thiếu, rollback khôi phục từ baseline đã kiểm tra. Không phục hồi DB cũ, không xóa lịch sử lỗ/cooldown/quota. Nếu checksum khác dự kiến, công cụ từ chối để điều tra trước.

## Sau khi phép đo ổn định

Thu thập cửa sổ quan sát độc lập với quy tắc đóng băng. Báo cáo tỷ lệ kế hoạch hợp lệ, nguyên nhân loại, khoảng TP khả dụng, độ trễ cấu trúc và thay đổi entry sau retest. Chưa đủ dữ liệu thì chưa kết luận lợi thế.

Chỉ chọn một giả thuyết có bằng chứng để thử H4/H1 → M15. Volume Profile, OB/FVG/EQH/EQL và Fibonacci cần định nghĩa máy kiểm chứng được, chỉ dùng thông tin tồn tại tại thời điểm quyết định. Fibonacci Extension không tự chứng minh TP có khả năng đạt. Chưa đưa đồng thời tất cả vào điều kiện bắt buộc vì có thể giảm cơ hội.

Đánh giá ngoài mẫu với quy tắc và chi phí đóng băng: ROI sau phí giao dịch, funding, slippage và AI phải dương ở cơ sở lẫn stress; nhóm lệnh bổ sung cũng phải có expectancy dương. Không công bố xác suất thắng nếu chưa hiệu chuẩn trên dữ liệu ngoài mẫu. Sau đó mới đánh giá AI chọn giữa các kế hoạch đã hợp lệ.
