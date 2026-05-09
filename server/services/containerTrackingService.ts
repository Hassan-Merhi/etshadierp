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
  deriveEstimatedDeliveryDate,
  type ParcelsAppShipment,
} from "../lib/parcelsAppClient";

const INACTIVE_STATUSES = ["Offloaded", "Closed", "Completed"] as const;
const INACTIVE_SET = new Set<string>(INACTIVE_STATUSES);

const COOLDOWN_HOURS = 4;

// Only track containers whose carrier is MAERSK, CMA, or MSC —
// either from a manual hint or auto-detected from the container number prefix.
const ALLOWED_CARRIERS = ["maersk", "cma", "msc"];

// Container number prefix → canonical carrier name (or "AUTO" to let ParcelsApp detect).
// First 4 letters of a standard ISO container number identify the owner/lessor.
const PREFIX_TO_CARRIER: Record<string, string> = {
  // Maersk (including Hamburg Sud subsidiary)
  MAEU: "MAERSK", MRKU: "MAERSK", MSKU: "MAERSK",
  TRHU: "MAERSK", TEMU: "MAERSK", SEAU: "MAERSK",
  SUDU: "MAERSK", HASU: "MAERSK",
  // CMA CGM (includes APL which CMA owns)
  CMAU: "CMA", CGMU: "CMA", APMU: "CMA", APHU: "CMA", CXDU: "CMA",
  CAAU: "CMA",
  // MSC
  MSCU: "MSC", MEDU: "MSC", MSDU: "MSC",
  // Leasing companies (Triton, Textainer, etc.) — let ParcelsApp auto-detect carrier
  TCNU: "AUTO", TGBU: "AUTO", ECMU: "AUTO", TXGI: "AUTO",
};

/**
 * Infer the carrier from the first 4 characters of a container number.
 * Returns the carrier name, "AUTO" (track without hint), or null (skip entirely).
 */
function detectCarrierFromNumber(containerNumber: string): string | null {
  const prefix = containerNumber.trim().toUpperCase().slice(0, 4);
  return PREFIX_TO_CARRIER[prefix] ?? null;
}

/**
 * Returns the effective carrier hint to pass to ParcelsApp, or null to skip tracking.
 * - Manual hint takes priority if it matches an allowed carrier.
 * - Falls back to auto-detection from the container number prefix.
 * - Returns undefined (not null) for "AUTO" prefixes — ParcelsApp will detect the carrier itself.
 * - Returns null if the container should not be tracked at all.
 */
function resolveCarrier(
  hint: string | null | undefined,
  containerNumber: string,
): { track: boolean; carrier: string | undefined } {
  // Manual hint wins if it's an allowed carrier
  if (hint) {
    const lower = hint.trim().toLowerCase();
    if (ALLOWED_CARRIERS.some((c) => lower.includes(c))) {
      return { track: true, carrier: hint.trim() };
    }
  }
  // Auto-detect from prefix
  const detected = detectCarrierFromNumber(containerNumber);
  if (!detected) return { track: false, carrier: undefined };
  if (detected === "AUTO") return { track: true, carrier: undefined }; // let ParcelsApp figure it out
  return { track: true, carrier: detected };
}

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

  const eligible = rows
    .map((r) => ({ ...r, resolved: resolveCarrier(r.trackingCarrierHint, r.containerNumber) }))
    .filter((r) => r.resolved.track);
  const skippedCarrier = rows.length - eligible.length;
  if (skippedCarrier > 0) {
    console.log(`[ContainerTracking] Skipping ${skippedCarrier} container(s) — unrecognised carrier/prefix.`);
  }
  console.log(`[ContainerTracking] ${eligible.length} container(s) due for tracking.`);

  for (const row of eligible) {
    try {
      await trackOneContainer(row.id, row.containerNumber, row.resolved.carrier);
      // Small delay between containers to be polite to the API
      await sleep(1_500);
    } catch (err: any) {
      console.error(`[ContainerTracking] Error tracking ${row.containerNumber}:`, err?.message);
    }
  }

  console.log("[ContainerTracking] Auto-tracking run complete.");
}

/**
 * Enable or disable auto-tracking for all non-inactive containers.
 * Returns the number of rows updated.
 */
export async function setBulkTrackingEnabled(enabled: boolean): Promise<number> {
  const result = await db
    .update(containers)
    .set({ trackingEnabled: enabled })
    .where(notInArray(containers.status, [...INACTIVE_STATUSES]))
    .returning({ id: containers.id });
  return result.length;
}

/**
 * Immediately trigger tracking for every non-inactive container.
 * Bypasses the normal 4-hour cooldown and ignores the trackingEnabled flag —
 * "Track All Now" is an explicit manual override that covers all active containers.
 * Starts tracking in the background and returns the count right away.
 */
export async function trackAllEnabledNow(): Promise<number> {
  if (!process.env.PARCELSAPP_API_KEY) return 0;

  const rows = await db
    .select({
      id: containers.id,
      containerNumber: containers.containerNumber,
      trackingCarrierHint: containers.trackingCarrierHint,
    })
    .from(containers)
    .where(
      notInArray(containers.status, [...INACTIVE_STATUSES]),
    );

  const eligible = rows
    .map((r) => ({ ...r, resolved: resolveCarrier(r.trackingCarrierHint, r.containerNumber) }))
    .filter((r) => r.resolved.track);

  if (eligible.length === 0) return 0;

  // Fire and forget — caller gets the count back immediately
  (async () => {
    const skipped = rows.length - eligible.length;
    console.log(`[BulkTracking] Starting manual run for ${eligible.length} containers (${skipped} skipped — unrecognised carrier/prefix)…`);
    for (const row of eligible) {
      try {
        await trackOneContainer(row.id, row.containerNumber, row.resolved.carrier);
        await sleep(2_000);
      } catch (err: any) {
        console.error(`[BulkTracking] Error tracking ${row.containerNumber}:`, err?.message);
      }
    }
    console.log(`[BulkTracking] Manual run complete for ${eligible.length} containers.`);
  })().catch((err: any) => console.error("[BulkTracking] Unexpected error:", err?.message));

  return eligible.length;
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
  // destinationCountry stays as "United States" (ParcelsApp default).
  // carrierHint is passed as the separate `carrier` field — NOT as destinationCountry.
  const result = await trackContainer(containerNumber, "United States", carrierHint);

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
  const estimatedDeliveryDate = deriveEstimatedDeliveryDate(shipment);

  // Log full attributes so we can see exactly what ParcelsApp returned
  console.log(
    `[ContainerTracking] ${containerNumber} raw attributes:`,
    JSON.stringify(shipment.attributes ?? {}),
  );

  // Save events
  await saveTrackingEvents(containerId, shipment);

  // Build the update — always update read-only tracking display fields;
  // update eta and location when the API provides them.
  const updateSet: Record<string, unknown> = {
    trackingLastCheckedAt: now,
    trackingLastStatus: lastStatus,
    trackingLastLocation: lastLocation,
    trackingLastEventDate: lastEventDate,
    trackingLastDescription: lastDescription,
    trackingError: null,
    trackingChangedAt: now,
  };

  if (estimatedDeliveryDate) {
    updateSet.eta = estimatedDeliveryDate;
    updateSet.etaSource = "api";
  }

  // Update container tracking fields
  await db
    .update(containers)
    .set(updateSet as any)
    .where(eq(containers.id, containerId));

  console.log(
    `[ContainerTracking] ${containerNumber} → status: ${lastStatus ?? "unknown"}, location: ${lastLocation ?? "unknown"}, eta: ${estimatedDeliveryDate ?? "not provided"}`,
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
