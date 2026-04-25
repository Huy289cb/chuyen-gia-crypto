#!/bin/bash

# Rollback Script: Switch from Go Backend to Node.js Backend
# This script stops the Go backend and starts the Node.js backend as a fallback

set -e

echo "=========================================="
echo "Rollback to Node.js Backend"
echo "=========================================="

# Configuration
PROJECT_ROOT="/d/Project/chuyen-gia-crypto"
NODEJS_BACKEND="$PROJECT_ROOT/backend"
GO_BACKEND="$PROJECT_ROOT/backend-go"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

# Step 1: Check if Node.js backend exists
echo ""
echo "Step 1: Checking Node.js backend..."
if [ ! -d "$NODEJS_BACKEND" ]; then
    print_error "Node.js backend directory not found at $NODEJS_BACKEND"
    exit 1
fi
print_success "Node.js backend directory found"

# Step 2: Stop Go backend containers
echo ""
echo "Step 2: Stopping Go backend containers..."
cd "$GO_BACKEND"
if docker-compose -f docker-compose.prod.yml ps | grep -q "Up"; then
    docker-compose -f docker-compose.prod.yml down
    print_success "Go backend containers stopped"
else
    print_warning "Go backend containers not running"
fi

# Step 3: Backup current state
echo ""
echo "Step 3: Backing up current state..."
BACKUP_DIR="$PROJECT_ROOT/rollback-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
print_success "Backup directory created: $BACKUP_DIR"

# Copy Go backend environment
if [ -f "$GO_BACKEND/.env" ]; then
    cp "$GO_BACKEND/.env" "$BACKUP_DIR/go.env"
    print_success "Go backend .env backed up"
fi

# Copy PostgreSQL data if using Docker volumes
echo ""
echo "Step 4: Checking PostgreSQL data backup..."
if docker volume ls | grep -q "backend-go_postgres_data"; then
    print_warning "PostgreSQL volume exists - consider manual backup"
    echo "Run: docker run --rm -v backend-go_postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres-backup.tar.gz /data"
fi

# Step 4: Start Node.js backend
echo ""
echo "Step 5: Starting Node.js backend..."
cd "$NODEJS_BACKEND"

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    print_error "PM2 is not installed. Please install it first: npm install -g pm2"
    exit 1
fi

# Start Node.js backend with PM2
if pm2 list | grep -q "crypto-analyzer"; then
    pm2 restart crypto-analyzer
    print_success "Node.js backend restarted with PM2"
else
    pm2 start src/index.js --name crypto-analyzer
    print_success "Node.js backend started with PM2"
fi

# Step 5: Verify Node.js backend is running
echo ""
echo "Step 6: Verifying Node.js backend..."
sleep 5
if pm2 list | grep crypto-analyzer | grep -q "online"; then
    print_success "Node.js backend is running"
    pm2 logs crypto-analyzer --lines 20 --nostream
else
    print_error "Node.js backend failed to start"
    exit 1
fi

# Step 6: Test API endpoint
echo ""
echo "Step 7: Testing API endpoint..."
if curl -f http://localhost:3000/api/analysis > /dev/null 2>&1; then
    print_success "API endpoint is responding"
else
    print_warning "API endpoint not responding - check logs"
fi

# Step 7: Document rollback
echo ""
echo "Step 8: Documenting rollback..."
cat > "$BACKUP_DIR/rollback-info.txt" <<EOF
Rollback Information
====================
Date: $(date)
Rollback From: Go Backend
Rollback To: Node.js Backend
Backup Location: $BACKUP_DIR

To rollback back to Go:
1. Stop Node.js: pm2 stop crypto-analyzer
2. Start Go: cd $GO_BACKEND && docker-compose -f docker-compose.prod.yml up -d
3. Verify: curl http://localhost:3000/health
EOF
print_success "Rollback information documented"

# Final summary
echo ""
echo "=========================================="
echo "Rollback Summary"
echo "=========================================="
print_success "Rollback completed successfully"
echo ""
echo "Next steps:"
echo "1. Monitor Node.js backend: pm2 logs crypto-analyzer"
echo "2. Check application functionality"
echo "3. Review logs for any issues"
echo "4. Backup location: $BACKUP_DIR"
echo ""
echo "To revert to Go backend:"
echo "  1. pm2 stop crypto-analyzer"
echo "  2. cd $GO_BACKEND && docker-compose -f docker-compose.prod.yml up -d"
echo "=========================================="
