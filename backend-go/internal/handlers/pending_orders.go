package handlers

import (
	"net/http"

	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// GetPendingOrders handles GET /api/pending-orders
func GetPendingOrders(c *gin.Context) {
	method := c.DefaultQuery("method", "ict")
	symbol := c.Query("symbol")

	logger.Info("GET /api/pending-orders called",
		zap.String("method", method),
		zap.String("symbol", symbol),
	)

	if Deps == nil || Deps.PendingOrderRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Pending order repository not initialized",
		})
		return
	}

	var orders interface{}
	var err error

	if symbol != "" {
		orders, err = Deps.PendingOrderRepo.GetBySymbol(c.Request.Context(), symbol)
	} else {
		orders, err = Deps.PendingOrderRepo.GetByStatus(c.Request.Context(), "pending")
	}

	if err != nil {
		logger.Error("Failed to get pending orders", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to retrieve pending orders",
		})
		return
	}

	// Convert to DTO with proper time formatting
	// Type assertion to handle both slice and single order
	orderSlice, ok := orders.([]*ent.PendingOrder)
	if !ok {
		// If it's a single order or different type, return as-is for now
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"data":    orders,
		})
		return
	}

	result := make([]gin.H, len(orderSlice))
	for i, order := range orderSlice {
		result[i] = gin.H{
			"id":                   order.ID,
			"order_id":             order.OrderID,
			"account_id":           order.AccountID,
			"symbol":               order.Symbol,
			"side":                 order.Side,
			"entry_price":          order.EntryPrice,
			"stop_loss":            order.StopLoss,
			"take_profit":          order.TakeProfit,
			"size_usd":             order.SizeUsd,
			"size_qty":             order.SizeQty,
			"risk_usd":             order.RiskUsd,
			"risk_percent":         order.RiskPercent,
			"expected_rr":          order.ExpectedRr,
			"linked_prediction_id": order.LinkedPredictionID,
			"invalidation_level":   order.InvalidationLevel,
			"status":               order.Status,
			"created_at":           formatTime(order.CreatedAt),
			"executed_at":          formatTimePtr(order.ExecutedAt),
			"executed_price":       order.ExecutedPrice,
			"executed_size_qty":    order.ExecutedSizeQty,
			"executed_size_usd":    order.ExecutedSizeUsd,
			"realized_pnl":         order.RealizedPnl,
			"realized_pnl_percent": order.RealizedPnlPercent,
			"close_reason":         order.CloseReason,
			"binance_order_id":     order.BinanceOrderID,
			"method_id":            order.MethodID,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}
