import axios from 'axios';
import https from 'node:https';
import { isTelegramEnabled, telegramConfig } from '../config/telegram';
import { createLiveTelegramSender } from './live-telegram-transport';
import type { HybridLiveState } from './hybrid-worker';
import { handleHybridAgyCommand } from '../services/telegram/agy-chat.service';
import { downloadTelegramPhoto } from '../services/telegram/telegram-client';

export const OFFICIAL_RELEASE_VERSION = 'v2.0.0';

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
const sideLabel = (qty: number): string => (qty >= 0 ? 'MUA (LONG)' : 'BÁN (SHORT)');

/** One snapshot of the book the hybrid worker is already watching. */
export function formatHybridBookNotice(input: {
  positions: HybridNoticePosition[];
  equity: number;
  dayPnl: number;
  dailyLossLimitUsd?: number;
}): string {
  const limitUsd = input.dailyLossLimitUsd && input.dailyLossLimitUsd > 0 ? input.dailyLossLimitUsd : 12;
  const limitStr = Number.isInteger(limitUsd) ? String(limitUsd) : limitUsd.toFixed(2).replace('.', ',');
  const lines = [`📊 DANH MỤC TURTLE DUAL L/S ${OFFICIAL_RELEASE_VERSION}`];
  const positions = [...input.positions].sort((a, b) => a.symbol.localeCompare(b.symbol));
  if (!positions.length) lines.push('Không còn vị thế.');
  for (const position of positions) {
    const state = position.unrlPnl > 0 ? 'đang lãi' : position.unrlPnl < 0 ? 'đang lỗ' : 'đang hòa vốn';
    lines.push(`${position.qty >= 0 ? 'MUA' : 'BÁN'} ${qtyText(position.qty)} ${coin(position.symbol)}: ${state} ${usd(position.unrlPnl, true)}. Dừng lỗ ${px(position.slPrice)}.`);
  }
  lines.push(`Vốn ${usd(input.equity)}. Lãi/lỗ ngày ${usd(input.dayPnl, true)}. Trần lỗ ${limitStr} USDT/ngày.`);
  lines.push('Lãi/lỗ lệnh mở theo giá mark, chưa tính phí.');
  return lines.join('\n');
}

export function formatHybridPositionClosedNotice(input: {
  symbol: string;
  qty: number;
  entryPrice: number;
  exitPrice?: number;
  pnl?: number;
  reason: 'STOP_LOSS' | 'CHANDELIER' | 'REGIME_ALIGN' | 'RISK_REDUCTION' | 'BREAKEVEN' | 'LOCK_PROFIT' | 'MANUAL_OR_VENUE_STOP' | 'EVENT_SHIELD';
}): string {
  const reasonText =
    input.reason === 'LOCK_PROFIT'
      ? '🔒 Chandelier khóa lãi (>= +1%)'
      : input.reason === 'BREAKEVEN'
      ? '🛡️ Chandelier bảo vệ hòa vốn'
      : input.reason === 'CHANDELIER'
      ? '📐 Chandelier Trail 2,5x ATR'
      : input.reason === 'REGIME_ALIGN'
      ? '🧭 Đóng theo đảo pha BTC EMA50'
      : input.reason === 'RISK_REDUCTION'
      ? '🛡️ Dừng lỗ giảm rủi ro (-4.0%)'
      : input.reason === 'EVENT_SHIELD'
      ? '🚨 Event Shield bảo vệ'
      : '🛑 Dừng lỗ ban đầu (2.0x ATR)';

  const lines = [
    `🔔 [ĐÓNG VỊ THẾ ${input.qty >= 0 ? 'LONG' : 'SHORT'}] ${coin(input.symbol)}`,
    `• Lý do đóng: ${reasonText}`,
    `• Chiều & KL: ${sideLabel(input.qty)} ${qtyText(input.qty)} ${coin(input.symbol)}`,
    `• Giá vào lệnh: ${px(input.entryPrice)}`,
  ];
  if (input.exitPrice !== undefined && input.exitPrice > 0) {
    lines.push(`• Giá đóng ước tính: ${px(input.exitPrice)}`);
  }
  if (input.pnl !== undefined) {
    lines.push(`• Lãi/lỗ ròng: ${usd(input.pnl, true)}`);
  }
  lines.push(`• Đã kích hoạt Cooldown 24h và dọn sạch lệnh SL chờ.`);
  return lines.join('\n');
}

export function formatHybridStopNotice(input: { symbol: string; mark: number; slPrice: number; sent: boolean; qty?: number }): string {
  return [
    `⚠ DỪNG LỖ ${coin(input.symbol)}${input.qty !== undefined ? ` (${input.qty >= 0 ? 'LONG' : 'SHORT'})` : ''}`,
    `Giá ${px(input.mark)} đã chạm dừng lỗ (${px(input.slPrice)}).`,
    input.sent ? 'Đã gửi lệnh đóng.' : 'Gửi lệnh đóng thất bại. Worker sẽ thử lại.',
  ].join('\n');
}

export function formatHybridRatchetNotice(input: {
  symbol: string;
  side?: 'LONG' | 'SHORT';
  tier: 'risk_reduction' | 'breakeven' | 'chandelier' | 'lock1' | 'lock2' | 'lock3' | 'lock';
  entryPrice: number;
  newSlPrice: number;
  maxReturnPct: number;
}): string {
  let tierTitle = '📐 CHANDELIER TRAIL (2,5x ATR)';
  if (input.tier === 'risk_reduction') {
    tierTitle = '🛡️ GIẢM RỦI RO (-4,0%)';
  } else if (input.tier === 'breakeven') {
    tierTitle = '🛡️ HÒA VỐN AN TOÀN';
  } else if (input.tier === 'lock1') {
    tierTitle = '🔒 KHÓA LÃI NẤC 1 (+3,5%)';
  } else if (input.tier === 'lock2') {
    tierTitle = '🔒 KHÓA LÃI NẤC 2 (+6,0%)';
  } else if (input.tier === 'lock3' || input.tier === 'lock') {
    tierTitle = '🔒 CHANDELIER KHÓA LÃI (>= +1,0%)';
  }
  const sideTag = input.side ? ` (${input.side})` : '';
  return [
    `🛡️ BẢO VỆ XU HƯỚNG: ${tierTitle} cho ${coin(input.symbol)}${sideTag}`,
    `• Giá vào: ${px(input.entryPrice)}`,
    `• Đỉnh lãi quan sát: +${input.maxReturnPct.toFixed(1)}%`,
    `• Dừng lỗ mới: ${px(input.newSlPrice)} (Đã cập nhật STOP_MARKET sàn Binance)`,
  ].join('\n');
}

export function formatHybridBreakerNotice(
  dayPnl: number,
  sent: boolean,
  limitUsd = 12.0,
  preservedLockedSymbols: string[] = []
): string {
  const lines = [
    '🚨 CẦU CHÌ NGÀY (-12%)',
    `Lãi/lỗ ngày ${usd(dayPnl, true)}, chạm trần ${usd(limitUsd)}.`,
    sent ? 'Đã gửi lệnh đóng các vị thế chưa khóa lãi.' : 'Gửi lệnh đóng thất bại. Worker sẽ thử lại.',
  ];
  if (preservedLockedSymbols.length > 0) {
    lines.push(`🔒 Miễn trừ giữ lại lệnh đang khóa lãi >= +1%: ${preservedLockedSymbols.map(coin).join(', ')}`);
  }
  return lines.join('\n');
}

export function formatHybridRebalanceNotice(input: {
  closed: string[];
  opened: Array<{ symbol: string; side?: 'LONG' | 'SHORT'; qty: number; entryPrice: number; slPrice?: number }>;
  nextRebalanceDate?: string;
  scanBucket?: string;
  regimeLabel?: string;
}): string {
  const lines = [`🔄 QUÉT BREAKOUT @4H — TURTLE20 DUAL L/S (${OFFICIAL_RELEASE_VERSION})`];
  if (input.regimeLabel) {
    lines.push(`• Chế độ BTC: ${input.regimeLabel}`);
  }
  if (input.closed.length) {
    lines.push(`• Đóng ngược pha chế độ: ${input.closed.map(coin).join(', ')}`);
  }
  if (input.opened.length) {
    for (const p of input.opened) {
      const action = p.side === 'SHORT' || p.qty < 0 ? 'BÁN SHORT' : 'MUA LONG';
      const slInfo = p.slPrice && p.slPrice > 0 ? ` | SL: ${px(p.slPrice)}` : '';
      lines.push(`• Mở mới: ${action} ${qtyText(p.qty)} ${coin(p.symbol)} @ ${px(p.entryPrice)}${slInfo}`);
    }
  } else if (!input.closed.length) {
    lines.push('• Giữ nguyên vị thế hiện tại.');
  }
  if (input.scanBucket) {
    lines.push(`• Khung quét: ${input.scanBucket} UTC (Chu kỳ 4h kế tiếp)`);
  } else if (input.nextRebalanceDate) {
    lines.push(`• Mốc kế tiếp: ${input.nextRebalanceDate}`);
  }
  return lines.join('\n');
}

export function formatHybridTpNotice(input: { symbol: string; qty: number; exitPrice: number; pnl: number }): string {
  return [
    `🎯 CHỐT LỜI ${coin(input.symbol)}`,
    `Đã đóng ${qtyText(input.qty)} ${coin(input.symbol)} @ ${px(input.exitPrice)}.`,
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
    `✂️ CẮT TỈA COIN CHÌM XUỒNG ${OFFICIAL_RELEASE_VERSION} (TIME-DECAY PRUNING)`,
    `• Đồng coin: ${coin(input.symbol)}`,
    `• Thời gian giữ: ${input.daysHeld} ngày (không vượt nổi +3%)`,
    `• Giá vào: ${px(input.entryPrice)} ➔ Giá thoát: ${px(input.exitPrice)}`,
    `• Cắt lỗ sớm: ${input.lossPct.toFixed(2)}% (Tiết kiệm ~8% so với mức SL -12%)`,
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

function formatRegimeSummary(regime?: HybridLiveState['momentumRegime']): string | null {
  if (!regime) return null;
  if (regime.turtleMode === 'bull_trend') {
    const btcInfo = regime.btcPrice && regime.btcEma50 ? `BTC ${px(regime.btcPrice)} > EMA50 ${px(regime.btcEma50)}` : `BTC 1d ${regime.btc1dReturnPct.toFixed(2)}%`;
    return `🟢 Bull Trend (Tối đa ${regime.longSlots ?? regime.maxSlots} Long | ${btcInfo}${regime.longBlocked ? ' — ⛔ Long Freeze -4%' : ''})`;
  }
  if (regime.turtleMode === 'bear_trend') {
    const btcInfo = regime.btcPrice && regime.btcEma50 ? `BTC ${px(regime.btcPrice)} < EMA50 ${px(regime.btcEma50)}` : `BTC 1d ${regime.btc1dReturnPct.toFixed(2)}%`;
    return `🔴 Bear Trend (Tối đa ${regime.shortSlots ?? regime.maxSlots} Short | ${btcInfo}${regime.shortBlocked ? ' — ⛔ Short Freeze +4%' : ''})`;
  }
  if (regime.turtleMode === 'neutral_cash') {
    return `🟡 Trung tính — Giữ Tiền Mặt (0 Long / 0 Short | BTC hồi chưa vượt EMA50)`;
  }
  if (regime.turtleMode === 'signal_unavailable' || regime.mode === 'crash_freeze') {
    return `🔴 Đóng băng an toàn (BTC 1d ${regime.btc1dReturnPct.toFixed(2)}%, 0 slot)`;
  }
  const btc14 = regime.btc14dReturnPct !== null ? `${regime.btc14dReturnPct.toFixed(2)}%` : 'N/A';
  if (regime.mode === 'macro_defensive') {
    return `🟡 Phòng thủ Macro (${regime.maxSlots} slot × ${(regime.targetAllocPct * 100).toFixed(0)}%, BTC 14d ${btc14})`;
  }
  return `🟢 Bình thường (${regime.maxSlots} slot × ${(regime.targetAllocPct * 100).toFixed(0)}%, BTC 14d ${btc14})`;
}

/** Formats response for interactive Telegram commands (/status, /report, /lenh, /pnl, /help) */
export function formatHybridCommandResponse(rawCmd: string, state: HybridLiveState | null): string {
  const cmd = rawCmd.trim().replace(/^\//, '').split(/\s+/)[0]?.toLowerCase() || '';

  if (!state) {
    return '⏳ Worker đang đồng bộ dữ liệu sàn, vui lòng thử lại sau vài giây.';
  }

  const positions = Object.values(state.positions || {});
  const totalUnrl = positions.reduce((acc, p) => acc + p.unrlPnl, 0);
  const dailyLimit = state.dynamicCompounding?.dailyLossLimitUsd ?? 12;
  const regimeLine = formatRegimeSummary(state.momentumRegime);

  switch (cmd) {
    case 'status':
    case 'trangthai':
    case 'tt': {
      const ageSec = state.lastObservedAt ? Math.round((Date.now() - Date.parse(state.lastObservedAt)) / 1000) : 999;
      const isStale = ageSec > 45;
      const statusText = state.breakerLatched
        ? '🚨 CẦU CHÌ ĐÃ KÍCH HOẠT'
        : isStale
        ? `⚠️ Worker phản hồi chậm (${ageSec}s trước)`
        : '✅ Đang giám sát (nhịp 3s, quét @4h)';

      const lines = [
        `🟢 WORKER TURTLE DUAL L/S ${OFFICIAL_RELEASE_VERSION} (O2+O3_R3.0%)`,
        `• Trạng thái: ${statusText}`,
        `• Vốn sàn (Equity): ${usd(state.accountEquity)}`,
        `• Khả dụng (Available): ${usd(state.availableBalance)}`,
        `• Lãi/lỗ hôm nay: ${usd(state.currentDayPnl, true)}`,
        `• Lãi/lỗ vị thế mở: ${usd(totalUnrl, true)}`,
        `• Cập nhật: ${formatTimeIct(state.lastObservedAt)}${isStale ? ` (${ageSec}s trước)` : ''}`,
        `• Cầu chì ngày: ${usd(dailyLimit)} ${state.breakerLatched ? '(ĐÃ CHẠM)' : '(An toàn · miễn trừ lệnh khóa >= +1%)'}`,
        `• Vị thế đang giữ: ${positions.length} lệnh (${positions.map((p) => `${p.qty < 0 ? 'SHORT ' : 'LONG '}${coin(p.symbol)}`).join(', ') || 'trống'})`,
      ];
      if (state.lastScanBucket4h) {
        lines.push(`• Phiên quét @4h gần nhất: ${state.lastScanBucket4h} UTC`);
      }
      if (regimeLine) {
        lines.push(`• Chế độ thị trường: ${regimeLine}`);
      }
      return lines.join('\n');
    }

    case 'report':
    case 'baocao':
    case 'lenh':
    case 'positions':
    case 'book': {
      const lines = [
        `📊 BÁO CÁO VỊ THẾ TURTLE DUAL L/S ${OFFICIAL_RELEASE_VERSION}`,
        `Vốn: ${usd(state.accountEquity)} | Lãi/lỗ ngày: ${usd(state.currentDayPnl, true)} | Chưa chốt: ${usd(totalUnrl, true)}`,
        `Cập nhật lúc: ${formatTimeIct(state.lastObservedAt)}`,
        ...(regimeLine ? [`Chế độ: ${regimeLine}`] : []),
        '',
        'Các lệnh đang giữ:',
      ];
      if (!positions.length) {
        lines.push('• Không có vị thế mở nào.');
      } else {
        for (const p of positions) {
          const stateStr = p.unrlPnl > 0 ? 'đang lãi' : p.unrlPnl < 0 ? 'đang lỗ' : 'hòa vốn';
          let tierNote = '🛑 SL khởi tạo (2.0x ATR):';
          if (p.ratchetTier === 'chandelier') tierNote = '📐 SL Chandelier (2.5x ATR):';
          else if (p.ratchetTier === 'risk_reduction') tierNote = '🛡️ SL Giảm rủi ro (-4%):';
          else if (p.ratchetTier === 'breakeven') tierNote = '🛡️ SL Hòa vốn Chandelier:';
          else if (p.ratchetTier === 'lock' || p.ratchetTier === 'lock1' || p.ratchetTier === 'lock2' || p.ratchetTier === 'lock3') {
            tierNote = '🔒 SL Khóa lãi (>= +1%):';
          }
          lines.push(`• ${sideLabel(p.qty)} ${qtyText(p.qty)} ${coin(p.symbol)}: ${stateStr} ${usd(p.unrlPnl, true)}`);
          lines.push(`   Giá vào: ${px(p.entryPrice)} | Hiện tại: ${px(p.markPrice)} | ${tierNote} ${px(p.slPrice)}`);
        }
      }
      lines.push('');
      lines.push(`• Bộ lọc: Donchian 20d + EMA20/EMA50 đồng pha + Vol >= 1.25x @4h`);
      lines.push(`• Cửa chặn BTC: Long freeze <= -4.0% · Short freeze >= +4.0% (24h)`);
      lines.push(`• Trần rủi ro: ${usd(dailyLimit)}/ngày (giữ nguyên lệnh đã khóa lãi >= +1%)`);
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
        `• Dư an toàn trần ${usd(dailyLimit)}: ${usd(Math.max(0, dailyLimit + state.currentDayPnl))}`,
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
        return `🌐 VŨ TRỤ GIAO DỊCH ${OFFICIAL_RELEASE_VERSION}:\n• Đang sử dụng 40 symbols mặc định.`;
      }
      return [
        `🌐 VŨ TRỤ GIAO DỊCH ĐỘNG ${OFFICIAL_RELEASE_VERSION}`,
        `• Số lượng lọc: Top ${du.count} Binance Futures (> $50M/ngày)`,
        `• Cập nhật lần cuối: ${formatTimeIct(du.lastScannedAt)}`,
        `• Top 10 thanh khoản: ${du.topSymbols.map(coin).join(', ')}`,
        '• Kết hợp lọc Vol >= 1.25x TB20 & ATR <= 16% để loại phá đỉnh giả.',
      ].join('\n');
    }

    case 'shield':
    case 'lachang': {
      const es = state.eventShield;
      const scanLine = es?.lastScannedAt ? `• Quét tự động gần nhất: ${formatTimeIct(es.lastScannedAt)}` : null;
      if (!es || es.blacklistCount === 0) {
        return [
          `🛡️ EVENT SHIELD ${OFFICIAL_RELEASE_VERSION} (LÁ CHẮN THIÊN NGA ĐEN)`,
          '• Trạng thái: ✅ Đang trực chiến (Auto Exchange + RSS)',
          ...(scanLine ? [scanLine] : []),
          '• Danh sách Blacklist: 0 coin',
          '• Không phát hiện tin tức Delist hoặc Exploit nguy hiểm.',
        ].join('\n');
      }
      return [
        `🛡️ EVENT SHIELD ${OFFICIAL_RELEASE_VERSION} (LÁ CHẮN THIÊN NGA ĐEN)`,
        ...(scanLine ? [scanLine] : []),
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
        return `📈 LÃI KÉP ĐỘNG — RISK PARITY ${OFFICIAL_RELEASE_VERSION}:\n• Risk 3.0% Long (3 slot) / 2.5% Short (2 slot), trần tổng 1.05x.`;
      }
      return [
        `📈 LÃI KÉP ĐỘNG — DYNAMIC COMPOUNDING ${OFFICIAL_RELEASE_VERSION}`,
        `• Vốn tài khoản hiện hành: ${usd(state.accountEquity)}`,
        `• Phân bổ Momentum / Slot cap: ${usd(dc.momentumAllocUsd)} (${(dc.targetMomentumPct * 100).toFixed(0)}% vốn max/lệnh)`,
        `• Risk Parity: 3.0% Equity/Long (tối đa 3 lệnh) · 2.5% Equity/Short (tối đa 2 lệnh)`,
        `• Phân bổ BTC Grid (dự phòng): ${usd(dc.btcGridTicketUsd)} (${(dc.targetGridTicketPct * 100).toFixed(0)}% vốn · tắt dưới minNotional)`,
        `• Trần rủi ro ngày: ${usd(dc.dailyLossLimitUsd)} (12% day-start equity, sàn 12.0u)`,
        ...(regimeLine ? [`• Chế độ hiện hành: ${regimeLine}`] : []),
        '• Trần đòn bẩy tổng 1.05x, tự động cắt giảm size theo biến động ATR.',
      ].join('\n');
    }

    case 'grid':
    case 'luoi': {
      const vg = state.volatilityGrid;
      if (!vg) {
        return `⚡ BIẾN ĐỘNG BTC & CHANDELIER ${OFFICIAL_RELEASE_VERSION}:\n• Sleeve BTC Grid đang tắt ở vốn nhỏ (minNotional $50).`;
      }
      return [
        `⚡ LƯỚI BIẾN ĐỘNG BTC ${OFFICIAL_RELEASE_VERSION} (THEO DÕI ATR-14 BTC)`,
        `• ATR 14 ngày hiện tại: $${vg.atr14.toFixed(0)} (${vg.atr14Pct.toFixed(2)}% giá BTC)`,
        `• Hệ số biến động (Vol Multiplier): ${vg.volMultiplier.toFixed(2)}x (${vg.regime === 'high_volatility' ? 'Biến động mạnh' : vg.regime === 'low_volatility' ? 'Thị trường yên ắng' : 'Biến động bình thường'})`,
        `• Bước lưới co giãn: ${(vg.gridStepPct * 100).toFixed(2)}% mỗi tầng`,
        `• Chốt lời kỳ vọng: +${(vg.gridTpPct * 100).toFixed(2)}%`,
        `• Cửa chặn sập (Crash Gate): -${(vg.crashGatePct * 100).toFixed(2)}%`,
        `• Các tầng đang giữ: ${state.btcGridLevels?.length || 0}/3 tầng (BTC Grid tắt mặc định trên v2.0.0 để tập trung 100% vốn cho Turtle Dual L/S)`,
      ].join('\n');
    }

    case 'help':
    case 'trogiup':
    case 'start':
    default: {
      return [
        `🤖 CÁC LỆNH THEO DÕI BOT TURTLE DUAL L/S ${OFFICIAL_RELEASE_VERSION}:`,
        '• /agy <câu hỏi> — Chat với Antigravity AI trực tiếp trên máy chủ',
        '• /agy list · /agy resume <số> — Xem & chọn hội thoại tiếp tục',
        '• /agy models · /agy model <tên|số> · /agy effort <mức> — Đổi model/effort',
        '• /agy new · /agy status · /agy cancel — Quản lý phiên agy',
        '• /status — Trạng thái worker, pha BTC EMA50 & vị thế Long/Short',
        '• /report (hoặc /lenh) — Chi tiết các vị thế đang mở & giá Chandelier SL',
        '• /pnl — Lãi/lỗ hôm nay & lãi/lỗ chưa chốt (Phân lập tiền nạp)',
        '• /cashflow (hoặc /dongtien) — Quản lý dòng tiền nạp/rút & vốn cơ sở',
        '• /compounding (hoặc /lai) — Quy mô phân bổ vốn Risk Parity lãi kép',
        '• /grid (hoặc /luoi) — Thông số biến động ATR-14 của BTC',
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

export const HYBRID_KNOWN_COMMANDS = new Set([
  'status', 'trangthai', 'tt',
  'report', 'baocao', 'lenh', 'positions', 'book',
  'pnl', 'cashflow', 'dongtien',
  'lai', 'laikep', 'compounding',
  'grid', 'luoi',
  'universe', 'vutru',
  'shield', 'lachang',
  'help', 'trogiup', 'start',
]);

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

          if (telegramConfig.chatIds.length && !telegramConfig.chatIds.includes(chatId)) {
            continue;
          }

          const rawText = msg.text?.trim() || '';
          const rawCaption = msg.caption?.trim() || '';
          const photos = msg.photo;

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

          if (rawText.startsWith('/agy')) {
            void handleHybridAgyCommand(chatId, rawText, send);
            continue;
          }

          const cmd = rawText.replace(/^\//, '').split(/\s+/)[0]?.toLowerCase() || '';

          if (HYBRID_KNOWN_COMMANDS.has(cmd)) {
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
      } catch {
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
