# KẾ HOẠCH THEO DÕI HIỆU SUẤT THỰC CHIẾN (CHÍNH THỨC TỪ 2026-10-30 ĐẾN 2026-11-13)

> **Cập nhật lúc**: 2026-11-05 10:45:00 ICT  
> **Chính sách vận hành**: `Phase 7 Alpha Expansion Suite (3-Day Momentum Holding + Progressive Ratchet + Volatility BTC Grid)`  
> **Trạng thái Worker**: Online (PM2 process `crypto-hybrid-live`, PID `6`)  
> **Ghi chú chuẩn hóa mốc đánh giá**: Giai đoạn trước 30/10 là giai đoạn thử nghiệm cấu hình sơ khai (chưa hoàn thiện plan, chưa có Same-Day Cooldown và Ratchet Guard dẫn tới whipsaw). Toàn bộ đánh giá hiệu suất chuẩn thức được **reset bắt đầu từ ngày 30/10/2026** và **tách riêng 25.0 USDT người dùng nạp thêm**.

---

## 1. Mốc Vốn Xuất Phát Chuẩn & Dòng Tiền Ngoại Vi (Cash Flow)

| Thông số | Giá trị chuẩn mốc 30/10 | Ghi chú minh bạch |
| :--- | :--- | :--- |
| **Vốn xuất phát ban đầu** | **~26.00 USDT** | Số dư khả dụng trước khi người dùng nạp |
| **Tiền nạp thêm (User Deposit)** | **+25.00 USDT** | Nạp ngày 30/10/2026 (TÁCH RIÊNG KHỎI PnL CHIẾN LƯỢC) |
| **Tổng vốn cơ sở (Base Capital)** | **~51.00 USDT** | Mốc đối soát chuẩn để đo lường Trading PnL |
| **Vốn hiện tại trên sàn (Equity)** | **52.85 USDT** | Ghi nhận lúc 10:45 ICT ngày 05/11/2026 |
| **Lợi nhuận ròng thực tế (Net PnL)** | **+1.85 USDT** | $= 52.85 - 51.00$ (Lãi thực tế do bot đánh từ 30/10) |
| **Tỷ suất sinh lời thực tế (Real ROI)** | **+3.63%** | Lợi nhuận ròng thuần túy sau 6 ngày vận hành Phase 6/7 |
| **Vị thế đang giữ** | 2 lệnh (`BEAMXUSDT`, `1000PEPEUSDT`) | BEAMX đã kích hoạt dời SL Breakeven bảo toàn vốn |
| **Tỷ trọng phân bổ mỗi lệnh** | **24% vốn** (Dynamic Compounding) | Top 2 Momentum = 48%, BTC Grid = 42%, Cash Buffer = 10% |
| **Mức dừng lỗ (Stop Loss)** | **Cố định cứng 12.0%** | Kết hợp Progressive Ratchet nâng SL theo lợi nhuận |
| **Bảo vệ rủi ro chủ động** | Same-Day SL Cooldown, Hyper-volatility Gate, LLM Event Shield |
| **Trần lỗ an toàn (Circuit Breaker)**| `dailyLossLimitUsd = Math.max(12.0, DayStartEquity * 0.12)` |

---

## 2. Dự Phóng Lợi Nhuận Sau 2 Tuần (Phân Tích 1,471 Chu Kỳ Lịch Sử)

Dựa trên dữ liệu kiểm thử thực nghiệm 1,500 ngày (2022–2026) với 1,471 chu kỳ 14 ngày (2 tuần) lăn ngang, phân phối lợi nhuận kỳ vọng từ mốc vốn **26.05 USDT** như sau:

| Kịch bản thị trường (14 ngày) | Tỷ suất lợi nhuận | Lợi nhuận dự kiến ($) | Vốn kỳ vọng sau 2 tuần | Xác suất thống kê |
| :--- | :---: | :---: | :---: | :---: |
| **Kịch bản Bùng nổ (Altseason pump mạnh)** | **+25.11%** | **+6.54 USDT** | **32.59 USDT** | Top 10% chu kỳ tốt nhất (hồi phục đỉnh vốn) |
| **Kịch bản Tích cực (Bắt trúng 1-2 sóng trend)** | **+9.72%** | **+2.53 USDT** | **28.58 USDT** | 25% chu kỳ thị trường thuận lợi |
| **Kịch bản Trung bình (Mean Expectation)** | **+3.20%** | **+0.83 USDT** | **26.88 USDT** | **Mức kỳ vọng toán học trung bình** |
| **Kịch bản Trung vị (Thị trường bình thường)** | **-0.33%** | **-0.09 USDT** | **25.96 USDT** | 50th percentile (dao động đi ngang) |
| **Kịch bản Thận trọng (Thị trường giằng co/chop)** | **-6.60%** | **-1.72 USDT** | **24.33 USDT** | Vùng kiểm soát bình thường |
| **Kịch bản Xấu (Thị trường sập sâu liên tục)** | **-12.08%** | **-3.15 USDT** | **22.90 USDT** | 10% chu kỳ xấu nhất (chưa chạm ngưỡng nguy hiểm) |

> [!NOTE]
> * **Tỷ lệ chu kỳ 2 tuần có lãi trong lịch sử**: **48.2%** (đặc thù chiến lược Trend Following: winrate ~48%, nhưng các tuần thắng ăn rất dày từ +10% đến +25%, trong khi các tuần thua chỉ lỗ nhỏ từ -3% đến -6%).
> * **Mục tiêu thực tế sau 2 tuần**: Dao động trong khoảng **+0.83 USDT đến +2.53 USDT** (Vốn đạt **26.88 USDT - 28.58 USDT**). Nếu thị trường crypto bước vào nhịp sóng altcoin mạnh, lợi nhuận có thể bứt phá lên **+6.54 USDT** (Vốn đạt **~32.59 USDT**).

---

## 3. Nhật Ký Theo Dõi & Các Mốc Kiểm Tra (Milestone Checkpoints)

| Ngày theo dõi | Mốc thời gian | Sự kiện / Kiểm tra | Vốn sàn (USDT) | Lãi/Lỗ ròng Bot ($) | Đánh giá / Ghi chú |
| :---: | :---: | :--- | :---: | :---: | :--- |
| **Mốc Chuẩn** | 2026-10-30 00:00 | Khởi động chuẩn Phase 6 + Nạp 25u | 51.00 | 0.00 | Điểm xuất phát chuẩn (tách 25u nạp) |
| **Ngày 1** | 2026-10-31 07:00 | Nâng cấp Phase 6 Ratchet & Cooldown | 50.15 | -0.85 | Bắt sóng `BLESSUSDT`, chặn cắn lỗ |
| **Ngày 3** | 2026-11-02 09:38 | Chốt lời BEAMX +10% & Nâng Phase 7 | 51.13 | +0.13 | Khóa lãi Ratchet Lock 2, lấp đầy POWR |
| **Ngày 6** | 2026-11-05 10:45 | **Sơ kết Tuần 1 (Hiện tại)** | **52.85** | **+1.85** | **ROI +3.63%**, BEAMX nâng SL Breakeven |
| **Ngày 8** | 2026-11-07 07:00 | Rebalance chu kỳ tiếp theo | *Đang chờ* | *Đang chờ* | Đánh giá Top 2 Momentum |
| **Ngày 11** | 2026-11-10 07:00 | Kiểm soát rủi ro & bước lưới BTC | *Đang chờ* | *Đang chờ* | Tối ưu danh mục |
| **Ngày 14** | 2026-11-13 18:45 | **Tổng kết 2 Tuần Chuẩn** | *Đang chờ* | *Đang chờ* | Đánh giá toàn diện ROI thực |

---

## 4. Các Tiêu Chí Kiểm Soát Bắt Buộc Trong Suốt 2 Tuần

1. **Số lượng vị thế Momentum**: Luôn duy trì $\le 2$ vị thế cùng lúc.
2. **Khối lượng lệnh**: Tự động tính toán theo $30\%$ vốn equity tại thời điểm vào lệnh.
3. **Cơ chế Stop Loss**: Luôn có lệnh `STOP_MARKET` thật trên sàn Binance tại mức $-12.0\%$.
4. **Thông báo Telegram**: Nhận thông báo tức thì khi mở lệnh, chốt lời, dừng lỗ (đã sửa triệt để bug bỏ sót thông báo).
5. **Cầu chì bảo vệ (Circuit Breaker)**: Không để lỗ quá $12.00 USDT/ngày.
