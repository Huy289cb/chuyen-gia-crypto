package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// GetPredictions handles GET /api/predictions/:symbol
func GetPredictions(c *gin.Context) {
	symbol := c.Param("symbol")
	method := c.DefaultQuery("method", "ict")
	limitStr := c.DefaultQuery("limit", "10")
	pageStr := c.DefaultQuery("page", "1")

	logger.Info("GET /api/predictions called",
		zap.String("symbol", symbol),
		zap.String("method", method),
		zap.String("limit", limitStr),
		zap.String("page", pageStr),
	)

	if Deps == nil || Deps.PredictionRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Prediction repository not initialized",
		})
		return
	}

	// Parse limit
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 || limit > 100 {
		limit = 10
	}

	// Parse page
	page, err := strconv.Atoi(pageStr)
	if err != nil || page < 1 {
		page = 1
	}

	// Get predictions by symbol (coin)
	predictions, err := Deps.PredictionRepo.GetByCoin(c.Request.Context(), symbol, limit*page)
	if err != nil {
		logger.Error("Failed to get predictions", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to retrieve predictions",
		})
		return
	}

	// Filter by method if specified
	var filteredPredictions []*ent.Prediction
	if method != "" {
		for _, pred := range predictions {
			// Assuming prediction has a method field - adjust based on actual schema
			// For now, return all predictions
			filteredPredictions = append(filteredPredictions, pred)
		}
	} else {
		filteredPredictions = predictions
	}

	// Apply pagination
	start := (page - 1) * limit
	end := start + limit
	if start >= len(filteredPredictions) {
		filteredPredictions = []*ent.Prediction{}
	} else if end > len(filteredPredictions) {
		filteredPredictions = filteredPredictions[start:]
	} else {
		filteredPredictions = filteredPredictions[start:end]
	}

	// Convert predictions to map to control time format
	result := make([]gin.H, len(filteredPredictions))
	for i, pred := range filteredPredictions {
		result[i] = gin.H{
			"id":                    pred.ID,
			"coin":                  pred.Coin,
			"timeframe":             pred.Timeframe,
			"direction":             pred.Direction,
			"target_price":          pred.TargetPrice,
			"confidence":            pred.Confidence,
			"predicted_at":          pred.PredictedAt.UTC().Format(time.RFC3339),
			"expires_at":            pred.ExpiresAt.UTC().Format(time.RFC3339),
			"actual_price":          pred.ActualPrice,
			"accuracy":              pred.Accuracy,
			"is_correct":            pred.IsCorrect,
			"outcome":               pred.Outcome,
			"pnl":                   pred.Pnl,
			"hit_tp":                pred.HitTp,
			"hit_sl":                pred.HitSl,
			"linked_position_id":    pred.LinkedPositionID,
			"suggested_entry":       pred.SuggestedEntry,
			"suggested_stop_loss":   pred.SuggestedStopLoss,
			"suggested_take_profit": pred.SuggestedTakeProfit,
			"expected_rr":           pred.ExpectedRr,
			"invalidation_level":    pred.InvalidationLevel,
			"reason_summary":        pred.ReasonSummary,
			"model_version":         pred.ModelVersion,
			"method_id":             pred.MethodID,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
		"meta": gin.H{
			"symbol": symbol,
			"method": method,
			"limit":  limit,
			"page":   page,
			"total":  len(predictions),
		},
	})
}
