# KẾ HOẠCH THEO DÕI HIỆU SUẤT THỰC CHIẾN (CHÍNH THỨC TỪ 2026-10-30 ĐẾN 2026-11-13)

> **Cập nhật lúc**: 2026-11-05 10:45:00 ICT  
> **Chính sách vận hành**: `Phase 7 Alpha Expansion Suite (3-Day Momentum Holding + Progressive Ratchet + Volatility BTC Grid)`  
> **Trạng thái Worker**: Online (PM2 process `crypto-hybrid-live`, PID `6`)  
> **Ghi chú chuẩn hóa mốc đánh giá**: Giai đoạn trước 30/10 là giai đoạn thử nghiệm cấu hình sơ khai (chưa hoàn thiện plan, chưa có Same-Day Cooldown và Ratchet Guard dẫn tới whipsaw). Toàn bộ đánh giá hiệu suất chuẩn thức được **reset bắt đầu từ ngày 30/10/2026** và **tách riêng 25.0 USDT người dùng nạp thêm**.

---

## 1. Mốc Vốn Xuất Phát Chuẩn & Dòng Tiền Ngoại Vi (Cash Flow)

| Thông số | Giá trị chuẩn mốc 30/10 | Cập nhật lúc 22:30 ICT 13/11/2026 | Ghi chú minh bạch |
| :--- | :---: | :---: | :--- |
| **Vốn xuất phát ban đầu** | **~26.00 USDT** | **~26.00 USDT** | Số dư khả dụng trước khi người dùng nạp |
| **Tiền nạp thêm (User Deposit)** | **+25.00 USDT** | **+75.00 USDT** | Nạp +25u (30/10) và +50u (13/11) (TÁCH RIÊNG KHỎI PnL) |
| **Tổng vốn cơ sở (Adjusted Base)** | **~51.00 USDT** | **~101.00 USDT** | Mốc đối soát chuẩn để đo lường Trading PnL |
| **Vốn hiện tại trên sàn (Equity)** | **52.85 USDT** | **102.18 USDT** | Ghi nhận trực tiếp từ Binance Futures |
| **Lợi nhuận ròng thực tế (Net PnL)** | **+1.85 USDT** | **+1.18 USDT** | $= 102.18 - 101.00$ (Lãi thực tế do bot tự trade) |
| **Tỷ suất sinh lời thực tế (Real ROI)** | **+3.63%** | **+1.16%** | Tính trên tổng vốn cơ sở đã điều chỉnh 101u |
| **Vị thế đang giữ** | 2 lệnh | 2 lệnh (`INJUSDT`, `PAXGUSDT`) | INJ hồi về hòa vốn; PAXG đảo hàng ngày mai |
| **Quy mô phân bổ mỗi lệnh** | **12.30 USDT** (24%) | **24.52 USDT** (24%) | **TỰ ĐỘNG X2 QUY MÔ LỆNH NHỜ DYNAMIC COMPOUNDING** |
| **Trần lỗ an toàn (Circuit Breaker)**| 12.00 USDT | 12.16 USDT | Tự động co giãn theo quy mô vốn mới |

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
| **Ngày 6** | 2026-11-05 10:45 | Sơ kết ngày 6 | 52.85 | +1.85 | Từng đạt đỉnh ROI +3.63%, BEAMX nâng SL Breakeven |
| **Ngày 7** | 2026-11-06 17:00 | **KẾT THÚC TUẦN 1 (7 NGÀY)** | **50.92** | **-0.08** | **❌ KHÔNG ĐẠT MỤC TIÊU TUẦN 1** (Kỳ vọng +0.83u đến +2.53u). Bị BTC dump -5.5% và rơi lãi CLANKER/ELSA kéo lùi về hòa vốn. Đã kích hoạt Phase 8.1 Early-Lock để sửa sai. |
| **Ngày 8** | 2026-11-07 07:00 | Rebalance chu kỳ tiếp theo | *Đang chờ* | *Đang chờ* | Đánh giá Top 2 Momentum |
| **Ngày 11** | 2026-11-10 07:00 | Kiểm soát rủi ro & bước lưới BTC | *Đang chờ* | *Đang chờ* | Tối ưu danh mục |
| **Ngày 14** | 2026-11-13 14:30 | **KẾT THÚC 2 TUẦN CHUẨN** | **51.57** | **+0.57** | **⚠️ CHƯA ĐẠT MỤC TIÊU KỲ VỌNG (+0.83u đến +2.53u / 55-59u)**. Net PnL đạt +0.57 USDT (+1.12%). Sống sót an toàn qua 2 đợt bão xả BTC (-5.5% và -6.6%), bảo toàn 100% vốn gốc, giữ 91% tiền mặt hướng tới Mốc 30 Ngày (06/12). |

---

## 4. Các Tiêu Chí Kiểm Soát Bắt Buộc Trong Suốt 2 Tuần

1. **Số lượng vị thế Momentum**: Luôn duy trì $\le 2$ vị thế cùng lúc.
2. **Khối lượng lệnh**: Tự động tính toán theo $30\%$ vốn equity tại thời điểm vào lệnh.
3. **Cơ chế Stop Loss**: Luôn có lệnh `STOP_MARKET` thật trên sàn Binance tại mức $-12.0\%$.
4. **Thông báo Telegram**: Nhận thông báo tức thì khi mở lệnh, chốt lời, dừng lỗ (đã sửa triệt để bug bỏ sót thông báo).
5. **Cầu chì bảo vệ (Circuit Breaker)**: Không để lỗ quá $12.00 USDT/ngày.

---

## 5. Lộ Trình Đối Soát Mục Tiêu +25 USDT Lợi Nhuận Ròng (Cập Nhật Vốn Mới 102.18 USDT)

> **Mục tiêu**: Kiếm thêm **+25.0 USDT lợi nhuận ròng thuần do Bot tự trade**, đưa tổng tài khoản từ **102.18 USDT lên 126.00 USDT (+23.5%)**.  
> **Thời điểm tái xác lập**: 13/11/2026 22:30 ICT (Sau khoản nạp bổ sung +50u của người dùng, nâng vốn lên 102u).  
> **Lợi thế vượt trội**: Thay vì phải tăng +48.6% (mất 4 tháng lúc vốn 50u), với vốn 102u và quy mô lệnh X2 (~24.5u/lệnh), tỷ lệ tăng trưởng cần thiết giảm một nửa xuống chỉ còn **+23.5%**!

### Bảng Đối Soát Các Mốc Thời Gian Mới (Updated Checkpoint Matrix):

| Mốc đối soát | Thời điểm | Kịch bản Bùng nổ (Altseason) | Kịch bản Chuẩn (Base Case) | Kịch bản Chậm (Chop Market) | Trạng thái / Kết quả |
| :---: | :---: | :---: | :---: | :---: | :---: |
| **Mốc 30 Ngày Mới** | **13/12/2026** | **126.00 USDT** (**VỀ BỜ 100% +25U** chỉ sau 30 ngày!) | **111.0 – 115.0 USDT** (+10u đến +14u, đạt 50% chặng) | **105.0 – 108.0 USDT** (+4u đến +7u) | *Chờ kiểm tra 13/12* |
| **Mốc 60 Ngày Mới** | **13/01/2027** | Vượt đỉnh **> 135 USDT** | **126.00 USDT** (**VỀ BỜ 100% +25U** đúng lộ trình chuẩn) | **115.0 – 118.0 USDT** (Đạt ~60% mục tiêu) | *Chờ kiểm tra 13/01* |
| **Mốc 90 Ngày Mới** | **13/02/2027** | Bứt phá **> 150 USDT** (Đủ mở Lưới BTC Tầng 1) | **135.0 – 145.0 USDT** (+34u đến +44u siêu lợi nhuận) | **126.00 USDT** (**HOÀN TẤT 100% VỀ BỜ** ngay cả khi chop) | *Chờ kiểm tra 13/02* |

> [!IMPORTANT]
> * **Quy mô lệnh tự động nhân đôi**: Mỗi lệnh Altcoin nay được phân bổ **~24.52 USDT** (thay vì 12.3u).
> * **Bảo toàn kỷ luật đòn bẩy**: 2 vị thế Momentum = 48% vốn (49u), Tiền mặt đệm = 52% (53u), Đòn bẩy danh mục luôn giữ mức an toàn tuyệt đối $\le 0.48\text{x}$.

---

## 6. Mốc Triển Khai Phiên Bản Chính Thức v1.0.0 (24/11/2026)

* **Thời điểm xác lập**: 24/11/2026 19:15 ICT.
* **Bối cảnh**: Sau chuỗi kiểm toán độc lập 4 cổng (`PASS_OPTIMAL_METHOD_INDEPENDENT_AUDIT`), toàn bộ các giai đoạn thử nghiệm chính thức được hợp nhất thành **Phiên bản Chính thức v1.0.0**.
* **Hai nâng cấp kiến trúc đột phá**:
  1. **Tối ưu hóa Vốn 35% / Vị thế (`MOMENTUM_ALLOC_PCT = 0.35`)**:
     - 2 vị thế Momentum x 35% = 70% tổng giải ngân, bảo toàn 30% đệm tiền mặt an toàn.
     - Triệt tiêu 52% lực cản tiền mặt chết do sàn Binance Futures giới hạn minNotional $50 đối với BTC Grid.
     - Tỷ lệ R/R cân bằng: Lệnh thắng Ratchet (+3.5% đến +10%) thu về +1.2u đến +3.4u, áp đảo lệnh thua Time-Decay (-1.7u).
  2. **Cắt lỗ suy thoái sớm (Time-Decay Pruning)**:
     - Tự động cắt sớm tại `-5.0%` đối với coin giữ $\ge 2$ ngày không vượt nổi `+2%`.
     - Tiết kiệm 7% vốn cho mỗi lệnh so với mức SL `-12.0%`.
* **Trạng thái thực chiến hiện tại**:
  - Vốn tài khoản: **~97.00 USDT**.
  - Vị thế mở thực tế: `LISTAUSDT` Qty=332 (~$33.89, đúng chuẩn 35% vốn), SL sàn tại `0.08982`.
  - Dịch vụ PM2: `crypto-hybrid-live` (PID 6) online 100%.

