'use client';

import { Filter, ArrowDown, AlertTriangle } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { SectionHeader } from '../components/SectionHeader';
import type { RulesLanguage } from './v3-rules';

const gradeStyles: Record<string, { badge: 'success' | 'info' | 'warning' | 'neutral'; bar: string }> = {
  A: { badge: 'success', bar: 'bg-success w-full' },
  B: { badge: 'info', bar: 'bg-info w-4/5' },
  C: { badge: 'warning', bar: 'bg-warning w-1/2' },
  D: { badge: 'neutral', bar: 'bg-foreground-tertiary/40 w-1/4' },
};

const copy = {
  vi: {
    title: 'Signal Gate — Chấm điểm A / B / C / D',
    subtitle: 'Code thuần (không LLM): regime → 2 playbook → lọc env',
    overview:
      'MarketScan gọi analyzer trên nến 15m / 1h / 4h. Grade + confidence + regime quyết định PASS trước khi gọi Groq.',
    flow: [
      { label: 'Nến (≥50)', sub: 'OHLCV từ Binance/DB' },
      { label: 'Regime', sub: 'trend / range / chop' },
      { label: 'Playbook', sub: 'Sweep hoặc Breakout' },
      { label: 'Grade A–D', sub: 'Chỉ A/B ra gate' },
      { label: '3 điều kiện', sub: 'Grade + conf + regime' },
      { label: 'PASS → LLM', sub: 'Hoặc BLOCK' },
    ],
    grades: {
      title: 'Thang điểm',
      items: [
        { g: 'A', label: 'Setup mạnh', desc: 'Wick/body hoặc breakout/volume đạt ngưỡng cao', conf: '0.85' },
        { g: 'B', label: 'Setup vừa', desc: 'Pattern rõ nhưng yếu hơn A', conf: '0.70' },
        { g: 'C', label: 'Yếu (analyzer)', desc: 'Có pattern nhưng gate không dùng C → coi như D', conf: '0.55' },
        { g: 'D', label: 'Không đạt', desc: 'Chop, thiếu nến, không A/B, hoặc không match playbook', conf: '0' },
      ],
    },
    regime: {
      title: 'Bước 1 — Market regime (50 nến)',
      chop: 'chop → Grade D ngay (volatility cao + xu hướng yếu)',
      trend: 'trend — slope giá mạnh (>0.3% hoặc >0.15%)',
      range: 'range — biên hẹp, volatility thấp',
      gate: 'Gate chỉ cho trend hoặc range (không chop).',
    },
    playbooks: {
      title: 'Bước 2 — Hai playbook',
      sweep: {
        name: 'Liquidity Sweep + Reclaim',
        window: '20 nến gần nhất',
        rules: [
          'Sweep high: đỉnh > max 19 nến trước + nến đỏ (reject)',
          'Sweep low: đáy < min 19 nến trước + nến xanh (reclaim)',
        ],
        table: [
          ['A', 'Râu > 60% biên nến', 'Thân > 20%'],
          ['B', 'Râu > 50%', 'Thân > 15%'],
          ['C', 'Còn lại (detected)', '—'],
        ],
      },
      breakout: {
        name: 'Breakout + Volume',
        window: '30 nến (sideway 25 + hiện tại)',
        rules: [
          'Bull: close > resistance + volume > 1.5× TB',
          'Bear: close < support + volume > 1.5× TB',
        ],
        table: [
          ['A', 'Break > 1% range', 'Volume > 2× TB'],
          ['B', 'Break > 0.5% range', 'Volume > 1.5× TB'],
          ['C', 'Yếu hơn', 'Volume > 1.5× TB'],
        ],
      },
      merge:
        'Setup-gate chỉ gom A hoặc B (ưu tiên confidence cao hơn). Không có A/B → kết quả D.',
    },
    pass: {
      title: 'Bước 3 — Điều kiện PASS (cả 3)',
      items: [
        {
          name: 'Grade',
          desc: 'grade ≤ MIN_SIGNAL_GRADE (A tốt nhất, D tệ nhất). Ví dụ min=B → cần A hoặc B.',
        },
        {
          name: 'Confidence',
          desc: 'confidence ≥ MIN_SIGNAL_CONFIDENCE (0–1).',
        },
        {
          name: 'Regime',
          desc: 'regime ∈ {trend, range} — chop bị loại từ bước 1.',
        },
      ],
      example: {
        title: 'Ví dụ env production',
        rows: [
          ['MIN_SIGNAL_GRADE', 'B → cần grade A hoặc B'],
          ['MIN_SIGNAL_CONFIDENCE', '0.7 → cho phép B (0.70) và A (0.85)'],
        ],
      },
    },
    diagramCaption: 'Luồng đánh giá Signal Gate',
    tableGrade: 'Grade',
    colWick: 'Râu / breakout',
    colBody: 'Thân / volume',
    warnings: {
      title: 'Lưu ý quan trọng',
      items: [
        'Grade C chỉ tồn tại trong analyzer từng playbook — setup-gate không trả C; thực tế thường thấy D.',
        'Log "Grade D below minimum B" = chưa có sweep/breakout đủ A hoặc B, không phải lỗi worker.',
        'Duplicate filter 15 phút: cùng hash nến → skip, không gọi LLM lại.',
      ],
    },
  },
  en: {
    title: 'Signal Gate — A / B / C / D grading',
    subtitle: 'Pure code (no LLM): regime → 2 playbooks → env filters',
    overview:
      'MarketScan runs analyzers on 15m / 1h / 4h candles. Grade + confidence + regime decide PASS before Groq.',
    flow: [
      { label: 'Candles (≥50)', sub: 'OHLCV from Binance/DB' },
      { label: 'Regime', sub: 'trend / range / chop' },
      { label: 'Playbook', sub: 'Sweep or Breakout' },
      { label: 'Grade A–D', sub: 'Only A/B exit gate' },
      { label: '3 checks', sub: 'Grade + conf + regime' },
      { label: 'PASS → LLM', sub: 'Or BLOCK' },
    ],
    grades: {
      title: 'Grade scale',
      items: [
        { g: 'A', label: 'Strong setup', desc: 'High wick/body or breakout/volume thresholds', conf: '0.85' },
        { g: 'B', label: 'Moderate', desc: 'Valid pattern, weaker than A', conf: '0.70' },
        { g: 'C', label: 'Weak (analyzer)', desc: 'Pattern detected but gate ignores C → treated as D', conf: '0.55' },
        { g: 'D', label: 'Fail', desc: 'Chop, insufficient candles, no A/B, or no playbook match', conf: '0' },
      ],
    },
    regime: {
      title: 'Step 1 — Market regime (50 candles)',
      chop: 'chop → immediate Grade D (high volatility + weak trend)',
      trend: 'trend — strong price slope (>0.3% or >0.15%)',
      range: 'range — tight range, low volatility',
      gate: 'Gate allows trend or range only (not chop).',
    },
    playbooks: {
      title: 'Step 2 — Two playbooks',
      sweep: {
        name: 'Liquidity Sweep + Reclaim',
        window: 'Last 20 candles',
        rules: [
          'High sweep: high > prior 19-candle max + bearish close (rejection)',
          'Low sweep: low < prior 19-candle min + bullish close (reclaim)',
        ],
        table: [
          ['A', 'Wick > 60% of range', 'Body > 20%'],
          ['B', 'Wick > 50%', 'Body > 15%'],
          ['C', 'Otherwise (detected)', '—'],
        ],
      },
      breakout: {
        name: 'Breakout + Volume',
        window: '30 candles (25 consolidation + current)',
        rules: [
          'Bull: close > resistance + volume > 1.5× avg',
          'Bear: close < support + volume > 1.5× avg',
        ],
        table: [
          ['A', 'Break > 1% of range', 'Volume > 2× avg'],
          ['B', 'Break > 0.5% of range', 'Volume > 1.5× avg'],
          ['C', 'Weaker', 'Volume > 1.5× avg'],
        ],
      },
      merge: 'Setup-gate keeps only A or B (higher confidence wins). No A/B → grade D.',
    },
    pass: {
      title: 'Step 3 — PASS conditions (all 3)',
      items: [
        {
          name: 'Grade',
          desc: 'grade index ≤ MIN_SIGNAL_GRADE (A best, D worst). e.g. min=B requires A or B.',
        },
        {
          name: 'Confidence',
          desc: 'confidence ≥ MIN_SIGNAL_CONFIDENCE (0–1).',
        },
        {
          name: 'Regime',
          desc: 'regime ∈ {trend, range} — chop rejected in step 1.',
        },
      ],
      example: {
        title: 'Example production env',
        rows: [
          ['MIN_SIGNAL_GRADE', 'B → needs grade A or B'],
          ['MIN_SIGNAL_CONFIDENCE', '0.7 → allows B (0.70) and A (0.85)'],
        ],
      },
    },
    diagramCaption: 'Signal Gate evaluation flow',
    tableGrade: 'Grade',
    colWick: 'Wick / break',
    colBody: 'Body / volume',
    warnings: {
      title: 'Important notes',
      items: [
        'Grade C exists only inside per-playbook analyzers — setup-gate does not output C; logs often show D.',
        '"Grade D below minimum B" means no A/B sweep or breakout yet — not a worker bug.',
        '15-minute duplicate filter: same candle hash → skip, no repeat LLM call.',
      ],
    },
  },
} as const;

interface SignalGateGradingSectionProps {
  language: RulesLanguage;
}

function CriteriaTable({
  gradeLabel,
  col2,
  col3,
  rows,
}: {
  gradeLabel: string;
  col2: string;
  col3: string;
  rows: readonly (readonly string[])[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-default">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-2 text-left">
            <th className="px-3 py-2 font-medium text-foreground">{gradeLabel}</th>
            <th className="px-3 py-2 font-medium text-foreground">{col2}</th>
            <th className="px-3 py-2 font-medium text-foreground">{col3}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-default">
          {rows.map((row) => (
            <tr key={row[0]}>
              <td className="px-3 py-2">
                <Badge variant={gradeStyles[row[0]]?.badge ?? 'neutral'} size="sm">
                  {row[0]}
                </Badge>
              </td>
              <td className="px-3 py-2 text-foreground-secondary">{row[1]}</td>
              <td className="px-3 py-2 text-foreground-secondary">{row[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SignalGateGradingSection({ language }: SignalGateGradingSectionProps) {
  const t = copy[language];

  return (
    <section>
      <SectionHeader title={t.title} subtitle={t.subtitle} icon={<Filter className="w-5 h-5" />} />
      <p className="text-sm text-foreground-secondary mb-4 -mt-4">{t.overview}</p>

      <Card padding="md" className="mb-4">
        <p className="text-xs font-medium text-foreground-tertiary uppercase tracking-wide mb-4">
          {t.diagramCaption}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {t.flow.map((step, i) => (
            <div key={step.label} className="relative flex flex-col items-center">
              <div className="w-full rounded-lg border border-accent-primary/30 bg-accent-primary/10 px-2 py-3 text-center min-h-[72px] flex flex-col justify-center">
                <p className="text-xs font-semibold text-foreground leading-tight">{step.label}</p>
                <p className="text-[10px] text-foreground-tertiary mt-1 leading-tight">{step.sub}</p>
              </div>
              {i < t.flow.length - 1 && (
                <span
                  className="hidden lg:block absolute -right-3 top-1/2 -translate-y-1/2 text-foreground-tertiary text-sm z-10"
                  aria-hidden
                >
                  →
                </span>
              )}
              {i < t.flow.length - 1 && i % 2 === 0 && (
                <ArrowDown className="w-4 h-4 text-foreground-tertiary my-1 lg:hidden" />
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card padding="md" className="mb-4">
        <h4 className="font-semibold text-foreground mb-4">{t.grades.title}</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          {t.grades.items.map((item) => (
            <div key={item.g} className="rounded-lg border border-border-default p-3 bg-surface-1">
              <div className="flex items-center justify-between gap-2 mb-2">
                <Badge variant={gradeStyles[item.g]?.badge ?? 'neutral'} size="md">
                  {item.g}
                </Badge>
                <span className="text-xs text-foreground-tertiary">conf {item.conf}</span>
              </div>
              <p className="text-sm font-medium text-foreground">{item.label}</p>
              <p className="text-xs text-foreground-secondary mt-1">{item.desc}</p>
              <div className="mt-3 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                <div className={`h-full rounded-full ${gradeStyles[item.g]?.bar ?? ''}`} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card padding="md" className="mb-4">
        <h4 className="font-semibold text-foreground mb-3">{t.regime.title}</h4>
        <ul className="space-y-2 text-sm text-foreground-secondary">
          <li className="flex gap-2 items-start">
            <Badge variant="danger" size="sm">
              chop
            </Badge>
            <span>{t.regime.chop}</span>
          </li>
          <li className="flex gap-2 items-start">
            <Badge variant="success" size="sm">
              trend
            </Badge>
            <span>{t.regime.trend}</span>
          </li>
          <li className="flex gap-2 items-start">
            <Badge variant="info" size="sm">
              range
            </Badge>
            <span>{t.regime.range}</span>
          </li>
        </ul>
        <p className="text-sm text-accent-primary mt-3 font-medium">{t.regime.gate}</p>
      </Card>

      <Card padding="md" className="mb-4">
        <h4 className="font-semibold text-foreground mb-4">{t.playbooks.title}</h4>
        <div className="space-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h5 className="font-medium text-foreground">{t.playbooks.sweep.name}</h5>
              <code className="text-xs px-2 py-0.5 rounded bg-surface-2">{t.playbooks.sweep.window}</code>
            </div>
            <ul className="text-sm text-foreground-secondary space-y-1 mb-3 list-disc list-inside">
              {t.playbooks.sweep.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <CriteriaTable
              gradeLabel={t.tableGrade}
              col2={t.colWick}
              col3={t.colBody}
              rows={t.playbooks.sweep.table}
            />
          </div>
          <div className="border-t border-border-default pt-6">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h5 className="font-medium text-foreground">{t.playbooks.breakout.name}</h5>
              <code className="text-xs px-2 py-0.5 rounded bg-surface-2">
                {t.playbooks.breakout.window}
              </code>
            </div>
            <ul className="text-sm text-foreground-secondary space-y-1 mb-3 list-disc list-inside">
              {t.playbooks.breakout.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <CriteriaTable
              gradeLabel={t.tableGrade}
              col2={t.colWick}
              col3={t.colBody}
              rows={t.playbooks.breakout.table}
            />
          </div>
        </div>
        <p className="text-sm text-foreground-secondary mt-4 border-t border-border-default pt-4">
          {t.playbooks.merge}
        </p>
      </Card>

      <Card padding="md" className="mb-4">
        <h4 className="font-semibold text-foreground mb-4">{t.pass.title}</h4>
        <ol className="space-y-3">
          {t.pass.items.map((item, i) => (
            <li key={item.name} className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-success/20 text-success text-sm font-bold flex items-center justify-center">
                {i + 1}
              </span>
              <div>
                <p className="font-medium text-foreground text-sm">{item.name}</p>
                <p className="text-sm text-foreground-secondary mt-0.5">{item.desc}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-4 rounded-lg bg-surface-2 p-3">
          <p className="text-xs font-semibold text-foreground mb-2">{t.pass.example.title}</p>
          <dl className="space-y-1.5">
            {t.pass.example.rows.map(([k, v]) => (
              <div key={k} className="flex flex-col sm:flex-row sm:gap-2 text-xs">
                <dt className="font-mono text-accent-primary shrink-0">{k}</dt>
                <dd className="text-foreground-secondary">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>

      <Card padding="md" className="border-warning/30 bg-warning/5">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-warning" />
          <h4 className="font-semibold text-foreground">{t.warnings.title}</h4>
        </div>
        <ul className="space-y-2">
          {t.warnings.items.map((item) => (
            <li key={item} className="text-sm text-foreground-secondary flex gap-2">
              <span className="text-warning shrink-0">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
