import {
  isChatAllowed,
  isTelegramEnabled,
  isUserAllowed,
} from '../../config/telegram';
import { getTelegramUpdates, type TelegramUpdate } from './telegram-client';
import { enqueueTelegramMessage } from './telegram-client';
import {
  getAccountBalanceSummary,
  getDefaultTradingScope,
  getOpenPositionLines,
  getPendingOrderLines,
} from '../account-summary.service';
import { getSystemHealthSnapshot, getLlmStatsTodayIct } from '../system-health.service';
import { prisma } from '../../lib/prisma';
import { fmtUsd, escapeHtml } from './message-formatters';
import {
  isTelegramRealtimeMuted,
  setTelegramRealtimeMuted,
} from './telegram-notify.service';
import { buildDailyReportMessage } from './daily-report';

let polling = false;
let offset = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

const HELP_TEXT = `Lệnh:
/lenh — vị thế + lệnh chờ
/show — tài khoản + pipeline + lỗi
/pnl — PnL hôm nay / 7 ngày (ICT)
/pipeline — schedulers + warmup
/sukien — 10 sự kiện gần nhất
/baocao — gửi báo cáo ngày ngay
/help — trợ giúp
/tat — tắt notify realtime
/bat — bật notify realtime`;

async function handleCommand(chatId: string, text: string): Promise<void> {
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
      enqueueTelegramMessage(
        `<b>PnL (ICT)</b>\nHôm nay: ${fmtUsd(b.dailyPnL)}\n7 ngày: ${fmtUsd(b.weeklyPnL)}\nUnrealized: ${fmtUsd(b.openUnrealized)}\nEquity: ${fmtUsd(b.equity)}`,
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
      const health = await getSystemHealthSnapshot();
      const llm = await getLlmStatsTodayIct();
      const lines = ['<b>Pipeline</b>'];
      for (const s of health.schedulers) {
        lines.push(`• ${s.name} [${s.status}] ${s.lastRun} cron=${s.cron}`);
      }
      lines.push(`Warmup: ${health.warmup.isWarmedUp ? 'OK' : 'CHƯA ĐỦ'}`);
      for (const tf of health.warmup.timeframes) {
        lines.push(`  ${tf.name}: ${tf.loaded}/${tf.required}`);
      }
      lines.push(`LLM hôm nay: ${llm.total} (trade ${llm.trades})`);
      lines.push(`Worker: ${health.workerStatus} | DB: ${health.databaseStatus}`);
      enqueueTelegramMessage(lines.join('\n'), chatId);
      return;
    }

    case '/show': {
      const [b, health] = await Promise.all([
        getAccountBalanceSummary(symbol, methodId, true),
        getSystemHealthSnapshot(),
      ]);
      const lines = [
        '<b>Tài khoản</b>',
        `Equity ${fmtUsd(b.equity)} | Balance ${fmtUsd(b.totalBalance)}`,
        `PnL today ${fmtUsd(b.dailyPnL)} | 7d ${fmtUsd(b.weeklyPnL)}`,
        `Exposure ${fmtUsd(b.exposureUsd)} / ${fmtUsd(b.maxExposureUsd)}`,
        '',
        '<b>Pipeline</b>',
        ...health.schedulers.map((s) => `• ${s.name}: ${s.status} (${s.lastRun})`),
        `Warmup: ${health.warmup.isWarmedUp ? 'OK' : 'THIẾU'}`,
        `Safety: ${escapeHtml(health.safetyValidation)}`,
        `Notify: ${isTelegramRealtimeMuted() ? 'TẮT' : 'BẬT'}`,
      ];
      if (health.recentErrors.length > 0) {
        lines.push('', '<b>Log / lỗi</b>');
        for (const e of health.recentErrors) {
          lines.push(`• ${escapeHtml(e.event_type)}: ${escapeHtml(e.summary.slice(0, 100))}`);
        }
      } else {
        lines.push('', '(không có lỗi gần đây)');
      }
      enqueueTelegramMessage(lines.join('\n'), chatId);
      return;
    }

    case '/sukien': {
      const [events, decisions] = await Promise.all([
        prisma.testnetTradeEvent.findMany({ orderBy: { timestamp: 'desc' }, take: 8 }),
        prisma.tradeDecision.findMany({
          where: { method_id: methodId },
          orderBy: { timestamp: 'desc' },
          take: 5,
        }),
      ]);
      const lines = ['<b>Sự kiện gần đây</b>'];
      for (const e of events) {
        lines.push(`• [${e.event_type}] ${e.timestamp.toISOString().slice(11, 19)} pos=${e.position_id.slice(0, 8)}`);
      }
      for (const d of decisions) {
        lines.push(
          `• [decision ${d.decision}] ${d.timestamp.toISOString().slice(11, 19)} ${escapeHtml((d.reason || '').slice(0, 50))}`
        );
      }
      enqueueTelegramMessage(lines.join('\n'), chatId);
      return;
    }

    case '/baocao': {
      const report = await buildDailyReportMessage();
      enqueueTelegramMessage(report, chatId);
      return;
    }

    default:
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

  handleCommand(chatId, text).catch((err) => {
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
  if (!isTelegramEnabled()) {
    console.log('[TelegramBot] Disabled (TELEGRAM_ENABLED or missing token/chat ids)');
    return;
  }
  if (polling) return;
  polling = true;
  console.log('[TelegramBot] Starting long polling...');
  schedulePoll();
}

export function stopTelegramBot(): void {
  polling = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}
