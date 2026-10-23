"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveAnalysis = saveAnalysis;
exports.getRecentAnalysis = getRecentAnalysis;
exports.getPredictionAccuracy = getPredictionAccuracy;
exports.validatePredictions = validatePredictions;
const prisma_1 = require("../lib/prisma");
/**
 * Save analysis with predictions and key levels
 */
async function saveAnalysis(data, predictions, keyLevels) {
    const { coin, currentPrice, bias, action, confidence, narrative, comparison, marketSentiment, disclaimer, methodId = 'ict', breakoutRetest, positionDecisions, pendingOrderDecisions, alternativeScenario, suggestedEntry, suggestedStopLoss, suggestedTakeProfit, expectedRr, invalidationLevel, rawQuestion, rawAnswer, } = data;
    // Create analysis history record
    const analysis = await prisma_1.prisma.analysisHistory.create({
        data: {
            coin: coin.toUpperCase(),
            current_price: currentPrice,
            bias,
            action,
            confidence,
            narrative,
            comparison,
            market_sentiment: marketSentiment,
            disclaimer,
            method_id: methodId,
            breakout_retest: breakoutRetest,
            position_decisions: positionDecisions,
            pending_order_decisions: pendingOrderDecisions,
            alternative_scenario: alternativeScenario,
            suggested_entry: suggestedEntry,
            suggested_stop_loss: suggestedStopLoss,
            suggested_take_profit: suggestedTakeProfit,
            expected_rr: expectedRr,
            invalidation_level: invalidationLevel,
            raw_question: rawQuestion,
            raw_answer: rawAnswer,
        },
    });
    const analysisId = analysis.id;
    const predictionIds = {};
    // Save predictions
    if (predictions && predictions.length > 0) {
        for (const pred of predictions) {
            const prediction = await prisma_1.prisma.prediction.create({
                data: {
                    analysis_id: analysisId,
                    coin: coin.toUpperCase(),
                    timeframe: pred.timeframe,
                    direction: pred.direction,
                    target_price: pred.targetPrice,
                    confidence: pred.confidence,
                    predicted_at: new Date(),
                    expires_at: pred.expiresAt,
                    suggested_entry: pred.suggestedEntry,
                    suggested_stop_loss: pred.suggestedStopLoss,
                    suggested_take_profit: pred.suggestedTakeProfit,
                    expected_rr: pred.expectedRr,
                    invalidation_level: pred.invalidationLevel,
                    reason_summary: pred.reasonSummary,
                    model_version: pred.modelVersion || '1.0',
                    method_id: methodId,
                },
            });
            predictionIds[pred.timeframe] = prediction.id;
        }
    }
    // Save key levels
    if (keyLevels && keyLevels.length > 0) {
        for (const level of keyLevels) {
            await prisma_1.prisma.keyLevel.create({
                data: {
                    analysis_id: analysisId,
                    coin: coin.toUpperCase(),
                    level_type: level.levelType,
                    description: level.description,
                    price_levels: level.priceLevels,
                },
            });
        }
    }
    return { analysisId, predictionIds };
}
/**
 * Get recent analysis with predictions
 */
async function getRecentAnalysis(coin, limit = 50, methodId, page = 1) {
    const offset = (page - 1) * limit;
    const conditions = {
        coin: coin.toUpperCase(),
        method_id: methodId || undefined,
    };
    // Count total
    const total = await prisma_1.prisma.analysisHistory.count({ where: conditions });
    // Get analysis with predictions
    const analyses = await prisma_1.prisma.analysisHistory.findMany({
        where: conditions,
        include: {
            predictions: true,
            key_levels: true,
        },
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
    });
    return {
        data: analyses,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        },
    };
}
/**
 * Get prediction accuracy statistics
 */
async function getPredictionAccuracy(coin, hours = 24) {
    const since = new Date();
    since.setHours(since.getHours() - hours);
    const predictions = await prisma_1.prisma.prediction.findMany({
        where: {
            coin: coin.toUpperCase(),
            predicted_at: { gte: since },
            actual_price: { not: null },
        },
    });
    const stats = {
        total: predictions.length,
        correct: predictions.filter((p) => p.is_correct).length,
        accuracy: predictions.length > 0 ? predictions.filter((p) => p.is_correct).length / predictions.length : 0,
        byTimeframe: {},
    };
    for (const pred of predictions) {
        if (!stats.byTimeframe[pred.timeframe]) {
            stats.byTimeframe[pred.timeframe] = { total: 0, correct: 0 };
        }
        stats.byTimeframe[pred.timeframe].total++;
        if (pred.is_correct) {
            stats.byTimeframe[pred.timeframe].correct++;
        }
    }
    return stats;
}
/**
 * Validate expired predictions
 */
async function validatePredictions() {
    const now = new Date();
    const expiredPredictions = await prisma_1.prisma.prediction.findMany({
        where: {
            expires_at: { lte: now },
            actual_price: null,
        },
        include: {
            analysis: true,
        },
    });
    let validated = 0;
    for (const pred of expiredPredictions) {
        // Get actual price at expiration
        const actualPrice = await getPriceAtTime(pred.coin, pred.expires_at);
        if (actualPrice) {
            const predictedUp = pred.direction === 'up';
            const actualUp = actualPrice > pred.analysis.current_price;
            const isCorrect = predictedUp === actualUp;
            await prisma_1.prisma.prediction.update({
                where: { id: pred.id },
                data: {
                    actual_price: actualPrice,
                    is_correct: isCorrect,
                    accuracy: isCorrect ? 1 : 0,
                },
            });
            validated++;
        }
    }
    return validated;
}
/**
 * Get price at a specific timestamp
 */
async function getPriceAtTime(coin, timestamp) {
    // Try OHLCV candles first by finding nearest candle before/after timestamp
    const normalizedCoin = coin.toUpperCase();
    const [beforeCandle, afterCandle] = await Promise.all([
        prisma_1.prisma.ohlcvCandle.findFirst({
            where: {
                coin: normalizedCoin,
                timeframe: '15m',
                timestamp: { lte: timestamp },
            },
            orderBy: { timestamp: 'desc' },
        }),
        prisma_1.prisma.ohlcvCandle.findFirst({
            where: {
                coin: normalizedCoin,
                timeframe: '15m',
                timestamp: { gte: timestamp },
            },
            orderBy: { timestamp: 'asc' },
        }),
    ]);
    const candle = (() => {
        if (!beforeCandle && !afterCandle)
            return null;
        if (!beforeCandle)
            return afterCandle;
        if (!afterCandle)
            return beforeCandle;
        const beforeDiff = Math.abs(timestamp.getTime() - beforeCandle.timestamp.getTime());
        const afterDiff = Math.abs(afterCandle.timestamp.getTime() - timestamp.getTime());
        return beforeDiff <= afterDiff ? beforeCandle : afterCandle;
    })();
    if (candle?.close != null) {
        return candle.close;
    }
    const historyEntry = await prisma_1.prisma.priceHistory.findFirst({
        where: {
            coin: normalizedCoin,
            timestamp: { lte: timestamp },
        },
        orderBy: { timestamp: 'desc' },
    });
    if (historyEntry) {
        return historyEntry.price;
    }
    // Fallback to latest price
    const latestPrice = await prisma_1.prisma.latestPrice.findUnique({
        where: { coin: normalizedCoin },
    });
    return latestPrice?.price || null;
}
//# sourceMappingURL=analysis.repository.js.map