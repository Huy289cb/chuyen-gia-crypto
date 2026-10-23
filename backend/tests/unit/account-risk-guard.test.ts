import {replayRecordedAccountGuardInvocation} from '../../src/utils/recorded-account-guard-invocation';
import {replayAccountGuardCompletion} from '../../src/utils/account-guard-completion';
import {replayLossStreakCooldown} from '../../src/utils/loss-streak-cooldown-decision';
import {replayRecordedAccountInitialDecision} from '../../src/utils/recorded-account-initial-decision';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMutationJournal = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../src/utils/account-wallet-journal', () => ({ persistAccountWalletObservation: mockMutationJournal }));

const mockFindUniqueAccount = vi.hoisted(() => vi.fn());
const mockUpdateAccount = vi.hoisted(() => vi.fn());
const mockGetBinanceLossStreak = vi.hoisted(() => vi.fn());
const mockSetTestnetAccountCooldown = vi.hoisted(() => vi.fn());
const mockGetCircuit = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    allowed: true,
    reason: 'circuits clear',
    dailyLossUsd: 0,
    dailyLossPercent: 0,
    dailyLossLimitPercent: 3,
    peakEquity: 40,
    drawdownPercent: 0,
    maxDrawdownPercent: 15,
    expectancy: { n: 0, sumR: 0, avgR: 0, profitFactor: null },
  })
);
const mockRecordEvent = vi.hoisted(() => vi.fn().mockResolvedValue(1));
const mockApplyExpectancyCd = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    testnetAccount: {
      findUnique: mockFindUniqueAccount,
      update: mockUpdateAccount,
    },
  },
}));

vi.mock('../../src/repositories/testnet.repository', () => ({
  setTestnetAccountCooldown: mockSetTestnetAccountCooldown,
  recordSilentPipelineEvent: mockRecordEvent,
}));

vi.mock('../../src/services/binance-trade-history.service', () => ({
  getBinanceLossStreak: mockGetBinanceLossStreak,
}));

vi.mock('../../src/services/account-circuit.service', () => ({
  getAccountCircuitStatus: mockGetCircuit,
  applyExpectancyKillCooldownIfNeeded: mockApplyExpectancyCd,
}));

import { replayRecordedAccountGuardMutation } from '../../src/utils/recorded-account-guard-mutation';
import { withEntryTrace, type EntryTrace } from '../../src/utils/entry-trace';
import { assertTestnetAccountCanOpenTrade } from '../../src/services/account-risk-guard.service';
import {
  clearProtectiveExposureEntryBlock,
  setProtectiveExposureEntryBlock,
} from '../../src/services/protective-exposure-state';

describe('account risk guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearProtectiveExposureEntryBlock();
    process.env.BINANCE_ENABLED = 'true';
    process.env.MAX_CONSECUTIVE_LOSSES = '2';
    process.env.CONSECUTIVE_LOSS_COOLDOWN_HOURS = '4';
    mockFindUniqueAccount.mockResolvedValue({
      id: 1,
      cooldown_until: null,
      consecutive_losses: 0,
    });
    mockGetBinanceLossStreak.mockResolvedValue({
      consecutiveLosses: 0,
      lastLossTime: 0,
    });
    mockGetCircuit.mockResolvedValue({
      allowed: true,
      reason: 'circuits clear',
      dailyLossUsd: 0,
      dailyLossPercent: 0,
      dailyLossLimitPercent: 3,
      peakEquity: 40,
      drawdownPercent: 0,
      maxDrawdownPercent: 15,
      expectancy: { n: 0, sumR: 0, avgR: 0, profitFactor: null },
    });
  });

  it('journals measured state and actual circuit through event persistence', async () => {
    const trace: EntryTrace = { trace_id: 'journal-test', lane: 'legacy_signal',
      policy_hash: 'recorded-policy', evaluated_at: '2026-10-02T00:00:00Z' };
    mockFindUniqueAccount.mockResolvedValue({id:1,current_balance:31.4,equity:30.2,
      cooldown_until:null,consecutive_losses:0});
    await withEntryTrace(trace, () => assertTestnetAccountCanOpenTrade(1, 'BTC'));
    const events=mockRecordEvent.mock.calls.map(call => call[1]);
    expect(events.map(e=>e.stage)).toEqual(['account_guard_invocation_started','account_guard_inputs','account_guard_initial_evaluated','account_loss_streak_evaluated','account_circuit_evaluated','account_guard_completed','account_guard_invocation_finished']);
    expect(events.find(e=>e.stage==='account_guard_inputs')).toMatchObject({trace_id:'journal-test',account_id:1,balance:31.4,
      equity:30.2,circuit_status:'not_evaluated',exchange_loss_streak_status:'not_evaluated'});
    expect(events.find(e=>e.stage==='account_circuit_evaluated').circuit).toEqual(await mockGetCircuit.mock.results[0].value);
    expect(replayRecordedAccountInitialDecision(events.find(e=>e.stage==='account_guard_initial_evaluated').initial_guard, Date.now(), Date.now())).toMatchObject({status:'evaluated',matches_recorded:true});
    expect(replayLossStreakCooldown(events.find(e=>e.stage==='account_loss_streak_evaluated').streak_decision.input)).toMatchObject({status:'evaluated',decision:events.find(e=>e.stage==='account_loss_streak_evaluated').streak_decision.decision});
    expect(replayAccountGuardCompletion(events.find(e=>e.stage==='account_guard_completed').completion,Date.now(),Date.now())).toMatchObject({status:'evaluated',matches_recorded:true});
    expect(new Set(events.map(e=>e.guard_invocation_id)).size).toBe(1);
    expect(events[0].guard_invocation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(events.at(-1)).toMatchObject({outcome:'returned',financial_output_status:'finite'});
    const knownAt=Date.now();expect(replayRecordedAccountGuardInvocation(events.map(data=>({data,known_at:knownAt})),knownAt)).toMatchObject({status:'unknown',reason:'missing_circuit_or_completion'});
    expect(mockGetCircuit).toHaveBeenCalledTimes(1);
  });

  it('records missing balance as null and never labels a skipped circuit clear', async () => {
    setProtectiveExposureEntryBlock('missing SL', 60000);
    await withEntryTrace({trace_id:'blocked',lane:'legacy_signal',policy_hash:'test',
      evaluated_at:'2026-10-02T00:00:00Z'},()=>assertTestnetAccountCanOpenTrade(1,'BTC'));
    expect(mockRecordEvent).toHaveBeenCalledTimes(4);
    const knownAt=Date.now(),events=mockRecordEvent.mock.calls.map(c=>({data:c[1],known_at:knownAt}));expect(replayRecordedAccountGuardInvocation(events,knownAt)).toMatchObject({status:'decisions_replayed',expected_decision:{allowed:false},economic_roi:null});
    expect(mockRecordEvent.mock.calls.find(c=>c[1].stage==='account_guard_inputs')![1]).toMatchObject({balance:null,equity:null,
      circuit_status:'not_evaluated'});
    expect(mockGetCircuit).not.toHaveBeenCalled();
  });

  it('blocks entries while protective exposure audit lock is active', async () => {
    setProtectiveExposureEntryBlock('Unprotected BTC long exposure missing SL', 60000);

    const result = await assertTestnetAccountCanOpenTrade(1, 'BTC');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Protective exposure audit blocked entries');
    expect(mockGetBinanceLossStreak).not.toHaveBeenCalled();
  });

  it('blocks entries from Binance loss streak', async () => {
    mockGetBinanceLossStreak.mockResolvedValue({
      consecutiveLosses: 2,
      lastLossTime: Date.now() - 30 * 60_000,
    });

    const result = await assertTestnetAccountCanOpenTrade(1, 'BTC');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Binance loss streak 2');
  });

  it('clears expired cooldown_until before allowing entries', async () => {
    mockFindUniqueAccount.mockResolvedValue({
      id: 1,
      cooldown_until: new Date(Date.now() - 60_000),
      consecutive_losses: 2,
    });

    const result = await assertTestnetAccountCanOpenTrade(1, 'BTC');

    expect(result.allowed).toBe(true);
    expect(mockUpdateAccount).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { cooldown_until: null },
    });
  });

  it('blocks entries when account circuit trips', async () => {
    mockGetCircuit.mockResolvedValue({
      allowed: false,
      reason: 'Daily loss circuit 3.50% >= 3%',
      dailyLossUsd: 1.4,
      dailyLossPercent: 3.5,
      dailyLossLimitPercent: 3,
      peakEquity: 40,
      drawdownPercent: 5,
      maxDrawdownPercent: 15,
      expectancy: { n: 0, sumR: 0, avgR: 0, profitFactor: null },
    });

    const result = await assertTestnetAccountCanOpenTrade(1, 'BTC');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily loss circuit');
  });
  it.each(['expired_cooldown_clear', 'exchange_loss_streak_overwrite'])('replays successful %s journal', async kind => {
    if (kind === 'expired_cooldown_clear') mockFindUniqueAccount.mockResolvedValue({id:1,cooldown_until:new Date(Date.now()-60000),consecutive_losses:0});
    else mockGetBinanceLossStreak.mockResolvedValue({consecutiveLosses:1,lastLossTime:123});
    await assertTestnetAccountCanOpenTrade(1, 'BTC');
    await vi.waitFor(() => expect(mockMutationJournal).toHaveBeenCalledTimes(1));
    const [event, type] = mockMutationJournal.mock.calls[0];
    expect(type).toBe('account_guard_mutation_applied');
    expect(event).toMatchObject({kind,account_id:1,applied_clock_source:'db_update_return'});
    const replay = replayRecordedAccountGuardMutation(event, Date.now(), Date.now()+100);
    expect(replay).toMatchObject({status:'evaluated',matches_recorded:true,economic_total_pnl:null});
    expect(replayRecordedAccountGuardMutation({...event,update:{invented:1}},Date.now(),Date.now()+100)).toMatchObject({matches_recorded:false});
    expect(replayRecordedAccountGuardMutation({...event,applied_clock_source:null},Date.now(),Date.now()+100)).toMatchObject({status:'unknown'});
  });
  it('does not journal a failed database clear', async () => {
    mockFindUniqueAccount.mockResolvedValue({id:1,cooldown_until:new Date(Date.now()-60000),consecutive_losses:0});
    mockUpdateAccount.mockRejectedValueOnce(new Error('write failed'));
    await expect(assertTestnetAccountCanOpenTrade(1,'BTC')).rejects.toThrow('write failed');
    expect(mockMutationJournal).not.toHaveBeenCalled();
  });
  it('does not await pending journal persistence', async () => {
    mockMutationJournal.mockImplementationOnce(() => new Promise(() => {}));
    mockGetBinanceLossStreak.mockResolvedValue({consecutiveLosses:1,lastLossTime:123});
    expect((await assertTestnetAccountCanOpenTrade(1,'BTC')).allowed).toBe(true);
  });

  it('journals missing-account terminal decision in the actual traced guard',async()=>{
    mockFindUniqueAccount.mockResolvedValue(null);
    const result=await withEntryTrace({trace_id:'missing',lane:'legacy_signal',policy_hash:'test',evaluated_at:'2026-10-02T00:00:00Z'},()=>assertTestnetAccountCanOpenTrade(1,'BTC'));
    const events=mockRecordEvent.mock.calls.map(c=>c[1]);
    expect(events.map(e=>e.stage)).toEqual(['account_guard_invocation_started','account_guard_invocation_finished']);
    expect(events[1]).toMatchObject({guard_invocation_id:events[0].guard_invocation_id,outcome:'returned',decision:result,financial_output_status:'absent'});
    expect(mockGetCircuit).not.toHaveBeenCalled();
  });
  it('journals a thrown DB read without exposing error content',async()=>{
    const failure=Error('private database failure');mockFindUniqueAccount.mockRejectedValue(failure);
    await expect(withEntryTrace({trace_id:'failed',lane:'legacy_signal',policy_hash:'test',evaluated_at:'2026-10-02T00:00:00Z'},()=>assertTestnetAccountCanOpenTrade(1,'BTC'))).rejects.toBe(failure);
    const events=mockRecordEvent.mock.calls.map(c=>c[1]);expect(events[1]).toMatchObject({guard_invocation_id:events[0].guard_invocation_id,outcome:'threw',decision:null});expect(JSON.stringify(events)).not.toContain(failure.message);
  });

});
