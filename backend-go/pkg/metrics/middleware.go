package metrics

import (
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Middleware returns a Gin middleware for HTTP metrics
func Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		
		// Process request
		c.Next()
		
		// Record metrics
		duration := time.Since(start).Seconds()
		method := c.Request.Method
		endpoint := c.FullPath()
		status := strconv.Itoa(c.Writer.Status())
		
		if endpoint == "" {
			endpoint = c.Request.URL.Path
		}
		
		RecordHTTPRequest(method, endpoint, status)
		ObserveHTTPRequestDuration(method, endpoint, duration)
	}
}

// Handler returns the Prometheus metrics handler
func Handler() gin.HandlerFunc {
	return func(c *gin.Context) {
		promhttp.Handler().ServeHTTP(c.Writer, c.Request)
	}
}
