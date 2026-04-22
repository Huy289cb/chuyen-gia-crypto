#!/bin/bash

# Script để kiểm tra PM2 logs cho pending order creation
# Chạy trên VPS: bash scripts/check-pm2-logs.sh

echo "=== Checking PM2 logs for pending order creation ==="
echo ""

# Kiểm tra logs trong 1 giờ qua (thay đổi thời gian nếu cần)
echo "=== PM2 logs in the last hour ==="
pm2 logs --lines 1000 --nostream | grep -E "(KimNghia|pending|order)" | tail -50

echo ""
echo "=== PM2 logs for specific time (8:00 AM today) ==="
# Tìm logs vào 8:00 AM ngày hôm nay
pm2 logs --lines 2000 --nostream | grep "08:00"

echo ""
echo "=== Recent PM2 logs (last 100 lines) ==="
pm2 logs --lines 100 --nostream

echo ""
echo "=== PM2 process status ==="
pm2 status
