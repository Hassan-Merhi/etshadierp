/**
 * containerTrackingService.ts — Container tracking with carrier-first provider chain.
 *
 * Provider order:
 *   1. Maersk direct API (if MAERSK_CONSUMER_KEY + MAERSK_CONSUMER_SECRET set)
 *   2. CMA CGM direct API (stub — ready for CMACGM_API_KEY when obtained)
 *   3. ParcelsApp fallback (always available when PARCELSAPP_API_KEY set)
 *
 * Rules:
 *   - NEVER overwrite status when current status is Offloaded, Closed, or Completed.
 *   - Manual status always wins over API status.
 *   - tracking_enabled must be true for auto-tracking.
 *   - Minimum 4-hour cooldown between automatic checks per container.
 *   - Credentials are never logged or sent to the frontend.
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
import { resolveProvider } from "../lib/trackingProviders/providerResolver";
import { isConfigured as isMaerskConfigured } from "../lib/trackingProviders/maerskProvider";
import type { CarrierTrackResult } from "../lib/trackingProviders/types";

const INACTIVE_STATUSES = ["Offloaded", "Closed", "Completed"] as const;
const INACTIVE_SET = new Set<string>(INACTIVE_STATUSES);

const COOLDOWN_HOURS = 4;

// Minimum length a real ISO container number must have.
// Anything shorter is a placeholder like "NB NUMBER".
const MIN_CONTAINER_NUMBER_LENGTH = 9;

/** Returns true if at least one tracking provider is configured. */
function anyProviderConfigured(): boolean {
  return isMaerskConfigured() || !!process.env.PARCELSAPP_API_KEY;
}

/** Returns true if this container number looks like a real ISO number worth tracking. */
function isTrackableNumber(containerNumber: string): boolean {
  return containerNumber.trim().length >= MIN_CONTAINER_NUMBER_LENGTH;
}

// ─── Public entry points ───────────────────────────────────────────────────────

/**
 * Track all due containers — called by the scheduler every 6 hours.
 */
export async function trackDueContainers(): Promise<void> {
  console.log("[ContainerTracking] Starting auto-tracking run...");

  if (!anyProviderConfigured()) {
    console.log("[ContainerTracking] No tracking providers configured — skipping.");
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

  const eligible = rows.filter((r) => isTrackableNumber(r.containerNumber));
  const skipped = rows.length - eligible.length;
  if (skipped > 0) {
    console.log(`[ContainerTracking] Skipping ${skipped} container(s) — placeholder numbers.`);
  }
  console.log(`[ContainerTracking] ${eligible.length} container(s) due for tracking.`);

  for (const row of eligible) {
    try {
      await trackOneContainer(row.id, row.containerNumber, row.trackingCarrierHint ?? undefined);
      await sleep(1_500);
    } catch (err: any) {
      console.error(`[ContainerTracking] Error tracking ${row.containerNumber}:`, err?.message);
    }
  }

  console.log("[ContainerTracking] Auto-tracking run complete.");
}

/**
 * Enable or disable auto-tracking for all non-inactive containers.
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
 * Bypasses cooldown and trackingEnabled flag — explicit manual override.
 * Starts tracking in the background and returns the count immediately.
 */
export async function trackAllEnabledNow(): Promise<number> {
  if (!anyProviderConfigured()) return 0;

  const rows = await db
    .select({
      id: containers.id,
      containerNumber: containers.containerNumber,
      trackingCarrierHint: containers.trackingCarrierHint,
    })
    .from(containers)
    .where(notInArray(containers.status, [...INACTIVE_STATUSES]));

  const eligible = rows.filter((r) => isTrackableNumber(r.containerNumber));
  if (eligible.length === 0) return 0;

  (async () => {
    const skipped = rows.length - eligible.length;
    console.log(
      `[BulkTracking] Manual run for ${eligible.length} containers` +
        (skipped > 0 ? ` (${skipped} skipped — placeholder numbers)` : "") +
        "…",
    );
    for (const row of eligible) {
      try {
        await trackOneContainer(row.id, row.containerNumber, row.trackingCarrierHint ?? undefined);
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

// ─── Internal implementation ───────────────────────────────────────────────────

async function trackOneContainer(
  containerId: number,
  containerNumber: string,
  _carrierHintUnused?: string,
): Promise<{
  success: boolean;
  lastStatus: string | null;
  lastLocation: string | null;
  lastDescription: string | null;
  lastCheckedAt: Date;
  error: string | null;
}> {
  const now = new Date();
  const { detectedCarrier, tryDirect } = resolveProvider(containerNumber);

  // ── Step 1: attempt direct carrier API ──────────────────────────────────────
  if (tryDirect) {
    const directResult = await tryDirect();

    if (directResult.success) {
      await saveDirectEvents(containerId, directResult);
      await saveTrackingCheck(containerId, directResult.provider, "success", null, directResult.raw);

      const updateSet: Record<string, unknown> = {
        trackingLastCheckedAt: now,
        trackingLastStatus: directResult.latestStatus,
        trackingLastEventDate: directResult.latestEventDate,
        trackingLastDescription: directResult.latestDescription,
        trackingError: null,
        trackingChangedAt: now,
        trackingProvider: directResult.provider,
        trackingDetectedCarrier: detectedCarrier,
        trackingFallbackUsed: false,
        trackingFallbackReason: null,
      };

      if (directResult.eta) {
        updateSet.eta = directResult.eta;
        updateSet.etaSource = "api";
      }

      await db.update(containers).set(updateSet as any).where(eq(containers.id, containerId));

      console.log(
        `[ContainerTracking] ${containerNumber} → ${directResult.provider}: ` +
          `status=${directResult.latestStatus ?? "?"} eta=${directResult.eta ?? "none"}`,
      );

      return {
        success: true,
        lastStatus: directResult.latestStatus,
        lastLocation: directResult.latestLocation,
        lastDescription: directResult.latestDescription,
        lastCheckedAt: now,
        error: null,
      };
    }

    // Direct provider failed — note why and fall through to ParcelsApp
    const directError = directResult.notConfigured
      ? `${directResult.provider}_not_configured`
      : `${directResult.provider}_api_error`;

    await saveTrackingCheck(
      containerId,
      directResult.provider,
      "error",
      directResult.error ?? directError,
      null,
    );

    console.log(
      `[ContainerTracking] ${containerNumber}: ${directResult.provider} failed (${directResult.error}) — falling back to ParcelsApp`,
    );

    // Fall through to ParcelsApp below, tagging the fallback reason
    return await trackViaParcelsApp(
      containerId,
      containerNumber,
      detectedCarrier,
      directError,
      now,
    );
  }

  // ── Step 2: no direct provider — use ParcelsApp directly ──────────────────
  return await trackViaParcelsApp(containerId, containerNumber, detectedCarrier, null, now);
}

// ─── ParcelsApp fallback ───────────────────────────────────────────────────────

// Canonical carriers tried as fallbacks (order matters — most common first)
const FALLBACK_CARRIERS = ["MAERSK", "MSC", "CMA"];

async function trackViaParcelsApp(
  containerId: number,
  containerNumber: string,
  detectedCarrier: string | null,
  fallbackReason: string | null,
  now: Date,
): Promise<{
  success: boolean;
  lastStatus: string | null;
  lastLocation: string | null;
  lastDescription: string | null;
  lastCheckedAt: Date;
  error: string | null;
}> {
  if (!process.env.PARCELSAPP_API_KEY) {
    await db
      .update(containers)
      .set({
        trackingLastCheckedAt: now,
        trackingError: "No tracking provider configured",
        trackingDetectedCarrier: detectedCarrier,
        trackingFallbackUsed: !!fallbackReason,
        trackingFallbackReason: fallbackReason,
      } as any)
      .where(eq(containers.id, containerId));

    return {
      success: false,
      lastStatus: null,
      lastLocation: null,
      lastDescription: null,
      lastCheckedAt: now,
      error: "No tracking provider configured",
    };
  }

  // Determine carrier hint for ParcelsApp.
  // Maersk/CMA detected → pass carrier name so ParcelsApp knows where to look.
  // Leasing / unknown → let ParcelsApp auto-detect.
  const hintCarrier =
    detectedCarrier && detectedCarrier !== "OTHER" ? detectedCarrier : undefined;

  const attempts: Array<string | undefined> = [];
  if (hintCarrier) attempts.push(hintCarrier);
  for (const fb of FALLBACK_CARRIERS) {
    if (!hintCarrier || fb.toLowerCase() !== hintCarrier.toLowerCase()) {
      attempts.push(fb);
    }
  }
  attempts.push(undefined); // final: no hint, ParcelsApp auto-detect

  let lastResult: Awaited<ReturnType<typeof trackContainer>> | null = null;

  for (let i = 0; i < attempts.length; i++) {
    const carrier = attempts[i];
    if (i > 0) {
      await sleep(3_000);
      console.log(
        `[ContainerTracking] ${containerNumber}: ParcelsApp retry carrier=${carrier ?? "auto"}…`,
      );
    }

    const result = await trackContainer(containerNumber, "United States", carrier);
    lastResult = result;

    await saveTrackingCheck(
      containerId,
      "parcelsapp",
      result.success ? "success" : result.timedOut ? "timeout" : "error",
      result.error ?? null,
      result.rawResponse,
    );

    if (result.success && result.shipment) {
      if (i > 0) {
        console.log(
          `[ContainerTracking] ${containerNumber}: ParcelsApp succeeded on carrier=${carrier ?? "auto"}`,
        );
      }
      break;
    }
  }

  const result = lastResult!;

  if (!result.success || !result.shipment) {
    await db
      .update(containers)
      .set({
        trackingLastCheckedAt: now,
        trackingError: result.error ?? "Tracking failed",
        trackingProvider: "parcelsapp",
        trackingDetectedCarrier: detectedCarrier,
        trackingFallbackUsed: !!fallbackReason,
        trackingFallbackReason: fallbackReason,
      } as any)
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

  console.log(
    `[ContainerTracking] ${containerNumber} raw attributes:`,
    JSON.stringify(shipment.attributes ?? {}),
  );

  await saveParcelsAppEvents(containerId, shipment);

  const updateSet: Record<string, unknown> = {
    trackingLastCheckedAt: now,
    trackingLastStatus: lastStatus,
    trackingLastEventDate: lastEventDate,
    trackingLastDescription: lastDescription,
    trackingError: null,
    trackingChangedAt: now,
    trackingProvider: "parcelsapp",
    trackingDetectedCarrier: detectedCarrier,
    trackingFallbackUsed: !!fallbackReason,
    trackingFallbackReason: fallbackReason,
  };

  if (estimatedDeliveryDate) {
    updateSet.eta = estimatedDeliveryDate;
    updateSet.etaSource = "api";
  }

  await db.update(containers).set(updateSet as any).where(eq(containers.id, containerId));

  console.log(
    `[ContainerTracking] ${containerNumber} → parcelsapp: ` +
      `status=${lastStatus ?? "?"} location=${lastLocation ?? "?"} eta=${estimatedDeliveryDate ?? "none"}`,
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

// ─── Event persistence ─────────────────────────────────────────────────────────

async function saveDirectEvents(
  containerId: number,
  result: CarrierTrackResult,
): Promise<void> {
  if (result.events.length === 0) return;

  for (const ev of result.events) {
    try {
      await db
        .insert(containerTrackingEvents)
        .values({
          containerId,
          provider: result.provider,
          eventTime: ev.date,
          eventStatus: ev.status,
          eventLocation: ev.location,
          eventDescription: ev.description,
          rawEventJson: { provider: result.provider, ...ev } as any,
        })
        .onConflictDoNothing();
    } catch (err: any) {
      console.warn("[ContainerTracking] Direct event save warn:", err?.message);
    }
  }
}

async function saveParcelsAppEvents(
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
      console.warn("[ContainerTracking] ParcelsApp event save warn:", err?.message);
    }
  }
}

async function saveTrackingCheck(
  containerId: number,
  provider: string,
  status: string,
  errorMessage: string | null,
  rawResponse: unknown,
): Promise<void> {
  try {
    await db.insert(containerTrackingChecks).values({
      containerId,
      provider,
      status,
      checkedAt: new Date(),
      errorMessage,
      rawResponseJson: rawResponse as any,
    });
  } catch (err: any) {
    console.warn("[ContainerTracking] Check record save warn:", err?.message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
