# CCT: vé lệnh hợp lệ không vượt giá trị sleeve yêu cầu — 20/10/2026

Đây là chẩn đoán chỉ đọc, **không chạy thêm backtest, ví hoặc chiến lược mới**. So sánh đúng hai bộ nguồn512ngày đã đăng ký, vốn tham chiếu cố định31,47744546u ở mọi ngày; dùng giá đóng ngày đã biết tương ứng `labelTimeMs` và năm bộ MARKET_LOT_SIZE/MIN_NOTIONAL của frozen market-context. Có189ngày target thực thi khác nhau giữa bản gốc và bản nhân5/n_active.

Câu hỏi hẹp: với giá trị sleeve yêu cầu `vốn_tham_chiếu × executionWeightsScalar6`, có thể tạo một vé tăng vị thế tròn lot **không vượt giá trị yêu cầu ấy**, đồng thời đạt minQty/maxQty/minNotional không? Lấy lượng làm tròn xuống rồi kiểm bộ lọc. Không tính margin, reserve, band, tồn kho, thay đổi equity, phí, funding, risk, thời điểm đặt lệnh hoặc PnL.

| Coin | Ngày nguồn dương | Vé DOWN đạt, bản gốc | Vé DOWN đạt, bản5/n_active |
|---|---:|---:|---:|
| BTC | 398 | 0 | 0 |
| ETH | 395 | 0 | 2 |
| BNB | 373 | 209 | 243 |
| SOL | 333 | 137 | 149 |
| XRP | 304 | 118 | 126 |

Theo phép kiểm hẹp này, số coin nguồn đang dương khác số sleeve có vé DOWN đạt bộ lọc. Có437ngày nguồn gốc và426ngày nguồn5/n_active mà ít nhất một sleeve dương chưa có vé DOWN đạt. Không được gọi các sleeve này là không thể giao dịch: tăng lượng lên mức tối thiểu có thể là một phương án khác của projector thực tế.

Tổng giá trị yêu cầu trên các cặp ngày-coin là14.407,890346u-ngày ở nguồn gốc và16.133,170567u-ngày ở5/n_active. Phần không thể biểu diễn bằng các vé DOWN đạt bộ lọc tương ứng67,2058% và65,6687%, bao gồm sleeve bị loại bởi bộ lọc và phần lẻ làm tròn ở sleeve đạt. Đây là **tổng giá trị yêu cầu cố định theo ngày-coin**, không phải tiền mất, tiền thực đầu tư, turnover, ROI hoặc tỷ lệ rủi ro của danh mục thật.

## Tại sao không được quy BTC thực tế bằng0 hoàn toàn cho minlot

Trong398ngày nguồn BTC dương, target tham chiếu nằm trong1,779694–32,156305u; một lot0,001BTC ở giá đã biết tương ứng60,2247–124,6285u. Vì vậy, không có vé DOWN dương không vượt target. Nhưng projector thật không chỉ làm tròn xuống: hàm `_candidates` còn xét mức tối thiểu, làm tròn lên, giữ nguyên vị thế và các endpoint khác; sau đó tối ưu chung danh mục và kiểm tra vốn/rủi ro.

Đã gọi **chỉ hàm tạo candidate thuần** từ bản frozen, không tạo engine hoặc xử lý financial frame:

| Ngày nguồn | Target BTC cố định(u) | Candidate dương nhỏ nhất(u) | Có candidate0 |
|---|---:|---:|---|
| 31/03/2026 | 1,779694 | 68,2415 | Có |
| 12/08/2025 | 32,156305 | 120,0810 | Có |

Candidate dương hợp lệ về bộ lọc tồn tại trong cả hai ví dụ và vượt target. Chọn0 hay candidate dương còn phụ thuộc hàm mục tiêu, vốn/margin, reserve, giá, tồn kho và các coin khác. Không được kết luận tài khoản31,48u không đủ đặt BTC chỉ từ notional của một lot, vì giao dịch Futures có đòn bẩy và cổng vốn riêng. Phép kiểm này chưa xác định nguyên nhân chính xác BTC bằng0 trong financial replay.

ETH bản gốc cũng không có vé DOWN đạt: target tối đa15,640202u dưới minNotional20u. Điều này tiếp tục nhấn mạnh screen không dự đoán các lệnh mà projector có thể làm tròn lên hoặc chọn mức tối thiểu.

## Kết luận có thể dùng và bước tiếp theo

Có chênh lệch rõ giữa số tín hiệu dương và các vé không vượt sleeve yêu cầu ở vốn nhỏ. Đây là cơ chế cần đo kỹ khi thiết kế phân bổ. **Không đổi n_active, loại BTC hoặc chọn coin thắng từ chẩn đoán này.** Một nguồn dùng số coin “đặt được” sẽ là chiến lược mới, cần thiết kế và đăng ký riêng, không phải sửa kỹ thuật vô hại. Cũng không được ngoại suy rằng chuyển hết phần target chưa biểu diễn sang coin khác chắc chắn tăng lợi nhuận.

Bước điều tra phù hợp là ghi từ projector thực tế: target mong muốn, tập candidate hợp lệ, mức lệch mục tiêu, phương án được chọn và lý do từ chối vốn/risk ở từng quyết định. Sau đó mới xác định phần nào do lượng tối thiểu, hàm mục tiêu, margin/reserve hoặc tồn kho. Chưa triển khai instrumentation đó trong nhiệm vụ này.

Giới hạn: dùng cùng snapshot bộ lọc hiện hành hồi tố, không có lịch sử thay đổi filter; dùng prior daily close, không phải giá execution. Trường config cũ cap15 trong market-context là lineage; script chỉ lấy symbol filters, không dùng hoặc sửa chính sách risk hiện hành12/−5,9/6,1/15giây. Không gọi sàn, thay live, sửa registered source hoặc đọc kết quả financial đang chạy.

`diagnose.py` tạo kết quả và3.606quan sát ngày-coin;5nhóm unit test đạt. `verify_and_examples.py` kiểm độc lập toàn bộ lượng/điều kiện bằng phân số chính xác và hash đầu vào, đồng thời minh họa candidate từ hàm frozen thuần. Các file đầu vào gắn SHA256 trong `results.json`; gói chẩn đoán được khóa bởi `manifest.json`.


[Gói bằng chứng đã khóa](../audits/futures-quick-win/roi-positive-cct-source-lot-feasibility-20261020/README.md).
