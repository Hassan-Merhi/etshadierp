import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { containers, containerTrackingEvents, containerTrackingChecks } from "../../../shared/schema";
import { and, eq, inArray, gte, sql, desc, isNotNull, isNull } from "drizzle-orm";
import { sleep } from "./persistence";
import { anyProviderConfigured } from "./quotas";
import { trackOneContainer } from "./track-one";
import { activeStatusFilter, isValidContainerNumber } from "./validation-progress";

export async function setBulkTrackingEnabled(enabled: boolean): Promise<number> {
  const result = await db
    .update(containers)
    .set({ trackingEnabled: enabled })
    .where(activeStatusFilter)
    .returning({ id: containers.id });
  return result.length;
}

// ── Bulk-run dedup guard ──────────────────────────────────────────────────────
// Prevents two "Track All Now" runs from overlapping.  The flag is cleared as
// soon as the background loop finishes (or errors out).
let _bulkRunning = false;

// ── Bulk-run progress tracking ────────────────────────────────────────────────
export type BulkTrackingProgress = {
  running: boolean;
  total: number;
  processed: number;
  current: string | null;
  startedAt: number | null;
  completedAt: number | null;
};

let _bulkProgress: BulkTrackingProgress = {
  running: false,
  total: 0,
  processed: 0,
  current: null,
  startedAt: null,
  completedAt: null,
};

/** Returns a snapshot of the current bulk-tracking progress. */
export function getBulkProgress(): BulkTrackingProgress {
  return { ..._bulkProgress };
}

/** True while a bulk "Track All Now" run is in progress. */
export function isBulkTrackingRunning(): boolean {
  return _bulkRunning;
}

/**
 * Immediately trigger tracking for every non-inactive container.
 * Bypasses cooldown and trackingEnabled flag — explicit manual override.
 * Starts tracking in the background and returns the count immediately.
 * Returns 0 if a bulk run is already in progress.
 */
export async function trackAllEnabledNow(): Promise<number> {
  if (!anyProviderConfigured()) return 0;
  if (_bulkRunning) {
    logger.info("[BulkTracking] A bulk run is already in progress — ignoring duplicate request.");
    return 0;
  }

  const rows = await db
    .select({
      id: containers.id,
      containerNumber: containers.containerNumber,
      trackingCarrierHint: containers.trackingCarrierHint,
    })
    .from(containers)
    .where(activeStatusFilter);

  const eligible = rows.filter((r) => isValidContainerNumber(r.containerNumber));
  if (eligible.length === 0) return 0;

  _bulkRunning = true;
  _bulkProgress = {
    running: true,
    total: eligible.length,
    processed: 0,
    current: eligible[0]?.containerNumber ?? null,
    startedAt: Date.now(),
    completedAt: null,
  };

  (async () => {
    logger.info(
      `[BulkTracking] Starting manual run for ${eligible.length} container(s): ` +
        eligible
          .map((r) => r.containerNumber)
          .slice(0, 5)
          .join(", ") +
        (eligible.length > 5 ? "…" : "")
    );
    for (let i = 0; i < eligible.length; i++) {
      const row = eligible[i];
      _bulkProgress.current = row.containerNumber;
      _bulkProgress.processed = i;
      try {
        await trackOneContainer(row.id, row.containerNumber, row.trackingCarrierHint ?? undefined);
        await sleep(2_000);
      } catch (err: unknown) {
        logger.error(`[BulkTracking] Error tracking ${row.containerNumber}:`, { error: getErrorMessage(err) });
      }
      _bulkProgress.processed = i + 1;
    }
    logger.info(`[BulkTracking] Manual run complete for ${eligible.length} containers.`);
  })()
    .catch((err: unknown) => logger.error("[BulkTracking] Unexpected error:", { error: getErrorMessage(err) }))
    .finally(() => {
      _bulkRunning = false;
      _bulkProgress.running = false;
      _bulkProgress.current = null;
      _bulkProgress.completedAt = Date.now();
    });

  return eligible.length;
}

/**
 * Manually trigger tracking for a single container by ID.
 * Used by the "Track Now" API endpoint.
 *
 * Rejects:
 *   - inactive containers (any casing of Offloaded/Closed/Completed)
 *   - exhausted ParcelsApp quota (when ParcelsApp would be the only provider)
 *
 * Allows with warning if quota is low but remaining > 0.
 */
