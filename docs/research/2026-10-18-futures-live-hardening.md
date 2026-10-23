# Kiểm tra sâu và sửa tiếp worker Futures thật — 18/10/2026

**Đã triển khai 18:30:55 ICT, worker PID 2380719.** Tiếp nối [bản vá trước](2026-10-18-futures-live-bugfix.md), đã sửa thêm chín nhóm lỗi dưới đây. Giữ nguyên chiến lược/vốn thực, trần15u/ngày, soft−8,9u/buffer6,1u, freshness5giây và guard giám sát15giây.

## Lỗi và hành vi sau sửa

| Nhóm lỗi | Bản sửa và kiểm chứng |
| --- | --- |
| Thu nhập dương của hôm trước công bố muộn qua nửa đêm ICT tạo lãi ảo hôm nay | Mốc ngày mới dùng vốn phân bổ từ số dư xác thực trước khi khấu trừ khoản dương chưa phân loại. Chỉ điều chỉnh transfer khi có provenance mới và timestamp trước lúc bắt đầu đọc tài khoản; transfer trong lúc phản hồi đang về không được làm giảm nhầm mốc. 9 ca kế toán ngày, gồm chuyển tiền ±/dedup/restart/legacy và hai race mili giây. |
| Giám sát vẫn chạy nhưng lịch sử lỗi hoặc công bố trễ hơn24giờ làm mất khả năng truy tìm giao dịch cũ | Lưu mốc lịch sử đã áp dụng và khớp cash/fills, độc lập mốc giám sát nhanh. Không tiến mốc khi API trả rỗng mà cash/fill còn lệch. Ví cũ chưa có mốc đọc lại từ lúc khởi tạo; chia truy vấn dài thành đoạn≤7ngày, giữ pagination và giới hạn request. |
| Lỗi truy vấn intent cũ không biến mất dù lịch sử đã chứng minh fill đầy đủ | Dọn snapshot/lỗi query đã hết nhu cầu; kết quả query lỗi đến muộn không ghi lỗi trở lại intent đã đối soát. Full fill xác thực xóa lastError cũ. |
| GET kiểm tra trước POST thất bại làm PREPARED kẹt vĩnh viễn | Chỉ terminalize thành REJECTED sau xác nhận không có lệnh và journal chứng minh submittedOnce=false/orderIdnull/khối lượng thực thi0. Không phát lại nguồn hoặc leg cũ; UNKNOWN sau khả năng POST vẫn bị chặn, không gửi trùng. Có ca sync, background thật và đối chứng UNKNOWN. |
| Một coin mất giá nhưng coin khác vẫn phát khiến channel không reconnect | Watchdog kiểm tra từng coin sau10giây, làm mới kết nối theo generation; không làm mới timestamp giá hoặc nới freshness/guard. |
| Telegram đã ACK nhưng lưu kết quả thất bại, hoặc bản ghi sending bị kẹt | Giữ ACK trong bộ nhớ để lưu lại trước khi gửi tiếp; lease30giây và kiểm tra sender/in-flight cho bản ghi mồ côi. Retry không gửi lại ACK đã biết; trường hợp chưa rõ công khai khả năng trùng. |
| Bỏ báo cáo ngày khi21:00 thiếu quan sát mới hoặc restart qua lịch | Lưu lượt báo cáo còn chờ, tự hoàn tất bằng quan sát mới đúng ngày, dedup theo ngày. Lịch cố định hằng ngày có gửi bù sau restart. |
| Lỗi nguồn che cảnh báo lệnh UNKNOWN/PARTIAL đồng thời | Ghi độc lập cả hai nhóm lỗi, giữ debounce; ACK FILLED đang chờ bình thường không bị gán thêm lỗi giả. |
| Chỉ observe kiểm tra chủ ví, timer/flush có thể xử lý nhầm outbox khác | Kiểm tra schema/policy/account/vốn-khởi-tạo trước/sau mọi mutation và khi hoàn tất ACK. Không drain outbox đã bind trước khi biết chủ ví; vẫn cho phép bootstrap error không chứa dữ liệu ví. Kiểm thử store khác chủ và thay store giữa lúc gửi. |

## Bằng chứng kiểm thử

**215 kiểm thử khác nhau PASS, 0 fail; scoped TypeScript và cú pháp bốn module triển khai PASS.** Đã loại trùng giữa các lượt chạy. Bao gồm service31, kế toán ngày9, background24, quotes13, notifier58, recovery22, monitoring8, snapshot5, worker-source16, Telegram-format10 và transport19. Đây là phạm vi liên quan bản sửa, không phải toàn bộ backend.

Đối chứng chạy trực tiếp hàm tài chính compiled cũ và candidate trong bộ nhớ, không broker/network/ví/lệnh thật: funding hôm trước+1u chưa công bố, sau đó lỗ thực hôm nay15,4u trên ví giả100u. Bản cũ báo−14,4u và không khóa; candidate báo đúng−15,4u, khóa fixed_daily_loss_observed, giữ ngân sách15u. Không phải khoản lỗ xảy ra trên ví thật.

Các kiểm tra chạy tuần tự ưu tiên thấp, có guard dừng tiến trình kiểm tra nếu tuổi quan sát vượt7giây. Biên dịch dùng CPU riêng, đã trả affinity của worker về0,1. Không test bằng cách đặt lệnh thật hoặc gây lỗi lên worker live.

## Triển khai và đối soát

Chỉ thay bốn module live-service/background/quotes/telegram cùng source map; sao lưu trước khi thay. Restart riêng worker, PID 2303579→2380719; .env không đổi, PM2 đã save, API online, legacy/paper/post-exit stopped.

Đối chiếu checkpoint bảo toàn config, định danh/handoff, vốn, toàn bộ trades/incomes/intents/vị thế, phí/realized/funding, cursor/source, mốc ngày và khóa tài chính. Mốc historyThroughMs mới là tiến độ đối soát; không reset sổ tiền hay lịch sử.

Sàn xác nhận **18:31:12 ICT**:

- Vốn đầu 31.47744546u; cash 31.15669644u; equity theo giá lúc chụp 31.63736206u.
- PnL tổng gồm thả nổi 0.1599166u; phần thả nổi 0.48066562u. Đây là snapshot biến động, không phải mean lợi nhuận đã chứng nhận.
- Phí 0.20139548u; realized -0.11601u; funding -0.00334354u; các kiểm tra tiền/fill/ownership đều PASS.
- 22fills/20intents, không lệnh chờ. Giữ long BNB0,04/ETH0,009/SOL0,16/XRP10,4; không có lệnh do triển khai.
- Mốc ngày 31.28582681u, riskLatched=false, ngân sách15u.

Theo dõi **18:31:09–18:33:08 ICT**, 60 mẫu: tất cả active, blocked=0, lỗi nền=0, khóa rủi ro=0, quote chưa sẵn sàng=0. Gap median 1994.5ms/max 2697ms; tick lớn nhất 987ms. Fills/intents không đổi, cash luôn đối soát0.

Telegram: 76ACK, pending0, failed0; đủ22 thông báo trade/22fills. Outbox đúng chủ ví. uncertain5 là lần gửi từng thiếu ACK rồi được xử lý, không phải số tin đang chờ và không bảo đảm không có tin trùng.

## Giới hạn và việc tiếp theo

Giữ nguyên các mốc ngày legacy/explicit vì không được dựng lại provenance thiếu; cơ chế anchor mới áp dụng khi có quan sát tạo ngày mới. Transfer xảy ra trong khoảng đọc tài khoản không được dùng để hạ mốc: có thể làm số liệu thận trọng hơn, tránh tự tạo thêm ngân sách lỗ. Mọi khóa tiền/worst/breach vẫn bền vững, không tự gỡ vì khoản công bố muộn.

Gửi bù lịch cố định hằng ngày được hỗ trợ; cron tùy biến chỉ khôi phục lượt callback đã ghi nhận, không suy lịch khi process tắt. Không dùng NAV ngày mới để lấp báo cáo ngày cũ. Gián đoạn dài, race đổi ngày và lỗi lưu ACK đã được thử ngoại tuyến; không khẳng định chúng đã xảy ra trên tài khoản thật.

Tiếp tục quan sát báo cáo21:00ICT, đổi ngày00:00ICT và lượt nguồn07:00ICT kế tiếp; không tạo lệnh thử, không mở nghiên cứu/goal mới. Bản sửa vận hành không thay tiêu chí lợi nhuận. [Gói bằng chứng đã khóa checksum](../audits/futures-quick-win/live-hardening-20261018/README.md). Backup/checkpoint riêng tại /home/ubuntu/futures-live-hardening-20261018; rollback mã không được restore ví cũ.
