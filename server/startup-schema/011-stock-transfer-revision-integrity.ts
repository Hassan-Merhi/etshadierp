/** Group A Phase 3 — immutable stock-transfer revision lifecycle. */
export const stockTransferRevisionIntegrity: string[] = [
  `ALTER TABLE stock_transfer_revisions ADD COLUMN IF NOT EXISTS status text`,
  `ALTER TABLE stock_transfer_revisions ADD COLUMN IF NOT EXISTS reviewed_at timestamp`,
  `ALTER TABLE stock_transfer_revisions ADD COLUMN IF NOT EXISTS reviewed_by varchar`,
  `ALTER TABLE stock_transfer_revisions ADD COLUMN IF NOT EXISTS rejection_reason text`,
  `ALTER TABLE stock_transfer_revisions ADD COLUMN IF NOT EXISTS superseded_by_revision_id integer`,
  `ALTER TABLE stock_transfer_revisions ADD COLUMN IF NOT EXISTS payload_hash varchar(64)`,
  `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM migrations_log WHERE key = 'stock-transfer-revision-status-v1') THEN
        UPDATE stock_transfer_revisions
        SET status = CASE WHEN optional = true THEN 'pending' ELSE 'approved' END
        WHERE status IS NULL;

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
  `UPDATE stock_transfer_revisions
     SET status = CASE WHEN optional = true THEN 'pending' ELSE 'approved' END
     WHERE status IS NULL`,
  `ALTER TABLE stock_transfer_revisions ALTER COLUMN status SET DEFAULT 'pending'`,
  `ALTER TABLE stock_transfer_revisions ALTER COLUMN status SET NOT NULL`,
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
