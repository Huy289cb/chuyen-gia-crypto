/**
 * Analysis Repository
 *
 * Handles all database operations for analysis_history, predictions, and key_levels
 */
export interface SaveAnalysisData {
    coin: string;
    currentPrice: number;
    bias: string;
    action: string;
    confidence: number;
    narrative?: string;
    comparison?: string;
    marketSentiment?: string;
    disclaimer?: string;
    methodId?: string;
    breakoutRetest?: string;
    positionDecisions?: string;
    pendingOrderDecisions?: string;
    alternativeScenario?: string;
    suggestedEntry?: number;
    suggestedStopLoss?: number;
    suggestedTakeProfit?: number;
    expectedRr?: number;
    invalidationLevel?: number;
    rawQuestion?: string;
    rawAnswer?: string;
}
export interface PredictionData {
    timeframe: string;
    direction: string;
    targetPrice?: number;
    confidence?: number;
    expiresAt?: Date;
    suggestedEntry?: number;
    suggestedStopLoss?: number;
    suggestedTakeProfit?: number;
    expectedRr?: number;
    invalidationLevel?: number;
    reasonSummary?: string;
    modelVersion?: string;
}
export interface KeyLevelData {
    levelType: string;
    description?: string;
    priceLevels?: string;
}
/**
 * Save analysis with predictions and key levels
 */
export declare function saveAnalysis(data: SaveAnalysisData, predictions?: PredictionData[], keyLevels?: KeyLevelData[]): Promise<{
    analysisId: number;
    predictionIds: Record<string, number>;
}>;
/**
 * Get recent analysis with predictions
 */
export declare function getRecentAnalysis(coin: string, limit?: number, methodId?: string, page?: number): Promise<{
    data: any[];
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}>;
/**
 * Get prediction accuracy statistics
 */
export declare function getPredictionAccuracy(coin: string, hours?: number): Promise<{
    total: number;
    correct: number;
    accuracy: number;
    byTimeframe: Record<string, {
        total: number;
        correct: number;
    }>;
}>;
/**
 * Validate expired predictions
 */
export declare function validatePredictions(): Promise<number>;
//# sourceMappingURL=analysis.repository.d.ts.map