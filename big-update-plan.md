# Big Update Plan: Binance Futures Trading Bot

Dự án này nhằm xây dựng một hệ thống giao dịch tự động trên Binance Futures, chuyển đổi từ Node.js sang Go để tối ưu hiệu suất và đảm bảo an toàn khi vận hành trên Mainnet.

---

## Phase 1: MVP với Node.js + Binance Testnet
**Mục tiêu:** Xây dựng logic giao dịch cốt lõi và làm quen với API Binance trong môi trường không rủi ro.

### Các bước thực hiện:
- [ ] **1.1 Cấu hình môi trường:**
    - Thiết lập dự án Node.js.
    - Cấu hình biến môi trường `.env` (API_KEY, SECRET_KEY cho Testnet).
    - Cài đặt thư viện `binance-connector` hoặc `axios`.
- [ ] **1.2 Kết nối API cơ bản:**
    - Viết script kiểm tra kết nối (Ping).
    - Lấy thông tin số dư tài khoản (Account Balance).
    - Lấy giá thị trường hiện tại thông qua REST API.
- [ ] **1.3 Logic đặt lệnh:**
    - Triển khai hàm đặt lệnh Market Order (Mua/Bán).
    - Triển khai hàm đặt lệnh Limit Order và Stop-Loss/Take-Profit.
- [ ] **1.4 Dữ liệu thời gian thực:**
    - Thiết lập kết nối Websocket để theo dõi giá (Mark Price) và trạng thái lệnh (Order Update).

---

## Phase 2: Migration Backend sang Go + Binance Testnet
**Mục tiêu:** Chuyển đổi toàn bộ hệ thống sang Golang để tận dụng khả năng xử lý song song và tính an toàn về kiểu dữ liệu (Type Safety).

### Các bước thực hiện:
- [ ] **2.1 Khởi tạo dự án Go:**
    - Thiết lập `go mod`.
    - Cấu hình cấu trúc thư mục (Clean Architecture: cmd, internal, pkg).
    - Cài đặt SDK: `github.com/adshao/go-binance/v2`.
- [ ] **2.2 Chuyển đổi Logic (Migration):**
    - Viết lại các Struct dữ liệu tương ứng với phản hồi từ Binance API.
    - Chuyển đổi logic đặt lệnh từ Node.js sang Go.
    - Sử dụng **Goroutines** để quản lý Websocket (giúp bot theo dõi nhiều cặp coin cùng lúc mà không bị lag).
- [ ] **2.3 Kiểm thử đối soát (Parity Check):**
    - Chạy song song bot Node.js và bot Go trên Testnet.
    - Đảm bảo kết quả xử lý dữ liệu và tốc độ đặt lệnh của Go đồng nhất hoặc tốt hơn Node.js.

---

## Phase 3: Go + Binance Mainnet (Go-Live)
**Mục tiêu:** Triển khai hệ thống lên môi trường thật với các tiêu chuẩn bảo mật và quản trị rủi ro nghiêm ngặt.

### Các bước thực hiện:
- [ ] **3.1 Bảo mật & Quản lý Key:**
    - Cấu hình API Key trên Mainnet (Bật Enable Futures, Tắt Enable Withdrawals).
    - Thiết lập IP Whitelisting (Chỉ cho phép IP của server đặt lệnh).
- [ ] **3.2 Quản trị rủi ro (Risk Management):**
    - Viết logic kiểm tra số dư tối thiểu trước khi vào lệnh.
    - Thiết lập cơ chế "Circuit Breaker" (Dừng bot nếu lỗ vượt quá X% trong ngày).
- [ ] **3.3 Monitoring & Logging:**
    - Tích hợp gửi thông báo trạng thái lệnh qua Telegram/Discord.
    - Ghi log chi tiết các lỗi API và lịch sử khớp lệnh vào file hoặc database.
- [ ] **3.4 Triển khai thực tế:**
    - Chạy bot với số vốn nhỏ nhất có thể (Minimum Position Size) để quan sát phí giao dịch và độ trượt giá (Slippage).

---

## Chỉ dẫn cho Windsurf (Cascade Context)
*Khi thực hiện các bước trên, hãy lưu ý:*
1. **Error Handling:** Luôn kiểm tra `err != nil` trong Go cho mọi lời gọi API.
2. **Rate Limiting:** Tuân thủ giới hạn yêu cầu (Weight) của Binance để tránh bị ban IP.
3. **Clean Code:** Đảm bảo code dễ bảo trì, tách biệt giữa logic giao dịch và logic kết nối API.