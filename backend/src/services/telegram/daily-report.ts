import { getIctDateString } from '../../utils/ict-time';
import {
  getAccountBalanceSummary,
  getDefaultTradingScope,
  getOpenPositionLines,
  getPendingOrderLines,
  getTodayTradeStatsIct,
} from '../account-summary.service';
import {
  getSystemHealthSnapshot,
  getLlmStatsTodayIct,
  getTopNoTradeReasonsIct,
} from '../system-health.service';
import { fmtUsd, escapeHtml } from './message-formatters';
import { enqueueTelegramMessage } from './telegram-client';

export async function buildDailyReportMessage(): Promise<string> {
  const { symbol, methodId } = getDefaultTradingScope();
  const [balance, todayStats, positions, pending, health, llm, topReasons] = await Promise.all([
    getAccountBalanceSummary(symbol, methodId, true),
    getTodayTradeStatsIct(symbol, methodId),
    getOpenPositionLines(symbol, methodId),
    getPendingOrderLines(symbol, methodId),
    getSystemHealthSnapshot(),
    getLlmStatsTodayIct(),
    getTopNoTradeReasonsIct(3),
  ]);

  const lines: string[] = [
    `<b>📊 Báo cáo ngày ${escapeHtml(getIctDateString())}</b>`,
    `${symbol} / ${methodId}`,
    '',
    '<b>Tài khoản</b>',
    `Balance: ${fmtUsd(balance.totalBalance)} | Equity: ${fmtUsd(balance.equity)}`,
    `Margin dùng: ${fmtUsd(balance.usedMargin)} | Exposure: ${fmtUsd(balance.exposureUsd)} / ${fmtUsd(balance.maxExposureUsd)}`,
    '',
    '<b>PnL (ICT)</b>',
    `Hôm nay: ${fmtUsd(balance.dailyPnL)} | 7 ngày: ${fmtUsd(balance.weeklyPnL)}`,
    `Unrealized: ${fmtUsd(balance.openUnrealized)}`,
    '',
    '<b>Giao dịch hôm nay</b>',
    `Đóng: ${todayStats.closedCount} (W${todayStats.wins}/L${todayStats.losses})`,
    `Realized: ${fmtUsd(todayStats.totalRealizedPnl)} | Phí: ${fmtUsd(todayStats.totalFees)}`,
    '',
    `<b>Đang mở</b> (${positions.length} pos, ${pending.length} pending)`,
  ];

  for (const p of positions.slice(0, 8)) {
    lines.push(`• ${p.symbol} ${p.side} entry=${p.entry} uPnL=${fmtUsd(p.unrealizedPnl)}`);
  }
  for (const o of pending.slice(0, 5)) {
    lines.push(`• pending ${o.symbol} ${o.side} @${o.entry}`);
  }
  if (positions.length === 0 && pending.length === 0) {
    lines.push('(không có)');
  }

  lines.push('', '<b>Pipeline</b>');
  for (const s of health.schedulers) {
    lines.push(`• ${s.name}: ${s.status} (${s.lastRun})`);
  }
  lines.push(`Warmup: ${health.warmup.isWarmedUp ? 'OK' : 'THIẾU NẾN'}`);
  lines.push(`Worker: ${health.workerStatus} | DB: ${health.databaseStatus}`);
  lines.push(`Binance: ${health.binanceEnabled ? 'ON' : 'OFF'}`);

  lines.push('', '<b>LLM hôm nay</b>');
  lines.push(`Quyết định: ${llm.total} | trade: ${llm.trades} | no_trade: ${llm.noTrades}`);
  if (topReasons.length > 0) {
    lines.push('Top no_trade:');
    for (const r of topReasons) {
      lines.push(`• (${r.count}) ${escapeHtml(r.reason.slice(0, 60))}`);
    }
  }

  lines.push('', '<b>Risk (ICT)</b>');
  lines.push(
    `Daily loss: ${fmtUsd(health.risk.dailyLossCurrent)} / ${fmtUsd(health.risk.dailyLossCapUsd)}`
  );
  if (health.risk.isLocked) {
    lines.push(`🔒 ${escapeHtml(health.risk.lockReason || 'locked')}`);
  }

  if (health.recentErrors.length > 0) {
    lines.push('', '<b>Lưu ý</b>');
    for (const e of health.recentErrors.slice(0, 5)) {
      lines.push(`• ${escapeHtml(e.event_type)}: ${escapeHtml(e.summary.slice(0, 80))}`);
    }
  }

  return lines.join('\n');
}

export async function sendDailyReport(): Promise<void> {
  const text = await buildDailyReportMessage();
  enqueueTelegramMessage(text);
}
