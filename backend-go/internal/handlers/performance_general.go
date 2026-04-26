package handlers

import (
	"net/http"

	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
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

	// Auto-create account if it doesn't exist
	if account == nil {
		logger.Warn("Account not found, creating new account", zap.String("symbol", symbol), zap.String("method", method))

		newAccount := &ent.Account{
			Symbol:            symbol,
			MethodID:          method,
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

		logger.Info("Account created successfully", zap.String("symbol", symbol), zap.String("method", method))
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"symbol":             symbol,
			"method":             method,
			"balance":            account.CurrentBalance,
			"equity":             account.Equity,
			"realized_pnl":       account.RealizedPnl,
			"unrealized_pnl":     account.UnrealizedPnl,
			"total_trades":       account.TotalTrades,
			"winning_trades":     account.WinningTrades,
			"losing_trades":      account.LosingTrades,
			"max_drawdown":       account.MaxDrawdown,
			"consecutive_losses": account.ConsecutiveLosses,
		},
	})
}
