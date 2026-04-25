package handlers

import (
	"net/http"

	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/gin-gonic/gin"
)

// GetAccounts handles GET /api/accounts
func GetAccounts(c *gin.Context) {
	logger.Info("GET /api/accounts called")

	// TODO: Implement accounts retrieval

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"message": "Accounts endpoint - TODO: implement"},
	})
}

// ResetAccount handles POST /api/accounts/reset
func ResetAccount(c *gin.Context) {
	logger.Info("POST /api/accounts/reset called")

	// TODO: Implement account reset

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Account reset successfully",
	})
}
