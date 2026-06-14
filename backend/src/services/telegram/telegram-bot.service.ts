import {
  isChatAllowed,
  isTelegramEnabled,
  isTelegramPollingEnabled,
  isUserAllowed,
  logTelegramProcessContext,
} from '../../config/telegram';
import {
  deleteTelegramWebhook,
  getTelegramUpdates,
  type TelegramUpdate,
} from './telegram-client';
import { enqueueTelegramMessage } from './telegram-client';
import {
  getAccountBalanceSummary,
  getDefaultTradingScope,
  getOpenPositionLines,
  getPendingOrderLines,
} from '../account-summary.service';
import {
  getSystemHealthSnapshot,
  getLlmStatsTodayIct,
  getLastKimDecision,
  formatRelativeAgo,
} from '../system-health.service';
import { prisma } from '../../lib/prisma';
import { fmtUsd, escapeHtml, formatShowSummary, formatPipelineSummary, formatStatusSummary } from './message-formatters';
import {
  isTelegramRealtimeMuted,
  setTelegramRealtimeMuted,
} from './telegram-notify.service';
import { buildDailyReportMessage } from './daily-report';
import { handleAiCommand, handleDeployHelpCommand, handleLogsCommand } from './telegram-ai.service';
import {
  handleFixCommand,
  handleFixStatusCommand,
} from './cursor-agent.service';

let polling = false;
let offset = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

const HELP_TEXT = `<b>Lệnh cơ bản</b>
/show — tài khoản + cooldown
/lenh — vị thế + lệnh chờ
/pnl — PnL hôm nay / 7 ngày
/pipeline — pipeline tóm tắt
/baocao — báo cáo ngày
/status — trạng thái hệ thống
/sukien — sự kiện gần nhất
/tat · /bat — tắt/bật notify

<b>AI</b> (Groq)
/ai · /ai loi · /ai pipeline · /ai llm
/ai vi &lt;câu hỏi&gt; · /ai so sanh · /ai cancel

<b>Khác</b>
/fix · /deploy? · /logs · /help`;

async function handleCommand(chatId: string, text: string, userId?: string): Promise<void> {
  const cmd = text.trim().split(/\s+/)[0]?.toLowerCase() || '';
  const { symbol, methodId } = getDefaultTradingScope();

  switch (cmd) {
    case '/start':
    case '/help':
      enqueueTelegramMessage(HELP_TEXT, chatId);
      return;

    case '/tat':
      setTelegramRealtimeMuted(true);
      enqueueTelegramMessage('🔕 Đã tắt thông báo realtime. Báo cáo 21h vẫn gửi.', chatId);
      return;

    case '/bat':
      setTelegramRealtimeMuted(false);
      enqueueTelegramMessage('🔔 Đã bật thông báo realtime.', chatId);
      return;

    case '/pnl': {
      const b = await getAccountBalanceSummary(symbol, methodId, true);
      const gapNote = b.dbPositionPnlTrusted
        ? ''
        : `\n⚠️ DB positions ${fmtUsd(b.dbPositionPnlSum)} (gap ${fmtUsd(b.dbPositionPnlGap)})`;
      enqueueTelegramMessage(
        `<b>PnL (wallet)</b>\nAll-time: ${fmtUsd(b.walletPnl)}\nBinance realized: ${fmtUsd(b.binanceRealizedPnl)}` +
          `\nPhí: ${fmtUsd(b.totalFees)} | Funding: ${fmtUsd(b.fundingFees)}` +
          `\nHôm nay (ICT): ${fmtUsd(b.dailyPnL)} | 7d: ${fmtUsd(b.weeklyPnL)}` +
          `\nUnrealized: ${fmtUsd(b.openUnrealized)} | Equity: ${fmtUsd(b.equity)}${gapNote}`,
        chatId
      );
      return;
    }

    case '/lenh': {
      const [positions, pending] = await Promise.all([
        getOpenPositionLines(symbol, methodId),
        getPendingOrderLines(symbol, methodId),
      ]);
      const lines = ['<b>Vị thế mở</b>'];
      if (positions.length === 0) lines.push('(không có)');
      for (const p of positions) {
        lines.push(
          `• ${escapeHtml(p.symbol)} ${escapeHtml(p.side)} entry=${p.entry} mark=${p.mark.toFixed(2)} uPnL=${fmtUsd(p.unrealizedPnl)}`
        );
      }
      lines.push('', '<b>Lệnh chờ</b>');
      if (pending.length === 0) lines.push('(không có)');
      for (const o of pending) {
        lines.push(`• ${escapeHtml(o.symbol)} ${escapeHtml(o.side)} @${o.entry}`);
      }
      enqueueTelegramMessage(lines.join('\n'), chatId);
      return;
    }

    case '/pipeline': {
      const [health, llm, lastDecision] = await Promise.all([
        getSystemHealthSnapshot(),
        getLlmStatsTodayIct(),
        getLastKimDecision(),
      ]);
      const msg = formatPipelineSummary({
        schedulers: health.schedulers,
        warmupOk: health.warmup.isWarmedUp,
        llmTotal: llm.total,
        llmTrades: llm.trades,
        lastDecision: lastDecision
          ? {
              decision: lastDecision.decision,
              reason: lastDecision.reason,
              ago: formatRelativeAgo(lastDecision.timestamp),
            }
          : undefined,
      });
      enqueueTelegramMessage(msg, chatId);
      return;
    }

    case '/status':
    case '/health': {
      const health = await getSystemHealthSnapshot();
      enqueueTelegramMessage(
        formatStatusSummary({
          workerStatus: health.workerStatus,
          databaseStatus: health.databaseStatus,
          safetyValidation: health.safetyValidation,
          schedulers: health.schedulers,
          warmupOk: health.warmup.isWarmedUp,
          riskLocked: health.risk.isLocked,
          lockReason: health.risk.lockReason,
          binanceEnabled: health.binanceEnabled,
          recentErrors: health.recentErrors,
        }),
        chatId
      );
      return;
    }

    case '/show': {
      const [b, health, positions, pending] = await Promise.all([
        getAccountBalanceSummary(symbol, methodId, true),
        getSystemHealthSnapshot(),
        getOpenPositionLines(symbol, methodId),
        getPendingOrderLines(symbol, methodId),
      ]);
      enqueueTelegramMessage(
        formatShowSummary({
          equity: b.equity,
          totalBalance: b.totalBalance,
          dailyPnL: b.dailyPnL,
          openCount: positions.length,
          pendingCount: pending.length,
          riskLocked: health.risk.isLocked,
          lockReason: health.risk.lockReason,
          notifyMuted: isTelegramRealtimeMuted(),
          topError: health.recentErrors[0],
        }),
        chatId
      );
      return;
    }

    case '/sukien': {
      const [events, decisions] = await Promise.all([
        prisma.testnetTradeEvent.findMany({ orderBy: { timestamp: 'desc' }, take: 5 }),
        prisma.tradeDecision.findMany({
          where: { method_id: methodId },
          orderBy: { timestamp: 'desc' },
          take: 3,
        }),
      ]);
      const lines = ['<b>Sự kiện gần đây</b>'];
      for (const e of events) {
        lines.push(`• [${escapeHtml(e.event_type)}] ${e.timestamp.toISOString().slice(11, 16)}`);
      }
      for (const d of decisions) {
        lines.push(
          `• [${escapeHtml(d.decision)}] ${d.timestamp.toISOString().slice(11, 16)} ${escapeHtml((d.reason || '').slice(0, 40))}`
        );
      }
      if (events.length === 0 && decisions.length === 0) lines.push('(không có)');
      enqueueTelegramMessage(lines.join('\n'), chatId);
      return;
    }

    case '/baocao': {
      const report = await buildDailyReportMessage();
      enqueueTelegramMessage(report, chatId);
      return;
    }

    case '/ai': {
      const args = text.replace(/^\/ai\s*/i, '').trim();
      void handleAiCommand(chatId, userId, args);
      return;
    }

    case '/fix': {
      const fixArgs = text.replace(/^\/fix\s*/i, '').trim();
      if (fixArgs.toLowerCase() === 'status') {
        void handleFixStatusCommand(chatId);
      } else {
        void handleFixCommand(chatId, userId, fixArgs);
      }
      return;
    }

    case '/logs': {
      void handleLogsCommand(chatId, userId);
      return;
    }

    default:
      if (cmd.startsWith('/deploy')) {
        handleDeployHelpCommand(chatId);
        return;
      }
      if (cmd.startsWith('/')) {
        enqueueTelegramMessage('Lệnh không hợp lệ. Gõ /help', chatId);
      }
  }
}

function processUpdate(update: TelegramUpdate): void {
  const msg = update.message;
  if (!msg?.text || !msg.chat) return;

  const chatId = String(msg.chat.id);
  const userId = msg.from?.id;

  if (!isChatAllowed(chatId) || !isUserAllowed(userId)) {
    console.warn(`[TelegramBot] Rejected chat=${chatId} user=${userId}`);
    return;
  }

  const text = msg.text.trim();
  if (!text.startsWith('/')) return;

  handleCommand(chatId, text, userId !== undefined ? String(userId) : undefined).catch((err) => {
    console.error('[TelegramBot] command error:', err);
    enqueueTelegramMessage('Lỗi xử lý lệnh. Thử lại sau.', chatId);
  });
}

async function pollOnce(): Promise<void> {
  if (!polling || !isTelegramEnabled()) return;
  try {
    const updates = await getTelegramUpdates(offset > 0 ? offset : undefined);
    for (const u of updates) {
      if (u.update_id >= offset) offset = u.update_id + 1;
      processUpdate(u);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[TelegramBot] poll error:', msg);
  }
}

function schedulePoll(): void {
  if (!polling) return;
  pollTimer = setTimeout(async () => {
    await pollOnce();
    schedulePoll();
  }, 100);
}

export function startTelegramBot(): void {
  logTelegramProcessContext('worker-bot');

  if (!isTelegramEnabled()) {
    console.log('[TelegramBot] Disabled (TELEGRAM_ENABLED or missing token/chat ids)');
    return;
  }

  if (!isTelegramPollingEnabled()) {
    console.log(
      '[TelegramBot] Polling OFF (TELEGRAM_POLLING_ENABLED!=true). ' +
        'Outbound notify/sendMessage only; manual getUpdates is free for debug.'
    );
    return;
  }

  if (polling) {
    console.warn(`[TelegramBot] Already polling pid=${process.pid} — skip duplicate start`);
    return;
  }

  void deleteTelegramWebhook().then(() => {
    polling = true;
    console.log(`[TelegramBot] Starting long polling pid=${process.pid} (consumes getUpdates queue)`);
    schedulePoll();
  });
}

export function stopTelegramBot(): void {
  polling = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}
