/**
 * Shared fetch helpers for the v3 dashboard (single-flight via V3DashboardDataProvider).
 */

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

export async function readOkJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string; message?: string }).error || (body as { message?: string }).message || `HTTP ${res.status}`);
  }
  return body;
}

async function readAccountJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string; message?: string }).error || (body as { message?: string }).message || `HTTP ${res.status}`);
  }
  return body;
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

export async function loadDashboardSummary(): Promise<DashboardSummaryData> {
  const [systemResponse, schedulersResponse, warmupResponse] = await Promise.all([
    fetch('/api/dashboard/system'),
    fetch('/api/dashboard/schedulers'),
    fetch('/api/dashboard/warmup'),
  ]);

  const [systemBody, schedulersBody, warmupBody] = await Promise.all([
    readOkJson(systemResponse),
    readOkJson(schedulersResponse),
    readOkJson(warmupResponse),
  ]);

  return {
    systemHealth: systemBody.data,
    schedulers: schedulersBody.data,
    candleWarmup: warmupBody.data,
  };
}

export async function loadAccountData(): Promise<AccountData> {
  const [balanceResponse, positionsResponse, ordersResponse, tradesResponse] = await Promise.all([
    fetch('/api/account/balance?symbol=BTC&method=kim_nghia'),
    fetch('/api/account/positions?symbol=BTC&method=kim_nghia'),
    fetch('/api/account/orders?symbol=BTC&method=kim_nghia'),
    fetch('/api/account/trades?symbol=BTC&method=kim_nghia&limit=20'),
  ]);

  const [balanceData, positionsData, ordersData, tradesData] = await Promise.all([
    readAccountJson(balanceResponse),
    readAccountJson(positionsResponse),
    readAccountJson(ordersResponse),
    readAccountJson(tradesResponse),
  ]);

  return {
    balance: balanceData.data ?? {
      totalBalance: 0,
      availableBalance: 0,
      equity: 0,
      usedMargin: 0,
      freeMargin: 0,
      dailyPnL: 0,
      weeklyPnL: 0,
    },
    positions: positionsData.data || [],
    orders: ordersData.data || [],
    trades: tradesData.data || [],
  };
}

export async function loadIntelligenceData(): Promise<IntelligenceData> {
  const [signalsResponse, riskResponse, llmResponse, memoryResponse, noTradeResponse] = await Promise.all([
    fetch('/api/dashboard/signals?limit=1'),
    fetch('/api/dashboard/risk'),
    fetch('/api/dashboard/llm'),
    fetch('/api/dashboard/memory'),
    fetch('/api/dashboard/no-trade-reasons'),
  ]);

  const [signalsData, riskData, llmData, memoryData, noTradeData] = await Promise.all([
    readOkJson(signalsResponse),
    readOkJson(riskResponse),
    readOkJson(llmResponse),
    readOkJson(memoryResponse),
    readOkJson(noTradeResponse),
  ]);

  const latestSignal = signalsData.data?.[0];

  return {
    signalGate: mapSignal(latestSignal),
    riskEngine: riskData.data || null,
    noTradeReasons: noTradeData.data || [],
    llm: llmData.data || null,
    memory: memoryData.data || null,
  };
}

export async function loadMarketData(symbol: string, timeframe: string): Promise<DashboardMarketData> {
  const [candlesResponse, indicatorsResponse, signalsResponse] = await Promise.all([
    fetch(`/api/market/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=100`),
    fetch(`/api/market/indicators?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`),
    fetch(`/api/market/signals?symbol=${encodeURIComponent(symbol)}&limit=5`),
  ]);

  const candlesData = await candlesResponse.json();
  const indicatorsData = await indicatorsResponse.json();
  const signalsData = await signalsResponse.json();

  if (!candlesResponse.ok) {
    throw new Error(candlesData.error || 'Failed to load candles');
  }
  if (!indicatorsResponse.ok) {
    throw new Error(indicatorsData.error || 'Failed to load indicators');
  }
  if (!signalsResponse.ok) {
    throw new Error(signalsData.error || 'Failed to load signals');
  }

  const formattedCandles =
    candlesData.candles?.map((candle: Record<string, number>) => ({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    })) || [];

  const latest = indicatorsData.latest || {};
  const indicators = {
    sma20: typeof latest.sma20 === 'number' ? latest.sma20 : null,
    sma50: typeof latest.sma50 === 'number' ? latest.sma50 : null,
    rsi14: typeof latest.rsi14 === 'number' ? latest.rsi14 : null,
    atr14: typeof latest.atr14 === 'number' ? latest.atr14 : null,
  };

  const formattedSignals =
    signalsData.signals?.map((signal: Record<string, unknown>) => ({
      id: String(signal.id),
      grade: String(signal.grade ?? ''),
      confidence: Number(signal.confidence ?? 0),
      playbook: String(signal.playbook ?? ''),
      regime: String(signal.regime ?? ''),
      pass: Boolean(signal.pass),
    })) || [];

  return {
    candles: formattedCandles,
    indicators,
    signals: formattedSignals,
  };
}
