# Đối chứng bỏ bộ lọc hướng CCT — kết quả16/10/2026

**Đã implement và chạy xong hai ca128 ngày; loại cấu hình này vì vi phạm ngân sách10u/ngày đã được xác nhận độc lập ở ca cơ sở.** Chưa bật chiến lược mặc định hoặc gửi lệnh thật. Toàn bộ kết quả và mã được giữ nguyên.

| Mức chi phí | CCT gốc: net/128 | Đối chứng: lãi ròng | Đối chứng: net/128 | Mức lỗ ngày sâu nhất | Phạm vi kiểm chứng đối chứng |
|---|---:|---:|---:|---:|---|
| Cơ sở: fee5bp, slip2bp | +0,110454u/ngày | +36,905960u | **+0,288328u/ngày** | **−11,102854u** | Độc lập toàn ca PASS; ngân sách FAIL,2 ngày vượt10u |
| Cao: fee7bp, slip5bp | +0,098963u/ngày | +19,050024u | +0,148828u/ngày | −14,371738u | Engine hoàn tất; kiểm toán độc lập chưa xong do giới hạn thời gian,3 ngày engine báo vượt10u |

Mục tiêu128 ngày cần net≥25,6u, chia đủ mọi ngày lãi/lỗ/cash. Cơ sở vượt mức lợi nhuận nhưng không giữ được ngân sách; chi phí cao còn thiếu cả mean mục tiêu theo engine. Không dùng kết quả cơ sở dương để công bố chiến lược đã đạt. Một trường hợp vi phạm ngân sách đã kiểm chứng đủ để loại cấu hình; không cần giả toàn bộ hai ca đã kiểm toán PASS. Bản CCT gốc64 ngày đạt0,3574/0,2943u/ngày và bản một ví128 ngày0,11045/0,09896u/ngày vẫn giữ nguyên.

## Đã triển khai những gì

Một phiên bản constant-direction B5 BTC/ETH/BNB/SOL/XRP: ép9 trạng thái hướng thành+1, giữ vol90, scalar6, per-sleeve cap2 trước scalar, inventory band20%, grosscap8/leverage10, buffer1,1, UTC-only và một vốn100u/case xuyên suốt08/06–13/10ICT. Không reset/nạp ở ranh giới64 ngày, không tái vào ở ICT reset, chỉ đóng toàn bộ cuối kỳ. Việc ép count9 cũng bỏ ngoại lệ band theo thay đổi count; đây không phải đo riêng alpha hay so sánh rủi ro thực tế bằng nhau.

Giữ nguyên9 định nghĩa engine/processor của bản Python đã đối chiếu TS128. Source được kiểm độc lập640 ô volatility và5.120 weights.19/19 tests chuẩn bị PASS:10 source/static/Spy và9 tình huống rủi ro nội phút. Một phép kiểm thêm trên ledger gốc3 ngày/case khớp60.684 giá trị tiền với sai lệch0; prefix này không có fill, nên không dùng nó thay chứng nhận toàn ca.

Auditor Decimal50 mới tái dựng mọi điểm quan sát rủi ro trong mô hình từ raw minute/funding và các lệnh đã ghi: OPEN, ICT roll trước/sau reset, funding theo batch/đúngms, target fills/rejects, adverse, CLOSE và hoàn tất toàn bộ flatten. Mỗi worst/breach của frame và ngày phải khớp dưới1e−12. Driver chạy tiến trình riêng, bắt buộc Decimal40/HALF_EVEN. Target orders là đầu vào được ghi; không chứng minh tối ưu toàn cục của projector hoặc đường giá tick thật.

## Phạm vi hoàn tất và điểm dừng

Protocol `a41769e53524a37677dc5a18d208d953e15da0cae9155e5257518f739ef22ec6` khóa347 actual inputs trước PnL;575 dòng ancestor chỉ là provenance. Đã kiểm lại toàn bộ347 hashes sau chạy. Đúng một lần chạy hai ca,184.320 phút/case và1.920 funding actualms/case; không fallback funding MARK, không sweep hoặc retry.

Replay hoàn tất trong887,9 giây gồm khởi động/kiểm inputs, phần vòng lặp868,97 giây. Audit giới hạn900 giây; SIGINT rồi dọn tiến trình10 giây, kết thúc tổng911,4 giây, mã thoát−9. Dòng `constant_direction_base PASS 305 fills;net ...` chỉ xuất sau khi toàn bộ kiểm tra tiền128 ngày và `intrastep.finish(daily)` của ca cơ sở đã qua. Ca chi phí cao bị ngắt trong quá trình kiểm tra, không có PASS. Không có `independent-audit.json` toàn bộ; reporter đầy đủ giữ nguyên trạng thái **INCOMPLETE_EVIDENCE**. Quyết định phạm vi riêng **REJECT_VERIFIED_BASE_DAILY_BUDGET_FAILURE** không biến phần thiếu thành PASS.

Bộ điều phối thực thi cap30 phút replay/15 phút audit, không tự chạy lại. Đợt nghiên cứu này đã chốt; không mở thêm phép thử để tìm kết quả thắng. Chưa đổi PM2, flags, policy mặc định, ví hoặc lệnh thật.

## Nguyên nhân cụ thể đã lưu

Ca cơ sở có2 ngày vượt10u. Ngày22/08ICT nặng nhất: tại bước adverse, observedNet là−5,213887u và close reserve là5,888968u; đóng vị thế đưa net đến−11,102854u. Ca cơ sở đã được kiểm chứng độc lập, nên đây không chỉ là số engine tự báo. Buffer1,1u của cấu hình này không đủ bù đường đi giá MARK/giá thực thi và chi phí đóng trong mô hình.

Ca chi phí cao có3 ngày engine báo vượt10u; ngày07/10ICT, observedNet trước đóng đã−12,635963u, reserve1,735775u, sau đóng−14,371738u. Các giá trị ca này vẫn là **engine-only**, chưa kiểm toán đầy đủ. Không cắt khoản lỗ về−10u hoặc bỏ ngày này khỏi mẫu số.

Bỏ trạng thái cash/hướng làm tăng lợi nhuận so baseline ở cả hai mức chi phí theo engine, đồng thời đổi exposure, turnover, band và các lần dừng. Không quy toàn bộ chênh lệch thành alpha hoặc riêng phí. Nếu có đợt nghiên cứu sau, cần một thiết kế mới giải quyết rủi ro thực thi nội phút trước khi tăng sizing; không đổi ngân sách10u hoặc gọi cấu hình này đạt chỉ vì ca cơ sở vượt0,2. Rổ rộng/KPSS tiếp tục tạm hoãn, chưa có PnL từ các nhánh đó.

## Bằng chứng

[Gói nguồn và receipts](../audits/futures-quick-win/constant-direction-20261016T121748Z/README.md). Workdir `/home/ubuntu/futures-cct-paper-integration-20261016/constant-direction-control-128/` giữ ledger lớn. `control-output-manifest.json` giữ hash tất cả output; `control-verdict.json` giữ trạng thái audit toàn bộ chưa hoàn tất; `control-decision-scoped.json` giữ quyết định loại và phạm vi đã chứng nhận; `control-risk-diagnostics.json` giữ mọi ngày vượt ngân sách và latch contexts. Dữ liệu128 ngày đã dùng phát triển, không gọi là kiểm tra ngoài mẫu.
