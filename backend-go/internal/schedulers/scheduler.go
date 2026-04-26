package schedulers

import (
	"context"
	"fmt"
	"time"

	"github.com/chuyen-gia-crypto/backend/internal/analyzers"
	"github.com/chuyen-gia-crypto/backend/internal/config"
	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
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
	cronScheduler       *cron.Cron
	ctx                 context.Context
	cancel              context.CancelFunc
	analyzer            *analyzers.Analyzer
	paperEngine         *papertrading.Engine
	accountRepo         *repository.AccountRepository
	accountSnapshotRepo *repository.AccountSnapshotRepository
	pendingOrderRepo    *repository.PendingOrderRepository
	positionRepo        *repository.PositionRepository
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

// InitAccountSnapshotRepo initializes the account snapshot repository
func InitAccountSnapshotRepo(repo *repository.AccountSnapshotRepository) {
	accountSnapshotRepo = repo
	logger.Info("Account snapshot repository initialized in scheduler")
}

// InitAccountRepo initializes the account repository
func InitAccountRepo(repo *repository.AccountRepository) {
	accountRepo = repo
	logger.Info("Account repository initialized in scheduler")
}

// InitPendingOrderRepo initializes the pending order repository
func InitPendingOrderRepo(repo *repository.PendingOrderRepository) {
	pendingOrderRepo = repo
	logger.Info("Pending order repository initialized in scheduler")
}

// InitPositionRepo initializes the position repository
func InitPositionRepo(repo *repository.PositionRepository) {
	positionRepo = repo
	logger.Info("Position repository initialized in scheduler")
}

// Start initializes and starts all schedulers
func Start(parentCtx context.Context) error {
	ctx, cancel = context.WithCancel(parentCtx)

	logger.Info("Starting multi-method staggered scheduler...")

	// Create cron scheduler with seconds precision
	cronScheduler = cron.New(cron.WithSeconds())

	// Kim Nghia Method - Runs at 0m, 15m, 30m, 45m (every 15 minutes)
	if config.AppConfig.Scheduler.EnableKimNghiaScheduler {
		_, err := cronScheduler.AddFunc("0 0,15,30,45 * * * *", runKimNghiaAnalysis)
		if err != nil {
			logger.Error("Failed to add Kim Nghia scheduler", zap.Error(err))
			return errors.NewSchedulerError("failed to add Kim Nghia scheduler", err)
		}
		logger.Info("Kim Nghia scheduler registered: 0 0,15,30,45 * * * *")
	} else {
		logger.Info("Kim Nghia scheduler disabled by configuration")
	}

	// ICT Method - TEMPORARILY DISABLED
	// ICT Method - Runs at 0m, 15m, 30m, 45m (every 15 minutes)
	if config.AppConfig.Scheduler.EnableICTScheduler {
		_, err := cronScheduler.AddFunc("0 */15 * * * *", runICTAnalysis)
		if err != nil {
			logger.Error("Failed to add ICT scheduler", zap.Error(err))
			return errors.NewSchedulerError("failed to add ICT scheduler", err)
		}
		logger.Info("ICT scheduler registered: 0 */15 * * * *")
	} else {
		logger.Info("ICT scheduler disabled by configuration")
	}

	// Validate expired predictions every hour
	_, err := cronScheduler.AddFunc("0 0 * * * *", validateExpiredPredictions)
	if err != nil {
		logger.Error("Failed to add validation scheduler", zap.Error(err))
		return errors.NewSchedulerError("failed to add validation scheduler", err)
	}
	logger.Info("Validation scheduler registered: 0 0 * * * *")

	// Run data retention daily at 3 AM
	_, err = cronScheduler.AddFunc("0 0 3 * * *", runDataRetention)
	if err != nil {
		logger.Error("Failed to add data retention scheduler", zap.Error(err))
		return errors.NewSchedulerError("failed to add data retention scheduler", err)
	}
	logger.Info("Data retention scheduler registered: 0 0 3 * * *")

	// Start price update scheduler (30-second intervals)
	if config.AppConfig.Scheduler.EnablePriceUpdateScheduler {
		go startPriceUpdateScheduler()
		logger.Info("Price update scheduler started (30-second intervals)")
	} else {
		logger.Info("Price update scheduler disabled by configuration")
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
	if paperEngine != nil && positionRepo != nil {
		// Get open positions from database
		openPositions, err := positionRepo.GetOpenPositions(ctx)
		if err != nil {
			logger.Error("Failed to get open positions", zap.Error(err))
		} else {
			// Convert ent.Position to papertrading.Position
			paperPositions := make([]*papertrading.Position, 0, len(openPositions))
			for _, pos := range openPositions {
				paperPos := &papertrading.Position{
					ID:           fmt.Sprintf("%d", pos.ID),
					Symbol:       pos.Symbol,
					Side:         pos.Side,
					EntryPrice:   pos.EntryPrice,
					CurrentPrice: pos.CurrentPrice,
					StopLoss:     pos.StopLoss,
					TakeProfit:   pos.TakeProfit,
					SizeUSD:      pos.SizeUsd,
					SizeQty:      pos.SizeQty,
					RiskUSD:      pos.RiskUsd,
					RiskPercent:  pos.RiskPercent,
					ExpectedRR:   pos.ExpectedRr,
					MethodID:     pos.MethodID,
					Status:       pos.Status,
				}
				paperPositions = append(paperPositions, paperPos)
			}

			// Update PnL for each symbol
			if len(paperPositions) > 0 {
				// Update BTC positions
				btcPrice := realTimePrices.BTC.Price
				btcPositions := make([]*papertrading.Position, 0)
				for _, pos := range paperPositions {
					if pos.Symbol == "BTC" {
						btcPositions = append(btcPositions, pos)
					}
				}
				if len(btcPositions) > 0 {
					err := paperEngine.UpdateUnrealizedPnL(ctx, btcPositions, btcPrice)
					if err != nil {
						logger.Error("Failed to update BTC positions PnL", zap.Error(err))
					}
				}

				// Update ETH positions
				ethPrice := realTimePrices.ETH.Price
				ethPositions := make([]*papertrading.Position, 0)
				for _, pos := range paperPositions {
					if pos.Symbol == "ETH" {
						ethPositions = append(ethPositions, pos)
					}
				}
				if len(ethPositions) > 0 {
					err := paperEngine.UpdateUnrealizedPnL(ctx, ethPositions, ethPrice)
					if err != nil {
						logger.Error("Failed to update ETH positions PnL", zap.Error(err))
					}
				}

				// Check SL/TP with candle data
				// Check BTC positions SL/TP with candle data
				if len(btcPositions) > 0 {
					closedBTC, err := paperEngine.CheckSLTP(ctx, btcPositions, realTimePrices.BTC.High, realTimePrices.BTC.Low)
					if err != nil {
						logger.Error("Failed to check BTC positions SL/TP", zap.Error(err))
					} else if len(closedBTC) > 0 {
						logger.Info("BTC positions closed by SL/TP", zap.Int("count", len(closedBTC)))
					}
				}

				// Check ETH positions SL/TP with candle data
				if len(ethPositions) > 0 {
					closedETH, err := paperEngine.CheckSLTP(ctx, ethPositions, realTimePrices.ETH.High, realTimePrices.ETH.Low)
					if err != nil {
						logger.Error("Failed to check ETH positions SL/TP", zap.Error(err))
					} else if len(closedETH) > 0 {
						logger.Info("ETH positions closed by SL/TP", zap.Int("count", len(closedETH)))
					}
				}
			}
		}
	}

	// Execute pending orders if triggered
	if pendingOrderRepo != nil {
		pendingOrders, err := pendingOrderRepo.GetByStatus(ctx, "pending")
		if err != nil {
			logger.Error("Failed to get pending orders", zap.Error(err))
		} else {
			for _, order := range pendingOrders {
				// Check if price hits entry level
				var currentPrice float64
				if order.Symbol == "BTC" {
					currentPrice = realTimePrices.BTC.Price
				} else if order.Symbol == "ETH" {
					currentPrice = realTimePrices.ETH.Price
				} else {
					continue // Skip unsupported symbols
				}

				// Check if order should be executed
				shouldExecute := false
				if order.Side == "BUY" && currentPrice <= order.EntryPrice {
					shouldExecute = true
				} else if order.Side == "SELL" && currentPrice >= order.EntryPrice {
					shouldExecute = true
				}

				if shouldExecute {
					// Execute the order
					err := pendingOrderRepo.ExecuteOrder(ctx, order.ID, currentPrice, order.SizeQty, order.SizeUsd)
					if err != nil {
						logger.Error("Failed to execute pending order",
							zap.Int("order_id", order.ID),
							zap.Error(err))
					} else {
						logger.Info("Pending order executed",
							zap.Int("order_id", order.ID),
							zap.String("symbol", order.Symbol),
							zap.Float64("executed_price", currentPrice))

						// Create position from executed order
						if paperEngine != nil && accountRepo != nil {
							// Get account for this order
							account, err := accountRepo.GetByID(ctx, order.AccountID)
							if err != nil {
								logger.Error("Failed to get account for order",
									zap.Int("order_id", order.ID),
									zap.Int("account_id", order.AccountID),
									zap.Error(err))
							} else {
								// Convert account to papertrading.Account
								paperAccount := &papertrading.Account{
									ID:             account.ID,
									Symbol:         account.Symbol,
									MethodID:       account.MethodID,
									Balance:        account.CurrentBalance,
									InitialBalance: account.StartingBalance,
									TotalPnL:       account.RealizedPnl,
									WinCount:       account.WinningTrades,
									LossCount:      account.LosingTrades,
									WinRate:        0, // Will be calculated
									ProfitFactor:   0, // Will be calculated
									MaxDrawdown:    0, // Will be calculated
									CreatedAt:      account.CreatedAt,
									UpdatedAt:      account.UpdatedAt,
								}

								// Create position suggestion from order
								side := "long"
								if order.Side == "SELL" {
									side = "short"
								}

								suggestion := &papertrading.PositionSuggestion{
									Side:              side,
									EntryPrice:        currentPrice,
									StopLoss:          order.StopLoss,
									TakeProfit:        order.TakeProfit,
									SizeUSD:           order.SizeUsd,
									SizeQty:           order.SizeQty,
									RiskUSD:           order.RiskUsd,
									RiskPercent:       order.RiskPercent,
									ExpectedRR:        order.ExpectedRr,
									InvalidationLevel: 0, // Not available in order
								}

								// Open position
								_, err := paperEngine.OpenPosition(ctx, paperAccount, suggestion, "", order.MethodID)
								if err != nil {
									logger.Error("Failed to create position from executed order",
										zap.Int("order_id", order.ID),
										zap.Error(err))
								} else {
									logger.Info("Position created from executed order",
										zap.Int("order_id", order.ID),
										zap.String("symbol", order.Symbol),
										zap.String("side", side))
								}
							}
						}
					}
				}
			}
		}
	}

	// Update account snapshots
	if accountSnapshotRepo != nil && accountRepo != nil {
		accounts, err := accountRepo.GetAll(ctx)
		if err != nil {
			logger.Error("Failed to get accounts for snapshot creation", zap.Error(err))
		} else {
			for _, account := range accounts {
				// Count open positions for this account
				openPositionsCount := 0
				if positionRepo != nil {
					accountPositions, err := positionRepo.GetByAccountID(ctx, account.ID)
					if err != nil {
						logger.Error("Failed to get positions for account",
							zap.Int("account_id", account.ID),
							zap.Error(err))
					} else {
						for _, pos := range accountPositions {
							if pos.Status == "open" {
								openPositionsCount++
							}
						}
					}
				}

				snapshot := &ent.AccountSnapshot{
					AccountID:     account.ID,
					Balance:       account.CurrentBalance,
					Equity:        account.Equity,
					UnrealizedPnl: account.UnrealizedPnl,
					OpenPositions: openPositionsCount,
					Timestamp:     time.Now(),
				}
				_, err := accountSnapshotRepo.Create(ctx, snapshot)
				if err != nil {
					logger.Error("Failed to create account snapshot",
						zap.Int("account_id", account.ID),
						zap.Error(err))
				}
			}
			logger.Info("Account snapshots created", zap.Int("count", len(accounts)))
		}
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
