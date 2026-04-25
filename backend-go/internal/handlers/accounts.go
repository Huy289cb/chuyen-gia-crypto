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

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    accounts,
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

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    account,
	})
}
