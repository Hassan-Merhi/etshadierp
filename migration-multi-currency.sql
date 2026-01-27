-- Multi-Currency Feature Migration Script
-- Run this on your production database (Render)

-- 1. Add currency columns to companies table
ALTER TABLE companies 
ADD COLUMN IF NOT EXISTS base_currency VARCHAR(10) DEFAULT 'USD',
ADD COLUMN IF NOT EXISTS display_currency VARCHAR(10);

-- 2. Create exchange_rates table for storing historical rates
CREATE TABLE IF NOT EXISTS exchange_rates (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL,
    from_currency VARCHAR(10) NOT NULL,
    to_currency VARCHAR(10) NOT NULL,
    rate DECIMAL(20, 6) NOT NULL,
    effective_date DATE NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3. Add exchange_rate column to vouchers table
ALTER TABLE vouchers 
ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(20, 6);

-- 4. Configure Mali company for multi-currency (CFA base, USD display)
-- Replace 'MALI' with your actual Mali company code if different
UPDATE companies 
SET base_currency = 'CFA', 
    display_currency = 'USD' 
WHERE code = 'MALI';

-- 5. Add index on exchange_rates for performance
CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup 
ON exchange_rates (company_id, from_currency, to_currency, effective_date DESC);

-- Verify the changes
SELECT code, name, base_currency, display_currency FROM companies;
