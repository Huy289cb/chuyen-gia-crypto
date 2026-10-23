# Tích hợp CCT vào hệ thống paper —16/10/2026

**Đã tích hợp trong mã; chưa bật CCT làm chiến lược mặc định.** Kết quả tài chính một ví128 ngày dương sau chi phí nhưng dưới mục tiêu0,2u/ngày. Bản đối chiếu kỹ thuậtV3 đã hoàn tất PASS:6.801.300 phép kiểm tiền, sai lệch0.

Ví ban đầu100u, được compounding; ngân sách lỗ10u cố định/ngày ICT chung cho toàn ví. Mọi ngày âm, dương và giữ tiền mặt đều nằm trong mẫu số. Không cap số lệnh hoặc khôi phục các rule ICT/SMC, cooldown, exposure100u, SL tối thiểu và cap mỗi lệnh cũ.

## Kết quả tài chính và điều kiện áp dụng

| Cửa sổ CCT6/buffer1,1 | Net cơ sở / chi phí cao | Net chia toàn bộ ngày |
|---|---:|---:|
| 64 ngày phát triển | +22,8721 / +18,8350u | +0,35738 / +0,29430u |
| 64 ngày liền trước | −2,8960 / −3,3653u | −0,04525 / −0,05258u |
| **Một ví liên tục128 ngày** | **+14,1381 / +12,6672u** | **+0,11045 / +0,09896u** |

128 ngày cần25,6u để đạt0,2u/ngày. Một ví chỉ được cấp100u một lần, không reset/đóng/nạp thêm ở điểm nối. Không cộng hai ví64 ngày để thay kết quả128. Ngày xấu nhất−9,6905/−9,4942u; modeled breach10u bằng0. Audit tiền độc lập **6.063.198 kiểm tra PASS**. [Báo cáo tài chính](2026-10-15-futures-average-02pct-improvement.md) giữ cả kỳ âm và các calibration; toàn128 ngày hiện đã biết, ứng viên mới dùng lại chỉ là phát triển.

Kết quả này chưa đủ điều kiện kinh tế người dùng yêu cầu. Nghiệm thu mã đạt cũng không tự cho phép gọi mục tiêu lợi nhuận đã đạt hoặc hạ mốc về0,1u/ngày.

## Những phần đã triển khai

- **Nguồn và thực thi:** CCT long/cash trên B5 BTC/ETH/BNB/SOL/XRP;9 kênh Donchian, vol90, lịch UTC; sizing6, band theo inventory thực20%, gross cap8 sau phí, leverage mô hình10. Chọn delta/lot hợp lệ bằng projector; giảm vị thế trước khi tăng. B5 và bộ ngân sách là thích nghi công khai, không gọi là bản sao nguyên cấu hình tác giả.
- **Engine dùng chung:** phiên bản `CCT_LC_B5_S6_BUFFER11_V1`, ngưỡng mềm−8,9u và ngân sách cứng−10u. Ledger giữ phí, funding, PnL và overshoot thật. Checkpoint/config hash momentum cũ được giữ; CCT có namespace riêng, không reset ví cũ.
- **Testbed:** khung1 phút, đúng timestamp funding kể cả phần mili giây, một ví liên tục128 ngày; so từng frame, event và summary với ledger Python đã khóa. Quantity/time phải khớp; tiền tolerance1e−20. Các metrics peak exposure ghi rõ chỉ lấy tại minute CLOSE; risk được kiểm ở mọi transition trong mô hình.
- **Provider/service/API/UI:** seed1500 ngày khóa hash, nối đủ closed daily bars và lưu cursor cùng ví. UTC row đã thử vẫn được đánh dấu consumed khi risk reject, tránh tự tái vào ở ICT reset. Ví mới khởi động trễ giữ tiền mặt đến UTC tiếp theo. Chặn quote cũ, thiếu funding mark và gap cần reconciliation; hai giao diện hiển thị đúng policy/window thực tế.

Rà soát còn sửa hai lỗi vận hành: CCT hỏi funding đủB5 sau khi đóng vị thế để phát hiện settlement công bố chậm từ inventory đã giữ; job và report phải khớp policy/window/protocol hash lúc xếp hàng, từ chối registry bị thay đổi.

## Kiểm tra và các bản đối chiếu

- Bộ74 tests/12 suites ban đầu PASS, gồm source, projector, engine, restart, provider, service, routes và hồi quy momentum. Source khớp **5120 weights và640 metadata rows**, projector có22 fixtures/27 tests.
- Sau sửa service/funding/protocol: **9 tests PASS**. Sau sửa Money40 và cache: **29 tests engine/testbed/legacy PASS**, gồm giá vốn tuần hoàn, partial close, cashflow/funding thay đổi cùng transition, risk sau funding và rollback.
- Scoped backend TypeScript cuối và scoped frontend TypeScript PASS. Full Next build chưa chứng nhận: có retry tải font bên ngoài và áp lực tài nguyên, đã giữ log của lần dừng.

| Bản TS128 | Trạng thái |
|---|---|
| V1 | Dừng có chủ đích tại21.600/184.320 phút để giảm sao chép dư thừa; giữ code và prefix; không tính PASS |
| V2 | Qua81 ngày rồi gặp sai lệch realized PnL: static Decimal.min tạo receiver20 chữ số thay Money40; lỗi được lưu cùng code/prefix; không tính PASS |
| V3 | **Hoàn tất PASS**:184.320 phút/ca,4.950 events,6.801.300 phép kiểm tiền, sai lệch0; sửa riêng receiver CCT, giữ rounding legacy |

ProtocolV3: `38de575b1bfab9fa9949349f316f7439b3ef5ebb1259d8e62e6125dd4d01e164`, khóa41 inputs. Giữ nguyên source/rổ/sizing/chi phí/ngân sách và tolerance; không nới sai số. Cache chỉ tái sử dụng operands bất biến và valuation/close reserve khi đầu vào chưa đổi, có invalidation khi marks/cash/funding/fills/rollback thay đổi; mọi risk check vẫn chạy. Đây là sửa bản tích hợp, không phải chạy lại nghiên cứu để chọn PnL thắng.

## Cấu hình và giới hạn vận hành

`PORTFOLIO_PAPER_POLICY=CCT_LC_B5_S6_BUFFER11_V1` chọn CCT; unset hoặc `momentum-v1` giữ legacy. `PORTFOLIO_PAPER_ENABLED=false` chặn advance. CCT dùng child namespace policyId trong data directory. `PORTFOLIO_CCT_TESTBED_REGISTRY` chỉ nhận operator-registered/hash-pinned windows `dev64`, `prior64`, `continuous128`; HTTP không được sửa vốn, risk hoặc đường dẫn.

**Chưa deploy, đổi flags/PM2/default hoặc gửi lệnh thật.** Paper polling60s không replay mọi lệnh/biến động bỏ lỡ; gap hoặc provider403 có thể chặn tiến trình. Funding overlap một giờ không chứng minh coverage cho publication trễ tùy ý. Filters hiện hành, margin đồng nhất và khớp đủ ngay vẫn là giả định mô phỏng; modeled breach0 không bảo đảm trần10u liên tục ngoài thị trường.

Gói mã và receipts: [audit package](../audits/futures-quick-win/cct-paper-integration-20261016T014700Z/README.md). Workdir giữ ledger lớn: `/home/ubuntu/futures-cct-paper-integration-20261016/`. Handoff chi tiết nằm trong `service-ui/implementation-and-operation.md` của workdir.

## Nghiên cứu tiếp theo

Ledger xác nhận7 khoảng chờ7 giờ sau ICT reset, tổng49 giờ lịch dù có source đã biết. Đo MARK riêng từng mã trong các khoảng này cho19 endpoint tăng và16 giảm; không tính lệnh, source weights hoặc PnL. Funding tại/sau mốc00:00 nằm ngoài phép đếm khoảng chờ và vẫn phải xử lý đúng timestamp nếu có phiên bản tái vào. Chưa có bằng chứng hook đó tăng mean hoặc giữ ngân sách.

Kỳ64 ngày yếu có0 lần dừng rủi ro và trading PnL trước phí đã âm; không quy toàn bộ điểm yếu cho bộ dừng. Cấu hình rổ gốc và phương pháp khác đã có hồ sơ khả thi nhưng tạm hoãn để tập trung một đối chứng. [Lộ trình](../plan/2026-10-15-futures-average-02pct-improvement.md) chốt câu hỏi, giới hạn30 phút replay/15 phút audit, cách kiểm ngân sách và quyết định kết thúc đợt. Chưa có PnL đối chứng mới.

## Điểm chốt và bước kế tiếp

Nghiệm thu CCT kỹ thuật đã kết thúc; baseline128 vẫn dưới mục tiêu. Đối chứng constant-direction sau đó **đã chạy xong hai ca**: cơ sở+0,288328u/ngày nhưng worst−11,102854u và2 ngày vượt10u được kiểm chứng độc lập, nên loại cấu hình. Stress engine+0,148828u/ngày, worst−14,371738u; audit stress chưa xong do cap15 phút. Không có PASS audit toàn bộ. Đợt đã chốt, không retry/thêm nhánh hoặc đổi default. [Báo cáo và phạm vi kiểm chứng](2026-10-16-futures-constant-direction-control.md) giữ kết quả, mã và nguyên nhân; rổ rộng/KPSS tiếp tục tạm hoãn.
