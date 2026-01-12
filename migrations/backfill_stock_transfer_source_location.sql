-- Backfill source_location_id for existing stock_transfer_items that have NULL values
-- This is needed because older records were created before source_location_id was tracked per item

-- For stock transfers, each voucher typically has a single source location
-- We can infer this from the inventory transactions that were created when the transfer was made
-- The source location is where stock was DECREASED (negative delta)

-- First, let's update items where we can find the source from related inventory transactions
UPDATE stock_transfer_items sti
SET source_location_id = (
    SELECT DISTINCT it.location_id 
    FROM inventory_transactions it
    WHERE it.voucher_id = stv.voucher_id
    AND it.stock_item_id = sti.stock_item_id
    AND it.delta < 0  -- Source location has negative delta (stock decreased)
    LIMIT 1
)
FROM stock_transfer_vouchers stv
WHERE sti.transfer_id = stv.id
AND sti.source_location_id IS NULL;

-- Verify the update
SELECT 
    COUNT(*) as total_items,
    COUNT(source_location_id) as items_with_source,
    COUNT(*) - COUNT(source_location_id) as items_still_null
FROM stock_transfer_items;
