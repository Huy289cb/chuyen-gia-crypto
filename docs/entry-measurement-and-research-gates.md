# Entry measurement và cổng nghiên cứu — bản triển khai 14/09/2026

## Trạng thái

Mã candidate đã tích hợp vào source; không thay backend/dist đang chạy, không restart, không đổi risk hoặc bật chiến lược mới. Chính sách theo runtime-risk-policy.md. Toàn bộ test suite ở lần chạy kiểm chứng đạt781, bỏ qua4; các kiểm thử bổ sung cuối cùng và build được lưu trong audit implementation kèm theo.

## Measurement

`entry-trace.ts` dùng AsyncLocalStorage riêng cho mỗi dispatch/execution. Mỗi lần dispatch có trace_id, observation_key khớp bar key của funnel, candidate_key nếu retest, decision_id khi đã lưu, lane, policy_hash và code_hash của cây source/build trên đĩa tại lần đầu đo trong process. Chạy build từ thư mục bất biến để fingerprint có ý nghĩa; hash trên đĩa không chứng minh các module đã load đều giống file nếu operator sửa build đang chạy.

Event `entry_trace` ghi dispatch_started → feasibility_before_ai → pre_ai_passed → plan_geometry/ai_veto → decision → dispatch_result → admission_started → quantity_checked → risk_checked → order_submitting → order_pending/admission_rejected. Những nhánh dừng sớm chỉ có các stage đã thực sự chạy, không dựng stage còn thiếu. Cached decision có nhãn riêng. Request/result có request_id chung và trace context; nhiều request/retry không tính thành nhiều cơ hội.

`pending_order_linked` lưu ID liên kết kể cả caller không có decision_id. Fill đọc lại link đúng order_id trong DB, không còn tìm mò30 link gần nhất. `entry_order_filled` có linkage_status; lịch sử không có link ghi legacy_or_missing. Lỗi lưu telemetry được cảnh báo; không hủy/đặt lại lệnh để sửa báo cáo. Không tự backfill ID cho quyết định997 bằng sự gần nhau về thời gian.

Provider metadata chỉ lưu model/host/status/latency/token/cost và IDs, không lưu prompt/credential/response trong telemetry chung. Usage cost không có thì null; response clone giúp caller vẫn đọc được payload. Chi phí ở provider result nối theo request_id; mọi request thiếu result/cost vẫn unknown. Review AI opportunity có bản ghi cost riêng; không cộng bản ghi review và provider thành hai lần phí.

## API

- `GET /api/metrics/entry-traces?days=1`: trace/decision/order/fill, request và cost chưa nối, paired retest, known cost. Cửa sổ tối đa30ngày, giới hạn10000 event có cờ truncated và malformed; chỉ kết luận trên dữ liệu đã đọc. Fill trong cửa sổ có thể trỏ decision ngoài cửa sổ.
- `GET /api/metrics/gate-funnel?days=1`: giữ trường cũ would_pass_pre_llm để tương thích nhưng ghi rõ deprecated_all_gate_proxy_not_actual_provider_calls. Thêm measurement_version2, classifications, pre_ai_proxy_pass và feasibility. Dữ liệu schema1 không bị tính như schema2 đầy đủ.
- Proxy không thay thế gate executor. Thiếu side do không có setup được phân biệt với missing_data; gate phụ không đánh giá được vì thiếu side không gộp thành hàng trăm structure rejection thật.

## Feasibility trước AI

`observeEntryFeasibility` chỉ dùng nến đóng tại asOf, từ chối chuỗi thiếu/không liên tục/stale. Đo entry close hoặc confirmed retest, invalidation6nến, buffer0,01%, floorSL hiện hành, tick0,1 BTC và target đối ứng gần nhất trong các pivot đã xác nhận. Đây là **quy tắc chẩn đoán cố định**, chưa được duyệt làm chiến lược. Output phân biệt geometry_feasible, target_room, missing_target_bound, missing_data, no_setup; geometry feasible chưa bao gồm mọi gate tài chính/fill.

Funnel/dispatch ghi cutoff và trạng thái pivot bị xuyên nhưng bias chưa đổi. Stateful candidate lưu measurement gốc; khi confirmed có `retest_feasibility_pair` cùng candidate key, delta entry/target room, stop/target có đổi hay không và thời gian chờ. Legacy candidate đã lưu trước bản này thiếu measurement gốc nên paired=false. Chỉ quan sát cặp confirmed tạo selection bias; cần đọc thêm expired/invalidated/no-setup khi đánh giá tần suất. Chưa có cặp forward mới không thể kết luận retest cải thiện ROI.

SMA pullback ở dispatch nay loại nến mở như funnel. Các quan sát vẫn có thể khác tại timestamp khác, nhánh retest khác và proxy-entry khác entryAI; actual provider calls phải lấy events, không suy từ proxy.

Quantity resolver trả code missing_data/min_lot/min_notional/exposure; executor ghi raw/rounded qty, minQty, step, minNotional, headroom và risk cap/daily risk riêng. Các guard khác chưa có mã chuyên biệt giữ other_guard + reason, không ép vào nhóm risk.

Lane AI opportunity tiếp tục không gọi provider nếu không có plan hợp lệ; capture ghi diagnostic counters phân loại chi tiết hơn. Legacy AI sinh mức giá vẫn hoạt động theo guard hiện có: measurement mới ở trước AI là **observe-only**, không dùng quy tắc chẩn đoán chưa kiểm chứng để bật/tắt chiến lược. Không tăng quota, retry hoặc đổi model.

## Tái lập997 và đánh giá nghiên cứu

Từ backend:

```bash
./node_modules/.bin/tsx scripts/audit-entry-measurements.ts ../docs/audits/2026-09-14-development-review/provider-execution.json /tmp/decision-997-new-report.json
./node_modules/.bin/tsx scripts/research-promotion.ts freeze /path/spec.json /path/new-manifest.json
./node_modules/.bin/tsx scripts/research-promotion.ts evaluate /path/new-manifest.json /path/new-report.json /path/evidence.json
```

Mọi output dùng exclusive-create, không ghi đè freeze/báo cáo cũ. Các CLI offline không import DB/runtime/exchange. Freeze cần hypothesis, supportsFurtherResearch=true (attestation phải được review), protocolFile, supportingEvidence là danh sách file, consumedPeriods và evaluationPeriod có from/through Unixms. Từ chối evaluationPeriod chồng consumedPeriods. Hash toàn src/scripts/package-lock/tsconfig, protocol và bằng chứng; evaluate kiểm tra lại hash và kỳ đánh giá. Không tự mở reserved test, không tự sinh giả thuyết mới.

Schema đầy đủ: backend/src/backtest/research-promotion.ts. Evidence có base/stress; mỗi scenario có baseline/candidate trên cùng from/through và cùng vốn/cashflow. Trade cần waveId độc lập, closedAt, grossUsd, feeUsd, fundingUsd (signed cost), slippageUsd, aiCostUsd (null nếu unknown). Run ghi initial/final equity, nạp/rút, openEquityChange, unallocatedAiCostUsd và maxDrawdownFraction. Chi phí AI chưa gắn trade vẫn trừ; phải cấp vốn vào ledger đầy đủ, không chỉ trừ ở bảng tổng cuối cùng. Không cộng lại phí đã nằm trong grossUsd: gross ở đây là lợi nhuận giá trước mọi chi phí.

Gate đối soát equity với ledger, không coi vị thế cuối kỳ là miễn phí; yêu cầu ROI/delta dương cả base/stress, riêng cohort wave bổ sung có net expectancy dương, PF base≥1,2/stress>1, drawdown≤15% và không xấu hơn baseline, ≥100 lệnh độc lập mỗi scenario, tăng tần suất theo quy tắc đã ghi, ≥8tuần prospective và CI95% dương có điều chỉnh multiplicity. Base/stress không được cộng số lệnh. Unknown costs, duplicate waves, thời gian không hợp lệ và freeze mismatch đều chặn pass.

CI, independence và executionParity là đầu vào cần artifact nghiên cứu kiểm chứng; checker không tự chứng minh bằng booleans. `researchPass=true` luôn đi cùng `deploymentAuthorized=false`. Ledger đầu vào phải dùng risk/cooldown/lot guard trong replay hiện có; checker không phải một simulator thay thế. Một biến thể được refreeze sau khi xem kết quả không trở thành độc lập mới.

997 tái lập từ fixture ghi thật: SL0,664161%, RR1,068150, required target fraction tối thiểu2,4%; thiếu target bound và request→decision link không tự bịa. Đây là kiểm chứng hình học và provenance, không replay fill/PnL của một lệnh chưa từng được gửi.

## Tài liệu liên quan

- Đánh giá framework bổ sung: plan/2026-09-14-smc-volume-fibonacci-feasibility.md.
- Báo cáo paper v2 kết thúc: audits/2026-09-13-prospective-union/final-v2-report.md.
- Quyết định nghiên cứu cuối vòng trước: audits/2026-09-13-bounded-research/research-decision.md.


## Gói triển khai đo lường riêng

Đã chuẩn bị [gói measurement ngày 14/09](audits/2026-09-14-measurement-release/report.md), tách khỏi candidate đầy đủ. Gói giữ các trường funnel điều khiển cũ và xuất nhãn sửa vào `diagnostic_gates`/`diagnostic_blocks`. Chưa triển khai; không dùng kết quả build candidate rộng làm bằng chứng bản live đã thay đổi.


Gói riêng đã [triển khai ngày 15/09/2026 lúc 11:03 ICT](deployments/2026-09-15-entry-measurement/report.md). Trạng thái “chưa triển khai” trong gói niêm phong là snapshot lúc đóng gói; dùng manifest triển khai để xác định runtime hiện hành.


Cập nhật 15/09/2026: người dùng ưu tiên ROI+ sau chi phí, không bắt buộc RR3. Xem `docs/plan/2026-09-15-ict-net-expectancy.md`; các mô tả RR3 ở trên là baseline lịch sử, không phải cổng bắt buộc cho biến thể mới.
