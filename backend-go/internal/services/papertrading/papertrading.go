package papertrading

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/chuyen-gia-crypto/backend/internal/config"
	"github.com/chuyen-gia-crypto/backend/pkg/errors"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"go.uber.org/zap"
)

// Position represents a trading position
type Position struct {
	ID                 string     `json:"id"`
	AccountID          string     `json:"account_id"`
	Symbol             string     `json:"symbol"`
	Side               string     `json:"side"` // "long" or "short"
	EntryPrice         float64    `json:"entry_price"`
	CurrentPrice       float64    `json:"current_price"`
	StopLoss           float64    `json:"stop_loss"`
	TakeProfit         float64    `json:"take_profit"`
	SizeUSD            float64    `json:"size_usd"`
	SizeQty            float64    `json:"size_qty"`
	RiskUSD            float64    `json:"risk_usd"`
	RiskPercent        float64    `json:"risk_percent"`
	ExpectedRR         float64    `json:"expected_rr"`
	InvalidationLevel  float64    `json:"invalidation_level"`
	Status             string     `json:"status"` // "open", "closed", "partial"
	EntryTime          time.Time  `json:"entry_time"`
	ExitTime           *time.Time `json:"exit_time,omitempty"`
	ExitReason         string     `json:"exit_reason,omitempty"`
	RealizedPnL        float64    `json:"realized_pnl"`
	UnrealizedPnL      float64    `json:"unrealized_pnl"`
	MethodID           string     `json:"method_id"`
	LinkedPredictionID string     `json:"linked_prediction_id,omitempty"`
}

// Account represents a paper trading account
type Account struct {
	ID             string    `json:"id"`
	Symbol         string    `json:"symbol"`
	MethodID       string    `json:"method_id"`
	Balance        float64   `json:"balance"`
	InitialBalance float64   `json:"initial_balance"`
	TotalPnL       float64   `json:"total_pnl"`
	WinCount       int       `json:"win_count"`
	LossCount      int       `json:"loss_count"`
	WinRate        float64   `json:"win_rate"`
	ProfitFactor   float64   `json:"profit_factor"`
	MaxDrawdown    float64   `json:"max_drawdown"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// PositionSuggestion represents a suggested position from AI analysis
type PositionSuggestion struct {
	Side              string  `json:"side"`
	EntryPrice        float64 `json:"entry_price"`
	StopLoss          float64 `json:"stop_loss"`
	TakeProfit        float64 `json:"take_profit"`
	SizeUSD           float64 `json:"size_usd"`
	SizeQty           float64 `json:"size_qty"`
	RiskUSD           float64 `json:"risk_usd"`
	RiskPercent       float64 `json:"risk_percent"`
	ExpectedRR        float64 `json:"expected_rr"`
	InvalidationLevel float64 `json:"invalidation_level"`
}

// AutoEntryDecision represents the auto-entry decision
type AutoEntryDecision struct {
	ShouldEnter       bool                `json:"should_enter"`
	Action            string              `json:"action"` // "market", "limit", "hold"
	Reason            string              `json:"reason"`
	SuggestedPosition *PositionSuggestion `json:"suggested_position,omitempty"`
	OrderType         string              `json:"order_type"` // "market" or "limit"
}

// Engine represents the paper trading engine
type Engine struct {
	// TODO: Add database client when schema is ready
}

// NewEngine creates a new paper trading engine
func NewEngine() *Engine {
	return &Engine{}
}

// OpenPosition opens a new position
func (e *Engine) OpenPosition(ctx context.Context, account *Account, suggestion *PositionSuggestion, predictionID, methodID string) (*Position, error) {
	logger.Info("Opening position",
		zap.String("symbol", suggestion.Side),
		zap.String("side", suggestion.Side),
		zap.Float64("entry_price", suggestion.EntryPrice),
		zap.Float64("stop_loss", suggestion.StopLoss),
		zap.Float64("take_profit", suggestion.TakeProfit),
		zap.Float64("size_usd", suggestion.SizeUSD),
	)

	// Validate position parameters
	if err := e.validatePosition(suggestion); err != nil {
		return nil, err
	}

	// Check if account has sufficient balance
	if suggestion.SizeUSD > account.Balance {
		return nil, errors.NewValidationError(fmt.Sprintf("insufficient balance: %.2f < %.2f", account.Balance, suggestion.SizeUSD))
	}

	// Create position
	position := &Position{
		ID:                 generateID(),
		AccountID:          account.ID,
		Symbol:             "BTC", // BTC-only mode
		Side:               suggestion.Side,
		EntryPrice:         suggestion.EntryPrice,
		CurrentPrice:       suggestion.EntryPrice,
		StopLoss:           suggestion.StopLoss,
		TakeProfit:         suggestion.TakeProfit,
		SizeUSD:            suggestion.SizeUSD,
		SizeQty:            suggestion.SizeQty,
		RiskUSD:            suggestion.RiskUSD,
		RiskPercent:        suggestion.RiskPercent,
		ExpectedRR:         suggestion.ExpectedRR,
		InvalidationLevel:  suggestion.InvalidationLevel,
		Status:             "open",
		EntryTime:          time.Now(),
		UnrealizedPnL:      0,
		MethodID:           methodID,
		LinkedPredictionID: predictionID,
	}

	// TODO: Save position to database
	// TODO: Update account balance

	logger.Info("Position opened successfully",
		zap.String("position_id", position.ID),
		zap.String("side", position.Side),
		zap.Float64("size_usd", position.SizeUSD),
	)

	return position, nil
}

// ClosePosition closes a position
func (e *Engine) ClosePosition(ctx context.Context, position *Position, currentPrice float64, reason string) error {
	logger.Info("Closing position",
		zap.String("position_id", position.ID),
		zap.Float64("current_price", currentPrice),
		zap.String("reason", reason),
	)

	if position.Status != "open" {
		return errors.NewValidationError("position is not open")
	}

	// Calculate realized PnL
	realizedPnL := e.calculateRealizedPnL(position, currentPrice)
	position.RealizedPnL = realizedPnL
	position.UnrealizedPnL = 0
	position.CurrentPrice = currentPrice
	position.Status = "closed"
	position.ExitReason = reason
	now := time.Now()
	position.ExitTime = &now

	// TODO: Update position in database
	// TODO: Update account with realized PnL
	// TODO: Record trade event

	logger.Info("Position closed successfully",
		zap.String("position_id", position.ID),
		zap.Float64("realized_pnl", realizedPnL),
		zap.String("exit_reason", reason),
	)

	return nil
}

// ClosePartialPosition closes a portion of a position
func (e *Engine) ClosePartialPosition(ctx context.Context, position *Position, closePercent float64, currentPrice float64, reason string) error {
	logger.Info("Closing partial position",
		zap.String("position_id", position.ID),
		zap.Float64("close_percent", closePercent),
		zap.Float64("current_price", currentPrice),
		zap.String("reason", reason),
	)

	if position.Status != "open" {
		return errors.NewValidationError("position is not open")
	}

	if closePercent <= 0 || closePercent > 1 {
		return errors.NewValidationError("close_percent must be between 0 and 1")
	}

	// Calculate partial PnL
	partialPnL := e.calculateRealizedPnL(position, currentPrice) * closePercent
	position.RealizedPnL += partialPnL
	position.SizeUSD *= (1 - closePercent)
	position.SizeQty *= (1 - closePercent)
	position.RiskUSD *= (1 - closePercent)
	position.CurrentPrice = currentPrice

	// TODO: Update position in database
	// TODO: Update account with partial PnL
	// TODO: Record trade event

	logger.Info("Partial position closed successfully",
		zap.String("position_id", position.ID),
		zap.Float64("close_percent", closePercent),
		zap.Float64("partial_pnl", partialPnL),
	)

	return nil
}

// UpdateStopLoss updates the stop loss for a position
func (e *Engine) UpdateStopLoss(ctx context.Context, position *Position, newSL float64, reason string) error {
	logger.Info("Updating stop loss",
		zap.String("position_id", position.ID),
		zap.Float64("old_sl", position.StopLoss),
		zap.Float64("new_sl", newSL),
		zap.String("reason", reason),
	)

	if position.Status != "open" {
		return errors.NewValidationError("position is not open")
	}

	position.StopLoss = newSL

	// TODO: Update position in database
	// TODO: Record trade event

	logger.Info("Stop loss updated successfully",
		zap.String("position_id", position.ID),
		zap.Float64("new_sl", newSL),
	)

	return nil
}

// ReversePosition reverses a position (close and open opposite)
func (e *Engine) ReversePosition(ctx context.Context, position *Position, currentPrice float64, suggestion *PositionSuggestion, reason string) error {
	logger.Info("Reversing position",
		zap.String("position_id", position.ID),
		zap.Float64("current_price", currentPrice),
		zap.String("reason", reason),
	)

	// Close current position
	if err := e.ClosePosition(ctx, position, currentPrice, "reverse"); err != nil {
		return err
	}

	// TODO: Open new opposite position
	// This would require account reference

	logger.Info("Position reversed successfully",
		zap.String("position_id", position.ID),
	)

	return nil
}

// UpdateUnrealizedPnL updates unrealized PnL for all open positions
func (e *Engine) UpdateUnrealizedPnL(ctx context.Context, positions []*Position, currentPrice float64) error {
	for _, position := range positions {
		if position.Status != "open" {
			continue
		}

		position.CurrentPrice = currentPrice
		position.UnrealizedPnL = e.calculateUnrealizedPnL(position, currentPrice)

		// TODO: Update position in database
	}

	return nil
}

// CheckSLTP checks if any positions hit SL or TP
func (e *Engine) CheckSLTP(ctx context.Context, positions []*Position, candleHigh, candleLow float64) ([]*Position, error) {
	closedPositions := make([]*Position, 0)

	for _, position := range positions {
		if position.Status != "open" {
			continue
		}

		var hitSL, hitTP bool

		if position.Side == "long" {
			// Long position: SL is below entry, TP is above entry
			if candleLow <= position.StopLoss {
				hitSL = true
			}
			if candleHigh >= position.TakeProfit {
				hitTP = true
			}
		} else {
			// Short position: SL is above entry, TP is below entry
			if candleHigh >= position.StopLoss {
				hitSL = true
			}
			if candleLow <= position.TakeProfit {
				hitTP = true
			}
		}

		if hitSL && hitTP {
			// Both hit - prioritize SL for risk management
			if err := e.ClosePosition(ctx, position, position.StopLoss, "sl_tp_hit"); err != nil {
				logger.Error("Failed to close position on SL/TP hit", zap.Error(err))
			} else {
				closedPositions = append(closedPositions, position)
			}
		} else if hitSL {
			if err := e.ClosePosition(ctx, position, position.StopLoss, "sl_hit"); err != nil {
				logger.Error("Failed to close position on SL hit", zap.Error(err))
			} else {
				closedPositions = append(closedPositions, position)
			}
		} else if hitTP {
			if err := e.ClosePosition(ctx, position, position.TakeProfit, "tp_hit"); err != nil {
				logger.Error("Failed to close position on TP hit", zap.Error(err))
			} else {
				closedPositions = append(closedPositions, position)
			}
		}
	}

	return closedPositions, nil
}

// EvaluateAutoEntry evaluates whether to auto-enter a position
func (e *Engine) EvaluateAutoEntry(analysis map[string]interface{}, account *Account, openPositions []*Position, methodID string) (*AutoEntryDecision, error) {
	logger.Info("Evaluating auto-entry",
		zap.String("method_id", methodID),
		zap.Int("open_positions", len(openPositions)),
	)

	// Get method-specific confidence threshold
	confidenceThreshold := config.AppConfig.Analysis.AutoEntryConfidenceThreshold
	if methodID == "ict" {
		confidenceThreshold = config.AppConfig.Analysis.ICTConfidenceThreshold
	} else if methodID == "kim_nghia" {
		confidenceThreshold = config.AppConfig.Analysis.KimNghiaConfidenceThreshold
	}

	// Extract confidence from analysis
	confidence, ok := analysis["confidence"].(float64)
	if !ok {
		return &AutoEntryDecision{
			ShouldEnter: false,
			Action:      "hold",
			Reason:      "no confidence score in analysis",
		}, nil
	}

	// Check confidence threshold
	if confidence < confidenceThreshold {
		return &AutoEntryDecision{
			ShouldEnter: false,
			Action:      "hold",
			Reason:      fmt.Sprintf("confidence %.2f below threshold %.2f", confidence, confidenceThreshold),
		}, nil
	}

	// Extract suggested position data
	suggestedEntry, _ := analysis["suggested_entry"].(float64)
	suggestedSL, _ := analysis["stop_loss"].(float64)
	suggestedTP, _ := analysis["take_profit"].(float64)
	expectedRR, _ := analysis["expected_rr"].(float64)
	invalidationLevel, _ := analysis["invalidation_level"].(float64)
	bias, _ := analysis["bias"].(string)

	if suggestedEntry == 0 || suggestedSL == 0 || suggestedTP == 0 {
		return &AutoEntryDecision{
			ShouldEnter: false,
			Action:      "hold",
			Reason:      "incomplete position data in analysis",
		}, nil
	}

	// Validate RR ratio
	if expectedRR < config.AppConfig.Trading.MinRRRatio {
		return &AutoEntryDecision{
			ShouldEnter: false,
			Action:      "hold",
			Reason:      fmt.Sprintf("RR ratio %.2f below minimum %.2f", expectedRR, config.AppConfig.Trading.MinRRRatio),
		}, nil
	}

	// Validate SL distance
	slDistance := math.Abs(suggestedEntry-suggestedSL) / suggestedEntry
	if slDistance < config.AppConfig.Trading.MinSLDistance {
		return &AutoEntryDecision{
			ShouldEnter: false,
			Action:      "hold",
			Reason:      fmt.Sprintf("SL distance %.4f below minimum %.4f", slDistance, config.AppConfig.Trading.MinSLDistance),
		}, nil
	}

	// Determine side from bias
	side := "long"
	if bias == "bearish" || bias == "strong_downtrend" || bias == "downtrend" {
		side = "short"
	}

	// Calculate position size based on risk
	riskPercent := config.AppConfig.Trading.RiskPercent
	riskUSD := account.Balance * riskPercent
	sizeUSD := riskUSD / slDistance * suggestedEntry
	sizeQty := sizeUSD / suggestedEntry

	// Create position suggestion
	suggestion := &PositionSuggestion{
		Side:              side,
		EntryPrice:        suggestedEntry,
		StopLoss:          suggestedSL,
		TakeProfit:        suggestedTP,
		SizeUSD:           sizeUSD,
		SizeQty:           sizeQty,
		RiskUSD:           riskUSD,
		RiskPercent:       riskPercent,
		ExpectedRR:        expectedRR,
		InvalidationLevel: invalidationLevel,
	}

	// Determine order type (market vs limit)
	// Use market if current price is close to entry, otherwise use limit
	currentPrice, _ := analysis["current_price"].(float64)
	priceDistance := math.Abs(currentPrice-suggestedEntry) / suggestedEntry
	orderType := "limit"
	if priceDistance < 0.001 { // Within 0.1%
		orderType = "market"
	}

	return &AutoEntryDecision{
		ShouldEnter:       true,
		Action:            orderType,
		Reason:            fmt.Sprintf("confidence %.2f meets threshold %.2f, RR %.2f", confidence, confidenceThreshold, expectedRR),
		SuggestedPosition: suggestion,
		OrderType:         orderType,
	}, nil
}

// validatePosition validates position parameters
func (e *Engine) validatePosition(suggestion *PositionSuggestion) error {
	if suggestion.EntryPrice <= 0 {
		return errors.NewValidationError("entry price must be positive")
	}
	if suggestion.StopLoss <= 0 {
		return errors.NewValidationError("stop loss must be positive")
	}
	if suggestion.TakeProfit <= 0 {
		return errors.NewValidationError("take profit must be positive")
	}
	if suggestion.SizeUSD <= 0 {
		return errors.NewValidationError("size USD must be positive")
	}
	if suggestion.SizeQty <= 0 {
		return errors.NewValidationError("size quantity must be positive")
	}
	if suggestion.RiskUSD <= 0 {
		return errors.NewValidationError("risk USD must be positive")
	}
	if suggestion.RiskPercent <= 0 || suggestion.RiskPercent > 1 {
		return errors.NewValidationError("risk percent must be between 0 and 1")
	}
	if suggestion.ExpectedRR < 0 {
		return errors.NewValidationError("expected RR must be non-negative")
	}

	// Validate SL/TP placement based on side
	if suggestion.Side == "long" {
		if suggestion.StopLoss >= suggestion.EntryPrice {
			return errors.NewValidationError("long position SL must be below entry")
		}
		if suggestion.TakeProfit <= suggestion.EntryPrice {
			return errors.NewValidationError("long position TP must be above entry")
		}
	} else if suggestion.Side == "short" {
		if suggestion.StopLoss <= suggestion.EntryPrice {
			return errors.NewValidationError("short position SL must be above entry")
		}
		if suggestion.TakeProfit >= suggestion.EntryPrice {
			return errors.NewValidationError("short position TP must be below entry")
		}
	}

	return nil
}

// calculateRealizedPnL calculates realized PnL for a closed position
func (e *Engine) calculateRealizedPnL(position *Position, exitPrice float64) float64 {
	if position.Side == "long" {
		return (exitPrice - position.EntryPrice) * position.SizeQty
	}
	// Short position
	return (position.EntryPrice - exitPrice) * position.SizeQty
}

// calculateUnrealizedPnL calculates unrealized PnL for an open position
func (e *Engine) calculateUnrealizedPnL(position *Position, currentPrice float64) float64 {
	if position.Side == "long" {
		return (currentPrice - position.EntryPrice) * position.SizeQty
	}
	// Short position
	return (position.EntryPrice - currentPrice) * position.SizeQty
}

// generateID generates a unique ID
func generateID() string {
	return fmt.Sprintf("pos_%d", time.Now().UnixNano())
}
