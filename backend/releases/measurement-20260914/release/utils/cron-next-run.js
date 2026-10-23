"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateNextCronHint = estimateNextCronHint;
function expandCronField(field, min, max) {
    const values = new Set();
    for (const token of field.split(',')) {
        const part = token.trim();
        if (part === '*') {
            for (let value = min; value <= max; value += 1)
                values.add(value);
            continue;
        }
        const stepMatch = part.match(/^\*\/(\d+)$/);
        if (stepMatch) {
            const step = Number.parseInt(stepMatch[1], 10);
            if (!Number.isFinite(step) || step <= 0)
                return null;
            for (let value = min; value <= max; value += step)
                values.add(value);
            continue;
        }
        const value = Number.parseInt(part, 10);
        if (!/^\d+$/.test(part) || value < min || value > max)
            return null;
        values.add(value);
    }
    return values.size > 0 ? values : null;
}
/**
 * Human-readable next-fire hint for the minute/second cron forms used by the
 * worker. node-cron accepts both five-field and six-field expressions; in the
 * six-field form the first field is seconds, not minutes.
 */
function estimateNextCronHint(last, cronExpr, now = new Date()) {
    if (!last)
        return '—';
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5 && parts.length !== 6)
        return '—';
    const secondField = parts.length === 6 ? parts[0] : '0';
    const minuteField = parts.length === 6 ? parts[1] : parts[0];
    const seconds = expandCronField(secondField, 0, 59);
    const minutes = expandCronField(minuteField, 0, 59);
    if (!seconds || !minutes)
        return '—';
    const nowMs = now.getTime();
    const firstCandidateMs = Math.floor(nowMs / 1000) * 1000 + 1000;
    // The supported minute/second patterns always have a match within an hour.
    for (let offsetSeconds = 0; offsetSeconds <= 3600; offsetSeconds += 1) {
        const candidate = new Date(firstCandidateMs + offsetSeconds * 1000);
        if (minutes.has(candidate.getUTCMinutes()) && seconds.has(candidate.getUTCSeconds())) {
            const untilMs = candidate.getTime() - nowMs;
            const untilMin = Math.ceil(untilMs / 60_000);
            if (untilMin <= 1)
                return 'within 1 min';
            return `~${untilMin} min`;
        }
    }
    return '—';
}
//# sourceMappingURL=cron-next-run.js.map