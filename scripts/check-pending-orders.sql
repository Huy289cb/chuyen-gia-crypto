-- Query để kiểm tra pending orders với created_at
-- Chạy trên VPS: sqlite3 backend/data/predictions.db < scripts/check-pending-orders.sql

-- Kiểm tra tất cả pending orders với method_id = kim_nghia
SELECT 
    id,
    order_id,
    symbol,
    side,
    entry_price,
    status,
    created_at,
    executed_at,
    method_id,
    datetime(created_at, 'localtime') as created_at_local,
    datetime(executed_at, 'localtime') as executed_at_local
FROM pending_orders 
WHERE method_id = 'kim_nghia'
ORDER BY created_at DESC
LIMIT 20;

-- Kiểm tra pending orders được tạo vào ngày cụ thể (thay đổi ngày)
SELECT 
    id,
    order_id,
    symbol,
    side,
    entry_price,
    status,
    created_at,
    method_id,
    datetime(created_at, 'localtime') as created_at_local,
    strftime('%H:%M', datetime(created_at, 'localtime')) as hour_minute
FROM pending_orders 
WHERE method_id = 'kim_nghia'
    AND date(created_at, 'localtime') = date('now', 'localtime')
ORDER BY created_at DESC;

-- Kiểm tra phân phối created_at theo giờ cho Kim Nghia
SELECT 
    strftime('%H', datetime(created_at, 'localtime')) as hour,
    COUNT(*) as count
FROM pending_orders 
WHERE method_id = 'kim_nghia'
GROUP BY hour
ORDER BY hour;
