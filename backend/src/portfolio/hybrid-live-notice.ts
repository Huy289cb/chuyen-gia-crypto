import { isTelegramEnabled, telegramConfig } from '../config/telegram';
import { createLiveTelegramSender } from './live-telegram-transport';

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

export async function sendHybridTelegram(text: string): Promise<string[]> {
  if (!isTelegramEnabled() || telegramConfig.notifyLevel === 'off' || !text.trim()) return [];
  const send = createLiveTelegramSender(telegramConfig.botToken);
  const ids: string[] = [];
  for (const chatId of telegramConfig.chatIds) ids.push(await send(chatId, text));
  return ids;
}
