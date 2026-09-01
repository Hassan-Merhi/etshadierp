/**
 * requestCache — network-level deduplication and 10-second hard guard for large GET endpoints.
 *
 * Purpose:
 *   React Query already deduplicates queries that share an exact key.  This module
 *   adds a second safety net at the raw-fetch level so that two components using
 *   slightly different keys (or direct fetch() calls) never trigger two concurrent
 *   round-trips to the same heavy endpoint.
 *
 * API:
 *   invalidateLargeEndpointCache(prefix)  — call after a successful mutation so the
 *                                           next request bypasses the guard.
 */

// ── Heavy endpoint list ────────────────────────────────────────────────────────
// Only URLs whose pathname starts with one of these are subject to dedup/guard.
const HEAVY_PREFIXES = [
  "/api/factory/v5/stock-allocation",
  "/api/factory/bales",
  "/api/inventory",
  "/api/stock-items",
  "/api/factory/daybook",
  "/api/factory/bales/stock-entry-history",
] as const;

// Per-prefix short-term TTLs (ms) for the completed-response cache.
const TTL_MAP: Record<string, number> = {
  "/api/factory/v5/stock-allocation": 2 * 60 * 1000,
  "/api/factory/bales": 2 * 60 * 1000,
  "/api/inventory": 5 * 60 * 1000,
  "/api/stock-items": 10 * 60 * 1000,
  "/api/factory/daybook": 5 * 60 * 1000,
  "/api/factory/bales/stock-entry-history": 2 * 60 * 1000,
};

// Guard window: block a second identical request within this many ms.
const HARD_GUARD_MS = 10_000;

// ── State ──────────────────────────────────────────────────────────────────────
// url → in-flight Promise
const _inFlight = new Map<string, Promise<unknown>>();

// url → { data, fetchedAt }
const _cache = new Map<string, { data: unknown; fetchedAt: number }>();

// prefixes whose guard was cleared by a mutation
const _cleared = new Set<string>();

// ── Helpers ────────────────────────────────────────────────────────────────────
function _pathname(url: string): string {
  try {
    return url.startsWith("/")
      ? url.split("?")[0]
      : new URL(url, window.location.origin).pathname;
  } catch {
    return url;
  }
}

function _matchPrefix(url: string): string | null {
  const p = _pathname(url);
  return HEAVY_PREFIXES.find((ep) => p === ep || p.startsWith(ep + "?") || p.startsWith(ep + "/")) ?? null;
}

function _ttl(prefix: string): number {
  return TTL_MAP[prefix] ?? 5 * 60 * 1000;
}

function _isGuarded(url: string): boolean {
  const prefix = _matchPrefix(url);
  if (!prefix || _cleared.has(prefix)) return false;
  const entry = _cache.get(url);
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < HARD_GUARD_MS;
}

function _isCacheValid(url: string): boolean {
  const prefix = _matchPrefix(url);
  if (!prefix) return false;
  const entry = _cache.get(url);
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < _ttl(prefix);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Call this after any mutation that affects a heavy endpoint so the next
 * request bypasses the 10-second guard and returns fresh data.
 */
export function invalidateLargeEndpointCache(prefix: string): void {
  _cleared.add(prefix);
  for (const key of _cache.keys()) {
    if (_pathname(key).startsWith(prefix)) {
      _cache.delete(key);
    }
  }
  // Remove the bypass marker after 30 s so the guard re-engages.
  setTimeout(() => _cleared.delete(prefix), 30_000);
}

/**
 * Log response sizes for heavy endpoints in development so bandwidth regressions
 * are visible in the browser console without any production overhead.
 */
export function logHeavyResponse(url: string, data: unknown): void {
  if (!import.meta.env.DEV) return;
  const prefix = _matchPrefix(url);
  if (!prefix) return;
  try {
    const kb = Math.round(JSON.stringify(data).length / 1024);
    const icon = kb > 200 ? "🔴" : kb > 100 ? "🟡" : "🟢";
    console.info(`[requestCache] ${icon} ${kb} KB ← ${_pathname(url)}`);
  } catch {
    /* ignore */
  }
}

/**
 * A fetch wrapper that adds in-flight deduplication and a 10-second hard guard
 * for heavy endpoints.  Non-heavy endpoints pass through to plain fetch unchanged.
 *
 * Returns parsed JSON.
 */
export async function guardedFetch(
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  const prefix = _matchPrefix(url);

  // ── Not a heavy endpoint: pass through ───────────────────────────────────
  if (!prefix) {
    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text();
      let msg: string;
      try {
        msg = JSON.parse(text).message || text;
      } catch {
        msg = text;
      }
      throw new Error(msg || `${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  // ── Hard guard: same URL hit within 10 s since last completed fetch ───────
  if (_isGuarded(url)) {
    if (import.meta.env.DEV) {
      const age = Date.now() - (_cache.get(url)?.fetchedAt ?? 0);
      console.debug(`[requestCache] ⛔ guard (${age}ms old) ${_pathname(url)}`);
    }
    return _cache.get(url)!.data;
  }

  // ── TTL cache hit ─────────────────────────────────────────────────────────
  if (_isCacheValid(url)) {
    if (import.meta.env.DEV) {
      console.debug(`[requestCache] ✅ cache hit ${_pathname(url)}`);
    }
    return _cache.get(url)!.data;
  }

  // ── In-flight deduplication ───────────────────────────────────────────────
  const existing = _inFlight.get(url);
  if (existing) {
    if (import.meta.env.DEV) {
      console.debug(`[requestCache] 🔗 dedup (joining in-flight) ${_pathname(url)}`);
    }
    return existing;
  }

  // ── New request ───────────────────────────────────────────────────────────
  const promise = (async () => {
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const text = await res.text();
        let msg: string;
        try {
          msg = JSON.parse(text).message || text;
        } catch {
          msg = text;
        }
        throw new Error(msg || `${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      _cache.set(url, { data, fetchedAt: Date.now() });
      logHeavyResponse(url, data);
      return data;
    } finally {
      _inFlight.delete(url);
    }
  })();

  _inFlight.set(url, promise);
  return promise;
}
