# Kết quả ngày 13/10/2026 — COMPLETE_SCREEN / NO_GO_COST_SCREEN

[Report frozen](../audits/futures-quick-win/spillover-20261013T141126Z/report.md): đủ 360 ngày training, protocol 338 files trước PnL,42 causal fits/184 model-days, audit độc lập PASS. Peers mean net base +0,002081%, stress −0,088819% trên normalized gross notional/ngày lịch; own âm cả hai. Daily-hold chưa qua gate vì stress mean âm, không phải vì CI chứa zero. Chưa kiểm tài khoản100u, ngân sách10u hoặc mean1u/ngày; không tune/chạy lại.

Screen hoàn tất sớm hơn lịch14–15/10. [Nhánh tiếp theo](2026-10-13-futures-peer-risk-replay.md) thử hypothesis mới về stop/sizing; đã có minute inputs và wallet/governor prototype, financialNOT_RUN. Trạng thái PLANNED/NOT_RUN của screen trong thiết kế ban đầu bên dưới là lịch sử.

# Kế tiếp: tín hiệu từ coin khác có thêm lợi thế sau chi phí không?

Ngày 13/10/2026 ICT. **PLANNED_NOT_REGISTERED_NOT_RUN**; chưa có goal công cụ hoặc scheduler. [Relative reversal vừa thử](../audits/futures-quick-win/cross-20261013T132038Z/report.md) NO_GO. Không chạy lại hoặc đảo hướng sau outcome. Giữ policy 100 USDT, chung cố định 10 USDT/ngày ICT, không cap số lệnh, chấp nhận ngày âm/dương và mean khoảng 1 USDT/ngày; không phục hồi rule cũ.

## Cơ chế và phạm vi

[Guo, Härdle, Tao](https://arxiv.org/html/2108.11921v1) nghiên cứu return lan truyền giữa coin có liên hệ. Gross spread 1,08% trong Table 4 chưa là net tài khoản Futures. **Proxy đề xuất là predictive regression đơn giản, không phải tái lập CASC của paper:** dự đoán return kế tiếp của mỗi coin bằng return của chính nó và các coin khác.

Dùng bảy coin cố định như screen vừa qua. So model có peers với control chỉ có own-return để biết thông tin liên coin có thêm giá trị. Không chỉ lật dấu rank return để cứu cấu hình vừa âm. Universe có survivor bias và không đại diện toàn thị trường.

## Thiết kế cần khóa trước PnL

- Training cần 360 ngày trước Jul2026. Lấy official Futures hourly từ 06/2025–09/2026; funding và terminal June–Sep đã có. Thiếu history không tự giảm cửa sổ hoặc dùng future data.
- Ridge với standardization trên training only, penalty 1, intercept không penalty; control cùng objective. Mỗi model/coin fit 360 daily labels đã đóng và biết trước refit. Refit đầu tháng, không chọn penalty/horizon theo PnL Jul–Sep. Protocol mới phải định nghĩa chính xác features, target, known_at, zero-variance và tie policy.
- Hai model, base/stress, 92 ngày ICT Jul–Sep. Đây là development đã xem. Chọn long forecast cao nhất/short thấp nhất, chia đều fractional notional; giữ tiền khi expected paired return không vượt chi phí stress đã khóa. Cùng entry/exit/funding/turnover/terminal cho model và control. Không tune hurdle sau outcome.
- Phí 0,05%/phía; slip base 0,02%, stress 0,10%; actual funding. Ngày 0 trade vẫn nằm trong 92. Normalized basket return không thay USDT/ngày hoặc NAV account. Kiểm ticket gồm BTC, không bỏ BTC chỉ vì rounding 50 USDT thất bại.
- Gate ưu tiên đã sửa ngày 13/10 sau khi rà soát quyền chấp nhận mạo hiểm: đánh giá từng model riêng. Net dương base/stress trong screen hợp lệ cho phép nghiên cứu replay tài khoản tiếp, kể cả interval chứa zero; ghi CANDIDATE_UNCERTAIN, không gọi xác nhận kỳ vọng. Cận dưới 95% và chênh lệch peers–control là thông tin đánh giá, không là điều kiện cấm thử. Own-return dương cũng có thể là ứng viên hệ thống. Net âm loại đúng cấu hình đo; thay stop/sizing/execution là hypothesis mới cần đăng ký, không chỉ nhân size rồi coi có edge. Lỗi đo → INCOMPLETE. Không tune theo validation đã xem.

## Tiến độ và cutoff

**14/10 dự kiến:** public inputs/checksum/training coverage và causal fit checks, tối đa 60 phút chủ động; bàn giao manifest hoặc INCOMPLETE. Chốt protocol/source/data và đối chứng trước return. **15/10 nếu inputs đạt:** một screen tối đa 30 phút; auditor riêng kiểm label availability/model objective/predictions/money và lưu terminal kể cả âm. Có thể làm sớm khi đủ gate; chưa tạo scheduler tự chạy.

Chỉ khi ứng viên đủ gate mới đăng ký replay tài khoản 100u liên tục: mark/minute, lot/margin/liquidation, governor chung 10u cho cả hai chân, funding và closeout/restart. Đo throughput bằng prefix trước main, tối đa 60 phút/case. Khi đó mới đo mean USDT trên mọi ngày lịch và mục tiêu 1u; không đồng nhất gross spread của paper với return tài khoản.

Nếu đạt, bàn giao changelist strategy/governor/execution/shared ledger và bằng chứng parity để cải thiện toàn hệ thống. Mọi nhánh dùng folder/registration mới, giữ artifacts cũ frozen. Không private API, paid LLM, orders, transfers hoặc runtime deployment. Quyền nghiên cứu đã có; chỉ hỏi khi đổi chính yêu cầu của người dùng hoặc cần quyền ngoài phạm vi.

## Chấp nhận mạo hiểm phải được kiểm trong thiết kế

[Review ngày 13/10](2026-10-13-futures-risk-acceptance-review.md) xác nhận các screen fractional chưa kiểm tài khoản 100u với stop/sizing và ngân sách chung10u. Từ ứng viên đáng thử, registration tài khoản phải chốt cả entry/exit lẫn sizing/stop/exposure/leverage theo ngân sách còn lại, gồm phí/funding/closeout; không mặc định sizing0,5%, trần3%/lệnh hoặc exposure100 cũ. Có thể nghiên cứu thiết kế dùng phần lớn ngân sách ngày khi margin và mô hình đóng vị thế cho phép; không bắt buộc phải tiêu hết10u. Các mức là tham số thử nghiệm, không là rule mới.

Nghiên cứu tham số trên development có thể có phạm vi hữu hạn được đăng ký trước; một config frozen hoặc mẫu validation đã xem không được sửa để tìm winner. Giữ mọi kết quả âm. Uncertainty, MDD và tỷ lệ ngày âm phải báo nhưng không tự biến thành gate người dùng chưa yêu cầu. Governor10 chung và kế toán đúng vẫn phải kiểm; chưa đủ bằng chứng không được gọi đạt1u/ngày.
