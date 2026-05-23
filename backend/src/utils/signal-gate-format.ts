import type { SignalGateConfig, SignalGateOutput } from '../services/signal-gate.service';
import { getV3SignalGateTimeframes } from '../config/v3-schedulers';

export interface SignalGateTimeframeRow {
  timeframe: string;
  output: SignalGateOutput;
}

/** Human-readable gate failure (grade / confidence / regime). */
export function formatGateFailureReason(
  output: SignalGateOutput,
  config: Pick<SignalGateConfig, 'minGrade' | 'minConfidence' | 'allowedRegimes'>
): string | null {
  if (output.pass) return null;

  const { setupResult } = output;
  const gradeOrder = ['A', 'B', 'C', 'D'];
  const minIndex = gradeOrder.indexOf(config.minGrade);
  const gradeIndex = gradeOrder.indexOf(setupResult.grade);
  const gradePass = gradeIndex <= minIndex;
  const confidencePass = setupResult.confidence >= config.minConfidence;
  const regimePass = config.allowedRegimes.includes(setupResult.regime);

  if (!gradePass) {
    return `Grade ${setupResult.grade} dưới ngưỡng ${config.minGrade}`;
  }
  if (!confidencePass) {
    return `Confidence ${(setupResult.confidence * 100).toFixed(0)}% dưới ngưỡng ${(config.minConfidence * 100).toFixed(0)}%`;
  }
  if (!regimePass) {
    return `Regime ${setupResult.regime} không thuộc ${config.allowedRegimes.join('/')}`;
  }
  return output.reason || null;
}

/**
 * Full block reason for DB / event log: gate rule + setup analysis.
 */
export function formatSignalGateBlockReason(
  output: SignalGateOutput,
  config: Pick<SignalGateConfig, 'minGrade' | 'minConfidence' | 'allowedRegimes'>
): string {
  const gate = formatGateFailureReason(output, config);
  const setup = output.setupResult;
  const parts: string[] = [];

  if (gate) parts.push(gate);
  if (setup.reason) parts.push(`Setup: ${setup.reason}`);
  if (setup.detailReason) {
    const oneLine = setup.detailReason.replace(/\n/g, ' | ');
    parts.push(oneLine.length > 280 ? `${oneLine.slice(0, 277)}…` : oneLine);
  }
  parts.push(`Regime: ${setup.regime}`);
  if (setup.playbookKey) parts.push(`Playbook: ${setup.playbookKey}`);

  return parts.join(' · ');
}

function formatTimeframeBlock(row: SignalGateTimeframeRow, config: SignalGateConfig): string {
  const { timeframe, output } = row;
  const s = output.setupResult;
  const gate = formatGateFailureReason(output, config);

  const header = output.pass
    ? `• ${timeframe}: PASS · grade ${s.grade} · conf ${(s.confidence * 100).toFixed(0)}% · ${s.regime}${s.playbookKey ? ` · ${s.playbookKey}` : ''}`
    : `• ${timeframe}: BLOCK · grade ${s.grade} · ${s.regime}${gate ? ` (${gate})` : ''}`;

  const detail = s.detailReason?.trim();
  if (!detail) return header;

  const indented = detail
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  return `${header}\n${indented}`;
}

/**
 * Single Telegram message for one market-scan cycle (all TFs).
 */
export function formatSignalGateTelegramScan(
  symbol: string,
  rows: SignalGateTimeframeRow[],
  config: SignalGateConfig
): { title: string; body: string } {
  const anyPass = rows.some((r) => r.output.pass && !r.output.isDuplicate);
  const title = anyPass ? '✅ Signal Gate — quét xong' : '🚫 Signal Gate BLOCK — quét xong';

  const sorted = [...rows].sort((a, b) => {
    const order = [...getV3SignalGateTimeframes()];
    const ai = order.indexOf(a.timeframe);
    const bi = order.indexOf(b.timeframe);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const lines = sorted.map((r) => formatTimeframeBlock(r, config));
  const policy = `Yêu cầu: grade ≥ ${config.minGrade}, conf ≥ ${(config.minConfidence * 100).toFixed(0)}%, regime ${config.allowedRegimes.join('|')}`;

  return {
    title,
    body: [`${symbol}`, ...lines, policy].join('\n'),
  };
}
