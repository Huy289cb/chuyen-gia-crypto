package errors

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAppError_Error(t *testing.T) {
	tests := []struct {
		name string
		err  *AppError
		want string
	}{
		{
			name: "error with wrapped error",
			err: &AppError{
				Code:    "TEST_ERROR",
				Message: "test message",
				Err:     errors.New("wrapped error"),
			},
			want: "[TEST_ERROR] test message: wrapped error",
		},
		{
			name: "error without wrapped error",
			err: &AppError{
				Code:    "TEST_ERROR",
				Message: "test message",
				Err:     nil,
			},
			want: "[TEST_ERROR] test message",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.err.Error()
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestAppError_Unwrap(t *testing.T) {
	wrappedErr := errors.New("wrapped error")
	err := &AppError{
		Code:    "TEST_ERROR",
		Message: "test message",
		Err:     wrappedErr,
	}

	unwrapped := err.Unwrap()
	assert.Equal(t, wrappedErr, unwrapped)
}

func TestAppError_Unwrap_Nil(t *testing.T) {
	err := &AppError{
		Code:    "TEST_ERROR",
		Message: "test message",
		Err:     nil,
	}

	unwrapped := err.Unwrap()
	assert.Nil(t, unwrapped)
}

func TestNewAppError(t *testing.T) {
	wrappedErr := errors.New("wrapped error")
	err := NewAppError("TEST_CODE", "test message", wrappedErr)

	assert.Equal(t, "TEST_CODE", err.Code)
	assert.Equal(t, "test message", err.Message)
	assert.Equal(t, wrappedErr, err.Err)
}

func TestNewDatabaseError(t *testing.T) {
	wrappedErr := errors.New("connection failed")
	err := NewDatabaseError("failed to connect", wrappedErr)

	assert.Equal(t, "DATABASE_ERROR", err.Code)
	assert.Equal(t, "failed to connect", err.Message)
	assert.Equal(t, wrappedErr, err.Err)
}

func TestNewDatabaseError_Nil(t *testing.T) {
	err := NewDatabaseError("failed to connect", nil)

	assert.Equal(t, "DATABASE_ERROR", err.Code)
	assert.Equal(t, "failed to connect", err.Message)
	assert.Nil(t, err.Err)
}

func TestNewAPIError(t *testing.T) {
	wrappedErr := errors.New("timeout")
	err := NewAPIError("request timeout", wrappedErr)

	assert.Equal(t, "API_ERROR", err.Code)
	assert.Equal(t, "request timeout", err.Message)
	assert.Equal(t, wrappedErr, err.Err)
}

func TestNewAPIError_Nil(t *testing.T) {
	err := NewAPIError("request timeout", nil)

	assert.Equal(t, "API_ERROR", err.Code)
	assert.Equal(t, "request timeout", err.Message)
	assert.Nil(t, err.Err)
}

func TestNewValidationError(t *testing.T) {
	err := NewValidationError("invalid parameter")

	assert.Equal(t, "VALIDATION_ERROR", err.Code)
	assert.Equal(t, "invalid parameter", err.Message)
	assert.Nil(t, err.Err)
}

func TestNewNotFoundError(t *testing.T) {
	err := NewNotFoundError("resource not found")

	assert.Equal(t, "NOT_FOUND", err.Code)
	assert.Equal(t, "resource not found", err.Message)
	assert.Nil(t, err.Err)
}

func TestNewConfigError(t *testing.T) {
	err := NewConfigError("missing required config")

	assert.Equal(t, "CONFIG_ERROR", err.Code)
	assert.Equal(t, "missing required config", err.Message)
	assert.Nil(t, err.Err)
}

func TestNewSchedulerError(t *testing.T) {
	wrappedErr := errors.New("job failed")
	err := NewSchedulerError("scheduler job failed", wrappedErr)

	assert.Equal(t, "SCHEDULER_ERROR", err.Code)
	assert.Equal(t, "scheduler job failed", err.Message)
	assert.Equal(t, wrappedErr, err.Err)
}

func TestNewSchedulerError_Nil(t *testing.T) {
	err := NewSchedulerError("scheduler job failed", nil)

	assert.Equal(t, "SCHEDULER_ERROR", err.Code)
	assert.Equal(t, "scheduler job failed", err.Message)
	assert.Nil(t, err.Err)
}

func TestNewTradingError(t *testing.T) {
	wrappedErr := errors.New("order rejected")
	err := NewTradingError("order execution failed", wrappedErr)

	assert.Equal(t, "TRADING_ERROR", err.Code)
	assert.Equal(t, "order execution failed", err.Message)
	assert.Equal(t, wrappedErr, err.Err)
}

func TestNewTradingError_Nil(t *testing.T) {
	err := NewTradingError("order execution failed", nil)

	assert.Equal(t, "TRADING_ERROR", err.Code)
	assert.Equal(t, "order execution failed", err.Message)
	assert.Nil(t, err.Err)
}

func TestErrorTypes(t *testing.T) {
	// Test that all error types are AppError
	testCases := []struct {
		name string
		err  *AppError
	}{
		{
			name: "database error",
			err:  NewDatabaseError("test", nil),
		},
		{
			name: "API error",
			err:  NewAPIError("test", nil),
		},
		{
			name: "validation error",
			err:  NewValidationError("test"),
		},
		{
			name: "not found error",
			err:  NewNotFoundError("test"),
		},
		{
			name: "config error",
			err:  NewConfigError("test"),
		},
		{
			name: "scheduler error",
			err:  NewSchedulerError("test", nil),
		},
		{
			name: "trading error",
			err:  NewTradingError("test", nil),
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			assert.NotNil(t, tc.err)
			assert.NotEmpty(t, tc.err.Code)
			assert.NotEmpty(t, tc.err.Message)
		})
	}
}
