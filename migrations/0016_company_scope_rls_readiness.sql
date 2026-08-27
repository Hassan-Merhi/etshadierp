-- Phase 3 tenant isolation: row-level company-scope protection.
--
-- This migration installs the PostgreSQL half of the tenant boundary. The
-- application pool supplies one of two explicit capabilities before data work:
--
--   1. tenant scope: app.current_company_id plus an optional, independently
--      membership-checked app.authorized_company_ids list for intentional
--      intercompany operations; or
--   2. maintenance scope: app.company_scope_maintenance = 'on' for controlled
--      process-owned startup/scheduler work.
--
-- There is deliberately NO compatibility fallback for an absent tenant setting.
-- Missing, malformed, or non-positive tenant identity fails closed. This makes a
-- forgotten application predicate an additional denial rather than an accidental
-- all-company read. FORCE ROW LEVEL SECURITY keeps the same rule in force even
-- when the application connection owns the protected table.
--
-- Startup cutover:
--   * server/companyScopeRlsBridge.mjs applies this reviewed migration at startup,
--     including when the legacy bulk startup migration pass is disabled.
--   * The bridge wraps execution in a transaction, serializes concurrent startup
--     attempts with an advisory lock, verifies the installed functions/policies,
--     and aborts startup if the migration or verification fails.

CREATE OR REPLACE FUNCTION erp_company_scope_maintenance_enabled()
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $company_scope_maintenance$
DECLARE
  raw_maintenance text;
BEGIN
  raw_maintenance := current_setting('app.company_scope_maintenance', true);
  IF raw_maintenance IS NULL OR btrim(raw_maintenance) = '' OR lower(btrim(raw_maintenance)) = 'off' THEN
    RETURN false;
  END IF;
  IF lower(btrim(raw_maintenance)) = 'on' THEN
    RETURN true;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '22023',
    MESSAGE = 'app.company_scope_maintenance must be on or off';
END
$company_scope_maintenance$;

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
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'app.current_company_id is required for tenant data access';
  END IF;

  -- Deliberately allow PostgreSQL to raise on malformed or overflowing input.
  -- Returning NULL would make an invalid tenant assertion indistinguishable
  -- from an omitted tenant identity.
  parsed_company_id := raw_company_id::integer;
  IF parsed_company_id <= 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'app.current_company_id must be a positive integer';
  END IF;
  RETURN parsed_company_id;
END
$company_scope$;

CREATE OR REPLACE FUNCTION erp_authorized_company_ids()
RETURNS integer[]
LANGUAGE plpgsql
STABLE
AS $authorized_company_scope$
DECLARE
  raw_company_ids text;
  parsed_company_ids integer[];
BEGIN
  raw_company_ids := current_setting('app.authorized_company_ids', true);
  IF raw_company_ids IS NULL OR btrim(raw_company_ids) = '' THEN
    RETURN ARRAY[]::integer[];
  END IF;

  BEGIN
    parsed_company_ids := string_to_array(raw_company_ids, ',')::integer[];
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'app.authorized_company_ids must be a comma-separated list of positive integers';
  END;

  IF EXISTS (SELECT 1 FROM unnest(parsed_company_ids) AS company_id WHERE company_id <= 0) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'app.authorized_company_ids must contain only positive integers';
  END IF;

  RETURN parsed_company_ids;
END
$authorized_company_scope$;

CREATE OR REPLACE FUNCTION erp_company_scope_matches(row_company_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $company_scope_match$
DECLARE
  current_company_id integer;
BEGIN
  IF erp_company_scope_maintenance_enabled() THEN
    RETURN true;
  END IF;

  current_company_id := erp_current_company_id();
  RETURN row_company_id = current_company_id OR row_company_id = ANY(erp_authorized_company_ids());
END
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
-- parent voucher under the same tenant/authorized-secondary/maintenance rules.
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
        erp_company_scope_maintenance_enabled()
        OR EXISTS (
          SELECT 1 FROM vouchers
          WHERE vouchers.id = voucher_entries.voucher_id
            AND erp_company_scope_matches(vouchers.company_id)
        )
      )
      WITH CHECK (
        erp_company_scope_maintenance_enabled()
        OR EXISTS (
          SELECT 1 FROM vouchers
          WHERE vouchers.id = voucher_entries.voucher_id
            AND erp_company_scope_matches(vouchers.company_id)
        )
      );
  END IF;
END
$voucher_entry_rls$;

-- Tenant request example (the application pool establishes these values before
-- handing a connection to route code):
--   SELECT set_config('app.company_scope_maintenance', 'off', false);
--   SELECT set_config('app.current_company_id', '42', false);
--   SELECT set_config('app.authorized_company_ids', '', false);
--
-- Controlled all-company maintenance example:
--   SELECT set_config('app.company_scope_maintenance', 'on', false);
--
-- Rollback strategy if the RLS package needs to be reversed:
-- NO FORCE ROW LEVEL SECURITY and disable RLS on the listed tables, drop the
-- *_company_scope_policy policies, then drop erp_company_scope_matches(integer),
-- erp_authorized_company_ids(), erp_current_company_id(), and
-- erp_company_scope_maintenance_enabled().
