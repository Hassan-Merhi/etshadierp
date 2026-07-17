import type { Request } from "express";

interface CachePolicy {
  name: string;
  ttlMs: number;
}

interface CacheEntry {
  resource: string;
  body: unknown;
  bytes: number;
  expiresAt: number;
  createdAt: number;
}

const MB = 1024 * 1024;
const maxEntryBytes = Math.max(1, Number(process.env.HEAVY_READ_CACHE_MAX_ENTRY_MB || 4)) * MB;
const maxTotalBytes = Math.max(4, Number(process.env.HEAVY_READ_CACHE_MAX_TOTAL_MB || 16)) * MB;

const cache = new Map<string, CacheEntry>();
let totalBytes = 0;

function companyScope(req: Request): string {
  const session = (req as any).session;
  return String(session?.factoryCompanyId || session?.currentCompanyId || "global");
}

function authenticatedScope(req: Request): string | null {
  const session = (req as any).session;
  const user = (req as any).user;
  const userId = user?.id || session?.userId;
  if (userId === undefined || userId === null || userId === "") return null;

  const role = session?.currentRole || user?.role || "unknown";
  return `${String(userId)}:${String(role)}`;
}

function classify(req: Request): CachePolicy | null {
  if (req.method !== "GET") return null;
  const path = req.path;
  if (path === "/api/factory/net-position") return { name: "net-position", ttlMs: 30_000 };
  if (path === "/api/factory/raw-stock") return { name: "raw-stock", ttlMs: 20_000 };
  if (path === "/api/factory/bale-ledger") return { name: "bale-ledger", ttlMs: 30_000 };
  if (path === "/api/factory/bale-stock-count") return { name: "bale-stock-count", ttlMs: 10_000 };
  if (/^\/api\/factory\/customer-orders\/\d+$/.test(path)) {
    return { name: "customer-order-detail", ttlMs: 10_000 };
  }
  if (path === "/api/factory/customer-orders") return { name: "customer-orders-list", ttlMs: 10_000 };
  return null;
}

function keyFor(req: Request, policy: CachePolicy, authScope: string): string {
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  return `${policy.name}:company=${companyScope(req)}:user=${authScope}:${req.path}${query}`;
}

function removeKey(key: string): void {
  const existing = cache.get(key);
  if (!existing) return;
  totalBytes = Math.max(0, totalBytes - existing.bytes);
  cache.delete(key);
}

function pruneExpired(now = Date.now()): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) removeKey(key);
  }
}

function enforceBudget(): void {
  while (totalBytes > maxTotalBytes && cache.size > 0) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    removeKey(oldestKey);
  }
}

export function getHeavyReadCache(req: Request): { body: unknown; ageMs: number } | null {
  const policy = classify(req);
  const authScope = authenticatedScope(req);
  if (!policy || !authScope) return null;

  const now = Date.now();
  pruneExpired(now);
  const key = keyFor(req, policy, authScope);
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= now) {
    if (entry) removeKey(key);
    return null;
  }

  // Refresh insertion order so budget eviction behaves like a small LRU.
  cache.delete(key);
  cache.set(key, entry);
  return { body: entry.body, ageMs: now - entry.createdAt };
}

export function storeHeavyReadCache(req: Request, body: unknown, bytes: number): boolean {
  const policy = classify(req);
  const authScope = authenticatedScope(req);
  if (
    !policy ||
    !authScope ||
    !Number.isFinite(bytes) ||
    bytes <= 0 ||
    bytes > maxEntryBytes
  ) {
    return false;
  }

  const key = keyFor(req, policy, authScope);
  removeKey(key);
  const now = Date.now();
  cache.set(key, {
    resource: policy.name,
    body,
    bytes,
    createdAt: now,
    expiresAt: now + policy.ttlMs,
  });
  totalBytes += bytes;
  enforceBudget();
  return true;
}

export function invalidateHeavyReadCache(req?: Request): void {
  if (!req) {
    cache.clear();
    totalBytes = 0;
    return;
  }

  const scope = companyScope(req);
  for (const key of Array.from(cache.keys())) {
    if (key.includes(`:company=${scope}:`)) removeKey(key);
  }
}

export function getHeavyReadCacheSnapshot() {
  pruneExpired();
  const entriesByResource: Record<string, number> = {};
  for (const entry of cache.values()) {
    entriesByResource[entry.resource] = (entriesByResource[entry.resource] || 0) + 1;
  }

  return {
    entries: cache.size,
    totalBytes,
    maxEntryBytes,
    maxTotalBytes,
    entriesByResource,
  };
}
