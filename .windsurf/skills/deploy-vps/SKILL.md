---
name: deploy-vps
description: Use when deploying, restarting, validating, or troubleshooting this repo on a VPS with PM2 or Nginx, or when handling Binance and live-trading operational checks, 502 incidents, stale deploys, environment drift, or cleanup and recovery flows.
---

## Khi sử dụng
- Dùng khi deploy repo này lên VPS.
- Dùng khi restart PM2, check Nginx, verify env, hoặc troubleshoot 502.
- Dùng khi cần xử lý drift giữa local DB và Binance hoặc testnet state.

## Input yêu cầu
- Thư mục deploy hoặc branch hoặc commit cần rollout.
- Tên service PM2, Nginx host, và đường dẫn app.
- Trạng thái env vars (`GROQ_API_KEY`, `BINANCE_*` nếu dùng real trading).
- Triệu chứng nếu đang sự cố: 502, stale code, cleanup fail, balance drift, orphan orders.

## Quy trình
1. Kiểm tra trước deploy.
   - Xác nhận code version.
   - Xác nhận `backend/.env`.
   - Xác nhận có cần build hoặc test trước restart hay không.
2. Thực hiện deploy theo thứ tự an toàn.
   - Pull code đúng branch.
   - Cài dependency nếu cần.
   - Chạy migration hoặc init nếu thay đổi schema.
   - Restart backend bằng PM2.
3. Validate sau deploy.
   - Check `pm2 status`.
   - Check health hoặc API response.
   - Check log PM2 hoặc Nginx.
   - Nếu có Binance flow, check cleanup hoặc sync path nếu cần.
4. Xử lý sự cố theo symptom.
   - `502`: check PM2, process listen port, Nginx upstream, log.
   - Binance invalid path hoặc stale code: pull latest backend và restart PM2.
   - Balance drift hoặc orphan orders: chạy sync hoặc cleanup flow.
   - Env init fail: verify `BINANCE_ENABLED`, key, secret, permissions, base URL.
5. Báo cáo kết quả ngắn gọn.
   - Đã deploy hoặc rollback gì.
   - Health status.
   - Log hoặc bước tiếp theo nếu chưa ổn định.

## Output
- Checklist kết quả sau deploy:
  - code version
  - service status
  - health check
  - warning còn tồn đọng

## Quy tắc bắt buộc
- Không expose secret trong log hoặc output.
- Không restart mù trước khi capture status hoặc log nếu đang debug sự cố.
- Không bỏ qua cleanup khi có dấu hiệu orphan orders hoặc positions.
- Phải phân biệt paper trading và Binance real hoặc testnet flow.

## Không được làm
- Không giả định Nginx hoặc PM2 đã đúng config nếu chưa check.
- Không nói deploy xong nếu chưa có health check hoặc status check.
- Không chạy lệnh cleanup Binance nếu env và permission chưa đủ.
- Không mô phỏng kết quả production khi không có access thực tế.

## Tài nguyên
- `docs/setup.md`
- `docs/binance-testnet-integration.md`
- `docs/architecture.md`
- `backend/src/services/testnetEngine.js`
- `backend/src/services/binanceClient.js`
