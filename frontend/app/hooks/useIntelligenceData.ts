'use client';

import { useState, useEffect } from 'react';

interface IntelligenceData {
  signalGate: {
    grade: string;
    confidence: number;
    playbook: string;
    regime: string;
    pass: boolean;
    reasonCodes: string[];
  };
  riskEngine: {
    riskPerTrade: number;
    dailyLossCap: number;
    maxConsecutiveLosses: number;
    currentStreak: number;
    currentLockState: string;
    allowedReason: string | null;
  };
  noTradeReasons: Array<{
    reason: string;
    count: number;
    variant: string;
  }>;
  llm: {
    lastCall: string;
    modelName: string;
    promptVersion: string;
    responseStatus: string;
    invalidJsonCount: number;
    noTradeCount: number;
    skippedCallCount: number;
  };
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
  };
}

interface UseIntelligenceDataReturn {
  data: IntelligenceData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
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

      const signalsData = await signalsResponse.json();
      const riskData = await riskResponse.json();
      const llmData = await llmResponse.json();
      const memoryData = await memoryResponse.json();
      const noTradeData = await noTradeResponse.json();

      // Get latest signal
      const latestSignal = signalsData.data?.[0] || null;

      setData({
        signalGate: latestSignal,
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
