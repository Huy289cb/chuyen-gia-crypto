import { createHash } from 'node:crypto';
import { closedCandlesOnly, timeframeDurationMs } from './closed-candles';

export interface SetupIdentity {
  schema: 'setup-anchor-identity-v1';
  status: 'known' | 'unknown';
  reason?: string;
  setup_id: string | null;
  // Cross-timeframe clustering requires an explicit parent registry; never infer from proximity.
  wave_id: string | null;
  anchor_evidence?: {
    symbol:string; side:'long'|'short'; timeframe:string;
    high:number; low:number; high_open:number; low_open:number;
  };
  anchor_known_at: number | null;
  detection_known_at: number | null;
}

/** Stable same-frame anchor identity. No clock/env defaults; no entry authorization. */
export function identifyAnchoredSetup(input: {
  symbol: string; timeframe: string; playbook: string; side: string | null;
  detected: boolean; metrics: Record<string, unknown>;
  asOf: number; graceMs: number;
}): SetupIdentity {
  const unknown = (reason: string): SetupIdentity => ({schema:'setup-anchor-identity-v1',
    status:'unknown', reason, setup_id:null, wave_id:null, anchor_known_at:null, detection_known_at:null});
  const expected = input.playbook === 'breakout_volume' ? 'breakout_volume_v1' :
    input.playbook === 'liquidity_sweep' ? 'liquidity_sweep_v1' : null;
  if (!expected || !input.detected || !['long', 'short'].includes(input.side ?? '')) return unknown('unsupported_or_no_directional_setup');
  const m=input.metrics;
  if (m.detectorVersion !== expected) return unknown('missing_detector_version');
  const times = [m.anchorHighOpenTime,m.anchorLowOpenTime,m.anchorWindowEndOpenTime,m.detectionOpenTime];
  if (times.some(t => typeof t !== 'number' || !Number.isFinite(t) || t < 0)) return unknown('missing_anchor_times');
  const [high,low,end,detection] = times as number[];
  if (high > end || low > end || end >= detection) return unknown('invalid_anchor_order');
  const bars = times.map(timestamp => ({ timestamp: timestamp as number }));
  if (closedCandlesOnly(bars,input.timeframe,input.asOf,input.graceMs).length !== 4) return unknown('unclosed_or_unknown_timeframe');
  // Both boundaries identify a range. Moving window endpoint and repeated detection are excluded.
  const setup_id = createHash('sha256').update(JSON.stringify([
    'setup-anchor-identity-v1',input.symbol.toUpperCase(),input.timeframe.toLowerCase(),
    expected,input.side,high,low,
  ])).digest('hex');
  const duration = timeframeDurationMs(input.timeframe);
  if (!duration) return unknown('unknown_timeframe');
  const highPrice = input.playbook === 'breakout_volume' ? m.resistance : m.priorHigh19;
  const lowPrice = input.playbook === 'breakout_volume' ? m.support : m.priorLow19;
  const anchor_evidence = typeof highPrice === 'number' && typeof lowPrice === 'number' &&
    Number.isFinite(highPrice) && Number.isFinite(lowPrice) && highPrice > lowPrice && lowPrice > 0 ? {
      symbol:input.symbol.toUpperCase(),side:input.side as 'long'|'short',timeframe:input.timeframe.toLowerCase(),
      high:highPrice,low:lowPrice,high_open:high,low_open:low,
    } : undefined;
  return {schema:'setup-anchor-identity-v1',status:'known',setup_id,wave_id:null,anchor_evidence,
    anchor_known_at:end+duration+input.graceMs,detection_known_at:detection+duration+input.graceMs};
}
