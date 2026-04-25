package schedulers

import (
	"context"
	"time"

	"github.com/chuyen-gia-crypto/backend/internal/analyzers"
	"github.com/chuyen-gia-crypto/backend/internal/config"
	"github.com/chuyen-gia-crypto/backend/internal/db/repository"
	"github.com/chuyen-gia-crypto/backend/internal/services/groq"
	"github.com/chuyen-gia-crypto/backend/internal/services/papertrading"
	"github.com/chuyen-gia-crypto/backend/internal/services/pricefetcher"
	"github.com/chuyen-gia-crypto/backend/pkg/errors"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/robfig/cron/v3"
	"go.uber.org/zap"
)

var (
	cronScheduler *cron.Cron
	ctx           context.Context
	cancel        context.CancelFunc
	analyzer      *analyzers.Analyzer
	paperEngine   *papertrading.Engine
)

// Init initializes the analyzer with dependencies
func Init(groqClient *groq.Client, analysisRepo *repository.AnalysisRepository, predictionRepo *repository.PredictionRepository) {
	analyzer = analyzers.NewAnalyzer(groqClient, analysisRepo, predictionRepo)
	logger.Info("Analyzer initialized in scheduler")
}

// InitPaperTrading initializes the paper trading engine
func InitPaperTrading(engine *papertrading.Engine) {
	paperEngine = engine
	logger.Info("Paper trading engine initialized in scheduler")
}

// Start initializes and starts all schedulers
func Start(parentCtx context.Context) error {
	ctx, cancel = context.WithCancel(parentCtx)

	logger.Info("Starting multi-method staggered scheduler...")

	// Create cron scheduler with seconds precision
	cronScheduler = cron.New(cron.WithSeconds())

	// Kim Nghia Method - Runs at 0m, 15m, 30m, 45m (every 15 minutes)
	if config.AppConfig.Scheduler.EnableKimNghiaScheduler {
		_, err := cronScheduler.AddFunc("0,15,30,45 * * * *", runKimNghiaAnalysis)
		if err != nil {
			return errors.NewSchedulerError("failed to add Kim Nghia scheduler", err)
		}
		logger.Info("Kim Nghia scheduler registered: 0,15,30,45 * * * *")
	}

	// ICT Method - TEMPORARILY DISABLED
	// ICT Method - Runs at 0m, 15m, 30m, 45m (every 15 minutes)
	if config.AppConfig.Scheduler.EnableICTScheduler {
		_, err := cronScheduler.AddFunc("*/15 * * * *", runICTAnalysis)
		if err != nil {
			return errors.NewSchedulerError("failed to add ICT scheduler", err)
		}
		logger.Info("ICT scheduler registered: */15 * * * *")
	}

	// Validate expired predictions every hour
	_, err := cronScheduler.AddFunc("0 * * * *", validateExpiredPredictions)
	if err != nil {
		return errors.NewSchedulerError("failed to add validation scheduler", err)
	}
	logger.Info("Validation scheduler registered: 0 * * * *")

	// Run data retention daily at 3 AM
	_, err = cronScheduler.AddFunc("0 3 * * *", runDataRetention)
	if err != nil {
		return errors.NewSchedulerError("failed to add data retention scheduler", err)
	}
	logger.Info("Data retention scheduler registered: 0 3 * * *")

	// Start price update scheduler (30-second intervals)
	if config.AppConfig.Scheduler.EnablePriceUpdateScheduler {
		go startPriceUpdateScheduler()
		logger.Info("Price update scheduler started (30-second intervals)")
	}

	// Start the cron scheduler
	cronScheduler.Start()

	logger.Info("Staggered scheduler registered successfully")

	return nil
}

// Stop gracefully stops all schedulers
func Stop() {
	if cancel != nil {
		cancel()
	}

	if cronScheduler != nil {
		ctx := cronScheduler.Stop()
		<-ctx.Done()
		logger.Info("Cron scheduler stopped")
	}

	logger.Info("All schedulers stopped")
}

// runKimNghiaAnalysis runs Kim Nghia method analysis
func runKimNghiaAnalysis() {
	startTime := time.Now()
	logger.Info("[KimNghia] Starting analysis",
		zap.Time("start_time", startTime),
	)

	if analyzer == nil {
		logger.Error("[KimNghia] Analyzer not initialized")
		return
	}

	// Analyze BTC (BTC-only mode during migration)
	_, err := analyzer.RunKimNghiaAnalysis(ctx, "BTC")
	if err != nil {
		logger.Error("[KimNghia] Analysis failed", zap.Error(err))
	}

	duration := time.Since(startTime)
	logger.Info("[KimNghia] Analysis completed",
		zap.Duration("duration", duration),
	)
}

// runICTAnalysis runs ICT method analysis
func runICTAnalysis() {
	startTime := time.Now()
	logger.Info("[ICT] Starting analysis",
		zap.Time("start_time", startTime),
	)

	if analyzer == nil {
		logger.Error("[ICT] Analyzer not initialized")
		return
	}

	// Analyze BTC (BTC-only mode during migration)
	_, err := analyzer.RunICTAnalysis(ctx, "BTC")
	if err != nil {
		logger.Error("[ICT] Analysis failed", zap.Error(err))
	}

	duration := time.Since(startTime)
	logger.Info("[ICT] Analysis completed",
		zap.Duration("duration", duration),
	)
}

// validateExpiredPredictions validates and updates expired predictions
func validateExpiredPredictions() {
	logger.Info("Validating expired predictions...")

	// TODO: Implement prediction validation logic
	// Check predictions against current prices and mark as correct/incorrect

	logger.Info("Expired predictions validated")
}

// runDataRetention runs data retention cleanup
func runDataRetention() {
	logger.Info("Running daily data retention...")

	// TODO: Implement data retention logic
	// Delete old data based on retention policies (e.g., 30 days for 15m candles)

	logger.Info("Data retention completed")
}

// startPriceUpdateScheduler starts the price update scheduler (30-second intervals)
func startPriceUpdateScheduler() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	logger.Info("Price update scheduler running")

	for {
		select {
		case <-ctx.Done():
			logger.Info("Price update scheduler stopped")
			return
		case <-ticker.C:
			runPriceUpdate()
		}
	}
}

// runPriceUpdate runs price update and position management
func runPriceUpdate() {
	startTime := time.Now()
	logger.Info("Running price update...")

	// Fetch real-time prices from Binance
	realTimePrices, err := pricefetcher.FetchRealTimePrices()
	if err != nil {
		logger.Error("Failed to fetch real-time prices", zap.Error(err))
		return
	}

	logger.Info("Real-time prices fetched",
		zap.Float64("btc_price", realTimePrices.BTC.Price),
		zap.Float64("eth_price", realTimePrices.ETH.Price),
	)

	// Update open positions PnL if paper engine is initialized
	if paperEngine != nil {
		// Get open positions from database
		// TODO: Implement GetOpenPositions from repository
		// For now, skip this step as it requires database integration

		// Check SL/TP with candle data
		// TODO: Fetch 1-minute candle data for SL/TP detection
		// TODO: Check if any positions hit SL or TP
		// TODO: Close positions that hit SL/TP

		// Execute pending orders if triggered
		// TODO: Get pending orders from database
		// TODO: Check if price hits entry level
		// TODO: Execute orders that are triggered

		// Update account snapshots
		// TODO: Create account snapshots for all accounts
	}

	duration := time.Since(startTime)
	logger.Info("Price update completed",
		zap.Duration("duration", duration),
	)
}

// FormatVietnamTime formats time in Vietnam timezone
func FormatVietnamTime(t time.Time) string {
	loc, err := time.LoadLocation(config.AppConfig.Timezone.DisplayTimezone)
	if err != nil {
		logger.Warn("Failed to load timezone", zap.Error(err))
		return t.Format(time.RFC3339)
	}
	return t.In(loc).Format("2006-01-02 15:04:05")
}
