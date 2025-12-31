-- Add invoice_footer column to company_settings
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "invoice_footer" text;
