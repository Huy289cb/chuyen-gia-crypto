package handlers

import (
	"net/http"
	"strconv"

	"github.com/chuyen-gia-crypto/backend/internal/services/pricefetcher"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// GetOHLC handles GET /api/ohlc/:symbol
func GetOHLC(c *gin.Context) {
	symbol := c.Param("symbol")
	timeframe := c.DefaultQuery("timeframe", "15m")
	limitStr := c.DefaultQuery("limit", "100")

	logger.Info("GET /api/ohlc called",
		zap.String("symbol", symbol),
		zap.String("timeframe", timeframe),
		zap.String("limit", limitStr),
	)

	// Validate symbol
	if symbol != "btc" && symbol != "eth" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid symbol. Must be 'btc' or 'eth'",
		})
		return
	}

	// Parse limit
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit <= 0 || limit > 1000 {
		limit = 100
	}

	// Convert symbol to Binance format
	binanceSymbol := "BTCUSDT"
	if symbol == "eth" {
		binanceSymbol = "ETHUSDT"
	}

	// Fetch OHLC data from Binance
	data, err := pricefetcher.FetchOHLCFromBinance(binanceSymbol, timeframe, limit)
	if err != nil {
		logger.Error("Failed to fetch OHLC data", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to fetch OHLC data",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"symbol":    symbol,
			"timeframe": timeframe,
			"limit":     limit,
			"ohlc":      data,
		},
	})
}
