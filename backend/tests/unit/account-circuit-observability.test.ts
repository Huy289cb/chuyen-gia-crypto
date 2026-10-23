import {replayRecordedAccountCircuitDecision} from '../../src/utils/recorded-account-circuit-decision';
const decisionStages=vi.hoisted(()=>vi.fn().mockResolvedValue(undefined));
vi.mock('../../src/utils/entry-trace',()=>({recordEntryStage:decisionStages}));
import {replayRecordedAccountCircuitMutation as replay} from '../../src/utils/recorded-account-circuit-mutation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mutationJournal = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../src/utils/account-wallet-journal',()=>({persistAccountWalletObservation:mutationJournal}));
const mockFindAccount = vi.hoisted(() => vi.fn());
const mockFindSnapshot = vi.hoisted(() => vi.fn());
const mockAggregateSnapshots = vi.hoisted(() => vi.fn());
const mockUpdateAccount = vi.hoisted(() => vi.fn());
const mockFindOutcomes = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    testnetAccount: {
      findUnique: mockFindAccount,
      update: mockUpdateAccount,
    },
    testnetAccountSnapshot: {
      findFirst: mockFindSnapshot,
      aggregate: mockAggregateSnapshots,
    },
    tradeOutcome: { findMany: mockFindOutcomes },
  },
}));

import { getAccountCircuitStatus, applyExpectancyKillCooldownIfNeeded } from '../../src/services/account-circuit.service';

describe('account circuit observability scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CIRCUIT_PEAK_EQUITY', '38');
    vi.stubEnv('CIRCUIT_EXPECTANCY_SINCE', '2026-08-12T16:00:00.000Z');
    vi.stubEnv('MAX_DRAWDOWN_PERCENT', '15');
    mockFindAccount.mockResolvedValue({
      id: 1,
      starting_balance: 40,
      current_balance: 36,
      equity: 36,
      max_drawdown: 10,
    });
    mockFindSnapshot.mockResolvedValue({ equity: 36 });
    mockAggregateSnapshots.mockResolvedValue({ _max: { equity: 37 } });
    mockFindOutcomes.mockResolvedValue([]);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('labels override-based drawdown and expectancy as strategy epoch without changing the gate', async () => {
    const status = await getAccountCircuitStatus(1);

    expect(status.allowed).toBe(true);
    const payload=decisionStages.mock.calls.find(c=>c[0]==='account_circuit_decision_evaluated')?.[1].circuit_decision;
    expect(payload.query_context.outcome_scope).toBe('legacy_global');
    expect(replayRecordedAccountCircuitDecision(payload,Date.now(),Date.now())).toMatchObject({status:'evaluated',matches_recorded:true,query_lineage:'not_established'});
    expect(status.scope).toBe('strategy_epoch');
    expect(status.epochStart?.toISOString()).toBe('2026-08-12T16:00:00.000Z');
    expect(status.peakEquitySource).toBe('override');
    expect(status.peakEquity).toBe(38);
    expect(status.drawdownPercent).toBeCloseTo((2 / 38) * 100, 8);
    expect(mockAggregateSnapshots).toHaveBeenCalledWith({
      where: {
        account_id: 1,
        timestamp: { gte: new Date('2026-08-12T16:00:00.000Z') },
      },
      _max: { equity: true },
    });
    expect(mockFindOutcomes).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { timestamp: { gte: new Date('2026-08-12T16:00:00.000Z') } },
      })
    );
  });

  it('ratchets an override to the highest strategy-epoch snapshot', async () => {
    mockAggregateSnapshots.mockResolvedValue({ _max: { equity: 41 } });

    const status = await getAccountCircuitStatus(1);

    expect(status.peakEquitySource).toBe('override_ratcheted');
    expect(status.peakEquity).toBe(41);
    expect(status.drawdownPercent).toBeCloseTo((5 / 41) * 100, 8);
  });

  it('still records drawdown from the retained peak when the drawdown blocker is disabled', async () => {
    vi.stubEnv('CIRCUIT_DRAWDOWN_ENABLED', 'false');
    mockAggregateSnapshots.mockResolvedValue({ _max: { equity: 45 } });
    const status = await getAccountCircuitStatus(1);
    expect(status.allowed).toBe(true);
    expect(status.peakEquity).toBe(45);
    expect(status.drawdownPercent).toBeCloseTo(20);
    expect(mockUpdateAccount).toHaveBeenCalledWith({ where: { id: 1 }, data: { max_drawdown: 20 } });
  });

  it('retains the daily circuit with drawdown disabled', async () => {
    vi.stubEnv('CIRCUIT_DRAWDOWN_ENABLED', 'false');
    vi.stubEnv('CIRCUIT_DAILY_LOSS_ENABLED', 'true');
    vi.stubEnv('DAILY_LOSS_LIMIT_PERCENT', '10');
    mockFindSnapshot.mockResolvedValue({ equity: 40 });
    const status = await getAccountCircuitStatus(1);
    expect(status.allowed).toBe(false);
    expect(status.reason).toBe('Daily loss circuit 10.00% >= 10%');
  });

  it('retains the expectancy circuit with drawdown disabled', async () => {
    vi.stubEnv('CIRCUIT_DRAWDOWN_ENABLED', 'false');
    vi.stubEnv('CIRCUIT_EXPECTANCY_KILL_ENABLED', 'true');
    vi.stubEnv('CIRCUIT_EXPECTANCY_WINDOW', '10');
    vi.stubEnv('CIRCUIT_EXPECTANCY_MIN_SUM_R', '-3');
    mockFindOutcomes.mockResolvedValue(Array.from({ length: 10 }, () => ({ realized_rr: -0.4, realized_pnl: -1 })));
    const status = await getAccountCircuitStatus(1);
    expect(status.allowed).toBe(false);
    expect(status.reason).toContain('Expectancy kill:');
  });
  it('journals max drawdown only after successful write', async () => {
    mockFindAccount.mockResolvedValue({id:1,starting_balance:40,current_balance:30,equity:30,max_drawdown:0});
    await getAccountCircuitStatus(1);
    await vi.waitFor(()=>expect(mutationJournal).toHaveBeenCalledTimes(1));
    expect(replay(mutationJournal.mock.calls[0][0],Date.now(),Date.now()+100)).toMatchObject({status:'evaluated',matches_recorded:true});
    expect(mutationJournal.mock.calls[0]).toEqual([expect.objectContaining({kind:'max_drawdown_overwrite',
      applied_clock_source:'db_update_return',update:{max_drawdown:(38-30)/38*100}}),'account_circuit_mutation_applied']);
  });
  it('does not journal a failed drawdown write', async () => {
    mockFindAccount.mockResolvedValue({id:1,starting_balance:40,current_balance:30,equity:30,max_drawdown:0});
    mockUpdateAccount.mockRejectedValueOnce(new Error('write failed'));
    await expect(getAccountCircuitStatus(1)).rejects.toThrow('write failed');expect(mutationJournal).not.toHaveBeenCalled();
  });

  it('journals expectancy cooldown but preserves a longer existing cooldown', async () => {
    vi.stubEnv('CIRCUIT_EXPECTANCY_COOLDOWN_HOURS','1');
    mockFindAccount.mockResolvedValue({cooldown_until:null});
    await applyExpectancyKillCooldownIfNeeded(1,{allowed:false,reason:'Expectancy kill: test'} as any);
    await vi.waitFor(()=>expect(mutationJournal).toHaveBeenCalledTimes(1));
    expect(mutationJournal.mock.calls[0][0]).toMatchObject({kind:'expectancy_cooldown_overwrite',input:{cooldown_hours:1},applied_clock_source:'db_update_return'});
    expect(replay(mutationJournal.mock.calls[0][0],Date.now(),Date.now()+100)).toMatchObject({status:'evaluated',matches_recorded:true});
    vi.clearAllMocks();mockFindAccount.mockResolvedValue({cooldown_until:new Date(Date.now()+7200000)});
    await applyExpectancyKillCooldownIfNeeded(1,{allowed:false,reason:'Expectancy kill: test'} as any);
    expect(mockUpdateAccount).not.toHaveBeenCalled();expect(mutationJournal).not.toHaveBeenCalled();
  });

  it('keeps an invalid previous Date out of serialization failure and replay unknown',async()=>{
    vi.stubEnv('CIRCUIT_EXPECTANCY_COOLDOWN_HOURS','1');mockFindAccount.mockResolvedValue({cooldown_until:new Date('invalid')});
    await applyExpectancyKillCooldownIfNeeded(1,{allowed:false,reason:'Expectancy kill: test'} as any);
    await vi.waitFor(()=>expect(mutationJournal).toHaveBeenCalledTimes(1));
    expect(mockUpdateAccount).toHaveBeenCalledTimes(1);
    expect(replay(mutationJournal.mock.calls[0][0],Date.now(),Date.now()+100)).toMatchObject({status:'unknown',reason:'previous_cooldown_unknown'});
  });
  it('does not await pending circuit journal',async()=>{
    mutationJournal.mockImplementationOnce(()=>new Promise(()=>{}));
    vi.stubEnv('CIRCUIT_EXPECTANCY_COOLDOWN_HOURS','1');mockFindAccount.mockResolvedValue({cooldown_until:null});
    await applyExpectancyKillCooldownIfNeeded(1,{allowed:false,reason:'Expectancy kill: test'} as any);
    expect(mockUpdateAccount).toHaveBeenCalledTimes(1);
  });

});
