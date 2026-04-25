package handlers

import (
	"net/http"

	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/gin-gonic/gin"
)

// GetPositions handles GET /api/positions
func GetPositions(c *gin.Context) {
	logger.Info("GET /api/positions called")

	// TODO: Implement positions retrieval
	// This should fetch positions from database with optional filters

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"message": "Positions endpoint - TODO: implement"},
	})
}

// CreatePosition handles POST /api/positions
func CreatePosition(c *gin.Context) {
	logger.Info("POST /api/positions called")

	// TODO: Implement position creation
	// This should create a new position from request body

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Position created successfully",
	})
}

// GetPosition handles GET /api/positions/:id
func GetPosition(c *gin.Context) {
	_ = c.Param("id")
	logger.Info("GET /api/positions/:id called")

	// TODO: Implement single position retrieval

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"message": "Position detail endpoint - TODO: implement"},
	})
}
