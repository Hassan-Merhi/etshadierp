import type {
  CanonicalContainer,
  ContainerUniverse,
  HistoricalReplayPreviewResult,
  ReplayQueryExecutor,
} from "./types";
import { numeric } from "./types";
import { computeCanonicalCosts } from "./readModel";

/**
 * Replay writes the container's persisted USD target columns. Container mismatch
 * detection must therefore compare against factory_containers.rate_per_kg_usd
 * and final_payable_amount_usd—not an active raw-stock row and not a reconstructed
 * receivedKg × rate total.
 */
export async function computeCanonicalCostsV6(
  executor: ReplayQueryExecutor,
  companyId: number,
  universe: ContainerUniverse[]
): Promise<CanonicalContainer[]> {
  const canonical = await computeCanonicalCosts(executor, companyId, universe);
  return canonical.map((row) => ({
    ...row,
    storedCostPerKgUsd: numeric(row.universe.container.ratePerKgUsd),
    storedTotalUsd: numeric(row.universe.container.finalPayableAmountUsd),
  }));
}

/** Keep read-only preview/fingerprint rows aligned with exact write targets. */
export async function normalizePreviewPersistedContainerTotals(
  executor: ReplayQueryExecutor,
  companyId: number,
  preview: HistoricalReplayPreviewResult
): Promise<HistoricalReplayPreviewResult> {
  const containerIds = preview.containerRows.map((row) => row.containerId);
  if (containerIds.length === 0) return preview;

  const result = await executor.query<{
    id: number;
    rate_per_kg_usd: string | null;
    final_payable_amount_usd: string | null;
  }>(
    `SELECT id, rate_per_kg_usd, final_payable_amount_usd
     FROM factory_containers
     WHERE company_id = $1 AND id = ANY($2)`,
    [companyId, containerIds]
  );
  const persistedById = new Map(
    result.rows.map((row) => [row.id, {
      rate: numeric(row.rate_per_kg_usd),
      total: numeric(row.final_payable_amount_usd),
    }])
  );
  const containerRows = preview.containerRows.map((row) => {
    const persisted = persistedById.get(row.containerId);
    return {
      ...row,
      storedCostPerKgUsd: persisted?.rate ?? row.storedCostPerKgUsd,
      storedTotalUsd: persisted?.total ?? row.storedTotalUsd,
    };
  });

  return {
    ...preview,
    containerRows,
    summary: {
      ...preview.summary,
      canonicalContainerMismatches: containerRows.filter((row) =>
        row.safeToRepair
        && (
          Math.abs(row.canonicalCostPerKgUsd - row.storedCostPerKgUsd) > 0.000001
          || Math.abs(row.canonicalTotalUsd - row.storedTotalUsd) > 0.01
        )
      ).length,
    },
  };
}
