'use client';

import { useState, useEffect } from 'react';

export interface SignalGateView {
  grade: string;
  confidence: number;
  playbook: string;
  regime: string;
  pass: boolean;
  reasonCodes: string[];
  timestamp?: string;
}

interface IntelligenceData {
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

interface UseIntelligenceDataReturn {
  data: IntelligenceData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

async function readOkJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || body.message || `HTTP ${res.status}`);
  }
  return body;
}

function mapSignal(raw: Record<string, unknown> | null | undefined): SignalGateView | null {
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

export function useIntelligenceData(): UseIntelligenceDataReturn {
  const [data, setData] = useState<IntelligenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

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

      setData({
        signalGate: mapSignal(latestSignal),
        riskEngine: riskData.data || null,
        noTradeReasons: noTradeData.data || [],
        llm: llmData.data || null,
        memory: memoryData.data || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch intelligence data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return {
    data,
    loading,
    error,
    refresh: fetchData,
  };
}
