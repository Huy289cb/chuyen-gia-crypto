# LLM Dispatch Providers

**Cập nhật:** 2026-06-26  
**Code:** `groq-client.ts`, `groq-dispatch.service.ts`, `config/groq-models.ts`, `cerebras-client.ts`, `openrouter-client.ts`

Tài liệu này mô tả thứ tự gọi LLM cho **trading dispatch** (Kim Nghia / V3). Khác với Telegram AI Q&A (`completeText`) và levels adapter (`preferredModels`).

---

## Thứ tự fallback (production)

Khi `preferredModels` **không** được set (dispatch chính), `GroqClient.analyze()` chạy theo thứ tự:

| Bước | Provider | Model | Ghi chú |
|------|----------|-------|---------|
| 1 | **Groq** | `meta-llama/llama-4-scout-17b-16e-instruct` | Primary; thử hết `GROQ_API_KEY_1`, `GROQ_API_KEY_2`, `GROQ_API_KEY` |
| 2 | **Cerebras** | `gpt-oss-120b` | `response_format: json_object` **bắt buộc** |
| 3 | **OpenRouter** | `meta-llama/llama-4-scout` (paid) | `json_object`; không dùng variant `:free` |
| 4+ | **Groq** | 70B → Qwen3-32B → Qwen3.6-27B → 8B | Chỉ các model trong `GROQ_MODEL_FALLBACKS` |

```
Groq Scout (all keys)
       ↓ fail
Cerebras gpt-oss-120b + json_object
       ↓ fail
OpenRouter Scout paid + json_object
       ↓ fail
Groq fallbacks (all keys, từng model)
```

Log mẫu:

```
[GroqClient] Dispatch step 1: Groq primary meta-llama/llama-4-scout-17b-16e-instruct
[GroqClient] Dispatch step 2: Cerebras gpt-oss fallback
[CerebrasClient] Dispatch fallback model=gpt-oss-120b (json_object)
[GroqClient] Dispatch step 3: OpenRouter Scout fallback
[OpenRouterClient] Dispatch fallback model=meta-llama/llama-4-scout (json_object)
[GroqClient] Dispatch step 4+: Groq fallbacks (llama-3.3-70b-versatile, ...)
```

---

## Không đi qua multi-provider chain

| Use case | Hành vi |
|----------|---------|
| **Levels adapter** | Chỉ Groq + `GROQ_API_KEY_2` + `GROQ_MODEL_LEVELS_ADAPTER` (`openai/gpt-oss-120b` trên Groq) |
| **Opposite flip / auxiliary** | `preferredModels` → chỉ Groq, không Cerebras/OpenRouter |
| **Telegram `/ai`** | `completeText()` — Groq only, không parse JSON dispatch |

---

## Environment variables

```env
# --- Groq (bước 1 + 4+) ---
GROQ_API_KEY_1=gsk_...
GROQ_API_KEY_2=gsk_...
GROQ_MODEL_PRIMARY=meta-llama/llama-4-scout-17b-16e-instruct
# GROQ_MODEL_FALLBACKS=llama-3.3-70b-versatile,qwen/qwen3-32b,qwen/qwen3.6-27b,llama-3.1-8b-instant

# Levels adapter (riêng, không trong chain trên)
# GROQ_LEVELS_ADAPTER_ENABLED=true
# GROQ_MODEL_LEVELS_ADAPTER=openai/gpt-oss-120b

# --- Cerebras (bước 2) ---
CEREBRAS_API_KEY=csk_...
# CEREBRAS_DISPATCH_MODEL=gpt-oss-120b
# CEREBRAS_DISPATCH_FALLBACK_ENABLED=true   # default on khi có key; false để tắt

# --- OpenRouter (bước 3) ---
OPENROUTER_API_KEY=sk-or-v1-...
# OPENROUTER_DISPATCH_MODEL=meta-llama/llama-4-scout
# OPENROUTER_DISPATCH_FALLBACK_ENABLED=true
# OPENROUTER_HTTP_REFERER=https://download-money-moi.vercel.app
# OPENROUTER_APP_TITLE=chuyen-gia-crypto
```

Sau đổi env trên VPS: `pm2 reload ecosystem.config.cjs --update-env`.

---

## Giới hạn & chi phí (ước lượng)

| Provider | Vai trò | Ghi chú vận hành |
|----------|---------|------------------|
| **Groq Scout** | Primary | Nhanh nhất (~2s); deprecated trên Groq **2026-07-17** — chuẩn bị đổi primary |
| **Cerebras gpt-oss** | Fallback #2 | Free tier ~5 RPM / 30K TPM; đủ nếu chỉ fallback thỉnh thoảng |
| **OpenRouter Scout** | Fallback #3 | Paid ~$0.10–0.25/M input; trial credits có thể gọi được chưa nạp tiền; hết credit → `402` |
| **Groq 70B/Qwen** | Fallback cuối | `gpt-oss` **không** nằm trong Groq dispatch chain — empty body trên prompt dài |

**Không dùng:** OpenRouter `:free` models trong production (upstream 429 không ổn định).

---

## Benchmark / smoke scripts

```bash
cd backend
npm run smoke:llm-providers      # Groq + Cerebras + OpenRouter (dispatch-shaped prompt)
npm run benchmark:cerebras       # Cerebras model A/B
npm run benchmark:openrouter     # OpenRouter models (dev only)
npm run smoke:groq-models        # Groq chain smoke
```

---

## Files

| File | Vai trò |
|------|---------|
| `src/config/groq-models.ts` | Primary, fallbacks, levels adapter |
| `src/config/cerebras-models.ts` | `isCerebrasDispatchFallbackEnabled()` |
| `src/config/openrouter-models.ts` | `isOpenRouterDispatchFallbackEnabled()`, Scout model ID |
| `src/services/groq-client.ts` | `analyzeDispatchChain()`, `tryGroqModels()` |
| `src/services/cerebras-client.ts` | `analyzeViaCerebras()` |
| `src/services/openrouter-client.ts` | `analyzeViaOpenRouter()` |
| `src/services/groq-dispatch.service.ts` | Prompt, validation, `executeV3Trade` gate |
| `tests/unit/cerebras-client.test.ts` | Unit tests Cerebras |
| `tests/unit/openrouter-client.test.ts` | Unit tests OpenRouter |

---

## Liên quan

- Pipeline worker: [v3-operations.md](./v3-operations.md)
- Levels adapter (Groq key2): [groq-levels-adapter-plan.md](./groq-levels-adapter-plan.md)
- Telegram AI (Groq text): [plan/telegram-ai-qa.md](./plan/telegram-ai-qa.md)
- Deploy env: [deployment.md](./deployment.md)
