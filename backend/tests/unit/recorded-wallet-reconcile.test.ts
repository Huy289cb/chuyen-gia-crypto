import {it,expect} from 'vitest';
import {buildWalletReconcileUpdate as build} from '../../src/utils/wallet-reconcile-update';
import {replayRecordedWalletReconcile as replay} from '../../src/utils/recorded-wallet-reconcile';
it('verifies writes and preserves missing-cost/cutoff uncertainty',()=>{
 const now=Date.parse('2026-10-02T13:40:00Z'),snapshot={walletBalance:30,equity:31,unrealizedPnl:1},positions=[{realized_pnl:-1,entry_fee:.1,exit_fee:.2,funding_fee:-.03}];
 const d=JSON.parse(JSON.stringify({schema:'wallet-reconcile-update-v1',account_id:1,input:{starting_balance:32,snapshot,positions},update:build(32,snapshot,positions,new Date(now-1)),applied_at:new Date(now).toISOString()}));
 expect(replay(d,now,now)).toMatchObject({status:'evaluated',matches_recorded:true,economic_total_pnl:null});
 expect(replay(d,now,now-1).status).toBe('unknown');
 const changed=structuredClone(d);changed.update.accumulated_funding_fee=.03;expect(replay(changed,now,now)).toMatchObject({status:'evaluated',matches_recorded:false});
 const missing=structuredClone(d);delete missing.input.positions[0].entry_fee;expect(replay(missing,now,now).status).toBe('unknown');
});
