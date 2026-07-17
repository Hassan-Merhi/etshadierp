/**
 * Shared query-key factories for all heavy endpoints.
 *
 * Rules:
 *  - All callers of the same data MUST use exactly the same key so React Query
 *    deduplicates the request and shares the cache.
 *  - Filters are normalised before inclusion: undefined/null/empty values are
 *    dropped, object keys are sorted, primitives are used directly.
 *  - Never place a new object literal directly in a key on every render.
 */

// ── Normaliser ────────────────────────────────────────────────────────────────
export function normalizeFilters(
  filters: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!filters) return undefined;
  const clean: Record<string, unknown> = {};
  for (const k of Object.keys(filters).sort()) {
    const v = filters[k];
    if (v !== undefined && v !== null && v !== "") {
      clean[k] = v;
    }
  }
  return Object.keys(clean).length ? clean : undefined;
}

// ── Factory keys ──────────────────────────────────────────────────────────────
export const factoryKeys = {
  /** Paginated bale list.  Pass { date, page, limit, search, status, mixBatchId }. */
  bales: (companyId: number | string | undefined, filters?: Record<string, unknown>) =>
    ["/api/factory/bales", companyId, normalizeFilters(filters)] as const,

  /** Stock-allocation board.  Pass { hideZero, search, page, limit }. */
  stockAllocation: (companyId: number | string | undefined, filters?: Record<string, unknown>) =>
    ["/api/factory/v5/stock-allocation", companyId, normalizeFilters(filters)] as const,

  /** Factory day-book. */
  daybook: (companyId: number | string | undefined, filters?: Record<string, unknown>) =>
    ["/api/factory/daybook", companyId, normalizeFilters(filters)] as const,

  /** Bale stock-entry history. */
  stockEntryHistory: (companyId: number | string | undefined, filters?: Record<string, unknown>) =>
    ["/api/factory/bales/stock-entry-history", companyId, normalizeFilters(filters)] as const,
};

// ── Inventory keys ────────────────────────────────────────────────────────────
export const inventoryKeys = {
  list: (companyId: number | string | undefined, filters?: Record<string, unknown>) =>
    ["/api/inventory", companyId, normalizeFilters(filters)] as const,
};

// ── Stock-item keys ───────────────────────────────────────────────────────────
export const stockItemKeys = {
  /** Lightweight list (id + name + code) used for dropdowns. */
  light: (companyId: number | string | undefined) =>
    ["/api/stock-items", companyId, "light"] as const,

  /** Full list including all fields. */
  full: (companyId: number | string | undefined) =>
    ["/api/stock-items", companyId, "full"] as const,
};
