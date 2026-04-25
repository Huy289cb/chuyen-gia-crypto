.PHONY: help build run test clean dev migrate-up migrate-down docker-up docker-down docker-build docker-push docker-prod-up docker-prod-down docker-logs-prod

# Variables
APP_NAME=crypto-analyzer
CMD_DIR=./cmd/server
BUILD_DIR=./tmp
MAIN_FILE=$(CMD_DIR)/main.go

# Go parameters
GOCMD=go
GOBUILD=$(GOCMD) build
GOTEST=$(GOCMD) test
GOGET=$(GOCMD) get
GOMOD=$(GOCMD) mod

help: ## Display this help screen
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

build: ## Build the application
	$(GOBUILD) -o $(BUILD_DIR)/main.exe $(MAIN_FILE)

run: ## Run the application
	$(GOCMD) run $(MAIN_FILE)

dev: ## Run with hot reload using air
	air

test: ## Run tests
	$(GOTEST) -v ./...

test-coverage: ## Run tests with coverage
	$(GOTEST) -v -coverprofile=coverage.out ./...
	$(GOCMD) tool cover -html=coverage.out

test-unit: ## Run unit tests only
	$(GOTEST) -v ./internal/... ./pkg/...

test-integration: ## Run integration tests
	$(GOTEST) -v ./test/...

test-race: ## Run tests with race detector
	$(GOTEST) -race -v ./...

test-bench: ## Run benchmarks
	$(GOTEST) -bench=. -benchmem ./...

test-coverage-report: ## Generate coverage report
	$(GOTEST) -coverprofile=coverage.out -covermode=atomic ./...
	$(GOCMD) tool cover -func=coverage.out
	$(GOCMD) tool cover -html=coverage.out -o coverage.html

clean: ## Clean build artifacts
	rm -rf $(BUILD_DIR)
	rm -f coverage.out

deps: ## Download dependencies
	$(GOMOD) download
	$(GOMOD) tidy

ent-generate: ## Generate Ent schema code
	$(GOCMD) run entgo.io/ent/cmd/ent generate ./internal/db/ent/schema

ent-init: ## Initialize Ent schema
	$(GOCMD) run entgo.io/ent/cmd/ent init --target internal/db/ent AnalysisHistory Prediction KeyLevels OHLCVCandle LatestPrice PriceHistory Account Position PendingOrder AccountSnapshot TradeEvent TestnetAccount TestnetPosition TestnetPendingOrder TestnetAccountSnapshot TestnetTradeEvent

migrate-diff: ## Create migration diff with Atlas
	atlas migrate diff --env local

migrate-apply: ## Apply migrations
	atlas migrate apply --env local

migrate-validate: ## Validate migrations
	atlas migrate validate --env local

docker-up: ## Start Docker containers
	docker-compose up -d

docker-down: ## Stop Docker containers
	docker-compose down

docker-logs: ## View Docker logs
	docker-compose logs -f

docker-restart: ## Restart Docker containers
	docker-compose restart

# Production Docker commands
docker-build: ## Build Docker image for production
	docker build -t crypto-analyzer-backend:latest .

docker-build-tag: ## Build Docker image with tag
	@read -p "Enter tag (e.g., v1.0.0): " tag; \
	docker build -t crypto-analyzer-backend:$${tag} .

docker-push: ## Push Docker image to registry
	@read -p "Enter registry URL (e.g., your-registry/crypto-analyzer-backend): " registry; \
	read -p "Enter tag (e.g., v1.0.0): " tag; \
	docker tag crypto-analyzer-backend:$${tag} $${registry}:$${tag}; \
	docker push $${registry}:$${tag}

docker-prod-up: ## Start production Docker stack
	docker-compose -f docker-compose.prod.yml up -d

docker-prod-down: ## Stop production Docker stack
	docker-compose -f docker-compose.prod.yml down

docker-prod-restart: ## Restart production Docker stack
	docker-compose -f docker-compose.prod.yml restart

docker-logs-prod: ## View production Docker logs
	docker-compose -f docker-compose.prod.yml logs -f

docker-prod-ps: ## Show production Docker containers status
	docker-compose -f docker-compose.prod.yml ps

docker-backup: ## Backup PostgreSQL data
	@mkdir -p backups
	docker exec crypto-analyzer-postgres-prod pg_dump -U crypto_user crypto_analyzer > backups/postgres-backup-$$(date +%Y%m%d-%H%M%S).sql

docker-restore: ## Restore PostgreSQL data from backup
	@read -p "Enter backup file path: " backup; \
	docker exec -i crypto-analyzer-postgres-prod psql -U crypto_user crypto_analyzer < $${backup}

lint: ## Run linter
	golangci-lint run

fmt: ## Format code
	$(GOCMD) fmt ./...

vet: ## Run go vet
	$(GOCMD) vet ./...
