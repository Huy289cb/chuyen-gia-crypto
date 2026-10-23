import * as path from 'path';
import { runMacroFixedBase } from './compare-final-solutions';

const csvPath = path.resolve(__dirname, '../tests/fixtures/cct-source-projection/daily-source.csv');

console.log('Testing calibrated allocations and stop losses...');
for (const alloc of [30, 35, 40]) {
  for (const sl of [0.04, 0.05, 0.06]) {
    for (const reb of [3, 5, 7]) {
      const res = runMacroFixedBase(csvPath, 100, reb, sl, alloc);
      console.log(
        `Alloc: $${alloc}x2 ($${alloc * 2}), SL: ${(sl * 100).toFixed(0)}%, Reb: ${reb}d => ` +
        `Net: +${res.netProfit.toFixed(1)}u | Daily: +${res.meanDailyPnl.toFixed(3)}u/d (+${res.meanDailyRoiPct.toFixed(3)}%/d) | ` +
        `WorstDay: ${res.worstDayPnl.toFixed(2)}u | Breakers: ${res.breakerDaysCount} | ` +
        `Target: ${res.meetsTarget ? 'PASS' : 'FAIL'} | Risk: ${res.respectsRiskCap ? 'PASS' : 'FAIL'}`
      );
    }
  }
}
