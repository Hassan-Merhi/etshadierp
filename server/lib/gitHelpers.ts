/**
 * gitHelpers.ts — Shared helpers for GIT (Global In-Transit) read routes.
 *
 * Read-only. No INSERT / UPDATE / DELETE anywhere in this file.
 * All DB calls are SELECT-only.
 */

import { db } from "../db";
import { containers, companies, userCompanyRoles } from "../../shared/schema";
import { and, eq, inArray } from "drizzle-orm";

// ── Status constants ──────────────────────────────────────────────────────────

export const ACTIVE_STATUSES = [
  "OTW",
  "Sea",
  "At Port",
  "Left Dar",
  "At Border",
  "In Transit",
  "Arrived",
] as const;

export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

export const INACTIVE_STATUSES = ["Offloaded", "Closed", "Completed"] as const;
export const INACTIVE_SET = new Set<string>(INACTIVE_STATUSES);

// ── Transporter SLA windows (days from borderDate to maxOffloadDate) ──────────

const TRANSPORTER_OFFLOAD_DAYS: Record<string, number> = {
  FARHAT: 11,
  CONTINENTAL: 11,
  TRH: 14,
};
const DEFAULT_OFFLOAD_DAYS = 14;

// ── Access control ────────────────────────────────────────────────────────────

/**
 * Returns company IDs the user may access.
 * - Admin / Developer: all companies that have at least one active container.
 * - Owner: companies from user_company_roles only.
 */
export async function getAccessibleCompanyIds(
  userId: string,
  role: string,
): Promise<number[]> {
  const isAdminOrDev = role === "Admin" || role === "Developer";

  if (isAdminOrDev) {
    const rows = await db
      .selectDistinct({ companyId: containers.companyId })
      .from(containers)
      .where(inArray(containers.status, [...ACTIVE_STATUSES]));
    return rows.map((r) => r.companyId);
  }

  const rows = await db
    .select({ companyId: userCompanyRoles.companyId })
    .from(userCompanyRoles)
    .where(eq(userCompanyRoles.userId, userId));
  return rows.map((r) => r.companyId);
}

/**
 * Resolves company scope from request query params.
 *
 * Returns one of:
 *   { mode: "all",    companyIds: number[] }
 *   { mode: "single", companyId: number }
 *   { error: string,  status: number }       ← caller should return this as HTTP error
 */
export async function resolveGitCompanyScope(
  userId: string,
  role: string,
  query: Record<string, string | string[] | undefined>,
  sessionCompanyId: number | undefined,
): Promise<
  | { mode: "all"; companyIds: number[] }
  | { mode: "single"; companyId: number }
  | { error: string; status: number }
> {
  const isAdminOrDev = role === "Admin" || role === "Developer";
  const wantsAll = query.allCompanies === "true";
  const rawId =
    typeof query.companyId === "string" ? query.companyId : undefined;
  const requestedId = rawId ? parseInt(rawId, 10) : undefined;

  if (wantsAll) {
    const ids = await getAccessibleCompanyIds(userId, role);
    return { mode: "all", companyIds: ids };
  }

  if (requestedId !== undefined && !isNaN(requestedId)) {
    if (!isAdminOrDev) {
      const access = await db
        .select({ id: userCompanyRoles.id })
        .from(userCompanyRoles)
        .where(
          and(
            eq(userCompanyRoles.userId, userId),
            eq(userCompanyRoles.companyId, requestedId),
          ),
        )
        .limit(1);
      if (access.length === 0) {
        return { error: "Access denied to this company", status: 403 };
      }
    }
    return { mode: "single", companyId: requestedId };
  }

  if (!sessionCompanyId) {
    return { error: "Company ID required", status: 400 };
  }
  return { mode: "single", companyId: sessionCompanyId };
}

// ── Calculation helpers ───────────────────────────────────────────────────────

/**
 * Adds the transporter SLA days to borderDate.
 * Returns null if borderDate is absent or invalid.
 */
export function calcMaxOffloadDate(
  borderDate: string | null,
  transporter: string | null,
): string | null {
  if (!borderDate) return null;
  const d = new Date(borderDate);
  if (isNaN(d.getTime())) return null;
  const norm = (transporter ?? "").trim().toUpperCase();
  const days = TRANSPORTER_OFFLOAD_DAYS[norm] ?? DEFAULT_OFFLOAD_DAYS;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Days elapsed since maxOffloadDate.
 * Returns null when:
 *   - truck is already assigned (numberPlate is set)
 *   - maxOffloadDate has not yet passed
 *   - maxOffloadDate is unknown
 */
export function calcDaysDelayed(
  maxOffloadDate: string | null,
  numberPlate: string | null,
): number | null {
  if (numberPlate && numberPlate.trim()) return null;
  if (!maxOffloadDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const max = new Date(maxOffloadDate);
  if (isNaN(max.getTime())) return null;
  const diffMs = today.getTime() - max.getTime();
  if (diffMs <= 0) return null;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * True when documents are received from the agent but not yet sent onward.
 */
export function calcDocsReadyNotSent(
  docReceived: boolean | null,
  docsSentDate: string | null,
): boolean {
  return docReceived === true && !docsSentDate;
}

/**
 * True when maxOffloadDate has passed and the container is still active.
 */
export function calcIsOverdue(
  maxOffloadDate: string | null,
  status: string,
): boolean {
  if (!maxOffloadDate || INACTIVE_SET.has(status)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const max = new Date(maxOffloadDate);
  if (isNaN(max.getTime())) return false;
  return max < today;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type RawContainerRow = {
  id: number;
  companyId: number;
  containerNumber: string;
  supplierId: number;
  status: string;
  importDate: string;
  grandTotal: string | null;
  itemName: string | null;
  shopName: string | null;
  eta: string | null;
  etaSource: string | null;
  transporter: string | null;
  transportFee: string | null;
  numberPlate: string | null;
  trackingLocation: string | null;
  borderDate: string | null;
  offloadDate: string | null;
  agent: string | null;
  dutyFee: string | null;
  docReceived: boolean | null;
  trackingDescription: string | null;
  docsSentDate: string | null;
  freightStatus: string | null;
  trackingLink: string | null;
  // ParcelsApp tracking fields
  trackingProvider: string | null;
  trackingEnabled: boolean;
  trackingAutoUpdate: boolean;
  trackingCarrierHint: string | null;
  trackingLastCheckedAt: Date | null;
  trackingLastStatus: string | null;
  trackingLastLocation: string | null;
  trackingLastEventDate: Date | null;
  trackingLastDescription: string | null;
  trackingError: string | null;
  trackingChangedAt: Date | null;
  createdAt: Date;
};

export type EnrichedContainer = RawContainerRow & {
  companyName: string;
  maxOffloadDate: string | null;
  daysDelayed: number | null;
  docsReadyNotSent: boolean;
  isOverdue: boolean;
};

// ── DB helpers ────────────────────────────────────────────────────────────────

/**
 * Fetches all active containers for the given company IDs.
 * SELECT-only. No mutations.
 */
export async function fetchActiveContainers(
  companyIds: number[],
  opts: { includeOffloaded?: boolean } = {},
): Promise<RawContainerRow[]> {
  if (companyIds.length === 0) return [];

  const statusFilter = opts.includeOffloaded
    ? [...ACTIVE_STATUSES, ...INACTIVE_STATUSES]
    : [...ACTIVE_STATUSES];

  return db
    .select({
      id: containers.id,
      companyId: containers.companyId,
      containerNumber: containers.containerNumber,
      supplierId: containers.supplierId,
      status: containers.status,
      importDate: containers.importDate,
      grandTotal: containers.grandTotal,
      itemName: containers.itemName,
      shopName: containers.shopName,
      eta: containers.eta,
      etaSource: containers.etaSource,
      transporter: containers.transporter,
      transportFee: containers.transportFee,
      numberPlate: containers.numberPlate,
      trackingLocation: containers.trackingLocation,
      borderDate: containers.borderDate,
      offloadDate: containers.offloadDate,
      agent: containers.agent,
      dutyFee: containers.dutyFee,
      docReceived: containers.docReceived,
      trackingDescription: containers.trackingDescription,
      docsSentDate: containers.docsSentDate,
      freightStatus: containers.freightStatus,
      trackingLink: containers.trackingLink,
      // ParcelsApp tracking fields
      trackingProvider: containers.trackingProvider,
      trackingEnabled: containers.trackingEnabled,
      trackingAutoUpdate: containers.trackingAutoUpdate,
      trackingCarrierHint: containers.trackingCarrierHint,
      trackingLastCheckedAt: containers.trackingLastCheckedAt,
      trackingLastStatus: containers.trackingLastStatus,
      trackingLastLocation: containers.trackingLastLocation,
      trackingLastEventDate: containers.trackingLastEventDate,
      trackingLastDescription: containers.trackingLastDescription,
      trackingError: containers.trackingError,
      trackingChangedAt: containers.trackingChangedAt,
      createdAt: containers.createdAt,
    })
    .from(containers)
    .where(
      and(
        inArray(containers.companyId, companyIds),
        inArray(containers.status, statusFilter),
      ),
    )
    .orderBy(containers.containerNumber);
}

/**
 * Returns a map of companyId → name for the given IDs.
 * SELECT-only.
 */
export async function loadCompanyNames(
  ids: number[],
): Promise<Record<number, string>> {
  if (ids.length === 0) return {};
  const rows = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(inArray(companies.id, ids));
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

/**
 * Attaches computed fields and company name to each raw container row.
 */
export function enrichContainers(
  rows: RawContainerRow[],
  nameMap: Record<number, string>,
): EnrichedContainer[] {
  return rows.map((r) => {
    const maxOffloadDate = calcMaxOffloadDate(r.borderDate, r.transporter);
    return {
      ...r,
      companyName: nameMap[r.companyId] ?? `Company ${r.companyId}`,
      maxOffloadDate,
      daysDelayed: calcDaysDelayed(maxOffloadDate, r.numberPlate),
      docsReadyNotSent: calcDocsReadyNotSent(r.docReceived, r.docsSentDate),
      isOverdue: calcIsOverdue(maxOffloadDate, r.status),
    };
  });
}

// ── Filter ────────────────────────────────────────────────────────────────────

export interface GitFilterQuery {
  status?: string;
  transporter?: string;
  agent?: string;
  location?: string;
  search?: string;
  q?: string;
  docsReady?: string;
  delayed?: string;
  overdue?: string;
}

export function applyGitFilters(
  rows: EnrichedContainer[],
  f: GitFilterQuery,
): EnrichedContainer[] {
  let out = rows;

  if (f.status) {
    const s = f.status.toLowerCase();
    out = out.filter((r) => r.status.toLowerCase() === s);
  }
  if (f.transporter) {
    const t = f.transporter.toLowerCase();
    out = out.filter((r) => (r.transporter ?? "").toLowerCase().includes(t));
  }
  if (f.agent) {
    const a = f.agent.toLowerCase();
    out = out.filter((r) => (r.agent ?? "").toLowerCase().includes(a));
  }
  if (f.location) {
    const l = f.location.toLowerCase();
    out = out.filter((r) =>
      (r.trackingLocation ?? "").toLowerCase().includes(l),
    );
  }

  const term = f.search || f.q;
  if (term) {
    const s = term.toLowerCase();
    out = out.filter(
      (r) =>
        r.containerNumber.toLowerCase().includes(s) ||
        (r.shopName ?? "").toLowerCase().includes(s) ||
        (r.agent ?? "").toLowerCase().includes(s) ||
        (r.transporter ?? "").toLowerCase().includes(s),
    );
  }

  if (f.docsReady === "true") {
    out = out.filter((r) => r.docsReadyNotSent);
  }
  if (f.delayed === "true") {
    out = out.filter((r) => r.daysDelayed !== null && r.daysDelayed > 0);
  }
  if (f.overdue === "true") {
    out = out.filter((r) => r.isOverdue);
  }

  return out;
}

// ── Summary builder ───────────────────────────────────────────────────────────

export interface GitSummary {
  total: number;
  byStatus: Record<string, number>;
  delayed: number;
  overdue: number;
  docsReadyNotSent: number;
  withTruck: number;
  withoutTruck: number;
}

export function buildSummary(rows: EnrichedContainer[]): GitSummary {
  const byStatus: Record<string, number> = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }
  return {
    total: rows.length,
    byStatus,
    delayed: rows.filter((r) => r.daysDelayed !== null && r.daysDelayed > 0)
      .length,
    overdue: rows.filter((r) => r.isOverdue).length,
    docsReadyNotSent: rows.filter((r) => r.docsReadyNotSent).length,
    withTruck: rows.filter((r) => !!(r.numberPlate ?? "").trim()).length,
    withoutTruck: rows.filter((r) => !(r.numberPlate ?? "").trim()).length,
  };
}
