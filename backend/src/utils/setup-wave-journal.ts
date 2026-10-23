import { associateStructuralRoot, type StructuralRoot } from './structural-root';
import { timeframeDurationMs } from './closed-candles';
import type { Prisma } from '@prisma/client';
import type { SetupIdentity } from './setup-identity';
import { associateSetupWave, type WaveAnchorEvidence } from './setup-wave';

/** Persist first-observed anchors. Unmatched anchors remain unknown, never independent roots. */
export async function journalSetupWave(tx: Prisma.TransactionClient, positionId: string,
  data: Record<string, unknown>, asOf: number): Promise<Record<string, unknown>> {
  data = await journalStructuralRoot(tx,positionId,data,asOf);
  const identity = data.setup_identity as SetupIdentity | undefined;
  if (!identity?.setup_id || !identity.anchor_evidence || identity.status !== 'known') return data;
  if (!Number.isFinite(asOf) || identity.detection_known_at === null || identity.detection_known_at > asOf ||
      identity.anchor_known_at === null || identity.anchor_known_at > asOf) throw new Error('future_setup_wave_evidence');
  const evidence = identity.anchor_evidence;
  const duration = timeframeDurationMs(evidence.timeframe);
  if (!/^[a-f0-9]{64}$/.test(identity.setup_id) || !duration ||
      !['long','short'].includes(evidence.side) || !evidence.symbol ||
      [evidence.high,evidence.low,evidence.high_open,evidence.low_open].some(n => !Number.isFinite(n) || n < 0) ||
      evidence.low <= 0 || evidence.high <= evidence.low ||
      Math.max(evidence.high_open,evidence.low_open)+duration > asOf) throw new Error('invalid_setup_wave_anchor');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${positionId}))`;
  const rows = await tx.testnetTradeEvent.findMany({where: {position_id: positionId,
    event_type: 'setup_anchor_first_observed', timestamp: {lte: new Date(asOf)}}, orderBy: {id: 'asc'}});
  const registry = rows.map(row => JSON.parse(row.event_data ?? 'null') as {
    anchor: WaveAnchorEvidence; association: ReturnType<typeof associateSetupWave>;
  });
  const prior = registry.find(row => row.anchor.setup_id === identity.setup_id);
  if (prior && Object.entries(evidence).some(([key,value]) =>
      prior.anchor[key as keyof WaveAnchorEvidence] !== value)) throw new Error('conflicting_setup_wave_anchor');
  let association = prior?.association;
  if (!prior) {
    const anchor: WaveAnchorEvidence = {...identity.anchor_evidence, setup_id: identity.setup_id, known_at: asOf};
    const matches = registry.map(row => associateSetupWave(row.anchor, anchor, asOf)).filter(link => link.status === 'linked');
    const uniqueWaves = new Set(matches.map(link => link.wave_id));
    association = matches.length && uniqueWaves.size === 1 ? matches[0] : {
      status: 'unknown', reason: matches.length ? 'ambiguous_parent_wave' : 'no_verified_parent',
      wave_id: null, parent_setup_id: null, child_setup_id: identity.setup_id, known_at: null,
    };
    await tx.testnetTradeEvent.create({data: {position_id: positionId, event_type: 'setup_anchor_first_observed',
      event_data: JSON.stringify({schema: 'setup-wave-registry-v1', anchor, association}), timestamp: new Date(asOf)}});
  }
  return {...data, setup_identity: {...identity, wave_id: association?.wave_id ?? null},
    wave_association: association};
}

/** Root events and the observation commit together; child ownership is first-observed. */
async function journalStructuralRoot(tx:Prisma.TransactionClient, positionId:string,
  data:Record<string,unknown>, asOf:number):Promise<Record<string,unknown>> {
  if(!('structural_root_candidate' in data))return data;
  if(!Number.isFinite(asOf))throw new Error('invalid_structural_root_clock');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${positionId}))`;
  const rows=await tx.testnetTradeEvent.findMany({where:{position_id:positionId,
    event_type:{in:['structural_root_observed','structural_root_expired','structural_root_child_observed']},
    },orderBy:{id:'asc'}});
  if(rows.some(row=>row.timestamp.getTime()>asOf))throw new Error('structural_root_clock_regression');
  let active:StructuralRoot|null=null;
  for(const row of rows){const event=JSON.parse(row.event_data??'null');
    if(row.event_type==='structural_root_observed')active=event.root;
    if(row.event_type==='structural_root_expired'&&active?.id===event.root_id)active=null;
  }
  const candidate=data.structural_root_candidate as StructuralRoot|null;
  const save=(event_type:string,event:unknown)=>tx.testnetTradeEvent.create({data:{position_id:positionId,event_type,
    event_data:JSON.stringify(event),timestamp:new Date(asOf)}});
  if(candidate){
    const probe={symbol:candidate.symbol,side:'long' as const,timeframe:'4h',high:candidate.high,low:candidate.low,
      high_open:candidate.highOpen,low_open:candidate.lowOpen,known_at:asOf,setup_id:candidate.id};
    const validation=associateStructuralRoot(candidate,probe,candidate.high,asOf);
    if(validation.status!=='linked'||candidate.expiredAt!==null)throw new Error('invalid_or_future_structural_root');
    if(active?.id===candidate.id){
      if(['high','low','highOpen','lowOpen','highConfirmedAt','lowConfirmedAt'].some(k=>active![k as keyof StructuralRoot]!==candidate[k as keyof StructuralRoot]))throw new Error('conflicting_structural_root');
    }else{
      if(rows.some(row=>row.event_type==='structural_root_expired'&&JSON.parse(row.event_data??'null').root_id===candidate.id))throw new Error('expired_structural_root_reuse');
      if(active)await save('structural_root_expired',{root_id:active.id,expired_at:asOf,reason:'confirmed_pivot_pair_superseded'});
      active={...candidate,observedAt:asOf};await save('structural_root_observed',{root:active});
    }
  }
  const identity=data.setup_identity as SetupIdentity|undefined;
  if(!identity?.setup_id||!identity.anchor_evidence)return {...data,structural_root_association:{status:'unknown',reason:'no_child_anchor',root_id:null,known_at:asOf}};
  const existing=rows.find(row=>row.event_type==='structural_root_child_observed'&&JSON.parse(row.event_data??'null').setup_id===identity.setup_id);
  if(existing)return {...data,structural_root_association:JSON.parse(existing.event_data!).association};
  const anchor={...identity.anchor_evidence,setup_id:identity.setup_id,known_at:asOf};
  const association=associateStructuralRoot(candidate?active:null,anchor,Number(data.structural_root_child_price),asOf);
  await save('structural_root_child_observed',{setup_id:identity.setup_id,anchor,association});
  return {...data,structural_root_association:association};
}
