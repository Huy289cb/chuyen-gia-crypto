# Crypto Analyzer Backend (Go)

## Overview

This is the Go migration of the Crypto Analyzer backend, replacing the Node.js implementation with a more performant and resource-efficient Go-based system.

## Tech Stack

- **Language**: Go 1.21+
- **ORM**: Ent (Facebook's entity framework for Go)
- **Database**: PostgreSQL 18+
- **Web Framework**: Gin
- **Scheduler**: robfig/cron
- **Configuration**: Viper
- **Logging**: Zap
- **Testing**: Testify

## Project Structure

```
backend-go/
├── cmd/
│   └── server/          # Application entry point
├── internal/
│   ├── analyzers/       # Analysis logic (ICT, Kim Nghia)
│   ├── config/          # Configuration management
│   ├── db/              # Database layer (Ent schemas)
│   ├── handlers/        # HTTP handlers
│   ├── middleware/      # HTTP middleware
│   ├── models/          # Domain models
│   ├── schedulers/      # Scheduled tasks
│   └── services/        # Business logic
├── pkg/
│   ├── errors/          # Error handling
│   ├── logger/          # Logging utilities
│   └── utils/           # Common utilities
├── scripts/
│   └── init.sql         # Database initialization
├── test/                # Integration tests
├── .air.toml            # Air hot reload config
├── .env.example         # Environment variables template
├── docker-compose.yml   # PostgreSQL development setup
├── go.mod               # Go module definition
├── go.sum               # Go dependencies
└── Makefile             # Common commands
```

## Prerequisites

- Go 1.21+
- PostgreSQL 15+
- Docker Desktop (for local development)
- Air (for hot reload): `go install github.com/air-verse/air@latest`

## Setup

### 1. Install Dependencies

```bash
make deps
```

### 2. Configure Environment

Copy `.env.example` to `.env` and configure your environment variables:

```bash
cp .env.example .env
```

### 3. Start PostgreSQL

```bash
make docker-up
```

### 4. Initialize Ent Schema

```bash
make ent-init
make ent-generate
```

### 5. Run Migrations

```bash
make migrate-diff
make migrate-apply
```

## Development

### Run with Hot Reload

```bash
make dev
```

### Build

```bash
make build
```

### Run Tests

```bash
make test
```

### Run Tests with Coverage

```bash
make test-coverage
```

## Available Commands

- `make help` - Display all available commands
- `make build` - Build the application
- `make run` - Run the application
- `make dev` - Run with hot reload
- `make test` - Run tests
- `make test-coverage` - Run tests with coverage
- `make clean` - Clean build artifacts
- `make deps` - Download dependencies
- `make ent-generate` - Generate Ent schema code
- `make ent-init` - Initialize Ent schema
- `make migrate-diff` - Create migration diff
- `make migrate-apply` - Apply migrations
- `make docker-up` - Start Docker containers
- `make docker-down` - Stop Docker containers
- `make docker-logs` - View Docker logs
- `make lint` - Run linter
- `make fmt` - Format code
- `make vet` - Run go vet

## Configuration

See `.env.example` for all available configuration options:

- **Server**: Port, host, Gin mode
- **Database**: PostgreSQL connection settings
- **Groq**: API keys for AI analysis
- **Binance**: API keys for trading
- **Analysis**: Confidence thresholds for different methods
- **Trading**: Risk management parameters
- **Scheduler**: Enable/disable schedulers
- **Timezone**: UTC storage, Vietnam time display
- **Paper Trading**: Virtual trading configuration
- **Testnet**: Binance testnet configuration
- **Cache**: Caching settings
- **Rate Limiting**: API rate limiting
- **Logging**: Log level and format

## Multi-Method Analysis

The system supports two analysis methods:

### ICT (Inner Circle Trader)
- Confidence threshold: 70%
- Multi-timeframe alignment required (4h, 1d)
- Risk: 1% per trade
- Min RR ratio: 2.0
- Trading sessions: London/NY killzone

### Kim Nghia
- Confidence threshold: 75%
- No multi-timeframe alignment required
- Risk: 10% per trade
- Min RR ratio: 2.5
- Scoring system: HTF (30%), Liquidity (30%), Confluence (20%), Volume (20%)

## Paper Trading

The system includes a paper trading engine for testing strategies without real money:

- Virtual accounts (100U starting balance)
- Separate accounts for each method
- Real-time PnL tracking
- SL/TP monitoring
- Cooldown system after consecutive losses
- Performance metrics (win rate, profit factor, equity curve)

## AI Position Management

AI-powered position management with the following capabilities:

- Position actions: hold, close_early, close_partial, move_sl, reverse
- Order actions: hold, cancel, modify
- Context: 60 recent candles, positions, orders
- Confidence thresholds: ICT (70%), Kim Nghia (75%)
- BTC-only mode (ETH paused during migration)

## Database Schema

The system uses Ent ORM with PostgreSQL. Schema files are in `internal/db/ent/schema/`.

Tables:
- analysis_history
- predictions
- key_levels
- ohlcv_candles
- latest_prices
- price_history
- accounts
- positions
- pending_orders
- account_snapshots
- trade_events
- testnet_accounts
- testnet_positions
- testnet_pending_orders
- testnet_account_snapshots
- testnet_trade_events

## API Endpoints

### Analysis
- `GET /api/analysis` - Get recent analysis
- `POST /api/analysis/trigger` - Trigger manual analysis

### Paper Trading
- `GET /api/positions` - Get positions
- `POST /api/positions` - Create position
- `GET /api/positions/:id` - Get position details
- `GET /api/accounts` - Get accounts
- `POST /api/accounts/reset` - Reset account
- `GET /api/performance/metrics` - Get performance metrics
- `GET /api/performance/equity-curve` - Get equity curve
- `GET /api/performance/trades` - Get trade history

### Testnet
- `GET /api/testnet/positions` - Get testnet positions
- `POST /api/testnet/positions` - Create testnet position
- `GET /api/testnet/accounts` - Get testnet accounts

## Timezone Handling

- All timestamps stored in UTC in the database
- Frontend converts to Vietnam time (GMT+7) for display
- Use `timeZone: 'Asia/Ho_Chi_Minh'` in JavaScript for conversion

## Error Handling

The system uses a custom error package for consistent error handling:

- Custom error types
- Error wrapping
- Structured error responses
- Fallback mechanisms for external API failures

## Testing

Run all tests:

```bash
make test
```

Run tests with coverage:

```bash
make test-coverage
```

## Deployment

The application is deployed using Docker and PM2. See deployment documentation for details.

## License

MIT
