# Kết quả theo yêu cầu giữ cấu hình nguồn —14/10/2026

[Source-fidelity report](../research/2026-10-14-futures-source-fidelity.md): đã chạy nguyên backtest3.py40mã/rank weights/gross2/daily rebalance/lag/fee5bps trên1500dailyrows public mới. Independent auditPASS toàn bộweights/returns/equity. Chỉ số quy100→409,48445;92 đoạn Jul–SepUTC rebased100→96,12189. Không tái lập authorprices chưacôngbố hoặc accountICT10u.

Ticket snapshot hiện tại:26/40targets100u không đủminimum. EXACT_EXECUTABLE100_NOT_READY; không bỏweights/tăngvốn hoặc tự đổientryexit chofit. Grid chưapublicconfigđủ đểverifiedreplica. Kế tiếp execution/risk compatibility với mọi lệch tối thiểu được công khai, accountadaptation NOT_REGISTERED_NOT_RUN; khôngscheduler/toolgoal. Nội dung feasibilityPLANNED bên dưới giữ nguyên như snapshot trước lượt này.

# Kế tiếp: kiểm khả năng áp dụng danh mục nguồn trước PnL

Ngày14/10/2026. **PLANNED_NOT_RUN**, sau [hai V1 đã thử](../audits/futures-quick-win/method-trials-20261013T152454Z/report.md). Chưa scheduler hoặc toolgoal. A tập trung một cặp âm; B grid theo market trigger âm sau phí. Không promote, sweep hoặc sửa kết quả frozen.

Phạm vi vẫn là một tài khoản ban đầu100u, ngân sách chung10u cố định mỗi ngày ICT, không cap số lệnh, chấp nhận âm/dương và kỳ vọng khoảng1u/ngày lịch. Không xin lại quyền bỏ rules cũ. Wallet/governor được dùng qua derivative có version, giữ nguyên bản đã chạy.

## Đầu ra trong khung làm việc tối đa60 phút

1. Pin code/universe ở revision `104dc669084b7f0d0a99748a0f4300950b49930d` của [Perp Quant Lab](https://github.com/AbdullaE100/perp-quant-lab). Lập bảng đối chiếu momentum14/vol30 sample, rank/demean/gross2, lag và forward-return alignment, lịch cập nhật weights, turnover và phí. Nêu khác biệt với A tập trung/giữ cặp; không gán đường vốn tác giả cho bản mới.
2. Kiểm listing/history, daily features từ hourly, funding/mark coverage và minimum tickets của đúng universe nguồn. Không thêm/bỏ coin theo PnL hoặc leaderboard thắng. Thiếu dữ liệu phải hiện trong receipt, không forward fill.
3. Tính ticket/margin/risk feasibility tại các decision snapshots từ thông tin đã biết; chưa tính strategy returns. Với100u và weights nguồn: floor lots/minimum, phần giữ tiền, hedge imbalance, tổng margin. Gross2x là tham số nguồn, không giới hạn của người dùng. Nếu cần sizing/leverage khác để hợp100u, ghi là extension và khóa trước outcomes; không gọi là replica.
4. Bàn giao READY_FOR_NEW_REGISTRATION hoặc INCOMPLETE_INPUT_OR_EXECUTION với số liệu cụ thể. Chưa launch PnL khi timing/weights còn mơ hồ. Nếu đủ điều kiện mới lập financial protocol riêng; development đã xem không trở thành fresh holdout.

Mốc14/10 là khung dự kiến, có thể làm khi đủ điều kiện; không tác vụ tự chạy hoặc cam kết tìm được lợi nhuận trong một giờ.

## Nhánh grid sau feasibility nguồn

B chỉ hoạt động khoảng3% phút, có51ngày bằng0 và dùng ít phần rủi ro được phép. PnL tại reference prices dương nhỏ, net âm do chi phí. Trước V2 cần nguồn/config hoặc hypothesis entry/exit mới có lý do, cùng feasibility về fills, costs và eligibility. Limit/maker cần missed/partial-fill model và phí được xác nhận. Không thay phí trên cùng fills rồi gọi là backtest chiến lược dương. Được nghiên cứu mạo hiểm hơn theo shared10u; không hứa tăng leverage tự sửa net âm.

Các nhánh này chưa chạy. Private API, orders, transfers, paid LLM và runtime deployment không thuộc lượt feasibility này.
