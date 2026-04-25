package pricefetcher

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseFloat(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected float64
	}{
		{"valid float", "123.45", 123.45},
		{"integer", "100", 100.0},
		{"zero", "0", 0.0},
		{"empty string", "", 0.0},
		{"invalid string", "abc", 0.0},
		{"negative", "-50.5", -50.5},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseFloat(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestCalculateTrend(t *testing.T) {
	tests := []struct {
		name     string
		prices   []float64
		expected string
	}{
		{
			name:     "strong uptrend",
			prices:   []float64{100, 110, 120, 130, 140},
			expected: "strong_uptrend",
		},
		{
			name:     "uptrend",
			prices:   []float64{100, 105, 110, 115, 120},
			expected: "strong_uptrend",
		},
		{
			name:     "bullish",
			prices:   []float64{100, 102, 104, 106, 108},
			expected: "strong_uptrend",
		},
		{
			name:     "neutral",
			prices:   []float64{100, 100.5, 99.5, 100, 100.2},
			expected: "neutral",
		},
		{
			name:     "bearish",
			prices:   []float64{100, 98, 96, 94, 92},
			expected: "strong_downtrend",
		},
		{
			name:     "downtrend",
			prices:   []float64{100, 95, 90, 85, 80},
			expected: "strong_downtrend",
		},
		{
			name:     "strong downtrend",
			prices:   []float64{100, 85, 70, 55, 40},
			expected: "strong_downtrend",
		},
		{
			name:     "single price",
			prices:   []float64{100},
			expected: "neutral",
		},
		{
			name:     "empty array",
			prices:   []float64{},
			expected: "neutral",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := CalculateTrend(tt.prices)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestCalculateConfidence(t *testing.T) {
	tests := []struct {
		name     string
		trends   map[string]string
		expected float64
	}{
		{
			name:     "high bullish agreement",
			trends:   map[string]string{"15m": "uptrend", "1h": "uptrend", "4h": "uptrend", "1d": "uptrend"},
			expected: 0.80,
		},
		{
			name:     "high bearish agreement",
			trends:   map[string]string{"15m": "downtrend", "1h": "downtrend", "4h": "downtrend", "1d": "downtrend"},
			expected: 0.80,
		},
		{
			name:     "moderate bullish",
			trends:   map[string]string{"15m": "uptrend", "1h": "uptrend", "4h": "neutral", "1d": "neutral"},
			expected: 0.70,
		},
		{
			name:     "moderate bearish",
			trends:   map[string]string{"15m": "downtrend", "1h": "downtrend", "4h": "neutral", "1d": "neutral"},
			expected: 0.70,
		},
		{
			name:     "mixed bullish",
			trends:   map[string]string{"15m": "uptrend", "1h": "downtrend", "4h": "uptrend", "1d": "neutral"},
			expected: 0.60,
		},
		{
			name:     "mostly neutral",
			trends:   map[string]string{"15m": "neutral", "1h": "neutral", "4h": "neutral", "1d": "uptrend"},
			expected: 0.50,
		},
		{
			name:     "low agreement",
			trends:   map[string]string{"15m": "uptrend", "1h": "downtrend", "4h": "neutral", "1d": "bearish"},
			expected: 0.60,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := CalculateConfidence(tt.trends)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestExtractCloses(t *testing.T) {
	data := []PriceData{
		{Price: 100.0},
		{Price: 101.0},
		{Price: 102.0},
	}

	result := extractCloses(data)
	assert.Equal(t, []float64{100.0, 101.0, 102.0}, result)
}

func TestParseKlineToPriceData(t *testing.T) {
	kline := []interface{}{
		float64(1609459200000), // openTime
		"100.0",                // open
		"105.0",                // high
		"98.0",                 // low
		"103.0",                // close
		"1000.0",               // volume
	}

	result := parseKlineToPriceData(kline)
	assert.Equal(t, 103.0, result.Price)
	assert.Equal(t, 100.0, result.Open)
	assert.Equal(t, 105.0, result.High)
	assert.Equal(t, 98.0, result.Low)
	assert.Equal(t, 1000.0, result.Volume)
	assert.Equal(t, time.Unix(1609459200, 0), result.Time)
}

func TestHTTPClient_FetchWithTimeout(t *testing.T) {
	// Create a test server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"test": "data"}`))
	}))
	defer server.Close()

	client := NewHTTPClient()
	body, err := client.fetchWithTimeout(server.URL)
	require.NoError(t, err)
	assert.Equal(t, []byte(`{"test": "data"}`), body)
}

func TestHTTPClient_FetchWithTimeout_Error(t *testing.T) {
	// Test with invalid URL
	client := NewHTTPClient()
	_, err := client.fetchWithTimeout("http://invalid-url-that-does-not-exist.local")
	assert.Error(t, err)
}

func TestHTTPClient_FetchWithTimeout_Non200Status(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	client := NewHTTPClient()
	_, err := client.fetchWithTimeout(server.URL)
	assert.Error(t, err)
}

func TestFetchRealTimePrices_Mock(t *testing.T) {
	// This test would require mocking the Binance API
	// For now, we'll skip it as it requires external API mocking
	t.Skip("Requires Binance API mocking")
}

func TestFetchFromBinance_Mock(t *testing.T) {
	// This test would require mocking the Binance API
	// For now, we'll skip it as it requires external API mocking
	t.Skip("Requires Binance API mocking")
}

func TestFetchFearGreedIndex_Mock(t *testing.T) {
	// This test would require mocking the Fear & Greed API
	// For now, we'll skip it as it requires external API mocking
	t.Skip("Requires Fear & Greed API mocking")
}

func TestBinanceTicker_Unmarshal(t *testing.T) {
	jsonData := `{
		"symbol": "BTCUSDT",
		"priceChange": "1000.00",
		"priceChangePercent": "1.0",
		"weightedAvgPrice": "50000.00",
		"prevClosePrice": "49000.00",
		"lastPrice": "50000.00",
		"lastQty": "0.001",
		"bidPrice": "49999.00",
		"bidQty": "1.0",
		"askPrice": "50001.00",
		"askQty": "1.0",
		"openPrice": "49000.00",
		"highPrice": "51000.00",
		"lowPrice": "48500.00",
		"volume": "1000.0",
		"quoteVolume": "50000000.00",
		"openTime": 1609459200000,
		"closeTime": 1609545600000,
		"firstId": 1,
		"lastId": 1000,
		"count": 1000
	}`

	var ticker BinanceTicker
	err := json.Unmarshal([]byte(jsonData), &ticker)
	require.NoError(t, err)
	assert.Equal(t, "BTCUSDT", ticker.Symbol)
	assert.Equal(t, "50000.00", ticker.LastPrice)
}
