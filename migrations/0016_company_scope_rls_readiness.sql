-- ERP 90/100 Phase 3: staged row-level tenant isolation readiness.
--
-- This migration adds a transaction-local company setting helper and compatible
-- RLS policies to high-risk tables that carry company_id directly.
--
-- Compatibility design:
--   * Existing application connections do not currently SET LOCAL
--     app.current_company_id for every transaction.
--   * Therefore each policy preserves legacy behaviour while the setting is
--     absent, but becomes company-restrictive as soon as a transaction supplies
--     app.current_company_id.
--   * A malformed or non-positive setting raises instead of becoming an absent
--     context, so an invalid tenant assertion fails closed.
--   * Phase 4 central transaction services can adopt SET LOCAL without another
--     policy rewrite, after which enforcement can be tightened further.
--   * FORCE ROW LEVEL SECURITY is deliberately NOT enabled here because the app
--     may connect as the table owner. That cutover belongs to an explicitly
--     rehearsed migration after all write paths carry transaction-local scope.
--   * No UPDATE, DELETE, repair, backfill, or historical data rewrite occurs.
--
-- This versioned migration must not be applied automatically. Use the repository
-- migration approval/recovery process with a reviewed backup and explicit owner
-- approval when deployment is eventually authorized.

CREATE OR REPLACE FUNCTION erp_current_company_id()
RETURNS integer
LANGUAGE plpgsql
STABLE
AS $company_scope$
DECLARE
  raw_company_id text;
  parsed_company_id integer;
BEGIN
  raw_company_id := current_setting('app.current_company_id', true);
  IF raw_company_id IS NULL OR btrim(raw_company_id) = '' THEN
    RETURN NULL;
  END IF;

  -- Deliberately allow PostgreSQL to raise on malformed or overflowing input.
  -- Returning NULL here would make an invalid tenant assertion indistinguishable
  -- from the temporary compatibility case where no assertion was supplied.
  parsed_company_id := raw_company_id::integer;
  IF parsed_company_id <= 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'app.current_company_id must be a positive integer';
  END IF;
  RETURN parsed_company_id;
END
$company_scope$;

CREATE OR REPLACE FUNCTION erp_company_scope_matches(row_company_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
AS $company_scope_match$
  SELECT erp_current_company_id() IS NULL OR row_company_id = erp_current_company_id();
$company_scope_match$;

DO $rls_readiness$
DECLARE
  tenant_table text;
  policy_name text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'vouchers',
    'customers',
    'ledger_accounts',
    'bank_accounts',
    'fixed_assets',
    'stock_groups',
    'stock_items',
    'inventory'
  ]
  LOOP
    IF to_regclass('public.' || tenant_table) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
    policy_name := tenant_table || '_company_scope_policy';

    IF EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = tenant_table
        AND policyname = policy_name
    ) THEN
      EXECUTE format('DROP POLICY %I ON %I', policy_name, tenant_table);
    END IF;

    EXECUTE format(
      'CREATE POLICY %I ON %I USING (erp_company_scope_matches(company_id)) WITH CHECK (erp_company_scope_matches(company_id))',
      policy_name,
      tenant_table
    );
  END LOOP;
END
$rls_readiness$;

-- voucher_entries do not carry company_id. Restrict them through their canonical
-- parent voucher whenever a transaction-local company setting is present.
DO $voucher_entry_rls$
BEGIN
  IF to_regclass('public.voucher_entries') IS NOT NULL THEN
    ALTER TABLE voucher_entries ENABLE ROW LEVEL SECURITY;

    IF EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'voucher_entries'
        AND policyname = 'voucher_entries_company_scope_policy'
    ) THEN
      DROP POLICY voucher_entries_company_scope_policy ON voucher_entries;
    END IF;

    CREATE POLICY voucher_entries_company_scope_policy ON voucher_entries
      USING (
        erp_current_company_id() IS NULL
        OR EXISTS (
          SELECT 1 FROM vouchers
          WHERE vouchers.id = voucher_entries.voucher_id
            AND vouchers.company_id = erp_current_company_id()
        )
      )
      WITH CHECK (
        erp_current_company_id() IS NULL
        OR EXISTS (
          SELECT 1 FROM vouchers
          WHERE vouchers.id = voucher_entries.voucher_id
            AND vouchers.company_id = erp_current_company_id()
        )
      );
  END IF;
END
$voucher_entry_rls$;

-- Example transaction-local adoption for Phase 4 central services:
--   BEGIN;
--   SELECT set_config('app.current_company_id', '42', true);
--   ... tenant-scoped reads/writes ...
--   COMMIT;
--
-- Rollback strategy if this migration needs to be reversed before FORCE RLS:
-- disable RLS on the listed tables, drop the *_company_scope_policy policies,
-- then drop erp_company_scope_matches(integer) and erp_current_company_id().
