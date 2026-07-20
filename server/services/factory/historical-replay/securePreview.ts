import { pool } from "../../../db";
import type { ReplayQueryExecutor } from "./types";
import {
  previewHistoricalCostReplayWithExecutor as previewHistoricalCostReplayWithExecutorBase,
} from "./readModel";
import {
  loadReplayAuthoritativeInputDigest,
  type ReplayPreviewWithAuthoritativeDigest,
} from "./fingerprint";
import { normalizePreviewPersistedContainerTotals } from "./canonicalCostsV6";
import {
  applyReceiptAdjustmentAmbiguityBlocks,
  findReceiptAdjustmentAmbiguitySupplierIds,
} from "./timelineAmbiguityV6";

export async function previewHistoricalCostReplayWithExecutor(
  executor: ReplayQueryExecutor,
  companyId: number
): Promise<ReplayPreviewWithAuthoritativeDigest> {
  const [basePreview, authoritative, ambiguousSupplierIds] = await Promise.all([
    previewHistoricalCostReplayWithExecutorBase(executor, companyId),
    loadReplayAuthoritativeInputDigest(executor, companyId),
    findReceiptAdjustmentAmbiguitySupplierIds(executor, companyId),
  ]);
  const persistedTargetPreview = await normalizePreviewPersistedContainerTotals(
    executor,
    companyId,
    basePreview
  );
  const preview = applyReceiptAdjustmentAmbiguityBlocks(
    persistedTargetPreview,
    ambiguousSupplierIds
  );

  return Object.assign(preview, {
    authoritativeInputDigest: authoritative.digest,
    authoritativeInputCounts: authoritative.counts,
  });
}

export async function previewHistoricalCostReplay(
  companyId: number
): Promise<ReplayPreviewWithAuthoritativeDigest> {
  return previewHistoricalCostReplayWithExecutor(pool as ReplayQueryExecutor, companyId);
}
