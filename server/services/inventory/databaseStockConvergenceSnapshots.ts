import type { db } from "../../db";
import type { StockConvergenceSnapshot } from "../accounting/convergenceReconciliation";
import { loadDatabaseCanonicalStockTransferEvidence } from "./databaseCanonicalStockTransferEvidence";
import {
  loadDatabaseCanonicalStockAdjustmentEvidence,
  loadDatabaseStockAdjustmentDocuments,
  mergeStockAdjustmentConvergenceEvidence,
} from "./databaseStockAdjustmentConvergenceAdapter";
import {
  loadDatabaseStockTransferDocuments,
  mergeStockTransferConvergenceEvidence,
} from "./databaseStockTransferConvergenceAdapter";

/** The concrete drizzle transaction handle, inferred from the shared client. */
type DrizzleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The authoritative stock snapshot for reconciliation, across every domain that
 * records canonical movement evidence today.
 *
 * Each domain keeps its own document loader deliberately: a transfer is a
 * balanced pair of legs between two locations, an adjustment is a single receipt
 * or issue at one, and folding them into a shared query would need one of those
 * shapes to lie about itself. Domains that do not yet write canonical evidence
 * are absent here rather than reported as unevidenced.
 */
export async function loadDatabaseStockConvergenceSnapshots(input: {
  tx: DrizzleTransaction;
  companyId: number;
}): Promise<StockConvergenceSnapshot[]> {
  const { tx, companyId } = input;

  const transferDocuments = await loadDatabaseStockTransferDocuments({ tx, companyId });
  const transferEvidence = await loadDatabaseCanonicalStockTransferEvidence({
    tx,
    companyId,
    documents: transferDocuments,
  });
  const transfers = mergeStockTransferConvergenceEvidence({
    companyId,
    documents: transferDocuments,
    evidence: transferEvidence,
  });

  const adjustmentDocuments = await loadDatabaseStockAdjustmentDocuments({ tx, companyId });
  const adjustmentEvidence = await loadDatabaseCanonicalStockAdjustmentEvidence({
    tx,
    companyId,
    documents: adjustmentDocuments,
  });
  const adjustments = mergeStockAdjustmentConvergenceEvidence({
    companyId,
    documents: adjustmentDocuments,
    evidence: adjustmentEvidence,
  });

  return [...transfers, ...adjustments];
}
