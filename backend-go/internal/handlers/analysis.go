package handlers

import (
	"fmt"
	"net/http"

	"github.com/chuyen-gia-crypto/backend/internal/analyzers"
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
		// Return 200 with null data instead of 404
		// This allows frontend to handle "no analysis" state gracefully
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"data":    nil,
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

	// Get method from query parameter (default to kim_nghia)
	method := c.DefaultQuery("method", "kim_nghia")

	// Get coin from query parameter (default to BTC)
	coin := c.DefaultQuery("coin", "BTC")

	// Trigger analysis using the analyzer
	if Deps == nil || Deps.Analyzer == nil {
		logger.Error("Analyzer not initialized")
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Analyzer not initialized",
		})
		return
	}

	ctx := c.Request.Context()

	var result *analyzers.AnalysisResult
	var err error
	if method == "kim_nghia" {
		result, err = Deps.Analyzer.RunKimNghiaAnalysis(ctx, coin)
	} else if method == "ict" {
		result, err = Deps.Analyzer.RunICTAnalysis(ctx, coin)
	} else {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid method. Use 'kim_nghia' or 'ict'",
		})
		return
	}

	if err != nil {
		logger.Error("Failed to trigger analysis", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": fmt.Sprintf("Analysis triggered successfully for %s using %s method", coin, method),
		"data":    result,
	})
}
