package handlers

import (
	"net/http"

	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/gin-gonic/gin"
)

// GetPerformanceMetrics handles GET /api/performance/metrics
func GetPerformanceMetrics(c *gin.Context) {
	logger.Info("GET /api/performance/metrics called")

	// TODO: Implement performance metrics retrieval

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"message": "Performance metrics endpoint - TODO: implement"},
	})
}

// GetEquityCurve handles GET /api/performance/equity-curve
func GetEquityCurve(c *gin.Context) {
	logger.Info("GET /api/performance/equity-curve called")

	// TODO: Implement equity curve retrieval

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"message": "Equity curve endpoint - TODO: implement"},
	})
}

// GetTradeHistory handles GET /api/performance/trades
func GetTradeHistory(c *gin.Context) {
	logger.Info("GET /api/performance/trades called")

	// TODO: Implement trade history retrieval

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"message": "Trade history endpoint - TODO: implement"},
	})
}
