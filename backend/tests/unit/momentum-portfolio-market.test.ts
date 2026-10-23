import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadCurrentMarket, SOURCE_MOMENTUM_SYMBOLS } from '../../src/portfolio/market-data';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('paper public funding transport', () => {
  it('keeps40 quotes/signals while fetching funding only for the specified held contracts', async () => {
    const now = Date.parse('2026-10-14T09:00:00Z'); vi.spyOn(Date, 'now').mockReturnValue(now);
    const info = JSON.parse(readFileSync(path.resolve(__dirname, '../../../docs/audits/futures-quick-win/source-replication-20261014T032757Z/data/exchangeInfo-public-20261014.json'), 'utf8'));
    const fundingCalls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      const parsed = new URL(url); let data: unknown;
      if (parsed.pathname.endsWith('/exchangeInfo')) data = info;
      else if (parsed.pathname.endsWith('/premiumIndex')) data = SOURCE_MOMENTUM_SYMBOLS.map(symbol => ({ symbol, markPrice: '100', time: now }));
      else if (parsed.pathname.endsWith('/ticker/price')) data = SOURCE_MOMENTUM_SYMBOLS.map(symbol => ({ symbol, price: '100', time: now }));
      else if (parsed.pathname.endsWith('/fundingRate')) {
        fundingCalls.push(parsed.searchParams.get('symbol')!);
        expect(parsed.searchParams.has('startTime')).toBe(false);
        data = [now - 7200000, now - 500, now + 1000].map(fundingTime => ({ symbol: 'ETHUSDT', fundingTime, fundingRate: '0.0001', markPrice: '100' }));
      }
      else if (parsed.pathname.endsWith('/klines')) data = [];
      else throw new Error(url);
      return new Response(JSON.stringify(data), { status: 200 });
    });
    const snapshot = await loadCurrentMarket({ nowMs: now, fundingAfterMs: now - 1000, fundingSymbols: ['ETHUSDT'] });
    expect(fundingCalls).toEqual(['ETHUSDT']);
    expect(Object.keys(snapshot.marks)).toHaveLength(40);
    expect(Object.keys(snapshot.filters)).toHaveLength(40);
    expect(snapshot.closedDailyRows).toHaveLength(1500);
    expect(snapshot.fundingAvailable.map(event => event.time)).toEqual([now - 500]);
  });
});
