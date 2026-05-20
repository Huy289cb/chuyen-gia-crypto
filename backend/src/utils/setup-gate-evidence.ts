import type { SetupGateEvidence } from '../analyzers/setup-gate.types';

function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Multi-line Vietnamese explanation for Telegram / dashboard */
export function formatSetupGateDetail(evidence: SetupGateEvidence): string {
  const lines: string[] = [];
  const { regime: r, playbooks, price, timeframe } = evidence;

  lines.push(
    `Giá ${fmtPrice(price)} · ${evidence.candleCount} nến · TF ${timeframe}`
  );
  lines.push(`Regime ${r.regime.toUpperCase()}: ${r.matchedRule}`);
  lines.push(
    `  (biến động ${r.volatilityPct.toFixed(2)}%, trend ${r.trendStrengthPct.toFixed(2)}%, biên 50n ${r.rangePct.toFixed(2)}%)`
  );
  if (r.trendDirection) {
    lines.push(`  Hướng: ${r.trendDirection}`);
  }

  for (const pb of playbooks) {
    const label =
      pb.playbook === 'liquidity_sweep' ? 'Liquidity sweep' : 'Breakout + volume';
    if (pb.detected) {
      lines.push(`${label}: có · grade ${pb.grade} — ${pb.summary}`);
    } else {
      lines.push(`${label}: không — ${pb.summary}`);
    }
  }

  return lines.join('\n');
}

/** Compact one-liner for chips / reason codes */
export function formatSetupGateSummary(evidence: SetupGateEvidence): string {
  const pb = evidence.playbooks
    .map((p) => {
      const tag = p.playbook === 'liquidity_sweep' ? 'LS' : 'BO';
      return p.detected ? `${tag}:${p.grade}` : `${tag}:—`;
    })
    .join(' ');
  return `${evidence.regime.regime} · ${evidence.regime.matchedRule.split(':')[0]} · ${pb}`;
}
