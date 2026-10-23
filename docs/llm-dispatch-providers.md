# LLM Dispatch Providers

**Cập nhật:** 2026-08-29
**Code:** `groq-client.ts`, `groq-dispatch.service.ts`, `config/groq-models.ts`, `cerebras-client.ts`, `openrouter-client.ts`

Tài liệu này mô tả thứ tự gọi LLM cho **trading dispatch** (Kim Nghia / V3). Khác với Telegram AI Q&A (`completeText`) và levels adapter (`preferredModels`).

---

## Thứ tự fallback (production)

Khi `preferredModels` **không** được set và `LLM_PROVIDER=groq`,
`GroqClient.analyze()` chạy theo thứ tự:

| Bước | Provider | Model | Ghi chú |
|------|----------|-------|---------|
| 1 | **Groq** | `openai/gpt-oss-120b` | Primary; JSON mode; thử hết `GROQ_API_KEY_1`, `GROQ_API_KEY_2`, `GROQ_API_KEY` |
| 2 | **Cerebras** | `gpt-oss-120b` | `response_format: json_object` **bắt buộc** |
| 3 | **OpenRouter** | `meta-llama/llama-4-scout` (paid) | `json_object`; không dùng variant `:free` |
| 4+ | **Groq** | `openai/gpt-oss-20b` | Production fallback trong `GROQ_MODEL_FALLBACKS` |

```
Groq GPT-OSS 120B (all keys)
       ↓ fail
Cerebras gpt-oss-120b + json_object
       ↓ fail
OpenRouter Scout paid + json_object
       ↓ fail
Groq GPT-OSS 20B fallback (all keys)
```

Với `LLM_PROVIDER=openrouter`, dispatch chính chạy OpenRouter Scout trước, sau đó
Groq production (`openai/gpt-oss-120b` → `openai/gpt-oss-20b`) nếu OpenRouter lỗi.
Cerebras, khi được bật, chỉ là phương án cuối. Các auxiliary call như pending review
vẫn dùng chuỗi Groq production riêng ở dưới.

Log mẫu:

```
[GroqClient] Dispatch step 1: Groq primary openai/gpt-oss-120b
[GroqClient] Dispatch step 2: Cerebras gpt-oss fallback
[CerebrasClient] Dispatch fallback model=gpt-oss-120b (json_object)
[GroqClient] Dispatch step 3: OpenRouter Scout fallback
[OpenRouterClient] Dispatch fallback model=meta-llama/llama-4-scout (json_object)
[GroqClient] Dispatch step 4+: Groq fallbacks (openai/gpt-oss-20b)
```

---

## Không đi qua multi-provider chain

| Use case | Hành vi |
|----------|---------|
| **Levels adapter** | Chỉ Groq + `GROQ_API_KEY_2` + `GROQ_MODEL_LEVELS_ADAPTER` (`openai/gpt-oss-120b` trên Groq) |
| **Pending review / auxiliary** | Groq `openai/gpt-oss-20b` → `openai/gpt-oss-120b`, không Cerebras/OpenRouter |
| **Telegram `/ai`** | `completeText()` — Groq only, không parse JSON dispatch |

---

## Environment variables

```env
# --- Groq (bước 1 + 4+) ---
GROQ_API_KEY_1=gsk_...
GROQ_API_KEY_2=gsk_...
GROQ_MODEL_PRIMARY=openai/gpt-oss-120b
# GROQ_MODEL_FALLBACKS=openai/gpt-oss-20b
# GROQ_MODEL_AUXILIARY=openai/gpt-oss-20b

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
| **Groq GPT-OSS 120B** | Primary | Production model; bật JSON mode và low reasoning cho dispatch |
| **Cerebras gpt-oss** | Fallback #2 | Free tier ~5 RPM / 30K TPM; đủ nếu chỉ fallback thỉnh thoảng |
| **OpenRouter Scout** | Fallback #3 | Paid ~$0.10–0.25/M input; trial credits có thể gọi được chưa nạp tiền; hết credit → `402` |
| **Groq GPT-OSS 20B** | Fallback/auxiliary | Production model nhẹ hơn; JSON mode cho response có cấu trúc |

Các ID Groq Llama 3.1/3.3, Llama 4 Scout và Qwen3-32B cũ bị lọc trước khi gửi request.
Không dùng OpenRouter `:free` models trong production (upstream 429 không ổn định).

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
