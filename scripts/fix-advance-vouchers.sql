-- =============================================================================
-- Retroactive fix: Create missing Payment vouchers for factory worker advances
-- =============================================================================
-- This script finds all factory_worker_advances rows where:
--   - voucher_id IS NULL (no voucher was created)
--   - cash_account_id IS NOT NULL (a cash/bank account was selected)
--
-- For each such advance, it:
--   1. Looks up (or creates) a "Factory Worker Advances" ledger account for
--      the company (Asset type).
--   2. Creates a Payment voucher with source_module = 'FACTORY'.
--   3. Creates two voucher entries:
--      - DEBIT the "Factory Worker Advances" ledger account
--      - CREDIT the cash_account_id ledger account
--   4. Updates the advance row with the new voucher_id.
--
-- IDEMPOTENT: Only processes rows where voucher_id IS NULL, so it is safe to
-- run multiple times without creating duplicates.
--
-- USAGE: Review the output, then COMMIT (or ROLLBACK to abort).
-- =============================================================================

BEGIN;

-- Step 1: Ensure a "Factory Worker Advances" ledger account exists for each
-- company that has advances needing backfill.
INSERT INTO ledger_accounts (company_id, code, name, account_type, active, is_hidden, created_at)
SELECT DISTINCT
  a.company_id,
  COALESCE(
    (SELECT CAST(MAX(CAST(la.code AS INTEGER)) + 1 AS TEXT)
     FROM ledger_accounts la
     WHERE la.company_id = a.company_id
       AND la.code ~ '^\d+$'),
    '9999'
  ),
  'Factory Worker Advances',
  'Asset',
  true,
  false,
  NOW()
FROM factory_worker_advances a
WHERE a.voucher_id IS NULL
  AND a.cash_account_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM ledger_accounts la2
    WHERE la2.company_id = a.company_id
      AND la2.name = 'Factory Worker Advances'
  );

-- Step 2: Create Payment vouchers and entries for each advance missing a voucher.
-- We use a CTE to insert vouchers and then entries in one pass per advance.

DO $$
DECLARE
  adv RECORD;
  v_id INTEGER;
  adv_acct_id INTEGER;
BEGIN
  FOR adv IN
    SELECT
      fwa.id AS advance_id,
      fwa.company_id,
      fwa.advance_date,
      fwa.amount,
      fwa.cash_account_id,
      fw.full_name AS worker_name
    FROM factory_worker_advances fwa
    JOIN factory_workers fw ON fw.id = fwa.worker_id
    JOIN ledger_accounts ca ON ca.id = fwa.cash_account_id AND ca.company_id = fwa.company_id
    WHERE fwa.voucher_id IS NULL
      AND fwa.cash_account_id IS NOT NULL
    ORDER BY fwa.id
  LOOP
    -- Look up the "Factory Worker Advances" ledger account for this company
    SELECT id INTO adv_acct_id
    FROM ledger_accounts
    WHERE company_id = adv.company_id
      AND name = 'Factory Worker Advances'
    LIMIT 1;

    -- Create the Payment voucher
    INSERT INTO vouchers (
      company_id, voucher_number, voucher_type, voucher_date,
      description, total_amount, currency, source_module, created_at
    ) VALUES (
      adv.company_id,
      'PAYMENT-ADV-BACKFILL-' || adv.advance_id || '-' || EXTRACT(EPOCH FROM NOW())::BIGINT,
      'Payment',
      adv.advance_date,
      'Advance to ' || adv.worker_name || ': $' || adv.amount,
      adv.amount,
      'USD',
      'FACTORY',
      NOW()
    ) RETURNING id INTO v_id;

    -- DEBIT "Factory Worker Advances" (asset increases)
    INSERT INTO voucher_entries (
      voucher_id, ledger_account_id, debit_amount, credit_amount, narration, created_at
    ) VALUES (
      v_id,
      adv_acct_id,
      adv.amount,
      0,
      'Advance to ' || adv.worker_name || ': $' || adv.amount,
      NOW()
    );

    -- CREDIT the cash/bank account (cash decreases)
    INSERT INTO voucher_entries (
      voucher_id, ledger_account_id, debit_amount, credit_amount, narration, created_at
    ) VALUES (
      v_id,
      adv.cash_account_id,
      0,
      adv.amount,
      'Advance to ' || adv.worker_name || ': $' || adv.amount,
      NOW()
    );

    -- Link the voucher back to the advance
    UPDATE factory_worker_advances
    SET voucher_id = v_id
    WHERE id = adv.advance_id;

    RAISE NOTICE 'Created voucher % for advance % (worker: %, amount: %)',
      v_id, adv.advance_id, adv.worker_name, adv.amount;
  END LOOP;
END $$;

-- Review the results before committing:
-- SELECT id, company_id, worker_id, amount, cash_account_id, voucher_id
-- FROM factory_worker_advances
-- WHERE cash_account_id IS NOT NULL
-- ORDER BY id;

COMMIT;
