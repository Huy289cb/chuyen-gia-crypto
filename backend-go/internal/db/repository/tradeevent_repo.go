package repository

import (
	"context"

	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
	"github.com/chuyen-gia-crypto/backend/internal/db/ent/tradeevent"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"go.uber.org/zap"
)

// TradeEventRepository handles trade event data operations
type TradeEventRepository struct {
	client *ent.Client
}

// NewTradeEventRepository creates a new trade event repository
func NewTradeEventRepository(client *ent.Client) *TradeEventRepository {
	return &TradeEventRepository{client: client}
}

// Create creates a new trade event
func (r *TradeEventRepository) Create(ctx context.Context, event *ent.TradeEvent) (*ent.TradeEvent, error) {
	create := r.client.TradeEvent.Create().
		SetPositionID(event.PositionID).
		SetEventType(event.EventType).
		SetTimestamp(event.Timestamp)

	if event.EventData != "" {
		create.SetEventData(event.EventData)
	}

	created, err := create.Save(ctx)
	if err != nil {
		logger.Error("Failed to create trade event", zap.Error(err))
		return nil, err
	}
	return created, nil
}

// GetByPositionID retrieves events for a position
func (r *TradeEventRepository) GetByPositionID(ctx context.Context, positionID int) ([]*ent.TradeEvent, error) {
	events, err := r.client.TradeEvent.Query().
		Where(tradeevent.PositionID(positionID)).
		Order(ent.Desc(tradeevent.FieldTimestamp)).
		All(ctx)
	if err != nil {
		logger.Error("Failed to get trade events", zap.Error(err))
		return nil, err
	}
	return events, nil
}
