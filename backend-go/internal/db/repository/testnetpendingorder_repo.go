package repository

import (
	"context"
	"time"

	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
	"github.com/chuyen-gia-crypto/backend/internal/db/ent/testnetpendingorder"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"go.uber.org/zap"
)

// TestnetPendingOrderRepository handles testnet pending order data operations
type TestnetPendingOrderRepository struct {
	client *ent.Client
}

// NewTestnetPendingOrderRepository creates a new testnet pending order repository
func NewTestnetPendingOrderRepository(client *ent.Client) *TestnetPendingOrderRepository {
	return &TestnetPendingOrderRepository{client: client}
}

// Create creates a new testnet pending order
func (r *TestnetPendingOrderRepository) Create(ctx context.Context, order *ent.TestnetPendingOrder) (*ent.TestnetPendingOrder, error) {
	builder := r.client.TestnetPendingOrder.Create().
		SetOrderID(order.OrderID).
		SetAccountID(order.AccountID).
		SetSymbol(order.Symbol).
		SetSide(order.Side).
		SetEntryPrice(order.EntryPrice).
		SetStopLoss(order.StopLoss).
		SetTakeProfit(order.TakeProfit).
		SetSizeUsd(order.SizeUsd).
		SetSizeQty(order.SizeQty).
		SetRiskUsd(order.RiskUsd).
		SetRiskPercent(order.RiskPercent).
		SetExpectedRr(order.ExpectedRr).
		SetStatus(order.Status).
		SetCreatedAt(order.CreatedAt)

	if order.MethodID != "" {
		builder = builder.SetMethodID(order.MethodID)
	}
	if order.LinkedPredictionID != nil {
		builder = builder.SetLinkedPredictionID(*order.LinkedPredictionID)
	}
	if order.InvalidationLevel != nil {
		builder = builder.SetInvalidationLevel(*order.InvalidationLevel)
	}

	created, err := builder.Save(ctx)
	if err != nil {
		logger.Error("Failed to create testnet pending order", zap.Error(err))
		return nil, err
	}
	return created, nil
}

// GetByAccountID retrieves testnet pending orders for an account
func (r *TestnetPendingOrderRepository) GetByAccountID(ctx context.Context, accountID int) ([]*ent.TestnetPendingOrder, error) {
	orders, err := r.client.TestnetPendingOrder.Query().
		Where(testnetpendingorder.AccountID(accountID)).
		WithAccount().
		Order(ent.Desc(testnetpendingorder.FieldCreatedAt)).
		All(ctx)
	if err != nil {
		logger.Error("Failed to get testnet pending orders by account_id",
			zap.Int("account_id", accountID),
			zap.Error(err))
		return nil, err
	}
	return orders, nil
}

// GetByStatus retrieves testnet pending orders by status
func (r *TestnetPendingOrderRepository) GetByStatus(ctx context.Context, status string) ([]*ent.TestnetPendingOrder, error) {
	orders, err := r.client.TestnetPendingOrder.Query().
		Where(testnetpendingorder.Status(status)).
		WithAccount().
		Order(ent.Desc(testnetpendingorder.FieldCreatedAt)).
		All(ctx)
	if err != nil {
		logger.Error("Failed to get testnet pending orders by status",
			zap.String("status", status),
			zap.Error(err))
		return nil, err
	}
	return orders, nil
}

// GetBySymbol retrieves testnet pending orders for a symbol
func (r *TestnetPendingOrderRepository) GetBySymbol(ctx context.Context, symbol string) ([]*ent.TestnetPendingOrder, error) {
	orders, err := r.client.TestnetPendingOrder.Query().
		Where(testnetpendingorder.Symbol(symbol)).
		WithAccount().
		Order(ent.Desc(testnetpendingorder.FieldCreatedAt)).
		All(ctx)
	if err != nil {
		logger.Error("Failed to get testnet pending orders by symbol",
			zap.String("symbol", symbol),
			zap.Error(err))
		return nil, err
	}
	return orders, nil
}

// GetBySymbolAndMethod retrieves testnet pending orders for a symbol and method
func (r *TestnetPendingOrderRepository) GetBySymbolAndMethod(ctx context.Context, symbol, methodID string) ([]*ent.TestnetPendingOrder, error) {
	orders, err := r.client.TestnetPendingOrder.Query().
		Where(
			testnetpendingorder.Symbol(symbol),
			testnetpendingorder.MethodID(methodID),
		).
		WithAccount().
		Order(ent.Desc(testnetpendingorder.FieldCreatedAt)).
		All(ctx)
	if err != nil {
		logger.Error("Failed to get testnet pending orders by symbol and method",
			zap.String("symbol", symbol),
			zap.String("method_id", methodID),
			zap.Error(err))
		return nil, err
	}
	return orders, nil
}

// GetByID retrieves a testnet pending order by ID
func (r *TestnetPendingOrderRepository) GetByID(ctx context.Context, id int) (*ent.TestnetPendingOrder, error) {
	order, err := r.client.TestnetPendingOrder.Query().
		Where(testnetpendingorder.ID(id)).
		WithAccount().
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, nil
		}
		logger.Error("Failed to get testnet pending order", zap.Int("id", id), zap.Error(err))
		return nil, err
	}
	return order, nil
}

// GetAll retrieves all testnet pending orders with optional filters
func (r *TestnetPendingOrderRepository) GetAll(ctx context.Context, symbol, status, methodID string) ([]*ent.TestnetPendingOrder, error) {
	query := r.client.TestnetPendingOrder.Query().WithAccount()

	if symbol != "" {
		query = query.Where(testnetpendingorder.Symbol(symbol))
	}
	if status != "" {
		query = query.Where(testnetpendingorder.Status(status))
	}
	if methodID != "" {
		query = query.Where(testnetpendingorder.MethodID(methodID))
	}

	orders, err := query.Order(ent.Desc(testnetpendingorder.FieldCreatedAt)).All(ctx)
	if err != nil {
		logger.Error("Failed to get testnet pending orders", zap.Error(err))
		return nil, err
	}
	return orders, nil
}

// Update updates a testnet pending order
func (r *TestnetPendingOrderRepository) Update(ctx context.Context, order *ent.TestnetPendingOrder) (*ent.TestnetPendingOrder, error) {
	updated, err := order.Update().Save(ctx)
	if err != nil {
		logger.Error("Failed to update testnet pending order", zap.Int("id", order.ID), zap.Error(err))
		return nil, err
	}
	return updated, nil
}

// ExecuteOrder executes a testnet pending order
func (r *TestnetPendingOrderRepository) ExecuteOrder(ctx context.Context, id int, executedPrice float64, executedSizeQty float64, executedSizeUsd float64) error {
	now := time.Now()
	err := r.client.TestnetPendingOrder.UpdateOneID(id).
		SetStatus("executed").
		SetNillableExecutedAt(&now).
		SetNillableExecutedPrice(&executedPrice).
		SetNillableExecutedSizeQty(&executedSizeQty).
		SetNillableExecutedSizeUsd(&executedSizeUsd).
		Exec(ctx)
	if err != nil {
		logger.Error("Failed to execute testnet pending order", zap.Int("id", id), zap.Error(err))
		return err
	}
	return nil
}

// CancelOrder cancels a testnet pending order
func (r *TestnetPendingOrderRepository) CancelOrder(ctx context.Context, id int, reason string) error {
	err := r.client.TestnetPendingOrder.UpdateOneID(id).
		SetStatus("cancelled").
		SetNillableCloseReason(&reason).
		Exec(ctx)
	if err != nil {
		logger.Error("Failed to cancel testnet pending order", zap.Int("id", id), zap.Error(err))
		return err
	}
	return nil
}
