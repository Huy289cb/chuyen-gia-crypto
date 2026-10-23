import {currentProviderPurpose} from '../../src/utils/provider-purpose-context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ analyze: vi.fn() }));
vi.mock('../../src/services/groq-client', () => ({ createGroqClient: vi.fn(() => null) }));
vi.mock('../../src/services/openrouter-client', () => ({ analyzeViaOpenRouter: mocks.analyze }));
vi.mock('../../src/config/openrouter-models', () => ({
  isOpenRouterLevelsAdapterProvider: () => true, getOpenRouterLevelsAdapterModel: () => 'fixture',
}));
vi.mock('../../src/config/methods', () => ({ getMethodConfig: () => ({ autoEntry: { minRRRatio: 3 } }) }));
vi.mock('../../src/config/risk-policy', () => ({ getRiskPolicy: () => ({ minSlDistancePercent: .008 }) }));
import { tryRepairLevelsWithSecondaryKey, tryRepairTpForMinRrWithSecondaryKey } from '../../src/services/groq-levels-adapter.service';
import type { GroqAnalysis } from '../../src/services/groq-client';
const input = (action: 'buy' | 'sell', sl: number, tp: number) => ({
  symbol: 'BTC', timeframe: '5m', methodId: 'kim_nghia',
  analysis: { action, suggested_entry: 100, suggested_stop_loss: sl, suggested_take_profit: tp } as GroqAnalysis,
});
describe('levels repair original target bound', () => {
  beforeEach(() => { mocks.analyze.mockReset(); vi.stubEnv('GROQ_LEVELS_ADAPTER_ENABLED', 'true'); vi.stubEnv('OPENROUTER_API_KEY', 'fixture'); });
  afterEach(() => vi.unstubAllEnvs());
  it.each([{ side: 'buy' as const, sl: 99.5, tp: 101 }, { side: 'sell' as const, sl: 100.5, tp: 99 }])('skips infeasible min-stop repair for $side before calling AI', async ({side,sl,tp}) => {
    expect(await tryRepairLevelsWithSecondaryKey(input(side,sl,tp))).toBeNull();
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it.each([{ side: 'buy' as const, sl: 99, tp: 102 }, { side: 'sell' as const, sl: 101, tp: 98 }])('does not extend the $side target to make a low-RR trade pass', async ({side,sl,tp}) => {
    mocks.analyze.mockResolvedValue({ suggested_take_profit: side === 'buy' ? 103 : 97 });
    expect(await tryRepairTpForMinRrWithSecondaryKey(input(side,sl,tp))).toBeNull();
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it.each([{ side: 'buy' as const, sl: 99.5, tp: 104, newSl: 99.2, newTp: 102.4 }, { side: 'sell' as const, sl: 100.5, tp: 96, newSl: 100.8, newTp: 97.6 }])('preserves feasible $side repair within the original target', async ({side,sl,tp,newSl,newTp}) => {
    mocks.analyze.mockImplementationOnce(async()=>{expect(currentProviderPurpose()).toBe('levels_repair');return { suggested_stop_loss: newSl, suggested_take_profit: newTp };});
    const result = await tryRepairLevelsWithSecondaryKey(input(side,sl,tp));
    expect(result).toMatchObject({ suggested_stop_loss: newSl, suggested_take_profit: newTp });
    expect(result!.expected_rr).toBeCloseTo(3,6);
    expect(mocks.analyze).toHaveBeenCalledOnce();
    expect(mocks.analyze.mock.calls[0][0].systemPrompt).toContain(`Original structural TP bound: ${tp}`);
  });
  it('still rejects AI returning a target beyond the original bound', async () => {
    mocks.analyze.mockResolvedValue({ suggested_stop_loss: 99.2, suggested_take_profit: 105 });
    expect(await tryRepairLevelsWithSecondaryKey(input('buy',99.5,104))).toBeNull();
  });
});
