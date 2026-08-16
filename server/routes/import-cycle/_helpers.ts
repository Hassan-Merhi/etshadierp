/**
 * Shared state and helpers for the importCycleRoutes routes.
 *
 * Extracted verbatim from the former single-file importCycleRoutes.ts.
 */
import {} from "@shared/schema";

// ---------------------------------------------------------------------------
// Lightweight in-process TTL cache — same 30s pattern as statsRoutes.ts.
// Keyed by companyId. Multiple dashboard users share one DB round-trip.
// ---------------------------------------------------------------------------
export const _icCache = new Map<string, { data: unknown; expiresAt: number }>();
export function _getCached(key: string): any | null {
  const e = _icCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    _icCache.delete(key);
    return null;
  }
  return e.data;
}
export function _setCached(key: string, data: unknown, ttlMs = 30_000): void {
  _icCache.set(key, { data, expiresAt: Date.now() + ttlMs });
  if (_icCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of _icCache) {
      if (v.expiresAt < now) _icCache.delete(k);
    }
  }
}
