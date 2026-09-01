import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { containers, containerTrackingChecks } from "../../../shared/schema";
import { and, eq, inArray, gte, sql } from "drizzle-orm";
import { isScraperAvailable } from "../../lib/parcelsAppScraper";
import { isHttpScraperAvailable } from "../../lib/httpTrackingScraper";
import { isMaerskDirectScraperAvailable } from "../../lib/maerskDirectScraper";
import * as seventeenTrack from "../../lib/trackingProviders/seventeenTrackProvider";
import type { CarrierTrackResult } from "../../lib/trackingProviders/types";

export async function getParcelsAppUsageStats(): Promise<{ used: number; limit: number }> {
  const limit = Math.max(1, parseInt(process.env.PARCELSAPP_MONTHLY_LIMIT ?? "500") || 500);

  try {
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const result = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(containerTrackingChecks)
      .where(
        and(
          eq(containerTrackingChecks.provider, "parcelsapp"),
          inArray(containerTrackingChecks.status, ["success", "error", "timeout"]),
          gte(containerTrackingChecks.checkedAt, startOfMonth)
        )
      );

    const used = result[0]?.count ?? 0;
    return { used, limit };
  } catch (err: unknown) {
    logger.warn("[ContainerTracking] Could not read quota from DB:", { error: getErrorMessage(err) });
    return { used: 0, limit };
  }
}

export async function checkParcelsAppQuota(): Promise<boolean> {
  const { used, limit } = await getParcelsAppUsageStats();
  return used < limit;
}

// ── Provider availability ─────────────────────────────────────────────────────

export function anyProviderConfigured(): boolean {
  return (
    !!process.env.PARCELSAPP_API_KEY ||
    seventeenTrack.isConfigured() ||
    isScraperAvailable() ||
    isHttpScraperAvailable() ||
    isMaerskDirectScraperAvailable()
  );
}

/**
 * Count 17track credits used this calendar month.
 * Only 'success' and 'error' rows count (same pattern as ParcelsApp).
 */
export async function get17trackUsageStats(): Promise<{ used: number; limit: number }> {
  const limit = seventeenTrack.getMonthlyLimit();
  try {
    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const result = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(containerTrackingChecks)
      .where(
        and(
          eq(containerTrackingChecks.provider, "17track"),
          inArray(containerTrackingChecks.status, ["success", "error"]),
          gte(containerTrackingChecks.checkedAt, startOfMonth)
        )
      );
    return { used: result[0]?.count ?? 0, limit };
  } catch {
    return { used: 0, limit };
  }
}

export async function check17trackQuota(): Promise<boolean> {
  const { used, limit } = await get17trackUsageStats();
  return used < limit;
}

// ── Fallback reason derivation ────────────────────────────────────────────────

export function deriveFallbackReason(result: CarrierTrackResult): string {
  const p = result.provider;
  if (result.notConfigured) return `${p}_not_configured`;
  if (result.blocked) return `${p}_blocked`;
  if (result.noData) return `${p}_no_data`;
  return `${p}_error`;
}

// ── Scheduler metadata helper ─────────────────────────────────────────────────

/**
 * Updates tracking_last_skip_reason and optionally tracking_next_check_at.
 * Pass nextCheckAt=undefined to leave that column unchanged.
 */
export async function setSchedulerMeta(
  containerId: number,
  skipReason: string | null,
  nextCheckAt: Date | null | undefined
): Promise<void> {
  try {
    const patch: Record<string, unknown> = { trackingLastSkipReason: skipReason };
    if (nextCheckAt !== undefined) patch.trackingNextCheckAt = nextCheckAt;
    await db.update(containers).set(patch).where(eq(containers.id, containerId));
  } catch (err: unknown) {
    logger.warn("[ContainerTracking] setSchedulerMeta warn:", { error: getErrorMessage(err) });
  }
}

// ─── Public entry points ───────────────────────────────────────────────────────

/**
 * Smart priority scheduler — called every Tuesday at 8:00 AM EST.
 *
 * For each active, tracking-enabled container:
 *   1. Skip invalid container numbers → saves invalid_container_number record.
 *   2. Skip if trackingAutoUpdate = false → saves skipped_disabled record.
 *   3. Compute priority score/tier based on status, ETA, overdue, docs state.
 *   4. Skip if checked too recently (within minimumIntervalHours) → saves skipped_recent.
 *   5. Sort remaining by priority desc, oldest checked first, ETA nearest first.
 *   6. Track top N where N = perRunBudget (derived from remaining quota / days).
 *   7. For containers beyond budget → saves skipped_priority_budget record.
 *
 * Skip records are saved with provider='skipped' and never count toward quota.
 */
