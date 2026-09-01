/**
 * trackingPriority.ts — Priority scoring for the smart container tracking scheduler.
 *
 * Pure functions only — no DB access, no side effects.
 * Used by both the server scheduler and exported for testing.
 *
 * Priority tiers:
 *   High   (score 90-100, interval 24h) — needs daily tracking
 *   Medium (score 50-80,  interval 48h) — needs tracking every 2 days
 *   Low    (score 10-40,  interval 72-120h) — needs tracking every 3-5 days
 */

export type PriorityTier = "high" | "medium" | "low";

export interface PriorityInput {
  status: string;
  eta: string | null;
  isOverdue: boolean;
  docsReadyNotSent: boolean;
  numberPlate: string | null;
  trackingLastCheckedAt: Date | null;
  trackingChangedAt: Date | null;
}

export interface PriorityResult {
  priorityScore: number;
  priorityTier: PriorityTier;
  priorityLabel: string;
  minimumIntervalHours: number;
  reason: string;
  nextRecommendedCheckAt: Date;
}

/**
 * Computes the tracking priority for a single container.
 * Returns a deterministic result based on current container fields.
 */
export function getTrackingPriority(container: PriorityInput, now: Date): PriorityResult {
  const { status, eta, isOverdue, docsReadyNotSent, numberPlate, trackingChangedAt } = container;

  const statusLower = status.toLowerCase();

  // Parse ETA date
  let etaDate: Date | null = null;
  if (eta) {
    const d = new Date(eta);
    if (!isNaN(d.getTime())) etaDate = d;
  }

  const daysUntilEta = etaDate !== null ? Math.ceil((etaDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;

  const etaPassed = daysUntilEta !== null && daysUntilEta < 0;
  const hasTruck = !!(numberPlate && numberPlate.trim());

  // Recently changed tracking status (within 72 hours)
  const recentlyChanged =
    trackingChangedAt !== null && now.getTime() - trackingChangedAt.getTime() < 72 * 60 * 60 * 1000;

  // ── HIGH PRIORITY — interval 24h ────────────────────────────────────────────

  // ETA passed with no truck assigned
  if (etaPassed && !hasTruck) {
    return make(100, "high", 24, "ETA passed — no truck assigned", now);
  }

  // Container is overdue (past transporter SLA)
  if (isOverdue) {
    return make(100, "high", 24, "Container is overdue", now);
  }

  // Docs received but not sent
  if (docsReadyNotSent) {
    return make(95, "high", 24, "Docs ready — not yet sent", now);
  }

  // Near-delivery statuses
  if (statusLower === "at port") {
    return make(95, "high", 24, "At Port — arrival imminent", now);
  }
  if (statusLower === "left dar") {
    return make(93, "high", 24, "Left Dar — final delivery leg", now);
  }
  if (statusLower === "at border") {
    return make(93, "high", 24, "At Border — clearing customs", now);
  }
  if (statusLower === "in transit") {
    return make(90, "high", 24, "In Transit — active movement", now);
  }

  // ETA within 3 days
  if (daysUntilEta !== null && daysUntilEta >= 0 && daysUntilEta <= 3) {
    return make(90, "high", 24, `ETA in ${daysUntilEta} day${daysUntilEta !== 1 ? "s" : ""}`, now);
  }

  // ── MEDIUM PRIORITY — interval 48h ─────────────────────────────────────────

  // ETA within 7 days
  if (daysUntilEta !== null && daysUntilEta >= 0 && daysUntilEta <= 7) {
    return make(70, "medium", 48, `ETA in ${daysUntilEta} days`, now);
  }

  // Arrived — container at destination, awaiting offload
  if (statusLower === "arrived") {
    return make(65, "medium", 48, "Arrived — awaiting offload", now);
  }

  // ETA within 14 days
  if (daysUntilEta !== null && daysUntilEta >= 0 && daysUntilEta <= 14) {
    return make(60, "medium", 48, `ETA in ${daysUntilEta} days`, now);
  }

  // Recently changed tracking status (but not close to ETA)
  if (recentlyChanged) {
    return make(55, "medium", 48, "Tracking status changed recently", now);
  }

  // ── LOW PRIORITY — interval 72-120h ────────────────────────────────────────

  // Known ETA but far away
  if (daysUntilEta !== null && daysUntilEta > 14) {
    const intervalHours = daysUntilEta > 21 ? 120 : 96;
    return make(30, "low", intervalHours, `ETA in ${daysUntilEta} days`, now);
  }

  // No ETA — check infrequently
  return make(15, "low", 120, "No ETA set", now);
}

// ── Budget helpers ─────────────────────────────────────────────────────────────

/**
 * Calculates how many ParcelsApp credits the scheduler should use per run.
 *
 * Formula:
 *   dailyBudget = floor(remaining / remainingDays)
 *   perRunBudget = max(1, floor(dailyBudget / 4))     ← 4 runs/day
 *
 * Minimum: always allows 1 container per run so progress never stalls.
 */
export function calcPerRunBudget(
  remaining: number,
  now: Date
): { remainingDays: number; dailyBudget: number; perRunBudget: number } {
  const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const remainingDays = Math.max(1, Math.ceil((endOfMonth.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
  const dailyBudget = Math.floor(remaining / remainingDays);
  const perRunBudget = Math.max(1, Math.floor(dailyBudget / 4));
  return { remainingDays, dailyBudget, perRunBudget };
}

// ── Internal ──────────────────────────────────────────────────────────────────

const TIER_LABELS: Record<PriorityTier, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

function make(score: number, tier: PriorityTier, intervalHours: number, reason: string, now: Date): PriorityResult {
  return {
    priorityScore: score,
    priorityTier: tier,
    priorityLabel: TIER_LABELS[tier],
    minimumIntervalHours: intervalHours,
    reason,
    nextRecommendedCheckAt: new Date(now.getTime() + intervalHours * 60 * 60 * 1000),
  };
}
