/**
 * Repair the stock-item merge audit log.
 *
 * `stock_item_merge_logs.merged_by_user_id` was created as `integer NOT NULL`,
 * but `users.id` is a varchar UUID. Every audit insert therefore failed with
 * `invalid input syntax for type integer`, and the merge handler catches that
 * as non-fatal:
 *
 *     } catch (auditErr) {
 *       // Audit log failure is non-fatal — merge already committed
 *
 * So the merge committed, the log row was never written, and
 * `POST /api/stock-items/merge-logs/:logId/unmerge` — which restores both stock
 * items from that row's `snapshot_before` — had nothing to read. Every merge
 * performed against this schema is unaudited and irreversible, and nothing
 * surfaced it.
 *
 * The conversion is safe on any database: the column is empty everywhere the
 * insert was failing, and where a row somehow exists an integer id casts to its
 * own text form without loss. `USING` makes that explicit rather than relying on
 * Postgres to find an implicit cast, which it will not do for integer -> varchar
 * in an ALTER COLUMN TYPE.
 */
export const stockMergeAuditUserId: string[] = [
  `DO $stock_merge_audit$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stock_item_merge_logs'
          AND column_name = 'merged_by_user_id'
          AND data_type <> 'character varying'
      ) THEN
        ALTER TABLE stock_item_merge_logs
          ALTER COLUMN merged_by_user_id TYPE varchar
          USING merged_by_user_id::varchar;
      END IF;
    END $stock_merge_audit$;`,
];
