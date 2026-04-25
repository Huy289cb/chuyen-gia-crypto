package aiposition

import (
	"context"
	"fmt"

	"github.com/chuyen-gia-crypto/backend/internal/config"
	"github.com/chuyen-gia-crypto/backend/internal/services/groq"
	"github.com/chuyen-gia-crypto/backend/internal/services/papertrading"
	"github.com/chuyen-gia-crypto/backend/pkg/errors"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"go.uber.org/zap"
)

// PositionDecision represents an AI decision for a position
type PositionDecision struct {
	PositionID   string  `json:"position_id"`
	Action       string  `json:"action"` // hold, close_early, close_partial, move_sl, reverse
	Confidence   float64 `json:"confidence"`
	Reason       string  `json:"reason"`
	ClosePercent float64 `json:"close_percent,omitempty"`
	NewSL        float64 `json:"new_sl,omitempty"`
	NewTP        float64 `json:"new_tp,omitempty"`
}

// OrderDecision represents an AI decision for a pending order
type OrderDecision struct {
	OrderID    string  `json:"order_id"`
	Action     string  `json:"action"` // hold, cancel, modify
	Confidence float64 `json:"confidence"`
	Reason     string  `json:"reason"`
	NewEntry   float64 `json:"new_entry,omitempty"`
	NewSL      float64 `json:"new_sl,omitempty"`
	NewTP      float64 `json:"new_tp,omitempty"`
}

// AIAnalysisResult represents the full AI analysis result
type AIAnalysisResult struct {
	BTC struct {
		PositionDecisions     []PositionDecision `json:"position_decisions,omitempty"`
		PendingOrderDecisions []OrderDecision    `json:"pending_order_decisions,omitempty"`
	} `json:"btc"`
}

// Engine represents the AI position management engine
type Engine struct {
	groqClient  *groq.Client
	paperEngine *papertrading.Engine
}

// NewEngine creates a new AI position management engine
func NewEngine(groqClient *groq.Client, paperEngine *papertrading.Engine) *Engine {
	return &Engine{
		groqClient:  groqClient,
		paperEngine: paperEngine,
	}
}

// AnalyzePositions analyzes open positions and generates AI decisions
func (e *Engine) AnalyzePositions(ctx context.Context, positions []*papertrading.Position, candles []interface{}, methodID string) ([]PositionDecision, error) {
	if e.groqClient == nil {
		return nil, errors.NewAPIError("Groq client not initialized", nil)
	}

	logger.Info("Analyzing positions with AI",
		zap.Int("positions_count", len(positions)),
		zap.String("method_id", methodID),
	)

	// Build context for AI
	contextData := e.buildPositionContext(positions, candles)

	// Build prompt
	systemPrompt := e.buildSystemPrompt(methodID)
	userPrompt := e.buildPositionPrompt(contextData)

	// Call Groq API
	response, err := e.groqClient.Analyze(ctx, systemPrompt, userPrompt, 0.2)
	if err != nil {
		return nil, errors.NewAPIError("failed to get AI analysis", err)
	}

	// Parse decisions
	decisions, err := e.parsePositionDecisions(response)
	if err != nil {
		return nil, errors.NewAPIError("failed to parse position decisions", err)
	}

	// Filter by confidence threshold
	confidenceThreshold := e.getConfidenceThreshold(methodID)
	filteredDecisions := make([]PositionDecision, 0)
	for _, decision := range decisions {
		if decision.Confidence >= confidenceThreshold {
			filteredDecisions = append(filteredDecisions, decision)
		} else {
			logger.Info("Skipping position decision due to low confidence",
				zap.String("position_id", decision.PositionID),
				zap.Float64("confidence", decision.Confidence),
				zap.Float64("threshold", confidenceThreshold),
			)
		}
	}

	return filteredDecisions, nil
}

// AnalyzePendingOrders analyzes pending orders and generates AI decisions
func (e *Engine) AnalyzePendingOrders(ctx context.Context, orders []interface{}, candles []interface{}, methodID string) ([]OrderDecision, error) {
	if e.groqClient == nil {
		return nil, errors.NewAPIError("Groq client not initialized", nil)
	}

	logger.Info("Analyzing pending orders with AI",
		zap.Int("orders_count", len(orders)),
		zap.String("method_id", methodID),
	)

	// Build context for AI
	contextData := e.buildOrderContext(orders, candles)

	// Build prompt
	systemPrompt := e.buildSystemPrompt(methodID)
	userPrompt := e.buildOrderPrompt(contextData)

	// Call Groq API
	response, err := e.groqClient.Analyze(ctx, systemPrompt, userPrompt, 0.2)
	if err != nil {
		return nil, errors.NewAPIError("failed to get AI analysis", err)
	}

	// Parse decisions
	decisions, err := e.parseOrderDecisions(response)
	if err != nil {
		return nil, errors.NewAPIError("failed to parse order decisions", err)
	}

	// Filter by confidence threshold
	confidenceThreshold := e.getConfidenceThreshold(methodID)
	filteredDecisions := make([]OrderDecision, 0)
	for _, decision := range decisions {
		if decision.Confidence >= confidenceThreshold {
			filteredDecisions = append(filteredDecisions, decision)
		} else {
			logger.Info("Skipping order decision due to low confidence",
				zap.String("order_id", decision.OrderID),
				zap.Float64("confidence", decision.Confidence),
				zap.Float64("threshold", confidenceThreshold),
			)
		}
	}

	return filteredDecisions, nil
}

// ExecutePositionDecision executes a position decision
func (e *Engine) ExecutePositionDecision(ctx context.Context, position *papertrading.Position, decision PositionDecision, currentPrice float64) error {
	logger.Info("Executing position decision",
		zap.String("position_id", decision.PositionID),
		zap.String("action", decision.Action),
		zap.Float64("confidence", decision.Confidence),
	)

	switch decision.Action {
	case "hold":
		logger.Info("Holding position", zap.String("position_id", decision.PositionID))
		return nil

	case "close_early":
		return e.paperEngine.ClosePosition(ctx, position, currentPrice, "ai_close_early")

	case "close_partial":
		return e.paperEngine.ClosePartialPosition(ctx, position, decision.ClosePercent, currentPrice, "ai_close_partial")

	case "move_sl":
		return e.paperEngine.UpdateStopLoss(ctx, position, decision.NewSL, "ai_move_sl")

	case "reverse":
		newSide := "short"
		if position.Side == "short" {
			newSide = "long"
		}
		suggestion := &papertrading.PositionSuggestion{
			Side:              newSide,
			EntryPrice:        currentPrice,
			StopLoss:          decision.NewSL,
			TakeProfit:        decision.NewTP,
			SizeUSD:           position.SizeUSD,
			SizeQty:           position.SizeQty,
			RiskUSD:           position.RiskUSD,
			RiskPercent:       position.RiskPercent,
			ExpectedRR:        position.ExpectedRR,
			InvalidationLevel: position.InvalidationLevel,
		}
		return e.paperEngine.ReversePosition(ctx, position, currentPrice, suggestion, "ai_reverse")

	default:
		return errors.NewValidationError(fmt.Sprintf("unknown action: %s", decision.Action))
	}
}

// buildPositionContext builds context data for position analysis
func (e *Engine) buildPositionContext(positions []*papertrading.Position, candles []interface{}) map[string]interface{} {
	context := map[string]interface{}{
		"positions": positions,
		"candles":   candles,
		"timestamp": candles[len(candles)-1],
	}
	return context
}

// buildOrderContext builds context data for order analysis
func (e *Engine) buildOrderContext(orders []interface{}, candles []interface{}) map[string]interface{} {
	context := map[string]interface{}{
		"orders":    orders,
		"candles":   candles,
		"timestamp": candles[len(candles)-1],
	}
	return context
}

// buildSystemPrompt builds the system prompt for AI
func (e *Engine) buildSystemPrompt(methodID string) string {
	return fmt.Sprintf(`You are an expert crypto trading AI assistant for the %s method. 
Your task is to analyze open positions and pending orders, then recommend actions.

Available position actions:
- hold: Keep the position as is
- close_early: Close the entire position immediately
- close_partial: Close a portion of the position (specify close_percent between 0 and 1)
- move_sl: Move the stop loss to a new level (specify new_sl)
- reverse: Close current position and open opposite position

Available order actions:
- hold: Keep the pending order as is
- cancel: Cancel the pending order
- modify: Modify the pending order parameters (specify new_entry, new_sl, new_tp)

Return ONLY raw JSON without markdown formatting. Format:
{
  "position_decisions": [
    {
      "position_id": "pos_123",
      "action": "close_early",
      "confidence": 0.85,
      "reason": "Market structure broken"
    }
  ],
  "pending_order_decisions": [
    {
      "order_id": "order_456",
      "action": "cancel",
      "confidence": 0.90,
      "reason": "Invalidation level breached"
    }
  ]
}

All narrative text must be in Vietnamese.`, methodID)
}

// buildPositionPrompt builds the user prompt for position analysis
func (e *Engine) buildPositionPrompt(context map[string]interface{}) string {
	return fmt.Sprintf(`Phân tích các vị thế đang mở và đưa ra khuyến nghị hành động.

Dữ liệu vị thế: %v
Dữ liệu nến (60 nến 15 phút gần nhất): %v

Hãy phân tích và đưa ra quyết định cho từng vị thế dựa trên:
- Xu hướng thị trường hiện tại
- Cấu trúc thị trường (Market Structure)
- Mức thanh khoản (Liquidity)
- Rủi ro/phần thưởng hiện tại
- Thời gian giữ vị thế

Trả về JSON với định dạng như đã hướng dẫn.`, context["positions"], context["candles"])
}

// buildOrderPrompt builds the user prompt for order analysis
func (e *Engine) buildOrderPrompt(context map[string]interface{}) string {
	return fmt.Sprintf(`Phân tích các lệnh chờ và đưa ra khuyến nghị hành động.

Dữ liệu lệnh chờ: %v
Dữ liệu nến (60 nến 15 phút gần nhất): %v

Hãy phân tích và đưa ra quyết định cho từng lệnh dựa trên:
- Khoảng cách giá hiện tại đến giá lệnh
- Mức vô hiệu hóa (Invalidation Level)
- Thay đổi cấu trúc thị trường
- Cơ hội nhập lệnh tốt hơn

Trả về JSON với định dạng như đã hướng dẫn.`, context["orders"], context["candles"])
}

// parsePositionDecisions parses position decisions from AI response
func (e *Engine) parsePositionDecisions(response map[string]interface{}) ([]PositionDecision, error) {
	decisions := make([]PositionDecision, 0)

	positionDecisions, ok := response["position_decisions"].([]interface{})
	if !ok {
		return decisions, nil
	}

	for _, pd := range positionDecisions {
		pdMap, ok := pd.(map[string]interface{})
		if !ok {
			continue
		}

		decision := PositionDecision{
			PositionID:   getString(pdMap, "position_id"),
			Action:       getString(pdMap, "action"),
			Confidence:   getFloat(pdMap, "confidence"),
			Reason:       getString(pdMap, "reason"),
			ClosePercent: getFloat(pdMap, "close_percent"),
			NewSL:        getFloat(pdMap, "new_sl"),
			NewTP:        getFloat(pdMap, "new_tp"),
		}

		decisions = append(decisions, decision)
	}

	return decisions, nil
}

// parseOrderDecisions parses order decisions from AI response
func (e *Engine) parseOrderDecisions(response map[string]interface{}) ([]OrderDecision, error) {
	decisions := make([]OrderDecision, 0)

	orderDecisions, ok := response["pending_order_decisions"].([]interface{})
	if !ok {
		return decisions, nil
	}

	for _, od := range orderDecisions {
		odMap, ok := od.(map[string]interface{})
		if !ok {
			continue
		}

		decision := OrderDecision{
			OrderID:    getString(odMap, "order_id"),
			Action:     getString(odMap, "action"),
			Confidence: getFloat(odMap, "confidence"),
			Reason:     getString(odMap, "reason"),
			NewEntry:   getFloat(odMap, "new_entry"),
			NewSL:      getFloat(odMap, "new_sl"),
			NewTP:      getFloat(odMap, "new_tp"),
		}

		decisions = append(decisions, decision)
	}

	return decisions, nil
}

// getConfidenceThreshold returns the confidence threshold for a method
func (e *Engine) getConfidenceThreshold(methodID string) float64 {
	switch methodID {
	case "ict":
		return config.AppConfig.Analysis.ICTConfidenceThreshold
	case "kim_nghia":
		return config.AppConfig.Analysis.KimNghiaConfidenceThreshold
	default:
		return 0.70
	}
}

// Helper functions for parsing
func getString(m map[string]interface{}, key string) string {
	if val, ok := m[key].(string); ok {
		return val
	}
	return ""
}

func getFloat(m map[string]interface{}, key string) float64 {
	if val, ok := m[key].(float64); ok {
		return val
	}
	return 0
}
