import axios from 'axios';
import https from 'node:https';
import { isTelegramEnabled, telegramConfig } from '../config/telegram';
import { createLiveTelegramSender } from './live-telegram-transport';
import type { HybridLiveState } from './hybrid-worker';

const agent = new https.Agent({ family: 4, keepAlive: true });

export interface HybridNoticePosition {
  symbol: string;
  qty: number;
  unrlPnl: number;
  slPrice: number;
}

const coin = (symbol: string): string => (symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol);
const px = (value: number): string => value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
const usd = (value: number, signed = false): string => {
  const sign = value < 0 ? '-' : signed && value > 0 ? '+' : '';
  return `${sign}${Math.abs(value).toFixed(2).replace('.', ',')} USDT`;
};
const qtyText = (value: number): string => String(Math.abs(value)).replace('.', ',');

/** One snapshot of the book the hybrid worker is already watching. */
export function formatHybridBookNotice(input: {
  positions: HybridNoticePosition[];
  equity: number;
  dayPnl: number;
}): string {
  const lines = ['📊 PHA 2 ĐANG GIỮ LỆNH'];
  const positions = [...input.positions].sort((a, b) => a.symbol.localeCompare(b.symbol));
  if (!positions.length) lines.push('Không còn vị thế.');
  for (const position of positions) {
    const state = position.unrlPnl > 0 ? 'đang lãi' : position.unrlPnl < 0 ? 'đang lỗ' : 'đang hòa vốn';
    lines.push(`${position.qty > 0 ? 'MUA' : 'BÁN'} ${qtyText(position.qty)} ${coin(position.symbol)}: ${state} ${usd(position.unrlPnl, true)}. Dừng lỗ ${px(position.slPrice)}.`);
  }
  lines.push(`Vốn ${usd(input.equity)}. Lãi/lỗ ngày ${usd(input.dayPnl, true)}. Trần lỗ 12 USDT/ngày.`);
  lines.push('Lãi/lỗ lệnh mở theo giá, chưa tính phí.');
  return lines.join('\n');
}

export function formatHybridStopNotice(input: { symbol: string; mark: number; slPrice: number; sent: boolean }): string {
  return [
    `⚠ DỪNG LỖ ${coin(input.symbol)}`,
    `Giá ${px(input.mark)} đã chạm dừng lỗ 12% (${px(input.slPrice)}).`,
    input.sent ? 'Đã gửi lệnh đóng.' : 'Gửi lệnh đóng thất bại. Worker sẽ thử lại.',
  ].join('\n');
}

export function formatHybridBreakerNotice(dayPnl: number, sent: boolean): string {
  return [
    '🚨 CẦU CHÌ NGÀY',
    `Lãi/lỗ ngày ${usd(dayPnl, true)}, chạm trần 12 USDT.`,
    sent ? 'Đã gửi lệnh đóng toàn bộ.' : 'Gửi lệnh đóng thất bại. Worker sẽ thử lại.',
  ].join('\n');
}

export function formatHybridRebalanceNotice(input: {
  closed: string[];
  opened: Array<{ symbol: string; qty: number; entryPrice: number }>;
  nextRebalanceDate: string;
}): string {
  const lines = ['🔄 TÁI CÂN BẰNG ĐỊNH KỲ 2 NGÀY (PHA 2)'];
  if (input.closed.length) {
    lines.push(`• Đã đóng các coin rời Top 2: ${input.closed.map(coin).join(', ')}`);
  }
  if (input.opened.length) {
    for (const p of input.opened) {
      lines.push(`• Mở mới: MUA ${qtyText(p.qty)} ${coin(p.symbol)} @ ${px(p.entryPrice)}`);
    }
  } else {
    lines.push('• Giữ nguyên Top 2 hiện tại.');
  }
  lines.push(`• Đợt tái cân bằng tiếp theo: ${input.nextRebalanceDate}`);
  return lines.join('\n');
}

export function formatHybridTpNotice(input: { symbol: string; qty: number; exitPrice: number; pnl: number }): string {
  return [
    `🎯 CHỐT LỜI ${coin(input.symbol)} (SLEEVE 2 GRID)`,
    `Đã bán ${qtyText(input.qty)} ${coin(input.symbol)} @ ${px(input.exitPrice)}.`,
    `Lợi nhuận chốt: +${usd(input.pnl)}.`,
  ].join('\n');
}

/** Formats response for interactive Telegram commands (/status, /report, /lenh, /pnl, /help) */
export function formatHybridCommandResponse(rawCmd: string, state: HybridLiveState | null): string {
  const cmd = rawCmd.trim().replace(/^\//, '').split(/\s+/)[0]?.toLowerCase() || '';

  if (!state) {
    return '⏳ Worker đang đồng bộ dữ liệu sàn, vui lòng thử lại sau vài giây.';
  }

  const positions = Object.values(state.positions || {});
  const totalUnrl = positions.reduce((acc, p) => acc + p.unrlPnl, 0);

  switch (cmd) {
    case 'status':
    case 'tt': {
      return [
        '🟢 WORKER PHA 2 HYBRID LIVE',
        `• Trạng thái: ${state.breakerLatched ? '🚨 CẦU CHÌ ĐÃ KÍCH HOẠT' : '✅ Đang giám sát (nhịp 3s)'}`,
        `• Vốn sàn (Equity): ${usd(state.accountEquity)}`,
        `• Khả dụng (Available): ${usd(state.availableBalance)}`,
        `• Lãi/lỗ hôm nay: ${usd(state.currentDayPnl, true)}`,
        `• Cầu chì ngày: 12 USDT ${state.breakerLatched ? '(ĐÃ CHẠM)' : '(An toàn)'}`,
        `• Vị thế đang giữ: ${positions.length} lệnh (${positions.map(p => coin(p.symbol)).join(', ') || 'trống'})`,
      ].join('\n');
    }

    case 'report':
    case 'baocao':
    case 'lenh':
    case 'positions': {
      const lines = [
        '📊 BÁO CÁO VỊ THẾ PHA 2',
        `Vốn: ${usd(state.accountEquity)} | Lãi/lỗ ngày: ${usd(state.currentDayPnl, true)}`,
        '',
        'Các lệnh đang giữ:',
      ];
      if (!positions.length) {
        lines.push('• Không có vị thế mở nào.');
      } else {
        for (const p of positions) {
          const stateStr = p.unrlPnl > 0 ? 'đang lãi' : p.unrlPnl < 0 ? 'đang lỗ' : 'hòa vốn';
          lines.push(`• ${p.qty > 0 ? 'MUA' : 'BÁN'} ${qtyText(p.qty)} ${coin(p.symbol)}: ${stateStr} ${usd(p.unrlPnl, true)}`);
          lines.push(`   Giá vào: ${px(p.entryPrice)} | Hiện tại: ${px(p.markPrice)} | SL 12%: ${px(p.slPrice)}`);
        }
      }
      lines.push('');
      lines.push(`• Sleeve 2 (BTC Grid): ${state.btcGridLevels?.length ? `${state.btcGridLevels.length} tầng khớp` : 'Đang chờ BTC giảm sâu dưới 10-EMA'}`);
      lines.push('• Crash Gate: 6% đóng băng mua khi BTC sập');
      lines.push('• Trần rủi ro: 12 USDT/ngày');
      return lines.join('\n');
    }

    case 'pnl': {
      return [
        '💰 PNL TỔNG KẾT TÀI KHOẢN',
        `• Vốn sàn hiện tại: ${usd(state.accountEquity)}`,
        `• Lãi/lỗ lệnh đang mở: ${usd(totalUnrl, true)}`,
        `• Lãi/lỗ hôm nay: ${usd(state.currentDayPnl, true)}`,
        `• Mức sụt vốn lớn nhất ngày: ${usd(state.worstDayPnl)}`,
        `• Dư an toàn trần 12u: ${usd(Math.max(0, 12 + state.currentDayPnl))}`,
      ].join('\n');
    }

    case 'help':
    default: {
      return [
        '🤖 CÁC LỆNH THEO DÕI BOT PHA 2:',
        '• /status — Trạng thái worker, vốn sàn & an toàn',
        '• /report (hoặc /lenh) — Chi tiết các vị thế đang mở & giá Stop Loss',
        '• /pnl — Lãi/lỗ hôm nay & lãi/lỗ chưa chốt',
        '• /help — Danh sách lệnh hỗ trợ',
      ].join('\n');
    }
  }
}

export async function sendHybridTelegram(text: string): Promise<string[]> {
  if (!isTelegramEnabled() || telegramConfig.notifyLevel === 'off' || !text.trim()) return [];
  const send = createLiveTelegramSender(telegramConfig.botToken);
  const ids: string[] = [];
  for (const chatId of telegramConfig.chatIds) ids.push(await send(chatId, text));
  return ids;
}

/** Starts background Telegram interactive long-polling listener for commands */
export function startHybridTelegramCommandListener(getState: () => HybridLiveState | null): () => void {
  if (!isTelegramEnabled() || !telegramConfig.botToken) {
    return () => {};
  }

  let active = true;
  let offset = 0;
  const send = createLiveTelegramSender(telegramConfig.botToken);

  console.log('[HybridTelegramListener] Starting interactive Telegram command polling...');

  const loop = async () => {
    while (active) {
      try {
        const response = await axios.get(`https://api.telegram.org/bot${telegramConfig.botToken}/getUpdates`, {
          params: {
            timeout: 15,
            allowed_updates: ['message'],
            ...(offset > 0 ? { offset } : {}),
          },
          timeout: 25_000,
          httpsAgent: agent,
        });

        const updates = (response.data?.result as Array<{
          update_id: number;
          message?: { chat?: { id: number | string }; text?: string };
        }>) || [];

        for (const update of updates) {
          offset = update.update_id + 1;
          const text = update.message?.text?.trim();
          const chatId = String(update.message?.chat?.id || '');
          if (!text || !chatId) continue;

          // Check if chat is authorized
          if (telegramConfig.chatIds.length && !telegramConfig.chatIds.includes(chatId)) {
            continue;
          }

          console.log(`[HybridTelegramListener] Received command: "${text}" from ${chatId}`);
          const reply = formatHybridCommandResponse(text, getState());
          try {
            await send(chatId, reply);
            console.log(`[HybridTelegramListener] Replied to ${chatId}`);
          } catch (sendErr) {
            console.error('[HybridTelegramListener] Reply send error:', sendErr);
          }
        }
      } catch (err) {
        // Sleep 3 seconds on transient network error before retry
        await new Promise((r) => setTimeout(r, 3_000));
      }
    }
  };

  void loop();
  return () => {
    console.log('[HybridTelegramListener] Stopping command polling...');
    active = false;
  };
}
