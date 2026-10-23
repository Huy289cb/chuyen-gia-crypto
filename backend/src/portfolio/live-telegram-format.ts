import { Decimal } from '@prisma/client/runtime/library';
import type { LiveDay, LivePortfolioWallet } from './live-service';

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
const ICT_MS = 7 * 3_600_000;
type Row = Record<string, unknown>;

export interface LiveTradeMessageContext {
  positionBefore: string;
  positionAfter: string;
  /** Unallocated, authenticated opening commissions for the position before this fill. */
  openingFeesBefore: string;
}

const amount = (value: unknown): Decimal => {
  if (Decimal.isDecimal(value)) return new Money(value.toString());
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Missing Telegram financial observation');
  const parsed = new Money(value);
  if (!parsed.isFinite()) throw new Error('Invalid Telegram financial observation');
  return parsed;
};
const display = (value: unknown, signed = false): string => {
  const parsed = amount(value);
  const formatted = parsed.toFixed(10).replace(/\.?0+$/, '') || '0';
  return `${signed && parsed.gt(0) ? '+' : ''}${formatted === '-0' ? '0' : formatted}`;
};
const usd = (value: unknown, signed = false): string => `${display(value, signed)} USDT`;
const dayOf = (time: number): string => new Date(time + ICT_MS).toISOString().slice(0, 10);
const coinOf = (symbol: unknown): string => String(symbol).replace(/USDT$/, '');
const timeOf = (value: unknown): string => {
  const time = Number(value);
  return Number.isSafeInteger(time) && time >= 0
    ? `${new Date(time + ICT_MS).toISOString().replace('T', ' ').slice(0, 19)} (giờ Việt Nam)`
    : 'chưa có mốc xác nhận';
};

/** Keep error text useful without forwarding signed URLs, bot tokens or credential values. */
export function sanitizeLiveTelegramReason(reason: string): string {
  return String(reason)
    .replace(/https?:\/\/[^\s<>"']+/gi, '[đã ẩn URL]')
    .replace(/\b\d{5,}:[A-Za-z0-9_-]{15,}\b/g, '[đã ẩn token]')
    .replace(/((?:x-mbx-apikey|api[_-]?key|api[_-]?secret|access[_-]?token|bot[_-]?token|token|signature|password|secret)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi, '$1[đã ẩn]')
    .replace(/(authorization\s*[=:]\s*)(?:bearer\s+)?[^\s,;&}]+/gi, '$1[đã ẩn]')
    .replace(/\b[a-f\d]{64,}\b/gi, '[đã ẩn mã]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 500) || 'Chưa xác định được nguyên nhân; cần kiểm tra lại hệ thống.';
}
/** The notification explains the consequence; diagnostic identifiers stay in the local logs. */
export function explainLiveTelegramReason(reason: string): string {
  const safe = sanitizeLiveTelegramReason(reason);
  if (/live_monitoring_gap|monitoring.*gap/i.test(safe)) return 'Hệ thống bị gián đoạn theo dõi giá quá lâu nên đã kích hoạt bảo vệ tài khoản.';
  if (/daily.*(?:loss|budget)|fixed_daily_loss|loss budget|close_reserve/i.test(safe)) return 'Mức lỗ đã đến ngưỡng bảo vệ trong ngày; hệ thống cần đóng lệnh sớm để dành tiền cho phí và biến động giá.';
  if (/missing.*(?:anchor|boundary)|(?:anchor|boundary).*missing/i.test(safe)) return 'Thiếu số liệu đầu ngày để kiểm tra mức lỗ; cần đối chiếu lại trước khi giao dịch tiếp.';
  if (/stale venue quote|stale.*(?:price|quote)|(?:price|quote).*stale/i.test(safe)) return 'Giá từ sàn cập nhật chậm; hệ thống cần giá mới trước khi mở thêm lệnh.';
  if (/source preparation|source.*(?:failed|unavailable)|daily.*source/i.test(safe)) return 'Chưa lấy được dữ liệu để chọn lệnh cho hôm nay; hệ thống đang chờ kiểm tra lại.';
  if (/unresolved_or_partial_order|ambiguous_order_submission|unresolved.*order|order.*(?:unknown|unconfirmed)/i.test(safe)) return 'Chưa xác nhận đủ kết quả mua/bán từ sàn; có thể lệnh mới thực hiện được một phần. Cần kiểm tra lại trước khi mở thêm lệnh.';
  if (/unowned|external.*(?:position|order|trade)|(?:position|order).*mismatch/i.test(safe)) return 'Tài khoản có lệnh hoặc cài đặt không khớp dữ liệu của bot; cần kiểm tra trực tiếp trên sàn.';
  if (/mode|leverage|collateral|margin configuration/i.test(safe)) return 'Cài đặt giao dịch trên sàn đã thay đổi hoặc không phù hợp; cần kiểm tra trước khi mở thêm lệnh.';
  if (/history|income|cash|wallet.*mismatch|background support|reconciliation_required/i.test(safe)) return 'Số dư, phí hoặc lịch sử giao dịch chưa được xác nhận đầy đủ; hệ thống cần kiểm tra lại với sàn.';
  if (/timeout|timed out|network|connect|fetch|request failed|http|econn|socket/i.test(safe)
    || /^Binance portfolio GET \/fapi\/v3\/account failed \(request_failed\)\.$/.test(safe)) return 'Kết nối với sàn đang gặp lỗi; cần xác nhận lại giá và kết quả giao dịch.';
  // Existing plain Vietnamese explanations may be kept, but never forward
  // arbitrary English exception bodies or credential-bearing diagnostics.
  if (/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(safe.replace(/\[[^\]]*\]/g, ''))
    && !/\b(?:ACK|FILLED|intent|policy|token|signature|api[_-]?key|Error|Exception|undefined|null)\b|[a-z]+_[a-z]+/i.test(safe)) return safe;
  return 'Hệ thống chưa hoàn tất một bước kiểm tra; cần đối chiếu lại số liệu với sàn.';
}
const finish = (lines: (string | undefined)[]): string => lines.filter((line): line is string => line !== undefined).join('\n').slice(0, 3400);
const pendingWarning = (wallet: LivePortfolioWallet): string | undefined => wallet.equityQuality === 'conservative_pending_income'
  ? `⚠ Sàn chưa xác nhận đủ tiền nhận/phí. Số tiền còn chờ kiểm tra: ${usd(wallet.unreconciledWalletDelta, true)}; kết quả hiện tại được tính thận trọng.`
  : undefined;
const anchorWarning = (day: LiveDay): string | undefined => {
  if (day.anchorQuality === 'initial_partial') return `⚠ Ngày đầu chỉ tính từ ${timeOf(day.anchorTimeMs)}, chưa đủ 24 giờ.`;
  if (day.anchorQuality === 'missing_boundary') return '⚠ Thiếu số liệu đúng lúc bắt đầu ngày; lãi/lỗ ngày chỉ là xấp xỉ vì có lúc gián đoạn theo dõi.';
  if (day.anchorQuality === 'near_boundary') return `Số liệu đầu ngày lấy lúc ${timeOf(day.anchorTimeMs)}; kết quả có sai lệch thời điểm nhỏ.`;
  return undefined;
};
const walletLines = (wallet: LivePortfolioWallet): (string | undefined)[] => [
  `Tổng giá trị vốn bot: ${usd(wallet.equity)} (gồm lãi/lỗ các lệnh chưa đóng).`,
  `Lãi/lỗ ngày ${wallet.currentDay.day}: ${usd(wallet.currentDay.netPnl, true)} | Từ khi chạy: ${usd(wallet.netPnl, true)}.`,
  `Số liệu tài khoản lúc: ${timeOf(wallet.lastObservedAtMs)}.`,
  pendingWarning(wallet),
];
const dPositive = (value: unknown): boolean => amount(value).gt(0);
const statusText = (wallet: LivePortfolioWallet): string => ({
  active: 'đang theo dõi các lệnh đã mở', flat: 'đang chờ cơ hội vào lệnh',
  risk_latched: 'đã dừng mở lệnh mới để bảo vệ tài khoản',
  reconciliation_required: 'đang kiểm tra lại số liệu với sàn, tạm chặn lệnh mới',
})[wallet.status];

export function formatLivePendingMessage(wallet: LivePortfolioWallet, symbol: string): string {
  return finish([
    `⏳ ĐANG KIỂM TRA KẾT QUẢ MUA/BÁN ${coinOf(symbol)}`,
    'Sàn đã phản hồi lệnh; đang chờ xác nhận đủ số lượng thực hiện, phí và số dư.',
    `Số tiền còn chờ kiểm tra: ${usd(wallet.unreconciledWalletDelta, true)}.`,
    'Tạm chặn lệnh mới. Nếu quá 30 giây từ lúc tạo lệnh vẫn chưa đủ số liệu, bot sẽ báo sự cố.',
    'Sẽ báo riêng đã mở/đóng lệnh và lãi/lỗ sau khi xác nhận với sàn.',
  ]);
}

export function formatLiveTradeMessage(wallet: LivePortfolioWallet, trade: Row, context: LiveTradeMessageContext): string {
  const before = amount(context.positionBefore), after = amount(context.positionAfter);
  const quantity = amount(trade.qty), price = amount(trade.price), fee = amount(trade.commission), gross = amount(trade.realizedPnl);
  if (quantity.lte(0) || price.lte(0) || fee.lt(0) || trade.commissionAsset !== 'USDT' || !['BUY', 'SELL'].includes(String(trade.side))) {
    throw new Error('Unsupported authenticated Telegram trade');
  }
  const directionChanged = !before.isZero() && !after.isZero() && before.isPositive() !== after.isPositive();
  const reducing = !before.isZero() && (after.abs().lt(before.abs()) || directionChanged);
  const closedQuantity = reducing ? Money.min(before.abs(), quantity) : amount('0');
  const openingFees = amount(context.openingFeesBefore);
  if (openingFees.lt(0)) throw new Error('Negative authenticated opening fees');
  const allocatedFees = closedQuantity.isZero() ? amount('0') : openingFees.mul(closedQuantity).div(before.abs());
  const closingFee = fee.mul(closedQuantity).div(quantity);
  const newOpeningFee = fee.minus(closingFee), closedNet = gross.minus(closingFee).minus(allocatedFees);
  const coin = coinOf(trade.symbol), buying = trade.side === 'BUY';
  const action = before.isZero() ? `MỞ LỆNH ${coin} — ${buying ? 'MUA' : 'BÁN'}` : after.isZero() ? `ĐÓNG LỆNH ${coin}`
    : directionChanged ? `ĐÓNG LỆNH ${coin} VÀ MỞ CHIỀU NGƯỢC`
      : reducing ? `ĐÓNG MỘT PHẦN LỆNH ${coin}` : `${buying ? 'MUA' : 'BÁN'} THÊM ${coin}`;
  return finish([
    `✅ ${action}`,
    `Đã ${buying ? 'mua' : 'bán'}: ${display(quantity)} ${coin} | Giá: ${usd(price)}/${coin}.`,
    `Giá trị mua/bán: ${usd(quantity.mul(price))}. ${reducing ? `Phí tính cho phần đóng: ${usd(allocatedFees.plus(closingFee))}.` : `Phí mua/bán vừa trả: ${usd(fee)}.`}`,
    reducing ? `Lãi/lỗ phần đã đóng: ${usd(closedNet, true)} (đã trừ phí mở và đóng).`
      : `Phần vừa mở chưa có lãi/lỗ đã chốt; lời khi giá ${buying ? 'tăng' : 'giảm'}, lỗ khi giá ${buying ? 'giảm' : 'tăng'}.`,
    directionChanged ? `Đã đóng ${display(closedQuantity)} ${coin}; mở lệnh ${buying ? 'mua' : 'bán'} ${display(after.abs())} ${coin}, phí mở mới ${usd(newOpeningFee)}.` : undefined,
    reducing && !after.isZero() && !directionChanged ? `Còn giữ: ${display(after.abs())} ${coin}.` : undefined,
    reducing ? 'Phí/tiền nhận khi giữ lệnh được tính trong báo cáo toàn tài khoản, chưa chia riêng cho lệnh này.' : undefined,
    `Thời gian mua/bán: ${timeOf(trade.time)}.`,
    pendingWarning(wallet),
  ]);
}

export function formatLiveDailyReport(wallet: LivePortfolioWallet, day: LiveDay, final: boolean): string {
  const belongs = (row: Row): boolean => {
    const time = Number(row.time);
    return Number.isSafeInteger(time) && time >= 0 && dayOf(time) === day.day;
  };
  const trades = wallet.trades.filter(belongs), incomes = wallet.incomes.filter(belongs);
  const sum = (items: Row[], key: string): Decimal => items.reduce((total, item) => total.plus(amount(item[key])), amount('0'));
  const fees = sum(trades, 'commission'), realized = sum(trades, 'realizedPnl');
  const funding = sum(incomes.filter(income => income.incomeType === 'FUNDING_FEE'), 'income');
  const transfers = incomes.filter(income => ['TRANSFER', 'INTERNAL_TRANSFER'].includes(String(income.incomeType)));
  return finish([
    `📊 KẾT QUẢ ${final ? 'NGÀY ĐÃ QUA' : 'HÔM NAY'} — ${day.day} (giờ Việt Nam)`,
    `Lãi/lỗ của ngày: ${usd(day.netPnl, true)} (gồm các lệnh chưa đóng; ${final ? 'theo số nạp/rút đã biết lúc ghi nhận' : 'đã loại số nạp/rút được xác nhận'}).`,
    `Lãi/lỗ đã ghi vào số dư: ${usd(realized.minus(fees).plus(funding), true)}.`,
    `Trong đó: đóng lệnh ${usd(realized, true)}, phí mua/bán ${usd(fees)}, phí/tiền nhận khi giữ lệnh ${usd(funding, true)}.`,
    `Số lần mua/bán được sàn xác nhận: ${trades.length}.`,
    `Lãi/lỗ thấp nhất ghi nhận trong ngày: ${usd(day.worstNetPnl, true)}.`,
    `Giới hạn lỗ: ${usd(wallet.config.dailyLossLimitUsd)}/ngày | ${day.riskLatched ? 'Đã dừng mở lệnh mới.' : 'Chưa bị dừng vì giới hạn ngày.'}`,
    dPositive(day.breachUsd) ? `🚨 Mức lỗ đã vượt giới hạn: ${usd(day.breachUsd)}.` : undefined,
    day.latchReason ? `Lý do dừng: ${explainLiveTelegramReason(day.latchReason)}` : undefined,
    final ? '⚠ Kết quả ngày đã qua là xấp xỉ theo lần kiểm tra cuối đã lưu; chưa có số liệu chính xác đúng lúc kết thúc ngày.' : undefined,
    final ? 'Số nạp/rút được sàn báo muộn có thể chưa được sửa vào kết quả đã lưu; cần kiểm tra bổ sung trước khi chốt lợi nhuận ngày.' : undefined,
    final && transfers.length > 0 ? `Có ${transfers.length} lần nạp/rút ngày này, tổng ${usd(sum(transfers, 'income'), true)}; kết quả đã lưu có thể chưa cập nhật hết.` : undefined,
    anchorWarning(day),
    `Tổng giá trị vốn bot hiện tại: ${usd(wallet.equity)} (gồm lãi/lỗ lệnh chưa đóng).`,
    `Lãi/lỗ từ khi chạy: ${usd(wallet.netPnl, true)}.`,
    `Số liệu hiện tại lúc: ${timeOf(wallet.lastObservedAtMs)}${final ? '; không phải số dư cuối ngày đã qua' : ''}.`,
    pendingWarning(wallet),
    'Theo giao dịch thật; kết quả có thể cập nhật nếu sàn báo phí/tiền nhận muộn.',
  ]);
}

export function formatLiveStatusMessage(wallet: LivePortfolioWallet, announceConnection = true): string {
  const positions = Object.entries(wallet.positions).filter(([, position]) => !amount(position.quantity).isZero());
  return finish([
    announceConnection ? '🟢 TELEGRAM ĐÃ KẾT NỐI BOT GIAO DỊCH' : 'Thông tin tài khoản:',
    `Vốn ban đầu: ${usd(wallet.config.initialCash)} | Giới hạn lỗ: ${usd(wallet.config.dailyLossLimitUsd)}/ngày.`,
    `Trạng thái: ${statusText(wallet)}.`,
    `Đang có ${positions.length} lệnh mở${positions.length ? `: ${positions.map(([symbol]) => coinOf(symbol)).join(', ')}` : ''}.`,
    ...walletLines(wallet),
    wallet.blockedReason ? `Cần kiểm tra: ${explainLiveTelegramReason(wallet.blockedReason)}` : undefined,
    announceConnection ? 'Sẽ báo khi mở/đóng lệnh, lãi/lỗ, sự cố và kết quả mỗi ngày.' : undefined,
    announceConnection ? 'Đây là tin kết nối, chưa phát sinh giao dịch vì tin này.' : undefined,
  ]);
}

export function formatLiveRiskMessage(wallet: LivePortfolioWallet, reason: string): string {
  return finish([
    '⚠ BOT ĐÃ KÍCH HOẠT BẢO VỆ TÀI KHOẢN',
    `Lý do: ${explainLiveTelegramReason(reason)}`,
    `Trạng thái: ${statusText(wallet)}.`,
    `Giới hạn lỗ: ${usd(wallet.config.dailyLossLimitUsd)}/ngày | Bắt đầu bảo vệ sớm khi lỗ ${usd(amount(wallet.config.softLossThresholdUsd).abs())}.`,
    `Lãi/lỗ thấp nhất trong ngày: ${usd(wallet.currentDay.worstNetPnl, true)}.`,
    dPositive(wallet.currentDay.breachUsd) ? `🚨 Đã lỗ vượt giới hạn: ${usd(wallet.currentDay.breachUsd)}.` : undefined,
    ...walletLines(wallet),
    'Chỉ coi lệnh đã đóng khi nhận thông báo ĐÓNG LỆNH được sàn xác nhận.',
  ]);
}

export function formatLiveErrorMessage(reason: string, wallet?: LivePortfolioWallet): string {
  return finish([
    '🚨 BOT GẶP SỰ CỐ CẦN KIỂM TRA',
    explainLiveTelegramReason(reason),
    wallet ? `Trạng thái gần nhất: ${statusText(wallet)}.` : 'Chưa nhận được số liệu tài khoản đã xác nhận từ sàn.',
    ...(wallet ? walletLines(wallet) : []),
    'Chỉ coi lệnh đã mở/đóng khi nhận thông báo xác nhận riêng từ sàn.',
  ]);
}
