import { db } from "../../db";
import { getErrorMessage } from "../../lib/httpHandlers";
import { logger } from "../../lib/logger";
import { containers } from "../../../shared/schema";
import { and, eq } from "drizzle-orm";
import { getTrackingPriority, calcPerRunBudget } from "../../lib/trackingPriority";
import { calcMaxOffloadDate, calcIsOverdue, calcDocsReadyNotSent } from "../../lib/gitHelpers";

import { saveTrackingCheck, sleep } from "./persistence";
import { anyProviderConfigured, getParcelsAppUsageStats, setSchedulerMeta } from "./quotas";
import { trackOneContainer } from "./track-one";
import { activeStatusFilter, isValidContainerNumber } from "./validation-progress";

export async function trackDueContainers(): Promise<void> {
  logger.info("[ContainerTracking] Starting smart priority scheduler run...");

  if (!anyProviderConfigured()) {
    logger.info("[ContainerTracking] No tracking providers configured — skipping.");
    return;
  }

  const now = new Date();

  // ── Quota and per-run budget ───────────────────────────────────────────────
  const { used, limit } = await getParcelsAppUsageStats();
  const remaining = Math.max(0, limit - used);
  const { perRunBudget } = calcPerRunBudget(remaining, now);

  logger.info("[ContainerTracking] Provider quota evaluated for this scheduler run.");

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
  } catch (err: unknown) {
    logger.error("[ContainerTracking] Failed to fetch containers:", { error: getErrorMessage(err) });
    return;
  }

  if (allRows.length === 0) {
    logger.info("[ContainerTracking] No active tracking-enabled containers.");
    return;
  }

  logger.info(`[ContainerTracking] ${allRows.length} active tracking-enabled containers found.`);

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
        null
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
      now
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
    logger.info(
      `[ContainerTracking] No containers eligible this run ` +
        `(invalid=${countInvalid}, auto_update_off=${countDisabled}, checked_recently=${countRecent}).`
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
  const quotaEligible = eligible.filter(({ row }) => !SCHED_MAERSK_PREFIXES.test(row.containerNumber));

  const toTrackQuota = quotaEligible.slice(0, perRunBudget);
  const budgetSkipped = quotaEligible.slice(perRunBudget);
  const toTrack = [...maerskEligible, ...toTrackQuota];

  // Save skip records for containers that didn't make the budget cut
  for (const { row } of budgetSkipped) {
    await saveTrackingCheck(
      row.id,
      "skipped",
      "skipped_priority_budget",
      "Skipped because lower priority this run",
      null
    );
    await setSchedulerMeta(row.id, "skipped_priority_budget", undefined);
  }

  logger.info(
    `[ContainerTracking] Eligible: ${eligible.length} (priority-carrier=${maerskEligible.length}, ` +
      `quota-eligible=${quotaEligible.length}), tracking: ${toTrack.length}, ` +
      `deferred-by-priority: ${budgetSkipped.length}, recent: ${countRecent}, ` +
      `invalid: ${countInvalid}, disabled: ${countDisabled}.`
  );

  if (toTrack.length > 0) {
    logger.info(
      `[ContainerTracking] Tracking: ` +
        toTrack
          .map(({ row, priority }) => `${row.containerNumber}(${priority.priorityLabel}/${priority.priorityScore})`)
          .join(", ")
    );
  }

  // ── Track each container in the budget window ───────────────────────────────
  for (const { row, priority } of toTrack) {
    try {
      await trackOneContainer(row.id, row.containerNumber, row.trackingCarrierHint ?? undefined);
      // Clear skip reason; record when the scheduler plans to check again
      await setSchedulerMeta(row.id, null, priority.nextRecommendedCheckAt);
    } catch (err: unknown) {
      logger.error(`[ContainerTracking] Error tracking ${row.containerNumber}:`, { error: getErrorMessage(err) });
    }
    await sleep(1_500);
  }

  logger.info("[ContainerTracking] Smart priority scheduler run complete.");
}

/**
 * Enable or disable auto-tracking for all non-inactive containers.
 */
