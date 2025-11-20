-- Migration: Add unique constraint to prevent duplicate container sales
-- This prevents race conditions where the same container could be sold twice

CREATE UNIQUE INDEX IF NOT EXISTS container_sales_company_container_unique 
ON container_sales (company_id, container_id);

-- Add comment explaining the constraint
COMMENT ON INDEX container_sales_company_container_unique IS 
'Ensures each container can only be sold once per company, preventing duplicate sales';
