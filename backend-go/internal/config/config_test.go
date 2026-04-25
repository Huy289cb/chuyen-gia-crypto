package config

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGetEnv(t *testing.T) {
	// Test with default value
	result := getEnv("NON_EXISTENT_VAR", "default")
	assert.Equal(t, "default", result)

	// Test with set value
	os.Setenv("TEST_VAR", "test_value")
	result = getEnv("TEST_VAR", "default")
	assert.Equal(t, "test_value", result)
	os.Unsetenv("TEST_VAR")
}

func TestGetEnvAsInt(t *testing.T) {
	// Test with default value
	result := getEnvAsInt("NON_EXISTENT_VAR", 42)
	assert.Equal(t, 42, result)

	// Test with valid integer
	os.Setenv("TEST_VAR", "100")
	result = getEnvAsInt("TEST_VAR", 42)
	assert.Equal(t, 100, result)
	os.Unsetenv("TEST_VAR")

	// Test with invalid value (should return default)
	os.Setenv("TEST_VAR", "invalid")
	result = getEnvAsInt("TEST_VAR", 42)
	assert.Equal(t, 42, result)
	os.Unsetenv("TEST_VAR")
}

func TestGetEnvAsFloat(t *testing.T) {
	// Test with default value
	result := getEnvAsFloat("NON_EXISTENT_VAR", 3.14)
	assert.Equal(t, 3.14, result)

	// Test with valid float
	os.Setenv("TEST_VAR", "2.5")
	result = getEnvAsFloat("TEST_VAR", 3.14)
	assert.Equal(t, 2.5, result)
	os.Unsetenv("TEST_VAR")

	// Test with invalid value (should return default)
	os.Setenv("TEST_VAR", "invalid")
	result = getEnvAsFloat("TEST_VAR", 3.14)
	assert.Equal(t, 3.14, result)
	os.Unsetenv("TEST_VAR")
}

func TestGetEnvAsBool(t *testing.T) {
	// Test with default value
	result := getEnvAsBool("NON_EXISTENT_VAR", true)
	assert.True(t, result)

	// Test with true values
	testCases := []string{"true", "True", "TRUE", "1", "t", "T"}
	for _, tc := range testCases {
		os.Setenv("TEST_VAR", tc)
		result = getEnvAsBool("TEST_VAR", false)
		assert.True(t, result, "should be true for: %s", tc)
		os.Unsetenv("TEST_VAR")
	}

	// Test with false values
	testCases = []string{"false", "False", "FALSE", "0", "f", "F"}
	for _, tc := range testCases {
		os.Setenv("TEST_VAR", tc)
		result = getEnvAsBool("TEST_VAR", true)
		assert.False(t, result, "should be false for: %s", tc)
		os.Unsetenv("TEST_VAR")
	}

	// Test with invalid value (should return default)
	os.Setenv("TEST_VAR", "invalid")
	result = getEnvAsBool("TEST_VAR", true)
	assert.True(t, result)
	os.Unsetenv("TEST_VAR")
}

func TestLoad(t *testing.T) {
	// This test requires a .env file or environment variables
	// For now, we'll test that Load doesn't panic with no config
	err := Load()
	// Load should succeed with defaults even without .env file
	assert.NoError(t, err)
	assert.NotNil(t, AppConfig)
	assert.NotNil(t, AppConfig.Server)
	assert.NotNil(t, AppConfig.Database)
	assert.NotNil(t, AppConfig.Groq)
	assert.NotNil(t, AppConfig.Binance)
	assert.NotNil(t, AppConfig.Analysis)
	assert.NotNil(t, AppConfig.Trading)
	assert.NotNil(t, AppConfig.Scheduler)
	assert.NotNil(t, AppConfig.Timezone)
	assert.NotNil(t, AppConfig.PaperTrading)
	assert.NotNil(t, AppConfig.Testnet)
	assert.NotNil(t, AppConfig.Cache)
	assert.NotNil(t, AppConfig.RateLimit)
	assert.NotNil(t, AppConfig.Logging)
}

func TestConfig_DefaultValues(t *testing.T) {
	// Reset AppConfig
	AppConfig = nil

	err := Load()
	assert.NoError(t, err)

	// Check default server config
	assert.Equal(t, 3000, AppConfig.Server.Port)
	assert.Equal(t, "0.0.0.0", AppConfig.Server.Host)
	assert.Equal(t, "debug", AppConfig.Server.GinMode)

	// Check default database config
	assert.Equal(t, "localhost", AppConfig.Database.Host)
	assert.Equal(t, 5432, AppConfig.Database.Port)
	assert.Equal(t, "crypto_user", AppConfig.Database.User)
	assert.Equal(t, "crypto_password", AppConfig.Database.Password)
	assert.Equal(t, "crypto_analyzer", AppConfig.Database.DBName)
	assert.Equal(t, "disable", AppConfig.Database.SSLMode)

	// Check default analysis config
	assert.Equal(t, 0.70, AppConfig.Analysis.ICTConfidenceThreshold)
	assert.Equal(t, 0.75, AppConfig.Analysis.KimNghiaConfidenceThreshold)
	assert.Equal(t, 0.80, AppConfig.Analysis.AutoEntryConfidenceThreshold)

	// Check default trading config
	assert.Equal(t, 0.01, AppConfig.Trading.RiskPercent)
	assert.Equal(t, 2.0, AppConfig.Trading.MinRRRatio)
	assert.Equal(t, 0.0075, AppConfig.Trading.MinSLDistance)
	assert.Equal(t, 4, AppConfig.Trading.CooldownHours)

	// Check default scheduler config
	assert.True(t, AppConfig.Scheduler.EnableKimNghiaScheduler)
	assert.False(t, AppConfig.Scheduler.EnableICTScheduler)
	assert.True(t, AppConfig.Scheduler.EnablePriceUpdateScheduler)

	// Check default timezone config
	assert.Equal(t, "UTC", AppConfig.Timezone.Timezone)
	assert.Equal(t, "Asia/Ho_Chi_Minh", AppConfig.Timezone.DisplayTimezone)

	// Check default paper trading config
	assert.True(t, AppConfig.PaperTrading.Enabled)
	assert.Equal(t, 100.0, AppConfig.PaperTrading.StartingBalance)

	// Check default testnet config
	assert.False(t, AppConfig.Testnet.Enabled)
	assert.Equal(t, "https://testnet.binance.vision", AppConfig.Testnet.URL)

	// Check default cache config
	assert.False(t, AppConfig.Cache.Enabled)
	assert.Equal(t, 300, AppConfig.Cache.TTL)

	// Check default rate limit config
	assert.True(t, AppConfig.RateLimit.Enabled)
	assert.Equal(t, 60, AppConfig.RateLimit.RequestsPerMinute)

	// Check default logging config
	assert.Equal(t, "info", AppConfig.Logging.Level)
	assert.Equal(t, "json", AppConfig.Logging.Format)
}
