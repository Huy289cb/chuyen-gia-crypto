-- Fix data inconsistency: set executed_at to null for pending orders
-- Chạy trên VPS: sqlite3 backend/data/predictions.db < scripts/fix-pending-order-executed-at.sql

-- Update pending orders with status 'pending' but non-null executed_at
UPDATE pending_orders
SET executed_at = NULL
WHERE status = 'pending' AND executed_at IS NOT NULL;

-- Verify the fix
SELECT 
    id,
    order_id,
    status,
    created_at,
    executed_at
FROM pending_orders
WHERE status = 'pending'
ORDER BY created_at DESC
LIMIT 10;
