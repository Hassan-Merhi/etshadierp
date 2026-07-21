-- V7 Historical Replay: explicit inventory ownership and adjustment valuation basis.
-- Schema only. This migration never executes a historical replay or changes cost values.

BEGIN;

ALTER TABLE factory_mix_batch_sources
  ADD COLUMN IF NOT EXISTS inventory_supplier_id INTEGER;

ALTER TABLE factory_raw_material_adjustments
  ADD COLUMN IF NOT EXISTS valuation_basis VARCHAR(30);

-- Backfill inventory ownership without changing pricing ownership.
-- BATCH sources intentionally remain NULL because the upstream batch already consumed raw material.
UPDATE factory_mix_batch_sources
SET inventory_supplier_id = supplier_id
WHERE source_batch_id IS NULL
  AND supplier_id IS NOT NULL
  AND inventory_supplier_id IS NULL;

UPDATE factory_mix_batch_sources AS mbs
SET inventory_supplier_id = fc.supplier_id
FROM factory_containers AS fc
WHERE mbs.source_batch_id IS NULL
  AND mbs.supplier_id IS NULL
  AND mbs.container_id = fc.id
  AND fc.supplier_id IS NOT NULL
  AND mbs.inventory_supplier_id IS NULL;

UPDATE factory_mix_batch_sources
SET inventory_supplier_id = NULL
WHERE source_batch_id IS NOT NULL
  AND inventory_supplier_id IS NOT NULL;

-- Cost-free historical ADD rows are unambiguously quantity-only. Positive-cost historical
-- rows remain NULL and must be explicitly classified in the protected replay workflow.
UPDATE factory_raw_material_adjustments
SET valuation_basis = 'QUANTITY_ONLY'
WHERE UPPER(type) = 'ADD'
  AND COALESCE(cost_per_kg, 0) = 0
  AND valuation_basis IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'factory_mix_batch_sources_inventory_supplier_fk'
  ) THEN
    ALTER TABLE factory_mix_batch_sources
      ADD CONSTRAINT factory_mix_batch_sources_inventory_supplier_fk
      FOREIGN KEY (inventory_supplier_id)
      REFERENCES factory_suppliers(id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'factory_raw_material_adjustments_valuation_basis_chk'
  ) THEN
    ALTER TABLE factory_raw_material_adjustments
      ADD CONSTRAINT factory_raw_material_adjustments_valuation_basis_chk
      CHECK (
        valuation_basis IS NULL OR valuation_basis IN (
          'QUANTITY_ONLY', 'VALUED_TRANSFER', 'OPENING_BALANCE'
        )
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS factory_mix_batch_sources_inventory_supplier_idx
  ON factory_mix_batch_sources (inventory_supplier_id, mix_batch_id);

CREATE INDEX IF NOT EXISTS factory_raw_material_adjustments_unclassified_valuation_idx
  ON factory_raw_material_adjustments (company_id, supplier_id, id)
  WHERE deleted_at IS NULL
    AND UPPER(type) = 'ADD'
    AND COALESCE(cost_per_kg, 0) > 0
    AND valuation_basis IS NULL;

-- Resolve and validate ownership for every future source-writing path at the database boundary.
CREATE OR REPLACE FUNCTION factory_resolve_mix_source_inventory_supplier()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  resolved_supplier_id INTEGER;
BEGIN
  IF NEW.source_batch_id IS NOT NULL THEN
    NEW.inventory_supplier_id := NULL;
    RETURN NEW;
  END IF;

  resolved_supplier_id := NEW.inventory_supplier_id;

  IF resolved_supplier_id IS NULL AND NEW.supplier_id IS NOT NULL THEN
    resolved_supplier_id := NEW.supplier_id;
  END IF;

  IF resolved_supplier_id IS NULL AND NEW.container_id IS NOT NULL THEN
    SELECT supplier_id
      INTO resolved_supplier_id
      FROM factory_containers
     WHERE id = NEW.container_id
       AND deleted_at IS NULL;
  END IF;

  IF resolved_supplier_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'INVENTORY_SUPPLIER_UNRESOLVED: non-batch raw-material source has no supplier owner';
  END IF;

  NEW.inventory_supplier_id := resolved_supplier_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS factory_mix_source_inventory_supplier_trg
  ON factory_mix_batch_sources;

CREATE TRIGGER factory_mix_source_inventory_supplier_trg
BEFORE INSERT OR UPDATE OF supplier_id, container_id, source_batch_id, inventory_supplier_id
ON factory_mix_batch_sources
FOR EACH ROW
EXECUTE FUNCTION factory_resolve_mix_source_inventory_supplier();

-- New supplier-linked ADDs are quantity-only in the current write path: the route ignores
-- client cost and uses the existing locked rate. Historical positive-cost rows are not guessed.
CREATE OR REPLACE FUNCTION factory_default_new_adjustment_valuation_basis()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     AND UPPER(NEW.type) = 'ADD'
     AND NEW.supplier_id IS NOT NULL
     AND NEW.valuation_basis IS NULL THEN
    NEW.valuation_basis := 'QUANTITY_ONLY';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS factory_adjustment_valuation_basis_trg
  ON factory_raw_material_adjustments;

CREATE TRIGGER factory_adjustment_valuation_basis_trg
BEFORE INSERT OR UPDATE OF type, supplier_id, valuation_basis
ON factory_raw_material_adjustments
FOR EACH ROW
EXECUTE FUNCTION factory_default_new_adjustment_valuation_basis();

COMMIT;
