import {captureProviderRequestContext} from '../utils/provider-request-context';
import { tracedEvent } from '../utils/entry-trace';
/** Persist only provider/model/status, never headers, prompts, responses or keys. */
export async function fetchWithLlmTelemetry(url: string, options: RequestInit = {}): Promise<Response> {
  if (process.env.NODE_ENV === 'test') return fetch(url, options);
  let model = 'unknown';
  try { model = String(JSON.parse(String(options.body ?? '{}')).model ?? 'unknown'); } catch { /* metadata only */ }
  const provider = new URL(url).hostname;
  const requestId = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const started = Date.now();
  const callerContext = captureProviderRequestContext();
  const record = async (type: string, data: Record<string, unknown>) => {
    const metadata = tracedEvent({ ...callerContext, request_id: requestId, provider, model, cost_usd: null, cost_status: 'unknown', ...data });
    try { const { insertProviderJournalEvent } = await import('../repositories/provider-journal.repository');
      await insertProviderJournalEvent(type, metadata); }
    catch { console.warn('[LlmTelemetry] Could not persist independent provider journal'); }
    try { const { recordSilentPipelineEvent } = await import('../repositories/testnet.repository');
      const eventId = await recordSilentPipelineEvent(type, metadata);
      if (eventId === null) throw new Error('provider_metadata_not_persisted'); }
    catch { console.warn('[LlmTelemetry] Could not persist provider request metadata'); }
  };
  await record('llm_provider_request', {});
  try {
    const response = await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(45_000) });
    let costUsd: number | null = null;
    let inputTokens: number | null = null, outputTokens: number | null = null;
    try {
      const request = JSON.parse(String(options.body ?? '{}'));
      if (response.ok && request.stream !== true) {
        const result = await response.clone().json() as { usage?: {cost?: unknown; prompt_tokens?: unknown; completion_tokens?: unknown} };
        const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
        costUsd = number(result.usage?.cost);
        inputTokens = number(result.usage?.prompt_tokens); outputTokens = number(result.usage?.completion_tokens);
      }
    } catch { /* Missing usage is unknown, never zero. Original response remains readable. */ }
    await record('llm_provider_result', { status: response.status, ok: response.ok, latency_ms: Date.now() - started,
      cost_usd: costUsd, cost_status: costUsd === null ? 'unknown' : 'reported', input_tokens: inputTokens, output_tokens: outputTokens });
    return response;
  } catch (error) {
    await record('llm_provider_result', { ok: false, status: null, latency_ms: Date.now() - started });
    throw error;
  }
}
