import {describe,it,expect} from 'vitest';
import {opportunityFixture} from '../fixtures/ai-opportunity';
import {buildOpportunitySnapshot} from '../../src/utils/ai-opportunity';
import {OpportunityPortfolio} from '../../src/backtest/opportunity-portfolio';
import {evaluateOpportunityOutcome} from '../../src/backtest/opportunity-outcome';

describe('independent outcome versus chronological cash accounting',()=>{
 for(const side of ['long','short'] as const)for(const exit of ['target','gap_stop'] as const){
  it(`${side} ${exit}: reconciles signed funding, fees and slippage across engines`,()=>{
   const f=opportunityFixture();
   if(side==='short')for(const rows of Object.values(f.candles))for(const b of rows){const high=b.high;
    b.open=160000-b.open;b.close=160000-b.close;b.high=160000-b.low;b.low=160000-high;}
   const p=buildOpportunitySnapshot({...f,asOf:f.now})!.plans[0];
   expect(p.side).toBe(side);
   const t=f.now,dir=side==='long'?1:-1;
   const price=exit==='target'?p.takeProfit:p.stopLoss-dir*100;
   const open=exit==='target'?p.entry:price;
   const first={timestamp:t,open:p.entry,high:p.entry+1,low:p.entry-1,close:p.entry,volume:1};
   const second={timestamp:t+60000,open,high:Math.max(open,price)+1,low:Math.min(open,price)-1,close:price,volume:1};
   const funding=[{time:t,rate:.0001,markPrice:p.entry},{time:t+60000,rate:.0001,markPrice:p.entry}];
   const outcome=evaluateOpportunityOutcome(p,[first,second],{submittedAt:t,entryExpiresAt:t+180000,horizonAt:t+300000,
    barMs:60000,feePerSide:.0005,slippageFraction:.002,funding});
   expect(outcome.status).toBe('closed');expect(outcome.reason).toBe(exit);
   const ledger=new OpportunityPortfolio(100,f.policy,{maxDrawdownPercent:15,drawdownEnabled:true,
    expectancyEnabled:false,expectancyWindow:10,expectancyMinSumR:-3,maxExposurePercentOfEquity:null},.0005,.002);
   ledger.advance(t,p.entry);expect(ledger.reserve(p,.0001)).toBeNull();ledger.fill();
   ledger.fund(funding[0].rate,funding[0].markPrice);
   ledger.advance(t+60000,open);ledger.fund(funding[1].rate,funding[1].markPrice);
   ledger.advance(exit==='target'?t+120000:t+60000,price);
   const closed=ledger.close(price);
   expect(closed.netUsd).toBeCloseTo(outcome.netUsd!,10);
   expect(closed.feesUsd).toBeCloseTo(outcome.feesUsd!,10);
   expect(closed.slippageUsd).toBeCloseTo(outcome.slippageUsd!,10);
   expect(closed.fundingUsd).toBeCloseTo(dir*p.quantity*p.entry*.0001,10);
   expect(closed.fundingUsd).toBeCloseTo(outcome.fundingUsd!,10);
   expect(ledger.wallet-100).toBeCloseTo(outcome.netUsd!,10);
  });
 }
});
