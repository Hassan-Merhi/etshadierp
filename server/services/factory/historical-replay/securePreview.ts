import { pool } from "../../../db";
import type { ReplayQueryExecutor } from "./types";
import {
  previewHistoricalCostReplayWithExecutor as previewHistoricalCostReplayWithExecutorBase,
} from "./readModel";
import {
  loadReplayAuthoritativeInputDigest,
  type ReplayPreviewWithAuthoritativeDigest,
} from "./fingerprint";

export async function previewHistoricalCostReplayWithExecutor(
  executor: ReplayQueryExecutor,
  companyId: number
): Promise<ReplayPreviewWithAuthoritativeDigest> {
  const [preview, authoritative] = await Promise.all([
    previewHistoricalCostReplayWithExecutorBase(executor, companyId),
    loadReplayAuthoritativeInputDigest(executor, companyId),
  ]);

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
