package middleware

import (
	"net/http"
	"strings"

	"github.com/chuyen-gia-crypto/backend/internal/config"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// AuthMiddleware provides authentication middleware
type AuthMiddleware struct {
	apiKeys map[string]bool
}

// NewAuthMiddleware creates a new authentication middleware
func NewAuthMiddleware() *AuthMiddleware {
	apiKeys := make(map[string]bool)
	for _, key := range config.AppConfig.Auth.APIKeys {
		apiKeys[key] = true
	}

	return &AuthMiddleware{
		apiKeys: apiKeys,
	}
}

// Authenticate provides authentication middleware using API keys
func (am *AuthMiddleware) Authenticate() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")

		if authHeader == "" {
			logger.Warn("Missing authorization header", zap.String("path", c.Request.URL.Path))
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Authorization header required",
			})
			c.Abort()
			return
		}

		// Check for API key with prefix
		if strings.HasPrefix(authHeader, "ApiKey ") {
			apiKey := strings.TrimPrefix(authHeader, "ApiKey ")
			if !am.validateAPIKey(apiKey) {
				logger.Warn("Invalid API key", zap.String("path", c.Request.URL.Path))
				c.JSON(http.StatusUnauthorized, gin.H{
					"error": "Invalid API key",
				})
				c.Abort()
				return
			}
			c.Next()
			return
		}

		// Try as raw API key (no prefix)
		if am.validateAPIKey(authHeader) {
			c.Next()
			return
		}

		logger.Warn("Invalid authorization format", zap.String("path", c.Request.URL.Path))
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Invalid authorization format. Use 'ApiKey <your-key>' or just the key",
		})
		c.Abort()
	}
}

// validateAPIKey validates an API key
func (am *AuthMiddleware) validateAPIKey(apiKey string) bool {
	if len(am.apiKeys) == 0 {
		// If no API keys configured, allow all (for development)
		logger.Debug("No API keys configured, allowing all requests")
		return true
	}
	return am.apiKeys[apiKey]
}

// OptionalAuth provides optional authentication - doesn't abort if auth fails
func (am *AuthMiddleware) OptionalAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")

		if authHeader == "" {
			// No auth provided, continue without setting user context
			c.Next()
			return
		}

		// Try to authenticate but don't abort on failure
		if strings.HasPrefix(authHeader, "ApiKey ") {
			apiKey := strings.TrimPrefix(authHeader, "ApiKey ")
			if am.validateAPIKey(apiKey) {
				c.Set("authenticated", true)
			}
		} else if am.validateAPIKey(authHeader) {
			c.Set("authenticated", true)
		}

		c.Next()
	}
}

// RequireAuth is a convenience function that uses the global auth middleware
func RequireAuth() gin.HandlerFunc {
	am := NewAuthMiddleware()
	return am.Authenticate()
}

// OptionalAuthMiddleware is a convenience function for optional auth
func OptionalAuthMiddleware() gin.HandlerFunc {
	am := NewAuthMiddleware()
	return am.OptionalAuth()
}

// Global auth middleware instance
var globalAuth *AuthMiddleware

// InitAuth initializes the global auth middleware
func InitAuth() {
	globalAuth = NewAuthMiddleware()
	logger.Info("Authentication middleware initialized")
}
