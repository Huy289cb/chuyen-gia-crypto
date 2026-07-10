---
name: deploy-vps
description: Use when deploying, restarting, validating, or troubleshooting backend on VPS (PM2/Nginx), or handling Binance testnet operational checks. Frontend deploys on Vercel via git push — not on VPS.
---

## Phạm vi deploy

| Thành phần | Nơi deploy | Lệnh |
|------------|------------|------|
| Backend (`crypto-api`, `crypto-worker`) | VPS | `~/deploy.sh` hoặc `./scripts/deploy.sh` |
| Frontend (Next.js) | Vercel | `git push` (branch Vercel đã kết nối) |

## Khi sử dụng
- Deploy / restart backend trên VPS
- Troubleshoot 502, stale code, PM2 crash
- Drift DB testnet vs Binance, orphan orders

## Script deploy (`scripts/deploy.sh`)

Mặc định:
1. `git pull --ff-only origin develop`
2. Kiểm tra `backend/.env`
3. `npm ci` / `npm install`
4. `npm run build` (xóa `dist` trước)
5. `pm2 reload ecosystem.config.cjs --update-env` (+ `pm2 save`)
6. Chờ `http://127.0.0.1:3000/health` → 200
7. In `pm2 status` + 20 dòng log worker (`--nostream`)

Biến tùy chọn:
- `DEPLOY_BRANCH=develop`
- `DEPLOY_SKIP_PULL=1` — chỉ build + reload
- `DEPLOY_DB_PUSH=1` — `prisma db push` khi đổi schema
- `DEPLOY_FLUSH_LOGS=1` — xóa log PM2 (mặc định **không** xóa)

## Validate sau deploy
- [ ] `pm2 status` — cả `crypto-api` và `crypto-worker` online
- [ ] `curl -s http://127.0.0.1:3000/health` → 200
- [ ] Worker log: MarketScan completed, không lỗi Prisma/Binance liên tục
- [ ] Nginx active nếu dùng domain công khai

## Log vận hành (không phải lỗi)
`[MarketScan] Previous scan still running, skipping cycle` — cron 5 phút trùng lúc scan sau restart (~60s). Bỏ qua nếu chỉ 1–2 lần sau deploy.

## Sự cố
| Triệu chứng | Hướng xử lý |
|-------------|-------------|
| 502 | `pm2 status`, port 3000, `nginx -t`, upstream |
| Stale code | `git log -1`, chạy lại `~/deploy.sh` |
| Orphan position / not on Binance | `cd backend && npm run testnet:cleanup` |
| `-4061` position side | Worker đã init hedge mode; verify `BINANCE_ENABLED` |
| LLM không chạy | Signal Gate block (Grade D) — bình thường khi thị trường yếu |

## Quy tắc
- Không expose secret trong log
- Không nói deploy xong nếu health check fail
- Không build frontend trên VPS trừ khi task yêu cầu rõ
- Phân biệt testnet Binance vs paper legacy

## Tài liệu
- `docs/deployment.md`
- `docs/v3-operations.md`
- `docs/binance-testnet-integration.md`
- `backend/ecosystem.config.cjs`
