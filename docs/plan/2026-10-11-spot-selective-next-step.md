# Bàn giao kiểm tra và bước tiếp theo cho Spot

Kiểm tra ngày 11/10/2026, kết quả kỹ thuật ghi lúc `2026-10-11T03:28:47.655847+00:00` (10:28 ICT). Phạm vi người dùng: học những phần hữu ích của hệ thống công khai, nghiên cứu Spot trước tiền thật; ngân sách nghiên cứu Spot 15 USDT theo phân bổ khoảng 50/50. Đây không phải xác nhận số dư exchange hiện tại. Mục tiêu Futures cũ không được tiếp tục.

**Việc cần làm tiếp theo là nối bộ tạo tín hiệu hồi phục với dữ liệu thật và kiểm khả thi vào lệnh. Chưa chạy được backtest tài chính của cơ chế mới vì thiếu adapter/runner và chính sách thoát lệnh.** Không có run lịch sử mới được khởi chạy trong lượt kiểm tra này.

## Trạng thái đã kiểm chứng

| Thành phần | Trạng thái hiện tại | Bằng chứng và giới hạn |
|---|---|---|
| Tín hiệu hồi phục | Có `recovery5m_v1`: crossover SMA21/SMA200, RSI14 dưới50, bối cảnh EMA200 trên nến đóng1h/4h và BB width | `backend/spot_selective_lab/recovery.py`; là bản thích nghi tối thiểu từ NFI tag161, không tương đương toàn chiến lược NFI |
| Quyết định | Có packet, registry, parser BUY/WAIT/VETO, kiểm lại phí/risk/quote/account | `core.py`; response trong kiểm thử là fixture, chưa có client gọi AI thật |
| Chống trùng | Có SQLite claim trước review, chống trùng theo run/symbol/episode, giữ quyết định đầu tiên qua restart | `journal.py`; chưa có đối soát hóa đơn provider |
| Kiểm thử | 27/27 đạt hôm nay; mã không thay đổi trong kiểm tra | [status.json](../audits/2026-10-11-spot-selective-status/status.json), [tests.log](../audits/2026-10-11-spot-selective-status/tests.log) |
| Review độc lập | 34 kiểm tra synthetic PASS ở lượt trước; ba source hash hiện tại khớp review | `/home/ubuntu/binance-income-research-2026-10-10/spot-selective-lab-independent-review.json` |
| Backtest cơ chế mới | Chưa có | Chưa đo số tín hiệu lịch sử, số lệnh có thể đặt, PnL, expectancy hoặc tác dụng của LLM |
| Thực thi thật | Không có trong package này | Mọi lựa chọn trả `execution_permitted=false`; không có provider/broker/Telegram client |

44 file và13 tham chiếu trong artifact manifest V3 cũ đều còn khớp SHA256. Manifest SHA256 là `1ce7499394b984cb6bd5d626d95d67b182ec7dec533cb3f688bdcecb0046c396`. Việc này giữ nguyên bằng chứng lịch sử FAIL của trend4h/reversion4h; không biến chúng thành ứng viên sinh lời. Không sửa `AGENTS.md` hoặc artifact cũ trong lượt này; file này là bàn giao mới cho nhánh học thành phần.

Nguồn ý tưởng đã đọc và khóa trước đây: [Condor](https://github.com/hummingbot/condor/tree/45e60d6067bd311c154d7890c1ecc46f207b17e2) cho cách tách dữ liệu/quyết định/thực thi và journal; [NFI](https://github.com/iterativv/NostalgiaForInfinity/tree/918b34e3730496839a9aac670fee5c5b05039b84) cho entry nhiều khung. Public code và kiểm thử kỹ thuật không chứng minh lợi nhuận của bản thích nghi này.

## Bước1 — một lần kiểm tra khả thi vào lệnh, chưa đo outcome

Đầu ra cần trả lời ba câu: có bao nhiêu episode tín hiệu độc lập, bao nhiêu episode có kế hoạch vào lệnh hợp lệ với15USDT dưới giả định phí cơ sở/stress, và phần còn lại bị chặn bởi điều kiện nào.

1. Viết adapter mới, đáng tin cậy, chuyển `RecoverySignal` thành `Proposal/Evidence`. Giữ signal/episode ID, source hash và thời điểm thông tin đã sẵn có. Registry hash chỉ định danh phiên bản; không tự xác thực một proposal do caller viết tay.
2. Viết bộ gom nến streaming từ SOL1m thành5m/1h: đúng UTC, đủ phút, không gap/duplicate, chỉ phát nến đã đóng. Dùng SOL4h công khai đã xác minh làm bối cảnh4h. Kiểm tính bất biến khi thêm dữ liệu tương lai và kiểm lỗi dữ liệu trước khi coi toàn run hợp lệ.
3. Dùng lại `spot_aggressive_v3.dataset.iter_bars` và `ResearchAccount.plan_entry` nguyên trạng. Viết runner F-only riêng: runner V3 hiện chỉ nhận trend4h/reversion4h và không dùng trực tiếp cho recovery.
4. Đăng ký trước source/config/data hash, phạm vi, quote/filter giả định, tiêu chí, cutoff và định dạng output. Sau QA kỹ thuật mới đóng băng nguồn và chạy đúng một scan; không sweep tham số.

Dữ liệu sẵn có: `/home/ubuntu/binance-income-research-2026-10-10/new-model-data-aggressive/manifest.json`, trạng thái lưu `COMPLETE_VERIFIED`,90 archive SOL1m/SOL4h/BTC4h,01/04/2023→01/10/2025 exclusive. Parser khai báo ms trước2025 và microseconds từ2025; không đoán đơn vị. Archive5m/1h chưa có ở bộ này, nhưng có thể gom từ SOL1m mà không tải thêm. Lượt kiểm tra hôm nay đọc manifest và kiểm hash artifact; không parse lại toàn bộ90 archive.

Thiết kế đề xuất cho scan đầu tiên:

| Nội dung | Cố định trước scan |
|---|---|
| Cơ chế/cặp | `recovery5m_v1`, SOLUSDT, long Spot |
| Warmup | 01/04/2023→31/12/2023; bảo đảm200 nến đóng4h trước vùng đếm |
| Vùng đếm | 01/01/2024→30/09/2025; dữ liệu retrospective đã dùng nghiên cứu, không gọi là holdout mới |
| Tài khoản chẩn đoán |15USDT, inventory0; mỗi episode kiểm độc lập ở trạng thái ví trống, không tạo fill/ledger PnL |
| Giới hạn chẩn đoán | Mua tối đa12USDT, giữ ít nhất3, risk/headroom tối đa1,50; một vị thế trong replay tài chính sau này |
| Phí giả định | BUY0,1% thu SOL, SELL0,1% thu USDT; rounding/step/tick theo planner đã khóa |
| Hai scenario | Slip mỗi phía0,1%/delay30s cơ sở;0,3%/delay120s stress |
| Quote | First1m open tại/sau signal+delay; adapter chỉ đưa open/time đã biết tại thời điểm đó, không đưa high/low/close chưa đóng |
| Filter scenario | minNotional5USDT, step0,001SOL, tick0,01; ghi rõ chưa xác minh lịch sử filter/phí và không tự gọi chúng là giá trị Binance hiện tại |
| Reference minimum | Áp thêm gate quantity × WAP của5 phút hoàn tất trước quote, cùng điều kiện proxy như V3; proxy thiếu/không hợp lệ phải reject |
| Stop/hurdle | Stop close−2ATR; hurdle close+4ATR là chẩn đoán chi phí, `target=None` |
| Output | Episode/admission JSONL, summary theo scenario/tháng/reason, input/source hash, elapsed/memory và trạng thái COMPLETE/FAILED/INCOMPLETE |

`SelectionLab.packet` hiện chưa có WAP/reference-minimum gate trong quote schema. Runner mới cần lưu riêng admission của planner và admission sau conditional-reference gate; không tự coi packet hiện có đã kiểm hết filter hoặc âm thầm đổi schema. Signal sát cuối coverage không còn quote phải ghi `NO_QUOTE_WITHIN_COVERAGE`, không lấy dữ liệu ngoài kỳ.

Count ở trạng thái ví trống là **giới hạn trên** của cơ hội có thể đặt trong sổ liên tục: chưa xét occupancy, lỗ ngày hoặc tiền đã mất. Không đổi tên admissible thành fill/close; không dùng việc khởi tạo ví chẩn đoán từng episode để báo lợi nhuận.

Một cutoff cho toàn scan phải được chốt trong registration sau khi chuẩn bị adapter; gợi ý600 giây tính cả startup/QA inputs, không phải cam kết đã đo tốc độ. Quá cutoff ghi INCOMPLETE, không tự gia hạn hoặc suy luận hiệu quả chiến lược từ prefix.

Điều kiện quyết định: lỗi dữ liệu/adapter/nguồn hoặc coverage thiếu làm run không hợp lệ. Nếu không có tín hiệu thì báo tần suất cơ chế; nếu có tín hiệu nhưng không có admission ở một scenario thì giải thích ràng buộc trước bước tài chính. Có admission chỉ cho phép đánh giá tiếp, chưa chứng minh có edge. Báo sample size và khoảng thời gian không giao dịch; ngưỡng30closed của protocol cũ không tự thành bằng chứng thống kê hay yêu cầu người dùng cho nhánh mới. Nếu muốn giữ protocol30closed, dưới30 admissible chắc chắn không đủ, còn trên30 vẫn không bảo đảm30 fill/close.

## Bước2 — chốt thoát lệnh rồi mới backtest lợi nhuận

Sau kết quả khả thi, chọn và đăng ký **một** policy thoát lệnh có cơ chế: hard stop, điều kiện chốt/thoát theo nến đóng, max hold, gap/slip, stop ưu tiên khi cùng nến và xử lý inventory nhỏ. Hiện recovery chỉ phát tín hiệu; `4ATR` chưa là TP và không được tự chuyển thành TP trong báo cáo.

Runner tài chính mới phải dùng chung planner/ledger Decimal, ví15USDT liên tục toàn kỳ, phí cả hai phía, latency, position occupancy, daily headroom, rounding/dust và mọi quyết định bỏ qua. Không reset ví theo tháng, không cộng PnL từng lệnh chẩn đoán. Chạy cơ sở/stress cùng version, báo net, drawdown, expectancy, số episode/fill/close và ngày không giao dịch. VPS/fee/filter/fill fidelity chưa xác minh là unknown hoặc scenario; không báo lợi nhuận kinh tế toàn hệ thống khi thiếu chi phí.

## Bước3 — đánh giá riêng tác dụng của AI

Khi có candidate stream và replay vận hành đúng, mới chuẩn bị so sánh lựa chọn bằng quy tắc với BUY/WAIT/VETO của LLM trong hai sổ riêng cùng vốn/risk/cost. Lưu quyết định trước outcome, hạch toán mọi lượt model kể cả WAIT/lỗi; đối soát billing và khóa model/prompt/cutoff. LLM hiện tại trên lịch sử cũ có thể biết outcome từ training, nên historical LLM replay không là bằng chứng forward sạch.

Không có lý do mở loạt model/prompt hoặc kết nối giao dịch thật trước khi trả lời bước1 và2. Lượt kiểm tra này không gọi AI trả phí, private API, chuyển tiền, gửi Telegram hoặc đổi runtime.

## Hành động kế tiếp duy nhất

**Triển khai adapter nến/RecoverySignal và runner F-only, đăng ký rồi chạy một scan hữu hạn theo đặc tả đã chốt.** Sau đó trả số liệu thực về tín hiệu, admission và lý do reject để quyết định có đáng làm replay tài chính. Không cần thêm demo synthetic hoặc dựng dịch vụ24/24 để giải quyết câu hỏi này.
