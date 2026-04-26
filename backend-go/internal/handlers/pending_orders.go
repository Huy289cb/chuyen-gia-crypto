package handlers

import (
	"net/http"

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

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    orders,
	})
}
