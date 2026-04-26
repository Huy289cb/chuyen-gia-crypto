package repository

import (
	"context"
	"fmt"

	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
	"github.com/chuyen-gia-crypto/backend/internal/db/ent/testnetaccount"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"go.uber.org/zap"
)

// TestnetAccountRepository handles testnet account data operations
type TestnetAccountRepository struct {
	client *ent.Client
}

// NewTestnetAccountRepository creates a new testnet account repository
func NewTestnetAccountRepository(client *ent.Client) *TestnetAccountRepository {
	return &TestnetAccountRepository{client: client}
}

// GetBySymbolAndMethod retrieves a testnet account by symbol and method ID
func (r *TestnetAccountRepository) GetBySymbolAndMethod(ctx context.Context, symbol, methodID string) (*ent.TestnetAccount, error) {
	acc, err := r.client.TestnetAccount.Query().
		Where(testnetaccount.Symbol(symbol), testnetaccount.MethodID(methodID)).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, nil
		}
		logger.Error("Failed to get testnet account",
			zap.String("symbol", symbol),
			zap.String("method_id", methodID),
			zap.Error(err))
		return nil, fmt.Errorf("failed to get testnet account: %w", err)
	}
	return acc, nil
}

// GetByID retrieves a testnet account by ID
func (r *TestnetAccountRepository) GetByID(ctx context.Context, id int) (*ent.TestnetAccount, error) {
	acc, err := r.client.TestnetAccount.Query().
		Where(testnetaccount.ID(id)).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, nil
		}
		logger.Error("Failed to get testnet account by ID",
			zap.Int("id", id),
			zap.Error(err))
		return nil, fmt.Errorf("failed to get testnet account by ID: %w", err)
	}
	return acc, nil
}

// GetAll retrieves all testnet accounts
func (r *TestnetAccountRepository) GetAll(ctx context.Context) ([]*ent.TestnetAccount, error) {
	accounts, err := r.client.TestnetAccount.Query().All(ctx)
	if err != nil {
		logger.Error("Failed to get all testnet accounts", zap.Error(err))
		return nil, fmt.Errorf("failed to get all testnet accounts: %w", err)
	}
	return accounts, nil
}

// Create creates a new testnet account
func (r *TestnetAccountRepository) Create(ctx context.Context, acc *ent.TestnetAccount) (*ent.TestnetAccount, error) {
	builder := r.client.TestnetAccount.Create().
		SetSymbol(acc.Symbol).
		SetMethodID(acc.MethodID).
		SetStartingBalance(acc.StartingBalance).
		SetCurrentBalance(acc.CurrentBalance).
		SetEquity(acc.Equity).
		SetUnrealizedPnl(acc.UnrealizedPnl).
		SetRealizedPnl(acc.RealizedPnl).
		SetTotalTrades(acc.TotalTrades).
		SetWinningTrades(acc.WinningTrades).
		SetLosingTrades(acc.LosingTrades).
		SetMaxDrawdown(acc.MaxDrawdown).
		SetConsecutiveLosses(acc.ConsecutiveLosses)

	// Set optional fields if they have values
	if acc.LastTradeTime != nil {
		builder = builder.SetNillableLastTradeTime(acc.LastTradeTime)
	}
	if acc.CooldownUntil != nil {
		builder = builder.SetNillableCooldownUntil(acc.CooldownUntil)
	}

	created, err := builder.Save(ctx)
	if err != nil {
		logger.Error("Failed to create testnet account",
			zap.String("symbol", acc.Symbol),
			zap.String("method_id", acc.MethodID),
			zap.Error(err))
		return nil, fmt.Errorf("failed to create testnet account: %w", err)
	}
	return created, nil
}

// Update updates an existing testnet account
func (r *TestnetAccountRepository) Update(ctx context.Context, acc *ent.TestnetAccount) (*ent.TestnetAccount, error) {
	updated, err := acc.Update().Save(ctx)
	if err != nil {
		logger.Error("Failed to update testnet account",
			zap.Int("id", acc.ID),
			zap.Error(err))
		return nil, fmt.Errorf("failed to update testnet account: %w", err)
	}
	return updated, nil
}

// Reset resets a testnet account to initial state
func (r *TestnetAccountRepository) Reset(ctx context.Context, symbol, methodID string) (*ent.TestnetAccount, error) {
	acc, err := r.GetBySymbolAndMethod(ctx, symbol, methodID)
	if err != nil {
		return nil, err
	}
	if acc == nil {
		return nil, fmt.Errorf("testnet account not found")
	}

	updated, err := acc.Update().
		SetCurrentBalance(acc.StartingBalance).
		SetEquity(acc.StartingBalance).
		SetUnrealizedPnl(0).
		SetRealizedPnl(0).
		SetTotalTrades(0).
		SetWinningTrades(0).
		SetLosingTrades(0).
		SetMaxDrawdown(0).
		SetConsecutiveLosses(0).
		ClearLastTradeTime().
		ClearCooldownUntil().
		Save(ctx)
	if err != nil {
		logger.Error("Failed to reset testnet account",
			zap.String("symbol", symbol),
			zap.String("method_id", methodID),
			zap.Error(err))
		return nil, fmt.Errorf("failed to reset testnet account: %w", err)
	}
	return updated, nil
}
