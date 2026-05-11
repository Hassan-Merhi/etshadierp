/**
 * containerTrackingService.ts — Container tracking with smart priority scheduler.
 *
 * Scheduler (every 6 hours):
 *   - Scores every active container by priority (High/Medium/Low).
 *   - Applies per-priority cooldown intervals (24h / 48h / 72-120h).
 *   - Caps each run to a per-run budget derived from remaining monthly quota.
 *   - Saves skip records (skipped_recent, skipped_priority_budget, etc.) so the
 *     UI can explain why a container was not checked.
 *   - Skip records NEVER count against ParcelsApp quota.
 *
 * Provider order per carrier:
 *   MAERSK: 1. Maersk official API (if credentials set)
 *           2. Maersk public page  (if MAERSK_PUBLIC_TRACKING_ENABLED=true)
 *           3. ParcelsApp fallback (1 attempt — hint or auto)
 *   CMA:    1. CMA public page     (if CMA_PUBLIC_TRACKING_ENABLED=true)
 *           2. ParcelsApp fallback (1 attempt — hint or auto)
 *   Other:  → ParcelsApp (1 attempt — auto-detect)
 *
 * Rules:
 *   - Offloaded/Closed/Completed (any casing) are NEVER tracked.
 *   - Container number must match ^[A-Z]{4}\d{7}$.
 *   - ParcelsApp quota is calculated from DB — survives server restarts.
 *   - ParcelsApp makes exactly ONE attempt per container check.
 */

import { db } from "../db";
import {
  containers,
  containerTrackingEvents,
  containerTrackingChecks,
} from "../../shared/schema";
import { and, eq, inArray, gte, sql } from "drizzle-orm";
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
import {
  getTrackingPriority,
  calcPerRunBudget,
} from "../lib/trackingPriority";
import {
  calcMaxOffloadDate,
  calcIsOverdue,
  calcDocsReadyNotSent,
} from "../lib/gitHelpers";

// ── Inactive status — case-insensitive throughout ─────────────────────────────

const INACTIVE_LOWER = ["offloaded", "closed", "completed"] as const;

function isInactiveStatus(status: string): boolean {
  return INACTIVE_LOWER.includes(status.toLowerCase() as any);
}

const activeStatusFilter = sql`LOWER(${containers.status}) NOT IN ('offloaded','closed','completed')`;

// ── Container number validation ───────────────────────────────────────────────

const VALID_CONTAINER_REGEX = /^[A-Z]{4}\d{7}$/;

function isValidContainerNumber(containerNumber: string | null | undefined): boolean {
  if (!containerNumber) return false;
  return VALID_CONTAINER_REGEX.test(containerNumber.trim().toUpperCase());
}

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

// ── Scheduler metadata helper ─────────────────────────────────────────────────

/**
 * Updates tracking_last_skip_reason and optionally tracking_next_check_at.
 * Pass nextCheckAt=undefined to leave that column unchanged.
 */
async function setSchedulerMeta(
  containerId: number,
  skipReason: string | null,
  nextCheckAt: Date | null | undefined,
): Promise<void> {
  try {
    const patch: Record<string, unknown> = { trackingLastSkipReason: skipReason };
    if (nextCheckAt !== undefined) patch.trackingNextCheckAt = nextCheckAt;
    await db.update(containers).set(patch as any).where(eq(containers.id, containerId));
  } catch (err: any) {
    console.warn("[ContainerTracking] setSchedulerMeta warn:", err?.message);
  }
}

// ─── Public entry points ───────────────────────────────────────────────────────

/**
 * Smart priority scheduler — called every 6 hours.
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
export async function trackDueContainers(): Promise<void> {
  console.log("[ContainerTracking] Starting smart priority scheduler run...");

  if (!anyProviderConfigured()) {
    console.log("[ContainerTracking] No tracking providers configured — skipping.");
    return;
  }

  const now = new Date();

  // ── Quota and per-run budget ───────────────────────────────────────────────
  const { used, limit } = await getParcelsAppUsageStats();
  const remaining = Math.max(0, limit - used);
  const { remainingDays, dailyBudget, perRunBudget } = calcPerRunBudget(remaining, now);

  console.log(
    `[ContainerTracking] Quota: ${used}/${limit} used (${remaining} remaining). ` +
    `Budget: ${perRunBudget}/run (${dailyBudget}/day, ${remainingDays} days left in month).`,
  );

  // ── Fetch all active tracking-enabled containers ───────────────────────────
  let allRows: Array<{
    id: number;
    containerNumber: string;
    status: string;
    eta: string | null;
    trackingCarrierHint: string | null;
    trackingAutoUpdate: boolean;
    trackingLastCheckedAt: Date | null;
    trackingChangedAt: Date | null;
    numberPlate: string | null;
    borderDate: string | null;
    transporter: string | null;
    docReceived: boolean | null;
    docsSentDate: string | null;
  }>;

  try {
    allRows = await db
      .select({
        id: containers.id,
        containerNumber: containers.containerNumber,
        status: containers.status,
        eta: containers.eta,
        trackingCarrierHint: containers.trackingCarrierHint,
        trackingAutoUpdate: containers.trackingAutoUpdate,
        trackingLastCheckedAt: containers.trackingLastCheckedAt,
        trackingChangedAt: containers.trackingChangedAt,
        numberPlate: containers.numberPlate,
        borderDate: containers.borderDate,
        transporter: containers.transporter,
        docReceived: containers.docReceived,
        docsSentDate: containers.docsSentDate,
      })
      .from(containers)
      .where(and(eq(containers.trackingEnabled, true), activeStatusFilter));
  } catch (err: any) {
    console.error("[ContainerTracking] Failed to fetch containers:", err?.message);
    return;
  }

  if (allRows.length === 0) {
    console.log("[ContainerTracking] No active tracking-enabled containers.");
    return;
  }

  console.log(`[ContainerTracking] ${allRows.length} active tracking-enabled containers found.`);

  // ── Classify each container ────────────────────────────────────────────────
  const eligible: Array<{
    row: (typeof allRows)[0];
    priority: ReturnType<typeof getTrackingPriority>;
  }> = [];

  let countInvalid = 0;
  let countDisabled = 0;
  let countRecent = 0;

  for (const row of allRows) {
    // 1. Validate container number
    if (!isValidContainerNumber(row.containerNumber)) {
      countInvalid++;
      await saveTrackingCheck(
        row.id,
        "skipped",
        "invalid_container_number",
        `Invalid container number: "${row.containerNumber}" (must be 4 letters + 7 digits)`,
        null,
      );
      await setSchedulerMeta(row.id, "invalid_container_number", null);
      continue;
    }

    // 2. Auto-update must be enabled
    if (!row.trackingAutoUpdate) {
      countDisabled++;
      await setSchedulerMeta(row.id, "skipped_disabled", undefined);
      continue;
    }

    // 3. Compute priority using enriched fields
    const maxOffloadDate = calcMaxOffloadDate(row.borderDate, row.transporter);
    const isOverdue = calcIsOverdue(maxOffloadDate, row.status);
    const docsReadyNotSent = calcDocsReadyNotSent(row.docReceived, row.docsSentDate);

    const priority = getTrackingPriority(
      {
        status: row.status,
        eta: row.eta,
        isOverdue,
        docsReadyNotSent,
        numberPlate: row.numberPlate,
        trackingLastCheckedAt: row.trackingLastCheckedAt,
        trackingChangedAt: row.trackingChangedAt,
      },
      now,
    );

    // 4. Cooldown: skip if checked too recently for this priority tier
    if (row.trackingLastCheckedAt) {
      const minIntervalMs = priority.minimumIntervalHours * 60 * 60 * 1000;
      const elapsed = now.getTime() - row.trackingLastCheckedAt.getTime();
      if (elapsed < minIntervalMs) {
        countRecent++;
        const nextCheckAt = new Date(row.trackingLastCheckedAt.getTime() + minIntervalMs);
        const msg =
          `Checked too recently (${priority.priorityLabel} priority — interval ${priority.minimumIntervalHours}h); ` +
          `next recommended check at ${nextCheckAt.toISOString()}`;
        await saveTrackingCheck(row.id, "skipped", "skipped_recent", msg, null);
        await setSchedulerMeta(row.id, "skipped_recent", nextCheckAt);
        continue;
      }
    }

    eligible.push({ row, priority });
  }

  if (eligible.length === 0) {
    console.log(
      `[ContainerTracking] No containers eligible this run ` +
      `(invalid=${countInvalid}, auto_update_off=${countDisabled}, checked_recently=${countRecent}).`,
    );
    return;
  }

  // ── Sort: highest priority first, then oldest checked, then ETA nearest ───
  eligible.sort((a, b) => {
    if (b.priority.priorityScore !== a.priority.priorityScore) {
      return b.priority.priorityScore - a.priority.priorityScore;
    }
    // Oldest checked first (never-checked = 0 = highest urgency among equals)
    const aTime = a.row.trackingLastCheckedAt?.getTime() ?? 0;
    const bTime = b.row.trackingLastCheckedAt?.getTime() ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    // ETA nearest first
    const aEta = a.row.eta ? new Date(a.row.eta).getTime() : Infinity;
    const bEta = b.row.eta ? new Date(b.row.eta).getTime() : Infinity;
    return aEta - bEta;
  });

  // ── Apply per-run budget ───────────────────────────────────────────────────
  const toTrack = eligible.slice(0, perRunBudget);
  const budgetSkipped = eligible.slice(perRunBudget);

  // Save skip records for containers that didn't make the budget cut
  for (const { row } of budgetSkipped) {
    await saveTrackingCheck(
      row.id,
      "skipped",
      "skipped_priority_budget",
      "Skipped because lower priority this run",
      null,
    );
    await setSchedulerMeta(row.id, "skipped_priority_budget", undefined);
  }

  console.log(
    `[ContainerTracking] Eligible: ${eligible.length}, ` +
    `tracking: ${toTrack.length}, ` +
    `budget-skipped: ${budgetSkipped.length}, ` +
    `recent: ${countRecent}, invalid: ${countInvalid}, disabled: ${countDisabled}.`,
  );

  if (toTrack.length > 0) {
    console.log(
      `[ContainerTracking] Tracking: ` +
      toTrack
        .map(
          ({ row, priority }) =>
            `${row.containerNumber}(${priority.priorityLabel}/${priority.priorityScore})`,
        )
        .join(", "),
    );
  }

  // ── Track each container in the budget window ───────────────────────────────
  for (const { row, priority } of toTrack) {
    try {
      await trackOneContainer(row.id, row.containerNumber, row.trackingCarrierHint ?? undefined);
      // Clear skip reason; record when the scheduler plans to check again
      await setSchedulerMeta(row.id, null, priority.nextRecommendedCheckAt);
    } catch (err: any) {
      console.error(`[ContainerTracking] Error tracking ${row.containerNumber}:`, err?.message);
    }
    await sleep(1_500);
  }

  console.log("[ContainerTracking] Smart priority scheduler run complete.");
}

/**
 * Enable or disable auto-tracking for all non-inactive containers.
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
    console.log(
      `[BulkTracking] Starting manual run for ${eligible.length} container(s): ` +
        eligible.map((r) => r.containerNumber).slice(0, 5).join(", ") +
        (eligible.length > 5 ? "…" : ""),
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
 *
 * Rejects:
 *   - inactive containers (any casing of Offloaded/Closed/Completed)
 *   - exhausted ParcelsApp quota (when ParcelsApp would be the only provider)
 *
 * Allows with warning if quota is low but remaining > 0.
 */
export async function trackOneContainerById(containerId: number): Promise<{
  success: boolean;
  lastStatus: string | null;
  lastLocation: string | null;
  lastDescription: string | null;
  lastCheckedAt: Date;
  error: string | null;
  quotaWarning?: string;
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
    throw new Error("Tracking is disabled for offloaded/closed/completed containers.");
  }

  // Check quota and add warning when quota is low (< 10%)
  const { used, limit } = await getParcelsAppUsageStats();
  const remaining = Math.max(0, limit - used);
  let quotaWarning: string | undefined;

  if (remaining === 0 && !isMaerskConfigured() && !isMaerskPublicEnabled() && !isCmaPublicEnabled()) {
    throw new Error(`ParcelsApp monthly quota exhausted (${used}/${limit}). Track Now is blocked until next month.`);
  }

  if (remaining > 0 && remaining <= Math.ceil(limit * 0.1)) {
    quotaWarning = `ParcelsApp quota is low — ${remaining} of ${limit} credits remaining this month.`;
  }

  const result = await trackOneContainer(row.id, row.containerNumber, row.trackingCarrierHint ?? undefined);
  // Manual track: clear skip reason, set next check based on 24h (manual always implies high attention)
  await setSchedulerMeta(row.id, null, new Date(Date.now() + 24 * 60 * 60 * 1000));

  return { ...result, quotaWarning };
}

// ─── Internal tracking implementation ─────────────────────────────────────────

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

  // Guard: reject invalid container numbers before any API call
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

// ─── ParcelsApp fallback — single attempt per container check ─────────────────

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

    await saveTrackingCheck(containerId, "skipped", "skipped_quota", quotaError, null);

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
