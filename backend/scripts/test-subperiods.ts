import * as path from 'path';
import * as fs from 'fs';
import { runMacroFixedBase } from './compare-final-solutions';

const csvPath = path.resolve(__dirname, '../tests/fixtures/cct-source-projection/daily-source.csv');
const content = fs.readFileSync(csvPath, 'utf-8');
const lines = content.trim().split('\n');
const header = lines[0];
const dataLines = lines.slice(1);

const total = dataLines.length;
const mid = Math.floor(total / 2);

const part1Lines = [header, ...dataLines.slice(0, mid)];
const part2Lines = [header, ...dataLines.slice(mid)];

// Last 512 days
const part512Lines = [header, ...dataLines.slice(total - 512)];

const p1Path = path.resolve(__dirname, '../data/backtest-cache/daily_p1.csv');
const p2Path = path.resolve(__dirname, '../data/backtest-cache/daily_p2.csv');
const p512Path = path.resolve(__dirname, '../data/backtest-cache/daily_512.csv');

fs.writeFileSync(p1Path, part1Lines.join('\n'));
fs.writeFileSync(p2Path, part2Lines.join('\n'));
fs.writeFileSync(p512Path, part512Lines.join('\n'));

console.log('Testing out-of-sample sub-periods with Alloc: $35x2 ($70), SL: 5%, Reb: 3d...');

const resFull = runMacroFixedBase(csvPath, 100, 3, 0.05, 35);
console.log(`FULL (1485d) => Net: +${resFull.netProfit.toFixed(1)}u | Daily: +${resFull.meanDailyPnl.toFixed(3)}u/d (+${resFull.meanDailyRoiPct.toFixed(3)}%/d) | WorstDay: ${resFull.worstDayPnl.toFixed(2)}u | Breakers: ${resFull.breakerDaysCount}`);

const resP1 = runMacroFixedBase(p1Path, 100, 3, 0.05, 35);
console.log(`Period 1 (2022-2024, ${resP1.totalDays}d) => Net: +${resP1.netProfit.toFixed(1)}u | Daily: +${resP1.meanDailyPnl.toFixed(3)}u/d (+${resP1.meanDailyRoiPct.toFixed(3)}%/d) | WorstDay: ${resP1.worstDayPnl.toFixed(2)}u | Breakers: ${resP1.breakerDaysCount}`);

const resP2 = runMacroFixedBase(p2Path, 100, 3, 0.05, 35);
console.log(`Period 2 (2024-2026, ${resP2.totalDays}d) => Net: +${resP2.netProfit.toFixed(1)}u | Daily: +${resP2.meanDailyPnl.toFixed(3)}u/d (+${resP2.meanDailyRoiPct.toFixed(3)}%/d) | WorstDay: ${resP2.worstDayPnl.toFixed(2)}u | Breakers: ${resP2.breakerDaysCount}`);

const res512 = runMacroFixedBase(p512Path, 100, 3, 0.05, 35);
console.log(`Last 512 Days Window (${res512.totalDays}d) => Net: +${res512.netProfit.toFixed(1)}u | Daily: +${res512.meanDailyPnl.toFixed(3)}u/d (+${res512.meanDailyRoiPct.toFixed(3)}%/d) | WorstDay: ${res512.worstDayPnl.toFixed(2)}u | Breakers: ${res512.breakerDaysCount}`);
