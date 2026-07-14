/**
 * Safe repair service for raw-material rows whose non-USD exchange rate is
 * unresolved (see `fx-diagnostic` route / `resolveStoredFxRate`).
 *
 * This service does ONE thing: it lets an admin supply the real, explicitly-known
 * exchange rate for a specific row and persists it via the `fxRateConfirmed` flag.
 * It never guesses a rate itself, never recalculates downstream cost/kg or cascades
 * to mix batches/bales (that remains the separate, existing `rawStockRecalc`
 * preview/apply flow, which already refuses to touch fx-unresolved containers),
 * and never touches a container whose status is CLOSED/COMPLETED/OFFLOADED —
 * those are reported as MANUAL_REVIEW_REQUIRED instead of repaired automatically.
 *
 * Every apply is: admin-gated (by the caller), wrapped in a transaction with a
 * Postgres advisory lock on the row, idempotent (re-applying the same rate is a
 * no-op), and audit-logged (by the caller, which has the request's user context).
 */
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import {
  factoryContainers,
  factoryOffloadAdditionalCharges,
  factoryContainerCommissions,
} from "@shared/schema";

export type FxResolutionSource = "container" | "offload_additional_charge" | "commission";

const CLOSED_STATUSES = new Set(["CLOSED", "COMPLETED", "OFFLOADED"]);

// Advisory lock keys are scoped by source so the same numeric id across different
// tables can't collide with each other while a repair is in flight.
const LOCK_NAMESPACE: Record<FxResolutionSource, number> = {
  container: 1,
  offload_additional_charge: 2,
  commission: 3,
};

export interface FxResolutionPlan {
  source: FxResolutionSource;
  id: number;
  companyId: number;
  currencyCode: string;
  oldFxRateToUsd: string | null;
  oldFxRateConfirmed: boolean;
  newFxRateToUsd: string;
  alreadyResolved: boolean;
  manualReviewRequired: boolean;
  manualReviewReason: string | null;
  containerId: number | null;
  containerStatus: string | null;
}

async function loadRow(source: FxResolutionSource, id: number, companyId: number) {
  if (source === "container") {
    const [row] = await db
      .select()
      .from(factoryContainers)
      .where(and(eq(factoryContainers.id, id), eq(factoryContainers.companyId, companyId)));
    if (!row) return null;
    return {
      currencyCode: row.currencyCode,
      fxRateToUsd: row.fxRateToUsd,
      fxRateConfirmed: !!(row as any).fxRateConfirmed,
      containerId: row.id,
      containerStatus: row.status,
    };
  }
  if (source === "offload_additional_charge") {
    const [row] = await db
      .select()
      .from(factoryOffloadAdditionalCharges)
      .where(and(eq(factoryOffloadAdditionalCharges.id, id), eq(factoryOffloadAdditionalCharges.companyId, companyId)));
    if (!row) return null;
    const [container] = row.containerId
      ? await db.select().from(factoryContainers).where(eq(factoryContainers.id, row.containerId))
      : [null];
    return {
      currencyCode: row.currencyCode,
      fxRateToUsd: row.fxRateToUsd,
      fxRateConfirmed: !!(row as any).fxRateConfirmed,
      containerId: row.containerId,
      containerStatus: container?.status ?? null,
    };
  }
  // commission
  const [row] = await db
    .select()
    .from(factoryContainerCommissions)
    .where(and(eq(factoryContainerCommissions.id, id), eq(factoryContainerCommissions.companyId, companyId)));
  if (!row) return null;
  const [container] = row.containerId
    ? await db.select().from(factoryContainers).where(eq(factoryContainers.id, row.containerId))
    : [null];
  return {
    currencyCode: row.currencyCode,
    fxRateToUsd: row.fxRateToUsd,
    fxRateConfirmed: !!(row as any).fxRateConfirmed,
    containerId: row.containerId,
    containerStatus: container?.status ?? null,
  };
}

/** Read-only: compute what a repair WOULD do, without writing anything. */
export async function planFxResolutionRepair(
  source: FxResolutionSource,
  id: number,
  companyId: number,
  newFxRateToUsd: number
): Promise<FxResolutionPlan | null> {
  const row = await loadRow(source, id, companyId);
  if (!row) return null;

  const manualReviewRequired = !!(row.containerStatus && CLOSED_STATUSES.has(row.containerStatus));

  return {
    source,
    id,
    companyId,
    currencyCode: row.currencyCode || "USD",
    oldFxRateToUsd: row.fxRateToUsd,
    oldFxRateConfirmed: row.fxRateConfirmed,
    newFxRateToUsd: String(newFxRateToUsd),
    alreadyResolved:
      row.fxRateConfirmed && parseFloat(row.fxRateToUsd || "0") === newFxRateToUsd,
    manualReviewRequired,
    manualReviewReason: manualReviewRequired
      ? `Container status is ${row.containerStatus} — historical costing on closed containers is never auto-rewritten. Resolve manually.`
      : null,
    containerId: row.containerId,
    containerStatus: row.containerStatus,
  };
}

export interface FxResolutionApplyResult extends FxResolutionPlan {
  applied: boolean;
}

/**
 * Apply the repair: sets fxRateToUsd + fxRateConfirmed=true on the target row.
 * Refuses (throws) if the container is CLOSED/COMPLETED/OFFLOADED, if the currency
 * is USD (nothing to resolve), or if the rate is not a positive number. Idempotent:
 * re-applying the exact same already-confirmed rate is a no-op (applied=false).
 */
export async function applyFxResolutionRepair(
  source: FxResolutionSource,
  id: number,
  companyId: number,
  newFxRateToUsd: number
): Promise<FxResolutionApplyResult> {
  if (!(newFxRateToUsd > 0)) {
    throw new Error("newFxRateToUsd must be a positive number");
  }

  return await db.transaction(async (tx) => {
    // Advisory lock scoped to (namespace, id) so concurrent repairs on the same row
    // serialize instead of racing; released automatically at transaction end.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE[source]}, ${id})`);

    const plan = await planFxResolutionRepair(source, id, companyId, newFxRateToUsd);
    if (!plan) throw new Error(`${source} #${id} not found for company ${companyId}`);
    if (plan.currencyCode === "USD") {
      throw new Error("Row is already in USD — there is no exchange rate to resolve");
    }
    if (plan.manualReviewRequired) {
      throw new Error(
        `MANUAL_REVIEW_REQUIRED: ${plan.manualReviewReason} Historical costing on this container was not modified.`
      );
    }
    if (plan.alreadyResolved) {
      return { ...plan, applied: false };
    }

    const values = { fxRateToUsd: String(newFxRateToUsd), fxRateConfirmed: true } as any;
    if (source === "container") {
      await tx.update(factoryContainers).set(values).where(eq(factoryContainers.id, id));
    } else if (source === "offload_additional_charge") {
      await tx.update(factoryOffloadAdditionalCharges).set(values).where(eq(factoryOffloadAdditionalCharges.id, id));
    } else {
      await tx.update(factoryContainerCommissions).set(values).where(eq(factoryContainerCommissions.id, id));
    }

    return { ...plan, applied: true };
  });
}
