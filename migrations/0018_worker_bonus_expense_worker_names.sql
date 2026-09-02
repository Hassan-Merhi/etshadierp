-- Historical worker-bonus accounting repair.
--
-- Older /api/factory/worker-bonuses/:id/pay postings debited city/location
-- accounts such as "Bonus Expense - Barja". Current postings correctly use a
-- worker-specific account beneath "Bonus Expense - Workers", but the old debit
-- entries keep balances on the city accounts until they are retargeted.
--
-- This repair is intentionally limited to canonical WBONUS-{bonusId}-* vouchers
-- joined back to worker_bonuses + factory_workers. It is idempotent: already
-- repaired vouchers are simply pointed at the same worker account again.

DO $worker_bonus_name_repair$
DECLARE
  bonus_row RECORD;
  bonus_group_id INTEGER;
  worker_account_id INTEGER;
  worker_account_name TEXT;
BEGIN
  IF to_regclass('public.worker_bonuses') IS NULL
     OR to_regclass('public.factory_workers') IS NULL
     OR to_regclass('public.vouchers') IS NULL
     OR to_regclass('public.voucher_entries') IS NULL
     OR to_regclass('public.ledger_accounts') IS NULL THEN
    RETURN;
  END IF;

  FOR bonus_row IN
    SELECT DISTINCT
      wb.id AS bonus_id,
      wb.company_id,
      wb.worker_id,
      NULLIF(btrim(fw.full_name), '') AS worker_name,
      v.id AS voucher_id
    FROM worker_bonuses wb
    JOIN factory_workers fw
      ON fw.id = wb.worker_id
     AND fw.company_id = wb.company_id
    JOIN vouchers v
      ON v.company_id = wb.company_id
     AND v.voucher_number LIKE ('WBONUS-' || wb.id || '-%')
    WHERE wb.status = 'paid'
    ORDER BY wb.company_id, wb.id, v.id
  LOOP
    worker_account_name := 'Bonus Expense - ' || COALESCE(bonus_row.worker_name, 'Worker #' || bonus_row.worker_id);

    SELECT id
      INTO bonus_group_id
      FROM ledger_accounts
     WHERE company_id = bonus_row.company_id
       AND name = 'Bonus Expense - Workers'
       AND deleted_at IS NULL
     ORDER BY id
     LIMIT 1;

    IF bonus_group_id IS NULL THEN
      INSERT INTO ledger_accounts
        (company_id, code, name, account_type, sub_type, opening_balance, active)
      VALUES
        (
          bonus_row.company_id,
          'WBON-GROUP-' || bonus_row.company_id,
          'Bonus Expense - Workers',
          'Expense',
          'Group',
          0,
          true
        )
      RETURNING id INTO bonus_group_id;
    ELSE
      UPDATE ledger_accounts
         SET sub_type = 'Group'
       WHERE id = bonus_group_id
         AND sub_type IS DISTINCT FROM 'Group';
    END IF;

    SELECT id
      INTO worker_account_id
      FROM ledger_accounts
     WHERE company_id = bonus_row.company_id
       AND name = worker_account_name
       AND deleted_at IS NULL
     ORDER BY id
     LIMIT 1;

    IF worker_account_id IS NULL THEN
      INSERT INTO ledger_accounts
        (company_id, code, name, account_type, parent_id, opening_balance, active)
      VALUES
        (
          bonus_row.company_id,
          'WBON-WORKER-' || bonus_row.worker_id,
          worker_account_name,
          'Expense',
          bonus_group_id,
          0,
          true
        )
      RETURNING id INTO worker_account_id;
    ELSE
      UPDATE ledger_accounts
         SET parent_id = bonus_group_id,
             account_type = 'Expense'
       WHERE id = worker_account_id
         AND (parent_id IS DISTINCT FROM bonus_group_id OR account_type IS DISTINCT FROM 'Expense');
    END IF;

    -- A WBONUS voucher has one debit expense leg and one credit cash leg.
    -- Retarget only positive debit legs, leaving the cash side untouched.
    UPDATE voucher_entries
       SET ledger_account_id = worker_account_id
     WHERE voucher_id = bonus_row.voucher_id
       AND COALESCE(debit_amount, 0)::numeric > 0;
  END LOOP;

  -- Remove only now-empty accounts whose suffix is an actual worker city.
  -- This keeps worker-named accounts (including zero-balance ones) intact.
  DELETE FROM ledger_accounts la
   WHERE la.deleted_at IS NULL
     AND la.sub_type IS DISTINCT FROM 'Group'
     AND la.name <> 'Bonus Expense - Workers'
     AND EXISTS (
       SELECT 1
         FROM factory_workers fw
        WHERE fw.company_id = la.company_id
          AND NULLIF(btrim(fw.city), '') IS NOT NULL
          AND la.name = 'Bonus Expense - '
                        || upper(substr(btrim(fw.city), 1, 1))
                        || lower(substr(btrim(fw.city), 2))
     )
     AND NOT EXISTS (
       SELECT 1
         FROM voucher_entries ve
        WHERE ve.ledger_account_id = la.id
     );
END
$worker_bonus_name_repair$;
