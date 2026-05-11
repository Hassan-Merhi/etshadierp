/**
 * containerTrackingService.ts — Container tracking with carrier-first provider chain.
 *
 * Provider order per carrier:
 *   MAERSK: 1. Maersk official API (if credentials set)
 *           2. Maersk public page  (if MAERSK_PUBLIC_TRACKING_ENABLED=true)
 *           3. ParcelsApp fallback (1 attempt — hint or auto)
 *   CMA:    1. CMA public page     (if CMA_PUBLIC_TRACKING_ENABLED=true)
 *           2. ParcelsApp fallback (1 attempt — hint or auto)
 *   Other:  → ParcelsApp fallback (1 attempt — auto-detect)
 *
 * Rules:
 *   - Containers with status Offloaded/Closed/Completed (any casing) are NEVER tracked.
 *   - Container number must match ^[A-Z]{4}\d{7}$ — rejects placeholders like "NO NUMBER".
 *   - ParcelsApp quota is calculated from DB (not memory) — survives server restarts.
 *   - ParcelsApp makes exactly ONE attempt per container check (carrier hint or auto).
 *   - Credentials and API keys are never logged or sent to the frontend.
 */

import { db } from "../db";
import {
  containers,
  containerTrackingEvents,
  containerTrackingChecks,
} from "../../shared/schema";
import { and, eq, isNull, or, lt, sql, inArray, gte } from "drizzle-orm";
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
import { isEnabled as isMaerskPublicEnabled } from "../lib/trackingProviders/maerskPublicProvider";
import { isEnabled as isCmaPublicEnabled } from "../lib/trackingProviders/cmaPublicProvider";
import type { CarrierTrackResult } from "../lib/trackingProviders/types";

// ── Inactive status — case-insensitive throughout ─────────────────────────────

const INACTIVE_LOWER = ["offloaded", "closed", "completed"] as const;

/** True for any casing of Offloaded / Closed / Completed. */
function isInactiveStatus(status: string): boolean {
  return INACTIVE_LOWER.includes(status.toLowerCase() as any);
}

/** Drizzle SQL fragment: WHERE LOWER(status) NOT IN ('offloaded','closed','completed') */
const activeStatusFilter = sql`LOWER(${containers.status}) NOT IN ('offloaded','closed','completed')`;

// ── Container number validation ────────────────────────────────────────────────

/**
 * ISO 6346 container number: exactly 4 uppercase letters + 7 digits.
 * Rejects: "NO NUMBER", "NO NUMBER #2", "CONT-2024-005", blanks, etc.
 */
const VALID_CONTAINER_REGEX = /^[A-Z]{4}\d{7}$/;

function isValidContainerNumber(containerNumber: string | null | undefined): boolean {
  if (!containerNumber) return false;
  return VALID_CONTAINER_REGEX.test(containerNumber.trim().toUpperCase());
}

const COOLDOWN_HOURS = 4;

// ── ParcelsApp quota — sourced from DB, not memory ───────────────────────────

/**
 * Count ParcelsApp credits used this calendar month.
 * Only rows where provider='parcelsapp' AND status IN ('success','error','timeout')
 * count as a consumed credit. Skipped/invalid rows never count.
 */
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
          gte(containerTrackingChecks.checkedAt, startOfMonth),
        ),
      );

    const used = result[0]?.count ?? 0;
    return { used, limit };
  } catch (err: any) {
    console.warn("[ContainerTracking] Could not read quota from DB:", err?.message);
    return { used: 0, limit };
  }
}

/**
 * Returns true if ParcelsApp quota is available for this month.
 * Queries the DB — accurate even after server restarts.
 */
async function checkParcelsAppQuota(): Promise<boolean> {
  const { used, limit } = await getParcelsAppUsageStats();
  return used < limit;
}

// ── Provider availability ─────────────────────────────────────────────────────

function anyProviderConfigured(): boolean {
  return (
    isMaerskConfigured() ||
    isMaerskPublicEnabled() ||
    isCmaPublicEnabled() ||
    !!process.env.PARCELSAPP_API_KEY
  );
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
 * Only selects containers where LOWER(status) NOT IN ('offloaded','closed','completed').
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
          activeStatusFilter,
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

  const eligible = rows.filter((r) => isValidContainerNumber(r.containerNumber));
  const skippedInvalid = rows.length - eligible.length;
  if (skippedInvalid > 0) {
    console.log(
      `[ContainerTracking] Skipping ${skippedInvalid} container(s) — invalid/placeholder numbers: ` +
        rows
          .filter((r) => !isValidContainerNumber(r.containerNumber))
          .map((r) => r.containerNumber)
          .join(", "),
    );
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
 * Uses case-insensitive status filter.
 */
export async function setBulkTrackingEnabled(enabled: boolean): Promise<number> {
  const result = await db
    .update(containers)
    .set({ trackingEnabled: enabled })
    .where(activeStatusFilter)
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
    .where(activeStatusFilter);

  const eligible = rows.filter((r) => isValidContainerNumber(r.containerNumber));
  if (eligible.length === 0) return 0;

  (async () => {
    const skippedInvalid = rows.length - eligible.length;
    console.log(
      `[BulkTracking] Manual run for ${eligible.length} containers` +
        (skippedInvalid > 0 ? ` (${skippedInvalid} skipped — invalid numbers)` : "") +
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
 * Rejects inactive containers with any casing of Offloaded/Closed/Completed.
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

  if (isInactiveStatus(row.status)) {
    throw new Error(
      "Tracking is disabled for offloaded/closed/completed containers.",
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

  // ── Guard: reject invalid container numbers before any API call ────────────
  if (!isValidContainerNumber(containerNumber)) {
    const errMsg = `Invalid container number format: "${containerNumber}" (must be 4 letters + 7 digits)`;
    console.log(`[ContainerTracking] ${containerNumber}: skipped — ${errMsg}`);

    await saveTrackingCheck(containerId, "skipped", "invalid_container_number", errMsg, null);
    await db
      .update(containers)
      .set({ trackingLastCheckedAt: now, trackingError: errMsg } as any)
      .where(eq(containers.id, containerId));

    return {
      success: false,
      lastStatus: null,
      lastLocation: null,
      lastDescription: null,
      lastCheckedAt: now,
      error: errMsg,
    };
  }

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

// ─── ParcelsApp fallback — single attempt per container check ──────────────────

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

  // Check monthly quota before calling ParcelsApp (DB-sourced — survives restarts)
  const quotaOk = await checkParcelsAppQuota();
  if (!quotaOk) {
    const { used, limit } = await getParcelsAppUsageStats();
    const quotaError = `ParcelsApp monthly quota exhausted (${used}/${limit})`;
    console.warn(`[ContainerTracking] ${containerNumber}: ${quotaError}`);

    await saveTrackingCheck(
      containerId,
      "skipped",
      "skipped_quota",
      quotaError,
      null,
    );

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

  // ── Single ParcelsApp attempt — carrier hint OR auto-detect ───────────────
  // One credit per container check. Never retries with alternative carriers.
  const hintCarrier =
    detectedCarrier && detectedCarrier !== "OTHER" ? detectedCarrier : undefined;

  console.log(
    `[ContainerTracking] ${containerNumber}: ParcelsApp attempt carrier=${hintCarrier ?? "auto"}`,
  );

  const result = await trackContainer(containerNumber, "United States", hintCarrier);

  await saveTrackingCheck(
    containerId,
    "parcelsapp",
    result.success ? "success" : result.timedOut ? "timeout" : "error",
    result.error ?? null,
    result.rawResponse,
  );

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
