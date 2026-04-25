package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"go.uber.org/zap"
)

// RateLimiter implements a simple in-memory rate limiter
type RateLimiter struct {
	clients map[string]*ClientInfo
	mu      sync.RWMutex
	rate    int           // requests per window
	window  time.Duration
}

// ClientInfo stores rate limit info for a client
type ClientInfo struct {
	requests []time.Time
	mu       sync.Mutex
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter(rate int, window time.Duration) *RateLimiter {
	// Clean up old entries periodically
	limiter := &RateLimiter{
		clients: make(map[string]*ClientInfo),
		rate:    rate,
		window:  window,
	}
	
	go limiter.cleanup()
	
	return limiter
}

// cleanup removes old client entries
func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(rl.window)
	defer ticker.Stop()
	
	for range ticker.C {
		rl.mu.Lock()
		for key, client := range rl.clients {
			client.mu.Lock()
			// Remove requests older than the window
			now := time.Now()
			validRequests := make([]time.Time, 0)
			for _, reqTime := range client.requests {
				if now.Sub(reqTime) < rl.window {
					validRequests = append(validRequests, reqTime)
				}
			}
			client.requests = validRequests
			client.mu.Unlock()
			
			// Remove client if no recent requests
			if len(client.requests) == 0 {
				delete(rl.clients, key)
			}
		}
		rl.mu.Unlock()
	}
}

// Allow checks if a request from the given IP is allowed
func (rl *RateLimiter) Allow(ip string) bool {
	rl.mu.RLock()
	client, exists := rl.clients[ip]
	rl.mu.RUnlock()
	
	if !exists {
		rl.mu.Lock()
		client = &ClientInfo{
			requests: make([]time.Time, 0),
		}
		rl.clients[ip] = client
		rl.mu.Unlock()
	}
	
	client.mu.Lock()
	defer client.mu.Unlock()
	
	now := time.Now()
	
	// Remove old requests
	validRequests := make([]time.Time, 0)
	for _, reqTime := range client.requests {
		if now.Sub(reqTime) < rl.window {
			validRequests = append(validRequests, reqTime)
		}
	}
	client.requests = validRequests
	
	// Check if rate limit exceeded
	if len(client.requests) >= rl.rate {
		return false
	}
	
	// Add current request
	client.requests = append(client.requests, now)
	return true
}

// Global rate limiter instance
var globalLimiter *RateLimiter

// InitRateLimiter initializes the global rate limiter
func InitRateLimiter(rate int, window time.Duration) {
	globalLimiter = NewRateLimiter(rate, window)
	logger.Info("Rate limiter initialized",
		zap.Int("rate", rate),
		zap.Duration("window", window),
	)
}

// RateLimit middleware
func RateLimit() gin.HandlerFunc {
	if globalLimiter == nil {
		// If not initialized, allow all requests
		return func(c *gin.Context) {
			c.Next()
		}
	}
	
	return func(c *gin.Context) {
		ip := c.ClientIP()
		
		if !globalLimiter.Allow(ip) {
			logger.Warn("Rate limit exceeded",
				zap.String("ip", ip),
				zap.String("path", c.Request.URL.Path),
			)
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Rate limit exceeded",
			})
			c.Abort()
			return
		}
		
		c.Next()
	}
}
