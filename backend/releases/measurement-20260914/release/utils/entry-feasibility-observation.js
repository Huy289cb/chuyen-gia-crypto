"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.observeEntryFeasibility = observeEntryFeasibility;
const closed_candles_1 = require("./closed-candles");
const structure_bias_1 = require("./structure-bias");
const plan_feasibility_1 = require("./plan-feasibility");
/** A fixed diagnostic rule, not an entry strategy or a runtime guard. No future pivots. */
function observeEntryFeasibility(input) {
    const base = { version: 'entry-feasibility-v1', role: 'diagnostic_only', asOf: input.asOf,
        minSlFraction: input.minSlFraction, minRr: input.minRr, structureStrength: 2,
        structureTimeframe: input.structureTimeframe ?? '4h',
        entrySource: input.entry === undefined ? 'closed_bar_proxy' : 'confirmed_retest' };
    if (!input.side)
        return { ...base, status: 'no_setup', geometry: null };
    const rows = (0, closed_candles_1.closedCandlesOnly)(input.candles, input.timeframe, input.asOf);
    const h4 = (0, closed_candles_1.closedCandlesOnly)(input.structureCandles, input.structureTimeframe ?? '4h', input.asOf);
    const durations = { '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000 };
    const complete = (bars, tf) => {
        const step = durations[tf];
        return !!step && bars.every((b, i) => i === 0 || b.timestamp - bars[i - 1].timestamp === step) &&
            !!bars.length && input.asOf - (bars.at(-1).timestamp + step) <= step + 120000;
    };
    if (!complete(rows, input.timeframe) || !complete(h4, input.structureTimeframe ?? '4h') || rows.length < 6 || h4.length < 5 || [...rows, ...h4].some(b => ![b.close, b.high, b.low].every(x => Number.isFinite(x) && x > 0) || b.low > b.close || b.close > b.high))
        return { ...base, status: 'missing_data', geometry: null };
    const entry = input.entry ?? rows.at(-1).close;
    const side = input.side, dir = side === 'long' ? 1 : -1;
    const invalidation = side === 'long' ? Math.min(...rows.slice(-6).map(b => b.low)) : Math.max(...rows.slice(-6).map(b => b.high));
    const rawStop = side === 'long' ? Math.min(invalidation - entry * .0001, entry * (1 - input.minSlFraction))
        : Math.max(invalidation + entry * .0001, entry * (1 + input.minSlFraction));
    const stopLoss = (side === 'long' ? Math.floor(rawStop * 10) : Math.ceil(rawStop * 10)) / 10;
    const swings = (0, structure_bias_1.findStructureSwings)(h4, 2);
    const targets = swings.filter(s => s.kind === (side === 'long' ? 'high' : 'low') && dir * (s.price - entry) > 0);
    const target = targets.sort((a, b) => dir * (a.price - b.price))[0];
    const bias = (0, structure_bias_1.classifyStructureBias)(h4, { strength: 2 });
    const lastSupport = swings.filter(s => s.kind === (bias.bias === 'bull' ? 'low' : 'high')).at(-1);
    // This measures a stale pivot bias; it does not grant permission for the opposite side.
    const brokenAt = bias.bias !== 'transition' && lastSupport ? h4.slice(lastSupport.index + 3)
        .find(b => bias.bias === 'bull' ? b.close < lastSupport.price : b.close > lastSupport.price)?.timestamp : undefined;
    const geometry = (0, plan_feasibility_1.measurePlanGeometry)({ side, entry, stopLoss, targetBound: target?.price,
        minSlFraction: input.minSlFraction, minRr: input.minRr });
    return { ...base, status: geometry.feasible ? 'geometry_feasible' : geometry.blockers[0],
        sourceCutoff: rows.at(-1).timestamp, structureCutoff: h4.at(-1).timestamp,
        entry, stopLoss, invalidation, targetBound: target?.price ?? null, geometry,
        structure: { bias: bias.bias, pivotAt: lastSupport ? h4[lastSupport.index].timestamp : null,
            confirmationBarAt: lastSupport ? h4[lastSupport.index + 2].timestamp : null,
            invalidationBarAt: brokenAt ?? null, staleBias: brokenAt !== undefined }, };
}
