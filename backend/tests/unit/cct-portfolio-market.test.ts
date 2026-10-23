import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CCT_DAILY_SEED_SHA256, CCT_RUNTIME_SYMBOLS, DAY_MS, loadCctCurrentMarket } from '../../src/portfolio/market-data';
const now = Date.parse('2026-10-16T09:00:00Z');
const info = JSON.parse(readFileSync(path.resolve(__dirname, '../../../docs/audits/futures-quick-win/source-replication-20261014T032757Z/data/exchangeInfo-public-20261014.json'), 'utf8'));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function transport(options: { stale?: boolean; fundingMissingMark?: boolean; unavailable?: boolean } = {}) {
  const daily: URL[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const parsed = new URL(url); let data: unknown;
    if (options.unavailable) return new Response('{}', { status: 403 });
    if (parsed.pathname.endsWith('/exchangeInfo')) data = info;
    else if (parsed.pathname.endsWith('/premiumIndex')) data = CCT_RUNTIME_SYMBOLS.map(symbol => ({ symbol, markPrice: '100', time: options.stale ? now - 30001 : now }));
    else if (parsed.pathname.endsWith('/ticker/price')) data = CCT_RUNTIME_SYMBOLS.map(symbol => ({ symbol, price: '100', time: now }));
    else if (parsed.pathname.endsWith('/fundingRate')) data = [{ symbol: parsed.searchParams.get('symbol'), fundingTime: now - 500, fundingRate: '0.001', ...(options.fundingMissingMark ? {} : { markPrice: '100' }) }];
    else if (parsed.pathname.endsWith('/klines')) {
      daily.push(parsed); const start = Number(parsed.searchParams.get('startTime')), end = Number(parsed.searchParams.get('endTime'));
      data = Array.from({ length: Math.floor((end + 1 - start) / DAY_MS) }, (_, i) => { const t = start + i * DAY_MS; return [t, '100', '101', '99', '100', '0', t + DAY_MS - 1]; });
    } else throw new Error(url);
    return new Response(JSON.stringify(data), { status: 200 });
  });
  return daily;
}
describe('CCT public full-history source bridge', () => {
  it('fills all missing closed days for B5, persists deterministic seed/cursor, and reuses it without refetching', async () => {
    const calls = transport();
    const first = await loadCctCurrentMarket({ nowMs: now });
    expect(first.closedDailyRows).toHaveLength(1502);
    expect(first.sourceBridge.seedSha256).toBe(CCT_DAILY_SEED_SHA256);
    expect(first.sourceBridge.appendedRows).toHaveLength(2);
    expect(first.sourceBridge.closedThroughMs).toBe(Date.parse('2026-10-16T00:00:00Z'));
    expect(calls).toHaveLength(5);
    expect(calls.every(url => url.searchParams.get('startTime') === String(Date.parse('2026-10-14T00:00:00Z')))).toBe(true);
    expect(Object.keys(first.filters)).toEqual([...CCT_RUNTIME_SYMBOLS]);
    calls.length = 0;
    const restart = await loadCctCurrentMarket({ nowMs: now, sourceBridge: first.sourceBridge });
    expect(restart.closedDailyRows).toEqual(first.closedDailyRows);
    expect(calls).toHaveLength(0);
    await expect(loadCctCurrentMarket({ nowMs: now, sourceBridge: { ...first.sourceBridge, seedSha256: 'wrong' } })).rejects.toThrow('checkpoint/seed mismatch');
  });
  it('rejects stale venue quotes and held settlements without an exact mark', async () => {
    transport({ stale: true });
    await expect(loadCctCurrentMarket({ nowMs: now })).rejects.toThrow('venue quote timestamp');
    transport({ fundingMissingMark: true });
    await expect(loadCctCurrentMarket({ nowMs: now, fundingAfterMs: now - 1000, fundingSymbols: ['BTCUSDT'] })).rejects.toThrow('Missing exact held-inventory funding mark');
  });
  it('surfaces public403 as unavailable rather than synthesizing data', async () => {
    transport({ unavailable: true });
    await expect(loadCctCurrentMarket({ nowMs: now })).rejects.toThrow('Public request failed 403');
  });
});
