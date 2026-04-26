package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
	"github.com/chuyen-gia-crypto/backend/internal/db/ent/testnetposition"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"go.uber.org/zap"
)

// TestnetPositionRepository handles testnet position data operations
type TestnetPositionRepository struct {
	client *ent.Client
}

// NewTestnetPositionRepository creates a new testnet position repository
func NewTestnetPositionRepository(client *ent.Client) *TestnetPositionRepository {
	return &TestnetPositionRepository{client: client}
}

// GetByID retrieves a testnet position by ID
func (r *TestnetPositionRepository) GetByID(ctx context.Context, id int) (*ent.TestnetPosition, error) {
	pos, err := r.client.TestnetPosition.Query().
		Where(testnetposition.ID(id)).
		WithAccount().
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, nil
		}
		logger.Error("Failed to get testnet position", zap.Int("id", id), zap.Error(err))
		return nil, fmt.Errorf("failed to get testnet position: %w", err)
	}
	return pos, nil
}

// GetByAccountID retrieves testnet positions for an account
func (r *TestnetPositionRepository) GetByAccountID(ctx context.Context, accountID int) ([]*ent.TestnetPosition, error) {
	positions, err := r.client.TestnetPosition.Query().
		Where(testnetposition.AccountID(accountID)).
		WithAccount().
		Order(ent.Desc(testnetposition.FieldEntryTime)).
		All(ctx)
	if err != nil {
		logger.Error("Failed to get testnet positions by account_id",
			zap.Int("account_id", accountID),
			zap.Error(err))
		return nil, fmt.Errorf("failed to get testnet positions by account_id: %w", err)
	}
	return positions, nil
}

// GetBySymbol retrieves testnet positions for a symbol
func (r *TestnetPositionRepository) GetBySymbol(ctx context.Context, symbol string) ([]*ent.TestnetPosition, error) {
	positions, err := r.client.TestnetPosition.Query().
		Where(testnetposition.Symbol(symbol)).
		WithAccount().
		Order(ent.Desc(testnetposition.FieldEntryTime)).
		All(ctx)
	if err != nil {
		logger.Error("Failed to get testnet positions by symbol",
			zap.String("symbol", symbol),
			zap.Error(err))
		return nil, fmt.Errorf("failed to get testnet positions by symbol: %w", err)
	}
	return positions, nil
}

// GetByStatus retrieves testnet positions by status
func (r *TestnetPositionRepository) GetByStatus(ctx context.Context, status string) ([]*ent.TestnetPosition, error) {
	positions, err := r.client.TestnetPosition.Query().
		Where(testnetposition.Status(status)).
		WithAccount().
		Order(ent.Desc(testnetposition.FieldEntryTime)).
		All(ctx)
	if err != nil {
		logger.Error("Failed to get testnet positions by status",
			zap.String("status", status),
			zap.Error(err))
		return nil, fmt.Errorf("failed to get testnet positions by status: %w", err)
	}
	return positions, nil
}

// GetOpenPositions retrieves all open testnet positions
func (r *TestnetPositionRepository) GetOpenPositions(ctx context.Context) ([]*ent.TestnetPosition, error) {
	return r.GetByStatus(ctx, "open")
}

// GetAll retrieves all testnet positions
func (r *TestnetPositionRepository) GetAll(ctx context.Context) ([]*ent.TestnetPosition, error) {
	positions, err := r.client.TestnetPosition.Query().
		WithAccount().
		Order(ent.Desc(testnetposition.FieldEntryTime)).
		All(ctx)
	if err != nil {
		logger.Error("Failed to get all testnet positions", zap.Error(err))
		return nil, fmt.Errorf("failed to get all testnet positions: %w", err)
	}
	return positions, nil
}

// Create creates a new testnet position
func (r *TestnetPositionRepository) Create(ctx context.Context, pos *ent.TestnetPosition) (*ent.TestnetPosition, error) {
	builder := r.client.TestnetPosition.Create().
		SetPositionID(pos.PositionID).
		SetAccountID(pos.AccountID).
		SetSymbol(pos.Symbol).
		SetSide(pos.Side).
		SetEntryPrice(pos.EntryPrice).
		SetCurrentPrice(pos.CurrentPrice).
		SetStopLoss(pos.StopLoss).
		SetTakeProfit(pos.TakeProfit).
		SetSizeUsd(pos.SizeUsd).
		SetSizeQty(pos.SizeQty).
		SetRiskUsd(pos.RiskUsd).
		SetRiskPercent(pos.RiskPercent).
		SetExpectedRr(pos.ExpectedRr).
		SetStatus(pos.Status).
		SetEntryTime(pos.EntryTime).
		SetUnrealizedPnl(pos.UnrealizedPnl).
		SetRealizedPnl(pos.RealizedPnl).
		SetTpHitCount(pos.TpHitCount).
		SetPartialClosed(pos.PartialClosed)

	// Set optional fields
	if pos.LinkedPredictionID != nil {
		builder = builder.SetNillableLinkedPredictionID(pos.LinkedPredictionID)
	}
	if pos.ClosePrice != nil {
		builder = builder.SetNillableClosePrice(pos.ClosePrice)
	}
	if pos.CloseTime != nil {
		builder = builder.SetNillableCloseTime(pos.CloseTime)
	}
	if pos.CloseReason != nil {
		builder = builder.SetNillableCloseReason(pos.CloseReason)
	}
	if pos.BinanceOrderID != nil {
		builder = builder.SetNillableBinanceOrderID(pos.BinanceOrderID)
	}
	if pos.BinanceSlOrderID != nil {
		builder = builder.SetNillableBinanceSlOrderID(pos.BinanceSlOrderID)
	}
	if pos.BinanceTpOrderID != nil {
		builder = builder.SetNillableBinanceTpOrderID(pos.BinanceTpOrderID)
	}
	if pos.TpLevels != "" {
		builder = builder.SetTpLevels(pos.TpLevels)
	}

	created, err := builder.Save(ctx)
	if err != nil {
		logger.Error("Failed to create testnet position",
			zap.String("symbol", pos.Symbol),
			zap.String("side", pos.Side),
			zap.Error(err))
		return nil, fmt.Errorf("failed to create testnet position: %w", err)
	}
	return created, nil
}

// Update updates a testnet position
func (r *TestnetPositionRepository) Update(ctx context.Context, pos *ent.TestnetPosition) (*ent.TestnetPosition, error) {
	updated, err := pos.Update().Save(ctx)
	if err != nil {
		logger.Error("Failed to update testnet position",
			zap.Int("id", pos.ID),
			zap.Error(err))
		return nil, fmt.Errorf("failed to update testnet position: %w", err)
	}
	return updated, nil
}

// UpdateCurrentPrice updates the current price and unrealized PnL of a testnet position
func (r *TestnetPositionRepository) UpdateCurrentPrice(ctx context.Context, id int, currentPrice, unrealizedPnL float64) error {
	err := r.client.TestnetPosition.UpdateOneID(id).
		SetCurrentPrice(currentPrice).
		SetUnrealizedPnl(unrealizedPnL).
		Exec(ctx)
	if err != nil {
		logger.Error("Failed to update testnet position current price",
			zap.Int("id", id),
			zap.Error(err))
		return fmt.Errorf("failed to update testnet position current price: %w", err)
	}
	return nil
}

// ClosePosition closes a testnet position
func (r *TestnetPositionRepository) ClosePosition(ctx context.Context, id int, closePrice float64, reason string, closeTime time.Time) error {
	err := r.client.TestnetPosition.UpdateOneID(id).
		SetStatus("closed").
		SetCurrentPrice(closePrice).
		SetClosePrice(closePrice).
		SetUnrealizedPnl(0).
		SetCloseTime(closeTime).
		SetCloseReason(reason).
		Exec(ctx)
	if err != nil {
		logger.Error("Failed to close testnet position",
			zap.Int("id", id),
			zap.Error(err))
		return fmt.Errorf("failed to close testnet position: %w", err)
	}
	return nil
}
