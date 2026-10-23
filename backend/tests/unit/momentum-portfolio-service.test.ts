import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const loadMarket = vi.hoisted(() => vi.fn());
const loadBoundary = vi.hoisted(() => vi.fn());
vi.mock('../../src/portfolio/market-data', async importOriginal => ({ ...(await importOriginal<any>()), loadCurrentMarket: loadMarket, loadBoundaryMarks: loadBoundary }));
import { parseDailyPriceCsv, SOURCE_MOMENTUM_SYMBOLS } from '../../src/portfolio/market-data';
let service: typeof import('../../src/portfolio/paper-service');
let directory: string; const previous = process.env.PORTFOLIO_PAPER_DATA_DIR;
const rows = parseDailyPriceCsv(readFileSync(path.resolve(__dirname, '../../../docs/audits/futures-quick-win/source-replication-20261014T032757Z/data/prices.csv'), 'utf8'));
const prices = Object.fromEntries(SOURCE_MOMENTUM_SYMBOLS.map(symbol => [symbol, '100']));
const filters = Object.fromEntries(SOURCE_MOMENTUM_SYMBOLS.map(symbol => [symbol, { stepSize: '0.01', minQty: '0.01', minNotional: '1' }]));
function market(time: number, fundingAvailable: any[] = []) { return { time, marks: prices, tradePrices: prices, filters,
  closedDailyRows: rows, fundingAvailable, provenance: { fundingThroughMs: time } }; }
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'portfolio-service-'));
  process.env.PORTFOLIO_PAPER_DATA_DIR = directory;
  service = await import('../../src/portfolio/paper-service');
});
afterAll(async () => { await fs.rm(directory, { recursive: true, force: true }); if (previous === undefined) delete process.env.PORTFOLIO_PAPER_DATA_DIR; else process.env.PORTFOLIO_PAPER_DATA_DIR = previous; });
describe('paper service on the shared production engine', () => {
  it('persists one100u wallet, explicitly late startup, delta/funding dedup and exact ICT boundary recovery', async () => {
    const start = Date.parse('2026-10-14T08:00:00Z');
    loadMarket.mockResolvedValueOnce(market(start));
    const first = await service.advancePortfolioPaper();
    expect(first.config.initialCash).toBe('100'); expect(first.config.dailyLossLimitUsd).toBe('10');
    expect(first.state.lastTargets?.scheduledExecuteAtMs).toBe(Date.parse('2026-10-14T00:00:00Z'));
    expect(Object.keys(first.state.positions).length).toBeGreaterThan(1);
    const event = { id: 'fund-event', symbol: 'BTCUSDT', time: start + 1000, rate: '0.001', markPrice: '100' };
    loadMarket.mockResolvedValueOnce(market(start + 60_000, [event]));
    const second = await service.advancePortfolioPaper();
    expect(second.state.fillCount).toBe(first.state.fillCount);
    expect(second.state.processedFundingIds).toEqual(['fund-event']);
    loadMarket.mockResolvedValueOnce(market(start + 120_000, [event]));
    const third = await service.advancePortfolioPaper();
    expect(third.state.fundingPnl).toBe(second.state.fundingPnl);
    const boundary = Date.parse('2026-10-14T17:00:00Z');
    loadBoundary.mockResolvedValueOnce({ time: boundary, marks: prices, provenance: { partialCandleCloseUsed: false } });
    loadMarket.mockResolvedValueOnce(market(boundary + 45_000, [event]));
    const fourth = await service.advancePortfolioPaper();
    expect(fourth.state.currentDay?.day).toBe('2026-10-15');
    expect(fourth.state.currentDay?.anchorQuality).toBe('exact_midnight');
    expect(fourth.state.days).toHaveLength(1);
    expect(loadBoundary).toHaveBeenCalledWith(boundary);
  });
  it('refuses a newly published funding event older than the checkpoint without changing wallet money', async () => {
    const before = await service.portfolioPaperStatus();
    loadMarket.mockResolvedValueOnce(market(Date.parse('2026-10-14T17:02:00Z'), [
      { id: 'late-funding', symbol: 'BTCUSDT', time: Date.parse('2026-10-14T16:00:00Z'), rate: '0.01', markPrice: '100' },
    ]));
    await expect(service.advancePortfolioPaper()).rejects.toThrow('Delayed funding');
    const after = await service.portfolioPaperStatus();
    expect(after.state).toEqual(before.state); expect(after.summary).toEqual(before.summary);
  });
  it('deduplicates an overlapping older settlement when its reconstructed held quantity was zero', async () => {
    const before = await service.portfolioPaperStatus();
    const state = before.state as { positions: Record<string, unknown> };
    const symbol = SOURCE_MOMENTUM_SYMBOLS.find(item => !state.positions[item])!;
    loadMarket.mockResolvedValueOnce(market(Date.parse('2026-10-14T17:03:00Z'), [
      { id: 'zero-inventory-funding', symbol, time: Date.parse('2026-10-14T16:00:00Z'), rate: '0.01', markPrice: '100' },
    ]));
    const after = await service.advancePortfolioPaper();
    expect(after.state.processedFundingIds).toContain('zero-inventory-funding');
    expect(after.summary.netPnl).toBe((before.summary as { netPnl: string }).netPnl);
  });
});
