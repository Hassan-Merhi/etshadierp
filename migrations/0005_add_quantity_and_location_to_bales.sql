-- Add quantity and locationId to production_bales
ALTER TABLE "production_bales" ADD COLUMN IF NOT EXISTS "quantity" integer DEFAULT 1 NOT NULL;
ALTER TABLE "production_bales" ADD COLUMN IF NOT EXISTS "location_id" integer;

-- Add index for locationId
CREATE INDEX IF NOT EXISTS "production_bales_location_idx" ON "production_bales" ("location_id");

-- Update existing records to have quantity = 1
UPDATE "production_bales" SET "quantity" = 1 WHERE "quantity" IS NULL;
