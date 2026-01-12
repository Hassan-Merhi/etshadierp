-- Add OTW tracking fields to containers table
-- Run this migration on Render database

ALTER TABLE containers ADD COLUMN IF NOT EXISTS shop_name TEXT;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS eta DATE;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS eta_source TEXT DEFAULT 'manual';
ALTER TABLE containers ADD COLUMN IF NOT EXISTS transport_fee DECIMAL(15, 2);
ALTER TABLE containers ADD COLUMN IF NOT EXISTS number_plate VARCHAR(50);
ALTER TABLE containers ADD COLUMN IF NOT EXISTS tracking_location TEXT;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS border_date DATE;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS offload_date DATE;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS agent VARCHAR(100);
ALTER TABLE containers ADD COLUMN IF NOT EXISTS duty_fee DECIMAL(15, 2);
ALTER TABLE containers ADD COLUMN IF NOT EXISTS doc_received BOOLEAN DEFAULT FALSE;
ALTER TABLE containers ADD COLUMN IF NOT EXISTS tracking_description TEXT;
