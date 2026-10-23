const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');require('tsx/cjs');
const {evaluatePostQuantityAdmission}=require('../src/utils/post-quantity-admission.ts');
const [baseline,out]=process.argv.slice(2);if(!out)throw Error('Usage: BASELINE_JS NEW_REPORT');
const source=fs.readFileSync(baseline,'utf8');const start=source.indexOf('if (effectiveRiskUsd > effectiveRiskCapUsd + 1e-9)');const end=source.indexOf('const orderId =',start);if(start<0||end<0)throw Error('missing_baseline_anchors');
const body=source.slice(start,end);
const legacy=new Function('input',`const {side,entry,stopLoss,effectiveRiskUsd,effectiveRiskPercent,effectiveRiskCapUsd}=input;
const takeProfit=100; const computeExpectedRrFromPrices=()=>input.expectedRr;
const trade_levels_1={computeExpectedRrFromPrices},analysis={expected_rr:input.expectedRr,invalidation_level:input.invalidation};
const requiredMinRr=input.minRr,auto={minRRRatio:input.minRr},riskPolicy={circuitDailyLossEnabled:input.dailyEnabled},accountGuard={remainingDailyRiskUsd:input.remainingDailyRiskUsd};
${body} return {success:true};`);
let cases=0;for(const side of ['long','short'])for(const risk of [.5,1,2])for(const rr of [NaN,1,2,3])for(const invalidation of [NaN,97,99,101,103])for(const daily of [undefined,0,1,2]){
 const input={side,entry:100,stopLoss:side==='long'?98:102,effectiveRiskUsd:risk,effectiveRiskPercent:risk*3,effectiveRiskCapUsd:1,expectedRr:rr,minRr:2,invalidation,dailyEnabled:true,remainingDailyRiskUsd:daily};
 const d=evaluatePostQuantityAdmission(input);const current=d.allowed?{success:true}:{success:false,reason:d.reason,...(d.rejectionCode?{rejectionCode:d.rejectionCode}:{})};assert.deepStrictEqual(current,legacy(input));cases++;
}
fs.writeFileSync(out,JSON.stringify({cases,baselineSha256:crypto.createHash('sha256').update(source).digest('hex'),decisionParity:true,scope:'Extracted deployed post-quantity branch only; not full execution or ROI parity'},null,2),{flag:'wx'});console.log(JSON.stringify({cases,decisionParity:true}));
