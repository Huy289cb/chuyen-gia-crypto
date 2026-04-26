package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// GetPositions handles GET /api/positions
func GetPositions(c *gin.Context) {
	logger.Info("GET /api/positions called")

	symbol := c.Query("symbol")
	status := c.Query("status")
	methodID := c.Query("method_id")

	if Deps == nil || Deps.PositionRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Database not initialized",
		})
		return
	}

	positions, err := Deps.PositionRepo.GetAll(c.Request.Context(), symbol, status, methodID)
	if err != nil {
		logger.Error("Failed to get positions", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to retrieve positions",
		})
		return
	}

	// Convert to DTO with proper time formatting
	result := make([]gin.H, len(positions))
	for i, pos := range positions {
		result[i] = gin.H{
			"id":                   pos.ID,
			"position_id":          pos.PositionID,
			"account_id":           pos.AccountID,
			"symbol":               pos.Symbol,
			"side":                 pos.Side,
			"entry_price":          pos.EntryPrice,
			"current_price":        pos.CurrentPrice,
			"stop_loss":            pos.StopLoss,
			"take_profit":          pos.TakeProfit,
			"entry_time":           formatTime(pos.EntryTime),
			"status":               pos.Status,
			"size_usd":             pos.SizeUsd,
			"size_qty":             pos.SizeQty,
			"risk_usd":             pos.RiskUsd,
			"risk_percent":         pos.RiskPercent,
			"expected_rr":          pos.ExpectedRr,
			"realized_pnl":         pos.RealizedPnl,
			"unrealized_pnl":       pos.UnrealizedPnl,
			"close_price":          pos.ClosePrice,
			"close_time":           formatTimePtr(pos.CloseTime),
			"close_reason":         pos.CloseReason,
			"linked_prediction_id": pos.LinkedPredictionID,
			"invalidation_level":   pos.InvalidationLevel,
			"tp1_hit":              pos.Tp1Hit,
			"ict_strategy":         pos.IctStrategy,
			"tp_levels":            pos.TpLevels,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

// CreatePosition handles POST /api/positions
func CreatePosition(c *gin.Context) {
	logger.Info("POST /api/positions called")

	if Deps == nil || Deps.AccountRepo == nil || Deps.PositionRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Database not initialized",
		})
		return
	}

	// Parse request body
	var req struct {
		Symbol            string   `json:"symbol" binding:"required"`
		Side              string   `json:"side" binding:"required"`
		EntryPrice        float64  `json:"entry_price" binding:"required"`
		StopLoss          float64  `json:"stop_loss" binding:"required"`
		TakeProfit        float64  `json:"take_profit" binding:"required"`
		SizeUSD           float64  `json:"size_usd" binding:"required"`
		MethodID          string   `json:"method_id" binding:"required"`
		PredictionID      *int     `json:"prediction_id,omitempty"`
		InvalidationLevel *float64 `json:"invalidation_level,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		logger.Error("Failed to bind request", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid request body",
		})
		return
	}

	// Validate side
	if req.Side != "long" && req.Side != "short" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Side must be 'long' or 'short'",
		})
		return
	}

	// Get or create account for this symbol/method
	account, err := Deps.AccountRepo.GetBySymbolAndMethod(c.Request.Context(), req.Symbol, req.MethodID)
	if err != nil {
		logger.Error("Failed to get account", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to get account",
		})
		return
	}

	if account == nil {
		// Auto-create account with default balance
		newAccount := &ent.Account{
			Symbol:            req.Symbol,
			MethodID:          req.MethodID,
			StartingBalance:   100.0,
			CurrentBalance:    100.0,
			Equity:            100.0,
			UnrealizedPnl:     0,
			RealizedPnl:       0,
			TotalTrades:       0,
			WinningTrades:     0,
			LosingTrades:      0,
			MaxDrawdown:       0,
			ConsecutiveLosses: 0,
		}
		account, err = Deps.AccountRepo.Create(c.Request.Context(), newAccount)
		if err != nil {
			logger.Error("Failed to create account", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"error":   "Failed to create account",
			})
			return
		}
	}

	// Calculate position parameters
	slDistance := 0.0
	if req.Side == "long" {
		slDistance = (req.EntryPrice - req.StopLoss) / req.EntryPrice
	} else {
		slDistance = (req.StopLoss - req.EntryPrice) / req.EntryPrice
	}

	sizeQty := req.SizeUSD / req.EntryPrice
	riskUSD := req.SizeUSD * slDistance
	riskPercent := riskUSD / account.CurrentBalance
	expectedRR := 0.0
	if req.Side == "long" {
		expectedRR = (req.TakeProfit - req.EntryPrice) / (req.EntryPrice - req.StopLoss)
	} else {
		expectedRR = (req.EntryPrice - req.TakeProfit) / (req.StopLoss - req.EntryPrice)
	}

	// Create position entity
	position := &ent.Position{
		PositionID:    generatePositionID(),
		AccountID:     account.ID,
		Symbol:        req.Symbol,
		Side:          req.Side,
		EntryPrice:    req.EntryPrice,
		CurrentPrice:  req.EntryPrice,
		StopLoss:      req.StopLoss,
		TakeProfit:    req.TakeProfit,
		SizeUsd:       req.SizeUSD,
		SizeQty:       sizeQty,
		RiskUsd:       riskUSD,
		RiskPercent:   riskPercent,
		ExpectedRr:    expectedRR,
		Status:        "open",
		EntryTime:     time.Now(),
		UnrealizedPnl: 0,
		RealizedPnl:   0,
		MethodID:      req.MethodID,
		Tp1Hit:        0,
		TpHitCount:    0,
		PartialClosed: 0,
		RMultiple:     0.0,
	}

	// Set optional fields
	if req.InvalidationLevel != nil && *req.InvalidationLevel > 0 {
		position.InvalidationLevel = req.InvalidationLevel
	}
	if req.PredictionID != nil {
		position.LinkedPredictionID = req.PredictionID
	}

	// Save position to database
	createdPosition, err := Deps.PositionRepo.Create(c.Request.Context(), position)
	if err != nil {
		logger.Error("Failed to create position", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to create position",
		})
		return
	}

	// Update account balance
	account.CurrentBalance -= req.SizeUSD
	account.Equity = account.CurrentBalance
	_, err = Deps.AccountRepo.Update(c.Request.Context(), account)
	if err != nil {
		logger.Error("Failed to update account balance", zap.Error(err))
	}

	logger.Info("Position created successfully",
		zap.Int("position_id", createdPosition.ID),
		zap.String("symbol", req.Symbol),
		zap.String("side", req.Side),
	)

	c.JSON(http.StatusCreated, gin.H{
		"success": true,
		"data": gin.H{
			"id":                   createdPosition.ID,
			"position_id":          createdPosition.PositionID,
			"account_id":           createdPosition.AccountID,
			"symbol":               createdPosition.Symbol,
			"side":                 createdPosition.Side,
			"entry_price":          createdPosition.EntryPrice,
			"current_price":        createdPosition.CurrentPrice,
			"stop_loss":            createdPosition.StopLoss,
			"take_profit":          createdPosition.TakeProfit,
			"entry_time":           formatTime(createdPosition.EntryTime),
			"status":               createdPosition.Status,
			"size_usd":             createdPosition.SizeUsd,
			"size_qty":             createdPosition.SizeQty,
			"risk_usd":             createdPosition.RiskUsd,
			"risk_percent":         createdPosition.RiskPercent,
			"expected_rr":          createdPosition.ExpectedRr,
			"realized_pnl":         createdPosition.RealizedPnl,
			"unrealized_pnl":       createdPosition.UnrealizedPnl,
			"method_id":            createdPosition.MethodID,
			"invalidation_level":   createdPosition.InvalidationLevel,
			"linked_prediction_id": createdPosition.LinkedPredictionID,
		},
	})
}

// GetPosition handles GET /api/positions/:id
func GetPosition(c *gin.Context) {
	idStr := c.Param("id")
	logger.Info("GET /api/positions/:id called", zap.String("id", idStr))

	if Deps == nil || Deps.PositionRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Database not initialized",
		})
		return
	}

	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid position ID",
		})
		return
	}

	position, err := Deps.PositionRepo.GetByID(c.Request.Context(), id)
	if err != nil {
		logger.Error("Failed to get position", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to retrieve position",
		})
		return
	}

	if position == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "Position not found",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    position,
	})
}

// generatePositionID generates a unique position ID
func generatePositionID() string {
	return fmt.Sprintf("pos_%d", time.Now().UnixNano())
}
