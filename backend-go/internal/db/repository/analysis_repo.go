package repository

import (
	"context"
	"fmt"

	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
	"github.com/chuyen-gia-crypto/backend/internal/db/ent/analysishistory"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"go.uber.org/zap"
)

// AnalysisRepository handles analysis history data operations
type AnalysisRepository struct {
	client *ent.Client
}

// NewAnalysisRepository creates a new analysis repository
func NewAnalysisRepository(client *ent.Client) *AnalysisRepository {
	return &AnalysisRepository{client: client}
}

// GetLatestByCoinAndMethod retrieves the latest analysis for a coin and method
func (r *AnalysisRepository) GetLatestByCoinAndMethod(ctx context.Context, coin, methodID string) (*ent.AnalysisHistory, error) {
	analysis, err := r.client.AnalysisHistory.Query().
		Where(analysishistory.Coin(coin), analysishistory.MethodID(methodID)).
		Order(ent.Desc(analysishistory.FieldTimestamp)).
		WithPredictions().
		WithKeyLevels().
		First(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, nil
		}
		logger.Error("Failed to get latest analysis",
			zap.String("coin", coin),
			zap.String("method_id", methodID),
			zap.Error(err))
		return nil, fmt.Errorf("failed to get latest analysis: %w", err)
	}
	return analysis, nil
}

// GetByID retrieves an analysis by ID
func (r *AnalysisRepository) GetByID(ctx context.Context, id int) (*ent.AnalysisHistory, error) {
	analysis, err := r.client.AnalysisHistory.Query().
		Where(analysishistory.ID(id)).
		WithPredictions().
		WithKeyLevels().
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, nil
		}
		logger.Error("Failed to get analysis by ID", zap.Int("id", id), zap.Error(err))
		return nil, fmt.Errorf("failed to get analysis: %w", err)
	}
	return analysis, nil
}

// GetByCoin retrieves all analyses for a coin
func (r *AnalysisRepository) GetByCoin(ctx context.Context, coin string, limit int) ([]*ent.AnalysisHistory, error) {
	query := r.client.AnalysisHistory.Query().
		Where(analysishistory.Coin(coin)).
		Order(ent.Desc(analysishistory.FieldTimestamp))
	
	if limit > 0 {
		query = query.Limit(limit)
	}
	
	analyses, err := query.All(ctx)
	if err != nil {
		logger.Error("Failed to get analyses by coin",
			zap.String("coin", coin),
			zap.Error(err))
		return nil, fmt.Errorf("failed to get analyses: %w", err)
	}
	return analyses, nil
}

// GetByMethod retrieves all analyses for a method
func (r *AnalysisRepository) GetByMethod(ctx context.Context, methodID string, limit int) ([]*ent.AnalysisHistory, error) {
	query := r.client.AnalysisHistory.Query().
		Where(analysishistory.MethodID(methodID)).
		Order(ent.Desc(analysishistory.FieldTimestamp))
	
	if limit > 0 {
		query = query.Limit(limit)
	}
	
	analyses, err := query.All(ctx)
	if err != nil {
		logger.Error("Failed to get analyses by method",
			zap.String("method_id", methodID),
			zap.Error(err))
		return nil, fmt.Errorf("failed to get analyses: %w", err)
	}
	return analyses, nil
}

// GetAll retrieves all analyses with optional filters
func (r *AnalysisRepository) GetAll(ctx context.Context, coin, methodID string, limit int) ([]*ent.AnalysisHistory, error) {
	query := r.client.AnalysisHistory.Query()
	
	if coin != "" {
		query = query.Where(analysishistory.Coin(coin))
	}
	if methodID != "" {
		query = query.Where(analysishistory.MethodID(methodID))
	}
	
	query = query.Order(ent.Desc(analysishistory.FieldTimestamp))
	
	if limit > 0 {
		query = query.Limit(limit)
	}
	
	analyses, err := query.All(ctx)
	if err != nil {
		logger.Error("Failed to get all analyses", zap.Error(err))
		return nil, fmt.Errorf("failed to get all analyses: %w", err)
	}
	return analyses, nil
}

// Create creates a new analysis
func (r *AnalysisRepository) Create(ctx context.Context, analysis *ent.AnalysisHistory) (*ent.AnalysisHistory, error) {
	created, err := r.client.AnalysisHistory.Create().
		SetCoin(analysis.Coin).
		SetTimestamp(analysis.Timestamp).
		SetCurrentPrice(analysis.CurrentPrice).
		SetBias(analysis.Bias).
		SetAction(analysis.Action).
		SetConfidence(analysis.Confidence).
		SetNarrative(analysis.Narrative).
		SetComparison(analysis.Comparison).
		SetMarketSentiment(analysis.MarketSentiment).
		SetDisclaimer(analysis.Disclaimer).
		SetMethodID(analysis.MethodID).
		SetBreakoutRetest(analysis.BreakoutRetest).
		SetPositionDecisions(analysis.PositionDecisions).
		SetAlternativeScenario(analysis.AlternativeScenario).
		SetSuggestedEntry(analysis.SuggestedEntry).
		SetSuggestedStopLoss(analysis.SuggestedStopLoss).
		SetSuggestedTakeProfit(analysis.SuggestedTakeProfit).
		SetExpectedRr(analysis.ExpectedRr).
		SetInvalidationLevel(analysis.InvalidationLevel).
		SetRawQuestion(analysis.RawQuestion).
		SetRawAnswer(analysis.RawAnswer).
		Save(ctx)
	if err != nil {
		logger.Error("Failed to create analysis",
			zap.String("coin", analysis.Coin),
			zap.String("method_id", analysis.MethodID),
			zap.Error(err))
		return nil, fmt.Errorf("failed to create analysis: %w", err)
	}
	return created, nil
}

// Update updates an existing analysis
func (r *AnalysisRepository) Update(ctx context.Context, analysis *ent.AnalysisHistory) (*ent.AnalysisHistory, error) {
	updated, err := analysis.Update().Save(ctx)
	if err != nil {
		logger.Error("Failed to update analysis",
			zap.Int("id", analysis.ID),
			zap.Error(err))
		return nil, fmt.Errorf("failed to update analysis: %w", err)
	}
	return updated, nil
}
