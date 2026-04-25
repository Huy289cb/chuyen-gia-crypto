package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/chuyen-gia-crypto/backend/internal/analyzers"
	"github.com/chuyen-gia-crypto/backend/internal/config"
	"github.com/chuyen-gia-crypto/backend/internal/db"
	"github.com/chuyen-gia-crypto/backend/internal/db/repository"
	"github.com/chuyen-gia-crypto/backend/internal/handlers"
	"github.com/chuyen-gia-crypto/backend/internal/middleware"
	"github.com/chuyen-gia-crypto/backend/internal/schedulers"
	"github.com/chuyen-gia-crypto/backend/internal/services/groq"
	"github.com/chuyen-gia-crypto/backend/internal/services/papertrading"
	"github.com/chuyen-gia-crypto/backend/internal/services/testnet"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

func main() {
	// Load configuration
	if err := config.Load(); err != nil {
		fmt.Printf("Error loading config: %v\n", err)
		os.Exit(1)
	}

	// Initialize logger
	if err := logger.Init(config.AppConfig.Logging.Level, config.AppConfig.Logging.Format); err != nil {
		fmt.Printf("Error initializing logger: %v\n", err)
		os.Exit(1)
	}
	defer logger.Sync()

	logger.Info("Starting Crypto Analyzer Backend...")

	// Initialize rate limiter
	middleware.InitRateLimiter(100, time.Minute) // 100 requests per minute

	// Initialize WebSocket hub
	handlers.InitHub()

	// Initialize database with retry logic
	ctx := context.Background()
	var dbErr error
	for i := 0; i < 5; i++ {
		dbErr = db.Init(ctx)
		if dbErr == nil {
			break
		}
		logger.Error("Failed to initialize database, retrying...",
			zap.Int("attempt", i+1),
			zap.Int("max_attempts", 5),
			zap.Error(dbErr))
		time.Sleep(time.Duration(i+1) * time.Second)
	}

	if dbErr != nil {
		logger.Error("Failed to initialize database after retries",
			zap.Error(dbErr))
		logger.Error("Application will continue without database support")
	} else {
		// Initialize handler dependencies
		handlers.InitDependencies(db.Client)
		logger.Info("Handler dependencies initialized")
	}
	defer db.Close()

	// Initialize testnet client
	if err := testnet.Init(); err != nil {
		logger.Error("Failed to initialize testnet client")
	}

	// Initialize Groq client
	groqClient := groq.NewClient(groq.GetAPIKeys())

	// Initialize paper trading engine
	var paperEngine *papertrading.Engine
	if db.Client != nil {
		paperEngine = papertrading.NewEngine(db.Client)
		schedulers.InitPaperTrading(paperEngine)
		logger.Info("Paper trading engine initialized")
	}

	// Initialize scheduler with dependencies
	if db.Client != nil {
		analyzer := analyzers.NewAnalyzer(groqClient, repository.NewAnalysisRepository(db.Client), repository.NewPredictionRepository(db.Client))
		schedulers.Init(groqClient, repository.NewAnalysisRepository(db.Client), repository.NewPredictionRepository(db.Client))
		schedulers.InitAccountRepo(repository.NewAccountRepository(db.Client))
		schedulers.InitAccountSnapshotRepo(repository.NewAccountSnapshotRepository(db.Client))
		schedulers.InitPendingOrderRepo(repository.NewPendingOrderRepository(db.Client))
		schedulers.InitPositionRepo(repository.NewPositionRepository(db.Client))
		handlers.SetAnalyzer(analyzer)
		logger.Info("Scheduler dependencies initialized")
	}

	// Initialize schedulers
	if err := schedulers.Start(ctx); err != nil {
		logger.Error("Failed to start schedulers")
	}
	defer schedulers.Stop()

	// Initialize HTTP server
	server := setupHTTPServer()

	logger.Info("Crypto Analyzer Backend started successfully")

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("Shutting down server...")

	// Graceful shutdown with timeout
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	// Shutdown HTTP server
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("HTTP server shutdown error: " + err.Error())
	}

	logger.Info("Server shutdown complete")
}

func setupHTTPServer() *http.Server {
	// Set Gin mode
	gin.SetMode(config.AppConfig.Server.GinMode)

	// Create Gin router
	r := gin.Default()

	// Setup routes
	handlers.SetupRoutes(r)

	// Create HTTP server with timeout configuration
	addr := fmt.Sprintf("%s:%d", config.AppConfig.Server.Host, config.AppConfig.Server.Port)
	server := &http.Server{
		Addr:         addr,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	logger.Info("HTTP server starting on " + addr)

	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("HTTP server error: " + err.Error())
		}
	}()

	return server
}
