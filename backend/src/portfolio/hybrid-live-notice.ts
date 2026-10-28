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

export function formatHybridBreakerNotice(dayPnl: number, sent: boolean, limitUsd = 12.0): string {
  return [
    '🚨 CẦU CHÌ NGÀY',
    `Lãi/lỗ ngày ${usd(dayPnl, true)}, chạm trần ${usd(limitUsd)}.`,
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

function formatTimeIct(iso?: string): string {
  if (!iso) return 'vừa xong';
  try {
    const d = new Date(Date.parse(iso) + 7 * 3_600_000);
    return d.toISOString().slice(11, 19) + ' ICT';
  } catch {
    return 'vừa xong';
  }
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
        `• Lãi/lỗ vị thế mở: ${usd(totalUnrl, true)}`,
        `• Cập nhật: ${formatTimeIct(state.lastObservedAt)}`,
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
        `Vốn: ${usd(state.accountEquity)} | Lãi/lỗ ngày: ${usd(state.currentDayPnl, true)} | Chưa chốt: ${usd(totalUnrl, true)}`,
        `Cập nhật lúc: ${formatTimeIct(state.lastObservedAt)}`,
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

    case 'universe':
    case 'vutru': {
      const du = state.dynamicUniverse;
      if (!du) {
        return '🌐 VŨ TRỤ GIAO DỊCH (PHASE 4):\n• Đang sử dụng 40 symbols mặc định.';
      }
      return [
        '🌐 VŨ TRỤ GIAO DỊCH ĐỘNG (PHASE 4)',
        `• Số lượng lọc: Top ${du.count} Binance Futures (> $50M/ngày)`,
        `• Cập nhật lần cuối: ${formatTimeIct(du.lastScannedAt)}`,
        `• Top 10 thanh khoản: ${du.topSymbols.map(coin).join(', ')}`,
        '• Tự động loại bỏ coin rác, giảm trượt giá taker về tối thiểu.',
      ].join('\n');
    }

    case 'shield':
    case 'lachang': {
      const es = state.eventShield;
      if (!es || es.blacklistCount === 0) {
        return [
          '🛡️ EVENT SHIELD (LÁ CHẮN THIÊN NGA ĐEN)',
          '• Trạng thái: ✅ Đang trực chiến',
          '• Danh sách Blacklist: 0 coin',
          '• Không phát hiện tin tức Delist hoặc Exploit nguy hiểm.',
        ].join('\n');
      }
      return [
        '🛡️ EVENT SHIELD (LÁ CHẮN THIÊN NGA ĐEN)',
        `• Danh sách Blacklist: ${es.blacklistCount} coin`,
        `• Lệnh đóng khẩn cấp (Critical Close): ${es.criticalCloseCount} coin`,
        `• Các coin bị chặn: ${es.blacklistedSymbols.map(coin).join(', ')}`,
      ].join('\n');
    }

    case 'compounding':
    case 'lai':
    case 'laikep': {
      const dc = state.dynamicCompounding;
      if (!dc) {
        return '📈 LÃI KÉP ĐỘNG (PHASE 5):\n• Đang sử dụng phân bổ mặc định 24% / 14%.';
      }
      return [
        '📈 LÃI KÉP ĐỘNG — DYNAMIC COMPOUNDING (PHASE 5)',
        `• Vốn tài khoản hiện hành: ${usd(state.accountEquity)}`,
        `• Phân bổ Momentum: ${usd(dc.momentumAllocUsd)} / lệnh (tương đương ${(dc.targetMomentumPct * 100).toFixed(0)}% vốn)`,
        `• Phân bổ BTC Grid: ${usd(dc.btcGridTicketUsd)} / tầng (tương đương ${(dc.targetGridTicketPct * 100).toFixed(0)}% vốn)`,
        `• Trần rủi ro ngày: ${usd(dc.dailyLossLimitUsd)} (12% day-start equity, sàn 12.0u)`,
        '• Tự động tái đầu tư lợi nhuận, giữ an toàn tỷ lệ đòn bẩy tối đa 0.9x.',
      ].join('\n');
    }

    case 'grid':
    case 'luoi': {
      const vg = state.volatilityGrid;
      if (!vg) {
        return '⚡ LƯỚI BTC CO GIÃN THEO ATR (PHASE 5):\n• Đang sử dụng thông số lưới mặc định.';
      }
      return [
        '⚡ LƯỚI BIẾN ĐỘNG BTC (PHASE 5 ATR-14 VOLATILITY GRID)',
        `• ATR 14 ngày hiện tại: $${vg.atr14.toFixed(0)} (${vg.atr14Pct.toFixed(2)}% giá BTC)`,
        `• Hệ số biến động (Vol Multiplier): ${vg.volMultiplier.toFixed(2)}x (${vg.regime === 'high_volatility' ? 'Biến động mạnh' : vg.regime === 'low_volatility' ? 'Thị trường yên ắng' : 'Biến động bình thường'})`,
        `• Bước lưới co giãn: ${(vg.gridStepPct * 100).toFixed(2)}% mỗi tầng`,
        `• Chốt lời kỳ vọng: +${(vg.gridTpPct * 100).toFixed(2)}%`,
        `• Cửa chặn sập (Crash Gate): -${(vg.crashGatePct * 100).toFixed(2)}%`,
        `• Các tầng đang giữ: ${state.btcGridLevels?.length || 0}/3 tầng`,
      ].join('\n');
    }

    case 'help':
    default: {
      return [
        '🤖 CÁC LỆNH THEO DÕI BOT PHA 5 HYBRID:',
        '• /status — Trạng thái worker, vốn sàn & an toàn',
        '• /report (hoặc /lenh) — Chi tiết các vị thế đang mở & giá Stop Loss',
        '• /pnl — Lãi/lỗ hôm nay & lãi/lỗ chưa chốt',
        '• /compounding (hoặc /lai) — Quy mô phân bổ vốn lãi kép động',
        '• /grid (hoặc /luoi) — Thông số lưới BTC co giãn theo biến động ATR',
        '• /universe — Xem Top coin thanh khoản trong vũ trụ động',
        '• /shield — Trạng thái lá chắn Delist & Exploit',
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
