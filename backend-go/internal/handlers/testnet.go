package handlers

import (
	"net/http"
	"strconv"

	"github.com/chuyen-gia-crypto/backend/internal/db/repository"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

var (
	testnetAccountRepo  *repository.TestnetAccountRepository
	testnetPositionRepo *repository.TestnetPositionRepository
)

// InitTestnetHandlers initializes testnet handlers with repositories
func InitTestnetHandlers(accountRepo *repository.TestnetAccountRepository, positionRepo *repository.TestnetPositionRepository) {
	testnetAccountRepo = accountRepo
	testnetPositionRepo = positionRepo
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

	if testnetPositionRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false,
			"error":   "Testnet position repository not initialized",
		})
		return
	}

	// TODO: Parse request body and create position
	// This requires request body struct definition

	c.JSON(http.StatusNotImplemented, gin.H{
		"success": false,
		"error":   "Testnet position creation requires request body parsing",
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
