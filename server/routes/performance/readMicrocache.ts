import type { Request, RequestHandler } from "express";

export const READ_MICROCACHE_TTL_MS = new Map<string, number>([
  ["/api/factory/daybook", 3_000],
  ["/api/accounts/all", 15_000],
  ["/api/stats/monthly-data", 10_000],
  ["/api/dashboard/sales-report-all", 10_000],
  ["/api/factory/suppliers/with-balances", 15_000],
  ["/api/factory/raw-stock", 10_000],
  ["/api/factory/raw-stock/available-containers", 10_000],
  ["/api/factory/mix-batches", 10_000],
  ["/api/factory/bale-ledger", 10_000],
  ["/api/factory/production-value-report", 10_000],
  ["/api/factory/containers", 10_000],
  ["/api/factory/bale-products", 30_000],
  ["/api/factory/workers", 15_000],
  ["/api/ledger-accounts", 30_000],
]);

export const READ_MICROCACHE_PATHS = new Set(READ_MICROCACHE_TTL_MS.keys());

interface ReadMicrocacheEntry {
  expiresAt: number;
  statusCode: number;
  body: string;
}

interface PendingRead {
  generation: number;
  promise: Promise<ReadMicrocacheEntry | null>;
  resolve: (entry: ReadMicrocacheEntry | null) => void;
}

interface ReadMicrocacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  maxBodyBytes?: number;
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
  const overrideTtlMs = options.ttlMs;
  const maxEntries = options.maxEntries ?? 128;
  const maxBodyBytes = options.maxBodyBytes ?? 5_000_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, ReadMicrocacheEntry>();
  const inFlight = new Map<string, PendingRead>();
  let writeGeneration = 0;

  function clearForWrite(): void {
    writeGeneration += 1;
    cache.clear();
    for (const pending of inFlight.values()) pending.resolve(null);
    inFlight.clear();
  }

  function pruneExpired(currentTime: number): void {
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= currentTime) cache.delete(key);
    }
  }

  function trimCache(): void {
    while (cache.size > maxEntries) {
      const oldestKey = cache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      cache.delete(oldestKey);
    }
  }

  function sendEntry(res: any, entry: ReadMicrocacheEntry, state: "HIT" | "COALESCED"): unknown {
    res.setHeader?.("X-ERP-Read-Cache", state);
    return res.status(entry.statusCode).type("application/json").send(entry.body);
  }

  return (req, res, next) => {
    const method = req.method.toUpperCase();

    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      clearForWrite();
      let finalized = false;
      const finalizeWrite = () => {
        if (finalized) return;
        finalized = true;
        clearForWrite();
      };
      res.once?.("finish", finalizeWrite);
      res.once?.("close", finalizeWrite);
      return next();
    }

    if (method !== "GET" || !READ_MICROCACHE_PATHS.has(req.path)) return next();

    const cacheControl = String(req.headers["cache-control"] || "").toLowerCase();
    if (
      cacheControl.includes("no-cache") ||
      cacheControl.includes("no-store") ||
      req.headers["x-bypass-request-storm-guard"] !== undefined
    ) {
      return next();
    }

    const currentTime = now();
    const key = buildReadMicrocacheKey(req);
    const cached = cache.get(key);

    if (cached && cached.expiresAt > currentTime) {
      cache.delete(key);
      cache.set(key, cached);
      return sendEntry(res, cached, "HIT");
    }
    if (cached) cache.delete(key);

    const pending = inFlight.get(key);
    if (pending && pending.generation === writeGeneration) {
      void pending.promise.then(
        (entry) => {
          if (entry && entry.expiresAt > now() && pending.generation === writeGeneration) {
            sendEntry(res, entry, "COALESCED");
            return;
          }
          next();
        },
        () => next()
      );
      return;
    }

    const generationAtStart = writeGeneration;
    let resolvePending!: (entry: ReadMicrocacheEntry | null) => void;
    const pendingPromise = new Promise<ReadMicrocacheEntry | null>((resolve) => {
      resolvePending = resolve;
    });
    const currentPending: PendingRead = {
      generation: generationAtStart,
      promise: pendingPromise,
      resolve: resolvePending,
    };
    inFlight.set(key, currentPending);

    let settled = false;
    const settle = (entry: ReadMicrocacheEntry | null) => {
      if (settled) return;
      settled = true;
      if (inFlight.get(key) === currentPending) inFlight.delete(key);
      resolvePending(entry);
    };

    res.setHeader?.("X-ERP-Read-Cache", "MISS");
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      let entry: ReadMicrocacheEntry | null = null;
      if (res.statusCode >= 200 && res.statusCode < 300 && generationAtStart === writeGeneration) {
        try {
          const serialized = JSON.stringify(body);
          if (Buffer.byteLength(serialized, "utf8") <= maxBodyBytes) {
            const ttlMs = overrideTtlMs ?? READ_MICROCACHE_TTL_MS.get(req.path) ?? 1_000;
            entry = {
              expiresAt: now() + ttlMs,
              statusCode: res.statusCode,
              body: serialized,
            };
            pruneExpired(now());
            cache.set(key, entry);
            trimCache();
          }
        } catch {
          // Non-serializable responses continue normally and are not cached.
        }
      }
      settle(entry);
      return originalJson(body);
    }) as typeof res.json;

    const settleWithoutEntry = () => settle(null);
    res.once?.("finish", settleWithoutEntry);
    res.once?.("close", settleWithoutEntry);

    return next();
  };
}

export function registerPerformanceReadMicrocache(app: { use: (handler: RequestHandler) => unknown }): void {
  app.use(createReadMicrocacheMiddleware());
}
