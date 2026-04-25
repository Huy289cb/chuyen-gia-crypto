package integration

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chuyen-gia-crypto/backend/internal/handlers"
	"github.com/chuyen-gia-crypto/backend/internal/middleware"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/gin-gonic/gin"
)

func setupTestRouter() *gin.Engine {
	// Initialize logger for tests
	logger.Init("info", "json")

	// Initialize rate limiter for tests
	middleware.InitRateLimiter(100, 60) // 100 requests per 60 seconds

	// Initialize WebSocket hub for tests
	handlers.InitHub()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	handlers.SetupRoutes(r)
	return r
}

func TestHealthEndpoint(t *testing.T) {
	r := setupTestRouter()

	req, _ := http.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var response map[string]string
	err := json.Unmarshal(w.Body.Bytes(), &response)
	if err != nil {
		t.Errorf("Failed to parse response: %v", err)
	}

	if response["status"] != "healthy" {
		t.Errorf("Expected status 'healthy', got '%s'", response["status"])
	}
}

func TestRootEndpoint(t *testing.T) {
	r := setupTestRouter()

	req, _ := http.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var response map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &response)
	if err != nil {
		t.Errorf("Failed to parse response: %v", err)
	}

	if response["name"] != "Crypto Trend Analyzer API" {
		t.Errorf("Unexpected API name: %v", response["name"])
	}
}

func TestAnalysisEndpoint(t *testing.T) {
	r := setupTestRouter()

	req, _ := http.NewRequest("GET", "/api/analysis", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Should return 200, 500, or 503 (if dependencies not initialized)
	if w.Code != http.StatusOK && w.Code != http.StatusInternalServerError && w.Code != http.StatusServiceUnavailable {
		t.Errorf("Expected status 200, 500, or 503, got %d", w.Code)
	}
}

func TestTriggerAnalysisEndpoint(t *testing.T) {
	r := setupTestRouter()

	req, _ := http.NewRequest("POST", "/api/analysis/trigger", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Should return 200, 500, or 501 (if dependencies not initialized)
	if w.Code != http.StatusOK && w.Code != http.StatusInternalServerError && w.Code != http.StatusNotImplemented {
		t.Errorf("Expected status 200, 500, or 501, got %d", w.Code)
	}
}

func TestPositionsEndpoint(t *testing.T) {
	r := setupTestRouter()

	// Test GET
	req, _ := http.NewRequest("GET", "/api/positions", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK && w.Code != http.StatusInternalServerError && w.Code != http.StatusServiceUnavailable {
		t.Errorf("Expected status 200, 500, or 503, got %d", w.Code)
	}

	// Test POST
	positionData := map[string]interface{}{
		"symbol":      "BTC",
		"side":        "BUY",
		"entry_price": 50000.0,
		"stop_loss":   49000.0,
		"take_profit": 52000.0,
		"size_usd":    100.0,
	}
	jsonData, _ := json.Marshal(positionData)

	req, _ = http.NewRequest("POST", "/api/positions", bytes.NewBuffer(jsonData))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Should return 201, 500, or 501 (if database not initialized)
	if w.Code != http.StatusCreated && w.Code != http.StatusInternalServerError && w.Code != http.StatusNotImplemented {
		t.Errorf("Expected status 201, 500, or 501, got %d", w.Code)
	}
}

func TestAccountsEndpoint(t *testing.T) {
	r := setupTestRouter()

	// Test GET
	req, _ := http.NewRequest("GET", "/api/accounts", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK && w.Code != http.StatusInternalServerError && w.Code != http.StatusServiceUnavailable {
		t.Errorf("Expected status 200, 500, or 503, got %d", w.Code)
	}

	// Test POST reset
	req, _ = http.NewRequest("POST", "/api/accounts/reset", nil)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Should return 200, 400, or 500 (if database not initialized)
	if w.Code != http.StatusOK && w.Code != http.StatusBadRequest && w.Code != http.StatusInternalServerError {
		t.Errorf("Expected status 200, 400, or 500, got %d", w.Code)
	}
}

func TestPerformanceEndpoints(t *testing.T) {
	r := setupTestRouter()

	endpoints := []string{
		"/api/performance/metrics",
		"/api/performance/equity-curve",
		"/api/performance/trades",
	}

	for _, endpoint := range endpoints {
		req, _ := http.NewRequest("GET", endpoint, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		// Should return 200, 500, 501, or 503 (if database not initialized)
		if w.Code != http.StatusOK && w.Code != http.StatusInternalServerError && w.Code != http.StatusNotImplemented && w.Code != http.StatusServiceUnavailable {
			t.Errorf("Endpoint %s: Expected status 200, 500, 501, or 503, got %d", endpoint, w.Code)
		}
	}
}

func TestTestnetEndpoints(t *testing.T) {
	r := setupTestRouter()

	endpoints := []string{
		"/api/testnet/positions",
		"/api/testnet/accounts",
	}

	for _, endpoint := range endpoints {
		req, _ := http.NewRequest("GET", endpoint, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		// Should return 200 or 501 (if testnet not initialized)
		if w.Code != http.StatusOK && w.Code != http.StatusNotImplemented {
			t.Errorf("Endpoint %s: Expected status 200 or 501, got %d", endpoint, w.Code)
		}
	}
}

func TestMetricsEndpoint(t *testing.T) {
	r := setupTestRouter()

	req, _ := http.NewRequest("GET", "/metrics", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	// Metrics should return text content-type
	contentType := w.Header().Get("Content-Type")
	if contentType == "" {
		t.Errorf("Expected Content-Type to be set, got empty string")
	}
}
