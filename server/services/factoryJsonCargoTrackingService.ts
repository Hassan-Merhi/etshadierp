/**
 * factoryJsonCargoTrackingService.ts — mirrors jsonCargoTrackingService.ts but operates
 * on factory_containers (arrivalDate is that table's ETA field; there is no etaSource
 * column on factory_containers, so a successful JSONCargo hit only updates arrivalDate).
 *
 * Same rules as the ERP version: never blank an existing ETA on null/error, weekly
 * cadence via JSONCARGO_REFRESH_HOURS, never expose the API key/raw response.
 */
import { db } from "../db";
import { factoryContainers } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import {
  track,
  isConfigured,
  isValidContainerNumber,
  normalizeJsonCargoCarrier,
  SUPPORTED_CARRIERS,
  type JsonCargoCarrier,
} from "../lib/trackingProviders/jsonCargoProvider";

const INACTIVE_STATUSES = ["offloaded", "closed", "completed"];

function refreshWindowHours(): number {
  const raw = process.env.JSONCARGO_REFRESH_HOURS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 168;
}

export type JsonCargoRefreshStatus =
  | "updated"
  | "unchanged"
  | "no_eta"
  | "not_found"
  | "skipped_recent"
  | "unsupported_carrier"
  | "inactive"
  | "invalid_container_number"
  | "not_configured"
  | "error";

export interface JsonCargoRefreshResult {
  containerId: number;
  containerNumber: string | null;
  status: JsonCargoRefreshStatus;
  oldEta: string | null;
  newEta: string | null;
  message: string;
}

function friendlyMessage(status: JsonCargoRefreshStatus, eta: string | null): string {
  switch (status) {
    case "updated":
      return `ETA updated to ${eta}.`;
    case "unchanged":
      return `ETA confirmed — still ${eta}.`;
    case "no_eta":
      return "JSONCargo has no ETA for this container yet. Existing ETA left unchanged.";
    case "not_found":
      return "JSONCargo could not find this container. Existing ETA left unchanged.";
    case "skipped_recent":
      return "Already checked recently — skipped to avoid unnecessary API calls.";
    case "unsupported_carrier":
      return "Carrier is not one of the JSONCargo-supported lines (Maersk, Hapag-Lloyd, MSC, CMA CGM).";
    case "inactive":
      return "Container is not active (offloaded/closed/completed) — tracking skipped.";
    case "invalid_container_number":
      return "Container number is not in a valid format for tracking.";
    case "not_configured":
      return "ETA tracking is temporarily unavailable.";
    case "error":
    default:
      return "Could not refresh ETA right now. Please try again later.";
  }
}

/**
 * Refresh a single factory container's ETA via JSONCargo, honoring the weekly refresh
 * window unless `forceRefresh` is set. Never blanks an existing ETA on failure/no-data.
 */
export async function refreshFactoryContainerEta(
  containerId: number,
  opts: { forceRefresh?: boolean; companyId?: number } = {}
): Promise<JsonCargoRefreshResult> {
  const whereClause = opts.companyId
    ? and(eq(factoryContainers.id, containerId), eq(factoryContainers.companyId, opts.companyId))
    : eq(factoryContainers.id, containerId);

  const [row] = await db
    .select({
      id: factoryContainers.id,
      companyId: factoryContainers.companyId,
      containerNumber: factoryContainers.containerNumber,
      status: factoryContainers.status,
      arrivalDate: factoryContainers.arrivalDate,
      trackingCarrierHint: factoryContainers.trackingCarrierHint,
      trackingEnabled: factoryContainers.trackingEnabled,
      jsonCargoLastCheckedAt: factoryContainers.jsonCargoLastCheckedAt,
    })
    .from(factoryContainers)
    .where(whereClause)
    .limit(1);

  if (!row) {
    throw new Error("Container not found");
  }

  const base = { containerId: row.id, containerNumber: row.containerNumber, oldEta: row.arrivalDate ?? null };

  if (INACTIVE_STATUSES.includes((row.status || "").toLowerCase())) {
    return { ...base, status: "inactive", newEta: row.arrivalDate ?? null, message: friendlyMessage("inactive", null) };
  }

  if (row.trackingEnabled === false && !opts.forceRefresh) {
    return {
      ...base,
      status: "inactive",
      newEta: row.arrivalDate ?? null,
      message: "Tracking is disabled for this container.",
    };
  }

  const carrier = normalizeJsonCargoCarrier(row.trackingCarrierHint);
  if (!carrier) {
    return {
      ...base,
      status: "unsupported_carrier",
      newEta: row.arrivalDate ?? null,
      message: friendlyMessage("unsupported_carrier", null),
    };
  }

  if (!isValidContainerNumber(row.containerNumber)) {
    return {
      ...base,
      status: "invalid_container_number",
      newEta: row.arrivalDate ?? null,
      message: friendlyMessage("invalid_container_number", null),
    };
  }

  if (!opts.forceRefresh && row.jsonCargoLastCheckedAt) {
    const elapsedMs = Date.now() - new Date(row.jsonCargoLastCheckedAt).getTime();
    const windowMs = refreshWindowHours() * 60 * 60 * 1000;
    if (elapsedMs < windowMs) {
      return {
        ...base,
        status: "skipped_recent",
        newEta: row.arrivalDate ?? null,
        message: friendlyMessage("skipped_recent", null),
      };
    }
  }

  if (!isConfigured()) {
    return {
      ...base,
      status: "not_configured",
      newEta: row.arrivalDate ?? null,
      message: friendlyMessage("not_configured", null),
    };
  }

  const result = await track(row.containerNumber, carrier);
  const now = new Date();

  if (!result.success) {
    if (result.errorCategory === "not_found") {
      await db
        .update(factoryContainers)
        .set({ jsonCargoLastCheckedAt: now, jsonCargoTrackingStatus: "NOT_FOUND", jsonCargoError: null })
        .where(eq(factoryContainers.id, row.id));
      return {
        ...base,
        status: "not_found",
        newEta: row.arrivalDate ?? null,
        message: friendlyMessage("not_found", null),
      };
    }

    await db
      .update(factoryContainers)
      .set({
        jsonCargoLastCheckedAt: now,
        jsonCargoTrackingStatus: "ERROR",
        jsonCargoError: result.errorCategory,
      })
      .where(eq(factoryContainers.id, row.id));
    return { ...base, status: "error", newEta: row.arrivalDate ?? null, message: friendlyMessage("error", null) };
  }

  if (!result.eta) {
    await db
      .update(factoryContainers)
      .set({ jsonCargoLastCheckedAt: now, jsonCargoTrackingStatus: "NO_ETA", jsonCargoError: null })
      .where(eq(factoryContainers.id, row.id));
    return { ...base, status: "no_eta", newEta: row.arrivalDate ?? null, message: friendlyMessage("no_eta", null) };
  }

  const changed = result.eta !== row.arrivalDate;
  await db
    .update(factoryContainers)
    .set({
      arrivalDate: result.eta,
      jsonCargoLastCheckedAt: now,
      jsonCargoTrackingStatus: "SUCCESS",
      jsonCargoError: null,
    })
    .where(eq(factoryContainers.id, row.id));

  return {
    ...base,
    status: changed ? "updated" : "unchanged",
    newEta: result.eta,
    message: friendlyMessage(changed ? "updated" : "unchanged", result.eta),
  };
}

const BULK_CONCURRENCY = 4;
const BULK_MAX_BATCH = 200;

export interface JsonCargoBulkSummary {
  total: number;
  updated: number;
  unchanged: number;
  noEta: number;
  notFound: number;
  skippedRecent: number;
  unsupportedCarrier: number;
  inactive: number;
  errors: number;
  results: JsonCargoRefreshResult[];
}

/**
 * Refresh ETAs for many factory containers with bounded concurrency and de-duplication.
 * If `containerIds` is omitted, refreshes every active, tracking-enabled container whose
 * carrier hint maps to a JSONCargo-supported carrier (scoped to companyId).
 */
export async function refreshMultipleFactoryContainerEtas(
  containerIds?: number[],
  opts: { forceRefresh?: boolean; companyId?: number } = {}
): Promise<JsonCargoBulkSummary> {
  let ids: number[];

  if (containerIds && containerIds.length > 0) {
    ids = Array.from(new Set(containerIds)).slice(0, BULK_MAX_BATCH);
  } else {
    const whereClauses = [
      eq(factoryContainers.trackingEnabled, true),
      opts.companyId ? eq(factoryContainers.companyId, opts.companyId) : undefined,
    ].filter(Boolean) as any[];

    const rows = await db
      .select({
        id: factoryContainers.id,
        status: factoryContainers.status,
        trackingCarrierHint: factoryContainers.trackingCarrierHint,
      })
      .from(factoryContainers)
      .where(and(...whereClauses));

    ids = rows
      .filter(
        (r) =>
          !INACTIVE_STATUSES.includes((r.status || "").toLowerCase()) &&
          !!normalizeJsonCargoCarrier(r.trackingCarrierHint)
      )
      .map((r) => r.id)
      .slice(0, BULK_MAX_BATCH);
  }

  const results: JsonCargoRefreshResult[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < ids.length) {
      const idx = cursor++;
      const id = ids[idx];
      try {
        const r = await refreshFactoryContainerEta(id, opts);
        results.push(r);
      } catch (err: any) {
        results.push({
          containerId: id,
          containerNumber: null,
          status: "error",
          oldEta: null,
          newEta: null,
          message: err?.message ?? "Refresh failed",
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, ids.length) }, () => worker()));

  const summary: JsonCargoBulkSummary = {
    total: results.length,
    updated: results.filter((r) => r.status === "updated").length,
    unchanged: results.filter((r) => r.status === "unchanged").length,
    noEta: results.filter((r) => r.status === "no_eta").length,
    notFound: results.filter((r) => r.status === "not_found").length,
    skippedRecent: results.filter((r) => r.status === "skipped_recent").length,
    unsupportedCarrier: results.filter((r) => r.status === "unsupported_carrier").length,
    inactive: results.filter((r) => r.status === "inactive").length,
    errors: results.filter((r) => r.status === "error" || r.status === "not_configured").length,
    results,
  };
  return summary;
}

export interface JsonCargoEtaSummary {
  configured: boolean;
  refreshWindowHours: number;
  supportedCarriers: JsonCargoCarrier[];
  eligibleContainers: number;
  byStatus: Record<string, number>;
}

/** Lightweight dashboard summary — no per-container detail, no secrets. */
export async function getFactoryEtaTrackingSummary(companyId?: number): Promise<JsonCargoEtaSummary> {
  const whereClauses = [companyId ? eq(factoryContainers.companyId, companyId) : undefined].filter(Boolean) as any[];

  const rows = await db
    .select({
      status: factoryContainers.status,
      trackingCarrierHint: factoryContainers.trackingCarrierHint,
      jsonCargoTrackingStatus: factoryContainers.jsonCargoTrackingStatus,
      trackingEnabled: factoryContainers.trackingEnabled,
    })
    .from(factoryContainers)
    .where(whereClauses.length ? and(...whereClauses) : undefined);

  const eligible = rows.filter(
    (r) =>
      r.trackingEnabled !== false &&
      !INACTIVE_STATUSES.includes((r.status || "").toLowerCase()) &&
      !!normalizeJsonCargoCarrier(r.trackingCarrierHint)
  );

  const byStatus: Record<string, number> = {};
  for (const r of eligible) {
    const key = r.jsonCargoTrackingStatus || "NEVER_CHECKED";
    byStatus[key] = (byStatus[key] || 0) + 1;
  }

  return {
    configured: isConfigured(),
    refreshWindowHours: refreshWindowHours(),
    supportedCarriers: SUPPORTED_CARRIERS,
    eligibleContainers: eligible.length,
    byStatus,
  };
}
