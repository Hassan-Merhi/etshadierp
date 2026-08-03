import { containers } from "../../../shared/schema";
import { sql } from "drizzle-orm";

// ── Inactive status — case-insensitive throughout ─────────────────────────────

const INACTIVE_LOWER = ["offloaded", "closed", "completed"] as const;

export function isInactiveStatus(status: string): boolean {
  return INACTIVE_LOWER.includes(status.toLowerCase() as any);
}

export const activeStatusFilter = sql`LOWER(${containers.status}) NOT IN ('offloaded','closed','completed')`;

// ── Container number validation ───────────────────────────────────────────────

const VALID_CONTAINER_REGEX = /^[A-Z]{4}\d{7}$/;
export const CMA_PREFIXES = /^(CMAU|CMDU|APZU|CGMU|APMU|APHU|CXDU|CAAU|CAJU|CAIU)/i;

export function isValidContainerNumber(containerNumber: string | null | undefined): boolean {
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
export function ep(containerId: number, label: string, status: ProgressStep["status"], detail?: string | null): void {
  let steps = _progressStore.get(containerId);
  if (!steps) {
    steps = [];
    _progressStore.set(containerId, steps);
  }
  const step: ProgressStep = { label, status, detail: detail ?? null, ts: Date.now() };
  const idx = steps.findIndex((s) => s.label === label && s.status === "running");
  if (idx >= 0) steps[idx] = step;
  else steps.push(step);
}

// ── ParcelsApp quota — sourced from DB, not memory ───────────────────────────

/**
 * Count ParcelsApp credits used this calendar month.
 * Only rows where provider='parcelsapp' AND status IN ('success','error','timeout')
 * count as a consumed credit. Skipped/invalid rows never count.
 */
