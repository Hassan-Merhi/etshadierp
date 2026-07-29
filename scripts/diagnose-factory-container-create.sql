-- Reproduce the production factory-container INSERT without saving any data.
-- The outer transaction is always rolled back. The result row contains the
-- actual PostgreSQL SQLSTATE, constraint, table, column, and detail that
-- Drizzle's outer "Failed query" error currently hides.

BEGIN;

CREATE TEMP TABLE factory_container_create_diagnostic (
  outcome text NOT NULL,
  sqlstate text,
  message text,
  detail text,
  hint text,
  constraint_name text,
  schema_name text,
  table_name text,
  column_name text,
  diagnostic_insert_id integer
) ON COMMIT DROP;

DO $diagnostic$
DECLARE
  inserted_id integer;
  error_state text;
  error_message text;
  error_detail text;
  error_hint text;
  error_constraint text;
  error_schema text;
  error_table text;
  error_column text;
BEGIN
  BEGIN
    INSERT INTO factory_containers (
      company_id,
      container_number,
      supplier_id,
      total_kg,
      rate_per_kg,
      currency_code,
      fx_rate_to_usd,
      fx_rate_to_usd_import,
      fx_rate_source,
      fx_rate_confirmed,
      fx_rate_date_import,
      rate_per_kg_usd,
      status,
      freight,
      freight_currency_code,
      freight_account_id,
      freight_supplier_id,
      freight_paid_by,
      freight_own_account_id,
      other_charges,
      other_charges_account_id,
      commission_amount,
      commission_currency_code,
      commission_account_id,
      commission_supplier_id,
      commission_notes,
      commission_fx_rate_to_usd,
      commission_fx_rate_confirmed,
      commission_fx_rate_date
    ) VALUES (
      12,
      'CMAU9621472',
      30,
      18308,
      0.30,
      'EUR',
      1.18000000,
      1.18000000,
      'auto',
      true,
      DATE '2026-07-29',
      0.354,
      'PENDING',
      2266.67,
      'EUR',
      805,
      30,
      'supplier',
      NULL,
      0,
      NULL,
      0,
      'EUR',
      804,
      27,
      NULL,
      NULL,
      false,
      NULL
    )
    RETURNING id INTO inserted_id;

    INSERT INTO factory_container_create_diagnostic (
      outcome,
      message,
      diagnostic_insert_id
    ) VALUES (
      'INSERT_SUCCEEDED',
      'The base factory_containers INSERT was accepted. The failure is outside this INSERT or the submitted values differ.',
      inserted_id
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      error_state = RETURNED_SQLSTATE,
      error_message = MESSAGE_TEXT,
      error_detail = PG_EXCEPTION_DETAIL,
      error_hint = PG_EXCEPTION_HINT,
      error_constraint = CONSTRAINT_NAME,
      error_schema = SCHEMA_NAME,
      error_table = TABLE_NAME,
      error_column = COLUMN_NAME;

    INSERT INTO factory_container_create_diagnostic (
      outcome,
      sqlstate,
      message,
      detail,
      hint,
      constraint_name,
      schema_name,
      table_name,
      column_name
    ) VALUES (
      'INSERT_REJECTED',
      error_state,
      error_message,
      error_detail,
      error_hint,
      error_constraint,
      error_schema,
      error_table,
      error_column
    );
  END;
END
$diagnostic$;

SELECT
  current_database() AS database_name,
  current_schema() AS active_schema,
  inet_server_addr() AS server_address,
  inet_server_port() AS server_port;

SELECT
  pg_get_serial_sequence('public.factory_containers', 'id') AS sequence_name,
  COALESCE((SELECT MAX(id) FROM factory_containers), 0) AS maximum_container_id;

SELECT id, company_id, name
FROM factory_suppliers
WHERE id IN (27, 30)
ORDER BY id;

SELECT id, company_id, code, name, deleted_at
FROM ledger_accounts
WHERE id IN (804, 805)
ORDER BY id;

SELECT
  conname AS constraint_name,
  contype AS constraint_type,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.factory_containers'::regclass
ORDER BY conname;

SELECT * FROM factory_container_create_diagnostic;

ROLLBACK;
