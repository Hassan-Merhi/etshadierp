/**
 * containerTrackingService.ts — Container tracking with carrier-first provider chain.
 *
 * Provider order per carrier:
 *   MAERSK: 1. Maersk official API (if credentials set)
 *           2. Maersk public page  (if MAERSK_PUBLIC_TRACKING_ENABLED=true)
 *           3. ParcelsApp fallback
 *   CMA:    1. CMA public page     (if CMA_PUBLIC_TRACKING_ENABLED=true)
 *           2. ParcelsApp fallback
 *   Other:  → ParcelsApp fallback only
 *
 * Rules:
 *   - NEVER overwrite status when current status is Offloaded, Closed, or Completed.
 *   - Manual status always wins over API status.
 *   - tracking_enabled must be true for auto-tracking.
 *   - Minimum 4-hour cooldown between automatic checks per container.
 *   - Credentials and API keys are never logged or sent to the frontend.
 *   - ParcelsApp monthly quota (PARCELSAPP_MONTHLY_LIMIT, default 500) is enforced.
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
import { resolveProvider, anyDirectProviderPossible } from "../lib/trackingProviders/providerResolver";
import { isConfigured as isMaerskConfigured } from "../lib/trackingProviders/maerskProvider";
import { isEnabled as isMaerskPublicEnabled } from "../lib/trackingProviders/maerskPublicProvider";
import { isEnabled as isCmaPublicEnabled } from "../lib/trackingProviders/cmaPublicProvider";
import type { CarrierTrackResult } from "../lib/trackingProviders/types";

const INACTIVE_STATUSES = ["Offloaded", "Closed", "Completed"] as const;
const INACTIVE_SET = new Set<string>(INACTIVE_STATUSES);

const COOLDOWN_HOURS = 4;
const MIN_CONTAINER_NUMBER_LENGTH = 9;

// ── ParcelsApp monthly quota tracking ────────────────────────────────────────

let _parcelsAppUsageThisMonth = 0;
let _parcelsAppMonthKey = "";

function getParcelsMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Increments usage counter and returns true if still within quota. */
function consumeParcelsAppQuota(): boolean {
  const key = getParcelsMonthKey();
  if (key !== _parcelsAppMonthKey) {
    _parcelsAppMonthKey = key;
    _parcelsAppUsageThisMonth = 0;
  }
  const limit = Math.max(1, parseInt(process.env.PARCELSAPP_MONTHLY_LIMIT ?? "500") || 500);
  if (_parcelsAppUsageThisMonth >= limit) return false;
  _parcelsAppUsageThisMonth++;
  return true;
}

/** Expose current usage stats for the status endpoint (no keys, counts only). */
export function getParcelsAppUsageStats(): { used: number; limit: number } {
  const key = getParcelsMonthKey();
  if (key !== _parcelsAppMonthKey) {
    _parcelsAppMonthKey = key;
    _parcelsAppUsageThisMonth = 0;
  }
  const limit = Math.max(1, parseInt(process.env.PARCELSAPP_MONTHLY_LIMIT ?? "500") || 500);
  return { used: _parcelsAppUsageThisMonth, limit };
}

// ── Provider availability ─────────────────────────────────────────────────────

/** Returns true if at least one tracking provider is configured or enabled. */
function anyProviderConfigured(): boolean {
  return (
    isMaerskConfigured() ||
    isMaerskPublicEnabled() ||
    isCmaPublicEnabled() ||
    !!process.env.PARCELSAPP_API_KEY
  );
}

/** Returns true if this container number looks like a real ISO number worth tracking. */
function isTrackableNumber(containerNumber: string): boolean {
  return containerNumber.trim().length >= MIN_CONTAINER_NUMBER_LENGTH;
}

// ── Fallback reason derivation ────────────────────────────────────────────────

function deriveFallbackReason(result: CarrierTrackResult): string {
  const p = result.provider;
  if (result.notConfigured) return `${p}_not_configured`;
  if (result.blocked)       return `${p}_blocked`;
  if (result.noData)        return `${p}_no_data`;
  return `${p}_error`;
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

  // ── Step 1: attempt each direct provider in order ──────────────────────────
  let lastDirectFallbackReason: string | null = null;

  for (const attempt of tryDirect) {
    const result = await attempt();

    if (result.success) {
      await saveDirectEvents(containerId, result);
      await saveTrackingCheck(containerId, result.provider, "success", null, result.raw);

      const updateSet: Record<string, unknown> = {
        trackingLastCheckedAt: now,
        trackingLastStatus: result.latestStatus,
        trackingLastEventDate: result.latestEventDate,
        trackingLastDescription: result.latestDescription,
        trackingError: null,
        trackingChangedAt: now,
        trackingProvider: result.provider,
        trackingDetectedCarrier: detectedCarrier,
        trackingFallbackUsed: false,
        trackingFallbackReason: null,
      };

      if (result.eta) {
        updateSet.eta = result.eta;
        updateSet.etaSource = "api";
      }

      await db.update(containers).set(updateSet as any).where(eq(containers.id, containerId));

      console.log(
        `[ContainerTracking] ${containerNumber} → ${result.provider}: ` +
          `status=${result.latestStatus ?? "?"} eta=${result.eta ?? "none"}`,
      );

      return {
        success: true,
        lastStatus: result.latestStatus,
        lastLocation: result.latestLocation,
        lastDescription: result.latestDescription,
        lastCheckedAt: now,
        error: null,
      };
    }

    // This direct provider failed — record why and try the next one
    const reason = deriveFallbackReason(result);
    const checkStatus = result.blocked ? "blocked" : result.noData ? "no_data" : "error";

    await saveTrackingCheck(
      containerId,
      result.provider,
      checkStatus,
      result.error ?? reason,
      null,
    );

    console.log(
      `[ContainerTracking] ${containerNumber}: ${result.provider} failed (${reason}) — trying next provider`,
    );

    lastDirectFallbackReason = reason;
  }

  // ── Step 2: all direct providers exhausted — use ParcelsApp fallback ───────
  return await trackViaParcelsApp(
    containerId,
    containerNumber,
    detectedCarrier,
    lastDirectFallbackReason,
    now,
  );
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

  // Check monthly quota before calling ParcelsApp
  if (!consumeParcelsAppQuota()) {
    const { used, limit } = getParcelsAppUsageStats();
    const quotaError = `ParcelsApp monthly quota exhausted (${used}/${limit})`;
    console.warn(`[ContainerTracking] ${containerNumber}: ${quotaError}`);

    await db
      .update(containers)
      .set({
        trackingLastCheckedAt: now,
        trackingError: quotaError,
        trackingDetectedCarrier: detectedCarrier,
        trackingFallbackUsed: !!fallbackReason,
        trackingFallbackReason: fallbackReason ?? "parcelsapp_quota_exhausted",
      } as any)
      .where(eq(containers.id, containerId));

    return {
      success: false,
      lastStatus: null,
      lastLocation: null,
      lastDescription: null,
      lastCheckedAt: now,
      error: quotaError,
    };
  }

  // Determine carrier hint for ParcelsApp.
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
