require('dotenv').config();
const fs = require('fs');
const { prisma } = require('../dist-candidate/lib/prisma');
const { runClosedPositionPnlReconcile } = require('../dist-candidate/services/position-pnl-reconcile.service');
(async()=>{
  const preview=await runClosedPositionPnlReconcile({dryRun:true});
  if(preview.scanned !== 36 || preview.verified !== 36 || Math.abs(preview.results.reduce((s,r)=>s+(r.new_pnl ?? 0),0)+5.72285361)>1e-8) {
    throw new Error('Exchange accounting differs from the reviewed 36-round baseline; review before applying');
  }
  const applied=await runClosedPositionPnlReconcile({dryRun:false});
  const repeat=await runClosedPositionPnlReconcile({dryRun:false});
  const account=await prisma.testnetAccount.findFirst({where:{symbol:'BTC',method_id:'kim_nghia'},select:{current_balance:true,starting_balance:true,realized_pnl:true,total_trades:true,winning_trades:true,losing_trades:true,accumulated_trading_fees:true,accumulated_funding_fee:true}});
  const result={applied,repeat,account,appliedAt:new Date().toISOString()};
  fs.writeFileSync('../docs/deployments/2026-09-06-roi-fix/ledger-applied.json',JSON.stringify(result,null,2));
  if(repeat.updated!==0)throw new Error('Ledger reconcile is not idempotent');
  if(!account||Math.abs(account.current_balance-account.starting_balance-account.realized_pnl)>0.01)throw new Error('Wallet does not reconcile with corrected net PnL');
  console.log(JSON.stringify({applied:applied.updated,repeatedUpdates:repeat.updated,account}));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>prisma.$disconnect());
