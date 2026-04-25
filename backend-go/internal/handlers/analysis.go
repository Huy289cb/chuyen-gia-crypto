package handlers

import (
	"net/http"

	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/gin-gonic/gin"
)

// GetAnalysis handles GET /api/analysis
func GetAnalysis(c *gin.Context) {
	logger.Info("GET /api/analysis called")

	// TODO: Implement analysis retrieval
	// This should fetch the latest analysis from cache or database

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"message": "Analysis endpoint - TODO: implement"},
	})
}

// TriggerAnalysis handles POST /api/analysis/trigger
func TriggerAnalysis(c *gin.Context) {
	logger.Info("POST /api/analysis/trigger called")

	// TODO: Implement manual analysis trigger
	// This should trigger an immediate analysis run

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "Analysis triggered successfully",
	})
}
