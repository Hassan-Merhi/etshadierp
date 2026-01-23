-- Add company_type column to companies table
ALTER TABLE companies ADD COLUMN IF NOT EXISTS company_type TEXT NOT NULL DEFAULT 'erp';
