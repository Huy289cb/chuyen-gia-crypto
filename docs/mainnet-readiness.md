# Mainnet Readiness Runbook

**Mục tiêu:** chuyển từ Binance Demo sang Binance Futures mainnet cho tài khoản nhỏ (~40 USDT) theo rollout an toàn.

Không được chỉ đổi key và bật live ngay. Mainnet mặc định phải chạy **read-only / shadow** trước.

---

## Safety mặc định trong code

Code đã có guard mainnet:

- Detect mainnet khi `BINANCE_BASE_URL=https://fapi.binance.com`.
- Cho phép đọc balance / positions / open orders / user stream.
- Chặn mọi mutation trading (`POST/DELETE order`, `algoOrder`, leverage, margin type, position mode) nếu thiếu:
  - `MAINNET_LIVE_TRADING_ENABLED=true`
  - `MAINNET_TRADING_ACK=I_UNDERSTAND_REAL_MONEY`
- Khi mainnet, risk policy tự cap:
  - `MAX_TOTAL_EXPOSURE_USD` không vượt `MAINNET_MAX_TOTAL_EXPOSURE_USD` (default 50)
  - `RISK_PER_TRADE_PERCENT` không vượt `MAINNET_MAX_RISK_PER_TRADE_PERCENT` (default 0.25)
- Startup safety validation reject nếu:
  - live enabled nhưng thiếu acknowledgement
  - `BINANCE_LEVERAGE > MAINNET_MAX_LEVERAGE`
  - configured exposure/risk vượt mainnet cap

File liên quan:

| File | Vai trò |
|------|--------|
| `backend/src/config/mainnet-safety.ts` | Mainnet detect, mutation block, cap validation |
| `backend/src/services/binance/client.ts` | Chặn mutation mainnet ở HTTP layer |
| `backend/src/config/risk-policy.ts` | Áp cap exposure/risk mainnet |
| `backend/src/config/app.ts` | Startup safety validation |

---

## Env đề xuất cho tài khoản 40U

### Phase 1 — read-only / shadow

```env
BINANCE_ENABLED=true
BINANCE_BASE_URL=https://fapi.binance.com
BINANCE_API_KEY=...
BINANCE_API_SECRET=...
BINANCE_SYMBOL=BTCUSDT
BINANCE_LEVERAGE=5

MAINNET_LIVE_TRADING_ENABLED=false
# MAINNET_TRADING_ACK=I_UNDERSTAND_REAL_MONEY
MAINNET_MAX_TOTAL_EXPOSURE_USD=50
MAINNET_MAX_LEVERAGE=5
MAINNET_MAX_RISK_PER_TRADE_PERCENT=0.25

MAX_TOTAL_EXPOSURE_USD=50
RISK_PER_TRADE_PERCENT=0.25
MAX_POSITIONS_PER_SYMBOL=1
PROTECTIVE_EXPOSURE_AUDIT_ENABLED=true
```

Kỳ vọng:

- API/worker start OK.
- Balance/position/open orders đọc được.
- LLM vẫn tạo decisions, nhưng order placement bị block nếu path mutation bị gọi.
- Không có vị thế mainnet ngoài ý muốn.

### Phase 2 — tiny live

Chỉ bật sau ít nhất 24h shadow sạch:

```env
MAINNET_LIVE_TRADING_ENABLED=true
MAINNET_TRADING_ACK=I_UNDERSTAND_REAL_MONEY
```

Giữ:

- `MAINNET_MAX_TOTAL_EXPOSURE_USD=50`
- `BINANCE_LEVERAGE=5` hoặc thấp hơn
- `MAX_POSITIONS_PER_SYMBOL=1`

---

## Checklist trước live

- API key mainnet chỉ có quyền Futures trade, **không withdrawal**.
- Nếu có IP whitelist thì chỉ whitelist VPS.
- Binance account ở **ONE_WAY** mode nếu hệ thống đang vận hành theo ONE_WAY.
- Không có open positions / open orders trước khi bật live.
- `curl /api/account/balance?symbol=BTC` trả wallet đúng.
- Worker log có:
  - `[SafetyValidation] All safety requirements validated successfully`
  - `[WorkerScheduler] Protective exposure audit started`
  - reconciliation completed successfully
- `npm run build` pass.
- Mainnet live env được set thủ công ngay trước deploy/reload.

---

## Kill switch

Nếu có bất thường:

```bash
cd ~/chuyen-gia-crypto/backend
MAINNET_LIVE_TRADING_ENABLED=false pm2 reload ecosystem.config.cjs --update-env
```

Hoặc tắt toàn bộ Binance:

```bash
BINANCE_ENABLED=false pm2 reload ecosystem.config.cjs --update-env
```

Nếu đã có vị thế thật:

1. Đóng/cancel thủ công trên Binance trước.
2. Sau đó tắt live trading.
3. Kiểm tra `openOrders`, `openAlgoOrders`, `positionRisk`.

---

## Scale-up

Không scale sau 1-2 lệnh thắng. Chỉ tăng khi:

- Ít nhất 20-50 lệnh tiny live không lỗi vận hành.
- Mọi fill đều có SL/TP exchange-side.
- Protective audit không từng phải emergency close do thiếu SL.
- PnL đo bằng wallet-first ổn định.

