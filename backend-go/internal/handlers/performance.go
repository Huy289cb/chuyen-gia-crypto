package handlers

import (
	"net/http"

	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// GetPerformanceMetrics handles GET /api/performance/metrics
func GetPerformanceMetrics(c *gin.Context) {
	logger.Info("GET /api/performance/metrics called")

	symbol := c.Query("symbol")
	methodID := c.Query("method_id")

	if Deps == nil || Deps.AccountRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Database not initialized",
		})
		return
	}

	// Get account for the symbol/method
	var account *ent.Account
	var err error
	if symbol != "" && methodID != "" {
		account, err = Deps.AccountRepo.GetBySymbolAndMethod(c.Request.Context(), symbol, methodID)
	} else {
		accounts, err := Deps.AccountRepo.GetAll(c.Request.Context())
		if err == nil && len(accounts) > 0 {
			account = accounts[0]
		}
	}

	if err != nil {
		logger.Error("Failed to get account for metrics", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to retrieve account",
		})
		return
	}

	// Auto-create account if it doesn't exist
	if account == nil && symbol != "" && methodID != "" {
		logger.Warn("Account not found, creating new account", zap.String("symbol", symbol), zap.String("method_id", methodID))

		newAccount := &ent.Account{
			Symbol:            symbol,
			MethodID:          methodID,
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

		logger.Info("Account created successfully", zap.String("symbol", symbol), zap.String("method_id", methodID))
	}

	if account == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "Account not found",
		})
		return
	}

	// Calculate performance metrics from account data
	metrics := gin.H{
		"total_trades":       account.TotalTrades,
		"winning_trades":     account.WinningTrades,
		"losing_trades":      account.LosingTrades,
		"win_rate":           float64(account.WinningTrades) / float64(account.TotalTrades) * 100,
		"realized_pnl":       account.RealizedPnl,
		"unrealized_pnl":     account.UnrealizedPnl,
		"total_pnl":          account.RealizedPnl + account.UnrealizedPnl,
		"max_drawdown":       account.MaxDrawdown,
		"consecutive_losses": account.ConsecutiveLosses,
		"current_balance":    account.CurrentBalance,
		"equity":             account.Equity,
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    metrics,
	})
}

// GetEquityCurve handles GET /api/performance/equity-curve
func GetEquityCurve(c *gin.Context) {
	logger.Info("GET /api/performance/equity-curve called")

	symbol := c.DefaultQuery("symbol", "BTC")
	methodID := c.DefaultQuery("method_id", "kim_nghia")
	limit := 100 // Default limit for snapshots

	if Deps == nil || Deps.AccountRepo == nil || Deps.AccountSnapshotRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Database not initialized",
		})
		return
	}

	// Get account by symbol and method
	account, err := Deps.AccountRepo.GetBySymbolAndMethod(c.Request.Context(), symbol, methodID)
	if err != nil {
		logger.Error("Failed to get account", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to get account",
		})
		return
	}

	// Check if account exists
	if account == nil {
		logger.Warn("Account not found, creating new account", zap.String("symbol", symbol), zap.String("method_id", methodID))

		// Auto-create account with default balance
		newAccount := &ent.Account{
			Symbol:            symbol,
			MethodID:          methodID,
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

		created, err := Deps.AccountRepo.Create(c.Request.Context(), newAccount)
		if err != nil {
			logger.Error("Failed to create account", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"error":   "Failed to create account",
			})
			return
		}

		account = created
		logger.Info("Account created successfully", zap.String("symbol", symbol), zap.String("method_id", methodID))
	}

	// Get snapshots for the account
	snapshots, err := Deps.AccountSnapshotRepo.GetByAccountID(c.Request.Context(), account.ID, limit)
	if err != nil {
		logger.Error("Failed to get account snapshots", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to get equity curve data",
		})
		return
	}

	// Convert snapshots to response format
	equityCurve := make([]map[string]interface{}, 0, len(snapshots))
	for _, snapshot := range snapshots {
		equityCurve = append(equityCurve, map[string]interface{}{
			"timestamp":      snapshot.Timestamp,
			"balance":        snapshot.Balance,
			"equity":         snapshot.Equity,
			"unrealized_pnl": snapshot.UnrealizedPnl,
			"open_positions": snapshot.OpenPositions,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    equityCurve,
	})
}

// GetTradeHistory handles GET /api/performance/trades
func GetTradeHistory(c *gin.Context) {
	logger.Info("GET /api/performance/trades called")

	symbol := c.Query("symbol")
	status := c.DefaultQuery("status", "closed")

	if Deps == nil || Deps.PositionRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Database not initialized",
		})
		return
	}

	positions, err := Deps.PositionRepo.GetAll(c.Request.Context(), symbol, status, "")
	if err != nil {
		logger.Error("Failed to get trade history", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to retrieve trade history",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    positions,
	})
}
