# Rollback Script: Switch from Go Backend to Node.js Backend (PowerShell)
# This script stops the Go backend and starts the Node.js backend as a fallback

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Rollback to Node.js Backend" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# Configuration
$PROJECT_ROOT = "d:\Project\chuyen-gia-crypto"
$NODEJS_BACKEND = "$PROJECT_ROOT\backend"
$GO_BACKEND = "$PROJECT_ROOT\backend-go"

# Function to print colored output
function Print-Success {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
}

function Print-Error {
    param([string]$Message)
    Write-Host "✗ $Message" -ForegroundColor Red
}

function Print-Warning {
    param([string]$Message)
    Write-Host "⚠ $Message" -ForegroundColor Yellow
}

# Step 1: Check if Node.js backend exists
Write-Host ""
Write-Host "Step 1: Checking Node.js backend..." -ForegroundColor Cyan
if (-not (Test-Path $NODEJS_BACKEND)) {
    Print-Error "Node.js backend directory not found at $NODEJS_BACKEND"
    exit 1
}
Print-Success "Node.js backend directory found"

# Step 2: Stop Go backend containers
Write-Host ""
Write-Host "Step 2: Stopping Go backend containers..." -ForegroundColor Cyan
Set-Location $GO_BACKEND
$containersRunning = docker-compose -f docker-compose.prod.yml ps --filter "status=running" --quiet
if ($containersRunning) {
    docker-compose -f docker-compose.prod.yml down
    Print-Success "Go backend containers stopped"
} else {
    Print-Warning "Go backend containers not running"
}

# Step 3: Backup current state
Write-Host ""
Write-Host "Step 3: Backing up current state..." -ForegroundColor Cyan
$backupDir = "$PROJECT_ROOT\rollback-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Print-Success "Backup directory created: $backupDir"

# Copy Go backend environment
if (Test-Path "$GO_BACKEND\.env") {
    Copy-Item "$GO_BACKEND\.env" "$backupDir\go.env"
    Print-Success "Go backend .env backed up"
}

# Step 4: Check PostgreSQL data
Write-Host ""
Write-Host "Step 4: Checking PostgreSQL data backup..." -ForegroundColor Cyan
$postgresVolume = docker volume ls --filter "name=backend-go_postgres_data" --quiet
if ($postgresVolume) {
    Print-Warning "PostgreSQL volume exists - consider manual backup"
    Write-Host "Run: docker run --rm -v backend-go_postgres_data:/data -v ${PWD}:/backup alpine tar czf /backup/postgres-backup.tar.gz /data"
}

# Step 5: Start Node.js backend
Write-Host ""
Write-Host "Step 5: Starting Node.js backend..." -ForegroundColor Cyan
Set-Location $NODEJS_BACKEND

# Check if PM2 is installed
try {
    $pm2Version = pm2 --version
} catch {
    Print-Error "PM2 is not installed. Please install it first: npm install -g pm2"
    exit 1
}

# Start Node.js backend with PM2
$pm2List = pm2 list
if ($pm2List -match "crypto-analyzer") {
    pm2 restart crypto-analyzer
    Print-Success "Node.js backend restarted with PM2"
} else {
    pm2 start src/index.js --name crypto-analyzer
    Print-Success "Node.js backend started with PM2"
}

# Step 6: Verify Node.js backend is running
Write-Host ""
Write-Host "Step 6: Verifying Node.js backend..." -ForegroundColor Cyan
Start-Sleep -Seconds 5
$pm2Status = pm2 list
if ($pm2Status -match "crypto-analyzer" -and $pm2Status -match "online") {
    Print-Success "Node.js backend is running"
    pm2 logs crypto-analyzer --lines 20 --nostream
} else {
    Print-Error "Node.js backend failed to start"
    exit 1
}

# Step 7: Test API endpoint
Write-Host ""
Write-Host "Step 7: Testing API endpoint..." -ForegroundColor Cyan
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000/api/analysis" -UseBasicParsing -TimeoutSec 10
    Print-Success "API endpoint is responding"
} catch {
    Print-Warning "API endpoint not responding - check logs"
}

# Step 8: Document rollback
Write-Host ""
Write-Host "Step 8: Documenting rollback..." -ForegroundColor Cyan
$rollbackInfo = @"
Rollback Information
====================
Date: $(Get-Date)
Rollback From: Go Backend
Rollback To: Node.js Backend
Backup Location: $backupDir

To rollback back to Go:
1. Stop Node.js: pm2 stop crypto-analyzer
2. Start Go: cd $GO_BACKEND; docker-compose -f docker-compose.prod.yml up -d
3. Verify: curl http://localhost:3000/health
"@
$rollbackInfo | Out-File -FilePath "$backupDir\rollback-info.txt" -Encoding UTF8
Print-Success "Rollback information documented"

# Final summary
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Rollback Summary" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Print-Success "Rollback completed successfully"
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Monitor Node.js backend: pm2 logs crypto-analyzer"
Write-Host "2. Check application functionality"
Write-Host "3. Review logs for any issues"
Write-Host "4. Backup location: $backupDir"
Write-Host ""
Write-Host "To revert to Go backend:"
Write-Host "  1. pm2 stop crypto-analyzer"
Write-Host "  2. cd $GO_BACKEND; docker-compose -f docker-compose.prod.yml up -d"
Write-Host "=========================================="
