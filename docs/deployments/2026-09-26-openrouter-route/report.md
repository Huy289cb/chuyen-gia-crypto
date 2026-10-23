# OpenRouter primary route — 26/09/2026

OpenRouter remains the primary LLM provider. The dispatch and levels-adapter model changed from `meta-llama/llama-4-scout` to `qwen/qwen3-30b-a3b-instruct-2507` because Scout returned HTTP 404 after routing removed every available endpoint for the configured request.

Direct account smoke results:

- `openai/gpt-oss-120b`: HTTP 200, but a 64-token smoke response spent 61 reasoning tokens and did not complete parseable JSON.
- `qwen/qwen3-30b-a3b-instruct-2507`: HTTP 200, valid JSON, 2.151 seconds, 38 tokens, reported cost 0.0000058 USD.

Changes:

- Updated source default and `.env.example`.
- Pinned both `OPENROUTER_DISPATCH_MODEL` and `OPENROUTER_LEVELS_ADAPTER_MODEL` in live `.env`.
- Selectively compiled only `dist/config/openrouter-models.js`.
- Reloaded `crypto-api` and `crypto-worker` with `--update-env`, then saved PM2 state.

Verification:

- OpenRouter/config unit tests: 17 passed.
- PM2: API, worker and post-exit observer online.
- API `/api/health`: status `ok`.
- Worker completed reconciliation and market scan after reload.
- Live environment: provider `openrouter`; both model variables point to Qwen.
- Risk policy unchanged: per-trade cap 3%, daily cap 10%, cooldown 60 minutes, fixed USD cap empty.

Groq remains a fallback when OpenRouter fails. No strategy, entry, exit or risk parameter changed.

Rollback build backup: `/tmp/openrouter-release.nf0QgH/openrouter-models.js.before`. Rollback also requires restoring the two model variables in `backend/.env`, selectively restoring the compiled file and reloading PM2 with updated environment.
