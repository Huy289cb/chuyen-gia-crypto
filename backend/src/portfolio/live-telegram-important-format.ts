import { Decimal } from '@prisma/client/runtime/library';
import type { LiveDay, LivePortfolioWallet } from './live-service';
import { explainLiveTelegramReason, type LiveTradeMessageContext } from './live-telegram-format';

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
const ICT_MS = 7 * 3_600_000;
type Row = Record<string, unknown>;

const amount = (value: unknown): Decimal => {
  if (!Decimal.isDecimal(value) && typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('Missing important Telegram financial observation');
  }
  const parsed = new Money(String(value));
  if (!parsed.isFinite()) throw new Error('Invalid important Telegram financial observation');
  return parsed;
};
/** Round for reading only. All fee allocation above this boundary stays Decimal40. */
const usd = (value: unknown, signed = false): string => {
  const parsed = amount(value), absolute = parsed.abs();
  const sign = parsed.lt(0) ? '-' : signed && parsed.gt(0) ? '+' : '';
  if (absolute.gt(0) && absolute.lt('0.005')) return `${sign}<0,01 USDT`;
  return `${sign}${absolute.toFixed(2, Decimal.ROUND_HALF_UP).replace('.', ',')} USDT`;
};
const quantity = (value: unknown): string => amount(value).toFixed().replace('.', ',');
const coinOf = (symbol: unknown): string => {
  if (typeof symbol !== 'string' || !/^[A-Z0-9]{2,30}USDT$/.test(symbol)) {
    throw new Error('Invalid authenticated Telegram trade symbol');
  }
  return symbol.slice(0, -4);
};
const timeOf = (value: unknown): string => {
  const time = Number(value);
  if (!Number.isSafeInteger(time) || time < 0) throw new Error('Missing important Telegram observation time');
  return `${new Date(time + ICT_MS).toISOString().replace('T', ' ').slice(0, 16)} (giờ Việt Nam)`;
};
const finish = (lines: (string | undefined)[]): string => lines.filter((line): line is string => line !== undefined).join('\n');
const pendingWarning = (wallet: LivePortfolioWallet): string | undefined => wallet.equityQuality === 'conservative_pending_income'
  ? '⚠ Lãi/lỗ tạm tính: sàn chưa xác nhận đủ số dư và phí.' : undefined;

const openPositionWarning = 'Lãi/lỗ lệnh mở theo giá, chưa tính phí giao dịch và phí giữ lệnh.';
const awaitingPosition = (wallet: LivePortfolioWallet, symbol: string): boolean => wallet.intents.some(intent => {
  if (intent.symbol !== symbol) return false;
  if (intent.status === 'UNKNOWN' || intent.submittedOnce
    && !['FILLED', 'CANCELED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'EXPIRED_IN_MATCH'].includes(intent.status)) return true;
  try { return !amount(intent.executedQty).eq(amount(intent.observedFillQty)); } catch { return true; }
});
/** This is the wallet observation, not a fill-time profit or a promise about the closing price. */
const positionSnapshot = (wallet: LivePortfolioWallet, symbol: string): string | undefined => {
  if (awaitingPosition(wallet, symbol)) return `Lệnh ${coinOf(symbol)} đang chờ đối soát với sàn; chưa xác định đủ lãi/lỗ hiện tại.`;
  const position = wallet.positions[symbol];
  if (!position) return undefined;
  const qty = amount(position.quantity);
  if (qty.isZero()) return undefined;
  const label = `${qty.gt(0) ? 'MUA' : 'BÁN'} ${quantity(qty.abs())} ${coinOf(symbol)}`;
  const marks = wallet.lastObservation.marks;
  const mark = marks && typeof marks === 'object' ? (marks as Row)[symbol] : undefined;
  try {
    const entry = amount(position.averageEntry), current = amount(mark);
    if (entry.lte(0) || current.lte(0)) return `${label}: chờ giá hoặc số liệu để tính lãi/lỗ.`;
    const pnl = current.minus(entry).mul(qty);
    const state = pnl.gt(0) ? 'đang lãi' : pnl.lt(0) ? 'đang lỗ' : 'đang hòa vốn';
    return `${label}: ${state} ${usd(pnl, true)}.`;
  } catch {
    return `${label}: chờ giá hoặc số liệu để tính lãi/lỗ.`;
  }
};
const openPositionSnapshot = (wallet: LivePortfolioWallet): string[] => {
  const symbols = [...new Set([...Object.keys(wallet.positions),
    ...wallet.intents.filter(intent => awaitingPosition(wallet, intent.symbol)).map(intent => intent.symbol)])];
  const positions = symbols.sort()
    .map(symbol => positionSnapshot(wallet, symbol)).filter((line): line is string => line !== undefined);
  return positions.length ? [...positions, openPositionWarning] : [];
};
const tradePositionSnapshot = (wallet: LivePortfolioWallet, symbol: string, tradeTime: unknown): string[] => {
  if (wallet.lastObservedAtMs < Number(tradeTime)) {
    return [`Hiện tại: chờ cập nhật lệnh ${coinOf(symbol)} sau giao dịch.`];
  }
  const position = positionSnapshot(wallet, symbol);
  return position ? [`Lệnh ở lần cập nhật ${timeOf(wallet.lastObservedAtMs)}: ${position}`, openPositionWarning]
    : [`Ở lần cập nhật ${timeOf(wallet.lastObservedAtMs)}: không còn giữ ${coinOf(symbol)}.`];
};

/** Uses confirmed fills and actual allocated opening/closing fees; never an order acknowledgement. */
export function formatImportantTradeMessage(wallet: LivePortfolioWallet, trade: Row, context: LiveTradeMessageContext): string {
  const before = amount(context.positionBefore), after = amount(context.positionAfter);
  const qty = amount(trade.qty), price = amount(trade.price), fee = amount(trade.commission);
  const gross = amount(trade.realizedPnl), openingFees = amount(context.openingFeesBefore);
  if (qty.lte(0) || price.lte(0) || fee.lt(0) || openingFees.lt(0)
    || trade.commissionAsset !== 'USDT' || !['BUY', 'SELL'].includes(String(trade.side))) {
    throw new Error('Unsupported authenticated important Telegram trade');
  }
  const buying = trade.side === 'BUY';
  if (!before.plus(qty.mul(buying ? 1 : -1)).eq(after)) {
    throw new Error('Inconsistent authenticated important Telegram position history');
  }
  const reversing = !before.isZero() && !after.isZero() && before.isPositive() !== after.isPositive();
  const reducing = !before.isZero() && (after.abs().lt(before.abs()) || reversing);
  const closedQty = reducing ? Money.min(before.abs(), qty) : amount('0');
  const allocatedOpeningFee = closedQty.isZero() ? amount('0') : openingFees.mul(closedQty).div(before.abs());
  const closingFee = fee.mul(closedQty).div(qty), closedNet = gross.minus(allocatedOpeningFee).minus(closingFee);
  const coin = coinOf(trade.symbol);
  const beforeDirection = before.gt(0) ? 'MUA' : 'BÁN';
  const action = before.isZero() ? `MỞ LỆNH ${coin} — ${buying ? 'MUA' : 'BÁN'}`
    : after.isZero() ? `ĐÓNG LỆNH ${coin} — ${beforeDirection}`
      : reversing ? `ĐÓNG LỆNH ${coin} — ${beforeDirection} VÀ MỞ ${buying ? 'MUA' : 'BÁN'}`
        : reducing ? `ĐÓNG MỘT PHẦN LỆNH ${coin} — ${beforeDirection}` : `${buying ? 'MUA' : 'BÁN'} THÊM ${coin}`;
  return finish([
    `✅ ${action}`,
    `Giá trị ${reducing ? reversing ? 'giao dịch' : 'đã đóng' : 'lệnh'}: ${usd(qty.mul(price))}.`,
    reducing ? `Lãi/lỗ phần đã đóng: ${usd(closedNet, true)} (đã trừ phí mở và đóng).`
      : `Phí mở lệnh: ${usd(fee)}. Chưa chốt lãi/lỗ.`,
    reversing ? `Mở ${buying ? 'MUA' : 'BÁN'} ${quantity(after.abs())} ${coin}. Phí giữ lệnh tính ở báo cáo ngày.`
      : reducing ? `${after.isZero() ? '' : `Còn giữ ${quantity(after.abs())} ${coin}. `}Phí giữ lệnh tính ở báo cáo ngày.`
        : `Lãi khi giá ${buying ? 'tăng' : 'giảm'}, lỗ khi giá ${buying ? 'giảm' : 'tăng'}.`,
    `Giao dịch lúc: ${timeOf(trade.time)}.`,
    ...tradePositionSnapshot(wallet, String(trade.symbol), trade.time),
    pendingWarning(wallet),
  ]);
}

export function formatImportantDailyReport(wallet: LivePortfolioWallet, day: LiveDay): string {
  const openCount = Object.values(wallet.positions).filter(position => !amount(position.quantity).isZero()).length;
  return finish([
    `📊 KẾT QUẢ NGÀY ${day.day}`,
    `Lãi/lỗ: ${usd(day.netPnl, true)} (đã tính phí; gồm lệnh chưa đóng).`,
    `Tổng vốn hiện tại: ${usd(wallet.equity)} | Đang có ${openCount} lệnh mở.`,
    ...openPositionSnapshot(wallet),
    `Từ khi chạy: ${usd(wallet.netPnl, true)}.`,
    `Cập nhật: ${timeOf(wallet.lastObservedAtMs)}.`,
    day.anchorQuality === 'missing_boundary' ? '⚠ Lãi/lỗ ngày là xấp xỉ vì thiếu số liệu lúc bắt đầu ngày.' : undefined,
    day.anchorQuality === 'initial_partial' ? `Ngày đầu chỉ tính từ ${timeOf(day.anchorTimeMs)}, chưa đủ 24 giờ.` : undefined,
    pendingWarning(wallet),
    amount(day.breachUsd).gt(0) ? `🚨 Mức lỗ đã vượt giới hạn ngày ${usd(day.breachUsd)}.` : undefined,
  ]);
}

export function formatImportantRiskMessage(wallet: LivePortfolioWallet, reason: string): string {
  const stopped = wallet.currentDay.riskLatched || !['active', 'flat'].includes(wallet.status);
  return finish([
    stopped ? '⚠ BOT TẠM DỪNG MỞ LỆNH MỚI' : '⚠ CẢNH BÁO BẢO VỆ TÀI KHOẢN',
    explainLiveTelegramReason(reason),
    `Lãi/lỗ ngày: ${usd(wallet.currentDay.netPnl, true)} (gồm lệnh chưa đóng).`,
    `Giới hạn lỗ: ${usd(wallet.config.dailyLossLimitUsd)}/ngày.${amount(wallet.currentDay.breachUsd).gt(0)
      ? ` Đã vượt ${usd(wallet.currentDay.breachUsd)}.` : ''}`,
    ...openPositionSnapshot(wallet),
    Object.values(wallet.positions).some(position => !amount(position.quantity).isZero())
      ? `Số liệu lúc: ${timeOf(wallet.lastObservedAtMs)}.` : undefined,
    'Chỉ coi lệnh đã đóng khi nhận tin ĐÓNG LỆNH.',
  ]);
}

export function formatImportantErrorMessage(reason: string, wallet?: LivePortfolioWallet, technicalDelay = false): string {
  const needsManual = /unowned|external.*(?:position|order|trade)|(?:position|order).*mismatch|(?:mode|leverage|collateral|margin configuration).*mismatch|missing.*(?:anchor|boundary)|(?:anchor|boundary).*missing/i.test(reason);
  return finish([
    technicalDelay ? '⚠ DỮ LIỆU TỪ SÀN CHƯA ỔN ĐỊNH' : '🚨 BOT ĐANG GẶP SỰ CỐ',
    technicalDelay ? 'Một số dữ liệu từ sàn đang chậm hoặc chưa lấy được; bot đang kiểm tra lại.' : explainLiveTelegramReason(reason),
    needsManual ? 'Cần kiểm tra trực tiếp trên sàn trước khi giao dịch tiếp.'
      : 'Bot đang tự kiểm tra lại với sàn.',
    wallet ? `Lãi/lỗ ngày ở lần cập nhật cuối: ${usd(wallet.currentDay.netPnl, true)} (gồm lệnh chưa đóng).` : undefined,
    ...(wallet ? openPositionSnapshot(wallet) : []),
    wallet ? `Số liệu lúc: ${timeOf(wallet.lastObservedAtMs)}.` : 'Chưa có số liệu tài khoản được xác nhận.',
  ]);
}

export function formatImportantRecoveryMessage(wallet?: LivePortfolioWallet): string {
  return finish([
    '✅ BOT ĐÃ HOẠT ĐỘNG LẠI',
    wallet ? 'Đã kiểm tra số dư và các lệnh với sàn.' : 'Sẽ báo khi có lệnh mở hoặc đóng được xác nhận.',
    wallet ? `Giới hạn lỗ vẫn là ${usd(wallet.config.dailyLossLimitUsd)}/ngày.` : undefined,
    ...(wallet ? openPositionSnapshot(wallet) : []),
    wallet && Object.values(wallet.positions).some(position => !amount(position.quantity).isZero())
      ? `Số liệu lúc: ${timeOf(wallet.lastObservedAtMs)}.` : undefined,
  ]);
}
