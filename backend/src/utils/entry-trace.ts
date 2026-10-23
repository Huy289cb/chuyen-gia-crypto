import {currentGuardInvocation} from './account-guard-invocation';
import type { SetupIdentity } from './setup-identity';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

export interface EntryTrace {
  trace_id: string;
  observation_key?: string;
  candidate_key?: string;
  setup_identity?: SetupIdentity;
  decision_id?: number;
  lane: string;
  policy_hash: string;
  code_hash?: string;
  evaluated_at: string;
  candle_cutoff?: number;
}
const context = new AsyncLocalStorage<EntryTrace>();
let fingerprint: string | undefined;
/** Hash the actual source/build tree once per process, without exposing its contents. */
function codeFingerprint(): string {
  if (fingerprint) return fingerprint;
  const root = resolve(__dirname, '..'), files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, {withFileTypes:true})) {
      const p=resolve(dir,e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|ts)$/.test(e.name) && !e.name.endsWith('.d.ts')) files.push(p);
    }
  };
  try {
    walk(root); const hash=createHash('sha256');
    for (const p of files.sort()) hash.update(relative(root,p)).update('\0').update(readFileSync(p)).update('\0');
    fingerprint=hash.digest('hex');
  } catch { fingerprint='unavailable'; }
  return fingerprint;
}
export const currentEntryTrace = () => context.getStore();
export const withEntryTrace = <T>(trace: EntryTrace, fn: () => T): T => context.run(trace, fn);
export function createEntryTrace(input: Omit<EntryTrace, 'trace_id' | 'policy_hash' | 'evaluated_at'>, policy: unknown): EntryTrace {
  const env = Object.fromEntries(Object.keys(process.env).filter(k =>
    /^(V3_|ADAPTIVE_|TRANSITION_RETEST_|RANGE_SWEEP_|POST_|PENDING_ORDER_REENTRY_|CLOSED_CANDLE_)/.test(k)).sort().map(k => [k,process.env[k]]));
  return { ...input, trace_id: randomUUID(), evaluated_at: new Date().toISOString(),
    code_hash: codeFingerprint(), policy_hash: createHash('sha256').update(JSON.stringify({policy,env})).digest('hex') };
}
/** Explicit fields win; no prompts, credentials or provider responses enter this context. */
export function tracedEvent(data: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...currentEntryTrace(), ...currentGuardInvocation(), ...data };
}
export async function recordEntryStage(stage: string, data: Record<string, unknown> = {}): Promise<void> {
  if (!currentEntryTrace()) return;
  try {
    const { recordSilentPipelineEvent } = await import('../repositories/testnet.repository');
    const id = await recordSilentPipelineEvent('entry_trace', tracedEvent({ stage, ...data }));
    if (id === null) console.warn('[EntryTrace] persistence unavailable');
  } catch { console.warn('[EntryTrace] persistence unavailable'); }
}
