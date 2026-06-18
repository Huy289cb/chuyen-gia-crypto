import { getIctDateString } from '../../utils/ict-time';
import {
  getAccountBalanceSummary,
  getDefaultTradingScope,
  getLiveOpenPositionLines,
  getLivePendingOrderLines,
  getTodayTradeStatsIct,
} from '../account-summary.service';
import {
  getSystemHealthSnapshot,
  getLlmStatsTodayIct,
} from '../system-health.service';
import {
  fmtUsd,
  escapeHtml,
  statusEmoji,
} from './message-formatters';
import { enqueueTelegramMessage } from './telegram-client';

export async function buildDailyReportMessage(): Promise<string> {
  const { symbol, methodId } = getDefaultTradingScope();
  const [balance, todayStats, positions, pending, health, llm] = await Promise.all([
    getAccountBalanceSummary(symbol, methodId, true),
    getTodayTradeStatsIct(symbol, methodId),
    getLiveOpenPositionLines(symbol, methodId),
    getLivePendingOrderLines(symbol, methodId),
    getSystemHealthSnapshot(),
    getLlmStatsTodayIct(),
  ]);

  const staleCount = health.schedulers.filter((s) => s.status === 'stale').length;
  const pipelineOk = health.warmup.isWarmedUp && staleCount === 0;

  const lines: string[] = [
    `<b>📊 Báo cáo ${escapeHtml(getIctDateString())}</b>`,
    `${escapeHtml(symbol)} · Equity ${fmtUsd(balance.equity)} · Balance ${fmtUsd(balance.totalBalance)}`,
    '',
    `<b>PnL</b> Hôm nay ${fmtUsd(balance.dailyPnL)} | 7 ngày ${fmtUsd(balance.weeklyPnL)} | Unrealized ${fmtUsd(balance.openUnrealized)}`,
    todayStats.fromDbPositions
      ? `<b>Giao dịch</b> Đóng ${todayStats.closedCount} (W${todayStats.wins}/L${todayStats.losses}) · Realized ${fmtUsd(todayStats.totalRealizedPnl)}`
      : `<b>Giao dịch</b> Đóng ${todayStats.closedCount}`,
    `<b>Đang mở</b> ${positions.length} vị thế, ${pending.length} lệnh chờ`,
    `<b>LLM</b> ${llm.total} quyết định (${llm.trades} trade)`,
    `${statusEmoji(pipelineOk)} Pipeline ${pipelineOk ? 'OK' : health.warmup.isWarmedUp ? `${staleCount} scheduler stale` : 'warmup thiếu'}`,
  ];

  if (health.risk.isLocked) {
    lines.push(`🔒 ${escapeHtml(health.risk.lockReason || 'Cooldown')}`);
  }

  if (health.recentErrors.length > 0) {
    const e = health.recentErrors[0];
    lines.push(`⚠️ ${escapeHtml(e.event_type)}: ${escapeHtml(e.summary.slice(0, 60))}`);
  }

  return lines.join('\n');
}

export async function sendDailyReport(): Promise<void> {
  const text = await buildDailyReportMessage();
  enqueueTelegramMessage(text);
}
