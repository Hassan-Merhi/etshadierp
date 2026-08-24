-- ERP 90/100 tenant isolation: row-level company-scope protection.
--
-- This migration adds a transaction-local company setting helper and compatible
-- RLS policies to high-risk tables that carry company_id directly.
--
-- Compatibility design:
--   * Existing application connections do not yet SET LOCAL
--     app.current_company_id for every transaction.
--   * Therefore each policy preserves legacy behaviour while the setting is
--     absent, but becomes company-restrictive as soon as a transaction supplies
--     app.current_company_id.
--   * A malformed or non-positive setting raises instead of becoming an absent
--     context, so an invalid tenant assertion fails closed.
--   * Central transaction services adopt SET LOCAL through
--     assertTransactionCompanyScope; Phase 4 additionally binds that assertion
--     to the canonical authenticated request company.
--   * FORCE ROW LEVEL SECURITY is enabled on the already-protected tables so a
--     table-owner application connection cannot bypass an asserted tenant scope.
--     The compatibility predicate still returns true when no scope is asserted,
--     so legacy unscoped paths retain their existing visibility during rollout.
--   * No UPDATE, DELETE, repair, backfill, or historical data rewrite occurs.
--
-- Startup cutover:
--   * server/companyScopeRlsBridge.mjs applies this reviewed migration at startup,
--     including when the legacy bulk startup migration pass is disabled.
--   * The bridge wraps execution in a transaction, serializes concurrent startup
--     attempts with an advisory lock, verifies the installed functions/policies,
--     and aborts startup if the migration or verification fails.

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
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
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
    ALTER TABLE voucher_entries FORCE ROW LEVEL SECURITY;

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

-- Example transaction-local adoption for central services:
--   BEGIN;
--   SELECT set_config('app.current_company_id', '42', true);
--   ... tenant-scoped reads/writes ...
--   COMMIT;
--
-- Rollback strategy if the RLS policy package needs to be reversed:
-- NO FORCE ROW LEVEL SECURITY and disable RLS on the listed tables, drop the
-- *_company_scope_policy policies, then drop erp_company_scope_matches(integer)
-- and erp_current_company_id().
