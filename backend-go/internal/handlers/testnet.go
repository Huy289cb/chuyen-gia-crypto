package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
	"github.com/chuyen-gia-crypto/backend/internal/db/repository"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

var (
	testnetAccountRepo      *repository.TestnetAccountRepository
	testnetPositionRepo     *repository.TestnetPositionRepository
	testnetPendingOrderRepo *repository.TestnetPendingOrderRepository
)

// InitTestnetHandlers initializes testnet handlers with repositories
func InitTestnetHandlers(accountRepo *repository.TestnetAccountRepository, positionRepo *repository.TestnetPositionRepository, pendingOrderRepo *repository.TestnetPendingOrderRepository) {
	testnetAccountRepo = accountRepo
	testnetPositionRepo = positionRepo
	testnetPendingOrderRepo = pendingOrderRepo
	logger.Info("Testnet handlers initialized")
}

// GetTestnetPositions handles GET /api/testnet/positions
func GetTestnetPositions(c *gin.Context) {
	logger.Info("GET /api/testnet/positions called")

	if testnetPositionRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Testnet position repository not initialized",
		})
		return
	}

	symbol := c.Query("symbol")
	status := c.Query("status")

	var positions interface{}
	var err error

	if symbol != "" && status != "" {
		// Filter by both symbol and status - need to implement this in repo
		// For now, just filter by symbol
		positions, err = testnetPositionRepo.GetBySymbol(c.Request.Context(), symbol)
	} else if symbol != "" {
		positions, err = testnetPositionRepo.GetBySymbol(c.Request.Context(), symbol)
	} else if status != "" {
		positions, err = testnetPositionRepo.GetByStatus(c.Request.Context(), status)
	} else {
		positions, err = testnetPositionRepo.GetAll(c.Request.Context())
	}

	if err != nil {
		logger.Error("Failed to get testnet positions", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to retrieve testnet positions",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    positions,
	})
}

// CreateTestnetPosition handles POST /api/testnet/positions
func CreateTestnetPosition(c *gin.Context) {
	logger.Info("POST /api/testnet/positions called")

	if testnetPositionRepo == nil || testnetAccountRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Testnet repositories not initialized",
		})
		return
	}

	// Parse request body
	var req struct {
		Symbol       string  `json:"symbol" binding:"required"`
		Side         string  `json:"side" binding:"required"`
		EntryPrice   float64 `json:"entry_price" binding:"required"`
		StopLoss     float64 `json:"stop_loss" binding:"required"`
		TakeProfit   float64 `json:"take_profit" binding:"required"`
		SizeUSD      float64 `json:"size_usd" binding:"required"`
		MethodID     string  `json:"method_id" binding:"required"`
		PredictionID *int    `json:"prediction_id,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		logger.Error("Failed to bind request", zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid request body",
		})
		return
	}

	// Validate side
	if req.Side != "long" && req.Side != "short" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Side must be 'long' or 'short'",
		})
		return
	}

	// Get or create testnet account for this symbol/method
	account, err := testnetAccountRepo.GetBySymbolAndMethod(c.Request.Context(), req.Symbol, req.MethodID)
	if err != nil {
		logger.Error("Failed to get testnet account", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to get testnet account",
		})
		return
	}

	if account == nil {
		// Auto-create account with default balance
		newAccount := &ent.TestnetAccount{
			Symbol:            req.Symbol,
			MethodID:          req.MethodID,
			StartingBalance:   1000.0,
			CurrentBalance:    1000.0,
			Equity:            1000.0,
			UnrealizedPnl:     0,
			RealizedPnl:       0,
			TotalTrades:       0,
			WinningTrades:     0,
			LosingTrades:      0,
			MaxDrawdown:       0,
			ConsecutiveLosses: 0,
		}
		account, err = testnetAccountRepo.Create(c.Request.Context(), newAccount)
		if err != nil {
			logger.Error("Failed to create testnet account", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"error":   "Failed to create testnet account",
			})
			return
		}
	}

	// Calculate position parameters
	slDistance := 0.0
	if req.Side == "long" {
		slDistance = (req.EntryPrice - req.StopLoss) / req.EntryPrice
	} else {
		slDistance = (req.StopLoss - req.EntryPrice) / req.EntryPrice
	}

	sizeQty := req.SizeUSD / req.EntryPrice
	riskUSD := req.SizeUSD * slDistance
	riskPercent := riskUSD / account.CurrentBalance
	expectedRR := 0.0
	if req.Side == "long" {
		expectedRR = (req.TakeProfit - req.EntryPrice) / (req.EntryPrice - req.StopLoss)
	} else {
		expectedRR = (req.EntryPrice - req.TakeProfit) / (req.StopLoss - req.EntryPrice)
	}

	// Create testnet position entity
	position := &ent.TestnetPosition{
		PositionID:    generateTestnetPositionID(),
		AccountID:     account.ID,
		Symbol:        req.Symbol,
		Side:          req.Side,
		EntryPrice:    req.EntryPrice,
		CurrentPrice:  req.EntryPrice,
		StopLoss:      req.StopLoss,
		TakeProfit:    req.TakeProfit,
		SizeUsd:       req.SizeUSD,
		SizeQty:       sizeQty,
		RiskUsd:       riskUSD,
		RiskPercent:   riskPercent,
		ExpectedRr:    expectedRR,
		Status:        "open",
		EntryTime:     time.Now(),
		UnrealizedPnl: 0,
		RealizedPnl:   0,
	}

	// Set optional fields
	if req.PredictionID != nil {
		position.LinkedPredictionID = req.PredictionID
	}

	// Save position to database
	createdPosition, err := testnetPositionRepo.Create(c.Request.Context(), position)
	if err != nil {
		logger.Error("Failed to create testnet position", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to create testnet position",
		})
		return
	}

	// Update account balance
	account.CurrentBalance -= req.SizeUSD
	account.Equity = account.CurrentBalance
	_, err = testnetAccountRepo.Update(c.Request.Context(), account)
	if err != nil {
		logger.Error("Failed to update testnet account balance", zap.Error(err))
	}

	logger.Info("Testnet position created successfully",
		zap.Int("position_id", createdPosition.ID),
		zap.String("symbol", req.Symbol),
		zap.String("side", req.Side),
	)

	c.JSON(http.StatusCreated, gin.H{
		"success": true,
		"data": gin.H{
			"id":                   createdPosition.ID,
			"position_id":          createdPosition.PositionID,
			"account_id":           createdPosition.AccountID,
			"symbol":               createdPosition.Symbol,
			"side":                 createdPosition.Side,
			"entry_price":          createdPosition.EntryPrice,
			"current_price":        createdPosition.CurrentPrice,
			"stop_loss":            createdPosition.StopLoss,
			"take_profit":          createdPosition.TakeProfit,
			"entry_time":           formatTime(createdPosition.EntryTime),
			"status":               createdPosition.Status,
			"size_usd":             createdPosition.SizeUsd,
			"size_qty":             createdPosition.SizeQty,
			"risk_usd":             createdPosition.RiskUsd,
			"risk_percent":         createdPosition.RiskPercent,
			"expected_rr":          createdPosition.ExpectedRr,
			"realized_pnl":         createdPosition.RealizedPnl,
			"unrealized_pnl":       createdPosition.UnrealizedPnl,
			"linked_prediction_id": createdPosition.LinkedPredictionID,
		},
	})
}

// generateTestnetPositionID generates a unique testnet position ID
func generateTestnetPositionID() string {
	return fmt.Sprintf("testnet_pos_%d", time.Now().UnixNano())
}

// GetTestnetPendingOrders handles GET /api/testnet/pending-orders
func GetTestnetPendingOrders(c *gin.Context) {
	logger.Info("GET /api/testnet/pending-orders called")

	if testnetPendingOrderRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Testnet pending order repository not initialized",
		})
		return
	}

	symbol := c.Query("symbol")
	status := c.Query("status")
	methodID := c.Query("method_id")

	var orders interface{}
	var err error

	if symbol != "" && methodID != "" {
		orders, err = testnetPendingOrderRepo.GetBySymbolAndMethod(c.Request.Context(), symbol, methodID)
	} else if symbol != "" && status != "" {
		// Filter by both symbol and status - need to implement in repo
		// For now, just filter by symbol
		orders, err = testnetPendingOrderRepo.GetBySymbol(c.Request.Context(), symbol)
	} else if symbol != "" {
		orders, err = testnetPendingOrderRepo.GetBySymbol(c.Request.Context(), symbol)
	} else if status != "" {
		orders, err = testnetPendingOrderRepo.GetByStatus(c.Request.Context(), status)
	} else {
		orders, err = testnetPendingOrderRepo.GetAll(c.Request.Context(), "", "", "")
	}

	if err != nil {
		logger.Error("Failed to get testnet pending orders", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to retrieve testnet pending orders",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    orders,
	})
}

// GetTestnetPosition handles GET /api/testnet/positions/:id
func GetTestnetPosition(c *gin.Context) {
	idStr := c.Param("id")
	logger.Info("GET /api/testnet/positions/:id called", zap.String("id", idStr))

	if testnetPositionRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Testnet position repository not initialized",
		})
		return
	}

	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid position ID",
		})
		return
	}

	position, err := testnetPositionRepo.GetByID(c.Request.Context(), id)
	if err != nil {
		logger.Error("Failed to get testnet position", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to retrieve testnet position",
		})
		return
	}

	if position == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "Testnet position not found",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    position,
	})
}

// GetTestnetAccounts handles GET /api/testnet/accounts
func GetTestnetAccounts(c *gin.Context) {
	logger.Info("GET /api/testnet/accounts called")

	if testnetAccountRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Testnet account repository not initialized",
		})
		return
	}

	accounts, err := testnetAccountRepo.GetAll(c.Request.Context())
	if err != nil {
		logger.Error("Failed to get testnet accounts", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to retrieve testnet accounts",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    accounts,
	})
}

// ResetTestnetAccount handles POST /api/testnet/accounts/reset
func ResetTestnetAccount(c *gin.Context) {
	logger.Info("POST /api/testnet/accounts/reset called")

	if testnetAccountRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Testnet account repository not initialized",
		})
		return
	}

	symbol := c.Query("symbol")
	methodID := c.Query("method_id")

	if symbol == "" || methodID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "symbol and method_id are required",
		})
		return
	}

	account, err := testnetAccountRepo.Reset(c.Request.Context(), symbol, methodID)
	if err != nil {
		logger.Error("Failed to reset testnet account", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "Failed to reset testnet account",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    account,
	})
}
