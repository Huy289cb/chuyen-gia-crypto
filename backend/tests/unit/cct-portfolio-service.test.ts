import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const loadCct = vi.hoisted(() => vi.fn());
const boundary = vi.hoisted(() => vi.fn());
const buildTargets = vi.hoisted(() => vi.fn());
vi.mock('../../src/portfolio/market-data', async original => ({ ...(await original<any>()), loadCctCurrentMarket: loadCct, loadBoundaryMarks: boundary }));
vi.mock('../../src/portfolio/source-cct', async original => ({ ...(await original<any>()), buildCctSourceTargets: buildTargets }));
import { CCT_RUNTIME_SYMBOLS, CCT_DAILY_SEED_SHA256 } from '../../src/portfolio/market-data';
import { CCT_PAPER_POLICY } from '../../src/portfolio/policy-registry';
let service: typeof import('../../src/portfolio/paper-service');
let directory: string;
const previousDirectory = process.env.PORTFOLIO_PAPER_DATA_DIR, previousPolicy = process.env.PORTFOLIO_PAPER_POLICY;
const previousRegistry = process.env.PORTFOLIO_CCT_TESTBED_REGISTRY;
const marks = Object.fromEntries(CCT_RUNTIME_SYMBOLS.map(s => [s, '100']));
const filters = Object.fromEntries(CCT_RUNTIME_SYMBOLS.map(s => [s, { stepSize: '.01', minQty: '.01', minNotional: '1' }]));
const sourceBridge = { revision: 'cct-full-daily-seed-v1', seedSha256: CCT_DAILY_SEED_SHA256, seedFirstOpenMs: 0, seedLastOpenMs: 1, closedThroughMs: 2, appendedRows: [] };
function market(time: number, fundingAvailable: any[] = []) { return { time, marks, tradePrices: marks, filters, closedDailyRows: [], fundingAvailable, sourceBridge, provenance: { fundingThroughMs: time, quoteTimes: Object.fromEntries(CCT_RUNTIME_SYMBOLS.map(s => [s, { markTimeMs: Date.now(), tradeTimeMs: Date.now() }])) } }; }
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cct-paper-service-'));
  process.env.PORTFOLIO_PAPER_DATA_DIR = directory; process.env.PORTFOLIO_PAPER_POLICY = CCT_PAPER_POLICY.id;
  await fs.writeFile(path.join(directory, 'wallet.json'), 'legacy-wallet-untouched');
  buildTargets.mockImplementation((_rows, executeAtMs) => ({ strategy: 'cct-lc-b5-v1', policyId: CCT_PAPER_POLICY.id,
    sourceId: `cct:${executeAtMs}`, originalSourceId: 'constant-python-source', labelTimeMs: executeAtMs - 86400000,
    knownAtMs: executeAtMs, executeAtMs, weights: Object.fromEntries(CCT_RUNTIME_SYMBOLS.map(s => [s, .2])),
    metadata: Object.fromEntries(CCT_RUNTIME_SYMBOLS.map(s => [s, { signalCountChanged: true }])) }));
  service = await import('../../src/portfolio/paper-service');
});
afterAll(async () => {
  await fs.rm(directory, { recursive: true, force: true });
  for (const [key, value] of [['PORTFOLIO_PAPER_DATA_DIR', previousDirectory], ['PORTFOLIO_PAPER_POLICY', previousPolicy], ['PORTFOLIO_CCT_TESTBED_REGISTRY', previousRegistry]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
describe('versioned CCT paper service', () => {
  it('atomically persists source cursor and a separate100/10 wallet; restart dedup does not reset cash/fees', async () => {
    const start = Date.parse('2026-10-14T08:00:00Z'); loadCct.mockResolvedValueOnce(market(start));
    const first = await service.advancePortfolioPaper();
    expect(first.config.policyId).toBe(CCT_PAPER_POLICY.id); expect(first.config.closeBufferUsd).toBe('1.1');
    expect(first.config.grossCap).toBe('8'); expect(first.config.initialCash).toBe('100');
    expect(first.state.fillCount).toBe(0); expect((first.provenance as any).cctSourceExecution.disposition).toBe('bootstrap_flat_until_next_utc');
    expect((first.provenance as any).sourceBridge).toEqual(sourceBridge);
    expect(await fs.readFile(path.join(directory, 'wallet.json'), 'utf8')).toBe('legacy-wallet-untouched');
    loadCct.mockResolvedValueOnce(market(start + 60000));
    const second = await service.advancePortfolioPaper();
    expect(second.state.fillCount).toBe(first.state.fillCount); expect(second.state.cash).toBe(first.state.cash);
    expect(second.state.rebalanceCount).toBe(first.state.rebalanceCount); expect(buildTargets).toHaveBeenCalledTimes(0);
    expect(loadCct.mock.calls[1][0].sourceBridge).toEqual(sourceBridge);
    boundary.mockResolvedValueOnce({ marks, provenance: { field: '1m_mark_candle_open' } });
    loadCct.mockResolvedValueOnce(market(Date.parse('2026-10-15T00:00:00Z')));
    const next = await service.advancePortfolioPaper();
    expect(next.state.rebalanceCount).toBe(first.state.rebalanceCount + 1); expect(next.state.fillCount).toBeGreaterThan(0);
    expect(next.state.lastTargets?.knownAtMs).toBe(Date.parse('2026-10-15T00:00:00Z'));
    expect(next.state.currentDay?.anchorQuality).toBe('exact_midnight');
    expect(boundary).toHaveBeenCalledWith(Date.parse('2026-10-14T17:00:00Z'), CCT_RUNTIME_SYMBOLS);
  });
  it('keeps the checkpoint unchanged when public data is unavailable or funding arrives late on held inventory', async () => {
    loadCct.mockResolvedValueOnce(market(Date.parse('2026-10-15T00:01:00Z'))); await service.advancePortfolioPaper();
    const file = path.join(directory, CCT_PAPER_POLICY.id, 'wallet.json'); const before = await fs.readFile(file, 'utf8');
    loadCct.mockRejectedValueOnce(new Error('Public request failed 403'));
    await expect(service.advancePortfolioPaper()).rejects.toThrow('403'); expect(await fs.readFile(file, 'utf8')).toBe(before);
    loadCct.mockResolvedValueOnce(market(Date.parse('2026-10-15T00:02:00Z'), [{ id: 'late', symbol: 'BTCUSDT', time: Date.parse('2026-10-15T00:00:30Z'), rate: '.001', markPrice: '100' }]));
    await expect(service.advancePortfolioPaper()).rejects.toThrow('Delayed funding'); expect(await fs.readFile(file, 'utf8')).toBe(before);
  });
  it('exposes actual CCT policy and refuses an unregistered financial testbed', async () => {
    delete process.env.PORTFOLIO_CCT_TESTBED_REGISTRY;
    const status = await service.portfolioPaperStatus(); expect(status.policyId).toBe(CCT_PAPER_POLICY.id);
    expect((status.config as any).symbols).toEqual([...CCT_RUNTIME_SYMBOLS]); expect((status.config as any).sourceScalar).toBe(6);
    expect((status.testbed as any).request).toEqual({ policyId: CCT_PAPER_POLICY.id, window: 'continuous128' });
    await expect(service.startPortfolioTestbed({ policyId: CCT_PAPER_POLICY.id, window: 'continuous128' })).rejects.toThrow('not registered');
    delete process.env.PORTFOLIO_PAPER_POLICY; expect(service.selectedPortfolioPaperPolicy()).toBe('momentum-v1');
    process.env.PORTFOLIO_PAPER_POLICY = CCT_PAPER_POLICY.id;
  });
  it('consumes a UTC row rejected under a risk latch so the ICT reset cannot reenter that old row', async () => {
    const file = path.join(directory, CCT_PAPER_POLICY.id, 'wallet.json'), original = await fs.readFile(file, 'utf8');
    const cheap = Object.fromEntries(CCT_RUNTIME_SYMBOLS.map(s => [s, '70']));
    const at = (value: string, low = false) => ({ ...market(Date.parse(value)), ...(low ? { marks: cheap, tradePrices: cheap } : {}) });
    try {
      await fs.rm(file);
      loadCct.mockResolvedValueOnce(at('2026-10-14T00:00:00Z')); await service.advancePortfolioPaper();
      boundary.mockResolvedValueOnce({ marks, provenance: {} });
      loadCct.mockResolvedValueOnce(at('2026-10-14T17:00:00Z')); await service.advancePortfolioPaper();
      loadCct.mockResolvedValueOnce(at('2026-10-14T18:00:00Z', true));
      const latched = await service.advancePortfolioPaper();
      expect(latched.state.currentDay?.riskLatched).toBe(true); expect(Object.keys(latched.state.positions)).toHaveLength(0);
      loadCct.mockResolvedValueOnce(at('2026-10-15T00:00:00Z', true));
      const rejected = await service.advancePortfolioPaper();
      expect(rejected.state.lastTargets?.labelTimeMs).toBe(Date.parse('2026-10-13T00:00:00Z'));
      expect((rejected.provenance as any).cctSourceExecution.scheduledExecuteAtMs).toBe(Date.parse('2026-10-15T00:00:00Z'));
      boundary.mockResolvedValueOnce({ marks: cheap, provenance: {} });
      loadCct.mockResolvedValueOnce(at('2026-10-15T17:00:00Z', true));
      const reset = await service.advancePortfolioPaper();
      expect(reset.state.currentDay?.riskLatched).toBe(false); expect(reset.state.fillCount).toBe(rejected.state.fillCount);
      expect(Object.keys(reset.state.positions)).toHaveLength(0);
    } finally { await fs.writeFile(file, original); }
  });
  it('queries B5 after flattening and rejects a late settlement from previously held inventory without changing the checkpoint', async () => {
    const file = path.join(directory, CCT_PAPER_POLICY.id, 'wallet.json'), original = await fs.readFile(file, 'utf8');
    const cheap = Object.fromEntries(CCT_RUNTIME_SYMBOLS.map(s => [s, '70']));
    try {
      loadCct.mockResolvedValueOnce({ ...market(Date.parse('2026-10-15T00:02:00Z')), marks: cheap, tradePrices: cheap });
      const flat = await service.advancePortfolioPaper();
      expect(Object.keys(flat.state.positions)).toHaveLength(0);
      const checkpoint = await fs.readFile(file, 'utf8');
      loadCct.mockResolvedValueOnce({ ...market(Date.parse('2026-10-15T00:03:00Z'), [{
        id: 'published-after-close', symbol: 'BTCUSDT', time: Date.parse('2026-10-15T00:01:30Z'), rate: '.001', markPrice: '100',
      }]), marks: cheap, tradePrices: cheap });
      await expect(service.advancePortfolioPaper()).rejects.toThrow('Delayed funding');
      expect(loadCct.mock.calls.at(-1)?.[0].fundingSymbols).toEqual(CCT_RUNTIME_SYMBOLS);
      expect(await fs.readFile(file, 'utf8')).toBe(checkpoint);
    } finally { await fs.writeFile(file, original); }
  });
  it('binds a queued CCT child and its published report to the original protocol hash', async () => {
    const root = path.join(directory, 'registry-fixture'); await fs.mkdir(root, { recursive: true });
    const request = { policyId: CCT_PAPER_POLICY.id, window: 'dev64' as const };
    const jobFile = path.join(directory, CCT_PAPER_POLICY.id, 'testbeds/dev64/testbed-job.json');
    await fs.mkdir(path.dirname(jobFile), { recursive: true });
    const protocol = (version: number) => JSON.stringify({ policyId: CCT_PAPER_POLICY.id, windowId: 'dev64', version });
    const first = protocol(1), second = protocol(2);
    const digest = (body: string) => createHash('sha256').update(body).digest('hex');
    await fs.writeFile(path.join(root, 'first.json'), first); await fs.writeFile(path.join(root, 'second.json'), second);
    const registry = (which: string, hash: string) => JSON.stringify({ policyId: CCT_PAPER_POLICY.id,
      windows: { dev64: { protocolPath: which, protocolSha256: hash, outputDir: 'outputs' } } });
    const registryFile = path.join(root, 'registry.json'), before = JSON.stringify({ id: 'queued', status: 'running',
      startedAt: new Date().toISOString(), policyId: CCT_PAPER_POLICY.id, window: 'dev64', protocolSha256: digest(first) });
    await fs.writeFile(jobFile, before); await fs.writeFile(registryFile, registry('first.json', digest(first)));
    const oldRegistry = process.env.PORTFOLIO_CCT_TESTBED_REGISTRY; process.env.PORTFOLIO_CCT_TESTBED_REGISTRY = registryFile;
    try {
      expect((await service.queuedCctTestbedRegistration('queued', request, digest(first))).protocolSha256).toBe(digest(first));
      await fs.writeFile(registryFile, registry('second.json', digest(second)));
      await expect(service.queuedCctTestbedRegistration('queued', request, digest(first))).rejects.toThrow('changed after enqueue');
      await expect(service.queuedCctTestbedRegistration('replacement-job', request, digest(first))).rejects.toThrow('expectation mismatch');
      await expect(service.publishTestbed({ policyId: CCT_PAPER_POLICY.id, windowId: 'dev64', protocolSha256: digest(second) }, request)).rejects.toThrow('identity mismatch');
      expect(await fs.readFile(jobFile, 'utf8')).toBe(before);
    } finally {
      if (oldRegistry === undefined) delete process.env.PORTFOLIO_CCT_TESTBED_REGISTRY; else process.env.PORTFOLIO_CCT_TESTBED_REGISTRY = oldRegistry;
    }
  });
});
