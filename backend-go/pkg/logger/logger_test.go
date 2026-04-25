package logger

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestInit(t *testing.T) {
	tests := []struct {
		name    string
		level   string
		format  string
		wantErr bool
	}{
		{
			name:    "json format info level",
			level:   "info",
			format:  "json",
			wantErr: false,
		},
		{
			name:    "console format debug level",
			level:   "debug",
			format:  "console",
			wantErr: false,
		},
		{
			name:    "json format error level",
			level:   "error",
			format:  "json",
			wantErr: false,
		},
		{
			name:    "json format warn level",
			level:   "warn",
			format:  "json",
			wantErr: false,
		},
		{
			name:    "invalid level defaults to info",
			level:   "invalid",
			format:  "json",
			wantErr: false,
		},
		{
			name:    "empty level defaults to info",
			level:   "",
			format:  "json",
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := Init(tt.level, tt.format)
			if tt.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, Logger)
			}
			// Clean up
			Sync()
		})
	}
}

func TestSync(t *testing.T) {
	// Initialize logger
	err := Init("info", "json")
	assert.NoError(t, err)

	// Sync should not panic
	Sync()

	// Sync with nil logger should not panic
	Logger = nil
	Sync()
}

func TestInfo(t *testing.T) {
	err := Init("info", "console")
	assert.NoError(t, err)

	// Should not panic
	Info("test message")
	Sync()
}

func TestDebug(t *testing.T) {
	err := Init("debug", "console")
	assert.NoError(t, err)

	// Should not panic
	Debug("test message")
	Sync()
}

func TestWarn(t *testing.T) {
	err := Init("info", "console")
	assert.NoError(t, err)

	// Should not panic
	Warn("test message")
	Sync()
}

func TestError(t *testing.T) {
	err := Init("info", "console")
	assert.NoError(t, err)

	// Should not panic
	Error("test error")
	Sync()
}

func TestFatal(t *testing.T) {
	err := Init("info", "console")
	assert.NoError(t, err)

	// Fatal calls os.Exit(1), so we can't test it directly
	// We'll just verify the function exists
	assert.NotNil(t, Logger)
	Sync()
}
