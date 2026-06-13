'use client';

import Link from 'next/link';
import {
  Bot,
  CheckCircle2,
  Circle,
  GitBranch,
  MinusCircle,
  ScrollText,
  ShieldAlert,
  Signal,
  Target,
  XCircle,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { SectionHeader } from '../components/SectionHeader';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { PanelErrorState } from '../components/PanelErrorState';
import { cn, formatVietnamTime } from '@/lib/utils';
import {
  useDecisionFlow,
  type PipelineStageStatus,
  type PipelineStageView,
} from '../hooks/useDecisionFlow';

interface DecisionFlowPanelProps {
  className?: string;
}

const statusStyles: Record<
  PipelineStageStatus,
  { ring: string; bg: string; text: string; icon: typeof CheckCircle2 }
> = {
  passed: {
    ring: 'border-success',
    bg: 'bg-success-dim',
    text: 'text-success',
    icon: CheckCircle2,
  },
  blocked: {
    ring: 'border-danger',
    bg: 'bg-danger-dim',
    text: 'text-danger',
    icon: XCircle,
  },
  pending: {
    ring: 'border-warning',
    bg: 'bg-surface-1',
    text: 'text-warning',
    icon: Circle,
  },
  skipped: {
    ring: 'border-border-default',
    bg: 'bg-surface-1/40',
    text: 'text-foreground-tertiary',
    icon: MinusCircle,
  },
};

const statusLabels: Record<PipelineStageStatus, string> = {
  passed: 'Passed',
  blocked: 'Blocked',
  pending: 'Pending',
  skipped: 'Skipped',
};

function StageBadge({ status }: { status: PipelineStageStatus }) {
  const style = statusStyles[status];
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider',
        style.bg,
        style.text
      )}
    >
      {statusLabels[status]}
    </span>
  );
}

function PipelineStep({ stage, isLast }: { stage: PipelineStageView; isLast: boolean }) {
  const style = statusStyles[stage.status];
  const Icon = style.icon;

  return (
    <li className={cn('flex flex-col lg:flex-1 min-w-0', !isLast && 'lg:pb-0')}>
      <div className="flex items-stretch gap-0 lg:flex-col lg:items-center">
        <div className="flex flex-col items-center lg:flex-row lg:w-full">
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2',
              style.ring,
              style.bg
            )}
          >
            <Icon className={cn('h-4 w-4', style.text)} />
          </div>
          {!isLast && (
            <div
              className={cn(
                'w-0.5 flex-1 min-h-[2rem] lg:hidden mx-auto my-1',
                stage.status === 'passed' ? 'bg-success/50' : 'bg-border-default'
              )}
            />
          )}
          {!isLast && (
            <div
              className={cn(
                'hidden lg:block h-0.5 flex-1 mx-2',
                stage.status === 'passed' ? 'bg-success/50' : 'bg-border-default'
              )}
            />
          )}
        </div>

        <div className="flex-1 pb-6 pl-3 lg:pl-0 lg:pt-3 lg:text-center min-w-0">
          <div className="flex flex-wrap items-center gap-2 lg:justify-center">
            <p className="text-xs font-semibold text-foreground leading-tight">{stage.name}</p>
            <StageBadge status={stage.status} />
          </div>
          <p className="text-[11px] text-foreground-secondary mt-1 line-clamp-3">{stage.reason}</p>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-foreground-tertiary lg:justify-center">
            {stage.metric && <span>{stage.metric}</span>}
            {stage.timestamp && (
              <span title={stage.timestamp}>{formatVietnamTime(stage.timestamp)}</span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

const quickLinks = [
  { href: '#signal-gate', label: 'Signal Gate', icon: Signal },
  { href: '#risk-engine', label: 'Risk Engine', icon: ShieldAlert },
  { href: '#llm-dispatch', label: 'LLM Dispatch', icon: Bot },
  { href: '#event-log', label: 'Event Log', icon: ScrollText },
  { href: '#open-positions', label: 'Open Positions', icon: Target },
] as const;

export function DecisionFlowPanel({ className }: DecisionFlowPanelProps) {
  const flow = useDecisionFlow();

  if (flow.loading) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Decision Pipeline"
          subtitle="Loading pipeline state..."
          icon={<GitBranch className="w-5 h-5" />}
        />
        <LoadingSkeleton />
      </Card>
    );
  }

  if (flow.error) {
    return (
      <Card className={className}>
        <SectionHeader
          title="Decision Pipeline"
          subtitle="Error loading pipeline"
          icon={<GitBranch className="w-5 h-5" />}
        />
        <PanelErrorState message={flow.error} />
      </Card>
    );
  }

  const confidencePct =
    flow.lastSignalConfidence != null
      ? flow.lastSignalConfidence <= 1
        ? Math.round(flow.lastSignalConfidence * 100)
        : Math.round(flow.lastSignalConfidence)
      : null;

  return (
    <Card className={className}>
      <SectionHeader
        title="Decision Pipeline"
        subtitle="End-to-end trading decision flow"
        icon={<GitBranch className="w-5 h-5" />}
      />

      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="panel-stat">
            <p className="text-xs text-foreground-tertiary mb-1">Current stage</p>
            <p className="text-sm font-semibold text-accent-primary">{flow.currentStageLabel}</p>
          </div>
          <div className="panel-stat">
            <p className="text-xs text-foreground-tertiary mb-1">Readiness</p>
            <p className="text-sm font-semibold text-foreground">{flow.readinessScore}%</p>
            <div className="mt-2 progress-track">
              <div
                className="progress-fill"
                style={{ width: `${flow.readinessScore}%` }}
              />
            </div>
          </div>
          <div className="panel-stat sm:col-span-2">
            <p className="text-xs text-foreground-tertiary mb-1">Last blocking reason</p>
            <p className="text-sm text-foreground line-clamp-2">
              {flow.blockedReason || 'No active block — pipeline clear'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 text-xs">
          {flow.duplicateSignalHits > 0 && (
            <span className="px-2 py-1 rounded-md bg-warning-dim text-warning font-medium">
              Duplicate / signal-only skips today: {flow.duplicateSignalHits}
            </span>
          )}
          {flow.lastSignalGrade && (
            <span className="px-2 py-1 rounded-md bg-surface-1 text-foreground-secondary">
              Grade {flow.lastSignalGrade}
              {confidencePct != null ? ` · ${confidencePct}%` : ''}
            </span>
          )}
          {flow.lastPlaybook && flow.lastPlaybook !== '—' && (
            <span className="px-2 py-1 rounded-md bg-surface-1 text-foreground-secondary">
              {flow.lastPlaybook}
            </span>
          )}
          {flow.lastRegime && flow.lastRegime !== '—' && (
            <span className="px-2 py-1 rounded-md bg-surface-1 text-foreground-secondary">
              {flow.lastRegime}
            </span>
          )}
          {flow.lastUpdatedAt && (
            <span className="px-2 py-1 rounded-md bg-surface-1 text-foreground-tertiary">
              Updated {formatVietnamTime(flow.lastUpdatedAt)}
            </span>
          )}
        </div>

        <div className="overflow-x-auto -mx-1 px-1 pb-1 max-h-[min(28rem,70vh)] lg:max-h-none">
        <ol className="flex flex-col lg:flex-row lg:items-start lg:gap-0 gap-0 lg:min-w-max">
          {flow.stages.map((stage, index) => (
            <PipelineStep
              key={stage.id}
              stage={stage}
              isLast={index === flow.stages.length - 1}
            />
          ))}
        </ol>
        </div>

        <div className="pt-3 border-t border-border-default">
          <p className="text-xs font-medium text-foreground-tertiary mb-2">Related panels</p>
          <div className="flex flex-wrap gap-2">
            {quickLinks.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium',
                  'bg-surface-1/60 hover:bg-surface-2 border border-border-default/60 hover:border-border-strong',
                  'text-foreground-secondary hover:text-foreground transition-all duration-200 active:scale-[0.98]'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
