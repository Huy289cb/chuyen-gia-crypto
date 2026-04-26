package handlers

import (
	"net/http"

	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// GetAccounts handles GET /api/accounts
func GetAccounts(c *gin.Context) {
	logger.Info("GET /api/accounts called")

	if Deps == nil || Deps.AccountRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Database not initialized",
		})
		return
	}

	accounts, err := Deps.AccountRepo.GetAll(c.Request.Context())
	if err != nil {
		logger.Error("Failed to get accounts", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to retrieve accounts",
		})
		return
	}

	// Convert to DTO with proper time formatting
	result := make([]gin.H, len(accounts))
	for i, acc := range accounts {
		result[i] = gin.H{
			"id":                 acc.ID,
			"symbol":             acc.Symbol,
			"method_id":          acc.MethodID,
			"starting_balance":   acc.StartingBalance,
			"current_balance":    acc.CurrentBalance,
			"equity":             acc.Equity,
			"unrealized_pnl":     acc.UnrealizedPnl,
			"realized_pnl":       acc.RealizedPnl,
			"total_trades":       acc.TotalTrades,
			"winning_trades":     acc.WinningTrades,
			"losing_trades":      acc.LosingTrades,
			"max_drawdown":       acc.MaxDrawdown,
			"consecutive_losses": acc.ConsecutiveLosses,
			"last_trade_time":    formatTimePtr(acc.LastTradeTime),
			"cooldown_until":     formatTimePtr(acc.CooldownUntil),
			"created_at":         formatTime(acc.CreatedAt),
			"updated_at":         formatTime(acc.UpdatedAt),
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

// ResetAccount handles POST /api/accounts/reset
func ResetAccount(c *gin.Context) {
	logger.Info("POST /api/accounts/reset called")

	symbol := c.Query("symbol")
	methodID := c.Query("method_id")

	if symbol == "" || methodID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "symbol and method_id are required",
		})
		return
	}

	if Deps == nil || Deps.AccountRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Database not initialized",
		})
		return
	}

	account, err := Deps.AccountRepo.Reset(c.Request.Context(), symbol, methodID)
	if err != nil {
		logger.Error("Failed to reset account", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to reset account",
		})
		return
	}

	// Convert to DTO with proper time formatting
	result := gin.H{
		"id":                 account.ID,
		"symbol":             account.Symbol,
		"method_id":          account.MethodID,
		"starting_balance":   account.StartingBalance,
		"current_balance":    account.CurrentBalance,
		"equity":             account.Equity,
		"unrealized_pnl":     account.UnrealizedPnl,
		"realized_pnl":       account.RealizedPnl,
		"total_trades":       account.TotalTrades,
		"winning_trades":     account.WinningTrades,
		"losing_trades":      account.LosingTrades,
		"max_drawdown":       account.MaxDrawdown,
		"consecutive_losses": account.ConsecutiveLosses,
		"last_trade_time":    formatTimePtr(account.LastTradeTime),
		"cooldown_until":     formatTimePtr(account.CooldownUntil),
		"created_at":         formatTime(account.CreatedAt),
		"updated_at":         formatTime(account.UpdatedAt),
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}
