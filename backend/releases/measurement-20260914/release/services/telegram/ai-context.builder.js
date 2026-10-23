"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBinanceExchangeEnv = getBinanceExchangeEnv;
exports.redactSensitiveText = redactSensitiveText;
exports.getWeeklyTradeStatsIct = getWeeklyTradeStatsIct;
exports.buildAiContext = buildAiContext;
exports.contextToJson = contextToJson;
exports.parseAiCommandArgs = parseAiCommandArgs;
exports.splitMessageForTelegram = splitMessageForTelegram;
const prisma_1 = require("../../lib/prisma");
const ict_time_1 = require("../../utils/ict-time");
const account_summary_service_1 = require("../account-summary.service");
const system_health_service_1 = require("../system-health.service");
const config_1 = require("../binance/config");
function getBinanceExchangeEnv() {
    const baseUrl = config_1.config.BASE_URL || 'https://demo-fapi.binance.com';
    const testnetFlag = process.env.BINANCE_TESTNET === 'true';
    const isTestnet = testnetFlag || baseUrl.includes('demo-fapi') || baseUrl.includes('testnet');
    const mode = isTestnet ? 'testnet' : 'mainnet';
    const markPriceSource = mode === 'testnet'
        ? 'Binance USD-M demo (demo-fapi.binance.com): positionRisk markPrice + latest_price từ fapi klines'
        : 'Binance USD-M mainnet (fapi.binance.com): positionRisk markPrice + latest_price từ fapi klines';
    const pricingNote = mode === 'testnet'
        ? 'Bot đang chạy Binance USD-M DEMO (testnet), KHÔNG phải mainnet. Giá mark/entry trên demo có thể lệch vài trăm–~1k USD so với Binance thật do thanh khoản mỏng, limit cũ khớp muộn, hoặc mark demo cập nhật chậm. /lenh và openPositions lấy giá trực tiếp từ demo-fapi — đó là giá futures bot đang trade, không phải Binance spot, CoinGecko hay mainnet.'
        : 'Bot đang chạy Binance USD-M mainnet. Mark price từ fapi positionRisk; latest_price từ fapi klines — không dùng Binance spot.';
    return { mode, baseUrl, markPriceSource, pricingNote };
}
const SECRET_DENYLIST = [
    /api[_-]?key/i,
    /bearer\s+/i,
    /sk-[a-z0-9]{10,}/i,
    /cursor_[a-z0-9]+/i,
    /DATABASE_URL/i,
    /BINANCE_API_SECRET/i,
    /GROQ_API_KEY/i,
    /TELEGRAM_BOT_TOKEN/i,
];
const MAX_FIELD_LEN = 500;
function redactSensitiveText(text) {
    if (!text)
        return text;
    let out = text;
    for (const pattern of SECRET_DENYLIST) {
        out = out.replace(pattern, '[REDACTED]');
    }
    out = out.replace(/([a-zA-Z0-9+/=]{32,})/g, (match) => {
        if (match.length > 40)
            return '[REDACTED_TOKEN]';
        return match;
    });
    return out.slice(0, MAX_FIELD_LEN);
}
function sanitizeObject(value) {
    if (value === null || value === undefined)
        return value;
    if (typeof value === 'string')
        return redactSensitiveText(value);
    if (Array.isArray(value))
        return value.map((v) => sanitizeObject(v));
    if (typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = sanitizeObject(v);
        }
        return out;
    }
    return value;
}
const ERROR_EVENT_PATTERN = /error|reject|fail|execution_blocked|protective_failed/i;
async function getWeeklyTradeStatsIct(symbol, methodId) {
    const account = await prisma_1.prisma.testnetAccount.findFirst({
        where: { symbol, method_id: methodId },
        select: { id: true },
    });
    if (!account) {
        return { closedCount: 0, wins: 0, losses: 0, totalRealizedPnl: 0, totalFees: 0 };
    }
    const { weekStart } = (0, ict_time_1.getDayBoundsICT)();
    const closed = await prisma_1.prisma.testnetPosition.findMany({
        where: {
            account_id: account.id,
            status: { in: ['closed', 'CLOSED'] },
            close_time: { gte: weekStart },
        },
        select: { realized_pnl: true, entry_fee: true, exit_fee: true, funding_fee: true },
    });
    let wins = 0;
    let losses = 0;
    let totalRealizedPnl = 0;
    let totalFees = 0;
    for (const p of closed) {
        const pnl = p.realized_pnl ?? 0;
        totalRealizedPnl += pnl;
        totalFees += (p.entry_fee ?? 0) + (p.exit_fee ?? 0) + (p.funding_fee ?? 0);
        if (pnl > 0)
            wins++;
        else if (pnl < 0)
            losses++;
    }
    return { closedCount: closed.length, wins, losses, totalRealizedPnl, totalFees };
}
async function getLlmStatsWeekIct() {
    const { weekStart } = (0, ict_time_1.getDayBoundsICT)();
    const decisions = await prisma_1.prisma.tradeDecision.findMany({
        where: { timestamp: { gte: weekStart }, method_id: 'kim_nghia' },
        select: { decision: true },
    });
    const trades = decisions.filter((d) => d.decision === 'trade').length;
    return { total: decisions.length, trades, noTrades: decisions.length - trades };
}
async function fetchRecentClosedPositions(symbol, methodId) {
    const account = await prisma_1.prisma.testnetAccount.findFirst({
        where: { symbol, method_id: methodId },
        select: { id: true },
    });
    if (!account)
        return [];
    const { dayStart } = (0, ict_time_1.getDayBoundsICT)();
    const rows = await prisma_1.prisma.testnetPosition.findMany({
        where: {
            account_id: account.id,
            status: { in: ['closed', 'CLOSED'] },
            close_time: { gte: dayStart },
        },
        orderBy: { close_time: 'desc' },
        take: 12,
        select: {
            position_id: true,
            side: true,
            entry_price: true,
            close_price: true,
            realized_pnl: true,
            close_reason: true,
            entry_time: true,
            close_time: true,
        },
    });
    return rows.map((r) => ({
        position_id: r.position_id,
        side: r.side,
        entry_price: r.entry_price,
        close_price: r.close_price ?? 0,
        realized_pnl: r.realized_pnl ?? 0,
        close_reason: redactSensitiveText(String(r.close_reason ?? '')),
        entry_time: r.entry_time.toISOString(),
        close_time: (r.close_time ?? r.entry_time).toISOString(),
    }));
}
async function fetchBinanceExposureSnapshot(symbol) {
    try {
        const lines = await (0, account_summary_service_1.getBinanceOpenPositionLines)(symbol);
        if (lines.length === 0) {
            return { available: true, side: 'flat', netQty: 0 };
        }
        const p = lines[0];
        return {
            available: true,
            side: p.side,
            netQty: p.sizeQty,
            entryPrice: p.entry,
            markPrice: p.mark,
        };
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            available: false,
            side: 'unknown',
            netQty: 0,
            note: redactSensitiveText(msg.slice(0, 200)),
        };
    }
}
async function fetchRecentDecisions(methodId) {
    const { dayStart } = (0, ict_time_1.getDayBoundsICT)();
    const rows = await prisma_1.prisma.tradeDecision.findMany({
        where: { method_id: methodId, timestamp: { gte: dayStart } },
        orderBy: { timestamp: 'desc' },
        take: 20,
        select: {
            id: true,
            decision: true,
            grade: true,
            confidence: true,
            timeframe: true,
            reason: true,
            timestamp: true,
        },
    });
    return rows.map((r) => ({
        id: r.id,
        decision: r.decision,
        grade: r.grade,
        confidence: r.confidence,
        timeframe: r.timeframe,
        reason: redactSensitiveText((r.reason || '').slice(0, MAX_FIELD_LEN)),
        timestamp: r.timestamp.toISOString(),
    }));
}
async function fetchRecentErrorEvents() {
    const events = await prisma_1.prisma.testnetTradeEvent.findMany({
        orderBy: { timestamp: 'desc' },
        take: 50,
    });
    return events
        .filter((e) => ERROR_EVENT_PATTERN.test(e.event_type))
        .slice(0, 15)
        .map((e) => ({
        event_type: e.event_type,
        timestamp: e.timestamp.toISOString(),
        summary: redactSensitiveText((e.event_data || e.event_type).slice(0, MAX_FIELD_LEN)),
    }));
}
const OPERATOR_NOTES = [
    'Số dư Telegram = ví Binance demo/mainnet (nguồn đúng cho tiền thật trên sàn).',
    'openPositions + pendingOrders = cùng nguồn với lệnh /lenh (lấy trực tiếp từ Binance API, không phải sổ bot).',
    'meta.binanceExchange.mode = testnet hoặc mainnet (từ BINANCE_BASE_URL / BINANCE_TESTNET).',
    'meta.binanceExchange.pricingNote = giải thích chênh lệch giá demo vs mainnet — đọc khi user hỏi giá lạ.',
    'Mark/latest price = từ Binance USD-M Futures (demo-fapi hoặc fapi), không phải Binance spot hay CoinGecko.',
    'Mỗi openPositions có stopLoss / takeProfit từ lệnh SL/TP algo đang treo trên sàn (nếu có).',
    'binanceExposure tóm tắt vị thế net trên sàn — khớp openPositions khi có lệnh mở.',
    'Sổ bot local có thể trống dù sàn còn lệnh — KHÔNG nói "không có lệnh" nếu openPositions hoặc binanceExposure có dữ liệu.',
    'recentDecisions = lịch sử LLM — lý do cũ có thể không còn đúng.',
    'User hỏi TP/SL: đọc stopLoss và takeProfit trong openPositions.',
    'User hỏi chênh ~1k demo vs mainnet: nói rõ đang trade testnet, giá demo ≠ giá thật, không đổ lỗi "lệnh cũ 62k" nếu /lenh hiện giá ~64–65k.',
];
async function buildAiContext(scope) {
    const { symbol, methodId } = (0, account_summary_service_1.getDefaultTradingScope)();
    const includeCompare = scope === 'compare';
    const [account, todayTrades, weekTrades, health, llmStats, llmWeekStats, topNoTradeReasons, recentDecisions, recentErrors, rawOpenPositions, pendingOrders, binanceExposure, recentClosedPositions,] = await Promise.all([
        (0, account_summary_service_1.getAccountBalanceSummary)(symbol, methodId, true),
        (0, account_summary_service_1.getTodayTradeStatsIct)(symbol, methodId),
        includeCompare ? getWeeklyTradeStatsIct(symbol, methodId) : Promise.resolve(undefined),
        (0, system_health_service_1.getSystemHealthSnapshot)(),
        (0, system_health_service_1.getLlmStatsTodayIct)(),
        includeCompare ? getLlmStatsWeekIct() : Promise.resolve(undefined),
        (0, system_health_service_1.getTopNoTradeReasonsIct)(5),
        fetchRecentDecisions(methodId),
        fetchRecentErrorEvents(),
        (0, account_summary_service_1.getLiveOpenPositionLines)(symbol, methodId),
        (0, account_summary_service_1.getLivePendingOrderLines)(symbol, methodId),
        fetchBinanceExposureSnapshot(symbol),
        fetchRecentClosedPositions(symbol, methodId),
    ]);
    const openPositions = await (0, account_summary_service_1.enrichPositionsWithBinanceSlTp)(rawOpenPositions, symbol);
    const bundle = {
        meta: {
            generatedAt: new Date().toISOString(),
            ictDate: (0, ict_time_1.getIctDateString)(),
            symbol,
            methodId,
            scope,
            binanceExchange: getBinanceExchangeEnv(),
        },
        account,
        todayTrades,
        weekTrades,
        health,
        llm: {
            stats: llmStats,
            weekStats: llmWeekStats,
            topNoTradeReasons,
        },
        recentDecisions,
        recentErrors,
        openPositions,
        pendingOrders,
        binanceExposure,
        recentClosedPositions,
        operatorNotes: OPERATOR_NOTES,
    };
    return sanitizeObject(bundle);
}
function contextToJson(bundle) {
    return JSON.stringify(bundle, null, 2);
}
const REPORT_KEYWORD_SCOPES = {
    'bao cao': 'today_run',
    baocao: 'today_run',
    'hom nay': 'today_run',
    homnay: 'today_run',
    loi: 'errors',
    lỗi: 'errors',
    pipeline: 'pipeline',
    llm: 'llm',
    'so sanh': 'compare',
    'so-sanh': 'compare',
};
function parseAiCommandArgs(args) {
    const trimmed = args.trim();
    const lower = trimmed.toLowerCase();
    if (!trimmed) {
        return { action: 'analyze', scope: 'freeform' };
    }
    if (lower === 'cancel' || lower === 'huy') {
        return { action: 'cancel', scope: 'today_run' };
    }
    const reportScope = REPORT_KEYWORD_SCOPES[lower];
    if (reportScope) {
        return { action: 'analyze', scope: reportScope };
    }
    if (lower.startsWith('vi ') || lower.startsWith('vi\t')) {
        const question = trimmed.slice(3).trim();
        return { action: 'analyze', scope: 'freeform', question: question || undefined };
    }
    return { action: 'analyze', scope: 'freeform', question: trimmed };
}
function splitMessageForTelegram(text, maxLen = 4096) {
    if (text.length <= maxLen)
        return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > maxLen) {
        let splitAt = remaining.lastIndexOf('\n', maxLen);
        if (splitAt < maxLen * 0.5)
            splitAt = maxLen;
        chunks.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt).trimStart();
    }
    if (remaining.length > 0)
        chunks.push(remaining);
    return chunks;
}
//# sourceMappingURL=ai-context.builder.js.map