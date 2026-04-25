package handlers

import (
	"net/http"

	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// GetAnalysis handles GET /api/analysis
func GetAnalysis(c *gin.Context) {
	logger.Info("GET /api/analysis called")

	coin := c.DefaultQuery("coin", "BTC")
	methodID := c.DefaultQuery("method_id", "kim_nghia")

	if Deps == nil || Deps.AnalysisRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Database not initialized",
		})
		return
	}

	analysis, err := Deps.AnalysisRepo.GetLatestByCoinAndMethod(c.Request.Context(), coin, methodID)
	if err != nil {
		logger.Error("Failed to get analysis", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to retrieve analysis",
		})
		return
	}

	if analysis == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "No analysis found",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    analysis,
	})
}

// TriggerAnalysis handles POST /api/analysis/trigger
func TriggerAnalysis(c *gin.Context) {
	logger.Info("POST /api/analysis/trigger called")

	// TODO: Implement manual analysis trigger
	// This should trigger an immediate analysis run using the scheduler

	c.JSON(http.StatusNotImplemented, gin.H{
		"success": false,
		"error":   "Manual analysis trigger not yet implemented",
	})
}
