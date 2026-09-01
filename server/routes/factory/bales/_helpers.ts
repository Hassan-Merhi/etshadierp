/**
 * Shared state and helpers for the factoryBalesRoutes routes.
 *
 * Extracted verbatim from the former single-file factoryBalesRoutes.ts.
 */

// ---------------------------------------------------------------------------
// Lightweight in-process TTL cache for expensive dashboard KPI endpoint
// ---------------------------------------------------------------------------
export const _kpiCache = new Map<string, { data: unknown; expiresAt: number }>();
export function _getKpiCached(key: string): unknown | null {
  const e = _kpiCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    _kpiCache.delete(key);
    return null;
  }
  return e.data;
}
export function _setKpiCached(key: string, data: unknown, ttlMs = 30_000): void {
  _kpiCache.set(key, { data, expiresAt: Date.now() + ttlMs });
  if (_kpiCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of _kpiCache) {
      if (v.expiresAt < now) _kpiCache.delete(k);
    }
  }
}
