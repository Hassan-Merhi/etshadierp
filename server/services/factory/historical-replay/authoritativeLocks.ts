import type { ReplayQueryExecutor } from "./types";

function sortedIds(ids: number[]): number[] {
  return [...new Set(ids)].sort((left, right) => left - right);
}

/**
 * Lock existing landed-cost and quantity inputs before rebuilding apply scope.
 * Supplier-first ordering matches receipt/offload rate writers and reduces
 * deadlock risk. Serializable isolation handles predicate/phantom ordering;
 * these locks prevent existing input rows from being edited or deleted mid-run.
 */
export async function lockSelectedReplayAuthoritativeInputs(
  executor: ReplayQueryExecutor,
  companyId: number,
  supplierIds: number[]
): Promise<void> {
  const ids = sortedIds(supplierIds);
  if (ids.length === 0) return;

  await executor.query(
    `SELECT id
     FROM factory_suppliers
     WHERE company_id = $1 AND id = ANY($2)
     ORDER BY id
     FOR UPDATE`,
    [companyId, ids]
  );

  const containerResult = await executor.query<{ id: number }>(
    `SELECT id
     FROM factory_containers
     WHERE company_id = $1
       AND supplier_id = ANY($2)
       AND deleted_at IS NULL
     ORDER BY id
     FOR UPDATE`,
    [companyId, ids]
  );
  const containerIds = containerResult.rows.map((row) => row.id);

  await executor.query(
    `SELECT id
     FROM factory_raw_material_adjustments
     WHERE company_id = $1
       AND supplier_id = ANY($2)
       AND deleted_at IS NULL
     ORDER BY id
     FOR SHARE`,
    [companyId, ids]
  );

  if (containerIds.length > 0) {
    const inputTables = [
      "factory_container_receipts",
      "factory_offload_additional_charges",
      "factory_container_commissions",
      "factory_container_other_charges",
    ] as const;
    for (const table of inputTables) {
      await executor.query(
        `SELECT id
         FROM ${table}
         WHERE company_id = $1 AND container_id = ANY($2)
         ORDER BY id
         FOR SHARE`,
        [companyId, containerIds]
      );
    }

    await executor.query(
      `SELECT id
       FROM factory_raw_stock
       WHERE company_id = $1
         AND container_id = ANY($2)
         AND deleted_at IS NULL
       ORDER BY id
       FOR UPDATE`,
      [companyId, containerIds]
    );
  }

  await executor.query(
    `SELECT id
     FROM factory_daybook_entries
     WHERE company_id = $1 AND tx_type = 'OFFLOAD_RAW_STOCK'
     ORDER BY id
     FOR SHARE`,
    [companyId]
  );
}
