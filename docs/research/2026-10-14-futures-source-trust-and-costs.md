# Kiểm kỹ mức khoảng0,2u và khả năng áp dụng

14/10/2026. Người dùng thấy khoảng0,2u/ngày đáng thử, yêu cầu kiểm tin cậy, cải thiện và tích hợp hệ thống. **Giữ làm ứng viên nghiên cứu; chưa hứa0,2u ròng/ngày.** Mức1u/ngày vẫn là hướng phát triển trước đó;0,2u là mức người dùng chấp nhận đáng thử ở giai đoạn đầu, không tự đổi vốn100u hoặc ngân sách10u/ngày ICT.

## Tin chuẩn đến đâu?

| Phát biểu | Kết quả kiểm |
|---|---|
| Curve mô hình100→409,48445 được tính đúng | Có. Source nguyên byte và audit công thức riêng đã khớp60.000weights/ranks và1.500returns/equity |
| Dữ liệu giá có nguồn public kiểm được | Có. Audit mới đối chiếu56.648nến raw và CSV closes;3.352ô trống chỉ ở đầu chuỗi; không gap giữa/cuối hoặc nến cuối chưa đóng |
| Curve5x của tác giả được tái tạo chính xác | Chưa. Giá gốc tác giả không có trong commit; snapshot mới dùng cùng code/config |
| Tác giả đã kiếm mức đó trên tài khoản live | Chưa có bằng chứng trong bộ nguồn đã kiểm; repo này công bố nghiên cứu backtest |
| Tài khoản100u của hệ thống sẽ nhận0,2u/ngày | Chưa kiểm. Funding/slip/lot/margin, actual turnover và governor10u còn thiếu |
| Có cơ chế đáng thử tiếp | Có: mã/tín hiệu xác định rõ, dữ liệu và phép tính kiểm được; cần economic execution replay |

Các phép kiểm giữ nguyên98artifacts của source replication. Một anomaly phụ ở volume DYDX30/11/2023 được fetch public độc lập và trả cùng bản ghi; OHLC/close hợp lệ và strategy không dùng volume. Không sửa curve vì anomaly đó. [Evidence audit](../audits/futures-quick-win/source-trust-20261014T040315Z/evidence/report.md).

## Vì sao0,206 không phải lời hứa0,2u/ngày?

Nó là `(409,48445−100)/1500`, tức gain cuối mô hình tái đầu tư chia hàng ngày. Mean vốn đầu mỗi đoạn trên chính curve khoảng**238,95u**, không giữ exposure dựa trên100u suốt kỳ; source target gross bằng2×NAV. Mean source daily return khoảng**0,10925%**. Nhân riêng tỷ lệ này với100 cho số mô tả khoảng**0,10925u/hàng**, không phải backtest mới giữ NAV cố định. Hai con số nói về hai phép quy đổi khác nhau, chưa số nào là net wallet có governor10u.

Source đã trừ phí5bps×target-weight turnover, nhưng fee proxy bỏ phần rebalance do quantity/giá/NAV drift. Funding có thể trả hoặc nhận, chưa đo; slippage và end-liquidation/broker costs chưa đầy đủ. Không giả funding bằng0 hoặc gọi source gain là net thực thi.

[Saved-array diagnostics](../audits/futures-quick-win/source-trust-20261014T040315Z/receipts/source-statistics.json), không chạy lại strategy:

- 1.500hàng gồm778dương,691âm,31bằng0.
- 897/1.471cửa sổ30hàng dương;572âm. Median gain chỉ số rebased100 khoảng1,8344u/cửa sổ.
- 941/1.411cửa sổ90hàng dương;470âm. Median gain rebased100 khoảng5,6488u/cửa sổ.
- 98đoạn nắm giữ từ08/07/2026 sau ngày repo được tạo đến14/10/2026: chỉ số rebased100 lỗ khoảng**1,342785u**. Đây là kiểm hồi cứu theo mốc công bố, không phải prospective validation đã đăng ký.

Các rolling windows chồng lấn, không độc lập; rebasing giữ fee transition source từ đoạn trước, không mô phỏng entry mới. Không lấy tỷ lệ windows này làm xác suất thắng tương lai. Người dùng chấp nhận giai đoạn âm nên không tự loại chỉ vì một quarter âm; nó vẫn là bằng chứng mức thu nhập chưa ổn định.

## Những rủi ro suy rộng

Tác giả [thừa nhận](https://github.com/AbdullaE100/perp-quant-lab/blob/104dc669084b7f0d0a99748a0f4300950b49930d/research/README.md) survivorship bias, thiếu funding/alt slippage và phụ thuộc regime. Danh sách40cột hiện tại không chứa mọi coin từng có trong thị trường; số chuỗi có giá tăng29→40, chỉ925hàng cuối đủ40giá.

OOS70/30 đã được dùng so sánh11 rồi7biến thể trong repo. Nó hữu ích như thống kê lịch sử, chưa là holdout chưa xem của dự án. `MIN_BARS400` kiểm ở cuối snapshot, không phải400ngày trước mỗi lệnh. Không tự thêm400day trading filter vào bản sao. Source beta/corr BTC còn lệch holding-day index; dollar-neutral được xác nhận, market-risk neutrality chưa chứng minh bởi phép corr đó.

## Cải thiện gì mà giữ gần nguồn?

Ưu tiên target-delta execution, giữ inventory, charge fees/funding một lần, cache/persist recovery và giảm chi phí thực thi đo được. Lệnh limit/maker hoặc no-trade band là execution adaptation: có missed/partial fills và tracking error, không tự gán là tăng lợi nhuận. Đổi40coin, lookback14/30, lag, hướng trade hoặc gross2 là alpha/config khác; không làm ngầm.

Lot là điểm chặn thật. Theo snapshot trước, floor/omit làm gross200→98,72u và net+17,01u. Audit mới cho lower bound độc lập của nearest valid lot/zero, chưa ràng buộc neutrality/margin: sai lệch L1 ít nhất**70,5833u =35,29%source gross**. Nâng tất cả lên minimum tạo gross418,30u, không giữ tỷ trọng. Tăng exchange leverage không làm minimum quantity nhỏ đi.

Minimum là điều kiện order; snapshot trên là cold entry, không proof mọi position nhỏ phải đóng. Daily delta còn có minimum riêng, cần mark-price/filter timestamp và giảm/increase-risk order semantics. [Static portability audit](../audits/futures-quick-win/source-trust-20261014T040315Z/improvements/report.md).

## Áp dụng vào hệ thống cần gì?

[Audit integration](../audits/futures-quick-win/source-trust-20261014T040315Z/integration/report.md) chỉ đọc source, chưa xác minh live process/env/DB. Luồng scan hiện hardcodeBTC; V3 sizing theoSL/risk và yêu cầu entry/SL/TP; helper quantity có autoceil tới minimum. DB account theo symbol/method có thể nhân cùng exchange wallet khi cộng qua40account. Daily circuit hiện có percentage/fallback anchor và soft-block entry, không phải shared fixed10u governor.

Cần entry point portfolio riêng, giữ source alpha và dùng transport/WS/reconcile hiện có. Một wallet chung, một ngân sách10u, durable target-delta/rebalance IDs, ledger phí/funding/MTM, anchorICT không fallback và cancel/close/reconcile khi hết ngân sách. Portfolio UI phải hiển thị targets mong muốn/vị thế thực/chi phí/budget, không trưng model409 như tiền live.

[Kế hoạch triển khai có đầu ra](../plan/2026-10-14-futures-momentum-paper-integration.md) ưu tiên adapter offline+feasibility, rồi account replay và prospective paper. Chưa có financial run mới hoặc sửa backend/runtime trong lượt kiểm này; không private API, orders, transfers hoặc paid LLM.
