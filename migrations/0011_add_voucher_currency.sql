-- Add currency column to vouchers table for dual-currency support (CDF/USD)
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'USD';
