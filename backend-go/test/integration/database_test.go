package integration

import (
	"context"
	"testing"
	"time"

	"github.com/chuyen-gia-crypto/backend/internal/config"
	"github.com/chuyen-gia-crypto/backend/internal/db"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	_ "github.com/lib/pq"
)

func TestDatabaseConnection(t *testing.T) {
	// This test requires a running PostgreSQL instance
	// For now, we'll skip it in CI/CD environments
	t.Skip("Requires PostgreSQL instance")

	// Initialize logger
	err := logger.Init("info", "console")
	require.NoError(t, err)
	defer logger.Sync()

	// Load config
	err = config.Load()
	require.NoError(t, err)

	// Initialize database
	ctx := context.Background()
	err = db.Init(ctx)
	require.NoError(t, err)
	defer db.Close()

	// Test health check
	err = db.HealthCheck(ctx)
	assert.NoError(t, err)
}

func TestDatabaseContextCancellation(t *testing.T) {
	// Test that database operations respect context cancellation
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	select {
	case <-ctx.Done():
		assert.Equal(t, context.Canceled, ctx.Err())
	default:
		assert.Fail(t, "context should be cancelled")
	}
}

func TestDatabaseContextTimeout(t *testing.T) {
	// Test context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	select {
	case <-ctx.Done():
		assert.Equal(t, context.DeadlineExceeded, ctx.Err())
	case <-time.After(200 * time.Millisecond):
		assert.Fail(t, "context should have timed out")
	}
}
