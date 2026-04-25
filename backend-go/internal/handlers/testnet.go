package handlers

import (
	"net/http"
	"strconv"

	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// GetTestnetPositions handles GET /api/testnet/positions
func GetTestnetPositions(c *gin.Context) {
	logger.Info("GET /api/testnet/positions called")

	_ = c.Query("symbol")
	_ = c.Query("status")

	// TODO: Implement testnet positions retrieval
	// This should fetch testnet positions from database with optional filters

	c.JSON(http.StatusNotImplemented, gin.H{
		"success": false,
		"error":   "Testnet positions not yet implemented",
	})
}

// CreateTestnetPosition handles POST /api/testnet/positions
func CreateTestnetPosition(c *gin.Context) {
	logger.Info("POST /api/testnet/positions called")

	// TODO: Implement testnet position creation
	// This should create a new testnet position from request body

	c.JSON(http.StatusNotImplemented, gin.H{
		"success": false,
		"error":   "Testnet position creation not yet implemented",
	})
}

// GetTestnetPosition handles GET /api/testnet/positions/:id
func GetTestnetPosition(c *gin.Context) {
	idStr := c.Param("id")
	logger.Info("GET /api/testnet/positions/:id called", zap.String("id", idStr))

	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid position ID",
		})
		return
	}

	// TODO: Implement single testnet position retrieval

	c.JSON(http.StatusNotImplemented, gin.H{
		"success": false,
		"error":   "Testnet position detail not yet implemented",
		"data":    gin.H{"id": id},
	})
}

// GetTestnetAccounts handles GET /api/testnet/accounts
func GetTestnetAccounts(c *gin.Context) {
	logger.Info("GET /api/testnet/accounts called")

	// TODO: Implement testnet accounts retrieval

	c.JSON(http.StatusNotImplemented, gin.H{
		"success": false,
		"error":   "Testnet accounts not yet implemented",
	})
}

// ResetTestnetAccount handles POST /api/testnet/accounts/reset
func ResetTestnetAccount(c *gin.Context) {
	logger.Info("POST /api/testnet/accounts/reset called")

	symbol := c.Query("symbol")
	methodID := c.Query("method_id")

	if symbol == "" || methodID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "symbol and method_id are required",
		})
		return
	}

	// TODO: Implement testnet account reset

	c.JSON(http.StatusNotImplemented, gin.H{
		"success": false,
		"error":   "Testnet account reset not yet implemented",
	})
}
