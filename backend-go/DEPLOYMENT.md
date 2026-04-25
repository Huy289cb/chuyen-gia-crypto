# Deployment Guide - Crypto Analyzer Backend (Go)

This guide covers the deployment process for the Go-based Crypto Analyzer backend, including production setup, monitoring, and rollback procedures.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Build Process](#build-process)
3. [Deployment Configuration](#deployment-configuration)
4. [Monitoring Setup](#monitoring-setup)
5. [Production Deployment](#production-deployment)
6. [Rollback Plan](#rollback-plan)
7. [Post-Deployment Verification](#post-deployment-verification)

## Prerequisites

### System Requirements
- Go 1.26+
- Docker Desktop (for containerized deployment)
- PostgreSQL 18+
- 1GB RAM minimum (production: 2GB+ recommended)
- 10GB disk space minimum

### Required Tools
- Docker & Docker Compose
- PM2 (for Node.js fallback)
- Git
- curl (for health checks)

## Build Process

### Local Build

```bash
# Build the application
make build

# Or manually
go build -o tmp/main ./cmd/server/main.go
```

### Docker Build

```bash
# Build Docker image
docker build -t crypto-analyzer-backend:latest .

# Build with specific tag
docker build -t crypto-analyzer-backend:v1.0.0 .

# Build for production
docker build --target builder -t crypto-analyzer-backend:prod .
```

### Multi-Stage Build

The Dockerfile uses a multi-stage build process:

1. **Builder Stage**: Compiles the Go binary with all build dependencies
2. **Runtime Stage**: Creates a minimal Alpine image with only the binary and runtime dependencies

This results in a smaller final image (~50MB vs ~500MB with full toolchain).

### Health Check Configuration

The Docker container includes a health check that runs every 30 seconds:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1
```

## Deployment Configuration

### Environment Variables

Create a `.env` file in the backend-go directory:

```bash
# Database Configuration
DB_HOST=pgbouncer
DB_PORT=6432
DB_USER=crypto_user
DB_PASSWORD=your_secure_password
DB_NAME=crypto_analyzer
DB_SSLMODE=disable

# Server Configuration
SERVER_PORT=3000
SERVER_HOST=0.0.0.0
GIN_MODE=release

# Groq API
GROQ_API_KEY=your_groq_api_key
GROQ_API_KEY_1=your_first_groq_api_key
GROQ_API_KEY_2=your_second_groq_api_key

# Binance API
BINANCE_API_KEY=your_binance_api_key
BINANCE_API_SECRET=your_binance_api_secret
BINANCE_ENABLED=false

# Analysis Configuration
ICT_CONFIDENCE_THRESHOLD=0.70
KIM_NGHIA_CONFIDENCE_THRESHOLD=0.75
AUTO_ENTRY_CONFIDENCE_THRESHOLD=0.80

# Trading Configuration
RISK_PERCENT=0.01
MIN_RR_RATIO=2.0
MIN_SL_DISTANCE=0.0075
COOLDOWN_HOURS=4

# Scheduler Configuration
ENABLE_KIM_NGHIA_SCHEDULER=true
ENABLE_ICT_SCHEDULER=false
ENABLE_PRICE_UPDATE_SCHEDULER=true

# BTC-only mode
ENABLED_SYMBOLS=BTC
```

### Docker Compose Production

The production setup includes:

- **PostgreSQL**: Primary database with pgBouncer connection pooling
- **pgBouncer**: Connection pooler for PostgreSQL (max 100 clients, 25 pool size)
- **Prometheus**: Metrics collection and storage
- **Grafana**: Visualization dashboard
- **Loki**: Log aggregation
- **Promtail**: Log collection agent
- **Application**: Go backend

#### Starting Production Stack

```bash
# Start all services
docker-compose -f docker-compose.prod.yml up -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Stop all services
docker-compose -f docker-compose.prod.yml down

# Stop with volume removal (CAUTION: deletes data)
docker-compose -f docker-compose.prod.yml down -v
```

#### Service Ports

| Service | Port | Access |
|---------|------|--------|
| Application | 3000 | HTTP API |
| PostgreSQL | 5432 | Direct DB access |
| pgBouncer | 6432 | Connection pool |
| Prometheus | 9090 | Metrics UI |
| Grafana | 3001 | Dashboard UI |
| Loki | 3100 | Log API |

## Monitoring Setup

### Prometheus Metrics

The application exposes Prometheus metrics at `/metrics` endpoint:

- HTTP request metrics (count, duration, status)
- Database metrics (connections, query duration, errors)
- Analysis metrics (runs, duration, confidence scores)
- Trading metrics (positions, trades, PnL)
- Scheduler metrics (runs, errors, duration)
- External API metrics (Groq, Binance)
- System metrics (goroutines, memory)

### Grafana Dashboard

Access Grafana at `http://localhost:3001`

**Default credentials** (change in production):
- Username: `admin`
- Password: `admin`

The dashboard includes panels for:
- HTTP request rate and duration
- Database connection pool status
- Analysis execution metrics
- Trading performance
- System resource usage
- External API call metrics

### Log Aggregation

Logs are collected by Loki and can be viewed in Grafana:

1. Open Grafana
2. Navigate to Explore
3. Select Loki datasource
4. Query logs using LogQL

Example queries:
```
{container="crypto-analyzer-app-prod"}
{container="crypto-analyzer-app-prod"} |= "error"
```

### Alerting

Configure alerting in Prometheus by creating alert rules in `monitoring/alerts/`:

```yaml
groups:
  - name: crypto-analyzer
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.1
        for: 5m
        annotations:
          summary: "High error rate detected"
```

## Production Deployment

### Pre-Deployment Checklist

- [ ] All environment variables configured
- [ ] Database migrations applied
- [ ] SSL certificates configured (if using HTTPS)
- [ ] Firewall rules configured
- [ ] Backup strategy in place
- [ ] Monitoring dashboards configured
- [ ] Alert rules configured
- [ ] Rollback procedure tested

### Deployment Steps

#### 1. Build and Push Image

```bash
# Build image
docker build -t crypto-analyzer-backend:v1.0.0 .

# Tag for registry
docker tag crypto-analyzer-backend:v1.0.0 your-registry/crypto-analyzer-backend:v1.0.0

# Push to registry
docker push your-registry/crypto-analyzer-backend:v1.0.0
```

#### 2. Deploy to Staging

```bash
# Update docker-compose.prod.yml with new image tag
# Deploy to staging
docker-compose -f docker-compose.prod.yml up -d

# Verify health
curl http://staging.example.com/health

# Run parity tests
npm run test:parity
```

#### 3. Deploy to Production

```bash
# Take backup of current deployment
./scripts/backup-current-deployment.sh

# Deploy new version
docker-compose -f docker-compose.prod.yml up -d

# Verify health
curl http://localhost:3000/health

# Monitor logs
docker-compose -f docker-compose.prod.yml logs -f app
```

#### 4. Monitor for 24 Hours

- Check Grafana dashboard every hour
- Monitor error rates
- Verify trading operations
- Check database performance
- Review logs for anomalies

### Blue-Green Deployment

For zero-downtime deployment:

```bash
# Start new version (green)
docker-compose -f docker-compose.prod.yml -p green up -d

# Verify green is healthy
curl http://localhost:3001/health

# Switch traffic (using load balancer)
# Update load balancer config to point to green

# Stop old version (blue)
docker-compose -f docker-compose.prod.yml -p blue down
```

## Rollback Plan

### Automatic Rollback Triggers

Consider rollback if:
- Error rate > 5% for 10 minutes
- P99 latency > 1s for 5 minutes
- Database connection failures > 10% for 5 minutes
- Trading system fails to execute orders

### Manual Rollback Procedure

#### Option 1: Rollback to Previous Docker Image

```bash
# Stop current deployment
docker-compose -f docker-compose.prod.yml down

# Start previous version
docker-compose -f docker-compose.prod.yml up -d

# Verify
curl http://localhost:3000/health
```

#### Option 2: Rollback to Node.js Backend

Use the provided rollback scripts:

**Linux/Mac:**
```bash
chmod +x scripts/rollback-to-nodejs.sh
./scripts/rollback-to-nodejs.sh
```

**Windows:**
```powershell
.\scripts\rollback-to-nodejs.ps1
```

The rollback script:
1. Stops Go backend containers
2. Backs up current state
3. Starts Node.js backend with PM2
4. Verifies Node.js backend is running
5. Documents rollback information

### Rollback Verification

After rollback:
1. Check application health: `curl http://localhost:3000/health`
2. Verify API endpoints: `curl http://localhost:3000/api/analysis`
3. Check PM2 status: `pm2 list`
4. Review logs: `pm2 logs crypto-analyzer`
5. Monitor trading operations

## Post-Deployment Verification

### Functional Verification

- [ ] Health check endpoint responds: `curl http://localhost:3000/health`
- [ ] API endpoints accessible: `curl http://localhost:3000/api/analysis`
- [ ] Paper trading works: Check positions in database
- [ ] Testnet integration works (if enabled): Verify testnet orders
- [ ] Multi-method analysis works: Check analysis history
- [ ] AI position management works: Verify AI actions
- [ ] BTC-only mode maintained: Check only BTC symbols

### Performance Verification

- [ ] API response time < 100ms (p95)
- [ ] Memory usage < 512MB
- [ ] CPU usage < 50% under normal load
- [ ] Database queries < 10ms (p95)
- [ ] No goroutine leaks: Check Grafana dashboard

### Monitoring Verification

- [ ] Prometheus collecting metrics: `curl http://localhost:9090`
- [ ] Grafana dashboard accessible: `http://localhost:3001`
- [ ] Loki collecting logs: Check Grafana Explore
- [ ] Alert rules configured: Check Prometheus alerts

### Data Verification

- [ ] Database connections stable: Check pgBouncer stats
- [ ] No data loss: Compare record counts
- [ ] Calculations accurate: Verify PnL calculations
- [ ] Indexes working: Check query performance

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs app

# Check health status
docker inspect crypto-analyzer-app-prod

# Restart container
docker-compose -f docker-compose.prod.yml restart app
```

### Database Connection Issues

```bash
# Check PostgreSQL status
docker-compose -f docker-compose.prod.yml logs postgres

# Check pgBouncer status
docker-compose -f docker-compose.prod.yml logs pgbouncer

# Test connection
docker exec -it crypto-analyzer-app-prod psql -h pgbouncer -U crypto_user -d crypto_analyzer
```

### High Memory Usage

```bash
# Check container stats
docker stats crypto-analyzer-app-prod

# Check goroutine count
curl http://localhost:3000/metrics | grep go_goroutines

# Restart if necessary
docker-compose -f docker-compose.prod.yml restart app
```

### Metrics Not Appearing

```bash
# Check Prometheus targets
curl http://localhost:9090/api/v1/targets

# Check metrics endpoint
curl http://localhost:3000/metrics

# Restart Prometheus
docker-compose -f docker-compose.prod.yml restart prometheus
```

## Maintenance

### Regular Backups

```bash
# Backup PostgreSQL
docker exec crypto-analyzer-postgres-prod pg_dump -U crypto_user crypto_analyzer > backup.sql

# Backup volumes
docker run --rm -v backend-go_postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres-backup.tar.gz /data
```

### Log Rotation

Configure log rotation in Loki:

```yaml
limits_config:
  retention_period: 168h  # 7 days
```

### Database Maintenance

```bash
# Run vacuum
docker exec -it crypto-analyzer-postgres-prod psql -U crypto_user -d crypto_analyzer -c "VACUUM ANALYZE;"

# Reindex
docker exec -it crypto-analyzer-postgres-prod psql -U crypto_user -d crypto_analyzer -c "REINDEX DATABASE crypto_analyzer;"
```

### Security Updates

```bash
# Update base images
docker pull postgres:18-alpine
docker pull alpine:3.20

# Rebuild application
docker build -t crypto-analyzer-backend:latest .

# Redeploy
docker-compose -f docker-compose.prod.yml up -d
```

## Support

For issues or questions:
1. Check logs: `docker-compose -f docker-compose.prod.yml logs`
2. Check metrics: Grafana dashboard at `http://localhost:3001`
3. Review this documentation
4. Check rollback procedures

## References

- [Phase 2 Task Breakdown](../docs/plans/phase2-task-breakdown.md)
- [Go Migration Plan](../docs/plans/phase2-go-migration.md)
- [API Documentation](../docs/api-spec.md)
- [Advanced Risk Management](../docs/advanced-risk-management.md)
