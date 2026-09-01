/**
 * Startup data repairs for legacy rows that predate the foreign-key rollout.
 *
 * These statements run after the source tables exist and before 006 adds the
 * strict foreign keys. Every affected row is copied into an archive table
 * first, with the original primary key retained, so the repair is reversible
 * and auditable. The predicates only select rows whose referenced parent is
 * genuinely missing.
 */

const archiveColumns = (table: string) => [
  `CREATE TABLE IF NOT EXISTS _orphan_archive_${table} AS TABLE ${table} WITH NO DATA`,
  `ALTER TABLE _orphan_archive_${table} ADD COLUMN IF NOT EXISTS archived_at timestamp NOT NULL DEFAULT now()`,
  `ALTER TABLE _orphan_archive_${table} ADD COLUMN IF NOT EXISTS archive_reason text NOT NULL DEFAULT 'missing foreign-key parent'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS _orphan_archive_${table}_id_idx ON _orphan_archive_${table}(id)`,
];

export const orphanForeignKeyRepairs: string[] = [
  ...archiveColumns("customer_order_bale_removals"),
  `INSERT INTO _orphan_archive_customer_order_bale_removals
   SELECT r.*, now(), 'customer order foreign-key repair'
   FROM customer_order_bale_removals r
   WHERE NOT EXISTS (SELECT 1 FROM customer_orders o WHERE o.id = r.order_id)
   ON CONFLICT (id) DO NOTHING`,
  `DELETE FROM customer_order_bale_removals r
   WHERE NOT EXISTS (SELECT 1 FROM customer_orders o WHERE o.id = r.order_id)`,

  ...archiveColumns("supplier_container_loaded_items"),
  `INSERT INTO _orphan_archive_supplier_container_loaded_items
   SELECT r.*, now(), 'container foreign-key repair'
   FROM supplier_container_loaded_items r
   WHERE NOT EXISTS (SELECT 1 FROM containers c WHERE c.id = r.container_id)
   ON CONFLICT (id) DO NOTHING`,
  `DELETE FROM supplier_container_loaded_items r
   WHERE NOT EXISTS (SELECT 1 FROM containers c WHERE c.id = r.container_id)`,

  ...archiveColumns("chat_messages"),
  `INSERT INTO _orphan_archive_chat_messages
   SELECT m.*, now(), 'nullable company foreign-key repair'
   FROM chat_messages m
   WHERE m.company_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = m.company_id)
   ON CONFLICT (id) DO NOTHING`,
  `UPDATE chat_messages m
   SET company_id = NULL
   WHERE m.company_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = m.company_id)`,

  ...archiveColumns("container_offloads"),
  ...archiveColumns("container_offload_items"),
  `INSERT INTO _orphan_archive_container_offloads
   SELECT o.*, now(), 'location foreign-key repair'
   FROM container_offloads o
   WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.id = o.location_id)
   ON CONFLICT (id) DO NOTHING`,
  `INSERT INTO _orphan_archive_container_offload_items
   SELECT i.*, now(), 'parent offload foreign-key repair'
   FROM container_offload_items i
   JOIN container_offloads o ON o.id = i.offload_id
   WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.id = o.location_id)
   ON CONFLICT (id) DO NOTHING`,
  `DELETE FROM container_offloads o
   WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.id = o.location_id)`,

  ...archiveColumns("import_logs"),
  `INSERT INTO _orphan_archive_import_logs
   SELECT i.*, now(), 'nullable container foreign-key repair'
   FROM import_logs i
   WHERE i.container_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM containers c WHERE c.id = i.container_id)
   ON CONFLICT (id) DO NOTHING`,
  `UPDATE import_logs i
   SET container_id = NULL
   WHERE i.container_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM containers c WHERE c.id = i.container_id)`,

  ...archiveColumns("inventory"),
  `INSERT INTO _orphan_archive_inventory
   SELECT i.*, now(), 'location foreign-key repair'
   FROM inventory i
   WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.id = i.location_id)
   ON CONFLICT (id) DO NOTHING`,
  `DELETE FROM inventory i
   WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.id = i.location_id)`,

  ...archiveColumns("stock_transfer_items"),
  `INSERT INTO _orphan_archive_stock_transfer_items
   SELECT i.*, now(), 'transfer/location foreign-key repair'
   FROM stock_transfer_items i
   WHERE NOT EXISTS (SELECT 1 FROM stock_transfer_vouchers t WHERE t.id = i.transfer_id)
      OR (i.source_location_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM locations l WHERE l.id = i.source_location_id))
   ON CONFLICT (id) DO NOTHING`,
  `DELETE FROM stock_transfer_items i
   WHERE NOT EXISTS (SELECT 1 FROM stock_transfer_vouchers t WHERE t.id = i.transfer_id)
      OR (i.source_location_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM locations l WHERE l.id = i.source_location_id))`,
];
