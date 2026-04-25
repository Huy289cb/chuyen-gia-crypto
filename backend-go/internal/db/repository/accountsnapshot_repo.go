package repository

import (
	"context"
	"time"

	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
	"github.com/chuyen-gia-crypto/backend/internal/db/ent/accountsnapshot"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"go.uber.org/zap"
)

// AccountSnapshotRepository handles account snapshot data operations
type AccountSnapshotRepository struct {
	client *ent.Client
}

// NewAccountSnapshotRepository creates a new account snapshot repository
func NewAccountSnapshotRepository(client *ent.Client) *AccountSnapshotRepository {
	return &AccountSnapshotRepository{client: client}
}

// Create creates a new account snapshot
func (r *AccountSnapshotRepository) Create(ctx context.Context, snapshot *ent.AccountSnapshot) (*ent.AccountSnapshot, error) {
	created, err := r.client.AccountSnapshot.Create().
		SetAccountID(snapshot.AccountID).
		SetBalance(snapshot.Balance).
		SetEquity(snapshot.Equity).
		SetUnrealizedPnl(snapshot.UnrealizedPnl).
		SetOpenPositions(snapshot.OpenPositions).
		Save(ctx)
	if err != nil {
		logger.Error("Failed to create account snapshot", zap.Error(err))
		return nil, err
	}
	return created, nil
}

// GetByAccountID retrieves snapshots for an account
func (r *AccountSnapshotRepository) GetByAccountID(ctx context.Context, accountID int, limit int) ([]*ent.AccountSnapshot, error) {
	snapshots, err := r.client.AccountSnapshot.Query().
		Where(accountsnapshot.AccountID(accountID)).
		Order(ent.Desc(accountsnapshot.FieldTimestamp)).
		Limit(limit).
		All(ctx)
	if err != nil {
		logger.Error("Failed to get account snapshots", zap.Error(err))
		return nil, err
	}
	return snapshots, nil
}

// GetLatestByAccountID retrieves the latest snapshot for an account
func (r *AccountSnapshotRepository) GetLatestByAccountID(ctx context.Context, accountID int) (*ent.AccountSnapshot, error) {
	snapshot, err := r.client.AccountSnapshot.Query().
		Where(accountsnapshot.AccountID(accountID)).
		Order(ent.Desc(accountsnapshot.FieldTimestamp)).
		First(ctx)
	if err != nil {
		logger.Error("Failed to get latest account snapshot", zap.Error(err))
		return nil, err
	}
	return snapshot, nil
}

// DeleteOldSnapshots deletes snapshots older than a given time
func (r *AccountSnapshotRepository) DeleteOldSnapshots(ctx context.Context, before time.Time) error {
	_, err := r.client.AccountSnapshot.Delete().
		Where(accountsnapshot.TimestampLT(before)).
		Exec(ctx)
	if err != nil {
		logger.Error("Failed to delete old snapshots", zap.Error(err))
		return err
	}
	return nil
}
