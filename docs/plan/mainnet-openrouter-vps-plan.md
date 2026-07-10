# Mainnet VPS Plan: OpenRouter Scout + Binance Mainnet

## Goal

Run `main` on a separate VPS for tiny real-money Binance Futures trading, while keeping `develop` and the current VPS unchanged.

| Branch | VPS | LLM | Binance | Purpose |
| --- | --- | --- | --- | --- |
| `develop` | current VPS | current Groq Scout setup | demo/testnet | R&D, backtests, policy testing |
| `main` | new VPS | OpenRouter `meta-llama/llama-4-scout` | mainnet futures | tiny live trading |

Do not change `develop` defaults for this rollout. Implement code/docs on a feature branch, then merge to `main`.

## Required Code Work On `main`

Current code already has OpenRouter as dispatch fallback. For `main`, add an env-controlled primary provider switch:

```env
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_DISPATCH_MODEL=meta-llama/llama-4-scout
OPENROUTER_DISPATCH_FALLBACK_ENABLED=true
OPENROUTER_HTTP_REFERER=https://your-main-domain
OPENROUTER_APP_TITLE=chuyen-gia-crypto-main
```

Implementation targets:

- `backend/src/config/openrouter-models.ts`: add provider config helpers.
- `backend/src/services/groq-client.ts`: when `LLM_PROVIDER=openrouter`, call OpenRouter Scout first, then fall back to existing Groq/Cerebras chain.
- `backend/.env.example`: document `LLM_PROVIDER=openrouter` for `main`.
- `docs/llm-dispatch-providers.md`: update dispatch order.
- Optional: add `.env.mainnet.example` or a docs env block for the new VPS.

Keep levels adapter as-is unless explicitly changing it:

```env
GROQ_API_KEY_2=...
GROQ_LEVELS_ADAPTER_ENABLED=true
GROQ_MODEL_LEVELS_ADAPTER=openai/gpt-oss-120b
```

## New VPS Setup

Mirror the current backend VPS:

1. Install Node 20, npm, PM2, git, Docker, nginx.
2. Clone repo.
3. Checkout `main`.
4. Start local Postgres with `docker/local`.
5. Create `backend/.env` manually from this plan, not copied blindly from `develop`.
6. Run Prisma schema sync.
7. Start PM2 API + worker.
8. Configure nginx to proxy API to `127.0.0.1:3000`.
9. Deploy with:

```bash
DEPLOY_BRANCH=main ~/deploy.sh
```

Use a separate database from the current VPS. Do not share Postgres between develop/testnet and mainnet.

## Mainnet Env Template

**File sẵn:** `backend/.env.mainnet.example` — copy sang VPS mới:

```bash
cp backend/.env.mainnet.example backend/.env
# Chỉ sửa các dòng [ĐIỀN] bên dưới
```

### Chỉ cần điền thêm (các phần còn lại giữ nguyên như develop)

| Biến | Ghi chú |
| --- | --- |
| `OPENROUTER_API_KEY` | Key OpenRouter thật (~10u) |
| `GROQ_API_KEY_2` | Levels adapter (có thể copy key2 từ develop) |
| `GROQ_API_KEY_1` | Optional fallback khi OR fail |
| `CEREBRAS_API_KEY` | Optional |
| `BINANCE_API_KEY` / `BINANCE_API_SECRET` | Mainnet Futures, **no withdraw** |
| `TELEGRAM_BOT_TOKEN` | Bot mới từ @BotFather |
| `TELEGRAM_CHAT_IDS` | Group/channel mới |
| `TELEGRAM_ALLOWED_USER_IDS` | User id Telegram của bạn |

### Khác develop (đã set sẵn trong template)

```env
LLM_PROVIDER=openrouter
BINANCE_BASE_URL=https://fapi.binance.com
MAINNET_LIVE_TRADING_ENABLED=false          # Phase A shadow
MAINNET_MAX_TOTAL_EXPOSURE_USD=2000
MAINNET_MAX_LEVERAGE=50
MAINNET_MAX_RISK_PER_TRADE_PERCENT=1
```

### Sizing: wallet 40-50 USDT, notional $200–$2000 (giống develop)

```env
BINANCE_MIN_ORDER_NOTIONAL_USD=200
MAX_TOTAL_EXPOSURE_USD=2000
MAX_POSITIONS_PER_SYMBOL=1
BINANCE_LEVERAGE=50
RISK_PER_TRADE_PERCENT=1
```

- Wallet nạp ~40-50 USDT = **margin** trên Binance.
- Mỗi lệnh notional **tối thiểu $200**, cap exposure **$2000** — giống develop.
- Leverage 50x (như develop) → 1 lệnh ~$200 cần ~$4 margin; wallet 40-50U đủ 1 position.
- Thực tế chỉ **1 lệnh** cho đến khi nạp thêm (không scale-in).

## Telegram (bot mới — bắt buộc)

**Không** dùng chung bot/group develop — dễ nhầm testnet vs mainnet.

1. `@BotFather` → `/newbot` → tạo bot mainnet.
2. Tạo group riêng (vd. `Crypto Mainnet Alerts`), add bot vào group.
3. Gửi 1 tin nhắn trong group.
4. Lấy `chat_id`:
   ```bash
   curl "https://api.telegram.org/bot<NEW_BOT_TOKEN>/getUpdates"
   ```
   Group thường là số âm: `-100...`
5. Điền vào `.env`:
   ```env
   TELEGRAM_BOT_TOKEN=<bot_mới>
   TELEGRAM_CHAT_IDS=-100...
   TELEGRAM_ALLOWED_USER_IDS=<user_id_của_bạn>
   ```
6. `pm2 reload ecosystem.config.cjs --update-env`

Mỗi VPS chỉ **1 worker** poll 1 bot token — develop và mainnet tách bot là đúng.


## Mainnet Rollout

### Phase A: Shadow Mode For 24-48h

```env
MAINNET_LIVE_TRADING_ENABLED=false
# MAINNET_TRADING_ACK=I_UNDERSTAND_REAL_MONEY
```

Expected:

- API and worker start cleanly.
- Balance, positions, open orders, and user stream read from Binance mainnet.
- LLM dispatch uses OpenRouter Scout.
- Trading mutations remain blocked by mainnet safety guard.
- No real order is placed.

Checks:

```bash
curl -s http://127.0.0.1:3000/health
pm2 status
pm2 logs crypto-worker --lines 100 --nostream
cd backend && npm run smoke:llm-providers
```

Look for:

- `[SafetyValidation] All safety requirements validated successfully`
- `[OpenRouterClient] Dispatch fallback model=meta-llama/llama-4-scout`
- LLM decisions without live order mutations.

### Phase B: Tiny Live

Enable only after shadow mode is clean:

```env
MAINNET_LIVE_TRADING_ENABLED=true
MAINNET_TRADING_ACK=I_UNDERSTAND_REAL_MONEY
```

Keep (đã có trong `.env.mainnet.example`):

- `MAX_POSITIONS_PER_SYMBOL=1`
- `BINANCE_MIN_ORDER_NOTIONAL_USD=200`
- `MAX_TOTAL_EXPOSURE_USD=2000`
- `BINANCE_LEVERAGE=50`

Monitor 20-50 tiny live trades before increasing wallet or enabling scale-in.

## Kill Switch

Disable live trading:

```bash
MAINNET_LIVE_TRADING_ENABLED=false pm2 reload ecosystem.config.cjs --update-env
```

Disable all Binance actions:

```bash
BINANCE_ENABLED=false pm2 reload ecosystem.config.cjs --update-env
```

If a real position exists, close/cancel manually on Binance first, then disable live trading and check open orders/positions.

## Git Workflow

Recommended flow:

```text
develop
  └─ feature/main-openrouter-mainnet
       └─ PR/merge into main
```

Do not merge `main` rollout env behavior back into `develop` unless the change is neutral and keeps `develop` defaults unchanged.

Deploy new VPS from `main`:

```bash
DEPLOY_BRANCH=main ~/deploy.sh
```

## Notes

- OpenRouter credit: 10 USD is enough for months at current signal-gated volume.
- OpenRouter paid Scout is preferred over `:free` models for live trading reliability.
- Current benchmark did not find a premium model that clearly beats Scout for this strategy; keep Scout + levels adapter.
- Env template: `backend/.env.mainnet.example` (copy → `.env`, điền key `[ĐIỀN]`).
- Telegram: bot + group mới, không share develop.
