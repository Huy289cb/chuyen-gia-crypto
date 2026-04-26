package pricefetcher

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/chuyen-gia-crypto/backend/pkg/errors"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"go.uber.org/zap"
)

const (
	BinanceAPI        = "https://api.binance.com/api/v3"
	CoinGeckoAPI      = "https://api.coingecko.com/api/v3"
	CoinGeckoMinDelay = 2 * time.Second
	MaxRetries        = 3
	RetryDelay        = 1 * time.Second
	RequestTimeout    = 30 * time.Second
)

var (
	lastCoinGeckoCall time.Time
	coinGeckoMutex    sync.Mutex
)

// PriceData represents current price information
type PriceData struct {
	Price     float64   `json:"price"`
	Open      float64   `json:"open"`
	High      float64   `json:"high"`
	Low       float64   `json:"low"`
	Volume    float64   `json:"volume"`
	Time      time.Time `json:"time"`
	Change24h float64   `json:"change24h"`
	Change7d  float64   `json:"change7d"`
	MarketCap float64   `json:"marketCap"`
	Volume24h float64   `json:"volume24h"`
}

// RealTimePrices represents 1-minute candle data for paper trading
type RealTimePrices struct {
	Timestamp time.Time `json:"timestamp"`
	BTC       PriceData `json:"btc"`
	ETH       PriceData `json:"eth"`
}

// MarketData represents aggregated market information
type MarketData struct {
	Timestamp  time.Time  `json:"timestamp"`
	BTC        PriceData  `json:"btc"`
	ETH        PriceData  `json:"eth"`
	MarketData MarketInfo `json:"marketData"`
}

// MarketInfo represents additional market metrics
type MarketInfo struct {
	FearGreed    *FearGreedIndex `json:"fearGreed"`
	TotalVolume  float64         `json:"totalVolume"`
	BTCDominance *float64        `json:"btcDominance"`
}

// FearGreedIndex represents the Fear & Greed index
type FearGreedIndex struct {
	Value          int    `json:"value"`
	Classification string `json:"classification"`
	Timestamp      string `json:"timestamp"`
}

// BinanceKline represents a Binance kline/candle
type BinanceKline struct {
	OpenTime            int64  `json:"0"`
	Open                string `json:"1"`
	High                string `json:"2"`
	Low                 string `json:"3"`
	Close               string `json:"4"`
	Volume              string `json:"5"`
	CloseTime           int64  `json:"6"`
	QuoteVolume         string `json:"7"`
	Trades              int    `json:"8"`
	TakerBuyBaseVolume  string `json:"9"`
	TakerBuyQuoteVolume string `json:"10"`
}

// BinanceTicker represents 24h ticker data
type BinanceTicker struct {
	Symbol             string `json:"symbol"`
	PriceChange        string `json:"priceChange"`
	PriceChangePercent string `json:"priceChangePercent"`
	WeightedAvgPrice   string `json:"weightedAvgPrice"`
	PrevClosePrice     string `json:"prevClosePrice"`
	LastPrice          string `json:"lastPrice"`
	LastQty            string `json:"lastQty"`
	BidPrice           string `json:"bidPrice"`
	BidQty             string `json:"bidQty"`
	AskPrice           string `json:"askPrice"`
	AskQty             string `json:"askQty"`
	OpenPrice          string `json:"openPrice"`
	HighPrice          string `json:"highPrice"`
	LowPrice           string `json:"lowPrice"`
	Volume             string `json:"volume"`
	QuoteVolume        string `json:"quoteVolume"`
	OpenTime           int64  `json:"openTime"`
	CloseTime          int64  `json:"closeTime"`
	FirstId            int64  `json:"firstId"`
	LastId             int64  `json:"lastId"`
	Count              int    `json:"count"`
}

// HTTPClient represents an HTTP client with timeout
type HTTPClient struct {
	client *http.Client
}

// NewHTTPClient creates a new HTTP client with timeout
func NewHTTPClient() *HTTPClient {
	return &HTTPClient{
		client: &http.Client{
			Timeout: RequestTimeout,
		},
	}
}

// fetchWithTimeout performs an HTTP request with timeout
func (c *HTTPClient) fetchWithTimeout(url string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), RequestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, errors.NewAPIError("failed to create request", err)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, errors.NewAPIError("request failed", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, errors.NewAPIError(fmt.Sprintf("API returned status %d", resp.StatusCode), nil)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, errors.NewAPIError("failed to read response body", err)
	}

	return body, nil
}

// FetchRealTimePrices fetches 1-minute candle data from Binance for paper trading
func FetchRealTimePrices() (*RealTimePrices, error) {
	client := NewHTTPClient()

	for attempt := 1; attempt <= MaxRetries; attempt++ {
		logger.Info("Fetching 1-minute candles from Binance",
			zap.Int("attempt", attempt),
			zap.Int("maxRetries", MaxRetries),
		)

		// Fetch 1-minute candle data from Binance klines API
		btcURL := fmt.Sprintf("%s/klines?symbol=BTCUSDT&interval=1m&limit=1", BinanceAPI)
		ethURL := fmt.Sprintf("%s/klines?symbol=ETHUSDT&interval=1m&limit=1", BinanceAPI)

		btcBody, err := client.fetchWithTimeout(btcURL)
		if err != nil {
			logger.Error("Failed to fetch BTC klines", zap.Error(err))
			if attempt < MaxRetries {
				time.Sleep(RetryDelay)
				continue
			}
			return nil, err
		}

		ethBody, err := client.fetchWithTimeout(ethURL)
		if err != nil {
			logger.Error("Failed to fetch ETH klines", zap.Error(err))
			if attempt < MaxRetries {
				time.Sleep(RetryDelay)
				continue
			}
			return nil, err
		}

		// Parse BTC kline
		var btcKline [][]interface{}
		if err := json.Unmarshal(btcBody, &btcKline); err != nil {
			return nil, errors.NewAPIError("failed to parse BTC kline", err)
		}

		// Parse ETH kline
		var ethKline [][]interface{}
		if err := json.Unmarshal(ethBody, &ethKline); err != nil {
			return nil, errors.NewAPIError("failed to parse ETH kline", err)
		}

		if len(btcKline) == 0 || len(ethKline) == 0 {
			return nil, errors.NewAPIError("empty kline data", nil)
		}

		btcData := parseKlineToPriceData(btcKline[0])
		ethData := parseKlineToPriceData(ethKline[0])

		logger.Info("1-minute candles fetched",
			zap.Float64("btc_close", btcData.Price),
			zap.Float64("eth_close", ethData.Price),
		)

		return &RealTimePrices{
			Timestamp: time.Now(),
			BTC:       btcData,
			ETH:       ethData,
		}, nil
	}

	return nil, errors.NewAPIError("all retries failed for real-time prices", nil)
}

// parseKlineToPriceData converts Binance kline to PriceData
func parseKlineToPriceData(kline []interface{}) PriceData {
	openTime := int64(kline[0].(float64))
	open := parseFloat(kline[1].(string))
	high := parseFloat(kline[2].(string))
	low := parseFloat(kline[3].(string))
	close := parseFloat(kline[4].(string))
	volume := parseFloat(kline[5].(string))

	return PriceData{
		Price:  close,
		Open:   open,
		High:   high,
		Low:    low,
		Volume: volume,
		Time:   time.Unix(openTime/1000, 0),
	}
}

// FetchFromBinance fetches market data from Binance API
func FetchFromBinance() (*MarketData, error) {
	client := NewHTTPClient()

	logger.Info("Fetching market data from Binance")

	// Fetch 24h ticker data
	btcTickerURL := fmt.Sprintf("%s/ticker/24hr?symbol=BTCUSDT", BinanceAPI)
	ethTickerURL := fmt.Sprintf("%s/ticker/24hr?symbol=ETHUSDT", BinanceAPI)

	btcTickerBody, err := client.fetchWithTimeout(btcTickerURL)
	if err != nil {
		return nil, errors.NewAPIError("failed to fetch BTC ticker", err)
	}

	ethTickerBody, err := client.fetchWithTimeout(ethTickerURL)
	if err != nil {
		return nil, errors.NewAPIError("failed to fetch ETH ticker", err)
	}

	var btcTicker BinanceTicker
	if err := json.Unmarshal(btcTickerBody, &btcTicker); err != nil {
		return nil, errors.NewAPIError("failed to parse BTC ticker", err)
	}

	var ethTicker BinanceTicker
	if err := json.Unmarshal(ethTickerBody, &ethTicker); err != nil {
		return nil, errors.NewAPIError("failed to parse ETH ticker", err)
	}

	// Fetch OHLC data for sparklines (optional, can be used for sparkline data)
	_, _ = FetchOHLCFromBinance("BTCUSDT", "15m", 672)
	_, _ = FetchOHLCFromBinance("ETHUSDT", "15m", 672)

	// Fetch Fear & Greed Index
	fearGreed, err := fetchFearGreedIndex()
	if err != nil {
		logger.Warn("Failed to fetch Fear & Greed index", zap.Error(err))
	}

	// Calculate metrics
	totalVolume := parseFloat(btcTicker.QuoteVolume) + parseFloat(ethTicker.QuoteVolume)
	btcMarketCap := parseFloat(btcTicker.QuoteVolume)
	ethMarketCap := parseFloat(ethTicker.QuoteVolume)

	var btcDominance *float64
	if btcMarketCap > 0 && ethMarketCap > 0 {
		dom := (btcMarketCap / (btcMarketCap + ethMarketCap)) * 100
		btcDominance = &dom
	}

	btcPrice := parseFloat(btcTicker.LastPrice)
	ethPrice := parseFloat(ethTicker.LastPrice)

	logger.Info("Binance data fetched",
		zap.Float64("btc_price", btcPrice),
		zap.Float64("eth_price", ethPrice),
	)

	return &MarketData{
		Timestamp: time.Now(),
		BTC: PriceData{
			Price:     btcPrice,
			Change24h: parseFloat(btcTicker.PriceChangePercent),
			Change7d:  0, // Binance 24h ticker doesn't provide 7d change
			MarketCap: btcMarketCap,
			Volume24h: parseFloat(btcTicker.QuoteVolume),
		},
		ETH: PriceData{
			Price:     ethPrice,
			Change24h: parseFloat(ethTicker.PriceChangePercent),
			Change7d:  0,
			MarketCap: ethMarketCap,
			Volume24h: parseFloat(ethTicker.QuoteVolume),
		},
		MarketData: MarketInfo{
			FearGreed:    fearGreed,
			TotalVolume:  totalVolume,
			BTCDominance: btcDominance,
		},
	}, nil
}

// FetchOHLCFromBinance fetches OHLC data from Binance
func FetchOHLCFromBinance(symbol, interval string, limit int) ([]PriceData, error) {
	client := NewHTTPClient()

	url := fmt.Sprintf("%s/klines?symbol=%s&interval=%s&limit=%d", BinanceAPI, symbol, interval, limit)
	body, err := client.fetchWithTimeout(url)
	if err != nil {
		return nil, err
	}

	var klines [][]interface{}
	if err := json.Unmarshal(body, &klines); err != nil {
		return nil, errors.NewAPIError("failed to parse klines", err)
	}

	result := make([]PriceData, 0, len(klines))
	for _, kline := range klines {
		result = append(result, parseKlineToPriceData(kline))
	}

	return result, nil
}

// fetchFearGreedIndex fetches Fear & Greed Index from alternative.me
func fetchFearGreedIndex() (*FearGreedIndex, error) {
	client := NewHTTPClient()

	url := "https://api.alternative.me/fng/?limit=1"
	body, err := client.fetchWithTimeout(url)
	if err != nil {
		return nil, err
	}

	var response struct {
		Data []struct {
			Value               string `json:"value"`
			ValueClassification string `json:"value_classification"`
			Timestamp           string `json:"timestamp"`
		} `json:"data"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return nil, errors.NewAPIError("failed to parse Fear & Greed response", err)
	}

	if len(response.Data) == 0 {
		return nil, nil
	}

	value, err := strconv.Atoi(response.Data[0].Value)
	if err != nil {
		return nil, errors.NewAPIError("failed to parse Fear & Greed value", err)
	}

	return &FearGreedIndex{
		Value:          value,
		Classification: response.Data[0].ValueClassification,
		Timestamp:      response.Data[0].Timestamp,
	}, nil
}

// parseFloat safely parses a string to float64
func parseFloat(s string) float64 {
	if s == "" {
		return 0
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return f
}

// extractCloses extracts close prices from PriceData array
func extractCloses(data []PriceData) []float64 {
	closes := make([]float64, len(data))
	for i, d := range data {
		closes[i] = d.Price
	}
	return closes
}

// CalculateTrend calculates trend from price array
func CalculateTrend(prices []float64) string {
	if len(prices) < 2 {
		return "neutral"
	}

	first := prices[0]
	last := prices[len(prices)-1]
	change := (last - first) / first

	switch {
	case change > 0.05:
		return "strong_uptrend"
	case change > 0.02:
		return "uptrend"
	case change > 0.005:
		return "bullish"
	case change > -0.005:
		return "neutral"
	case change > -0.02:
		return "bearish"
	case change > -0.05:
		return "downtrend"
	default:
		return "strong_downtrend"
	}
}

// CalculateConfidence calculates confidence based on trend consistency
func CalculateConfidence(trends map[string]string) float64 {
	values := make([]string, 0, len(trends))
	for _, v := range trends {
		values = append(values, v)
	}

	bullish := 0
	bearish := 0
	neutral := 0

	for _, v := range values {
		switch v {
		case "strong_uptrend", "uptrend", "bullish":
			bullish++
		case "strong_downtrend", "downtrend", "bearish":
			bearish++
		case "neutral", "consolidating":
			neutral++
		}
	}

	// High agreement
	if bullish >= 3 || bearish >= 3 {
		return 0.80
	}
	if bullish == 2 && bearish == 0 {
		return 0.70
	}
	if bearish == 2 && bullish == 0 {
		return 0.70
	}

	// Moderate
	if bullish == 2 || bearish == 2 {
		return 0.60
	}
	if neutral >= 2 {
		return 0.50
	}

	// Low agreement
	return 0.35
}
