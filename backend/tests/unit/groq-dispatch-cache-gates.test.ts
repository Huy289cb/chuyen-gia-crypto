import {getMethodConfig} from '../../src/config/methods';
import {reviewAndExecuteCausalPlan} from '../../src/services/causal-opportunity-workflow.service';
import {sealCausalPlan} from '../../src/utils/causal-plan-contract';
import * as causalEvidence from '../../src/utils/causal-plan-evidence';
import fs from 'node:fs';
import path from 'node:path';
import {SignalGateService} from '../../src/services/signal-gate.service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentProviderPurpose, withProviderPurpose } from '../../src/utils/provider-purpose-context';
import type { SignalGateOutput } from '../../src/services/signal-gate.service';
import { recordEntryStage } from '../../src/utils/entry-trace';
import { replayRecordedStructurePermission } from '../../src/utils/recorded-structure-permission';

const mocks = vi.hoisted(() => ({
  createGroqClient: vi.fn(),
  getCandles: vi.fn(),
  getScanResult: vi.fn(),
  memoryService: {
    findDecisionForBar: vi.fn(),
    buildContextForLLM: vi.fn(),
    formatContextForPrompt: vi.fn(),
    formatRecentReflectionsForPrompt: vi.fn(),
    storeDecision: vi.fn(),
  },
}));

vi.mock('../../src/services/groq-client', () => ({
  createGroqClient: mocks.createGroqClient,
}));
vi.mock('../../src/services/candle.service', () => ({
  getCandles: mocks.getCandles,
}));
vi.mock('../../src/schedulers/market-scan.scheduler', () => ({
  getScanResult: mocks.getScanResult,
}));
vi.mock('../../src/services/memory.service', () => ({
  memoryService: mocks.memoryService,
}));
vi.mock('../../src/utils/entry-trace', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/utils/entry-trace')>(),
  recordEntryStage: vi.fn(),
}));

import { GroqDispatchService } from '../../src/services/groq-dispatch.service';

function bullishBreakoutCandles() {
  const candles = Array.from({ length: 80 }, (_, index) => ({
    timestamp: Date.UTC(2026, 7, 14, 0, index * 15),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
  }));
  candles[candles.length - 1] = {
    ...candles[candles.length - 1],
    high: 111,
    close: 110,
    volume: 100,
  };
  return candles;
}

function bullishStructureCandles() {
  const out: ReturnType<typeof bullishBreakoutCandles> = [];
  let timestamp = Date.UTC(2026, 6, 1);
  const add = (high: number, low: number, close: number) => {
    out.push({ timestamp, open: close, high, low, close, volume: 10 });
    timestamp += 4 * 3_600_000;
  };
  const pad = (n: number, mid: number) => {
    for (let i = 0; i < n; i += 1) add(mid + 2, mid - 2, mid);
  };
  pad(4, 105);
  add(108, 90, 96);
  pad(4, 110);
  add(130, 118, 125);
  pad(4, 120);
  add(122, 105, 112);
  pad(4, 125);
  add(150, 135, 145);
  pad(4, 140);
  return out;
}

function passingSignal(): SignalGateOutput {
  return {
    pass: true,
    shouldCallGroq: true,
    isDuplicate: false,
    reason: 'pass',
    gateRegime: 'trend',
    setupResult: {
      playbookKey: 'breakout_volume',
      grade: 'A',
      confidence: 0.9,
      regime: 'trend',
      reason: 'bullish breakout',
      detailReason: 'bullish breakout',
      evidence: {
        regime: { trendDirection: 'bullish' },
      },
    },
  } as unknown as SignalGateOutput;
}

describe('GroqDispatch cached trade hard gates', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.V3_STRUCTURE_BIAS_ENABLED = 'true';
    process.env.V3_ALLOWED_REGIMES = 'trend';
    mocks.memoryService.findDecisionForBar.mockResolvedValue({
      id: 42,
      symbol: 'BTC',
      timeframe: '15m',
      playbook_key: 'breakout_volume',
      grade: 'A',
      confidence: 0.9,
      regime: 'trend',
      decision: 'trade',
      reason: 'LLM confirmed trade · LLM: buy · conf 90% · entry 100 · SL 99 · TP 103',
      entry_price: 100,
      stop_loss: 99,
      take_profit: 103,
      expected_rr: 3,
      timestamp: new Date(),
      candle_hash: 'hash',
      method_id: 'kim_nghia',
    });
    mocks.memoryService.buildContextForLLM.mockResolvedValue(undefined);
    mocks.memoryService.formatContextForPrompt.mockReturnValue('');
    mocks.memoryService.formatRecentReflectionsForPrompt.mockResolvedValue('');
    mocks.memoryService.storeDecision.mockResolvedValue(undefined);
    // No closed structure candles => transition => hard block.
    mocks.getCandles.mockResolvedValue({ candles: [], source: 'binance' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...envBackup };
  });

  it('isolates review-contract guards after evidence validation, without claiming candle or provider proof', async () => {
    // This test isolates the pre-existing review contract. Real candle validation
    // is exercised separately against the complete archived inventory.
    vi.spyOn(causalEvidence,'revalidateCausalPlan').mockReturnValue(null);
    process.env.V3_REQUIRE_HTF_TREND='1h';process.env.V3_HTF_TREND_ALT='false';process.env.V3_BREAKOUT_REGIME_BYPASS='false';
    mocks.getCandles.mockResolvedValue({candles:bullishStructureCandles(),source:'binance'});
    mocks.getScanResult.mockReturnValue({timestamp:new Date(),signalResult:passingSignal()});
    const now=Date.now();
    const causalPlan=sealCausalPlan({version:'h1-h2-review-v1',setupId:'contract-control',mechanism:'H1',symbol:'BTC',timeframe:'15m',side:'long',knownAt:now-1000,expiresAt:now+600000,entry:100,stop:99,target:102,invalidation:99.5,minRr:1.5});
    const analyze=vi.fn().mockResolvedValue({action:'buy',bias:'bullish',confidence:.9,suggested_entry:100,suggested_stop_loss:99,suggested_take_profit:103,invalidation_level:99.5,expected_rr:3});
    mocks.createGroqClient.mockReturnValue({analyze});
    const input={symbol:'BTC',timeframe:'15m',candles:bullishBreakoutCandles(),systemPrompt:'system',signalResult:passingSignal(),causalPlan};
    const result=await new GroqDispatchService().dispatch(input);
    expect(result).toMatchObject({decision:'no_trade',reason:'causal_plan_review_changed'});
    expect(mocks.memoryService.findDecisionForBar).not.toHaveBeenCalled();
    expect(analyze).toHaveBeenCalledOnce();
    expect(analyze.mock.calls[0][0].userPrompt).toContain('IMMUTABLE CAUSAL PLAN');
    expect(vi.mocked(recordEntryStage).mock.calls.some(c=>c[0]==='causal_plan_review_blocked')).toBe(true);
    // A real upstream veto still prevents the reviewer call, even with a sealed plan.
    analyze.mockClear();
    const blocked=await new GroqDispatchService().dispatch({...input,signalResult:{...passingSignal(),shouldCallGroq:false,reason:'fixture upstream veto'}});
    expect(blocked.reason).toContain('Signal gate blocked');expect(analyze).not.toHaveBeenCalled();
    process.env.CAUSAL_OPPORTUNITY_RESEARCH_ENABLED='false';
    expect(await reviewAndExecuteCausalPlan(input)).toMatchObject({reason:'causal_research_disabled'});
    process.env.CAUSAL_OPPORTUNITY_RESEARCH_ENABLED='true';process.env.MIN_RR_RATIO='3';
    expect(await reviewAndExecuteCausalPlan(input)).toMatchObject({reason:'causal_research_rr_policy_mismatch'});
    // Method RR is read at module startup, not dynamically from changed env.
    const auto=getMethodConfig('kim_nghia').autoEntry, prior=auto.minRRRatio;
    try {
      auto.minRRRatio=1.5;
      const workflow=await reviewAndExecuteCausalPlan({...input,signalResult:{...passingSignal(),shouldCallGroq:false,reason:'workflow upstream veto'}});
      expect(workflow.reason).toContain('Signal gate blocked');expect(workflow).not.toHaveProperty('execution');expect(analyze).not.toHaveBeenCalled();
    } finally {auto.minRRRatio=prior;}
  });

  it('rejects a sealed plan without candle evidence before cache, provider or execution', async () => {
    const now=Date.now();
    const causalPlan=sealCausalPlan({version:'h1-h2-review-v1',setupId:'unsupported',mechanism:'H1',symbol:'BTC',timeframe:'15m',side:'long',knownAt:now-1000,expiresAt:now+600000,entry:100,stop:99,target:102,invalidation:99.5,minRr:1.5});
    const result=await new GroqDispatchService().dispatch({symbol:'BTC',timeframe:'15m',candles:bullishBreakoutCandles(),systemPrompt:'system',signalResult:passingSignal(),causalPlan});
    expect(result).toMatchObject({decision:'no_trade',reason:'causal_evidence_missing_or_clock_mismatch'});
    expect(mocks.createGroqClient).not.toHaveBeenCalled();
    expect(mocks.memoryService.findDecisionForBar).not.toHaveBeenCalled();
  });

  it('revalidates an actual archived H1 plan, then preserves its measured legacy gate rejection', async () => {
    const {row,evidence}=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../docs/audits/2026-10-07-causal-evidence/workflow-input.json'),'utf8'));
    vi.spyOn(Date,'now').mockReturnValue(evidence.at);
    const c=row.candidate,p=row.plan;
    const causalPlan=sealCausalPlan({version:'h1-h2-review-v1',setupId:c.id,mechanism:'H1',symbol:'BTC',timeframe:'15m',side:c.side,knownAt:c.knownAt,expiresAt:c.expiresAt,entry:p.entry,stop:c.side==='long'?Math.floor(p.stop*10)/10:Math.ceil(p.stop*10)/10,target:p.target,invalidation:p.invalidation,minRr:1.5});
    expect(causalEvidence.revalidateCausalPlan(causalPlan,evidence,evidence.at)).toBeNull();
    const candles=evidence.bars.fifteen;
    const signalResult=await new SignalGateService({minGrade:'B',minConfidence:.70,enableDuplicateFilter:false}).evaluate({symbol:'BTC',timeframe:'15m',candles});
    expect(signalResult.setupResult.grade).toBe('D');
    const result=await new GroqDispatchService().dispatch({symbol:'BTC',timeframe:'15m',candles,systemPrompt:'unused: upstream veto',causalPlan,causalEvidence:evidence,signalResult});
    expect(result.reason).toContain('Signal gate blocked');
    expect(mocks.createGroqClient).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('execution');
  });

  it('ignores an injected legacy passing grade when the registered causal rubric is active', async () => {
    const {row,evidence}=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../docs/audits/2026-10-07-causal-evidence/workflow-input.json'),'utf8'));
    vi.spyOn(Date,'now').mockReturnValue(evidence.at);
    process.env.CAUSAL_OPPORTUNITY_RESEARCH_ENABLED='true';
    process.env.CAUSAL_SETUP_SCORING_VERSION='rejection-volume-v1';
    const c=row.candidate,p=row.plan;
    const causalPlan=sealCausalPlan({version:'h1-h2-review-v1',setupId:c.id,mechanism:'H1',symbol:'BTC',timeframe:'15m',side:c.side,knownAt:c.knownAt,expiresAt:c.expiresAt,entry:p.entry,stop:c.side==='long'?Math.floor(p.stop*10)/10:Math.ceil(p.stop*10)/10,target:p.target,invalidation:p.invalidation,minRr:1.5});
    const result=await new GroqDispatchService().dispatch({symbol:'BTC',timeframe:'15m',candles:evidence.bars.fifteen,systemPrompt:'unused: measured veto',causalPlan,causalEvidence:evidence,signalResult:passingSignal()});
    expect(result.reason).toContain('Signal gate blocked');
    expect(result.reason).toContain('rejection-volume-v1');
    expect(mocks.createGroqClient).not.toHaveBeenCalled();
  });

  it('revokes a candle-supported existing range permission when the actual HTF changes after review', async () => {
    // Provider output is mocked only to exercise the revocation boundary; this
    // unit control is not an approved reviewer or an economic observation.
    const {row,evidence}=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../docs/audits/2026-10-07-h2-permission-boundary/workflow-input.json'),'utf8'));
    const policy=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../docs/audits/2026-10-04-continuous-causal-portfolio/policy.json'),'utf8'));
    Object.assign(process.env,policy.environment,{CAUSAL_OPPORTUNITY_RESEARCH_ENABLED:'true',CAUSAL_SETUP_SCORING_VERSION:'rejection-volume-v1',CAUSAL_PERMISSION_VERSION:'existing-long-range-v1'});
    vi.spyOn(Date,'now').mockReturnValue(evidence.at);
    mocks.getScanResult.mockReturnValue({timestamp:new Date(evidence.at),signalResult:{...passingSignal(),gateRegime:'range',setupResult:{...passingSignal().setupResult,regime:'range'}}});
    mocks.getCandles.mockResolvedValue({candles:evidence.bars.fourHour,source:'binance'});
    const c=row.candidate,p=row.plan;
    const causalPlan=sealCausalPlan({version:'h1-h2-review-v1',setupId:c.id,mechanism:'H2',symbol:'BTC',timeframe:'5m',side:c.side,knownAt:c.knownAt,expiresAt:c.expiresAt,entry:p.entry,stop:Math.floor(p.stop*10)/10,target:p.target,invalidation:p.invalidation,minRr:1.5});
    const analyze=vi.fn().mockImplementation(async()=>{
      mocks.getScanResult.mockReturnValue({timestamp:new Date(evidence.at),signalResult:passingSignal()});
      return {action:'buy',bias:'bullish',confidence:.9,suggested_entry:causalPlan.entry,suggested_stop_loss:causalPlan.stop,suggested_take_profit:causalPlan.target,invalidation_level:causalPlan.invalidation,expected_rr:p.rr};
    });
    mocks.createGroqClient.mockReturnValue({analyze});
    const result=await new GroqDispatchService({enableMemory:false,maxRetries:0}).dispatch({symbol:'BTC',timeframe:'5m',candles:evidence.bars.five,causalPlan,causalEvidence:evidence,systemPrompt:'boundary control only'});
    expect(analyze).toHaveBeenCalledOnce();
    expect(result.decision).toBe('no_trade');
    expect(result.reason).toContain('requires fresh 1h range');
    expect(vi.mocked(recordEntryStage).mock.calls.some(c=>c[0]==='causal_existing_range_revalidated')).toBe(true);
  });

  it('blocks an immutable HTF failure before AI and allows a fresh scan to recover on the same bar', async () => {
    mocks.memoryService.findDecisionForBar.mockResolvedValue(null);
    process.env.V3_REQUIRE_HTF_TREND='1h';process.env.V3_HTF_TREND_ALT='false';process.env.V3_BREAKOUT_REGIME_BYPASS='false';
    mocks.getCandles.mockResolvedValue({candles:bullishStructureCandles(),source:'binance'});
    const analyze=vi.fn().mockResolvedValue({action:'hold',bias:'neutral',confidence:.8,reason_summary:'wait'});
    mocks.createGroqClient.mockReturnValue({analyze});
    const scan=(regime:string)=>({timestamp:new Date(),signalResult:{...passingSignal(),gateRegime:regime}});
    mocks.getScanResult.mockReturnValue(scan('range'));
    const service=new GroqDispatchService();
    const input={symbol:'BTC',timeframe:'15m',candles:bullishBreakoutCandles(),systemPrompt:'system',signalResult:passingSignal()};
    const blocked=await service.dispatch(input);
    expect(blocked.reason).toContain('Pre-LLM: HTF 1h regime range');expect(analyze).not.toHaveBeenCalled();
    expect(mocks.memoryService.buildContextForLLM).not.toHaveBeenCalled();expect(mocks.memoryService.storeDecision).not.toHaveBeenCalled();
    mocks.getScanResult.mockReturnValue(scan('trend'));
    const allowed=await service.dispatch(input);
    expect(analyze).toHaveBeenCalledOnce();expect(allowed.reason).toContain('LLM veto');
  });

  it('skips the provider when the existing grade filter already rejects the setup', async () => {
    mocks.memoryService.findDecisionForBar.mockResolvedValue(null);
    process.env.MIN_SIGNAL_GRADE='A';process.env.V3_REQUIRE_HTF_TREND='false';
    const signal=passingSignal();signal.setupResult.grade='B';
    const analyze=vi.fn();mocks.createGroqClient.mockReturnValue({analyze});
    const result=await new GroqDispatchService().dispatch({symbol:'BTC',timeframe:'15m',candles:bullishBreakoutCandles(),systemPrompt:'system',signalResult:signal});
    expect(result.decision).toBe('no_trade');expect(result.reason).toContain('Pre-LLM:');
    expect(analyze).not.toHaveBeenCalled();expect(mocks.getCandles).not.toHaveBeenCalled();
  });

  it('revalidates a cached trade through structure instead of returning it', async () => {
    const service = new GroqDispatchService();
    const result = await service.dispatch({
      symbol: 'BTC',
      timeframe: '15m',
      candles: bullishBreakoutCandles(),
      systemPrompt: 'system',
      signalResult: passingSignal(),
    });

    expect(result.decision).toBe('no_trade');
    expect(result.reason).toContain('structure transition');
    const journal=vi.mocked(recordEntryStage).mock.calls.find(call=>call[0]==='structure_permission_evaluated');
    expect(journal).toBeDefined();
    expect(replayRecordedStructurePermission(journal![1]!.structure_permission,Date.now(),Date.now())).toMatchObject({status:'evaluated',matches_recorded:true});
    expect(mocks.getCandles).toHaveBeenCalledOnce();
    expect(mocks.createGroqClient).not.toHaveBeenCalled();
  });

  it('uses immutable breakout side on a later retest bar and still lets the LLM veto', async () => {
    mocks.memoryService.findDecisionForBar.mockResolvedValue(null);
    mocks.getCandles.mockResolvedValue({ candles: bullishStructureCandles(), source: 'binance' });
    const analyze = vi.fn().mockResolvedValue({
      bias: 'neutral',
      action: 'hold',
      confidence: 0.82,
      reason_summary: 'continuation quality is weak',
    });
    mocks.createGroqClient.mockReturnValue({ analyze });
    // This bar is a quiet retest, not a fresh breakout. Without retestContext,
    // inferSetupTradeSide would return null and fail closed before the LLM.
    const retestCandles = bullishBreakoutCandles().map((row, index, all) =>
      index === all.length - 1
        ? { ...row, open: 100.2, high: 100.6, low: 99.9, close: 100.1, volume: 8 }
        : row
    );

    const service = new GroqDispatchService();
    const result = await service.dispatch({
      symbol: 'BTC',
      timeframe: '15m',
      candles: retestCandles,
      systemPrompt: 'system',
      signalResult: passingSignal(),
      retestContext: {
        candidateKey: 'BTC:15m:long:bar:v2:1',
        candidateKind: 'trend',
        side: 'long',
        boundaryPrice: 100,
        breakoutBarKey: 'bar:v2:1',
        confirmedEntryPrice: 100.1,
        minRr: 3,
      },
    });

    expect(analyze).toHaveBeenCalledOnce();
    expect(result.decision).toBe('no_trade');
    expect(result.reason).toContain('LLM veto');
  });

  it('uses the dedicated range-retest policy instead of contradictory trend gates', async () => {
    mocks.memoryService.findDecisionForBar.mockResolvedValue({
      id: 43, decision: 'no_trade', reason: 'Trend requires RR3',
    });
    mocks.getCandles.mockResolvedValue({ candles: bullishStructureCandles(), source: 'binance' });
    mocks.getScanResult.mockReturnValue({
      timestamp: new Date(),
      signalResult: {
        ...passingSignal(),
        gateRegime: 'range',
        setupResult: {
          ...passingSignal().setupResult,
          regime: 'range',
          evidence: { regime: { trendDirection: null } },
        },
      },
    });
    const analyze = vi.fn().mockResolvedValue({
      bias: 'neutral',
      action: 'hold',
      confidence: 0.82,
      reason_summary: 'range continuation is weak',
    });
    mocks.createGroqClient.mockReturnValue({ analyze });
    const rangeSignal = passingSignal();
    rangeSignal.gateRegime = 'range';
    rangeSignal.setupResult = {
      ...rangeSignal.setupResult,
      playbookKey: 'liquidity_sweep_reclaim',
      regime: 'range',
      evidence: {
        ...rangeSignal.setupResult.evidence,
        regime: {
          ...rangeSignal.setupResult.evidence.regime,
          regime: 'range',
          trendDirection: null,
        },
      },
    };

    const service = new GroqDispatchService();
    const result = await service.dispatch({
      symbol: 'BTC',
      timeframe: '5m',
      candles: bullishBreakoutCandles(),
      systemPrompt: 'system',
      signalResult: rangeSignal,
      retestContext: {
        candidateKey: 'BTC:5m:long:range:1',
        candidateKind: 'range_sweep_reclaim',
        side: 'long',
        boundaryPrice: 100,
        breakoutBarKey: 'bar:v2:1',
        confirmedEntryPrice: 100.1,
        minRr: 1.5,
      },
    });

    expect(analyze).toHaveBeenCalledOnce();
    expect(mocks.memoryService.findDecisionForBar).not.toHaveBeenCalled();
    const request = analyze.mock.calls[0][0];
    expect(request.systemPrompt).toContain('required RR is 1.5');
    expect(request.systemPrompt).toContain('replaces the general trend RR rule');
    expect(request.systemPrompt).toContain('HOLD remains a valid veto');
    expect(request.userPrompt).toContain('RANGE SWEEP / RECLAIM / RETEST');
    expect(request.userPrompt).toContain('entry=100.1');
    expect(request.userPrompt).toContain('RR=1.5');
    expect(request.userPrompt).not.toContain('STATEFUL BREAKOUT RETEST');
    expect(result.decision).toBe('no_trade');
    expect(result.reason).toContain('LLM veto');
  });
});


describe('primary dispatch provider purpose', () => {
  afterEach(() => { vi.clearAllMocks(); });
  it('labels the actual provider call and restores its parent after validation', async () => {
    const raw = { action: 'hold', bias: 'neutral', confidence: 0.8, reason_summary: 'wait' };
    const analyze = vi.fn(async () => {
      expect(currentProviderPurpose()).toBe('dispatch');
      return raw;
    });
    mocks.createGroqClient.mockReturnValue({ analyze });
    const service = new GroqDispatchService({ maxRetries: 0 });
    await withProviderPurpose('pending_review', async () => {
      const result = await (service as any).callGroqWithValidation('system', 'user', { symbol: 'BTC', timeframe: '15m' });
      expect(result).toMatchObject(raw);
      expect(currentProviderPurpose()).toBe('pending_review');
    });
    expect(analyze).toHaveBeenCalledExactlyOnceWith({ systemPrompt: 'system', userPrompt: 'user', temperature: 0.2, maxRetries: 0 });
    expect(currentProviderPurpose()).toBeNull();
  });
  it('requests the existing JSON schema only for an explicitly enabled causal review', async () => {
    const previous=process.env.CAUSAL_REVIEW_RESPONSE_FORMAT;
    process.env.CAUSAL_REVIEW_RESPONSE_FORMAT='json_schema';
    const analyze=vi.fn().mockResolvedValue({action:'hold',bias:'neutral',confidence:.8});
    mocks.createGroqClient.mockReturnValue({analyze});
    try {
      const service=new GroqDispatchService({maxRetries:0});
      await (service as any).callGroqWithValidation('system','user',{symbol:'BTC',timeframe:'5m',causalPlan:{hash:'boundary-fixture'}});
      expect(analyze.mock.calls[0][0].responseFormat).toBe('json_schema');
      await (service as any).callGroqWithValidation('system','user',{symbol:'BTC',timeframe:'5m'});
      expect(analyze.mock.calls[1][0]).not.toHaveProperty('responseFormat');
    } finally {
      if(previous===undefined)delete process.env.CAUSAL_REVIEW_RESPONSE_FORMAT;else process.env.CAUSAL_REVIEW_RESPONSE_FORMAT=previous;
    }
  });
  it('restores the parent on network failure and retains the no-trade outcome', async () => {
    const analyze = vi.fn(async () => {
      expect(currentProviderPurpose()).toBe('dispatch');
      throw new Error('fixture network failure');
    });
    mocks.createGroqClient.mockReturnValue({ analyze });
    await withProviderPurpose('shadow', async () => {
      const result = await (new GroqDispatchService({ maxRetries: 0 }) as any).callGroqWithValidation('system', 'user', { symbol: 'BTC', timeframe: '15m' });
      expect(result).toBeNull();
      expect(currentProviderPurpose()).toBe('shadow');
    });
    expect(analyze).toHaveBeenCalledOnce();
    expect(currentProviderPurpose()).toBeNull();
  });
  it('skips the provider when no client exists', async () => {
    mocks.createGroqClient.mockReturnValue(null);
    expect(await (new GroqDispatchService({ maxRetries: 0 }) as any).callGroqWithValidation('system', 'user', { symbol: 'BTC', timeframe: '15m' })).toBeNull();
    expect(currentProviderPurpose()).toBeNull();
  });
});
