package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
	"github.com/chuyen-gia-crypto/backend/internal/db/ent/position"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"go.uber.org/zap"
)

// PositionRepository handles position data operations
type PositionRepository struct {
	client *ent.Client
}

// NewPositionRepository creates a new position repository
func NewPositionRepository(client *ent.Client) *PositionRepository {
	return &PositionRepository{client: client}
}

// GetByID retrieves a position by ID
func (r *PositionRepository) GetByID(ctx context.Context, id int) (*ent.Position, error) {
	pos, err := r.client.Position.Query().
		Where(position.ID(id)).
		WithAccount().
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, nil
		}
		logger.Error("Failed to get position", zap.Int("id", id), zap.Error(err))
		return nil, fmt.Errorf("failed to get position: %w", err)
	}
	return pos, nil
}

// GetByPositionID retrieves a position by position_id (UUID)
func (r *PositionRepository) GetByPositionID(ctx context.Context, positionID string) (*ent.Position, error) {
	pos, err := r.client.Position.Query().
		Where(position.PositionID(positionID)).
		WithAccount().
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, nil
		}
		logger.Error("Failed to get position by position_id",
			zap.String("position_id", positionID),
			zap.Error(err))
		return nil, fmt.Errorf("failed to get position: %w", err)
	}
	return pos, nil
}

// GetByAccountID retrieves all positions for an account
func (r *PositionRepository) GetByAccountID(ctx context.Context, accountID int) ([]*ent.Position, error) {
	positions, err := r.client.Position.Query().
		Where(position.AccountID(accountID)).
		Order(ent.Desc(position.FieldEntryTime)).
		All(ctx)
	if err != nil {
		logger.Error("Failed to get positions by account_id",
			zap.Int("account_id", accountID),
			zap.Error(err))
		return nil, fmt.Errorf("failed to get positions: %w", err)
	}
	return positions, nil
}

// GetOpenPositions retrieves all open positions
func (r *PositionRepository) GetOpenPositions(ctx context.Context) ([]*ent.Position, error) {
	positions, err := r.client.Position.Query().
		Where(position.Status("open")).
		WithAccount().
		Order(ent.Desc(position.FieldEntryTime)).
		All(ctx)
	if err != nil {
		logger.Error("Failed to get open positions", zap.Error(err))
		return nil, fmt.Errorf("failed to get open positions: %w", err)
	}
	return positions, nil
}

// GetBySymbol retrieves all positions for a symbol
func (r *PositionRepository) GetBySymbol(ctx context.Context, symbol string) ([]*ent.Position, error) {
	positions, err := r.client.Position.Query().
		Where(position.Symbol(symbol)).
		WithAccount().
		Order(ent.Desc(position.FieldEntryTime)).
		All(ctx)
	if err != nil {
		logger.Error("Failed to get positions by symbol",
			zap.String("symbol", symbol),
			zap.Error(err))
		return nil, fmt.Errorf("failed to get positions: %w", err)
	}
	return positions, nil
}

// GetAll retrieves all positions with optional filters
func (r *PositionRepository) GetAll(ctx context.Context, symbol, status, methodID string) ([]*ent.Position, error) {
	query := r.client.Position.Query().WithAccount()

	if symbol != "" {
		query = query.Where(position.Symbol(symbol))
	}
	if status != "" {
		query = query.Where(position.Status(status))
	}
	if methodID != "" {
		query = query.Where(position.MethodID(methodID))
	}

	positions, err := query.Order(ent.Desc(position.FieldEntryTime)).All(ctx)
	if err != nil {
		logger.Error("Failed to get all positions", zap.Error(err))
		return nil, fmt.Errorf("failed to get all positions: %w", err)
	}
	return positions, nil
}

// Create creates a new position
func (r *PositionRepository) Create(ctx context.Context, pos *ent.Position) (*ent.Position, error) {
	builder := r.client.Position.Create().
		SetPositionID(pos.PositionID).
		SetAccountID(pos.AccountID).
		SetSymbol(pos.Symbol).
		SetSide(pos.Side).
		SetEntryPrice(pos.EntryPrice).
		SetCurrentPrice(pos.CurrentPrice).
		SetStopLoss(pos.StopLoss).
		SetTakeProfit(pos.TakeProfit).
		SetEntryTime(pos.EntryTime).
		SetStatus(pos.Status).
		SetSizeUsd(pos.SizeUsd).
		SetSizeQty(pos.SizeQty).
		SetRiskUsd(pos.RiskUsd).
		SetRiskPercent(pos.RiskPercent).
		SetExpectedRr(pos.ExpectedRr).
		SetRealizedPnl(pos.RealizedPnl).
		SetUnrealizedPnl(pos.UnrealizedPnl).
		SetTp1Hit(pos.Tp1Hit).
		SetIctStrategy(pos.IctStrategy).
		SetTpLevels(pos.TpLevels).
		SetTpHitCount(pos.TpHitCount).
		SetPartialClosed(pos.PartialClosed).
		SetRMultiple(pos.RMultiple).
		SetMethodID(pos.MethodID)

	// Set optional fields if they have values
	if pos.ClosePrice != nil {
		builder = builder.SetNillableClosePrice(pos.ClosePrice)
	}
	if pos.CloseTime != nil {
		builder = builder.SetNillableCloseTime(pos.CloseTime)
	}
	if pos.CloseReason != nil {
		builder = builder.SetNillableCloseReason(pos.CloseReason)
	}
	if pos.LinkedPredictionID != nil {
		builder = builder.SetNillableLinkedPredictionID(pos.LinkedPredictionID)
	}
	if pos.InvalidationLevel != nil {
		builder = builder.SetNillableInvalidationLevel(pos.InvalidationLevel)
	}

	created, err := builder.Save(ctx)
	if err != nil {
		logger.Error("Failed to create position",
			zap.String("position_id", pos.PositionID),
			zap.String("symbol", pos.Symbol),
			zap.Error(err))
		return nil, fmt.Errorf("failed to create position: %w", err)
	}
	return created, nil
}

// Update updates an existing position
func (r *PositionRepository) Update(ctx context.Context, pos *ent.Position) (*ent.Position, error) {
	updated, err := pos.Update().Save(ctx)
	if err != nil {
		logger.Error("Failed to update position",
			zap.Int("id", pos.ID),
			zap.Error(err))
		return nil, fmt.Errorf("failed to update position: %w", err)
	}
	return updated, nil
}

// UpdateCurrentPrice updates the current price of a position
func (r *PositionRepository) UpdateCurrentPrice(ctx context.Context, id int, currentPrice, unrealizedPnL float64) error {
	err := r.client.Position.UpdateOneID(id).
		SetCurrentPrice(currentPrice).
		SetUnrealizedPnl(unrealizedPnL).
		Exec(ctx)
	if err != nil {
		logger.Error("Failed to update position current price",
			zap.Int("id", id),
			zap.Error(err))
		return fmt.Errorf("failed to update position current price: %w", err)
	}
	return nil
}

// ClosePosition closes a position
func (r *PositionRepository) ClosePosition(ctx context.Context, id int, closePrice float64, closeReason string, closeTime time.Time) error {
	err := r.client.Position.UpdateOneID(id).
		SetStatus("closed").
		SetNillableClosePrice(&closePrice).
		SetNillableCloseReason(&closeReason).
		SetNillableCloseTime(&closeTime).
		Exec(ctx)
	if err != nil {
		logger.Error("Failed to close position",
			zap.Int("id", id),
			zap.Error(err))
		return fmt.Errorf("failed to close position: %w", err)
	}
	return nil
}
