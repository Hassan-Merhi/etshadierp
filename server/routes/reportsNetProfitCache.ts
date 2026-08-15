/**
 * Shared short-lived (30s) cache for net-profit-statement report queries.
 *
 * Used by both the main statement route (reportsRoutes.ts) and the
 * account-level drill-down routes (reportsNetProfitStatementRoutes.ts), so it
 * lives here to avoid a circular import between the two.
 */
const _npsCache = new Map<string, { data: any; expiresAt: number }>();

export function _npsCached(key: string) {
  const c = _npsCache.get(key);
  return c && Date.now() < c.expiresAt ? c.data : null;
}

export function _npsSetCache(key: string, data: any) {
  _npsCache.set(key, { data, expiresAt: Date.now() + 30_000 });
  if (_npsCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of _npsCache) if (now >= v.expiresAt) _npsCache.delete(k);
  }
}
