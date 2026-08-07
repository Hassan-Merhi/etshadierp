/** Group A Phase 3 — immutable stock-transfer revision lifecycle. */
export const stockTransferRevisionIntegrity: string[] = [
  // Keep the runtime read path compatible with databases that were deployed
  // before the immutable lifecycle columns were introduced. This block is
  // intentionally first and idempotent so a redeploy repairs partial schemas.
  `DO $revision_schema$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_transfer_revisions' AND column_name = 'status'
      ) THEN
        ALTER TABLE stock_transfer_revisions ADD COLUMN status text;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_transfer_revisions' AND column_name = 'reviewed_at'
      ) THEN
        ALTER TABLE stock_transfer_revisions ADD COLUMN reviewed_at timestamp;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_transfer_revisions' AND column_name = 'reviewed_by'
      ) THEN
        ALTER TABLE stock_transfer_revisions ADD COLUMN reviewed_by varchar;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_transfer_revisions' AND column_name = 'rejection_reason'
      ) THEN
        ALTER TABLE stock_transfer_revisions ADD COLUMN rejection_reason text;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_transfer_revisions' AND column_name = 'superseded_by_revision_id'
      ) THEN
        ALTER TABLE stock_transfer_revisions ADD COLUMN superseded_by_revision_id integer;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_transfer_revisions' AND column_name = 'payload_hash'
      ) THEN
        ALTER TABLE stock_transfer_revisions ADD COLUMN payload_hash varchar(64);
      END IF;
    END $revision_schema$`,
  `UPDATE stock_transfer_revisions
     SET status = CASE WHEN optional = true THEN 'pending' ELSE 'approved' END
     WHERE status IS NULL`,
  `ALTER TABLE stock_transfer_revisions ALTER COLUMN status SET DEFAULT 'pending'`,
  `ALTER TABLE stock_transfer_revisions ALTER COLUMN status SET NOT NULL`,
  `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM migrations_log WHERE key = 'stock-transfer-revision-status-v1') THEN
        WITH ranked AS (
          SELECT
            id,
            first_value(id) OVER (
              PARTITION BY transfer_id, created_by
              ORDER BY revision_number DESC, id DESC
            ) AS newest_id,
            row_number() OVER (
              PARTITION BY transfer_id, created_by
              ORDER BY revision_number DESC, id DESC
            ) AS position
          FROM stock_transfer_revisions
          WHERE status = 'pending' AND created_by IS NOT NULL
        )
        UPDATE stock_transfer_revisions revision
        SET
          status = 'superseded',
          optional = false,
          reviewed_at = COALESCE(revision.reviewed_at, now()),
          superseded_by_revision_id = ranked.newest_id
        FROM ranked
        WHERE revision.id = ranked.id AND ranked.position > 1;

        WITH numbered AS (
          SELECT
            id,
            row_number() OVER (
              PARTITION BY transfer_id
              ORDER BY revision_number ASC, revision_date ASC, id ASC
            ) AS corrected_number
          FROM stock_transfer_revisions
        )
        UPDATE stock_transfer_revisions revision
        SET revision_number = numbered.corrected_number
        FROM numbered
        WHERE revision.id = numbered.id
          AND revision.revision_number IS DISTINCT FROM numbered.corrected_number;

        INSERT INTO migrations_log(key) VALUES ('stock-transfer-revision-status-v1');
      END IF;
    END $$`,
  `DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfer_revisions_status_check'
      ) THEN
        ALTER TABLE stock_transfer_revisions
          ADD CONSTRAINT stock_transfer_revisions_status_check
          CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'superseded'));
      END IF;
    END $$`,
  `DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'stock_transfer_revisions_superseded_fk'
      ) THEN
        ALTER TABLE stock_transfer_revisions
          ADD CONSTRAINT stock_transfer_revisions_superseded_fk
          FOREIGN KEY (superseded_by_revision_id)
          REFERENCES stock_transfer_revisions(id)
          ON DELETE SET NULL;
      END IF;
    END $$`,
  // Resubmitting a pending revision must retire the same user's previous
  // pending row before PostgreSQL checks the partial unique index below. The
  // application already serializes revision creation by locking the transfer,
  // while these triggers also protect direct inserts and older callers. The
  // AFTER trigger links the retired row once the new revision id exists, so
  // the self-reference remains valid under the immediate foreign key.
  `CREATE OR REPLACE FUNCTION stock_transfer_revision_supersede_before_insert()
     RETURNS trigger
     LANGUAGE plpgsql
     AS $$
     BEGIN
       IF NEW.status = 'pending' AND NEW.created_by IS NOT NULL THEN
         UPDATE stock_transfer_revisions
         SET
           status = 'superseded',
           optional = false,
           reviewed_at = transaction_timestamp(),
           reviewed_by = NEW.created_by,
           superseded_by_revision_id = NULL
         WHERE transfer_id = NEW.transfer_id
           AND created_by = NEW.created_by
           AND status = 'pending';
       END IF;
       RETURN NEW;
     END
     $$`,
  `DROP TRIGGER IF EXISTS stock_transfer_revision_supersede_before_insert
     ON stock_transfer_revisions`,
  `CREATE TRIGGER stock_transfer_revision_supersede_before_insert
     BEFORE INSERT ON stock_transfer_revisions
     FOR EACH ROW
     EXECUTE FUNCTION stock_transfer_revision_supersede_before_insert()`,
  `CREATE OR REPLACE FUNCTION stock_transfer_revision_link_superseded_after_insert()
     RETURNS trigger
     LANGUAGE plpgsql
     AS $$
     BEGIN
       IF NEW.status = 'pending' AND NEW.created_by IS NOT NULL THEN
         UPDATE stock_transfer_revisions
         SET superseded_by_revision_id = NEW.id
         WHERE transfer_id = NEW.transfer_id
           AND created_by = NEW.created_by
           AND id <> NEW.id
           AND status = 'superseded'
           AND superseded_by_revision_id IS NULL
           AND reviewed_by = NEW.created_by
           AND reviewed_at = transaction_timestamp();
       END IF;
       RETURN NEW;
     END
     $$`,
  `DROP TRIGGER IF EXISTS stock_transfer_revision_link_superseded_after_insert
     ON stock_transfer_revisions`,
  `CREATE TRIGGER stock_transfer_revision_link_superseded_after_insert
     AFTER INSERT ON stock_transfer_revisions
     FOR EACH ROW
     EXECUTE FUNCTION stock_transfer_revision_link_superseded_after_insert()`,
  `CREATE UNIQUE INDEX IF NOT EXISTS stock_transfer_revisions_transfer_number_unique
     ON stock_transfer_revisions (transfer_id, revision_number)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS stock_transfer_revisions_one_pending_per_user
     ON stock_transfer_revisions (transfer_id, created_by)
     WHERE status = 'pending' AND created_by IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS stock_transfer_revisions_transfer_status_number_idx
     ON stock_transfer_revisions (transfer_id, status, revision_number DESC)`,
  `CREATE INDEX IF NOT EXISTS stock_transfer_revision_items_revision_idx
     ON stock_transfer_revision_items (revision_id)`,
];
