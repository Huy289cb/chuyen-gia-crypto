# Kế hoạch đo từng pha giám sát — 21/10/2026

Trạng thái: **DESIGN_ONLY — chưa implement, chưa chạy fault test mới, chưa triển khai.** Dựa trên [chẩn đoán đã hoàn tất](../research/2026-10-20-futures-projection-and-monitoring-diagnosis.md). Mục tiêu là biết vòng giám sát đang chờ ở đâu và giữ chính xác lý do đóng lệnh, trước khi chọn sửa cơ chế phục hồi. Chưa có bằng chứng tiết kiệm phí hoặc tăng PnL.

Giữ trần12u/ngày, soft−5,9u, dự phòng6,1u, monitoring15giây, quote5giây, cadence, mọi lần ghi bền và UNKNOWN/reconcile hiện hành. Live/user hold/savedbootstopped giữ nguyên. Kế hoạch này không cấp quyền bật live để lấy mẫu, không thay tín hiệu hoặc ảnh hưởng phép thử CCT tracking-cost512 đang chạy.

## Đường tích hợp tối thiểu

| Phần | Điểm sửa dự kiến | Cách kiểm tra |
|---|---|---|
| Observer thuần mới | `live-phase-observer.ts`: `offer(record):void`, clock và writer inject, dữ liệu primitive | Queue/bytes/counters có giới hạn; duration monotonic; không giữ wallet hoặc chờ disk/network trong vòng rủi ro |
| Service | `live-service.ts`: options có diagnostics sink tùy chọn, đo quanh các await vốn có trong observation/reconciliation/submission | Gọi public `advanceLivePortfolio` qua FakeBroker và temp ledger đang có trong `portfolio-live-service.test.ts`; không cần export private |
| Intent | Snapshot `decisionContext` một lần trước lần ghi PREPARED hiện có | Latch reason/stopReasons/observation gap/quote age/provenance được clone, không thay theo recovery/ACK; intent lịch sử thiếu field giữ unknown |
| Tick/status | Helper thuần bọc writer được inject; nối trong worker sau review | Đo đủ phần await status hiện bị loại khỏi tickDuration; giữ await/cadence và tên nghĩa trường cũ |

Không import entrypoint `live-worker.ts` vào test: top-level `dotenv.config()` vẫn có side effect dù main được guard. Không sửa helper ghi file dùng chung hoặc bỏ fsync để giảm thời gian.

Theo dõi riêng lock wait, REST account/positions, snapshot WS, validation, PREPARED write, identity/position preflight, SUBMITTING write, kiểm giá cuối, POST/ACK/UNKNOWN, final write và status write. Mỗi span có outcome kể cả lỗi/cancel. Dùng UTC để nối sự kiện và monotonic để tính duration; không nối monotonic qua restart hoặc giả thiếu duration bằng0.

Completion của một lần ghi không thể được chứng nhận trong chính bản ghi đã hoàn thành đó. Completion chỉ vào observer tùy chọn hoặc lần ghi tiếp theo có provenance. Mất trace khi crash không được coi là POST chưa xảy ra.

## Kiểm thử phải có trước triển khai

1. Observer bật/tắt cho cùng kết quả tài chính, quyết định, số/thứ tự write, anchor và cursor khi bỏ các field đo.
2. REST chậm có WS mới/stale: đo đúng thứ tự snapshot/validation, guard hiện hành vẫn chặn; chưa đổi thời điểm lấy snapshot trong patch đo.
3. PREPARED/SUBMITTING chậm hoặc lỗi: giữ write bền, quote quá5giây không POST, không tự retry.
4. POST không rõ kết quả, partial fill, ACK muộn/crash: UNKNOWN bền và chỉ đối soát, không gửi lại hoặc cộng phí/fill hai lần.
5. Reason qua recovery/ngày/restart: snapshot intent bất biến, không backfill hoặc clear financial latch.
6. Status writer20giây/reject: helper vẫn chờ đúng như cũ và đo đủ; test helper chưa chứng minh toàn scheduler.
7. Queue đầy/writer treo/lỗi/dữ liệu riêng tư: bounded/drop/error counters đúng, không lộ bí mật hoặc đổi nhánh tài chính.
8. Clock step/restart/thiếu mốc: duration đúng và unknown rõ ràng.

Đề xuất giới hạn để review, chưa phải cấu hình đã chọn:32spans/tick,60buckets aggregate, một aggregate mới nhất và bốn fault records đang chờ; một writer,4MiB/ngày, retention7ngày. Không timer từng pha/await recorder/Telegram từng mẫu. IO nền vẫn có chi phí; cần benchmark overhead trước tích hợp.

## Thứ tự thực hiện

A: observer/schema/clocks độc lập và unit tests → B: service spans/reason cùng fault tests/baseline comparison → C: tick/status helper và review wiring. Giữ coverage helper tách khỏi scheduler integration. Chưa đặt ngày triển khai vì chưa bắt đầu implementation; không coi bản thiết kế là vận hành24/24 đạt.

Sau khi có dữ liệu đo thật hợp lệ mới quyết định có cần sửa status writer hoặc thứ tự snapshot. Thay recovery rule/alpha/retry/cooldown/nới guard là nhánh khác. Không dùng phép thử512 chỉ mô phỏng giá để chứng nhận xử lý lỗi vận hành.

Thiết kế chi tiết và8hash nguồn tham chiếu: [gói kế hoạch](/home/ubuntu/futures-roi-positive-research-20261020/recovery-phase-instrumentation-plan/README.md). Gói đó không chạy model/test mới hoặc gọi API; các ma trận trên đều là việc còn phải làm.
