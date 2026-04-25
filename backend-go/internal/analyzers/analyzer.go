package analyzers

import (
	"context"
	"fmt"
	"time"

	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
	"github.com/chuyen-gia-crypto/backend/internal/db/repository"
	"github.com/chuyen-gia-crypto/backend/internal/services/groq"
	"github.com/chuyen-gia-crypto/backend/internal/services/pricefetcher"
	"github.com/chuyen-gia-crypto/backend/pkg/errors"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"go.uber.org/zap"
)

// Analyzer represents the main analyzer interface
type Analyzer struct {
	groqClient     *groq.Client
	analysisRepo   *repository.AnalysisRepository
	predictionRepo *repository.PredictionRepository
}

// NewAnalyzer creates a new analyzer
func NewAnalyzer(groqClient *groq.Client, analysisRepo *repository.AnalysisRepository, predictionRepo *repository.PredictionRepository) *Analyzer {
	return &Analyzer{
		groqClient:     groqClient,
		analysisRepo:   analysisRepo,
		predictionRepo: predictionRepo,
	}
}

// AnalysisResult represents the result of an analysis
type AnalysisResult struct {
	Coin                string                   `json:"coin"`
	CurrentPrice        float64                  `json:"current_price"`
	Bias                string                   `json:"bias"`
	Action              string                   `json:"action"`
	Confidence          float64                  `json:"confidence"`
	Narrative           string                   `json:"narrative"`
	Comparison          string                   `json:"comparison"`
	MarketSentiment     string                   `json:"market_sentiment"`
	Disclaimer          string                   `json:"disclaimer"`
	MethodID            string                   `json:"method_id"`
	BreakoutRetest      map[string]interface{}   `json:"breakout_retest"`
	PositionDecisions   []map[string]interface{} `json:"position_decisions"`
	AlternativeScenario map[string]interface{}   `json:"alternative_scenario"`
	SuggestedEntry      float64                  `json:"suggested_entry"`
	SuggestedStopLoss   float64                  `json:"suggested_stop_loss"`
	SuggestedTakeProfit float64                  `json:"suggested_take_profit"`
	ExpectedRR          float64                  `json:"expected_rr"`
	InvalidationLevel   float64                  `json:"invalidation_level"`
	RawQuestion         string                   `json:"raw_question"`
	RawAnswer           string                   `json:"raw_answer"`
}

// RunKimNghiaAnalysis runs Kim Nghia method analysis
func (a *Analyzer) RunKimNghiaAnalysis(ctx context.Context, coin string) (*AnalysisResult, error) {
	startTime := time.Now()
	logger.Info("[KimNghia] Starting analysis",
		zap.String("coin", coin),
		zap.Time("start_time", startTime),
	)

	// Fetch current price and OHLC data
	marketData, err := pricefetcher.FetchFromBinance()
	if err != nil {
		logger.Error("[KimNghia] Failed to fetch market data", zap.Error(err))
		return nil, errors.NewAPIError("failed to fetch market data", err)
	}

	var currentPrice float64
	if coin == "BTC" {
		currentPrice = marketData.BTC.Price
	} else if coin == "ETH" {
		currentPrice = marketData.ETH.Price
	} else {
		return nil, errors.NewValidationError("unsupported coin")
	}

	// Fetch OHLC data for analysis
	ohlcData, err := pricefetcher.FetchOHLCFromBinance(coin+"USDT", "15m", 672)
	if err != nil {
		logger.Warn("[KimNghia] Failed to fetch OHLC data", zap.Error(err))
		// Continue without OHLC data
		ohlcData = []pricefetcher.PriceData{}
	}

	// Build prompt for Kim Nghia method
	systemPrompt := a.buildKimNghiaSystemPrompt()
	userPrompt := a.buildKimNghiaUserPrompt(coin, currentPrice, ohlcData, marketData)

	// Call Groq API
	response, err := a.groqClient.Analyze(ctx, systemPrompt, userPrompt, 0.7)
	if err != nil {
		logger.Error("[KimNghia] Groq analysis failed", zap.Error(err))
		return nil, errors.NewAPIError("Groq analysis failed", err)
	}

	// Parse response
	result, err := a.parseAnalysisResult(response, coin, currentPrice, "kim_nghia")
	if err != nil {
		logger.Error("[KimNghia] Failed to parse analysis result", zap.Error(err))
		return nil, errors.NewValidationError("failed to parse analysis result")
	}

	// Save to database
	if err := a.saveAnalysis(ctx, result); err != nil {
		logger.Error("[KimNghia] Failed to save analysis", zap.Error(err))
		// Continue even if save fails
	}

	duration := time.Since(startTime)
	logger.Info("[KimNghia] Analysis completed",
		zap.String("coin", coin),
		zap.Float64("confidence", result.Confidence),
		zap.String("action", result.Action),
		zap.Duration("duration", duration),
	)

	return result, nil
}

// RunICTAnalysis runs ICT method analysis
func (a *Analyzer) RunICTAnalysis(ctx context.Context, coin string) (*AnalysisResult, error) {
	startTime := time.Now()
	logger.Info("[ICT] Starting analysis",
		zap.String("coin", coin),
		zap.Time("start_time", startTime),
	)

	// Fetch current price and OHLC data
	marketData, err := pricefetcher.FetchFromBinance()
	if err != nil {
		logger.Error("[ICT] Failed to fetch market data", zap.Error(err))
		return nil, errors.NewAPIError("failed to fetch market data", err)
	}

	var currentPrice float64
	if coin == "BTC" {
		currentPrice = marketData.BTC.Price
	} else if coin == "ETH" {
		currentPrice = marketData.ETH.Price
	} else {
		return nil, errors.NewValidationError("unsupported coin")
	}

	// Fetch OHLC data for multiple timeframes
	timeframes := []string{"15m", "1h", "4h", "1d"}
	ohlcDataMap := make(map[string][]pricefetcher.PriceData)
	for _, tf := range timeframes {
		data, err := pricefetcher.FetchOHLCFromBinance(coin+"USDT", tf, 100)
		if err != nil {
			logger.Warn("[ICT] Failed to fetch OHLC data",
				zap.String("timeframe", tf),
				zap.Error(err))
			continue
		}
		ohlcDataMap[tf] = data
	}

	// Build prompt for ICT method
	systemPrompt := a.buildICTSystemPrompt()
	userPrompt := a.buildICTUserPrompt(coin, currentPrice, ohlcDataMap, marketData)

	// Call Groq API
	response, err := a.groqClient.Analyze(ctx, systemPrompt, userPrompt, 0.7)
	if err != nil {
		logger.Error("[ICT] Groq analysis failed", zap.Error(err))
		return nil, errors.NewAPIError("Groq analysis failed", err)
	}

	// Parse response
	result, err := a.parseAnalysisResult(response, coin, currentPrice, "ict")
	if err != nil {
		logger.Error("[ICT] Failed to parse analysis result", zap.Error(err))
		return nil, errors.NewValidationError("failed to parse analysis result")
	}

	// Save to database
	if err := a.saveAnalysis(ctx, result); err != nil {
		logger.Error("[ICT] Failed to save analysis", zap.Error(err))
		// Continue even if save fails
	}

	duration := time.Since(startTime)
	logger.Info("[ICT] Analysis completed",
		zap.String("coin", coin),
		zap.Float64("confidence", result.Confidence),
		zap.String("action", result.Action),
		zap.Duration("duration", duration),
	)

	return result, nil
}

// buildKimNghiaSystemPrompt builds the system prompt for Kim Nghia method
func (a *Analyzer) buildKimNghiaSystemPrompt() string {
	return `Bạn là một chuyên gia phân tích thị trường crypto theo phương pháp Kim Nghia, kết hợp Smart Money Concepts (SMC), Volume Profile và Fibonacci Levels.

Nhiệm vụ của bạn:
1. Phân tích cấu trúc thị trường (Market Structure)
2. Xác định vùng thanh khoản (Liquidity Zones)
3. Phân tích khối lượng giao dịch (Volume Profile)
4. Xác định các mức Fibonacci quan trọng
5. Đưa ra dự báo xu hướng với confidence score

Trả về kết quả dưới dạng JSON thuần (không markdown, không lời dẫn):
{
  "bias": "bullish|bearish|neutral",
  "action": "buy|sell|hold",
  "confidence": 0.0-1.0,
  "narrative": "giải thích tiếng Việt",
  "comparison": "so sánh với các phương pháp khác",
  "market_sentiment": "tâm lý thị trường",
  "disclaimer": "cảnh báo rủi ro",
  "breakout_retest": {},
  "position_decisions": [],
  "alternative_scenario": {},
  "suggested_entry": giá,
  "suggested_stop_loss": giá,
  "suggested_take_profit": giá,
  "expected_rr": số,
  "invalidation_level": giá,
  "reason_summary": "tóm tắt lý do"
}`
}

// buildKimNghiaUserPrompt builds the user prompt for Kim Nghia method
func (a *Analyzer) buildKimNghiaUserPrompt(coin string, currentPrice float64, ohlcData []pricefetcher.PriceData, marketData *pricefetcher.MarketData) string {
	prompt := fmt.Sprintf(`Phân tích %s theo phương pháp Kim Nghia:

Giá hiện tại: %.2f
Thay đổi 24h: %.2f%%

Dữ liệu nến 15m (candles gần nhất):`, coin, currentPrice, marketData.BTC.Change24h)

	// Add recent OHLC data (last 20 candles)
	maxCandles := 20
	if len(ohlcData) > maxCandles {
		ohlcData = ohlcData[len(ohlcData)-maxCandles:]
	}
	for i, candle := range ohlcData {
		prompt += fmt.Sprintf("\nCandle %d: Open=%.2f, High=%.2f, Low=%.2f, Close=%.2f, Volume=%.2f",
			i+1, candle.Open, candle.High, candle.Low, candle.Price, candle.Volume)
	}

	if marketData.MarketData.FearGreed != nil {
		prompt += fmt.Sprintf("\n\nFear & Greed Index: %d (%s)",
			marketData.MarketData.FearGreed.Value,
			marketData.MarketData.FearGreed.Classification)
	}

	prompt += "\n\nHãy phân tích và đưa ra dự báo xu hướng với confidence score."

	return prompt
}

// buildICTSystemPrompt builds the system prompt for ICT method
func (a *Analyzer) buildICTSystemPrompt() string {
	return `Bạn là một chuyên gia phân tích thị trường crypto theo phương pháp ICT (Inner Circle Trader) Smart Money Concepts.

Nhiệm vụ của bạn:
1. Phân tích cấu trúc thị trường (Market Structure)
2. Xác định vùng thanh khoản (Liquidity)
3. Phân tích Order Blocks (OB)
4. Xác định Fair Value Gaps (FVG)
5. Phân tích Break of Structure (BOS) và Change of Character (CHOCH)
6. Multi-timeframe alignment (15m, 1h, 4h, 1d)

Trả về kết quả dưới dạng JSON thuần (không markdown, không lời dẫn):
{
  "bias": "bullish|bearish|neutral",
  "action": "buy|sell|hold",
  "confidence": 0.0-1.0,
  "narrative": "giải thích tiếng Việt",
  "comparison": "so sánh với các phương pháp khác",
  "market_sentiment": "tâm lý thị trường",
  "disclaimer": "cảnh báo rủi ro",
  "breakout_retest": {},
  "position_decisions": [],
  "alternative_scenario": {},
  "suggested_entry": giá,
  "suggested_stop_loss": giá,
  "suggested_take_profit": giá,
  "expected_rr": số,
  "invalidation_level": giá,
  "reason_summary": "tóm tắt lý do"
}`
}

// buildICTUserPrompt builds the user prompt for ICT method
func (a *Analyzer) buildICTUserPrompt(coin string, currentPrice float64, ohlcDataMap map[string][]pricefetcher.PriceData, marketData *pricefetcher.MarketData) string {
	prompt := fmt.Sprintf(`Phân tích %s theo phương pháp ICT Smart Money Concepts:

Giá hiện tại: %.2f
Thay đổi 24h: %.2f%%

Multi-timeframe Analysis:`, coin, currentPrice, marketData.BTC.Change24h)

	for tf, data := range ohlcDataMap {
		prompt += fmt.Sprintf("\n\nTimeframe %s (candles gần nhất):", tf)
		maxCandles := 20
		if len(data) > maxCandles {
			data = data[len(data)-maxCandles:]
		}
		for i, candle := range data {
			prompt += fmt.Sprintf("\nCandle %d: Open=%.2f, High=%.2f, Low=%.2f, Close=%.2f",
				i+1, candle.Open, candle.High, candle.Low, candle.Price)
		}
	}

	if marketData.MarketData.FearGreed != nil {
		prompt += fmt.Sprintf("\n\nFear & Greed Index: %d (%s)",
			marketData.MarketData.FearGreed.Value,
			marketData.MarketData.FearGreed.Classification)
	}

	prompt += "\n\nHãy phân tích multi-timeframe alignment và đưa ra dự báo xu hướng với confidence score."

	return prompt
}

// parseAnalysisResult parses the Groq response into AnalysisResult
func (a *Analyzer) parseAnalysisResult(response map[string]interface{}, coin string, currentPrice float64, methodID string) (*AnalysisResult, error) {
	result := &AnalysisResult{
		Coin:         coin,
		CurrentPrice: currentPrice,
		MethodID:     methodID,
	}

	// Extract fields with safe type assertions
	if bias, ok := response["bias"].(string); ok {
		result.Bias = bias
	}
	if action, ok := response["action"].(string); ok {
		result.Action = action
	}
	if confidence, ok := response["confidence"].(float64); ok {
		result.Confidence = confidence
	}
	if narrative, ok := response["narrative"].(string); ok {
		result.Narrative = narrative
	}
	if comparison, ok := response["comparison"].(string); ok {
		result.Comparison = comparison
	}
	if sentiment, ok := response["market_sentiment"].(string); ok {
		result.MarketSentiment = sentiment
	}
	if disclaimer, ok := response["disclaimer"].(string); ok {
		result.Disclaimer = disclaimer
	}
	if entry, ok := response["suggested_entry"].(float64); ok {
		result.SuggestedEntry = entry
	}
	if sl, ok := response["suggested_stop_loss"].(float64); ok {
		result.SuggestedStopLoss = sl
	}
	if tp, ok := response["suggested_take_profit"].(float64); ok {
		result.SuggestedTakeProfit = tp
	}
	if rr, ok := response["expected_rr"].(float64); ok {
		result.ExpectedRR = rr
	}
	if invalidation, ok := response["invalidation_level"].(float64); ok {
		result.InvalidationLevel = invalidation
	}
	if reason, ok := response["reason_summary"].(string); ok {
		result.RawAnswer = reason
	}

	// Handle complex fields
	if breakout, ok := response["breakout_retest"].(map[string]interface{}); ok {
		result.BreakoutRetest = breakout
	}
	if decisions, ok := response["position_decisions"].([]interface{}); ok {
		result.PositionDecisions = make([]map[string]interface{}, 0, len(decisions))
		for _, d := range decisions {
			if decision, ok := d.(map[string]interface{}); ok {
				result.PositionDecisions = append(result.PositionDecisions, decision)
			}
		}
	}
	if alt, ok := response["alternative_scenario"].(map[string]interface{}); ok {
		result.AlternativeScenario = alt
	}

	return result, nil
}

// saveAnalysis saves the analysis result to database
func (a *Analyzer) saveAnalysis(ctx context.Context, result *AnalysisResult) error {
	analysis := &ent.AnalysisHistory{
		Coin:                result.Coin,
		Timestamp:           time.Now(),
		CurrentPrice:        result.CurrentPrice,
		Bias:                result.Bias,
		Action:              result.Action,
		Confidence:          result.Confidence,
		Narrative:           result.Narrative,
		Comparison:          result.Comparison,
		MarketSentiment:     result.MarketSentiment,
		Disclaimer:          result.Disclaimer,
		MethodID:            result.MethodID,
		SuggestedEntry:      result.SuggestedEntry,
		SuggestedStopLoss:   result.SuggestedStopLoss,
		SuggestedTakeProfit: result.SuggestedTakeProfit,
		ExpectedRr:          result.ExpectedRR,
		InvalidationLevel:   result.InvalidationLevel,
		RawAnswer:           result.RawAnswer,
	}

	_, err := a.analysisRepo.Create(ctx, analysis)
	return err
}
