-- Add optional fields for manual container entry
ALTER TABLE containers
ADD COLUMN item_name TEXT,
ADD COLUMN rate_per_kg DECIMAL(10, 2),
ADD COLUMN total_kg DECIMAL(15, 2);
