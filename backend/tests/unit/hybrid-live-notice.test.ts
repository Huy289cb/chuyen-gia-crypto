import { describe, expect, it } from 'vitest';
import { formatHybridBookNotice, formatHybridBreakerNotice, formatHybridStopNotice } from '../../src/portfolio/hybrid-live-notice';

describe('hybrid live telegram notices', () => {
  it('names the open book, the 12% stop, and the 12 USDT breaker', () => {
    const book = formatHybridBookNotice({
      equity: 31.38639119,
      dayPnl: -0.0165,
      positions: [
        { symbol: '1000PEPEUSDT', qty: 5470, unrlPnl: 0.3918, slPrice: 0.003984904 },
        { symbol: 'TIAUSDT', qty: 46, unrlPnl: 0.555, slPrice: 0.471768 },
      ],
    });
    expect(book).toContain('MUA 5470 1000PEPE');
    expect(book).toContain('MUA 46 TIA');
    expect(book).toContain('Dừng lỗ 0,0039849');
    expect(book).toContain('Trần lỗ 12 USDT/ngày');
    expect(formatHybridStopNotice({ symbol: 'TIAUSDT', mark: 0.47, slPrice: 0.471768, sent: true })).toContain('Đã gửi lệnh đóng');
    expect(formatHybridBreakerNotice(-12.01, false)).toContain('chạm trần 12 USDT');
  });
});
