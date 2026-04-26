package handlers

import (
	"net/http"

	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// GetPerformance handles GET /api/performance (general endpoint)
func GetPerformance(c *gin.Context) {
	symbol := c.Query("symbol")
	method := c.DefaultQuery("method", "ict")

	logger.Info("GET /api/performance called",
		zap.String("symbol", symbol),
		zap.String("method", method),
	)

	if Deps == nil || Deps.AccountRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Account repository not initialized",
		})
		return
	}

	// Get account by symbol and method
	account, err := Deps.AccountRepo.GetBySymbolAndMethod(c.Request.Context(), symbol, method)
	if err != nil {
		logger.Error("Failed to get account", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to retrieve account",
		})
		return
	}

	if account == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "Account not found",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"symbol":          symbol,
			"method":          method,
			"balance":         account.CurrentBalance,
			"equity":          account.Equity,
			"realized_pnl":    account.RealizedPnl,
			"unrealized_pnl":  account.UnrealizedPnl,
			"total_trades":    account.TotalTrades,
			"winning_trades":  account.WinningTrades,
			"losing_trades":   account.LosingTrades,
			"max_drawdown":    account.MaxDrawdown,
			"consecutive_losses": account.ConsecutiveLosses,
		},
	})
}
