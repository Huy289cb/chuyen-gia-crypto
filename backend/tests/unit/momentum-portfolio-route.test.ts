import { beforeEach, describe, expect, it, vi } from 'vitest';
const status = vi.hoisted(() => vi.fn());
const advance = vi.hoisted(() => vi.fn());
const testbed = vi.hoisted(() => vi.fn());
vi.mock('../../src/portfolio/paper-service', () => ({ portfolioPaperStatus: status, advancePortfolioPaper: advance, startPortfolioTestbed: testbed }));
import router from '../../src/routes/portfolio-paper';
import { CCT_PAPER_POLICY } from '../../src/portfolio/policy-registry';
async function invoke(method: string, path: string, body?: unknown) {
  const layer = (router as any).stack.find((entry: any) => entry.route?.path === path && entry.route.methods[method]);
  let code = 200; let payload: any;
  const res = { status(value: number) { code = value; return this; }, json(value: unknown) { payload = value; return this; } };
  await layer.route.stack[0].handle({ body }, res);
  return { code, payload };
}
beforeEach(() => vi.clearAllMocks());
describe('portfolio paper HTTP policy', () => {
  it('exposes one paper wallet with unmodified source/replay provenance', async () => {
    status.mockResolvedValue({ mode: 'paper', policy: { initialBalance: 100, dailyLossLimit: 10 }, state: null });
    expect((await invoke('get', '/')).payload.data.policy).toEqual({ initialBalance: 100, dailyLossLimit: 10 });
  });
  it('rejects capital/risk/universe overrides before invoking the engine', async () => {
    expect((await invoke('post', '/advance', { initialCash: 200 })).code).toBe(400);
    expect((await invoke('post', '/testbed', { days: 14, dailyLossLimit: 20 })).code).toBe(400);
    expect((await invoke('post', '/testbed', { days: 13 })).code).toBe(400);
    expect(advance).not.toHaveBeenCalled(); expect(testbed).not.toHaveBeenCalled();
  });
  it('queues the registered 14-day run without resetting the current wallet', async () => {
    testbed.mockResolvedValue({ id: 'job', status: 'running' });
    expect(await invoke('post', '/testbed', { days: 14 })).toEqual({ code: 202, payload: { success: true, data: { id: 'job', status: 'running' } } });
    expect(advance).not.toHaveBeenCalled();
  });
  it('accepts only registered CCT windows with their explicit policy identity', async () => {
    testbed.mockResolvedValue({ id: 'cct-job', status: 'running' });
    for (const window of ['dev64', 'prior64', 'continuous128']) {
      expect((await invoke('post', '/testbed', { policyId: CCT_PAPER_POLICY.id, window })).code).toBe(202);
      expect(testbed).toHaveBeenLastCalledWith({ policyId: CCT_PAPER_POLICY.id, window });
    }
    for (const body of [
      { policyId: CCT_PAPER_POLICY.id, window: 'custom' },
      { policyId: CCT_PAPER_POLICY.id, window: 'dev64', initialCash: 200 },
      { policyId: CCT_PAPER_POLICY.id, window: 'dev64', closeBufferUsd: '0.1' },
      { policyId: CCT_PAPER_POLICY.id, window: 'dev64', protocolPath: '/tmp/unregistered' },
    ]) expect((await invoke('post', '/testbed', body)).code).toBe(400);
  });
});
