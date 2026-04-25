package db

import (
	"context"
	"fmt"

	"github.com/chuyen-gia-crypto/backend/internal/config"
	"github.com/chuyen-gia-crypto/backend/internal/db/ent"
	"github.com/chuyen-gia-crypto/backend/pkg/errors"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	_ "github.com/lib/pq"
	"go.uber.org/zap"
)

var Client *ent.Client

// Init initializes the database connection
func Init(ctx context.Context) error {
	cfg := config.AppConfig.Database

	dsn := fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		cfg.Host,
		cfg.Port,
		cfg.User,
		cfg.Password,
		cfg.DBName,
		cfg.SSLMode,
	)

	logger.Info("Connecting to database",
		zap.String("host", cfg.Host),
		zap.Int("port", cfg.Port),
		zap.String("dbname", cfg.DBName),
	)

	var err error
	Client, err = ent.Open("postgres", dsn)
	if err != nil {
		return errors.NewDatabaseError("failed to open database connection", err)
	}

	// Configure connection pool
	Client = Client.Debug()

	// Run auto-migration
	if err := Client.Schema.Create(ctx); err != nil {
		return errors.NewDatabaseError("failed to create schema", err)
	}

	logger.Info("Database connection established successfully")

	return nil
}

// Close closes the database connection
func Close() error {
	if Client != nil {
		if err := Client.Close(); err != nil {
			return errors.NewDatabaseError("failed to close database connection", err)
		}
		logger.Info("Database connection closed")
	}
	return nil
}

// HealthCheck checks if the database connection is healthy
func HealthCheck(ctx context.Context) error {
	if Client == nil {
		return errors.NewDatabaseError("database client is not initialized", nil)
	}

	// Simple ping by executing a query with context
	if err := Client.Schema.Create(ctx); err != nil {
		return errors.NewDatabaseError("database health check failed", err)
	}

	return nil
}
