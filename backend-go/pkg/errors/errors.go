package errors

import (
	"fmt"
)

// Custom error types for better error handling
type AppError struct {
	Code    string
	Message string
	Err     error
}

func (e *AppError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("[%s] %s: %v", e.Code, e.Message, e.Err)
	}
	return fmt.Sprintf("[%s] %s", e.Code, e.Message)
}

func (e *AppError) Unwrap() error {
	return e.Err
}

// Error constructors
func NewAppError(code, message string, err error) *AppError {
	return &AppError{
		Code:    code,
		Message: message,
		Err:     err,
	}
}

func NewDatabaseError(message string, err error) *AppError {
	return &AppError{
		Code:    "DATABASE_ERROR",
		Message: message,
		Err:     err,
	}
}

func NewAPIError(message string, err error) *AppError {
	return &AppError{
		Code:    "API_ERROR",
		Message: message,
		Err:     err,
	}
}

func NewValidationError(message string) *AppError {
	return &AppError{
		Code:    "VALIDATION_ERROR",
		Message: message,
		Err:     nil,
	}
}

func NewNotFoundError(message string) *AppError {
	return &AppError{
		Code:    "NOT_FOUND",
		Message: message,
		Err:     nil,
	}
}

func NewConfigError(message string) *AppError {
	return &AppError{
		Code:    "CONFIG_ERROR",
		Message: message,
		Err:     nil,
	}
}

func NewSchedulerError(message string, err error) *AppError {
	return &AppError{
		Code:    "SCHEDULER_ERROR",
		Message: message,
		Err:     err,
	}
}

func NewTradingError(message string, err error) *AppError {
	return &AppError{
		Code:    "TRADING_ERROR",
		Message: message,
		Err:     err,
	}
}
