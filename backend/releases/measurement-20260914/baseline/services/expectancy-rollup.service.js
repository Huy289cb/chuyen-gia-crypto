"use strict";
/**
 * Expectancy rollup from trade_outcomes (realized_rr / realized_pnl).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.rollupExpectancyFromOutcomes = rollupExpectancyFromOutcomes;
exports.profitFactorLabel = profitFactorLabel;
function rollupExpectancyFromOutcomes(rows) {
    const n = rows.length;
    if (n === 0) {
        return {
            n: 0,
            wins: 0,
            losses: 0,
            breakeven: 0,
            sumR: 0,
            avgR: 0,
            profitFactor: null,
            sumPnl: 0,
            winRate: null,
        };
    }
    let wins = 0;
    let losses = 0;
    let breakeven = 0;
    let sumR = 0;
    let sumPnl = 0;
    let grossWin = 0;
    let grossLoss = 0;
    for (const row of rows) {
        const rr = Number(row.realized_rr) || 0;
        const pnl = Number(row.realized_pnl) || 0;
        sumR += rr;
        sumPnl += pnl;
        if (pnl > 0 || rr > 0) {
            wins++;
            if (pnl > 0)
                grossWin += pnl;
        }
        else if (pnl < 0 || rr < 0) {
            losses++;
            if (pnl < 0)
                grossLoss += Math.abs(pnl);
        }
        else {
            breakeven++;
        }
    }
    return {
        n,
        wins,
        losses,
        breakeven,
        sumR,
        avgR: sumR / n,
        profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
        sumPnl,
        winRate: n > 0 ? wins / n : null,
    };
}
/** Fix PF: when no losses but wins, PF is Infinity conceptually — expose null and flag via wins. */
function profitFactorLabel(pf, wins, losses) {
    if (losses === 0 && wins > 0)
        return 'inf';
    if (pf == null)
        return 'n/a';
    return pf.toFixed(2);
}
//# sourceMappingURL=expectancy-rollup.service.js.map