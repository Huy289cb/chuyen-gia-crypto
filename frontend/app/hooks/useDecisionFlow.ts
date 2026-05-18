'use client';

import { useMemo } from 'react';
import { useV3Dashboard } from '../contexts/V3DashboardDataContext';
import type { IntelligenceData } from '../lib/v3DashboardFetchers';

export type PipelineStageStatus = 'pending' | 'passed' | 'blocked' | 'skipped';

export type PipelineStageId =
  | 'systemReady'
  | 'warmupReady'
  | 'setupDetected'
  | 'signalPassed'
  | 'riskApproved'
  | 'llmTriggered'
  | 'positionCreated'
  | 'monitorActive';

export interface PipelineStageView {
  id: PipelineStageId;
  name: string;
  status: PipelineStageStatus;
  reason: string;
  timestamp?: string;
  metric?: string;
}

export interface DecisionFlowState {
  systemReady: boolean;
  warmupReady: boolean;
  setupDetected: boolean;
  signalPassed: boolean;
  riskApproved: boolean;
  llmTriggered: boolean;
  positionCreated: boolean;
  monitorActive: boolean;
  currentStage: PipelineStageId;
  currentStageLabel: string;
  blockedReason: string | null;
  readinessScore: number;
  lastUpdatedAt: string | null;
  duplicateSignalHits: number;
  lastSignalGrade: string | null;
  lastSignalConfidence: number | null;
  lastPlaybook: string | null;
  lastRegime: string | null;
  stages: PipelineStageView[];
  loading: boolean;
  error: string | null;
}

const STAGE_LABELS: Record<PipelineStageId, string> = {
  systemReady: 'System Ready',
  warmupReady: 'Candle Warmup Ready',
  setupDetected: 'Market Setup Detected',
  signalPassed: 'Signal Gate Passed',
  riskApproved: 'Risk Approved',
  llmTriggered: 'LLM Dispatch Triggered',
  positionCreated: 'Position Created',
  monitorActive: 'Position Monitor Active',
};

function isDuplicateReason(text: string): boolean {
  return /duplicate/i.test(text);
}

function pickLatestTimestamp(...candidates: (string | null | undefined)[]): string | null {
  const valid = candidates.filter(Boolean) as string[];
  if (valid.length === 0) return null;
  return valid.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
}

function topNoTradeReason(intel: IntelligenceData | null): string | null {
  if (!intel?.noTradeReasons?.length) return null;
  const sorted = [...intel.noTradeReasons].sort((a, b) => b.count - a.count);
  const top = sorted.find((r) => r.count > 0);
  return top?.reason ?? null;
}

function countDuplicateHits(intel: IntelligenceData | null): number {
  const skipped = intel?.llm?.skippedCallCount ?? 0;
  const codes = intel?.signalGate?.reasonCodes ?? [];
  const codeHits = codes.filter(isDuplicateReason).length;
  const reasonHit = isDuplicateReason(intel?.signalGate?.reasonCodes?.join(' ') ?? '') ? 1 : 0;
  return Math.max(skipped, codeHits > 0 ? codeHits : 0, reasonHit);
}

export function computeDecisionFlow(
  summary: ReturnType<typeof useV3Dashboard>['summary']['data'],
  account: ReturnType<typeof useV3Dashboard>['account']['data'],
  intelligence: IntelligenceData | null,
  market: ReturnType<typeof useV3Dashboard>['market']['data']
): DecisionFlowState {
  const health = summary?.systemHealth;
  const warmup = summary?.candleWarmup;
  const schedulers = summary?.schedulers ?? [];
  const signal = intelligence?.signalGate;
  const risk = intelligence?.riskEngine;
  const llm = intelligence?.llm;
  const marketSignals = market?.signals ?? [];
  const positions = account?.positions ?? [];

  const positionMonitor = schedulers.find((s) => s.name === 'PositionMonitor');
  const marketScan = schedulers.find((s) => s.name === 'MarketScan');

  const systemReady =
    health?.workerStatus === 'healthy' &&
    health?.databaseStatus === 'healthy' &&
    health?.safetyValidation === 'passed' &&
    health?.lockStatus === 'unlocked';

  const warmupReady = Boolean(warmup?.isWarmedUp);
  const warmupTfProgress =
    warmup?.timeframes?.map((tf) =>
      tf.required > 0 ? Math.min(100, Math.round((tf.loaded / tf.required) * 100)) : 100
    ) ?? [];
  const warmupProgress =
    warmupTfProgress.length > 0
      ? Math.round(warmupTfProgress.reduce((a, b) => a + b, 0) / warmupTfProgress.length)
      : warmup && warmup.requiredCandles > 0
        ? Math.min(100, Math.round((warmup.totalCandles / warmup.requiredCandles) * 100))
        : 0;
  const warmupBlockingTf = warmup?.timeframes?.find((tf) => tf.loaded < tf.required);

  const setupDetected =
    marketSignals.length > 0 ||
    Boolean(signal?.playbook && signal.playbook !== '—') ||
    Boolean(signal?.grade && signal.grade !== '—');

  const signalPassed = Boolean(signal?.pass);
  const signalEvaluated = Boolean(signal);

  const dailyCap = risk?.dailyLossCap ?? 0;
  const dailyLoss = risk?.dailyLossCurrent ?? 0;
  const riskApproved =
    risk != null &&
    risk.currentLockState === 'unlocked' &&
    (dailyCap <= 0 || dailyLoss < dailyCap);

  const llmTriggered = (llm?.callsToday ?? 0) > 0;
  const positionCreated = positions.length > 0;
  const monitorActive =
    positionCreated &&
    (positionMonitor?.status === 'running' ||
      Boolean(positionMonitor?.lastRunAt || positionMonitor?.lastRun));

  const duplicateSignalHits = countDuplicateHits(intelligence);

  const booleans = {
    systemReady,
    warmupReady,
    setupDetected,
    signalPassed,
    riskApproved,
    llmTriggered,
    positionCreated,
    monitorActive,
  };

  let blockedReason: string | null = null;

  if (!systemReady) {
    if (health?.databaseStatus === 'error') blockedReason = 'Database unavailable';
    else if (health?.safetyValidation !== 'passed')
      blockedReason = `Safety check: ${health?.safetyValidation ?? 'unknown'}`;
    else if (health?.lockStatus === 'locked') blockedReason = 'System lock active';
    else if (health?.workerStatus === 'stale') blockedReason = 'Worker activity is stale';
    else blockedReason = 'System not ready';
  } else if (!warmupReady) {
    blockedReason = warmupBlockingTf
      ? `Candle warmup incomplete — ${warmupBlockingTf.name} ${warmupBlockingTf.loaded}/${warmupBlockingTf.required}`
      : `Candle warmup incomplete (${warmupProgress}% ready)`;
  } else if (!setupDetected) {
    blockedReason = 'No market setup detected yet';
  } else if (signalEvaluated && !signalPassed) {
    const codes = signal?.reasonCodes?.filter(Boolean) ?? [];
    blockedReason =
      codes[0] ||
      (isDuplicateReason(codes.join(' ')) ? 'Duplicate signal (cached)' : 'Signal gate blocked');
  } else if (signalPassed && !riskApproved) {
    blockedReason = risk?.lockReason || risk?.allowedReason || 'Risk engine locked or limit reached';
  } else if (signalPassed && riskApproved && !llmTriggered) {
    if (duplicateSignalHits > 0) {
      blockedReason = `LLM skipped — ${duplicateSignalHits} signal-gate duplicate/skip today`;
    } else {
      blockedReason = topNoTradeReason(intelligence) || 'LLM dispatch not triggered yet';
    }
  } else if (llmTriggered && !positionCreated) {
    blockedReason = topNoTradeReason(intelligence) || 'No open position after LLM path';
  } else if (positionCreated && !monitorActive) {
    blockedReason = 'Position monitor idle or stale';
  }

  const stageInputs: Array<{
    id: PipelineStageId;
    passed: boolean;
    blocked: boolean;
    skipped: boolean;
    reason: string;
    timestamp?: string;
    metric?: string;
  }> = [
    {
      id: 'systemReady',
      passed: systemReady,
      blocked: !systemReady && Boolean(health),
      skipped: false,
      reason: systemReady
        ? 'Worker, database, and safety checks OK'
        : blockedReason || 'Waiting for healthy system state',
      timestamp: marketScan?.lastRunAt || marketScan?.lastRun || undefined,
      metric: health?.workerStatus,
    },
    {
      id: 'warmupReady',
      passed: warmupReady,
      blocked: systemReady && !warmupReady,
      skipped: !systemReady,
      reason: warmupReady
        ? 'Required candle history loaded'
        : systemReady
          ? `Loading candles (${warmupProgress}%)`
          : 'Waiting for system ready',
      metric: warmup ? `${warmup.totalCandles}/${warmup.requiredCandles}` : undefined,
    },
    {
      id: 'setupDetected',
      passed: setupDetected,
      blocked: warmupReady && !setupDetected,
      skipped: !warmupReady,
      reason: setupDetected
        ? `${marketSignals.length || 1} setup signal(s) on chart`
        : 'Market scan has not produced a setup yet',
      timestamp: signal?.timestamp || marketScan?.lastRunAt || undefined,
      metric: signal?.playbook && signal.playbook !== '—' ? signal.playbook : undefined,
    },
    {
      id: 'signalPassed',
      passed: signalPassed,
      blocked: setupDetected && signalEvaluated && !signalPassed,
      skipped: !setupDetected,
      reason: signalPassed
        ? `Grade ${signal?.grade} · ${signal?.regime}`
        : signalEvaluated
          ? signal?.reasonCodes?.[0] || 'Signal gate blocked'
          : 'Awaiting signal gate evaluation',
      timestamp: signal?.timestamp,
      metric:
        signal?.confidence != null
          ? `${signal.confidence <= 1 ? Math.round(signal.confidence * 100) : Math.round(signal.confidence)}% conf`
          : undefined,
    },
    {
      id: 'riskApproved',
      passed: riskApproved,
      blocked: signalPassed && !riskApproved,
      skipped: !signalPassed,
      reason: riskApproved
        ? 'Risk limits within policy'
        : signalPassed
          ? risk?.lockReason || 'Trading locked by risk engine'
          : 'Requires passing signal gate',
      metric: risk ? `${risk.currentStreak}/${risk.maxConsecutiveLosses} loss streak` : undefined,
    },
    {
      id: 'llmTriggered',
      passed: llmTriggered,
      blocked: signalPassed && riskApproved && !llmTriggered,
      skipped: !signalPassed || !riskApproved,
      reason: llmTriggered
        ? `${llm?.callsToday ?? 0} LLM call(s) today`
        : signalPassed && riskApproved
          ? duplicateSignalHits > 0
            ? `Skipped (${duplicateSignalHits}) — duplicate or signal-only path`
            : 'Groq dispatch not engaged yet'
          : 'Waiting for upstream approval',
      timestamp: llm?.lastCall || undefined,
      metric: llm?.responseStatus,
    },
    {
      id: 'positionCreated',
      passed: positionCreated,
      blocked: llmTriggered && !positionCreated,
      skipped: !llmTriggered,
      reason: positionCreated
        ? `${positions.length} open position(s)`
        : llmTriggered
          ? 'LLM path ran without an open position'
          : 'No position until trade execution',
      timestamp: positions[0] ? undefined : llm?.lastCall || undefined,
      metric: positionCreated ? positions[0]?.symbol : undefined,
    },
    {
      id: 'monitorActive',
      passed: monitorActive,
      blocked: positionCreated && !monitorActive,
      skipped: !positionCreated,
      reason: monitorActive
        ? `Monitor ${positionMonitor?.status ?? 'active'}`
        : positionCreated
          ? 'Monitor scheduler not running recently'
          : 'No position to monitor',
      timestamp: positionMonitor?.lastRunAt || positionMonitor?.lastRun || undefined,
      metric: positionMonitor?.status,
    },
  ];

  let pipelineBlocked = false;
  const stages: PipelineStageView[] = stageInputs.map((input) => {
    let status: PipelineStageStatus;
    if (input.skipped) {
      status = 'skipped';
    } else if (pipelineBlocked) {
      status = 'skipped';
    } else if (input.blocked) {
      status = 'blocked';
      pipelineBlocked = true;
    } else if (input.passed) {
      status = 'passed';
    } else {
      status = 'pending';
    }

    return {
      id: input.id,
      name: STAGE_LABELS[input.id],
      status,
      reason: input.reason,
      timestamp: input.timestamp,
      metric: input.metric,
    };
  });

  const currentStage =
    (stages.find((s) => s.status === 'blocked' || s.status === 'pending')?.id as PipelineStageId) ||
    (monitorActive ? 'monitorActive' : 'systemReady');

  const passedCount = stages.filter((s) => s.status === 'passed').length;
  const readinessScore = Math.round((passedCount / stages.length) * 100);

  const lastUpdatedAt = pickLatestTimestamp(
    signal?.timestamp,
    llm?.lastCall,
    positionMonitor?.lastRunAt,
    marketScan?.lastRunAt
  );

  return {
    ...booleans,
    currentStage,
    currentStageLabel: STAGE_LABELS[currentStage],
    blockedReason,
    readinessScore,
    lastUpdatedAt,
    duplicateSignalHits,
    lastSignalGrade: signal?.grade ?? null,
    lastSignalConfidence: signal?.confidence ?? null,
    lastPlaybook: signal?.playbook ?? null,
    lastRegime: signal?.regime ?? null,
    stages,
    loading: false,
    error: null,
  };
}

export function useDecisionFlow(): DecisionFlowState & { refresh: () => void } {
  const { summary, account, intelligence, market } = useV3Dashboard();

  const loading =
    summary.loading || account.loading || intelligence.loading || market.loading;

  const errors = [summary.error, account.error, intelligence.error, market.error].filter(
    Boolean
  ) as string[];

  const flow = useMemo(
    () =>
      computeDecisionFlow(summary.data, account.data, intelligence.data, market.data),
    [summary.data, account.data, intelligence.data, market.data]
  );

  const refresh = () => {
    summary.refresh();
    account.refresh();
    intelligence.refresh();
    market.refresh();
  };

  return {
    ...flow,
    loading,
    error: errors.length === 4 ? errors[0] : null,
    refresh,
  };
}
