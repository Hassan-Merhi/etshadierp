/**
 * containerTrackingService.ts — Container tracking with smart priority scheduler.
 *
 * Scheduler (every Tuesday at 8:00 AM EST):
 *   - Scores every active container by priority (High/Medium/Low).
 *   - Applies per-priority cooldown intervals (24h / 48h / 72-120h).
 *   - Caps each run to a per-run budget derived from remaining monthly quota.
 *   - Saves skip records (skipped_recent, skipped_priority_budget, etc.) so the
 *     UI can explain why a container was not checked.
 *   - Skip records NEVER count against ParcelsApp quota.
 *
 * Provider order per carrier:
 *   MAERSK   → http_scraper (fast-fail) → maersk_direct (Puppeteer, if available) → maersk_public (HTTP, always available) → parcelsapp
 *   CMA      → http_scraper (fast-fail, no network) → cma_public (if enabled) → 17track (if configured) → parcelsapp_scraper (Puppeteer, free) → parcelsapp API
 *   MSC      → http_scraper (direct MSC API)        → parcelsapp_scraper → 17track → parcelsapp API
 *   HAPAG    → http_scraper (direct Hapag API)      → parcelsapp_scraper → 17track → parcelsapp API
 *   COSCO    → http_scraper (direct COSCO API)      → parcelsapp_scraper → 17track → parcelsapp API
 *   EVERGREEN→ http_scraper (direct Evergreen API)  → parcelsapp_scraper → 17track → parcelsapp API
 *   Others   → http_scraper (ParcelsApp page HTML)  → parcelsapp_scraper → 17track → parcelsapp API
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
import { and, eq, inArray, gte, sql, desc, isNotNull, isNull } from "drizzle-orm";
import {
  trackContainer,
  normaliseEvents,
  deriveLastStatus,
  deriveLastLocation,
  deriveLastEventDate,
  deriveEstimatedDeliveryDate,
  type ParcelsAppShipment,
} from "../lib/parcelsAppClient";
import { scrapeTracking, isScraperAvailable } from "../lib/parcelsAppScraper";
import { httpScrapeTracking, isHttpScraperAvailable } from "../lib/httpTrackingScraper";
import { scrapeMaerskDirect, isMaerskDirectScraperAvailable } from "../lib/maerskDirectScraper";
import * as maerskPublicProvider from "../lib/trackingProviders/maerskPublicProvider";
import * as seventeenTrack from "../lib/trackingProviders/seventeenTrackProvider";
import * as cmaPublicProvider from "../lib/trackingProviders/cmaPublicProvider";
import * as cmaCgmApiProvider from "../lib/trackingProviders/cmaCgmApiProvider";
import { resolveProvider } from "../lib/trackingProviders/providerResolver";
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

// ── Live tracking progress — in-memory, keyed by container ID ────────────────

export type ProgressStep = {
  label: string;
  status: "running" | "success" | "fail" | "skip" | "blocked";
  detail: string | null;
  ts: number;
};

const _progressStore = new Map<number, ProgressStep[]>();

export function getTrackingProgress(containerId: number): ProgressStep[] {
  return _progressStore.get(containerId) ?? [];
}

export function initTrackingProgress(containerId: number): void {
  _progressStore.set(containerId, []);
  // Auto-purge after 10 min so memory never grows indefinitely
  setTimeout(() => _progressStore.delete(containerId), 10 * 60 * 1000);
}

/** Emit or update a progress step.  If a "running" step with the same label
 *  already exists it is replaced in-place so there are no duplicates. */
function ep(
  containerId: number,
  label: string,
  status: ProgressStep["status"],
  detail?: string | null,
): void {
  let steps = _progressStore.get(containerId);
  if (!steps) { steps = []; _progressStore.set(containerId, steps); }
  const step: ProgressStep = { label, status, detail: detail ?? null, ts: Date.now() };
  const idx = steps.findIndex((s) => s.label === label && s.status === "running");
  if (idx >= 0) steps[idx] = step; else steps.push(step);
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
          gte(containerTrackingChecks.checkedAt, startOfMonth),
        ),
      );
    return { used: result[0]?.count ?? 0, limit };
  } catch {
    return { used: 0, limit };
  }
}

async function check17trackQuota(): Promise<boolean> {
  const { used, limit } = await get17trackUsageStats();
  return used < limit;
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

  // ── Shuffle first so equal-priority ties rotate across runs ─────────────
  // Without this, containers that happen to be earlier in the DB always win
  // the budget, starving later-added containers (e.g. CMA) permanently.
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }

  // ── Sort: highest priority first, then oldest checked, then ETA nearest ───
  // Stable sort preserves the random shuffle order among fully-tied containers.
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
  // Maersk containers use maersk_direct (no ParcelsApp quota cost) so they are
  // always tracked regardless of the per-run budget.  All other carriers may
  // eventually call the ParcelsApp API and therefore count against the quota.
  const SCHED_MAERSK_PREFIXES = /^(MAEU|MSKU|MRKU|MRSU|HASU|HJSC|HJCU|SUDU|SAFM|MCIU|TRHU|TEMU|SEAU|PONU|SEGU|MWMU)/i;
  const maerskEligible = eligible.filter(({ row }) => SCHED_MAERSK_PREFIXES.test(row.containerNumber));
  const quotaEligible  = eligible.filter(({ row }) => !SCHED_MAERSK_PREFIXES.test(row.containerNumber));

  const toTrackQuota   = quotaEligible.slice(0, perRunBudget);
  const budgetSkipped  = quotaEligible.slice(perRunBudget);
  const toTrack        = [...maerskEligible, ...toTrackQuota];

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
    `[ContainerTracking] Eligible: ${eligible.length} (maersk=${maerskEligible.length} unlimited + quota=${quotaEligible.length} capped at ${perRunBudget}/run), ` +
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
export function isBulkTrackingRunning(): boolean { return _bulkRunning; }

/**
 * Immediately trigger tracking for every non-inactive container.
 * Bypasses cooldown and trackingEnabled flag — explicit manual override.
 * Starts tracking in the background and returns the count immediately.
 * Returns 0 if a bulk run is already in progress.
 */
export async function trackAllEnabledNow(): Promise<number> {
  if (!anyProviderConfigured()) return 0;
  if (_bulkRunning) {
    console.log("[BulkTracking] A bulk run is already in progress — ignoring duplicate request.");
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
    console.log(
      `[BulkTracking] Starting manual run for ${eligible.length} container(s): ` +
        eligible.map((r) => r.containerNumber).slice(0, 5).join(", ") +
        (eligible.length > 5 ? "…" : ""),
    );
    for (let i = 0; i < eligible.length; i++) {
      const row = eligible[i];
      _bulkProgress.current = row.containerNumber;
      _bulkProgress.processed = i;
      try {
        await trackOneContainer(row.id, row.containerNumber, row.trackingCarrierHint ?? undefined);
        await sleep(2_000);
      } catch (err: any) {
        console.error(`[BulkTracking] Error tracking ${row.containerNumber}:`, err?.message);
      }
      _bulkProgress.processed = i + 1;
    }
    console.log(`[BulkTracking] Manual run complete for ${eligible.length} containers.`);
  })()
    .catch((err: any) => console.error("[BulkTracking] Unexpected error:", err?.message))
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

export async function trackOneContainerById(containerId: number): Promise<TrackNowResult> {
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
        gte(containerTrackingChecks.checkedAt, trackStartedAt),
      ),
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
}

// ─── ETA resolution helpers ───────────────────────────────────────────────────

/**
 * Resolve the best ETA from a direct carrier provider result.
 * Priority: provider explicit ETA → preserve existing DB value.
 * NEVER derives ETA from event dates — event dates are movement records
 * (gate-in, load, departure, discharge, etc.), not destination ETAs.
 * NEVER blanks an existing ETA.
 */
function resolveEtaFromProvider(
  providerEta: string | null,
  _events: TrackingEvent[] | undefined,
  currentEta: string | null,
): { eta: string | null; source: "api" | "manual" | null } {
  if (providerEta) return { eta: providerEta, source: "api" };
  if (currentEta) return { eta: currentEta, source: "manual" };
  return { eta: null, source: null };
}

/** Log ETA resolution so field updates are visible in server output.
 *  Does NOT log raw API payloads or secrets. */
function logEtaResolution(
  containerNumber: string,
  provider: string,
  currentEta: string | null,
  providerEta: string | null,
  finalEta: string | null,
  source: string | null,
): void {
  const changed = finalEta !== null && finalEta !== currentEta;
  console.log(
    `[ETA] ${containerNumber} provider=${provider}` +
    ` old=${currentEta ?? "—"} providerEta=${providerEta ?? "—"}` +
    ` final=${finalEta ?? "—"} src=${source ?? "—"}` +
    (changed ? " [UPDATED]" : ""),
  );
}

/**
 * Resolve the best ETA from a ParcelsApp/scraper shipment result.
 * Uses deriveEstimatedDeliveryDate (which already falls back to state dates),
 * then falls back to the existing DB value. NEVER blanks an existing ETA.
 */
function resolveEtaFromShipment(
  shipment: ParcelsAppShipment,
  currentEta: string | null,
): { eta: string | null; source: "api" | "manual" | null } {
  const derived = deriveEstimatedDeliveryDate(shipment);
  if (derived) return { eta: derived, source: "api" };
  if (currentEta) return { eta: currentEta, source: "manual" };
  return { eta: null, source: null };
}

/**
 * Log the ETA decision and confirm the persisted value from the DB.
 * Called after every db.update() that may change the ETA column.
 */
async function logAndConfirmEta(
  containerId: number,
  containerNumber: string,
  oldEta: string | null,
  newEta: string | null,
  source: string | null,
  provider: string,
  noUpdateReason?: string,
): Promise<void> {
  if (noUpdateReason) {
    console.log(
      `[ContainerTracking ETA] container=${containerNumber} NO UPDATE — ${noUpdateReason} ` +
        `(existing=${oldEta ?? "null"}) provider=${provider}`,
    );
    return;
  }
  console.log(
    `[ContainerTracking ETA] container=${containerNumber} oldEta=${oldEta ?? "null"} ` +
      `→ newEta=${newEta ?? "null"} source=${source ?? "none"} provider=${provider}`,
  );
  const [saved] = await db
    .select({ eta: containers.eta })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);
  console.log(
    `[ContainerTracking ETA] DB-confirmed: container=${containerNumber} eta=${saved?.eta ?? "null"}`,
  );
}

// ─── Internal tracking implementation ─────────────────────────────────────────

async function trackOneContainer(
  containerId: number,
  containerNumber: string,
  destinationCountry?: string,
): Promise<{
  success: boolean;
  lastStatus: string | null;
  lastLocation: string | null;
  lastDescription: string | null;
  lastCheckedAt: Date;
  error: string | null;
}> {
  const now = new Date();

  // Fetch the current ETA from the DB so we can preserve it if the provider
  // returns nothing — we never want to blank an existing ETA.
  const [currentRow] = await db
    .select({ eta: containers.eta, trackingLastCheckedAt: containers.trackingLastCheckedAt })
    .from(containers)
    .where(eq(containers.id, containerId))
    .limit(1);
  const currentEta: string | null = currentRow?.eta ?? null;
  const lastCheckedAt: Date | null = currentRow?.trackingLastCheckedAt ?? null;

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

      const { eta: finalEta, source: etaSrc } = resolveEtaFromProvider(
        result.eta ?? null,
        result.events,
        currentEta,
      );
      logEtaResolution(containerNumber, result.provider, currentEta, result.eta ?? null, finalEta, etaSrc);

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
      if (finalEta) { updateSet.eta = finalEta; updateSet.etaSource = etaSrc; }

      await db.update(containers).set(updateSet as any).where(eq(containers.id, containerId));
      await logAndConfirmEta(
        containerId, containerNumber, currentEta, finalEta, etaSrc, result.provider,
        !finalEta ? "provider returned no ETA and no events with dates" : undefined,
      );
      console.log(`[ContainerTracking] ${containerNumber} → ${result.provider}: status=${result.latestStatus ?? "?"}`);

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
    currentEta,
    destinationCountry,
  );
}

// ─── Universal fallback — scraper → 17track → ParcelsApp API ──────────────────

async function trackViaParcelsApp(
  containerId: number,
  containerNumber: string,
  detectedCarrier: string | null,
  fallbackReason: string | null,
  now: Date,
  currentEta: string | null,
  destinationCountry?: string,
): Promise<{
  success: boolean;
  lastStatus: string | null;
  lastLocation: string | null;
  lastDescription: string | null;
  lastCheckedAt: Date;
  error: string | null;
}> {

  // Reset progress for this tracking run
  initTrackingProgress(containerId);

  // ── Attempt 0: Lightweight HTTP scraper (no browser, no quota) ──────────────
  if (isHttpScraperAvailable()) {
    ep(containerId, "HTTP scraper", "running");
    console.log(`[ContainerTracking] ${containerNumber}: trying HTTP scraper (no browser)...`);
    const httpResult = await httpScrapeTracking(containerNumber);

    await saveTrackingCheck(
      containerId,
      "http_scraper",
      httpResult.success ? "success" : "error",
      httpResult.error ?? null,
      httpResult.rawResponse ?? null,
    );

    if (httpResult.success && httpResult.shipment) {
      const shipment = httpResult.shipment;
      const lastStatus      = deriveLastStatus(shipment);
      const lastLocation    = deriveLastLocation(shipment);
      const lastEventDate   = deriveLastEventDate(shipment);
      const lastDescription = shipment.states?.[0]?.description ?? null;
      const { eta: finalEta, source: etaSrc } = resolveEtaFromShipment(shipment, currentEta);
      logEtaResolution(containerNumber, "http_scraper", currentEta, finalEta, finalEta, etaSrc);

      await saveParcelsAppEvents(containerId, shipment);

      const updateSet: Record<string, unknown> = {
        trackingLastCheckedAt: now,
        trackingLastStatus: lastStatus,
        trackingLastEventDate: lastEventDate,
        trackingLastDescription: lastDescription,
        trackingError: null,
        trackingChangedAt: now,
        trackingProvider: "http_scraper",
        trackingDetectedCarrier: detectedCarrier,
        trackingFallbackUsed: !!fallbackReason,
        trackingFallbackReason: fallbackReason,
      };
      if (finalEta) { updateSet.eta = finalEta; updateSet.etaSource = etaSrc; }
      await db.update(containers).set(updateSet as any).where(eq(containers.id, containerId));
      await logAndConfirmEta(
        containerId, containerNumber, currentEta, finalEta, etaSrc, "http_scraper",
        !finalEta ? "no explicit ETA field found — existing ETA preserved" : undefined,
      );

      ep(containerId, "HTTP scraper", "success", lastStatus ?? "got data");
      console.log(`[ContainerTracking] ${containerNumber} → http_scraper: status=${lastStatus ?? "?"}`);
      if (finalEta || currentEta) {
        // ETA is known (new from provider or already in DB) — full success, stop here
        return { success: true, lastStatus, lastLocation, lastDescription, lastCheckedAt: now, error: null };
      }
      // Status/events saved but no ETA anywhere — fall through to next provider to try to get one
      console.log(`[ContainerTracking] ${containerNumber}: http_scraper got status/events but no ETA — continuing to fallback provider for ETA`);
    } else {
      ep(containerId, "HTTP scraper", "skip", httpResult.error ?? "no data");
      console.log(`[ContainerTracking] ${containerNumber}: HTTP scraper got no data (${httpResult.error}) — trying next provider...`);
    }
  }

  // ── Attempt 1: Maersk direct Puppeteer scraper (intercepts Maersk's own API) ──
  // Only for Maersk-family containers (MAERSK, Hamburg Süd, etc.)
  // CAJU is a CMA-owned prefix but is operated by Maersk (MAEU) on some services.
  // Maersk.com tracks CAJU containers when operator=MAEU, so include it here so
  // maersk_direct and maersk_public are attempted before falling back to CMA/ParcelsApp.
  const MAERSK_PREFIXES = /^(MAEU|MSKU|MRKU|MRSU|HASU|HJSC|HJCU|SUDU|SAFM|CAJU)/i;

  // 6-hour ETA cache: if we already have a good ETA and checked < 6 h ago, skip both
  // Maersk providers entirely. The scheduler already enforces intervals, but this
  // in-process guard prevents redundant calls when trackOneContainer is invoked directly.
  const SIX_HOURS_MS = 6 * 60 * 60 * 1_000;
  if (
    MAERSK_PREFIXES.test(containerNumber) &&
    currentEta &&
    lastCheckedAt &&
    now.getTime() - lastCheckedAt.getTime() < SIX_HOURS_MS
  ) {
    console.log(`[ContainerTracking] ${containerNumber}: Maersk ETA cached (${currentEta}) checked ${Math.round((now.getTime() - lastCheckedAt.getTime()) / 60000)}min ago — skipping providers`);
    return { success: true, lastStatus: null, lastLocation: null, lastDescription: null, lastCheckedAt: lastCheckedAt, error: null };
  }

  if (isMaerskDirectScraperAvailable() && MAERSK_PREFIXES.test(containerNumber)) {
    ep(containerId, "Maersk Puppeteer", "running");
    console.log(`[ContainerTracking] ${containerNumber}: trying Maersk scraper...`);
    const mdResult = await scrapeMaerskDirect(containerNumber);

    await saveTrackingCheck(
      containerId,
      "maersk_scraper",
      mdResult.success ? "success" : mdResult.blocked ? "blocked" : "error",
      mdResult.error ?? null,
      mdResult.raw ?? null,
    );

    if (mdResult.success && (mdResult.latestStatus || mdResult.eta)) {
      const updateSet: Record<string, unknown> = {
        trackingLastCheckedAt: now,
        trackingLastStatus: mdResult.latestStatus,
        trackingLastEventDate: mdResult.latestEventDate,
        trackingLastDescription: mdResult.latestDescription,
        trackingError: null,
        trackingChangedAt: now,
        trackingProvider: "maersk_scraper",
        trackingDetectedCarrier: detectedCarrier,
        trackingFallbackUsed: !!fallbackReason,
        trackingFallbackReason: fallbackReason,
      };

      // Hoist finalEta so the early-return guard below can see it regardless of events branch
      let finalEta: string | null = null;
      let etaSrc: string | null = null;

      // Save events
      if (mdResult.events?.length) {
        ({ eta: finalEta, source: etaSrc } = resolveEtaFromProvider(
          mdResult.eta ?? null,
          mdResult.events,
          currentEta,
        ));
        logEtaResolution(containerNumber, "maersk_scraper", currentEta, mdResult.eta ?? null, finalEta, etaSrc);
        if (finalEta) { updateSet.eta = finalEta; updateSet.etaSource = etaSrc; }

        await db.update(containers).set(updateSet as any).where(eq(containers.id, containerId));
        await logAndConfirmEta(
          containerId, containerNumber, currentEta, finalEta ?? null, etaSrc ?? null, "maersk_scraper",
          !finalEta ? "no ETA from maersk_scraper" : undefined,
        );

        // Persist tracking events
        const fakeShipment: ParcelsAppShipment = {
          trackingId: containerNumber,
          done: true,
          attributes: {
            ...(mdResult.latestStatus ? { status: mdResult.latestStatus } : {}),
            ...(mdResult.latestLocation ? { location: mdResult.latestLocation } : {}),
            ...(finalEta ? { estimatedArrival: finalEta } : {}),
          },
          states: mdResult.events.map((e) => ({
            date: e.date?.toISOString().slice(0, 10) ?? "",
            status: e.status ?? "",
            location: e.location ?? "",
            description: e.description ?? "",
          })),
        };
        await saveParcelsAppEvents(containerId, fakeShipment);
      } else {
        if (mdResult.eta && !currentEta) { finalEta = mdResult.eta; updateSet.eta = mdResult.eta; updateSet.etaSource = "api"; }
        await db.update(containers).set(updateSet as any).where(eq(containers.id, containerId));
      }

      ep(containerId, "Maersk Puppeteer", "success", mdResult.latestStatus ?? "got data");
      console.log(`[ContainerTracking] ${containerNumber} → maersk_scraper: status=${mdResult.latestStatus ?? "?"}`);
      if (finalEta || currentEta) {
        // ETA is known (new from provider or already in DB) — full success, stop here
        return {
          success: true,
          lastStatus: mdResult.latestStatus,
          lastLocation: mdResult.latestLocation,
          lastDescription: mdResult.latestDescription,
          lastCheckedAt: now,
          error: null,
        };
      }
      // Status/events saved but no ETA anywhere — continue to Maersk public / ParcelsApp for ETA
      console.log(`[ContainerTracking] ${containerNumber}: maersk_scraper got status/events but no ETA — continuing to Maersk public for ETA`);
    } else {
      ep(containerId, "Maersk Puppeteer", "fail", mdResult.error ?? "no data");
      console.log(`[ContainerTracking] ${containerNumber}: maersk_scraper got no data (${mdResult.error}) — trying Maersk public HTTP...`);
    }
  } else if (MAERSK_PREFIXES.test(containerNumber) && !isMaerskDirectScraperAvailable()) {
    ep(containerId, "Maersk Puppeteer", "skip", "Chrome not available in this environment");
  }

  // ── Attempt 2: Maersk public HTTP (no browser, no API key, always available) ──
  // Runs when maersk_direct is unavailable (no Puppeteer) or returned no data.
  // Hits Maersk's undocumented public JSON API after loading a session cookie.
  // Blocked by Akamai roughly half the time — falls through gracefully.
  if (MAERSK_PREFIXES.test(containerNumber)) {
    ep(containerId, "Maersk public HTTP", "running");
    console.log(`[ContainerTracking] ${containerNumber}: trying Maersk public HTTP provider...`);
    const mpResult = await maerskPublicProvider.track(containerNumber);

    const mpStatus = mpResult.success
      ? "success"
      : mpResult.blocked
        ? "blocked"
        : mpResult.error === "rate_limited"
          ? "skipped"
          : "error";

    await saveTrackingCheck(
      containerId,
      "maersk_public",
      mpStatus,
      mpResult.error ?? null,
      mpResult.raw ?? null,
    );

    if (mpResult.success && (mpResult.latestStatus || mpResult.events.length > 0)) {
      await saveDirectEvents(containerId, mpResult);
      const { eta: finalEta, source: etaSrc } = resolveEtaFromProvider(
        mpResult.eta ?? null,
        mpResult.events,
        currentEta,
      );
      logEtaResolution(containerNumber, "maersk_public", currentEta, mpResult.eta ?? null, finalEta, etaSrc);

      const updateSet: Record<string, unknown> = {
        trackingLastCheckedAt: now,
        trackingLastStatus: mpResult.latestStatus,
        trackingLastEventDate: mpResult.latestEventDate,
        trackingLastDescription: mpResult.latestDescription,
        trackingError: null,
        trackingChangedAt: now,
        trackingProvider: "maersk_public",
        trackingDetectedCarrier: detectedCarrier,
        trackingFallbackUsed: !!fallbackReason,
        trackingFallbackReason: fallbackReason,
      };
      if (finalEta) { updateSet.eta = finalEta; updateSet.etaSource = etaSrc; }

      await db.update(containers).set(updateSet as any).where(eq(containers.id, containerId));
      await logAndConfirmEta(
        containerId, containerNumber, currentEta, finalEta ?? null, etaSrc ?? null, "maersk_public",
        !finalEta ? "no ETA from maersk_public" : undefined,
      );

      ep(containerId, "Maersk public HTTP", "success", mpResult.latestStatus ?? "got data");
      console.log(`[ContainerTracking] ${containerNumber} → maersk_public: status=${mpResult.latestStatus ?? "?"}`);
      if (finalEta || currentEta) {
        // ETA is known (new from provider or already in DB) — full success, stop here
        return {
          success: true,
          lastStatus: mpResult.latestStatus,
          lastLocation: mpResult.latestLocation,
          lastDescription: mpResult.latestDescription,
          lastCheckedAt: now,
          error: null,
        };
      }
      // Status/events saved but no ETA anywhere — continue to ParcelsApp to try to get one
      console.log(`[ContainerTracking] ${containerNumber}: maersk_public got status/events but no ETA — continuing to ParcelsApp for ETA`);
    } else if (mpResult.error === "rate_limited") {
      ep(containerId, "Maersk public HTTP", "skip", "rate-limited — 6 h cooldown");
    } else {
      ep(containerId, "Maersk public HTTP", "fail", mpResult.error ?? "no data");
      console.log(`[ContainerTracking] ${containerNumber}: maersk_public got no data (${mpResult.error})`);
    }
  }

  // Maersk guard: NEVER fall through to ParcelsApp/generic scrapers for Maersk containers.
  // ParcelsApp has stale/unreliable data for Maersk and risks clobbering correct ETAs.
  // Both dedicated Maersk providers have been tried above — stop here and preserve state.
  if (MAERSK_PREFIXES.test(containerNumber)) {
    console.log(`[ContainerTracking] ${containerNumber}: Maersk chain exhausted — preserving ETA=${currentEta ?? "none"}`);
    await db.update(containers)
      .set({ trackingLastCheckedAt: now } as any)
      .where(eq(containers.id, containerId));
    return { success: false, lastStatus: null, lastLocation: null, lastDescription: null, lastCheckedAt: now, error: "maersk_providers_unavailable" };
  }

  // ── CMA provider chain ────────────────────────────────────────────────────────
  // Priority order:
  //   1. CMA CGM Official DCSA API (api key, most accurate ETA)
  //   2. CMA CGM public JSON endpoint (free, no key, often blocked by DataDome)
  //   3. 17track
  //   4. ParcelsApp API
  const CMA_PREFIXES = /^(CMAU|CMDU|APZU|CGMU|APMU|APHU|CXDU|CAAU|CAJU|CAIU)/i;
  if (CMA_PREFIXES.test(containerNumber)) {
    console.log(`[ContainerTracking] ${containerNumber}: CMA detected — trying CMA CGM official API...`);

    // ── Step 1: CMA CGM Official DCSA Track & Trace API ──────────────────────
    if (cmaCgmApiProvider.isConfigured()) {
      const apiResult = await cmaCgmApiProvider.track(containerNumber);
      await saveTrackingCheck(
        containerId,
        "cma_cgm_api",
        apiResult.success ? "success" : apiResult.noData ? "no_data" : "error",
        apiResult.error ?? null,
        apiResult.raw ?? null,
      );

      if (apiResult.success && (apiResult.latestStatus || apiResult.events.length > 0)) {
        await saveDirectEvents(containerId, apiResult);
        const { eta: finalEta, source: etaSrc } = resolveEtaFromProvider(
          apiResult.eta ?? null,
          apiResult.events,
          currentEta,
        );
        logEtaResolution(containerNumber, "cma_cgm_api", currentEta, apiResult.eta ?? null, finalEta, etaSrc);
        const updateSet: Record<string, unknown> = {
          trackingLastCheckedAt: now,
          trackingLastStatus: apiResult.latestStatus,
          trackingLastEventDate: apiResult.latestEventDate,
          trackingLastDescription: apiResult.latestDescription,
          trackingError: null,
          trackingChangedAt: now,
          trackingProvider: "cma_cgm_api",
          trackingDetectedCarrier: detectedCarrier,
          trackingFallbackUsed: !!fallbackReason,
          trackingFallbackReason: fallbackReason,
        };
        if (finalEta) { updateSet.eta = finalEta; updateSet.etaSource = etaSrc; }
        await db.update(containers).set(updateSet as any).where(eq(containers.id, containerId));
        await logAndConfirmEta(
          containerId, containerNumber, currentEta, finalEta, etaSrc, "cma_cgm_api",
          !finalEta ? "no ETA from CMA CGM official API" : undefined,
        );
        console.log(`[ContainerTracking] ${containerNumber} → cma_cgm_api: status=${apiResult.latestStatus ?? "?"} eta=${finalEta ?? "none"}`);
        return { success: true, lastStatus: apiResult.latestStatus, lastLocation: apiResult.latestLocation, lastDescription: apiResult.latestDescription, lastCheckedAt: now, error: null };
      }

      console.log(`[ContainerTracking] ${containerNumber}: CMA official API returned no data (${apiResult.error}) — trying public endpoint...`);
    }

    if (cmaPublicProvider.isEnabled()) {
      const cmaResult = await cmaPublicProvider.track(containerNumber);
      await saveTrackingCheck(
        containerId,
        "cma_public",
        cmaResult.success ? "success" : cmaResult.blocked ? "blocked" : "error",
        cmaResult.error ?? null,
        cmaResult.raw ?? null,
      );

      if (cmaResult.success && (cmaResult.latestStatus || cmaResult.events.length > 0)) {
        await saveDirectEvents(containerId, cmaResult);
        const { eta: finalEta, source: etaSrc } = resolveEtaFromProvider(
          cmaResult.eta ?? null,
          cmaResult.events,
          currentEta,
        );
        logEtaResolution(containerNumber, "cma_public", currentEta, cmaResult.eta ?? null, finalEta, etaSrc);
        const updateSet: Record<string, unknown> = {
          trackingLastCheckedAt: now,
          trackingLastStatus: cmaResult.latestStatus,
          trackingLastEventDate: cmaResult.latestEventDate,
          trackingLastDescription: cmaResult.latestDescription,
          trackingError: null,
          trackingChangedAt: now,
          trackingProvider: "cma_public",
          trackingDetectedCarrier: detectedCarrier,
          trackingFallbackUsed: !!fallbackReason,
          trackingFallbackReason: fallbackReason,
        };
        if (finalEta) { updateSet.eta = finalEta; updateSet.etaSource = etaSrc; }
        await db.update(containers).set(updateSet as any).where(eq(containers.id, containerId));
        await logAndConfirmEta(
          containerId, containerNumber, currentEta, finalEta, etaSrc, "cma_public",
          !finalEta ? "no ETA from CMA public endpoint" : undefined,
        );
        console.log(`[ContainerTracking] ${containerNumber} → cma_public: status=${cmaResult.latestStatus ?? "?"}`);
        return { success: true, lastStatus: cmaResult.latestStatus, lastLocation: cmaResult.latestLocation, lastDescription: cmaResult.latestDescription, lastCheckedAt: now, error: null };
      }

      console.log(`[ContainerTracking] ${containerNumber}: CMA public endpoint failed (${cmaResult.error}) — trying 17track...`);
    }

    // 17track handles CMA well — try it before burning ParcelsApp quota
    if (seventeenTrack.isConfigured()) {
      const quotaOk17 = await check17trackQuota();
      if (quotaOk17) {
        console.log(`[ContainerTracking] ${containerNumber}: trying 17track for CMA (carrier=100755)...`);
        const result17 = await seventeenTrack.track(containerNumber, seventeenTrack.CARRIER_CODES.CMA);
        await saveTrackingCheck(
          containerId,
          "17track",
          result17.success ? "success" : result17.noData ? "no_data" : "error",
          result17.error ?? null,
          result17.raw,
        );
        if (result17.success) {
          await saveDirectEvents(containerId, result17);
          const { eta: finalEta, source: etaSrc } = resolveEtaFromProvider(
            result17.eta ?? null,
            result17.events,
            currentEta,
          );
          logEtaResolution(containerNumber, "17track", currentEta, result17.eta ?? null, finalEta, etaSrc);
          const updateSet: Record<string, unknown> = {
            trackingLastCheckedAt: now,
            trackingLastStatus: result17.latestStatus,
            trackingLastEventDate: result17.latestEventDate,
            trackingLastDescription: result17.latestDescription,
            trackingError: null,
            trackingChangedAt: now,
            trackingProvider: "17track",
            trackingDetectedCarrier: detectedCarrier,
            trackingFallbackUsed: !!fallbackReason,
            trackingFallbackReason: fallbackReason,
          };
          if (finalEta) { updateSet.eta = finalEta; updateSet.etaSource = etaSrc; }
          await db.update(containers).set(updateSet as any).where(eq(containers.id, containerId));
          await logAndConfirmEta(
            containerId, containerNumber, currentEta, finalEta, etaSrc, "17track",
            !finalEta ? "17track returned no ETA" : undefined,
          );
          console.log(`[ContainerTracking] ${containerNumber} → 17track (CMA): status=${result17.latestStatus ?? "?"}`);
          return { success: true, lastStatus: result17.latestStatus, lastLocation: result17.latestLocation, lastDescription: result17.latestDescription, lastCheckedAt: now, error: null };
        }
        console.log(`[ContainerTracking] ${containerNumber}: 17track failed for CMA (${result17.error}) — trying ParcelsApp scraper...`);
      }
    }

    // ParcelsApp website (scraped via Puppeteer) has no CMA CGM data — skip it.
    // Go straight to the ParcelsApp v3 API which may have broader carrier coverage.
    return await trackViaParcelsAppApi(containerId, containerNumber, null, fallbackReason, now, currentEta, destinationCountry);
  }

  // ── Attempt 2: Puppeteer stealth scraper (ParcelsApp, no API key, no quota cost) ──
  if (isScraperAvailable()) {
    ep(containerId, "Puppeteer scraper", "running");
    console.log(`[ContainerTracking] ${containerNumber}: trying ParcelsApp web scraper...`);
    const scraped = await scrapeTracking(containerNumber);

    await saveTrackingCheck(
      containerId,
      "parcelsapp_scraper",
      scraped.success ? "success" : scraped.blocked ? "blocked" : "error",
      scraped.error ?? null,
      scraped.rawResponse ?? null,
    );

    if (scraped.success && scraped.shipment) {
      const shipment = scraped.shipment;
      const lastStatus      = deriveLastStatus(shipment);
      const lastLocation    = deriveLastLocation(shipment);
      const lastEventDate   = deriveLastEventDate(shipment);
      const lastDescription = shipment.states?.[0]?.description ?? null;
      const { eta: finalEta, source: etaSrc } = resolveEtaFromShipment(shipment, currentEta);

      await saveParcelsAppEvents(containerId, shipment);

      const updateSet: Record<string, unknown> = {
        trackingLastCheckedAt: now,
        trackingLastStatus: lastStatus,
        trackingLastEventDate: lastEventDate,
        trackingLastDescription: lastDescription,
        trackingError: null,
        trackingChangedAt: now,
        trackingProvider: "parcelsapp_scraper",
        trackingDetectedCarrier: detectedCarrier,
        trackingFallbackUsed: !!fallbackReason,
        trackingFallbackReason: fallbackReason,
      };
      if (finalEta) { updateSet.eta = finalEta; updateSet.etaSource = etaSrc; }
      await db.update(containers).set(updateSet as any).where(eq(containers.id, containerId));
      await logAndConfirmEta(
        containerId, containerNumber, currentEta, finalEta, etaSrc, "parcelsapp_scraper",
        !finalEta ? "no ETA derived from shipment states" : undefined,
      );

      ep(containerId, "Puppeteer scraper", "success", lastStatus ?? "got data");
      console.log(`[ContainerTracking] ${containerNumber} → parcelsapp_scraper: status=${lastStatus ?? "?"}`);
      return { success: true, lastStatus, lastLocation, lastDescription, lastCheckedAt: now, error: null };
    }

    ep(containerId, "Puppeteer scraper", scraped.blocked ? "blocked" : "fail", scraped.error ?? "no data");
    if (scraped.blocked) {
      console.warn(`[ContainerTracking] ${containerNumber}: scraper blocked by reCaptcha — trying 17track...`);
    } else {
      console.warn(`[ContainerTracking] ${containerNumber}: scraper failed (${scraped.error}) — trying 17track...`);
    }
  }

  // ── Attempt 2: 17track API ────────────────────────────────────────────────────
  if (seventeenTrack.isConfigured()) {
    const quotaOk17 = await check17trackQuota();
    if (!quotaOk17) {
      ep(containerId, "17track API", "skip", "quota exhausted this month");
      console.warn(`[ContainerTracking] ${containerNumber}: 17track quota exhausted — skipping`);
    } else {
      ep(containerId, "17track API", "running");
      console.log(`[ContainerTracking] ${containerNumber}: trying 17track...`);
      const result17 = await seventeenTrack.track(containerNumber);

      await saveTrackingCheck(
        containerId,
        "17track",
        result17.success ? "success" : result17.noData ? "no_data" : "error",
        result17.error ?? null,
        result17.raw,
      );

      if (result17.success) {
        await saveDirectEvents(containerId, result17);

        const { eta: finalEta, source: etaSrc } = resolveEtaFromProvider(
          result17.eta ?? null,
          result17.events,
          currentEta,
        );
        logEtaResolution(containerNumber, "17track", currentEta, result17.eta ?? null, finalEta, etaSrc);

        const updateSet: Record<string, unknown> = {
          trackingLastCheckedAt: now,
          trackingLastStatus: result17.latestStatus,
          trackingLastEventDate: result17.latestEventDate,
          trackingLastDescription: result17.latestDescription,
          trackingError: null,
          trackingChangedAt: now,
          trackingProvider: "17track",
          trackingDetectedCarrier: detectedCarrier,
          trackingFallbackUsed: !!fallbackReason,
          trackingFallbackReason: fallbackReason,
        };
        if (finalEta) { updateSet.eta = finalEta; updateSet.etaSource = etaSrc; }
        await db.update(containers).set(updateSet as any).where(eq(containers.id, containerId));
        await logAndConfirmEta(
          containerId, containerNumber, currentEta, finalEta, etaSrc, "17track",
          !finalEta ? "17track returned no ETA and no events with dates" : undefined,
        );

        ep(containerId, "17track API", "success", result17.latestStatus ?? "got data");
        console.log(`[ContainerTracking] ${containerNumber} → 17track: status=${result17.latestStatus ?? "?"}`);
        return {
          success: true,
          lastStatus: result17.latestStatus,
          lastLocation: result17.latestLocation,
          lastDescription: result17.latestDescription,
          lastCheckedAt: now,
          error: null,
        };
      }

      ep(containerId, "17track API", "fail", result17.error ?? "no data");
      console.warn(`[ContainerTracking] ${containerNumber}: 17track failed (${result17.error}) — trying ParcelsApp API...`);
    }
  }

  // ── Final: ParcelsApp API ─────────────────────────────────────────────────────
  return await trackViaParcelsAppApi(containerId, containerNumber, detectedCarrier, fallbackReason, now, currentEta, destinationCountry);
}

// ─── ParcelsApp API — shared final step for all carriers ──────────────────────

async function trackViaParcelsAppApi(
  containerId: number,
  containerNumber: string,
  detectedCarrier: string | null,
  fallbackReason: string | null,
  now: Date,
  currentEta: string | null,
  destinationCountry?: string | null,
): Promise<{
  success: boolean;
  lastStatus: string | null;
  lastLocation: string | null;
  lastDescription: string | null;
  lastCheckedAt: Date;
  error: string | null;
}> {
  if (!process.env.PARCELSAPP_API_KEY) {
    ep(containerId, "ParcelsApp API", "skip", "API key not configured");
    console.log(`[ContainerTracking] ${containerNumber}: ParcelsApp API skipped — PARCELSAPP_API_KEY is not configured`);
    const noProviderError = "No tracking provider configured (scraper unavailable, 17track not set, ParcelsApp key missing)";
    await db
      .update(containers)
      .set({
        trackingLastCheckedAt: now,
        trackingError: noProviderError,
        trackingDetectedCarrier: detectedCarrier,
        trackingFallbackUsed: !!fallbackReason,
        trackingFallbackReason: fallbackReason,
      } as any)
      .where(eq(containers.id, containerId));
    return { success: false, lastStatus: null, lastLocation: null, lastDescription: null, lastCheckedAt: now, error: noProviderError };
  }

  const quotaOk = await checkParcelsAppQuota();
  if (!quotaOk) {
    const { used, limit } = await getParcelsAppUsageStats();
    const quotaError = `ParcelsApp API quota used (${used}/${limit}) — all providers exhausted`;
    ep(containerId, "ParcelsApp API", "skip", "quota exhausted this month");
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
    return { success: false, lastStatus: null, lastLocation: null, lastDescription: null, lastCheckedAt: now, error: quotaError };
  }

  const hintCarrier = detectedCarrier && detectedCarrier !== "OTHER" ? detectedCarrier : undefined;
  const effectiveDestination = destinationCountry || "United States";
  ep(containerId, "ParcelsApp API", "running");
  console.log(`[ContainerTracking] ${containerNumber}: ParcelsApp API attempt carrier=${hintCarrier ?? "auto"} destination="${effectiveDestination}"`);

  const result = await trackContainer(containerNumber, effectiveDestination, hintCarrier);

  await saveTrackingCheck(
    containerId,
    "parcelsapp",
    result.success ? "success" : result.timedOut ? "timeout" : "error",
    result.error ?? null,
    result.rawResponse,
  );

  if (!result.success || !result.shipment) {
    ep(containerId, "ParcelsApp API", "fail", result.error ?? "no data");
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
    // backfillEtaFromEvents removed — event dates must not be used as ETA
    return { success: false, lastStatus: null, lastLocation: null, lastDescription: null, lastCheckedAt: now, error: result.error ?? "Tracking failed" };
  }

  const shipment = result.shipment;
  const lastStatus      = deriveLastStatus(shipment);
  const lastLocation    = deriveLastLocation(shipment);
  const lastEventDate   = deriveLastEventDate(shipment);
  const lastDescription = shipment.states?.[0]?.description ?? null;
  const { eta: finalEta, source: etaSrc } = resolveEtaFromShipment(shipment, currentEta);
  logEtaResolution(containerNumber, "parcelsapp", currentEta, finalEta, finalEta, etaSrc);

  console.log(`[ContainerTracking] ${containerNumber} raw attributes:`, JSON.stringify(shipment.attributes ?? {}));
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
  if (finalEta) { updateSet.eta = finalEta; updateSet.etaSource = etaSrc; }
  await db.update(containers).set(updateSet as any).where(eq(containers.id, containerId));
  await logAndConfirmEta(
    containerId, containerNumber, currentEta, finalEta, etaSrc, "parcelsapp",
    !finalEta ? "no explicit ETA field found — existing ETA preserved" : undefined,
  );

  ep(containerId, "ParcelsApp API", "success", lastStatus ?? "got data");
  console.log(`[ContainerTracking] ${containerNumber} → parcelsapp: status=${lastStatus ?? "?"}`);
  return { success: true, lastStatus, lastLocation, lastDescription, lastCheckedAt: now, error: null };
}

// ─── ETA backfill from stored events ──────────────────────────────────────────

/**
 * If the container's ETA column is still NULL after a tracking run (e.g. all
 * providers failed or returned no explicit ETA), fill it in from the most
 * recent event we have stored in containerTrackingEvents.  Never overwrites
 * an ETA that already exists.
 */
async function backfillEtaFromEvents(containerId: number): Promise<void> {
  const [row] = await db
    .select({ eta: containers.eta })
    .from(containers)
    .where(and(eq(containers.id, containerId), isNull(containers.eta)));

  if (!row) return; // eta is already set — don't touch it

  const [latest] = await db
    .select({ eventTime: containerTrackingEvents.eventTime })
    .from(containerTrackingEvents)
    .where(
      and(
        eq(containerTrackingEvents.containerId, containerId),
        isNotNull(containerTrackingEvents.eventTime),
      ),
    )
    .orderBy(desc(containerTrackingEvents.eventTime))
    .limit(1);

  if (latest?.eventTime) {
    const eta = new Date(latest.eventTime).toISOString().slice(0, 10);
    await db
      .update(containers)
      .set({ eta, etaSource: "event" } as any)
      .where(eq(containers.id, containerId));
    console.log(`[ContainerTracking] Backfilled ETA from stored events → ${eta} (container ${containerId})`);
  }
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
