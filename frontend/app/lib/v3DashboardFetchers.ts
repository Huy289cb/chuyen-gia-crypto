/**
 * Shared fetch helpers for the v3 dashboard (single-flight via V3DashboardDataProvider).
 */

import { getApiBase } from './apiBase';
import { normalizeChartCandles } from './chartCandles';

export interface DashboardSummaryData {
  systemHealth: {
    workerStatus: string;
    databaseStatus: string;
    safetyValidation: string;
    btcOnlyScope: boolean;
    lockStatus: string;
  };
  schedulers: Array<{
    name: string;
    status: string;
    lastRun: string;
    nextRun: string;
    cron: string;
    lastRunAt?: string | null;
  }>;
  candleWarmup: {
    totalCandles: number;
    requiredCandles: number;
    isWarmedUp: boolean;
    timeframes: Array<{
      name: string;
      loaded: number;
      required: number;
    }>;
  };
}

export interface AccountData {
  balance: {
    isInitialized?: boolean;
    totalBalance: number;
    availableBalance: number;
    equity: number;
    usedMargin: number;
    freeMargin: number;
    dailyPnL: number;
    weeklyPnL: number;
  };
  positions: Array<{
    id: string;
    symbol: string;
    side: string;
    size: number;
    entryPrice: number;
    markPrice: number;
    unrealizedPnL: number;
    pnlPercentage: string;
    stopLoss: number;
    takeProfit: number;
    timeInPosition: string;
  }>;
  orders: Array<{
    id: string;
    symbol: string;
    side: string;
    type: string;
    status: string;
    price: number;
    quantity: number;
    reduceOnly: boolean;
    createdAt: string;
  }>;
  trades: Array<{
    id: string;
    symbol: string;
    side: string;
    price: number;
    quantity: number;
    fee: number;
    realizedPnL: number;
    status: string;
    closedAt: string;
  }>;
}

export interface SignalGateView {
  grade: string;
  confidence: number;
  playbook: string;
  regime: string;
  pass: boolean;
  reasonCodes: string[];
  timestamp?: string;
}

export interface IntelligenceData {
  signalGate: SignalGateView | null;
  riskEngine: {
    riskPerTrade: number;
    dailyLossCap: number;
    dailyLossLimitPercent?: number;
    dailyLossCurrent?: number;
    maxConsecutiveLosses: number;
    currentStreak: number;
    currentLockState: string;
    allowedReason: string | null;
    lockReason?: string | null;
  } | null;
  noTradeReasons: Array<{
    reason: string;
    count: number;
    variant: string;
  }>;
  llm: {
    callsToday?: number;
    lastCall: string | null;
    modelName: string;
    promptVersion: string;
    responseStatus: string;
    invalidJsonCount: number;
    noTradeCount: number;
    skippedCallCount: number;
  } | null;
  memory: {
    similarSetups: Array<{
      id: number;
      playbook: string;
      result: string;
      pnl: number;
      date: string;
    }>;
    playbookWinrate: Record<string, number>;
    failurePatterns: string[];
  } | null;
}

export interface DashboardMarketData {
  candles: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
  indicators: {
    sma20: number | null;
    sma50: number | null;
    rsi14: number | null;
    atr14: number | null;
  };
  signals: Array<{
    id: string;
    grade: string;
    confidence: number;
    playbook: string;
    regime: string;
    pass: boolean;
  }>;
}

type ApiBody = {
  ok?: boolean;
  success?: boolean;
  error?: string;
  message?: string;
  data?: unknown;
  candles?: unknown;
  signals?: unknown;
  latest?: Record<string, unknown>;
};

export async function readOkJson(res: Response, label?: string): Promise<ApiBody> {
  const body = (await res.json().catch(() => ({}))) as ApiBody;

  if (!res.ok) {
    const msg = body.error || body.message || `HTTP ${res.status}`;
    console.error(`[v3] ${label ?? res.url} HTTP error:`, msg);
    throw new Error(msg);
  }

  if (body.ok === false) {
    const msg = body.error || body.message || 'Request failed';
    console.error(`[v3] ${label ?? res.url} API error:`, msg, body);
    throw new Error(msg);
  }
  if (body.ok !== true && body.success === false) {
    const msg = body.error || body.message || 'Request failed';
    console.error(`[v3] ${label ?? res.url} API error:`, msg, body);
    throw new Error(msg);
  }

  return body;
}

async function fetchJson(path: string, label: string): Promise<ApiBody> {
  const url = `${getApiBase()}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url);
  return readOkJson(res, label);
}

export function mapSignal(raw: Record<string, unknown> | null | undefined): SignalGateView | null {
  if (!raw) return null;
  const reasonCodes = Array.isArray(raw.reasonCodes)
    ? (raw.reasonCodes as unknown[]).map((c) => String(c))
    : [];
  return {
    grade: String(raw.grade ?? '—'),
    confidence: Number(raw.confidence ?? 0),
    playbook: String(raw.playbook ?? '—'),
    regime: String(raw.regime ?? '—'),
    pass: Boolean(raw.pass),
    reasonCodes,
    timestamp: raw.timestamp ? String(raw.timestamp) : undefined,
  };
}

async function settleJson(
  path: string,
  label: string
): Promise<{ body: ApiBody | null; error: string | null }> {
  try {
    return { body: await fetchJson(path, label), error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[v3] ${label} failed:`, msg);
    return { body: null, error: msg };
  }
}

function firstError(errors: (string | null)[]): string {
  return errors.find(Boolean) ?? 'Request failed';
}

const DEFAULT_SYSTEM_HEALTH: DashboardSummaryData['systemHealth'] = {
  workerStatus: 'unknown',
  databaseStatus: 'unknown',
  safetyValidation: 'unknown',
  btcOnlyScope: false,
  lockStatus: 'unknown',
};

const DEFAULT_WARMUP: DashboardSummaryData['candleWarmup'] = {
  totalCandles: 0,
  requiredCandles: 1800,
  isWarmedUp: false,
  timeframes: [
    { name: '15m', loaded: 0, required: 1000 },
    { name: '1h', loaded: 0, required: 500 },
    { name: '4h', loaded: 0, required: 300 },
  ],
};

export async function loadDashboardSummary(): Promise<DashboardSummaryData> {
  const [system, schedulers, warmup] = await Promise.all([
    settleJson('/dashboard/system', 'dashboard/system'),
    settleJson('/dashboard/schedulers', 'dashboard/schedulers'),
    settleJson('/dashboard/warmup', 'dashboard/warmup'),
  ]);

  const errors = [system.error, schedulers.error, warmup.error].filter(Boolean) as string[];
  const hasAnyData = Boolean(system.body?.data || schedulers.body?.data || warmup.body?.data);

  if (!hasAnyData && errors.length > 0) {
    throw new Error(firstError(errors));
  }

  if (warmup.error) {
    console.warn('[v3] dashboard/warmup failed, using defaults:', warmup.error);
  }
  if (system.error) {
    console.warn('[v3] dashboard/system failed, using defaults:', system.error);
  }
  if (schedulers.error) {
    console.warn('[v3] dashboard/schedulers failed, using defaults:', schedulers.error);
  }

  return {
    systemHealth:
      (system.body?.data as DashboardSummaryData['systemHealth'] | undefined) ?? DEFAULT_SYSTEM_HEALTH,
    schedulers: (schedulers.body?.data as DashboardSummaryData['schedulers'] | undefined) ?? [],
    candleWarmup:
      (warmup.body?.data as DashboardSummaryData['candleWarmup'] | undefined) ?? DEFAULT_WARMUP,
  };
}

export async function loadAccountData(): Promise<AccountData> {
  const q = 'symbol=BTC&method=kim_nghia';
  const [balance, positions, orders, trades] = await Promise.all([
    settleJson(`/account/balance?${q}`, 'account/balance'),
    settleJson(`/account/positions?${q}`, 'account/positions'),
    settleJson(`/account/orders?${q}`, 'account/orders'),
    settleJson(`/account/trades?${q}&limit=20`, 'account/trades'),
  ]);

  const errors = [balance.error, positions.error, orders.error, trades.error].filter(Boolean) as string[];
  const hasAnyData = Boolean(
    balance.body?.data || positions.body?.data || orders.body?.data || trades.body?.data
  );

  if (!hasAnyData && errors.length === 4) {
    throw new Error(firstError(errors));
  }

  if (balance.error) {
    console.warn('[v3] account/balance failed, using empty balance:', balance.error);
  }

  const emptyBalance: AccountData['balance'] = {
    isInitialized: false,
    totalBalance: 0,
    availableBalance: 0,
    equity: 0,
    usedMargin: 0,
    freeMargin: 0,
    dailyPnL: 0,
    weeklyPnL: 0,
  };

  return {
    balance: (balance.body?.data as AccountData['balance'] | undefined) ?? emptyBalance,
    positions: (positions.body?.data as AccountData['positions'] | undefined) ?? [],
    orders: (orders.body?.data as AccountData['orders'] | undefined) ?? [],
    trades: (trades.body?.data as AccountData['trades'] | undefined) ?? [],
  };
}

export async function loadIntelligenceData(): Promise<IntelligenceData> {
  const [signals, risk, llm, memory, noTrade] = await Promise.all([
    settleJson('/dashboard/signals?limit=1', 'dashboard/signals'),
    settleJson('/dashboard/risk', 'dashboard/risk'),
    settleJson('/dashboard/llm', 'dashboard/llm'),
    settleJson('/dashboard/memory', 'dashboard/memory'),
    settleJson('/dashboard/no-trade-reasons', 'dashboard/no-trade-reasons'),
  ]);

  const errors = [signals.error, risk.error, llm.error, memory.error, noTrade.error].filter(
    Boolean
  ) as string[];
  if (errors.length === 5) {
    throw new Error(firstError(errors));
  }

  if (risk.error && !risk.body?.data) {
    throw new Error(risk.error);
  }

  const signalList = (signals.body?.data as Record<string, unknown>[] | undefined) ?? [];
  const latestSignal = signalList[0];

  return {
    signalGate: mapSignal(latestSignal),
    riskEngine: (risk.body?.data as IntelligenceData['riskEngine']) ?? null,
    noTradeReasons: (noTrade.body?.data as IntelligenceData['noTradeReasons']) ?? [],
    llm: (llm.body?.data as IntelligenceData['llm']) ?? null,
    memory: (memory.body?.data as IntelligenceData['memory']) ?? null,
  };
}

export async function loadMarketData(symbol: string, timeframe: string): Promise<DashboardMarketData> {
  const encSymbol = encodeURIComponent(symbol);
  const encTf = encodeURIComponent(timeframe);

  const [candlesResult, indicatorsResult, signalsResult] = await Promise.all([
    settleJson(`/market/candles?symbol=${encSymbol}&timeframe=${encTf}&limit=100`, 'market/candles'),
    settleJson(`/market/indicators?symbol=${encSymbol}&timeframe=${encTf}`, 'market/indicators'),
    settleJson(`/market/signals?symbol=${encSymbol}&limit=5`, 'market/signals'),
  ]);

  const errors = [candlesResult.error, indicatorsResult.error, signalsResult.error].filter(
    Boolean
  ) as string[];
  if (errors.length === 3) {
    throw new Error(firstError(errors));
  }

  if (candlesResult.error && !candlesResult.body?.candles) {
    throw new Error(candlesResult.error);
  }
  if (indicatorsResult.error && !indicatorsResult.body?.latest) {
    throw new Error(indicatorsResult.error);
  }

  const rawCandles = (candlesResult.body?.candles as Record<string, number>[] | undefined) ?? [];
  const formattedCandles = normalizeChartCandles(
    rawCandles.map((candle) => ({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }))
  );

  const latest = (indicatorsResult.body?.latest as Record<string, unknown> | undefined) ?? {};
  const indicators = {
    sma20: typeof latest.sma20 === 'number' ? latest.sma20 : null,
    sma50: typeof latest.sma50 === 'number' ? latest.sma50 : null,
    rsi14: typeof latest.rsi14 === 'number' ? latest.rsi14 : null,
    atr14: typeof latest.atr14 === 'number' ? latest.atr14 : null,
  };

  const rawSignals = (signalsResult.body?.signals as Record<string, unknown>[] | undefined) ?? [];
  const formattedSignals = rawSignals.map((signal) => ({
    id: String(signal.id),
    grade: String(signal.grade ?? ''),
    confidence: Number(signal.confidence ?? 0),
    playbook: String(signal.playbook ?? ''),
    regime: String(signal.regime ?? ''),
    pass: Boolean(signal.pass),
  }));

  return {
    candles: formattedCandles,
    indicators,
    signals: formattedSignals,
  };
}
