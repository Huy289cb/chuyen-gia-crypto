package repository

import (
	"context"
	"fmt"

	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
	"github.com/chuyen-gia-crypto/backend/internal/db/ent/account"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"go.uber.org/zap"
)

// AccountRepository handles account data operations
type AccountRepository struct {
	client *ent.Client
}

// NewAccountRepository creates a new account repository
func NewAccountRepository(client *ent.Client) *AccountRepository {
	return &AccountRepository{client: client}
}

// GetBySymbolAndMethod retrieves an account by symbol and method ID
func (r *AccountRepository) GetBySymbolAndMethod(ctx context.Context, symbol, methodID string) (*ent.Account, error) {
	acc, err := r.client.Account.Query().
		Where(account.Symbol(symbol), account.MethodID(methodID)).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return nil, nil
		}
		logger.Error("Failed to get account",
			zap.String("symbol", symbol),
			zap.String("method_id", methodID),
			zap.Error(err))
		return nil, fmt.Errorf("failed to get account: %w", err)
	}
	return acc, nil
}

// GetAll retrieves all accounts
func (r *AccountRepository) GetAll(ctx context.Context) ([]*ent.Account, error) {
	accounts, err := r.client.Account.Query().All(ctx)
	if err != nil {
		logger.Error("Failed to get all accounts", zap.Error(err))
		return nil, fmt.Errorf("failed to get all accounts: %w", err)
	}
	return accounts, nil
}

// Create creates a new account
func (r *AccountRepository) Create(ctx context.Context, acc *ent.Account) (*ent.Account, error) {
	builder := r.client.Account.Create().
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
		logger.Error("Failed to create account",
			zap.String("symbol", acc.Symbol),
			zap.String("method_id", acc.MethodID),
			zap.Error(err))
		return nil, fmt.Errorf("failed to create account: %w", err)
	}
	return created, nil
}

// Update updates an existing account
func (r *AccountRepository) Update(ctx context.Context, acc *ent.Account) (*ent.Account, error) {
	updated, err := acc.Update().Save(ctx)
	if err != nil {
		logger.Error("Failed to update account",
			zap.Int("id", acc.ID),
			zap.Error(err))
		return nil, fmt.Errorf("failed to update account: %w", err)
	}
	return updated, nil
}

// Reset resets an account to initial state
func (r *AccountRepository) Reset(ctx context.Context, symbol, methodID string) (*ent.Account, error) {
	acc, err := r.GetBySymbolAndMethod(ctx, symbol, methodID)
	if err != nil {
		return nil, err
	}
	if acc == nil {
		return nil, fmt.Errorf("account not found")
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
		logger.Error("Failed to reset account",
			zap.String("symbol", symbol),
			zap.String("method_id", methodID),
			zap.Error(err))
		return nil, fmt.Errorf("failed to reset account: %w", err)
	}
	return updated, nil
}
