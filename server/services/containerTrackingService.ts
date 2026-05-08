/**
 * containerTrackingService.ts — Server-side container tracking via ParcelsApp.
 *
 * Rules:
 *  - NEVER overwrite status when current status is Offloaded, Closed, or Completed.
 *  - Manual status always wins over API status.
 *  - tracking_enabled must be true on the container for auto-tracking.
 *  - Minimum 4 hours between automatic checks per container (cooldown).
 */

import { db } from "../db";
import {
  containers,
  containerTrackingEvents,
  containerTrackingChecks,
} from "../../shared/schema";
import { and, eq, isNull, or, lt, notInArray } from "drizzle-orm";
import {
  trackContainer,
  normaliseEvents,
  deriveLastStatus,
  deriveLastLocation,
  deriveLastEventDate,
  type ParcelsAppShipment,
} from "../lib/parcelsAppClient";

const INACTIVE_STATUSES = ["Offloaded", "Closed", "Completed"] as const;
const INACTIVE_SET = new Set<string>(INACTIVE_STATUSES);

const COOLDOWN_HOURS = 4;

// ─── Main public entry points ─────────────────────────────────────────────────

/**
 * Track all due containers — called by the scheduler every 6 hours.
 * "Due" means: tracking_enabled=true, status not inactive, and either
 * tracking_last_checked_at is null or older than COOLDOWN_HOURS.
 */
export async function trackDueContainers(): Promise<void> {
  console.log("[ContainerTracking] Starting auto-tracking run...");

  if (!process.env.PARCELSAPP_API_KEY) {
    console.log("[ContainerTracking] PARCELSAPP_API_KEY not set — skipping.");
    return;
  }

  const cutoff = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000);

  let rows: Array<{ id: number; containerNumber: string; trackingCarrierHint: string | null }>;
  try {
    rows = await db
      .select({
        id: containers.id,
        containerNumber: containers.containerNumber,
        trackingCarrierHint: containers.trackingCarrierHint,
      })
      .from(containers)
      .where(
        and(
          eq(containers.trackingEnabled, true),
          notInArray(containers.status, [...INACTIVE_STATUSES]),
          or(
            isNull(containers.trackingLastCheckedAt),
            lt(containers.trackingLastCheckedAt, cutoff),
          ),
        ),
      );
  } catch (err: any) {
    console.error("[ContainerTracking] Failed to fetch due containers:", err?.message);
    return;
  }

  if (rows.length === 0) {
    console.log("[ContainerTracking] No containers due for tracking.");
    return;
  }

  console.log(`[ContainerTracking] ${rows.length} container(s) due for tracking.`);

  for (const row of rows) {
    try {
      await trackOneContainer(row.id, row.containerNumber, row.trackingCarrierHint ?? undefined);
      // Small delay between containers to be polite to the API
      await sleep(1_500);
    } catch (err: any) {
      console.error(`[ContainerTracking] Error tracking ${row.containerNumber}:`, err?.message);
    }
  }

  console.log("[ContainerTracking] Auto-tracking run complete.");
}

/**
 * Manually trigger tracking for a single container by ID.
 * Used by the "Track Now" API endpoint.
 * Returns a summary of the result.
 */
export async function trackOneContainerById(containerId: number): Promise<{
  success: boolean;
  lastStatus: string | null;
  lastLocation: string | null;
  lastDescription: string | null;
  lastCheckedAt: Date;
  error: string | null;
}> {
  const [row] = await db
    .select({
      id: containers.id,
      containerNumber: containers.containerNumber,
      trackingCarrierHint: containers.trackingCarrierHint,
      status: containers.status,
    })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);

  if (!row) throw new Error("Container not found");

  if (INACTIVE_SET.has(row.status)) {
    throw new Error(
      `Container status is "${row.status}" — tracking updates are disabled for closed containers`,
    );
  }

  return trackOneContainer(row.id, row.containerNumber, row.trackingCarrierHint ?? undefined);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function trackOneContainer(
  containerId: number,
  containerNumber: string,
  carrierHint?: string,
): Promise<{
  success: boolean;
  lastStatus: string | null;
  lastLocation: string | null;
  lastDescription: string | null;
  lastCheckedAt: Date;
  error: string | null;
}> {
  const now = new Date();
  const result = await trackContainer(containerNumber, carrierHint ?? "United States");

  const checkData: {
    containerId: number;
    provider: string;
    status: string;
    checkedAt: Date;
    errorMessage: string | null;
    rawResponseJson: unknown;
  } = {
    containerId,
    provider: "parcelsapp",
    status: result.success ? "success" : result.timedOut ? "timeout" : "error",
    checkedAt: now,
    errorMessage: result.error ?? null,
    rawResponseJson: result.rawResponse,
  };

  // Save check record
  try {
    await db.insert(containerTrackingChecks).values(checkData);
  } catch (err: any) {
    console.warn("[ContainerTracking] Failed to save check record:", err?.message);
  }

  if (!result.success || !result.shipment) {
    // Save failed state to container
    await db
      .update(containers)
      .set({
        trackingLastCheckedAt: now,
        trackingError: result.error ?? "Tracking failed",
      })
      .where(eq(containers.id, containerId));

    return {
      success: false,
      lastStatus: null,
      lastLocation: null,
      lastDescription: null,
      lastCheckedAt: now,
      error: result.error ?? "Tracking failed",
    };
  }

  const shipment = result.shipment;
  const lastStatus = deriveLastStatus(shipment);
  const lastLocation = deriveLastLocation(shipment);
  const lastEventDate = deriveLastEventDate(shipment);
  const lastDescription = shipment.states?.[0]?.description ?? null;

  // Save events
  await saveTrackingEvents(containerId, shipment);

  // Update container tracking fields
  await db
    .update(containers)
    .set({
      trackingLastCheckedAt: now,
      trackingLastStatus: lastStatus,
      trackingLastLocation: lastLocation,
      trackingLastEventDate: lastEventDate,
      trackingLastDescription: lastDescription,
      trackingError: null,
      trackingChangedAt: now,
      // Also update the visible tracking fields that the existing UI shows
      trackingLocation: lastLocation ?? undefined,
      trackingDescription: lastDescription ?? undefined,
    })
    .where(eq(containers.id, containerId));

  console.log(
    `[ContainerTracking] ${containerNumber} → status: ${lastStatus ?? "unknown"}, location: ${lastLocation ?? "unknown"}`,
  );

  return {
    success: true,
    lastStatus,
    lastLocation,
    lastDescription,
    lastCheckedAt: now,
    error: null,
  };
}

/**
 * Saves all tracking states from a shipment as individual event rows.
 * Uses INSERT ... ON CONFLICT DO NOTHING to avoid duplicates.
 */
async function saveTrackingEvents(
  containerId: number,
  shipment: ParcelsAppShipment,
): Promise<void> {
  const events = normaliseEvents(shipment);
  if (events.length === 0) return;

  for (const ev of events) {
    let eventTime: Date | null = null;
    if (ev.date) {
      const d = new Date(ev.date);
      if (!isNaN(d.getTime())) eventTime = d;
    }

    try {
      await db
        .insert(containerTrackingEvents)
        .values({
          containerId,
          provider: "parcelsapp",
          eventTime,
          eventStatus: ev.status,
          eventLocation: ev.location,
          eventDescription: ev.description,
          rawEventJson: ev as any,
        })
        .onConflictDoNothing();
    } catch (err: any) {
      // Ignore individual event save failures
      console.warn("[ContainerTracking] Event save warn:", err?.message);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
