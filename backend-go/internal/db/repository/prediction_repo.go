package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
	"github.com/chuyen-gia-crypto/backend/internal/db/ent/prediction"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"go.uber.org/zap"
)

// PredictionRepository handles prediction data operations
type PredictionRepository struct {
	client *ent.Client
}

// NewPredictionRepository creates a new prediction repository
func NewPredictionRepository(client *ent.Client) *PredictionRepository {
	return &PredictionRepository{client: client}
}

// GetByID retrieves a prediction by ID
func (r *PredictionRepository) GetByID(ctx context.Context, id int) (*ent.Prediction, error) {
	pred, err := r.client.Prediction.Query().
		Where(prediction.ID(id)).
		WithAnalysis().
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, nil
		}
		logger.Error("Failed to get prediction", zap.Int("id", id), zap.Error(err))
		return nil, fmt.Errorf("failed to get prediction: %w", err)
	}
	return pred, nil
}

// GetByAnalysisID retrieves all predictions for an analysis
func (r *PredictionRepository) GetByAnalysisID(ctx context.Context, analysisID int) ([]*ent.Prediction, error) {
	predictions, err := r.client.Prediction.Query().
		Where(prediction.AnalysisID(analysisID)).
		All(ctx)
	if err != nil {
		logger.Error("Failed to get predictions by analysis_id",
			zap.Int("analysis_id", analysisID),
			zap.Error(err))
		return nil, fmt.Errorf("failed to get predictions: %w", err)
	}
	return predictions, nil
}

// GetByCoin retrieves predictions for a coin
func (r *PredictionRepository) GetByCoin(ctx context.Context, coin string, limit int) ([]*ent.Prediction, error) {
	query := r.client.Prediction.Query().
		Where(prediction.Coin(coin)).
		Order(ent.Desc(prediction.FieldPredictedAt))

	if limit > 0 {
		query = query.Limit(limit)
	}

	predictions, err := query.All(ctx)
	if err != nil {
		logger.Error("Failed to get predictions by coin",
			zap.String("coin", coin),
			zap.Error(err))
		return nil, fmt.Errorf("failed to get predictions: %w", err)
	}
	return predictions, nil
}

// GetActive retrieves active (not expired) predictions
func (r *PredictionRepository) GetActive(ctx context.Context, coin string) ([]*ent.Prediction, error) {
	predictions, err := r.client.Prediction.Query().
		Where(
			prediction.Coin(coin),
			prediction.ExpiresAtGT(time.Now()),
		).
		Order(ent.Desc(prediction.FieldPredictedAt)).
		All(ctx)
	if err != nil {
		logger.Error("Failed to get active predictions",
			zap.String("coin", coin),
			zap.Error(err))
		return nil, fmt.Errorf("failed to get active predictions: %w", err)
	}
	return predictions, nil
}

// GetAll retrieves all predictions with optional filters
func (r *PredictionRepository) GetAll(ctx context.Context, coin, timeframe, methodID string, limit int) ([]*ent.Prediction, error) {
	query := r.client.Prediction.Query()

	if coin != "" {
		query = query.Where(prediction.Coin(coin))
	}
	if timeframe != "" {
		query = query.Where(prediction.Timeframe(timeframe))
	}
	if methodID != "" {
		query = query.Where(prediction.MethodID(methodID))
	}

	query = query.Order(ent.Desc(prediction.FieldPredictedAt))

	if limit > 0 {
		query = query.Limit(limit)
	}

	predictions, err := query.All(ctx)
	if err != nil {
		logger.Error("Failed to get all predictions", zap.Error(err))
		return nil, fmt.Errorf("failed to get all predictions: %w", err)
	}
	return predictions, nil
}

// Create creates a new prediction
func (r *PredictionRepository) Create(ctx context.Context, pred *ent.Prediction) (*ent.Prediction, error) {
	created, err := r.client.Prediction.Create().
		SetAnalysisID(pred.AnalysisID).
		SetCoin(pred.Coin).
		SetTimeframe(pred.Timeframe).
		SetDirection(pred.Direction).
		SetTargetPrice(pred.TargetPrice).
		SetConfidence(pred.Confidence).
		SetPredictedAt(pred.PredictedAt).
		SetExpiresAt(pred.ExpiresAt).
		SetActualPrice(pred.ActualPrice).
		SetAccuracy(pred.Accuracy).
		SetIsCorrect(pred.IsCorrect).
		SetOutcome(pred.Outcome).
		SetPnl(pred.Pnl).
		SetHitTp(pred.HitTp).
		SetHitSl(pred.HitSl).
		SetLinkedPositionID(pred.LinkedPositionID).
		SetSuggestedEntry(pred.SuggestedEntry).
		SetSuggestedStopLoss(pred.SuggestedStopLoss).
		SetSuggestedTakeProfit(pred.SuggestedTakeProfit).
		SetExpectedRr(pred.ExpectedRr).
		SetInvalidationLevel(pred.InvalidationLevel).
		SetReasonSummary(pred.ReasonSummary).
		SetModelVersion(pred.ModelVersion).
		SetMethodID(pred.MethodID).
		Save(ctx)
	if err != nil {
		logger.Error("Failed to create prediction",
			zap.String("coin", pred.Coin),
			zap.String("timeframe", pred.Timeframe),
			zap.Error(err))
		return nil, fmt.Errorf("failed to create prediction: %w", err)
	}
	return created, nil
}

// Update updates an existing prediction
func (r *PredictionRepository) Update(ctx context.Context, pred *ent.Prediction) (*ent.Prediction, error) {
	updated, err := pred.Update().Save(ctx)
	if err != nil {
		logger.Error("Failed to update prediction",
			zap.Int("id", pred.ID),
			zap.Error(err))
		return nil, fmt.Errorf("failed to update prediction: %w", err)
	}
	return updated, nil
}

// Validate updates a prediction with actual price and accuracy
func (r *PredictionRepository) Validate(ctx context.Context, id int, actualPrice float64, isCorrect bool, outcome string) error {
	err := r.client.Prediction.UpdateOneID(id).
		SetActualPrice(actualPrice).
		SetIsCorrect(isCorrect).
		SetOutcome(outcome).
		Exec(ctx)
	if err != nil {
		logger.Error("Failed to validate prediction",
			zap.Int("id", id),
			zap.Error(err))
		return fmt.Errorf("failed to validate prediction: %w", err)
	}
	return nil
}
