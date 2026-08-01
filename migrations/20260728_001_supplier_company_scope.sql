BEGIN;

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS company_id INTEGER;

DO $$
DECLARE
  configured_parent_id INTEGER;
  fallback_parent_count INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM suppliers
     WHERE company_id IS NULL
  ) THEN
    SELECT CASE
             WHEN value ~ '^[1-9][0-9]*$' THEN value::INTEGER
             ELSE NULL
           END
      INTO configured_parent_id
      FROM system_settings
     WHERE key = 'parentCompanyId'
     LIMIT 1;

    IF configured_parent_id IS NULL THEN
      SELECT COUNT(*)::INTEGER
        INTO fallback_parent_count
        FROM companies
       WHERE active = TRUE
         AND company_type = 'erp'
         AND parent_company_id IS NULL;

      IF fallback_parent_count = 1 THEN
        SELECT id
          INTO configured_parent_id
          FROM companies
         WHERE active = TRUE
           AND company_type = 'erp'
           AND parent_company_id IS NULL
         LIMIT 1;
      ELSE
        RAISE EXCEPTION
          'Cannot backfill suppliers.company_id: configure system_settings.parentCompanyId first (found % eligible ERP parent companies)',
          fallback_parent_count;
      END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM companies WHERE id = configured_parent_id) THEN
      RAISE EXCEPTION
        'Cannot backfill suppliers.company_id: configured parent company % does not exist',
        configured_parent_id;
    END IF;

    UPDATE suppliers
       SET company_id = configured_parent_id
     WHERE company_id IS NULL;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION assign_supplier_company_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  resolved_company_id INTEGER;
  fallback_parent_count INTEGER;
BEGIN
  IF NEW.company_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT CASE
           WHEN value ~ '^[1-9][0-9]*$' THEN value::INTEGER
           ELSE NULL
         END
    INTO resolved_company_id
    FROM system_settings
   WHERE key = 'parentCompanyId'
   LIMIT 1;

  IF resolved_company_id IS NULL THEN
    SELECT COUNT(*)::INTEGER
      INTO fallback_parent_count
      FROM companies
     WHERE active = TRUE
       AND company_type = 'erp'
       AND parent_company_id IS NULL;

    IF fallback_parent_count = 1 THEN
      SELECT id
        INTO resolved_company_id
        FROM companies
       WHERE active = TRUE
         AND company_type = 'erp'
         AND parent_company_id IS NULL
       LIMIT 1;
    ELSE
      RAISE EXCEPTION
        'Supplier company ownership is required; configure system_settings.parentCompanyId';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = resolved_company_id) THEN
    RAISE EXCEPTION 'Configured supplier parent company % does not exist', resolved_company_id;
  END IF;

  NEW.company_id := resolved_company_id;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS suppliers_assign_company_id ON suppliers;
CREATE TRIGGER suppliers_assign_company_id
BEFORE INSERT ON suppliers
FOR EACH ROW
EXECUTE FUNCTION assign_supplier_company_id();

ALTER TABLE suppliers
  ALTER COLUMN company_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'suppliers_company_id_fkey'
       AND conrelid = 'suppliers'::regclass
  ) THEN
    ALTER TABLE suppliers
      ADD CONSTRAINT suppliers_company_id_fkey
      FOREIGN KEY (company_id)
      REFERENCES companies(id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

ALTER TABLE suppliers
  DROP CONSTRAINT IF EXISTS suppliers_code_unique;

CREATE INDEX IF NOT EXISTS suppliers_company_idx
  ON suppliers(company_id);

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_company_code_unique
  ON suppliers(company_id, code);

ALTER TABLE factory_raw_stock
  DROP CONSTRAINT IF EXISTS factory_raw_stock_company_container_unique;

DROP INDEX IF EXISTS factory_raw_stock_company_container_unique;
CREATE UNIQUE INDEX factory_raw_stock_company_container_unique
  ON factory_raw_stock(company_id, container_id)
  WHERE deleted_at IS NULL;

ALTER TABLE factory_mix_batches
  ALTER COLUMN total_weight_kg SET DEFAULT 0,
  ALTER COLUMN total_cost SET DEFAULT 0,
  ALTER COLUMN cost_per_kg TYPE NUMERIC(20, 7)
    USING cost_per_kg::NUMERIC(20, 7);

COMMIT;
