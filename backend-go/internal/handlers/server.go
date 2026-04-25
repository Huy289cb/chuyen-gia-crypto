package handlers

import (
	"net/http"

	"github.com/chuyen-gia-crypto/backend/internal/middleware"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/chuyen-gia-crypto/backend/pkg/metrics"
	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// SetupRoutes configures all API routes
func SetupRoutes(r *gin.Engine) {
	// Apply metrics middleware
	r.Use(metrics.Middleware())

	// Apply CORS middleware
	r.Use(middleware.CORS())

	// Apply rate limiting middleware
	r.Use(middleware.RateLimit())

	// API v1 routes
	v1 := r.Group("/api")
	{
		// Analysis routes
		v1.GET("/analysis", GetAnalysis)
		v1.POST("/analysis/trigger", TriggerAnalysis)

		// Position routes
		v1.GET("/positions", GetPositions)
		v1.POST("/positions", CreatePosition)
		v1.GET("/positions/:id", GetPosition)

		// Account routes
		v1.GET("/accounts", GetAccounts)
		v1.POST("/accounts/reset", ResetAccount)

		// Performance routes
		v1.GET("/performance/metrics", GetPerformanceMetrics)
		v1.GET("/performance/equity-curve", GetEquityCurve)
		v1.GET("/performance/trades", GetTradeHistory)

		// Testnet routes
		v1.GET("/testnet/positions", GetTestnetPositions)
		v1.POST("/testnet/positions", CreateTestnetPosition)
		v1.GET("/testnet/positions/:id", GetTestnetPosition)
		v1.GET("/testnet/accounts", GetTestnetAccounts)
		v1.POST("/testnet/accounts/reset", ResetTestnetAccount)
	}

	// Metrics endpoint
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	// Health check endpoint
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "healthy",
		})
	})

	// WebSocket endpoint
	r.GET("/ws", HandleWebSocket)

	// Root endpoint
	r.GET("/", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"name":    "Crypto Trend Analyzer API",
			"version": "2.0.0",
			"endpoints": gin.H{
				"/api/analysis":                 "Get current trend analysis",
				"/api/analysis/trigger":         "Trigger manual analysis",
				"/api/positions":                "Get/Create positions",
				"/api/accounts":                 "Get/Reset accounts",
				"/api/performance/metrics":      "Get performance metrics",
				"/api/performance/equity-curve": "Get equity curve",
				"/api/performance/trades":       "Get trade history",
				"/api/testnet/positions":        "Get/Create testnet positions",
				"/api/testnet/accounts":         "Get/Reset testnet accounts",
				"/metrics":                      "Prometheus metrics",
				"/health":                       "Health check",
			},
		})
	})

	logger.Info("Routes configured successfully")
}
