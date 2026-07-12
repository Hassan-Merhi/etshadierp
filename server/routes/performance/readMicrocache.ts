import type { Request, RequestHandler } from "express";

export const READ_MICROCACHE_PATHS = new Set([
  "/api/factory/daybook",
  "/api/accounts/all",
  "/api/stats/monthly-data",
  "/api/dashboard/sales-report-all",
]);

interface ReadMicrocacheEntry {
  expiresAt: number;
  statusCode: number;
  body: string;
}

interface ReadMicrocacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export function buildReadMicrocacheKey(req: Request): string {
  const session = req.session as any;
  return [
    req.method,
    req.originalUrl,
    session?.userId ?? "anonymous",
    session?.currentCompanyId ?? "none",
    session?.factoryCompanyId ?? "none",
    session?.currentRole ?? "none",
  ].join("|");
}

export function createReadMicrocacheMiddleware(options: ReadMicrocacheOptions = {}): RequestHandler {
  const ttlMs = options.ttlMs ?? 1_000;
  const maxEntries = options.maxEntries ?? 100;
  const now = options.now ?? Date.now;
  const cache = new Map<string, ReadMicrocacheEntry>();

  function pruneExpired(currentTime: number): void {
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= currentTime) cache.delete(key);
    }
  }

  return (req, res, next) => {
    if (req.method !== "GET" || !READ_MICROCACHE_PATHS.has(req.path)) return next();
    if (String(req.headers["cache-control"] || "").includes("no-cache")) return next();

    const currentTime = now();
    const key = buildReadMicrocacheKey(req);
    const cached = cache.get(key);

    if (cached && cached.expiresAt > currentTime) {
      return res.status(cached.statusCode).type("application/json").send(cached.body);
    }
    if (cached) cache.delete(key);

    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          const serialized = JSON.stringify(body);
          pruneExpired(now());
          if (cache.size >= maxEntries) {
            const oldestKey = cache.keys().next().value as string | undefined;
            if (oldestKey) cache.delete(oldestKey);
          }
          cache.set(key, {
            expiresAt: now() + ttlMs,
            statusCode: res.statusCode,
            body: serialized,
          });
        } catch {
          // Non-serializable responses continue normally and are not cached.
        }
      }
      return originalJson(body);
    }) as typeof res.json;

    return next();
  };
}

export function registerPerformanceReadMicrocache(app: { use: (handler: RequestHandler) => unknown }): void {
  app.use(createReadMicrocacheMiddleware());
}
