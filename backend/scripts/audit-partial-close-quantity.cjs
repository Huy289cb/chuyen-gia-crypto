const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),output=process.argv[2];if(!output||fs.existsSync(output))throw Error('NEW_REPORT required');
const roundsPath=path.join(root,'dist/utils/exchange-rounds.js'),matchPath=path.join(root,'dist/utils/close-round-match.js');
const {reconstructExchangeRounds}=require(roundsPath),{selectCloseExchangeRound}=require(matchPath);
const cases=[];
for(const side of ['long','short']){const entry=side==='long'?'BUY':'SELL',exit=side==='long'?'SELL':'BUY';
 const fills=[{tradeId:1,orderId:100,side:entry,price:100,qty:1,commission:.1,commissionAsset:'USDT',realizedPnl:0,time:1000},{tradeId:2,orderId:200,side:exit,price:side==='long'?110:90,qty:.5,commission:.05,commissionAsset:'USDT',realizedPnl:5,time:2000},{tradeId:3,orderId:300,side:exit,price:side==='long'?120:80,qty:.5,commission:.05,commissionAsset:'USDT',realizedPnl:10,time:3000}];
 const rounds=reconstructExchangeRounds(fills,[]);assert.equal(rounds.length,1);assert.equal(rounds[0].quantity,1);
 const original=selectCloseExchangeRound(rounds,side,'100',1),remaining=selectCloseExchangeRound(rounds,side,'100',.5);
 assert(original);assert.equal(remaining,null);cases.push({side,original_qty:1,remaining_local_qty:.5,complete_round_qty:rounds[0].quantity,round_net_pnl:rounds[0].netPnl,original_quantity_match:true,remaining_quantity_match:false});
}
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
fs.writeFileSync(output,JSON.stringify({schema:'partial-close-quantity-blocker-v1',cases,deployed_module_hashes:{[roundsPath]:sha(roundsPath),[matchPath]:sha(matchPath)},synthetic_raw_fills:true,live_orders:0,production_incidence:'not_established',finding:'Complete exchange round uses original quantity; production selector rejects reduced remaining local quantity',economic_roi:null},null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({deployedCases:cases.length,remainingQuantityRejected:true}));
