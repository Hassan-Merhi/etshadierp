import type {
  ReplayMissingSupplierTimelineRow,
  ReplayQueryExecutor,
} from "./types";

/**
 * Find suppliers with authoritative raw-material evidence that the low-level replay
 * preview did not produce a timeline for. This can happen for legacy suppliers that
 * exist only through an opening adjustment or an owned source and have no container
 * receipt in the canonical universe.
 *
 * The final replay fails closed on these rows. They must never be silently assigned
 * a zero rate or excluded from the company-wide migration.
 */
export async function loadMissingSupplierTimelineRows(
  executor: ReplayQueryExecutor,
  companyId: number,
  previewSupplierIds: number[]
): Promise<ReplayMissingSupplierTimelineRow[]> {
  const result = await executor.query<{
    supplier_id: number;
    supplier_name: string;
    has_raw_stock: boolean;
    has_adjustment: boolean;
    has_owned_source: boolean;
  }>(
    `SELECT fs.id AS supplier_id,
            fs.name AS supplier_name,
            EXISTS (
              SELECT 1
              FROM factory_raw_stock frs
              JOIN factory_containers fc
                ON fc.id = frs.container_id
               AND fc.company_id = frs.company_id
              WHERE frs.company_id = $1
                AND fc.supplier_id = fs.id
                AND frs.deleted_at IS NULL
                AND fc.deleted_at IS NULL
                AND fc.status != 'DELETED'
            ) AS has_raw_stock,
            EXISTS (
              SELECT 1
              FROM factory_raw_material_adjustments a
              WHERE a.company_id = $1
                AND a.supplier_id = fs.id
                AND a.deleted_at IS NULL
            ) AS has_adjustment,
            EXISTS (
              SELECT 1
              FROM factory_mix_batch_sources mbs
              JOIN factory_mix_batches mb
                ON mb.id = mbs.mix_batch_id
               AND mb.company_id = $1
               AND mb.deleted_at IS NULL
              WHERE mbs.inventory_supplier_id = fs.id
            ) AS has_owned_source
     FROM factory_suppliers fs
     WHERE fs.company_id = $1
       AND NOT (fs.id = ANY($2::int[]))
       AND (
         EXISTS (
           SELECT 1
           FROM factory_raw_stock frs
           JOIN factory_containers fc
             ON fc.id = frs.container_id
            AND fc.company_id = frs.company_id
           WHERE frs.company_id = $1
             AND fc.supplier_id = fs.id
             AND frs.deleted_at IS NULL
             AND fc.deleted_at IS NULL
             AND fc.status != 'DELETED'
         )
         OR EXISTS (
           SELECT 1
           FROM factory_raw_material_adjustments a
           WHERE a.company_id = $1
             AND a.supplier_id = fs.id
             AND a.deleted_at IS NULL
         )
         OR EXISTS (
           SELECT 1
           FROM factory_mix_batch_sources mbs
           JOIN factory_mix_batches mb
             ON mb.id = mbs.mix_batch_id
            AND mb.company_id = $1
            AND mb.deleted_at IS NULL
           WHERE mbs.inventory_supplier_id = fs.id
         )
       )
     ORDER BY fs.id`,
    [companyId, previewSupplierIds]
  );

  return result.rows.map((row) => ({
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    hasRawStock: Boolean(row.has_raw_stock),
    hasAdjustment: Boolean(row.has_adjustment),
    hasOwnedSource: Boolean(row.has_owned_source),
  }));
}
