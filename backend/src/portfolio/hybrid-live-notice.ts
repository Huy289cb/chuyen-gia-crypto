import axios from 'axios';
import https from 'node:https';
import { isTelegramEnabled, telegramConfig } from '../config/telegram';
import { createLiveTelegramSender } from './live-telegram-transport';
import type { HybridLiveState } from './hybrid-worker';
import { handleHybridAgyCommand } from '../services/telegram/agy-chat.service';
import { downloadTelegramPhoto } from '../services/telegram/telegram-client';

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

export function formatHybridPositionClosedNotice(input: {
  symbol: string;
  qty: number;
  entryPrice: number;
  exitPrice?: number;
  pnl?: number;
  reason: 'STOP_LOSS' | 'RISK_REDUCTION' | 'BREAKEVEN' | 'LOCK_PROFIT' | 'MANUAL_OR_VENUE_STOP' | 'EVENT_SHIELD';
}): string {
  const reasonText =
    input.reason === 'BREAKEVEN'
      ? '🛡️ Dừng lỗ hòa vốn (+0.8%)'
      : input.reason === 'RISK_REDUCTION'
      ? '🛡️ Dừng lỗ giảm rủi ro (-3.0%)'
      : input.reason === 'LOCK_PROFIT'
      ? '🔒 Khóa lãi bảo toàn (+3.5% / +6% / +10%)'
      : input.reason === 'EVENT_SHIELD'
      ? '🚨 Event Shield bảo vệ'
      : '🛑 Dừng lỗ ban đầu (Stop Loss)';

  const lines = [
    `🔔 [ĐÓNG VỊ THẾ] ${coin(input.symbol)}`,
    `• Trạng thái đóng: ${reasonText}`,
    `• Khối lượng: ${qtyText(input.qty)} ${coin(input.symbol)}`,
    `• Giá vào lệnh: ${px(input.entryPrice)}`,
  ];
  if (input.exitPrice !== undefined && input.exitPrice > 0) {
    lines.push(`• Giá đóng ước tính: ${px(input.exitPrice)}`);
  }
  if (input.pnl !== undefined) {
    lines.push(`• Lãi/lỗ lệnh: ${usd(input.pnl, true)}`);
  }
  lines.push(`• Đã kích hoạt Same-Day Cooldown và hủy các lệnh chờ liên quan.`);
  return lines.join('\n');
}

export function formatHybridStopNotice(input: { symbol: string; mark: number; slPrice: number; sent: boolean }): string {
  return [
    `⚠ DỪNG LỖ ${coin(input.symbol)}`,
    `Giá ${px(input.mark)} đã chạm dừng lỗ (${px(input.slPrice)}).`,
    input.sent ? 'Đã gửi lệnh đóng.' : 'Gửi lệnh đóng thất bại. Worker sẽ thử lại.',
  ].join('\n');
}

export function formatHybridRatchetNotice(input: {
  symbol: string;
  tier: 'risk_reduction' | 'breakeven' | 'lock1' | 'lock2' | 'lock3' | 'lock';
  entryPrice: number;
  newSlPrice: number;
  maxReturnPct: number;
}): string {
  let tierTitle = '🛡️ HÒA VỐN (+0,8%)';
  if (input.tier === 'risk_reduction') {
    tierTitle = '🛡️ GIẢM RỦI RO (-3,0%)';
  } else if (input.tier === 'lock1') {
    tierTitle = '🔒 KHÓA LÃI NẤC 1 (+3,5%)';
  } else if (input.tier === 'lock2') {
    tierTitle = '🔒 KHÓA LÃI NẤC 2 (+6,0%)';
  } else if (input.tier === 'lock3' || input.tier === 'lock') {
    tierTitle = '🔒 KHÓA LÃI NẤC 3 (+10,0%)';
  }
  return [
    `🛡️ BẢO VỆ LỢI NHUẬN: ${tierTitle} cho ${coin(input.symbol)}`,
    `• Giá vào: ${px(input.entryPrice)}`,
    `• Đỉnh lãi quan sát: +${input.maxReturnPct.toFixed(1)}%`,
    `• Mức dừng lỗ mới: ${px(input.newSlPrice)} (Đã cập nhật lệnh STOP_MARKET sàn Binance)`,
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

export function formatHybridCashFlowNotice(input: {
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amount: number;
  tranId: string;
  cumulativeDeposits: number;
  strategyNetPnl: number;
  strategyRoiPct: number;
  accountEquity: number;
}): string {
  const isDeposit = input.type === 'DEPOSIT';
  return [
    `${isDeposit ? '📥 [TỰ ĐỘNG PHÁT HIỆN TIỀN NẠP]' : '📤 [TỰ ĐỘNG PHÁT HIỆN TIỀN RÚT]'} (BINANCE)`,
    `• Số tiền: ${isDeposit ? '+' : '-'}${usd(input.amount)}`,
    `• Mã giao dịch sàn: #${input.tranId}`,
    `• Vốn sàn sau biến động: ${usd(input.accountEquity)}`,
    `• Tổng tiền nạp tích lũy: ${usd(input.cumulativeDeposits)} (Đã phân lập vào vốn cơ sở)`,
    `• Lãi ròng do bot tự đánh: ${usd(input.strategyNetPnl, true)} (${input.strategyRoiPct >= 0 ? '+' : ''}${input.strategyRoiPct.toFixed(2)}%)`,
    '• Hệ thống tự động cân bằng cầu chì ngày và bảo toàn công thức PnL!',
  ].join('\n');
}

export function formatHybridPruneNotice(input: {
  symbol: string;
  entryPrice: number;
  exitPrice: number;
  lossPct: number;
  pnl: number;
  daysHeld: number;
}): string {
  return [
    `✂️ CẮT TỈA COIN CHÌM XUỒNG (PHASE 8 PRUNING)`,
    `• Đồng coin: ${coin(input.symbol)}`,
    `• Thời gian giữ: ${input.daysHeld} ngày (không vượt nổi +2%)`,
    `• Giá vào: ${px(input.entryPrice)} ➔ Giá thoát: ${px(input.exitPrice)}`,
    `• Cắt lỗ sớm: ${input.lossPct.toFixed(2)}% (Tiết kiệm ~7% so với mức SL -12%)`,
    `• Lãi/lỗ lệnh: ${usd(input.pnl, true)}`,
    `• Slot tiền mặt đã được giải phóng ngay lập tức để đón coin mới bứt phá!`,
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
      const ageSec = state.lastObservedAt ? Math.round((Date.now() - Date.parse(state.lastObservedAt)) / 1000) : 999;
      const isStale = ageSec > 45;
      const statusText = state.breakerLatched
        ? '🚨 CẦU CHÌ ĐÃ KÍCH HOẠT'
        : isStale
        ? `⚠️ Worker phản hồi chậm (${ageSec}s trước)`
        : '✅ Đang giám sát (nhịp 3s)';

      return [
        '🟢 WORKER HYBRID LIVE (PHASE 6)',
        `• Trạng thái: ${statusText}`,
        `• Vốn sàn (Equity): ${usd(state.accountEquity)}`,
        `• Khả dụng (Available): ${usd(state.availableBalance)}`,
        `• Lãi/lỗ hôm nay: ${usd(state.currentDayPnl, true)}`,
        `• Lãi/lỗ vị thế mở: ${usd(totalUnrl, true)}`,
        `• Cập nhật: ${formatTimeIct(state.lastObservedAt)}${isStale ? ` (${ageSec}s trước)` : ''}`,
        `• Cầu chì ngày: 12 USDT ${state.breakerLatched ? '(ĐÃ CHẠM)' : '(An toàn)'}`,
        `• Vị thế đang giữ: ${positions.length} lệnh (${positions.map(p => coin(p.symbol)).join(', ') || 'trống'})`,
      ].join('\n');
    }

    case 'report':
    case 'baocao':
    case 'lenh':
    case 'positions': {
      const lines = [
        '📊 BÁO CÁO VỊ THẾ HYBRID LIVE (PHASE 6)',
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
          let tierNote = 'SL sàn:';
          if (p.ratchetTier === 'risk_reduction') tierNote = '🛡️ SL Giảm rủi ro (-3%):';
          else if (p.ratchetTier === 'breakeven') tierNote = '🛡️ SL Hòa vốn (+0.8%):';
          else if (p.ratchetTier === 'lock1') tierNote = '🔒 SL Khóa lãi 1 (+3.5%):';
          else if (p.ratchetTier === 'lock2') tierNote = '🔒 SL Khóa lãi 2 (+6.0%):';
          else if (p.ratchetTier === 'lock3' || p.ratchetTier === 'lock') tierNote = '🔒 SL Khóa lãi 3 (+10.0%):';
          lines.push(`• ${p.qty > 0 ? 'MUA' : 'BÁN'} ${qtyText(p.qty)} ${coin(p.symbol)}: ${stateStr} ${usd(p.unrlPnl, true)}`);
          lines.push(`   Giá vào: ${px(p.entryPrice)} | Hiện tại: ${px(p.markPrice)} | ${tierNote} ${px(p.slPrice)}`);
        }
      }
      lines.push('');
      lines.push(`• Sleeve 2 (BTC Grid): ${state.btcGridLevels?.length ? `${state.btcGridLevels.length} tầng khớp` : 'Đang chờ BTC giảm sâu dưới 10-EMA'}`);
      lines.push('• Crash Gate: 6% đóng băng mua khi BTC sập');
      lines.push('• Trần rủi ro: 12 USDT/ngày');
      return lines.join('\n');
    }

    case 'pnl': {
      const cf = state.cashFlow;
      const lines = [
        '💰 PNL TỔNG KẾT TÀI KHOẢN (PHÂN LẬP MINH BẠCH)',
        `• Vốn sàn thực tế (Equity): ${usd(state.accountEquity)}`,
      ];
      if (cf) {
        lines.push(
          `• Vốn nạp cơ sở (Gốc + Nạp): ${usd(cf.adjustedBaselineEquity)} (${usd(cf.baselineEquity)} gốc + ${usd(cf.cumulativeDeposits)} nạp)`,
          `• Lãi ròng do bot tự đánh (từ ${cf.baselineDate}): ${usd(cf.strategyNetPnl, true)} (${cf.strategyRoiPct >= 0 ? '+' : ''}${cf.strategyRoiPct.toFixed(2)}%)`,
        );
      }
      lines.push(
        `• Lãi/lỗ lệnh đang mở: ${usd(totalUnrl, true)}`,
        `• Lãi/lỗ hôm nay: ${usd(state.currentDayPnl, true)}`,
        `• Mức sụt vốn lớn nhất ngày: ${usd(state.worstDayPnl)}`,
        `• Dư an toàn trần 12u: ${usd(Math.max(0, 12 + state.currentDayPnl))}`,
      );
      return lines.join('\n');
    }

    case 'cashflow':
    case 'dongtien': {
      const cf = state.cashFlow;
      if (!cf) {
        return '💰 DÒNG TIỀN:\n• Đang khởi động module CashFlow.';
      }
      return [
        '💰 QUẢN LÝ DÒNG TIỀN NGOẠI VI (PHÂN LẬP VỐN)',
        `• Mốc tính chuẩn: ${cf.baselineDate}`,
        `• Vốn xuất phát mốc chuẩn: ${usd(cf.baselineEquity)}`,
        `• Tổng tiền nạp thêm: +${usd(cf.cumulativeDeposits)}`,
        `• Tổng tiền rút ra: -${usd(cf.cumulativeWithdrawals)}`,
        `• Vốn cơ sở điều chỉnh: ${usd(cf.adjustedBaselineEquity)}`,
        `• Lãi/lỗ ròng chiến lược: ${usd(cf.strategyNetPnl, true)} (${cf.strategyRoiPct >= 0 ? '+' : ''}${cf.strategyRoiPct.toFixed(2)}%)`,
        '• Toàn bộ tiền nạp/rút được tự động phân lập, tuyệt đối không tính vào lãi giao dịch!',
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
        '🤖 CÁC LỆNH THEO DÕI BOT HYBRID LIVE (PHASE 6):',
        '• /agy <câu hỏi> — Chat với Antigravity AI trực tiếp trên máy chủ',
        '• /agy list · /agy resume <số> — Xem & chọn hội thoại tiếp tục',
        '• /agy new · /agy status · /agy cancel — Quản lý phiên agy',
        '• /status — Trạng thái worker, vốn sàn & an toàn',
        '• /report (hoặc /lenh) — Chi tiết các vị thế đang mở & giá Stop Loss',
        '• /pnl — Lãi/lỗ hôm nay & lãi/lỗ chưa chốt (Phân lập tiền nạp)',
        '• /cashflow (hoặc /dongtien) — Quản lý dòng tiền nạp/rút & vốn cơ sở',
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
          message?: {
            chat?: { id: number | string };
            text?: string;
            caption?: string;
            photo?: Array<{ file_id: string; file_unique_id?: string; width?: number; height?: number; file_size?: number }>;
          };
        }>) || [];

        for (const update of updates) {
          offset = update.update_id + 1;
          const msg = update.message;
          if (!msg) continue;
          const chatId = String(msg.chat?.id || '');
          if (!chatId) continue;

          // Check if chat is authorized (chỉ nhận trong group được cấp phép)
          if (telegramConfig.chatIds.length && !telegramConfig.chatIds.includes(chatId)) {
            continue;
          }

          const rawText = msg.text?.trim() || '';
          const rawCaption = msg.caption?.trim() || '';
          const photos = msg.photo;

          // Xử lý khi người dùng gửi ảnh biểu đồ (photo)
          if (photos && photos.length > 0) {
            const bestPhoto = photos[photos.length - 1];
            console.log(`[HybridTelegramListener] Received photo (file_id=${bestPhoto.file_id}) with caption: "${rawCaption}" from ${chatId}`);

            try {
              await send(chatId, '📸 Đã nhận ảnh biểu đồ từ Telegram. Đang tải về và phân tích các nét vẽ...');
            } catch (err) {
              console.warn('[HybridTelegramListener] Failed to send photo acknowledgement:', err);
            }

            const imagePath = await downloadTelegramPhoto(bestPhoto.file_id);
            if (!imagePath) {
              await send(chatId, '❌ Không thể tải ảnh từ Telegram về máy chủ. Vui lòng gửi lại ảnh!');
              continue;
            }

            const questionText = rawCaption.replace(/^\/agy\s*/i, '').trim() ||
              'Phân tích kỹ thuật chi tiết biểu đồ này: nhận diện mã coin, khung thời gian, các đường kẻ vẽ, vùng cản/hỗ trợ, xu hướng và đưa ra nhận định khách quan.';

            void handleHybridAgyCommand(chatId, questionText, send, imagePath);
            continue;
          }

          if (!rawText) continue;

          console.log(`[HybridTelegramListener] Received message: "${rawText}" from ${chatId}`);

          // Lệnh bắt đầu bằng /agy
          if (rawText.startsWith('/agy')) {
            void handleHybridAgyCommand(chatId, rawText, send);
            continue;
          }

          const cmd = rawText.replace(/^\//, '').split(/\s+/)[0]?.toLowerCase() || '';
          const KNOWN_COMMANDS = new Set([
            'status', 'trangthai',
            'report', 'baocao', 'lenh', 'positions', 'book',
            'pnl', 'lai', 'laikep', 'compounding',
            'grid', 'luoi',
            'universe', 'vutru',
            'shield', 'lachang',
            'help', 'trogiup', 'start'
          ]);

          // Nếu là lệnh hệ thống đã biết
          if (KNOWN_COMMANDS.has(cmd)) {
            const reply = formatHybridCommandResponse(rawText, getState());
            try {
              await send(chatId, reply);
              console.log(`[HybridTelegramListener] Replied to ${chatId}`);
            } catch (sendErr) {
              console.error('[HybridTelegramListener] Reply send error:', sendErr);
            }
            continue;
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
