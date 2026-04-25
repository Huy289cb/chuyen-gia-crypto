package handlers

import (
	"github.com/chuyen-gia-crypto/backend/internal/analyzers"
	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
	"github.com/chuyen-gia-crypto/backend/internal/db/repository"
)

// Dependencies holds all handler dependencies
type Dependencies struct {
	DB                  *ent.Client
	AccountRepo         *repository.AccountRepository
	PositionRepo        *repository.PositionRepository
	AnalysisRepo        *repository.AnalysisRepository
	PredictionRepo      *repository.PredictionRepository
	AccountSnapshotRepo *repository.AccountSnapshotRepository
	Analyzer            *analyzers.Analyzer
}

// NewDependencies creates a new dependencies struct
func NewDependencies(client *ent.Client) *Dependencies {
	return &Dependencies{
		DB:                  client,
		AccountRepo:         repository.NewAccountRepository(client),
		PositionRepo:        repository.NewPositionRepository(client),
		AnalysisRepo:        repository.NewAnalysisRepository(client),
		PredictionRepo:      repository.NewPredictionRepository(client),
		AccountSnapshotRepo: repository.NewAccountSnapshotRepository(client),
	}
}

// Global dependencies instance
var Deps *Dependencies

// InitDependencies initializes the global dependencies
func InitDependencies(client *ent.Client) {
	Deps = NewDependencies(client)
}

// SetAnalyzer sets the analyzer in dependencies
func SetAnalyzer(analyzer *analyzers.Analyzer) {
	if Deps != nil {
		Deps.Analyzer = analyzer
	}
}
