import { db } from "../../db";
import { containers, containerTrackingChecks } from "../../../shared/schema";
import { and, eq, gte } from "drizzle-orm";
import { isMaerskDirectScraperAvailable } from "../../lib/maerskDirectScraper";
import { getParcelsAppUsageStats, setSchedulerMeta } from "./quotas";
import { trackOneContainer } from "./track-one";
import { isInactiveStatus } from "./validation-progress";

export interface TrackNowResult {
  success: boolean;
  containerNumber: string;
  provider: string | null;
  lastStatus: string | null;
  lastLocation: string | null;
  lastDescription: string | null;
  lastCheckedAt: Date;
  oldEta: string | null;
  newEta: string | null;
  etaChanged: boolean;
  attempts: Array<{ provider: string; status: string; error: string | null }>;
  error: string | null;
  quotaWarning?: string;
}

// ── In-flight tracking cap ─────────────────────────────────────────────────────
const MAX_CONCURRENT_TRACK_JOBS = 5;
let _activeTrackJobs = 0;

/** True when the server already has the maximum number of tracking jobs running. */
export function isTrackingAtCapacity(): boolean {
  return _activeTrackJobs >= MAX_CONCURRENT_TRACK_JOBS;
}

/** Number of ERP tracking jobs currently in flight. */
export function trackingInFlightCount(): number {
  return _activeTrackJobs;
}

export async function trackOneContainerById(containerId: number): Promise<TrackNowResult> {
  if (_activeTrackJobs >= MAX_CONCURRENT_TRACK_JOBS) {
    throw Object.assign(new Error("Server is busy — too many tracking jobs in flight. Try again shortly."), {
      code: "TRACKING_BUSY",
    });
  }

  const [row] = await db
    .select({
      id: containers.id,
      containerNumber: containers.containerNumber,
      trackingCarrierHint: containers.trackingCarrierHint,
      status: containers.status,
      eta: containers.eta,
    })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);

  if (!row) throw new Error("Container not found");

  if (isInactiveStatus(row.status)) {
    throw new Error("Tracking is disabled for offloaded/closed/completed containers.");
  }

  // Check quota and add warning when quota is low (< 10%)
  const { used, limit } = await getParcelsAppUsageStats();
  const remaining = Math.max(0, limit - used);
  let quotaWarning: string | undefined;

  if (remaining === 0 && !isMaerskDirectScraperAvailable()) {
    throw new Error(`ParcelsApp monthly quota exhausted (${used}/${limit}). Track Now is blocked until next month.`);
  }

  if (remaining > 0 && remaining <= Math.ceil(limit * 0.1)) {
    quotaWarning = `ParcelsApp quota is low — ${remaining} of ${limit} credits remaining this month.`;
  }

  _activeTrackJobs++;
  try {
    const oldEta = row.eta ?? null;
    const trackStartedAt = new Date();

    const result = await trackOneContainer(row.id, row.containerNumber, row.trackingCarrierHint ?? undefined);

    // Manual track: clear skip reason, set next check to 24 h from now
    await setSchedulerMeta(row.id, null, new Date(Date.now() + 24 * 60 * 60 * 1000));

    // Read back the persisted values so we can report exactly what was saved
    const [postRow] = await db
      .select({ eta: containers.eta, trackingProvider: containers.trackingProvider })
      .from(containers)
      .where(eq(containers.id, containerId))
      .limit(1);

    const newEta = postRow?.eta ?? null;
    const finalProvider = postRow?.trackingProvider ?? null;

    // Collect every provider attempt recorded during this tracking run
    const attemptRows = await db
      .select({
        provider: containerTrackingChecks.provider,
        status: containerTrackingChecks.status,
        error: containerTrackingChecks.errorMessage,
      })
      .from(containerTrackingChecks)
      .where(
        and(
          eq(containerTrackingChecks.containerId, containerId),
          gte(containerTrackingChecks.checkedAt, trackStartedAt)
        )
      )
      .orderBy(containerTrackingChecks.checkedAt);

    return {
      success: result.success,
      containerNumber: row.containerNumber,
      provider: finalProvider,
      lastStatus: result.lastStatus,
      lastLocation: result.lastLocation,
      lastDescription: result.lastDescription,
      lastCheckedAt: result.lastCheckedAt,
      oldEta,
      newEta,
      etaChanged: newEta !== oldEta,
      attempts: attemptRows,
      error: result.error,
      quotaWarning,
    };
  } finally {
    _activeTrackJobs--;
  }
}

// ─── ETA resolution helpers ───────────────────────────────────────────────────

/**
 * Resolve the best ETA from a direct carrier provider result.
 * Priority: provider explicit ETA → preserve existing DB value.
 * NEVER derives ETA from event dates — event dates are movement records
 * (gate-in, load, departure, discharge, etc.), not destination ETAs.
 * NEVER blanks an existing ETA.
 */
