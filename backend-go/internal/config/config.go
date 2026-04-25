package config

import (
	"fmt"
	"os"
	"strconv"

	"github.com/spf13/viper"
)

type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	Groq     GroqConfig
	Binance  BinanceConfig
	Analysis AnalysisConfig
	Trading  TradingConfig
	Scheduler SchedulerConfig
	Timezone TimezoneConfig
	PaperTrading PaperTradingConfig
	Testnet TestnetConfig
	Cache CacheConfig
	RateLimit RateLimitConfig
	Logging LoggingConfig
}

type ServerConfig struct {
	Port int
	Host string
	GinMode string
}

type DatabaseConfig struct {
	Host     string
	Port     int
	User     string
	Password string
	DBName   string
	SSLMode  string
}

type GroqConfig struct {
	APIKey string
}

type BinanceConfig struct {
	APIKey           string
	APISecret        string
	TestnetAPIKey    string
	TestnetAPISecret string
}

type AnalysisConfig struct {
	ICTConfidenceThreshold         float64
	KimNghiaConfidenceThreshold    float64
	AutoEntryConfidenceThreshold   float64
}

type TradingConfig struct {
	RiskPercent    float64
	MinRRRatio     float64
	MinSLDistance  float64
	CooldownHours  int
}

type SchedulerConfig struct {
	EnableKimNghiaScheduler       bool
	EnableICTScheduler            bool
	EnablePriceUpdateScheduler    bool
}

type TimezoneConfig struct {
	Timezone         string
	DisplayTimezone  string
}

type PaperTradingConfig struct {
	Enabled         bool
	StartingBalance float64
}

type TestnetConfig struct {
	Enabled bool
	URL     string
}

type CacheConfig struct {
	Enabled bool
	TTL     int
}

type RateLimitConfig struct {
	Enabled               bool
	RequestsPerMinute     int
}

type LoggingConfig struct {
	Level  string
	Format string
}

var AppConfig *Config

func Load() error {
	viper.SetConfigName(".env")
	viper.SetConfigType("env")
	viper.AddConfigPath(".")
	viper.AddConfigPath("..")
	viper.AutomaticEnv()

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); ok {
			// Config file not found, use environment variables
		} else {
			return fmt.Errorf("error reading config file: %w", err)
		}
	}

	AppConfig = &Config{
		Server: ServerConfig{
			Port: getEnvAsInt("SERVER_PORT", 3000),
			Host: getEnv("SERVER_HOST", "0.0.0.0"),
			GinMode: getEnv("GIN_MODE", "debug"),
		},
		Database: DatabaseConfig{
			Host:     getEnv("DB_HOST", "localhost"),
			Port:     getEnvAsInt("DB_PORT", 5432),
			User:     getEnv("DB_USER", "crypto_user"),
			Password: getEnv("DB_PASSWORD", "crypto_password"),
			DBName:   getEnv("DB_NAME", "crypto_analyzer"),
			SSLMode:  getEnv("DB_SSLMODE", "disable"),
		},
		Groq: GroqConfig{
			APIKey: getEnv("GROQ_API_KEY", ""),
		},
		Binance: BinanceConfig{
			APIKey:           getEnv("BINANCE_API_KEY", ""),
			APISecret:        getEnv("BINANCE_API_SECRET", ""),
			TestnetAPIKey:    getEnv("BINANCE_TESTNET_API_KEY", ""),
			TestnetAPISecret: getEnv("BINANCE_TESTNET_API_SECRET", ""),
		},
		Analysis: AnalysisConfig{
			ICTConfidenceThreshold:       getEnvAsFloat("ICT_CONFIDENCE_THRESHOLD", 0.70),
			KimNghiaConfidenceThreshold:  getEnvAsFloat("KIM_NGHIA_CONFIDENCE_THRESHOLD", 0.75),
			AutoEntryConfidenceThreshold: getEnvAsFloat("AUTO_ENTRY_CONFIDENCE_THRESHOLD", 0.80),
		},
		Trading: TradingConfig{
			RiskPercent:   getEnvAsFloat("RISK_PERCENT", 0.01),
			MinRRRatio:    getEnvAsFloat("MIN_RR_RATIO", 2.0),
			MinSLDistance: getEnvAsFloat("MIN_SL_DISTANCE", 0.0075),
			CooldownHours: getEnvAsInt("COOLDOWN_HOURS", 4),
		},
		Scheduler: SchedulerConfig{
			EnableKimNghiaScheduler:    getEnvAsBool("ENABLE_KIM_NGHIA_SCHEDULER", true),
			EnableICTScheduler:         getEnvAsBool("ENABLE_ICT_SCHEDULER", false),
			EnablePriceUpdateScheduler: getEnvAsBool("ENABLE_PRICE_UPDATE_SCHEDULER", true),
		},
		Timezone: TimezoneConfig{
			Timezone:        getEnv("TIMEZONE", "UTC"),
			DisplayTimezone: getEnv("DISPLAY_TIMEZONE", "Asia/Ho_Chi_Minh"),
		},
		PaperTrading: PaperTradingConfig{
			Enabled:         getEnvAsBool("PAPER_TRADING_ENABLED", true),
			StartingBalance: getEnvAsFloat("STARTING_BALANCE", 100),
		},
		Testnet: TestnetConfig{
			Enabled: getEnvAsBool("TESTNET_ENABLED", false),
			URL:     getEnv("TESTNET_URL", "https://testnet.binance.vision"),
		},
		Cache: CacheConfig{
			Enabled: getEnvAsBool("CACHE_ENABLED", false),
			TTL:     getEnvAsInt("CACHE_TTL", 300),
		},
		RateLimit: RateLimitConfig{
			Enabled:           getEnvAsBool("RATE_LIMIT_ENABLED", true),
			RequestsPerMinute: getEnvAsInt("RATE_LIMIT_REQUESTS_PER_MINUTE", 60),
		},
		Logging: LoggingConfig{
			Level:  getEnv("LOG_LEVEL", "info"),
			Format: getEnv("LOG_FORMAT", "json"),
		},
	}

	return nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvAsInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intVal, err := strconv.Atoi(value); err == nil {
			return intVal
		}
	}
	return defaultValue
}

func getEnvAsFloat(key string, defaultValue float64) float64 {
	if value := os.Getenv(key); value != "" {
		if floatVal, err := strconv.ParseFloat(value, 64); err == nil {
			return floatVal
		}
	}
	return defaultValue
}

func getEnvAsBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if boolVal, err := strconv.ParseBool(value); err == nil {
			return boolVal
		}
	}
	return defaultValue
}
