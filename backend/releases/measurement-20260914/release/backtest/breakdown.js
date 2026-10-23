"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildBreakdown = buildBreakdown;
exports.utcDayKey = utcDayKey;
exports.utcWeekKey = utcWeekKey;
exports.buildAllBreakdowns = buildAllBreakdowns;
exports.formatBreakdownSection = formatBreakdownSection;
function rowFromTrades(key, trades) {
    const wins = trades.filter((t) => t.pnlUsd > 0).length;
    const losses = trades.filter((t) => t.pnlUsd < 0).length;
    const netPnl = trades.reduce((s, t) => s + t.pnlUsd, 0);
    return {
        key,
        n: trades.length,
        wins,
        losses,
        netPnl,
        winRate: trades.length ? wins / trades.length : 0,
    };
}
function buildBreakdown(trades, dim) {
    const groups = new Map();
    for (const t of trades) {
        const k = dim(t);
        const list = groups.get(k) ?? [];
        list.push(t);
        groups.set(k, list);
    }
    return [...groups.entries()]
        .map(([key, list]) => rowFromTrades(key, list))
        .sort((a, b) => a.netPnl - b.netPnl);
}
function utcDayKey(ts) {
    return new Date(ts).toISOString().slice(0, 10);
}
function utcWeekKey(ts) {
    const d = new Date(ts);
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
function buildAllBreakdowns(trades) {
    return {
        byTimeframe: buildBreakdown(trades, (t) => t.timeframe),
        byPlaybook: buildBreakdown(trades, (t) => t.playbookKey ?? 'unknown'),
        byGrade: buildBreakdown(trades, (t) => t.grade),
        bySide: buildBreakdown(trades, (t) => t.side),
        byDay: buildBreakdown(trades, (t) => utcDayKey(t.entryTime)),
        byWeek: buildBreakdown(trades, (t) => utcWeekKey(t.entryTime)),
    };
}
function formatBreakdownSection(title, rows) {
    if (rows.length === 0)
        return [`${title}: (none)`];
    return [
        title + ':',
        ...rows.map((r) => `  ${r.key}: n=${r.n} W/L=${r.wins}/${r.losses} WR=${(r.winRate * 100).toFixed(1)}% net=$${r.netPnl.toFixed(2)}`),
    ];
}
//# sourceMappingURL=breakdown.js.map