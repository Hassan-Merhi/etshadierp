import { sql } from "drizzle-orm";
import { ConvergenceReconciliationError } from "../accounting/convergenceReconciliation";
import { summarizeCanonicalStockTransferEvidence } from "./canonicalStockTransferEvidence";
import type {
  StockTransferDocumentSnapshot,
  StockTransferMovementEvidence,
  StockTransferMovementEvidenceLoader,
} from "./databaseStockTransferConvergenceAdapter";

function positiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConvergenceReconciliationError("CONVERGENCE_DATABASE_ROW_INVALID", `${field} must be a positive integer`);
  }
  return parsed;
}

/**
 * Drivers differ: some return `{ rows }`, others the row array itself. Anything
 * that is neither is handed back untouched so the caller's array check fails it.
 */
function resultRows(result: unknown): unknown {
  if (typeof result === "object" && result !== null && "rows" in result) {
    return result.rows;
  }
  return result ?? [];
}

function sourceIds(documents: StockTransferDocumentSnapshot[]): string[] {
  const seen = new Set<string>();
  for (const document of documents) {
    const id = String(document.sourceId ?? "").trim();
    if (!id) {
      throw new ConvergenceReconciliationError(
        "CONVERGENCE_IDENTITY_INVALID",
        "Stock transfer document requires sourceId"
      );
    }
    if (seen.has(id)) {
      throw new ConvergenceReconciliationError(
        "CONVERGENCE_DUPLICATE_SNAPSHOT",
        `Duplicate stock transfer document stock-transfer:${id}`
      );
    }
    seen.add(id);
  }
  return [...seen];
}

/**
 * Reads canonical movement evidence only for the authoritative stock-transfer
 * documents supplied by the database document adapter. Keeping the source-id
 * filter in the SQL boundary prevents unrelated, deleted, draft, or another
 * domain's movements from being silently folded into a reconciliation run.
 */
export const loadDatabaseCanonicalStockTransferEvidence: StockTransferMovementEvidenceLoader = async ({
  tx,
  companyId,
  documents,
}): Promise<StockTransferMovementEvidence[]> => {
  const scopedCompanyId = positiveInteger(companyId, "companyId");
  if (documents.length === 0) return [];

  for (const document of documents) {
    if (positiveInteger(document.companyId, "document.companyId") !== scopedCompanyId) {
      throw new ConvergenceReconciliationError(
        "CONVERGENCE_COMPANY_MISMATCH",
        `Stock transfer ${document.sourceId} crossed the requested company boundary`
      );
    }
  }

  const ids = sourceIds(documents);
  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  );
  const result = await tx.execute(sql`
    SELECT
      company_id AS "companyId",
      source_type AS "sourceType",
      source_id AS "sourceId",
      location_id AS "locationId",
      stock_item_id AS "stockItemId",
      quantity_delta AS "quantityDelta",
      unit_cost AS "unitCost"
    FROM canonical_stock_movements
    WHERE company_id = ${scopedCompanyId}
      AND source_type = 'stock-transfer'
      AND source_id IN (${idList})
    ORDER BY source_id, id
  `);

  const rows = resultRows(result);
  if (!Array.isArray(rows)) {
    throw new ConvergenceReconciliationError(
      "CONVERGENCE_ADAPTER_INVALID",
      "Canonical stock movement database query must return rows"
    );
  }

  const requested = new Set(ids);
  for (const row of rows) {
    const rowCompanyId = positiveInteger(row.companyId, "movement.companyId");
    const rowSourceType = String(row.sourceType ?? "").trim();
    const rowSourceId = String(row.sourceId ?? "").trim();
    if (rowCompanyId !== scopedCompanyId) {
      throw new ConvergenceReconciliationError(
        "CONVERGENCE_COMPANY_MISMATCH",
        `Canonical movement ${rowSourceId} crossed the requested company boundary`
      );
    }
    if (rowSourceType !== "stock-transfer" || !requested.has(rowSourceId)) {
      throw new ConvergenceReconciliationError(
        "CONVERGENCE_UNEXPECTED_STOCK_EVIDENCE",
        `Canonical movement ${rowSourceType}:${rowSourceId} was not requested`
      );
    }
  }

  return summarizeCanonicalStockTransferEvidence({
    companyId: scopedCompanyId,
    rows: rows.map((row: Record<string, unknown>) => ({
      // Each row was validated in the loop above; these repeat the same
      // normalisation so the summariser receives the declared row types.
      companyId: positiveInteger(row.companyId, "movement.companyId"),
      sourceType: String(row.sourceType ?? "").trim(),
      sourceId: String(row.sourceId ?? "").trim(),
      locationId: positiveInteger(row.locationId, "movement.locationId"),
      stockItemId: positiveInteger(row.stockItemId, "movement.stockItemId"),
      quantityDelta: String(row.quantityDelta),
      unitCost: String(row.unitCost),
    })),
  });
};
