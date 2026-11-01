# KẾ HOẠCH THEO DÕI HIỆU SUẤT 2 TUẦN (2026-10-29 ĐẾN 2026-11-12)

> **Cập nhật lúc**: 2026-10-29 18:45:00 ICT  
> **Chính sách vận hành**: `PHASE2_HYBRID_MOM50_BTCGRID45_SL12_V1` (Cấu hình Max Alpha - Lựa chọn 3)  
> **Trạng thái Worker**: Online (PM2 process `crypto-hybrid-live`, PID `6`)

---

## 1. Mốc Vốn Xuất Phát & Thông Số Chiến Lược

| Thông số | Giá trị khởi điểm |
| :--- | :--- |
| **Vốn tài khoản (Equity)** | **26.05 USDT** |
| **Vốn khả dụng (Available)** | **26.05 USDT** |
| **Vị thế đang giữ** | 0 lệnh (Sẵn sàng mở mới theo tín hiệu) |
| **Tỷ trọng phân bổ mỗi lệnh** | **30% vốn** (~7.82 USDT/lệnh ở mức vốn hiện tại) |
| **Mức dừng lỗ (Stop Loss)** | **Cố định cứng 12.0%** |
| **Bảng xếp hạng Momentum** | **Raw 14-day Return** (săn top 2 altcoin bùng nổ mạnh nhất) |
| **Ngưỡng lọc biến động (Hyper-Vol)** | **ATR14 $\le$ 20.0%** (chặn coin rác, đón siêu sóng 14-18%) |
| **Bảo vệ rủi ro chủ động** | Same-Day SL Cooldown (chặn coin cắn SL tái vào lệnh), Khóa cứng tối đa 2 vị thế |
| **Trần lỗ an toàn (Circuit Breaker)**| 12.00 USDT/ngày (bảo vệ tuyệt đối tài khoản) |

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

| Ngày theo dõi | Mốc thời gian | Sự kiện / Kiểm tra | Vốn thực tế (USDT) | Lãi/Lỗ lũy kế ($) | Đánh giá / Ghi chú |
| :---: | :---: | :--- | :---: | :---: | :--- |
| **Khởi điểm** | 2026-10-29 18:45 | Kích hoạt cấu hình Max Alpha | 26.05 | 0.00 | Điểm xuất phát theo dõi |
| **Ngày 2** | 2026-10-31 07:00 | Chu kỳ Rebalance đầu tiên | *Đang chờ* | *Đang chờ* | Kiểm tra Top 2 Momentum |
| **Ngày 4** | 2026-11-02 07:00 | Rebalance chu kỳ 2 | *Đang chờ* | *Đang chờ* | Đánh giá PnL mở |
| **Ngày 7** | 2026-11-05 18:45 | **Sơ kết Tuần 1** | *Đang chờ* | *Đang chờ* | So sánh với mốc kỳ vọng trung bình |
| **Ngày 9** | 2026-11-07 07:00 | Rebalance chu kỳ 3 | *Đang chờ* | *Đang chờ* | Tối ưu danh mục |
| **Ngày 11** | 2026-11-09 07:00 | Rebalance chu kỳ 4 | *Đang chờ* | *Đang chờ* | Kiểm soát trần rủi ro |
| **Ngày 14** | 2026-11-12 18:45 | **Tổng kết 2 Tuần** | *Đang chờ* | *Đang chờ* | Đánh giá toàn diện ROI & Hiệu suất |

---

## 4. Các Tiêu Chí Kiểm Soát Bắt Buộc Trong Suốt 2 Tuần

1. **Số lượng vị thế Momentum**: Luôn duy trì $\le 2$ vị thế cùng lúc.
2. **Khối lượng lệnh**: Tự động tính toán theo $30\%$ vốn equity tại thời điểm vào lệnh.
3. **Cơ chế Stop Loss**: Luôn có lệnh `STOP_MARKET` thật trên sàn Binance tại mức $-12.0\%$.
4. **Thông báo Telegram**: Nhận thông báo tức thì khi mở lệnh, chốt lời, dừng lỗ (đã sửa triệt để bug bỏ sót thông báo).
5. **Cầu chì bảo vệ (Circuit Breaker)**: Không để lỗ quá $12.00 USDT/ngày.
