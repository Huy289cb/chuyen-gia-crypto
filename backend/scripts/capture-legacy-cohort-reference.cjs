// Actual database reference only; READ ONLY transaction, no service/order imports.
require('dotenv').config();
const {PrismaClient}=require('@prisma/client');
const fs=require('node:fs');
const root='../docs/audits/2026-09-12-prospective-opportunity/';
const protocol=JSON.parse(fs.readFileSync(root+'protocol.json','utf8'));
const db=new PrismaClient({log:[]});
(async()=>{
 try{
  const extractedAt=new Date();
  const reference=await db.$transaction(async tx=>{
   await tx.$executeRaw`SET TRANSACTION READ ONLY`;
   const decisions=await tx.tradeDecision.findMany({where:{symbol:'BTC',timestamp:{gte:new Date(protocol.frozenAt),lte:extractedAt}},
    orderBy:{timestamp:'asc'},take:10001,select:{id:true,timeframe:true,playbook_key:true,decision:true,reason:true,entry_price:true,stop_loss:true,take_profit:true,timestamp:true,candle_hash:true,
     trade_outcome:{select:{realized_pnl:true,realized_rr:true,close_reason:true,timestamp:true}}}});
   const account=await tx.testnetAccount.findUnique({where:{symbol_method_id:{symbol:'BTC',method_id:'kim_nghia'}},
    select:{current_balance:true,equity:true,consecutive_losses:true,cooldown_until:true,last_trade_time:true}});
   return {decisions:decisions.slice(0,10000),truncated:decisions.length>10000,account};
  },{maxWait:5000,timeout:15000});
  const out={extractedAt,from:protocol.frozenAt,...reference,
   caveat:'Database rows extracted after earlier paper snapshots may be mutable. This is a timestamped legacy reference, not proof of exact as-of A decisions for every earlier snapshot.'};
  fs.writeFileSync(root+'legacy-reference-'+extractedAt.getTime()+'.json',JSON.stringify(out,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({extractedAt,decisions:reference.decisions.length,tradeDecisions:reference.decisions.filter(d=>d.decision==='trade').length,account:reference.account,truncated:reference.truncated}));
 }catch{console.error('legacy_reference_read_failed');process.exitCode=1;}finally{await db.$disconnect();}
})();
