# Báo cáo Tổng kết các Thử nghiệm Nghiên cứu Tháng 10/2026 (Legacy Research Archives)

Tài liệu này lưu trữ tóm tắt kết quả, mục tiêu và giá trị kế thừa của các thư mục thử nghiệm độc lập trong `/home/ubuntu` được thực hiện từ ngày 09/10/2026 đến 23/10/2026 trước khi các thư mục tạm này được dọn dẹp để giải phóng dung lượng đĩa cho máy chủ.

Toàn bộ các báo cáo định lượng chi tiết, biên bản kiểm toán và code lõi tương ứng đã được tích hợp đầy đủ và đồng bộ trong kho lưu trữ chính `chuyen-gia-crypto`.

---

## 1. Chuỗi nghiên cứu Thu nhập Thụ động & Orderflow Binance (`binance-income-*`, 09–11/10/2026)
- **Các thư mục**: `binance-income-baselines`, `binance-income-research-2026-10-09`, `binance-income-research-2026-10-10`, `binance-income-research-2026-10-11-daily-1pct`, `binance-income-research-2026-10-11-v1-*`.
- **Mục tiêu**: Nghiên cứu khả năng sinh lời 1%/ngày từ chênh lệch funding rate, lưới vi mô (micro-grid) và lọc luồng lệnh (orderflow screen) trên Binance Futures.
- **Kết quả & Bài học**:
  - Tần suất giao dịch quá cao làm chi phí phí taker (0.05% - 0.07%) và trượt giá bid-ask ăn mòn phần lớn lợi nhuận gộp.
  - Xây dựng được module kiểm tra funding rate thực từ sàn (`/fapi/v1/premiumIndex`), sau này trở thành nền tảng của **Funding Rate Guard** (Phase 3) để loại trừ các coin bị âm nặng funding.
- **Báo cáo chi tiết hiện hữu**: `docs/audits/2026-10-09-shared-engine-four-arm-portfolio/`, `docs/audits/2026-10-10/`.

---

## 2. Chuỗi thử nghiệm CCT & Paper Integration (`futures-improvement-*`, `futures-cct-*`, 15–16/10/2026)
- **Các thư mục**: `futures-improvement-20261015` (~2.9 GB), `futures-cct-paper-integration-20261016` (~1.0 GB).
- **Mục tiêu**: Thiết kế cơ chế điều khiển hướng cố định (Constant Direction Control - CCT), phân bổ đệm trượt dốc (buffer allocation 11–16) và giảm đòn bẩy một phần (partial deleveraging) khi thị trường điều chỉnh.
- **Kết quả & Bài học**:
  - Mô hình CCT giúp giảm số lần đảo chiều whipsaw nhưng vẫn dễ bị kẹp vốn khi thị trường đi ngang kéo dài.
  - Nhận diện rõ hạn chế của việc phân bổ vốn tĩnh và đặt nền móng cho kiến trúc đa sleeve (chia vốn giữa Altcoin Momentum bắt sóng lớn và BTC Grid nhặt lợi nhuận vi mô).
- **Báo cáo chi tiết hiện hữu**: `docs/research/2026-10-15-futures-average-02pct-improvement.md`, `docs/research/2026-10-16-futures-cct-paper-integration.md`.

---

## 3. Khảo sát Top Trader Hyperliquid (`hyperliquid-leaderboard-*.json`, 12/10/2026)
- **Các file**: `hyperliquid-leaderboard-2026-10-12.json` (39 MB), `hl-0x0b-userFills.json`, `hl-0x6c-userFills.json`...
- **Mục tiêu**: Thu thập lịch sử khớp lệnh của các ví có PnL cao nhất trên sàn DEX Hyperliquid để giải mã chiến lược giao dịch thực chiến.
- **Kết quả & Bài học**:
  - Các ví có PnL cao và ổn định nhất đều sử dụng đòn bẩy danh mục thấp ($\le 1.0\text{x}$ - $1.5\text{x}$) và cắt lỗ dứt khoát ở mức 10% - 15% vốn vị thế.
  - Kết quả khảo sát đã được đúc kết thành quy tắc khống chế đòn bẩy danh mục an toàn $\le 0.9\text{x}$ trong **Dynamic Compounding** (Phase 5).
- **Báo cáo chi tiết hiện hữu**: `docs/research/2026-10-12-futures-aggressive-followup.md`, `docs/research/2026-10-12-futures-evidence.md`.

---

## 4. Chuỗi ổn định hệ thống Live, Phục hồi kỹ thuật & Telegram (`futures-live-*`, `futures-daily12-*`, 18–19/10/2026)
- **Các thư mục**: `futures-live-20261016`, `futures-live-review-20261018`, `futures-live-bugfix-20261018`, `futures-live-technical-recovery-20261018`, `futures-daily12-telegram-20261019`, `futures-telegram-alert-dedup-20261019`.
- **Mục tiêu**: Xử lý các lỗi gián đoạn tiến trình live, lỗi phân giải địa chỉ mạng, khử lặp cảnh báo Telegram (dedup) và bảo đảm tuân thủ trần lỗ ngày 12 USDT.
- **Kết quả & Bài học**:
  - Chuẩn hóa module gửi cảnh báo Telegram đa tầng (`hybrid-live-notice.ts`), không spam lặp lại mỗi nhịp tick.
  - Cơ chế tự đối soát (Reconciliation) mỗi 15 phút được kiểm nghiệm thành công và đưa vào mã nguồn production.
- **Báo cáo chi tiết hiện hữu**: `docs/research/2026-10-18-futures-live-hardening.md`, `docs/research/2026-10-19-futures-daily12-telegram.md`.

---

## 5. Chuỗi mô phỏng Sốc Tin tức & Bảo vệ Thiên nga đen (`futures-news-shock-*`, 19–20/10/2026)
- **Các thư mục**: `futures-news-shock-512d-20261020` (~547 MB), `futures-news-shock-protection-20261019`, `futures-news-protection-backtest-20261019`.
- **Mục tiêu**: Backtest 512 ngày tác động của lịch công bố tin tức vĩ mô (CPI, lãi suất Fed) và thử nghiệm tạm dừng bot trước giờ tin ra.
- **Kết quả & Bài học**:
  - Dừng bot theo lịch tin tức thường bỏ lỡ các đợt breakout mạnh mẽ sau tin và vẫn bị trượt giá nếu tin ra bất ngờ ngoài lịch.
  - Chiến lược tối ưu hơn là: Đặt sẵn lệnh điều kiện dừng lỗ cứng trên matching engine Binance sàn (`STOP_MARKET`) kết hợp **LLM Event Shield** (Phase 4) xử lý bất đồng bộ các rủi ro hack/delist.
- **Báo cáo chi tiết hiện hữu**: `docs/research/2026-10-19-futures-news-shock-protection.md`, `docs/research/2026-10-20-futures-news-shock-512-day-results.md`.

---

## 6. Đột phá Nghiên cứu ROI Dương & Kiến trúc Đa Sleeve (`futures-roi-*`, 20–23/10/2026)
- **Các thư mục**: `futures-roi-positive-research-20261020` (~125 MB), `futures-roi-plus-screen-20261021`, `futures-new-data-feasibility-20261023`.
- **Mục tiêu**: Tìm kiếm cấu trúc danh mục tạo ROI dương bền vững, vượt qua giai đoạn giam vốn chết (capital lock-up 0%).
- **Kết quả & Bài học Cốt lõi**:
  - Chứng minh thành công mô hình **Multi-Sleeve Hybrid**:
    * Sleeve 1: Macro Momentum Top 2 altcoins ($25 \times 2 = $50, SL 12%, rebalance 2 ngày).
    * Sleeve 2: BTC Mean-Reversion Grid ($15 \times 3 = $45 max, Crash Gate 5–6% đóng băng mua khi BTC sập).
  - Toàn bộ 1,485 ngày đạt Net **+276.75 USDT** (+68.1%/năm, mean +0.1864 u/ngày, 0 lần thủng trần rủi ro 12u). Cửa sổ 512 ngày đạt Net **+113.68 USDT** (+83.5%/năm).
  - Đây chính là cấu hình nền tảng được chính thức phê chuẩn Go-Live thành công ngày 24/10 và liên tục nâng cấp qua Phase 3, 4, 5, 6.
- **Báo cáo chi tiết hiện hữu**: `docs/research/2026-10-23-futures-aggressive-roi-breakthrough.md`, `docs/research/2026-10-24-futures-phase2-hourly-and-hybrid-audit.md`.

---
*Ngày lưu trữ tổng kết: 01/11/2026.*
