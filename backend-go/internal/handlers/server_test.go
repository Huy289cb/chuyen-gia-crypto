package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestSetupRoutes(t *testing.T) {
	// Initialize logger
	logger.Init("info", "console")
	defer logger.Sync()

	// Set Gin to test mode
	gin.SetMode(gin.TestMode)

	// Create a new router
	router := gin.New()

	// Setup routes
	SetupRoutes(router)

	// Test root endpoint
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/", nil)
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "Crypto Trend Analyzer API")
	assert.Contains(t, w.Body.String(), "version")
}

func TestSetupRoutes_AnalysisEndpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	SetupRoutes(router)

	// Test GET /api/analysis
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/analysis", nil)
	router.ServeHTTP(w, req)
	// Should return 404 or 500 since handlers are not implemented
	// but the route should be registered
	assert.NotEqual(t, 404, w.Code)

	// Test POST /api/analysis/trigger
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("POST", "/api/analysis/trigger", nil)
	router.ServeHTTP(w, req)
	assert.NotEqual(t, 404, w.Code)
}

func TestSetupRoutes_PositionEndpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	SetupRoutes(router)

	// Test GET /api/positions
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/positions", nil)
	router.ServeHTTP(w, req)
	assert.NotEqual(t, 404, w.Code)

	// Test POST /api/positions
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("POST", "/api/positions", nil)
	router.ServeHTTP(w, req)
	assert.NotEqual(t, 404, w.Code)

	// Test GET /api/positions/:id
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/api/positions/123", nil)
	router.ServeHTTP(w, req)
	assert.NotEqual(t, 404, w.Code)
}

func TestSetupRoutes_AccountEndpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	SetupRoutes(router)

	// Test GET /api/accounts
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/accounts", nil)
	router.ServeHTTP(w, req)
	assert.NotEqual(t, 404, w.Code)

	// Test POST /api/accounts/reset
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("POST", "/api/accounts/reset", nil)
	router.ServeHTTP(w, req)
	assert.NotEqual(t, 404, w.Code)
}

func TestSetupRoutes_PerformanceEndpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	SetupRoutes(router)

	// Test GET /api/performance/metrics
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/performance/metrics", nil)
	router.ServeHTTP(w, req)
	assert.NotEqual(t, 404, w.Code)

	// Test GET /api/performance/equity-curve
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/api/performance/equity-curve", nil)
	router.ServeHTTP(w, req)
	assert.NotEqual(t, 404, w.Code)

	// Test GET /api/performance/trades
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("GET", "/api/performance/trades", nil)
	router.ServeHTTP(w, req)
	assert.NotEqual(t, 404, w.Code)
}

func TestSetupRoutes_InvalidEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	SetupRoutes(router)

	// Test invalid endpoint
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/invalid", nil)
	router.ServeHTTP(w, req)
	assert.Equal(t, 404, w.Code)
}
