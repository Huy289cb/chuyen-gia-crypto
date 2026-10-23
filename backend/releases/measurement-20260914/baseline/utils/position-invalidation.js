"use strict";
/**
 * Pure position invalidation scoring (no I/O).
 * Thesis dead (score≥min) → exit. No BE tighten — entry is not market structure.
 * docs/position-invalidation-plan.md §5
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluatePositionInvalidation = evaluatePositionInvalidation;
function unrealizedPct(side, entry, mark) {
    if (side === 'long')
        return ((mark - entry) / entry) * 100;
    return ((entry - mark) / entry) * 100;
}
function gradeRank(g) {
    if (g === 'A')
        return 3;
    if (g === 'B')
        return 2;
    if (g === 'C')
        return 1;
    return 0;
}
function adverseSweep(side, snap) {
    if (!snap?.playbooks)
        return null;
    for (const pb of snap.playbooks) {
        if (pb.playbook !== 'liquidity_sweep' || !pb.detected || gradeRank(pb.grade) < 2)
            continue;
        const high = pb.metrics?.highSweep === true;
        const low = pb.metrics?.lowSweep === true;
        if (side === 'long' && high) {
            return {
                id: 'adverse_sweep',
                weight: 2,
                detail: `${snap.timeframe} high-sweep ${pb.grade}`,
            };
        }
        if (side === 'short' && low) {
            return {
                id: 'adverse_sweep',
                weight: 2,
                detail: `${snap.timeframe} low-sweep ${pb.grade}`,
            };
        }
    }
    return null;
}
function adverseBreakout(side, snap) {
    if (!snap?.playbooks)
        return null;
    for (const pb of snap.playbooks) {
        if (pb.playbook !== 'breakout_volume' || !pb.detected || gradeRank(pb.grade) < 2)
            continue;
        const summary = String(pb.summary ?? '');
        const bullish = summary.includes('Break up') || summary.toLowerCase().includes('bullish');
        const bearish = summary.includes('Break down') || summary.toLowerCase().includes('bearish');
        if (side === 'long' && bearish) {
            return { id: 'adverse_breakout', weight: 1, detail: `${snap.timeframe} bearish breakout ${pb.grade}` };
        }
        if (side === 'short' && bullish) {
            return { id: 'adverse_breakout', weight: 1, detail: `${snap.timeframe} bullish breakout ${pb.grade}` };
        }
    }
    return null;
}
function evaluatePositionInvalidation(input) {
    const { side, entry, mark, currentSl, ageMinutes, initialRisk, htf, ltf, minScore, minAgeMinutes, htfLostMinHours, allowExitWhenRed = false, } = input;
    const uPct = unrealizedPct(side, entry, mark);
    const hold = (reason, signals = [], score = 0) => ({
        action: 'hold',
        score,
        signals,
        reason,
        unrealizedPct: uPct,
    });
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(mark) || mark <= 0) {
        return hold('invalid prices');
    }
    if (ageMinutes < minAgeMinutes) {
        return hold(`age ${ageMinutes.toFixed(0)}m < min ${minAgeMinutes}m`);
    }
    const signals = [];
    if (htf?.regime === 'chop') {
        signals.push({ id: 'htf_chop', weight: 2, detail: `${htf.timeframe} chop` });
    }
    if (htf?.regime === 'trend' && htf.trendDirection) {
        const against = (side === 'long' && htf.trendDirection === 'bearish') ||
            (side === 'short' && htf.trendDirection === 'bullish');
        if (against) {
            signals.push({
                id: 'htf_trend_against',
                weight: 2,
                detail: `${htf.timeframe} trend ${htf.trendDirection}`,
            });
        }
    }
    if (htf && (htf.regime === 'range' || htf.regime === 'chop') && ageMinutes >= htfLostMinHours * 60) {
        const risk = initialRisk != null && initialRisk > 0 ? initialRisk : Math.abs(entry - currentSl);
        const halfRPct = risk > 0 ? ((0.5 * risk) / entry) * 100 : 0;
        if (uPct < halfRPct) {
            signals.push({
                id: 'htf_lost_trend',
                weight: 1,
                detail: `${htf.timeframe} ${htf.regime} after ${htfLostMinHours}h uPnL ${uPct.toFixed(2)}%<${halfRPct.toFixed(2)}%`,
            });
        }
    }
    const sweepHtf = adverseSweep(side, htf);
    const sweepLtf = adverseSweep(side, ltf);
    if (sweepHtf)
        signals.push(sweepHtf);
    else if (sweepLtf)
        signals.push(sweepLtf);
    const brkHtf = adverseBreakout(side, htf);
    const brkLtf = adverseBreakout(side, ltf);
    if (brkHtf)
        signals.push(brkHtf);
    else if (brkLtf)
        signals.push(brkLtf);
    // Deduplicate by id keeping max weight
    const byId = new Map();
    for (const s of signals) {
        const prev = byId.get(s.id);
        if (!prev || s.weight > prev.weight)
            byId.set(s.id, s);
    }
    const uniq = [...byId.values()];
    const score = uniq.reduce((a, s) => a + s.weight, 0);
    if (score < minScore) {
        return hold(score === 0 ? 'no invalidation signals' : `score ${score} < min ${minScore}`, uniq, score);
    }
    // Thesis broken → flatten. Do not BE (entry is not structure).
    if (allowExitWhenRed) {
        return {
            action: 'exit',
            score,
            signals: uniq,
            reason: `invalidation exit score ${score}: ${uniq.map((s) => s.id).join('+')} uPnL ${uPct.toFixed(2)}%`,
            unrealizedPct: uPct,
        };
    }
    return hold(`score ${score} but exit disabled — log only`, uniq, score);
}
//# sourceMappingURL=position-invalidation.js.map