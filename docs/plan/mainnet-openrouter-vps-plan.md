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

## Mainnet Env

Core:

```env
NODE_ENV=production
DATABASE_URL="postgresql://crypto:...@127.0.0.1:5432/chuyen_gia?schema=public"
DIRECT_URL="postgresql://crypto:...@127.0.0.1:5432/chuyen_gia?schema=public"

BINANCE_ENABLED=true
BINANCE_BASE_URL=https://fapi.binance.com
BINANCE_API_KEY=...
BINANCE_API_SECRET=...
BINANCE_SYMBOL=BTCUSDT
BINANCE_LEVERAGE=5

LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_DISPATCH_MODEL=meta-llama/llama-4-scout
OPENROUTER_DISPATCH_FALLBACK_ENABLED=true
```

P0 policy copied from `develop`:

```env
V3_ENTRY_TF_PRIORITY=15m,1h,5m
V3_REQUIRE_5M_HTF_CONFIRM=true
MIN_SIGNAL_GRADE=A
MIN_SL_DISTANCE_PERCENT=0.008
V3_MIN_LLM_CONFIRM_CONFIDENCE=0.75
```

Tiny-live sizing for a 40-50 USDT account:

```env
BINANCE_MIN_ORDER_NOTIONAL_USD=100
MAX_TOTAL_EXPOSURE_USD=100
MAINNET_MAX_TOTAL_EXPOSURE_USD=100
MAINNET_MAX_LEVERAGE=5
MAINNET_MAX_RISK_PER_TRADE_PERCENT=0.25
RISK_PER_TRADE_PERCENT=0.25
MAX_POSITIONS_PER_SYMBOL=1
V3_SCALE_IN_ENABLED=false
```

Reason: with 40-50 USDT, `BINANCE_MIN_ORDER_NOTIONAL_USD=200` can leave no headroom. Use one small BTCUSDT futures position around 100 USDT notional with 5x leverage.

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

Keep:

- `MAX_POSITIONS_PER_SYMBOL=1`
- `MAX_TOTAL_EXPOSURE_USD=100`
- `BINANCE_LEVERAGE=5`
- `BINANCE_MIN_ORDER_NOTIONAL_USD=100`

Monitor 20-50 tiny live trades before increasing any cap.

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
- Use a separate Telegram bot or tag messages with `[MAIN]` to avoid confusing testnet and mainnet alerts.
