package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// HTTP metrics
	httpRequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests",
		},
		[]string{"method", "endpoint", "status"},
	)

	httpRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "HTTP request duration in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "endpoint"},
	)

	// Database metrics
	dbConnectionsActive = promauto.NewGauge(
		prometheus.GaugeOpts{
			Name: "db_connections_active",
			Help: "Number of active database connections",
		},
	)

	dbQueryDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "db_query_duration_seconds",
			Help:    "Database query duration in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"operation", "table"},
	)

	dbQueryErrorsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "db_query_errors_total",
			Help: "Total number of database query errors",
		},
		[]string{"operation", "table"},
	)

	// Analysis metrics
	analysisTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "analysis_total",
			Help: "Total number of analysis runs",
		},
		[]string{"method", "symbol", "timeframe"},
	)

	analysisDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "analysis_duration_seconds",
			Help:    "Analysis duration in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method"},
	)

	analysisConfidenceScore = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "analysis_confidence_score",
			Help: "Analysis confidence score",
		},
		[]string{"method", "symbol"},
	)

	// Trading metrics
	positionsOpen = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "positions_open",
			Help: "Number of open positions",
		},
		[]string{"method", "symbol"},
	)

	positionsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "positions_total",
			Help: "Total number of positions",
		},
		[]string{"method", "symbol", "status"},
	)

	tradesTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "trades_total",
			Help: "Total number of trades",
		},
		[]string{"method", "symbol", "result"},
	)

	pnlTotal = promauto.NewGaugeVec(
		prometheus.GaugeOpts{
			Name: "pnl_total",
			Help: "Total profit and loss",
		},
		[]string{"method", "symbol"},
	)

	// Scheduler metrics
	schedulerRunsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "scheduler_runs_total",
			Help: "Total number of scheduler runs",
		},
		[]string{"scheduler"},
	)

	schedulerErrorsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "scheduler_errors_total",
			Help: "Total number of scheduler errors",
		},
		[]string{"scheduler"},
	)

	schedulerDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "scheduler_duration_seconds",
			Help:    "Scheduler execution duration in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"scheduler"},
	)

	// External API metrics
	groqRequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "groq_requests_total",
			Help: "Total number of Groq API requests",
		},
		[]string{"endpoint", "status"},
	)

	groqRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "groq_request_duration_seconds",
			Help:    "Groq API request duration in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"endpoint"},
	)

	binanceRequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "binance_requests_total",
			Help: "Total number of Binance API requests",
		},
		[]string{"endpoint", "status"},
	)

	binanceRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "binance_request_duration_seconds",
			Help:    "Binance API request duration in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"endpoint"},
	)

	// System metrics are provided by Prometheus Go collector
	// No need to define custom goroutines and memory metrics

	// AI Position Management metrics
	aiPositionActionsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "ai_position_actions_total",
			Help: "Total number of AI position actions",
		},
		[]string{"action", "method"},
	)

	aiOrderActionsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "ai_order_actions_total",
			Help: "Total number of AI order actions",
		},
		[]string{"action", "method"},
	)
)

// HTTP Metrics
func RecordHTTPRequest(method, endpoint, status string) {
	httpRequestsTotal.WithLabelValues(method, endpoint, status).Inc()
}

func ObserveHTTPRequestDuration(method, endpoint string, duration float64) {
	httpRequestDuration.WithLabelValues(method, endpoint).Observe(duration)
}

// Database Metrics
func SetDBConnectionsActive(count float64) {
	dbConnectionsActive.Set(count)
}

func ObserveDBQueryDuration(operation, table string, duration float64) {
	dbQueryDuration.WithLabelValues(operation, table).Observe(duration)
}

func RecordDBQueryError(operation, table string) {
	dbQueryErrorsTotal.WithLabelValues(operation, table).Inc()
}

// Analysis Metrics
func RecordAnalysis(method, symbol, timeframe string) {
	analysisTotal.WithLabelValues(method, symbol, timeframe).Inc()
}

func ObserveAnalysisDuration(method string, duration float64) {
	analysisDuration.WithLabelValues(method).Observe(duration)
}

func SetAnalysisConfidenceScore(method, symbol string, score float64) {
	analysisConfidenceScore.WithLabelValues(method, symbol).Set(score)
}

// Trading Metrics
func SetPositionsOpen(method, symbol string, count float64) {
	positionsOpen.WithLabelValues(method, symbol).Set(count)
}

func RecordPosition(method, symbol, status string) {
	positionsTotal.WithLabelValues(method, symbol, status).Inc()
}

func RecordTrade(method, symbol, result string) {
	tradesTotal.WithLabelValues(method, symbol, result).Inc()
}

func SetPnLTotal(method, symbol string, pnl float64) {
	pnlTotal.WithLabelValues(method, symbol).Set(pnl)
}

// Scheduler Metrics
func RecordSchedulerRun(scheduler string) {
	schedulerRunsTotal.WithLabelValues(scheduler).Inc()
}

func RecordSchedulerError(scheduler string) {
	schedulerErrorsTotal.WithLabelValues(scheduler).Inc()
}

func ObserveSchedulerDuration(scheduler string, duration float64) {
	schedulerDuration.WithLabelValues(scheduler).Observe(duration)
}

// External API Metrics
func RecordGroqRequest(endpoint, status string) {
	groqRequestsTotal.WithLabelValues(endpoint, status).Inc()
}

func ObserveGroqRequestDuration(endpoint string, duration float64) {
	groqRequestDuration.WithLabelValues(endpoint).Observe(duration)
}

func RecordBinanceRequest(endpoint, status string) {
	binanceRequestsTotal.WithLabelValues(endpoint, status).Inc()
}

func ObserveBinanceRequestDuration(endpoint string, duration float64) {
	binanceRequestDuration.WithLabelValues(endpoint).Observe(duration)
}

// AI Position Management Metrics
func RecordAIPositionAction(action, method string) {
	aiPositionActionsTotal.WithLabelValues(action, method).Inc()
}

func RecordAIOrderAction(action, method string) {
	aiOrderActionsTotal.WithLabelValues(action, method).Inc()
}
