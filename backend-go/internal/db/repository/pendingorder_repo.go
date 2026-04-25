package repository

import (
	"context"
	"time"

	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
	"github.com/chuyen-gia-crypto/backend/internal/db/ent/pendingorder"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"go.uber.org/zap"
)

// PendingOrderRepository handles pending order data operations
type PendingOrderRepository struct {
	client *ent.Client
}

// NewPendingOrderRepository creates a new pending order repository
func NewPendingOrderRepository(client *ent.Client) *PendingOrderRepository {
	return &PendingOrderRepository{client: client}
}

// Create creates a new pending order
func (r *PendingOrderRepository) Create(ctx context.Context, order *ent.PendingOrder) (*ent.PendingOrder, error) {
	created, err := r.client.PendingOrder.Create().
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
		SetCreatedAt(order.CreatedAt).
		SetMethodID(order.MethodID).
		Save(ctx)
	if err != nil {
		logger.Error("Failed to create pending order", zap.Error(err))
		return nil, err
	}
	return created, nil
}

// GetByAccountID retrieves pending orders for an account
func (r *PendingOrderRepository) GetByAccountID(ctx context.Context, accountID int) ([]*ent.PendingOrder, error) {
	orders, err := r.client.PendingOrder.Query().
		Where(pendingorder.AccountID(accountID)).
		WithAccount().
		Order(ent.Desc(pendingorder.FieldCreatedAt)).
		All(ctx)
	if err != nil {
		logger.Error("Failed to get pending orders by account_id",
			zap.Int("account_id", accountID),
			zap.Error(err))
		return nil, err
	}
	return orders, nil
}

// GetByStatus retrieves pending orders by status
func (r *PendingOrderRepository) GetByStatus(ctx context.Context, status string) ([]*ent.PendingOrder, error) {
	orders, err := r.client.PendingOrder.Query().
		Where(pendingorder.Status(status)).
		WithAccount().
		Order(ent.Desc(pendingorder.FieldCreatedAt)).
		All(ctx)
	if err != nil {
		logger.Error("Failed to get pending orders by status",
			zap.String("status", status),
			zap.Error(err))
		return nil, err
	}
	return orders, nil
}

// GetBySymbol retrieves pending orders for a symbol
func (r *PendingOrderRepository) GetBySymbol(ctx context.Context, symbol string) ([]*ent.PendingOrder, error) {
	orders, err := r.client.PendingOrder.Query().
		Where(pendingorder.Symbol(symbol)).
		WithAccount().
		Order(ent.Desc(pendingorder.FieldCreatedAt)).
		All(ctx)
	if err != nil {
		logger.Error("Failed to get pending orders by symbol",
			zap.String("symbol", symbol),
			zap.Error(err))
		return nil, err
	}
	return orders, nil
}

// GetByID retrieves a pending order by ID
func (r *PendingOrderRepository) GetByID(ctx context.Context, id int) (*ent.PendingOrder, error) {
	order, err := r.client.PendingOrder.Query().
		Where(pendingorder.ID(id)).
		WithAccount().
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, nil
		}
		logger.Error("Failed to get pending order", zap.Int("id", id), zap.Error(err))
		return nil, err
	}
	return order, nil
}

// Update updates a pending order
func (r *PendingOrderRepository) Update(ctx context.Context, order *ent.PendingOrder) (*ent.PendingOrder, error) {
	updated, err := order.Update().Save(ctx)
	if err != nil {
		logger.Error("Failed to update pending order", zap.Int("id", order.ID), zap.Error(err))
		return nil, err
	}
	return updated, nil
}

// ExecuteOrder executes a pending order
func (r *PendingOrderRepository) ExecuteOrder(ctx context.Context, id int, executedPrice float64, executedSizeQty float64, executedSizeUsd float64) error {
	now := time.Now()
	err := r.client.PendingOrder.UpdateOneID(id).
		SetStatus("executed").
		SetNillableExecutedAt(&now).
		SetNillableExecutedPrice(&executedPrice).
		SetNillableExecutedSizeQty(&executedSizeQty).
		SetNillableExecutedSizeUsd(&executedSizeUsd).
		Exec(ctx)
	if err != nil {
		logger.Error("Failed to execute pending order", zap.Int("id", id), zap.Error(err))
		return err
	}
	return nil
}

// CancelOrder cancels a pending order
func (r *PendingOrderRepository) CancelOrder(ctx context.Context, id int, reason string) error {
	err := r.client.PendingOrder.UpdateOneID(id).
		SetStatus("cancelled").
		SetNillableCloseReason(&reason).
		Exec(ctx)
	if err != nil {
		logger.Error("Failed to cancel pending order", zap.Int("id", id), zap.Error(err))
		return err
	}
	return nil
}
