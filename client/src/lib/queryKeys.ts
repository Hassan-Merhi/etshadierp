/**
 * Shared query-key factories for all heavy endpoints.
 *
 * Rules:
 *  - All callers of the same data MUST use exactly the same key so React Query
 *    deduplicates the request and shares the cache.
 *  - The first element of every key MUST be the real URL that the shared
 *    getQueryFn will fetch.  Do NOT put a fake discriminator after the URL
 *    while relying on the shared query function.
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
  /**
   * Lightweight list (id, code, name, uom, barcode, active, stockGroupId,
   * categoryId, gradeId) — for dropdowns and selectors only.
   *
   * The first element is the real URL fetched by the shared query function.
   * This key does NOT share a cache with the full endpoint so broad
   * invalidations of "/api/stock-items" do not trigger a 649 KB download.
   */
  light: (companyId: number | string | undefined) =>
    ["/api/stock-items/light", companyId] as const,

  /**
   * Full list including all fields.  Only used by screens that genuinely need
   * price/costing/alias/location-pricing data.
   *
   * Prefer the paginated management-page query ("/api/stock-items?page=…")
   * over this key for list screens.
   */
  full: (companyId: number | string | undefined) =>
    ["/api/stock-items", companyId] as const,
};
