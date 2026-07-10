/**
 * Big Update v3 worker cron schedules + signal-gate timeframes (single source of truth).
 * MarketScan every 5 min; LLMDispatch +1 min after each 5m boundary when 5m is in stack.
 */

export const V3_MARKET_SCAN_CRON =
  process.env.V3_MARKET_SCAN_CRON?.trim() || '*/5 * * * *';

/** Default: 1 min after each 5m scan when using 5m stack */
export const V3_LLM_DISPATCH_CRON =
  process.env.V3_LLM_DISPATCH_CRON?.trim() ||
  '1,6,11,16,21,26,31,36,41,46,51,56 * * * *';

const V3_VALID_GATE_TIMEFRAMES = ['5m', '15m', '1h', '4h'] as const;
const DEFAULT_SIGNAL_GATE_TIMEFRAMES = ['5m', '15m', '1h'] as const;

export type V3GateTimeframe = (typeof V3_VALID_GATE_TIMEFRAMES)[number];

/** Active signal-gate timeframes from env (default 5m,15m,1h). */
export function getV3SignalGateTimeframes(): readonly string[] {
  const raw = process.env.V3_SIGNAL_GATE_TIMEFRAMES?.trim();
  if (!raw) {
    return DEFAULT_SIGNAL_GATE_TIMEFRAMES;
  }
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const filtered = parts.filter((p): p is V3GateTimeframe =>
    (V3_VALID_GATE_TIMEFRAMES as readonly string[]).includes(p)
  );
  return filtered.length > 0 ? filtered : DEFAULT_SIGNAL_GATE_TIMEFRAMES;
}

function parseTfOrder(envKey: string, fallback: readonly string[]): string[] {
  const raw = process.env[envKey]?.trim();
  const order = raw
    ? raw.split(',').map((s) => s.trim()).filter(Boolean)
    : [...fallback];
  return order.length > 0 ? order : [...fallback];
}

function buildTfRank(order: string[]): Record<string, number> {
  const rank: Record<string, number> = {};
  order.forEach((tf, i) => {
    rank[tf] = i;
  });
  return rank;
}

/** Lower rank = preferred when grade/confidence tie (dashboard display). */
export function getV3TfPriorityRank(): Record<string, number> {
  return buildTfRank(parseTfOrder('V3_TF_PRIORITY', getV3SignalGateTimeframes()));
}

/**
 * LLM entry dispatch priority — default structure-first: 15m → 1h → 5m.
 * When 15m passes gate, prefer it over 5m for Groq/execution.
 */
export function getV3EntryTfPriorityRank(): Record<string, number> {
  const defaultEntry = ['15m', '1h', '5m'] as const;
  const gateTfs = getV3SignalGateTimeframes();
  const preferred = parseTfOrder('V3_ENTRY_TF_PRIORITY', defaultEntry).filter((tf) =>
    gateTfs.includes(tf)
  );
  const rest = gateTfs.filter((tf) => !preferred.includes(tf));
  return buildTfRank([...preferred, ...rest]);
}

/** Duplicate-signal cache TTL — 5m when stack includes 5m. */
export function getSignalGateCacheTtlMs(): number {
  const raw = process.env.SIGNAL_GATE_CACHE_TTL_MS?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  if (getV3SignalGateTimeframes().includes('5m')) {
    return 5 * 60 * 1000;
  }
  return 15 * 60 * 1000;
}

/** OHLCV warmup targets per TF (dashboard + health). */
export function getV3WarmupRequiredCandles(): Record<string, number> {
  return {
    '5m': parseInt(process.env.V3_WARMUP_5M || '2000', 10),
    '15m': parseInt(process.env.V3_WARMUP_15M || '1000', 10),
    '1h': parseInt(process.env.V3_WARMUP_1H || '500', 10),
    '4h': parseInt(process.env.V3_WARMUP_4H || '300', 10),
  };
}

export function getV3WarmupTimeframes(): string[] {
  return [...getV3SignalGateTimeframes()];
}

/** @deprecated Use getV3SignalGateTimeframes() — kept for type imports */
export const V3_SIGNAL_GATE_TIMEFRAMES = DEFAULT_SIGNAL_GATE_TIMEFRAMES;
