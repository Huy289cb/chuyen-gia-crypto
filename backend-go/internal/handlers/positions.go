package handlers

import (
	"net/http"
	"strconv"

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

	// TODO: Implement position creation
	// This should create a new position from request body

	c.JSON(http.StatusNotImplemented, gin.H{
		"success": false,
		"error":   "Position creation not yet implemented",
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
