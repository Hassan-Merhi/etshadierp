import { createHash } from "crypto";
import type { Express, NextFunction, Request, Response } from "express";

interface CachePolicy {
  name: string;
  methods: readonly string[];
  path: RegExp;
  serverTtlMs: number;
  clientMaxAgeSeconds: number;
  maxBodyBytes?: number;
}

interface CacheEntry {
  body: string;
  contentType: string;
  etag: string;
  expiresAt: number;
  sizeBytes: number;
}

interface CacheStats {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  revalidated: number;
  coalesced: number;
  stores: number;
  evictions: number;
  invalidations: number;
}

interface DeferredEntry {
  promise: Promise<CacheEntry | null>;
  resolve: (entry: CacheEntry | null) => void;
}

const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 400;
const COALESCE_WAIT_MS = 15_000;

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, DeferredEntry>();
let cachedBytes = 0;
let cacheGeneration = 0;
const counters = {
  hits: 0,
  misses: 0,
  revalidated: 0,
  coalesced: 0,
  stores: 0,
  evictions: 0,
  invalidations: 0,
};

const volatile = (name: string, path: RegExp): CachePolicy => ({
  name,
  methods: ["GET", "HEAD"],
  path,
  serverTtlMs: 30_000,
  clientMaxAgeSeconds: 0,
});

const report = (name: string, path: RegExp): CachePolicy => ({
  name,
  methods: ["GET", "HEAD"],
  path,
  serverTtlMs: 2 * 60_000,
  clientMaxAgeSeconds: 0,
});

const reference = (name: string, path: RegExp): CachePolicy => ({
  name,
  methods: ["GET", "HEAD"],
  path,
  serverTtlMs: 5 * 60_000,
  clientMaxAgeSeconds: 0,
});

const CACHE_POLICIES: readonly CachePolicy[] = [
  report("sales-report", /^\/api\/sales-report\/?$/),
  report("sales-report-all", /^\/api\/dashboard\/sales-report-all\/?$/),
  report("location-summary", /^\/api\/location-summary\/?$/),
  report("stock-movement", /^\/api\/reports\/stock-movement\/?$/),
  report("container-report", /^\/api\/reports\/containers\/?$/),
  report("opening-stock-summary", /^\/api\/reports\/opening-stock-summary\/?$/),
  report("factory-payrolls", /^\/api\/factory\/payrolls\/?$/),
  report("worker-payment-summary", /^\/api\/payroll\/worker-payments-summary\/?$/),
  report("factory-customer-proformas", /^\/api\/factory\/customer-proformas\/?$/),
  report("factory-customer-order", /^\/api\/factory\/customer-orders\/\d+\/?$/),
  report(
    "factory-customer-order-verification",
    /^\/api\/factory\/customer-orders\/\d+\/verification-summary\/?$/,
  ),
  report("factory-bale-ledger", /^\/api\/factory\/bale-ledger\/?$/),
  report("factory-mix-batches", /^\/api\/factory\/mix-batches\/?$/),
  report("factory-daily-bale-scans", /^\/api\/factory\/daily-bale-scans\/?$/),
  report(
    "factory-produced-daily-bale-scans",
    /^\/api\/factory\/daily-bale-scans\/produced\/?$/,
  ),
  report("factory-stock-entry-history", /^\/api\/factory\/bales\/stock-entry-history\/?$/),
  report("factory-attendance", /^\/api\/factory\/attendance\/?$/),
  report("factory-attendance-report", /^\/api\/factory\/workers\/attendance-report\/?$/),
  volatile("location-inventory", /^\/api\/locations\/\d+\/inventory\/?$/),
  volatile("ledger-transactions", /^\/api\/accounts\/ledger\/\d+\/transactions\/?$/),
  volatile("accounts-all", /^\/api\/accounts\/all\/?$/),
  volatile("voucher-sidebar", /^\/api\/accounts\/voucher-sidebar\/?$/),
  volatile("voucher-detail", /^\/api\/vouchers\/\d+\/?$/),
  volatile("daybook", /^\/api\/daybook\/?$/),
  volatile("pos-drafts", /^\/api\/pos\/drafts\/?$/),
  volatile("pos-last-sold-prices", /^\/api\/pos\/last-sold-prices\/?$/),
  volatile("barcode-lookup", /^\/api\/barcode\/[^/]+\/?$/),
  volatile(
    "factory-raw-stock-containers",
    /^\/api\/factory\/raw-stock\/available-containers\/?$/,
  ),
  volatile("factory-raw-stock", /^\/api\/factory\/raw-stock\/?$/),
  volatile("factory-bale-stock-count", /^\/api\/factory\/bale-stock-count\/?$/),
  volatile("factory-containers", /^\/api\/factory\/containers\/?$/),
  volatile("git-containers", /^\/api\/git\/containers\/?$/),
  reference("factory-workers", /^\/api\/factory\/workers\/?$/),
  reference("factory-employees", /^\/api\/factory\/employees\/?$/),
  reference("factory-bale-products", /^\/api\/factory\/bale-products\/?$/),
  reference("factory-cash-accounts", /^\/api\/factory\/cash-accounts\/?$/),
  reference("factory-settings", /^\/api\/factory\/settings\/?$/),
  reference("ledger-accounts", /^\/api\/ledger-accounts\/?$/),
  reference("ledger-parent-groups", /^\/api\/ledger-accounts\/parent-groups\/?$/),
  reference("stock-items", /^\/api\/stock-items\/?$/),
  reference("stock-items-light", /^\/api\/stock-items\/light\/?$/),
  reference("stock-item-aliases", /^\/api\/stock-items\/all-code-aliases\/?$/),
  reference("locations", /^\/api\/locations\/?$/),
  reference("stock-groups", /^\/api\/stock-groups\/?$/),
  reference("suppliers", /^\/api\/suppliers\/?$/),
  reference("employees", /^\/api\/employees\/?$/),
  reference("worker-groups", /^\/api\/worker-groups\/with-members\/?$/),
  reference("employee-groups", /^\/api\/employee-groups\/?$/),
  reference("user-companies", /^\/api\/user\/companies\/?$/),
  reference("my-erp-pages", /^\/api\/my-erp-pages\/?$/),
  {
    name: "payroll-preview",
    methods: ["POST"],
    path: /^\/api\/factory\/payrolls\/preview\/?$/,
    serverTtlMs: 2 * 60_000,
    clientMaxAgeSeconds: 0,
    maxBodyBytes: 4 * 1024 * 1024,
  },
];

// These writes change ephemeral UI state only. Flushing report/reference caches for
// them would destroy the cache every few seconds (POS autosave) or every 90 seconds
// (presence heartbeat) without making the cached business data stale.
const NON_INVALIDATING_WRITE_PATHS: readonly RegExp[] = [
  /^\/api\/user-presence(?:\/|$)/,
  /^\/api\/pos\/drafts(?:\/|$)/,
  /^\/api\/notifications(?:\/|$)/,
  /^\/api\/chat(?:\/|$)/,
  /^\/api\/client-observability(?:\/|$)/,
  /^\/api\/auth\/activity(?:\/|$)/,
];

function findPolicy(method: string, path: string): CachePolicy | undefined {
  return CACHE_POLICIES.find((policy) => policy.methods.includes(method) && policy.path.test(path));
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;

  const objectValue = value as Record<string, unknown>;
  return `{${Object.keys(objectValue)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(objectValue[key])}`)
    .join(",")}}`;
}

function sessionScope(req: Request): string | null {
  const session = (req as any).session as Record<string, unknown> | undefined;
  const userId = session?.userId;
  if (userId === undefined || userId === null) return null;

  return [
    String(userId),
    String(session.currentCompanyId ?? "none"),
    String(session.factoryCompanyId ?? "none"),
    String(session.currentRole ?? "none"),
    String(session.currentLocationId ?? "none"),
    String(session.currentPOSStation ?? "none"),
  ].join(":");
}

function cacheKey(req: Request, scope: string, generation: number): string {
  const bodyKey = req.method === "POST" ? stableSerialize(req.body ?? null) : "";
  const clientDate = String(req.get("x-client-date") ?? "");
  return `${generation}|${scope}|${req.method}|${req.originalUrl}|${clientDate}|${bodyKey}`;
}

function makeEtag(body: string): string {
  const digest = createHash("sha1").update(body).digest("base64url").slice(0, 24);
  return `W/\"${Buffer.byteLength(body).toString(16)}-${digest}\"`;
}

function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === "*" || value === etag);
}

function setVary(res: Response, values: readonly string[]): void {
  const current = String(res.getHeader("Vary") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const merged = new Set([...current, ...values]);
  res.setHeader("Vary", [...merged].join(", "));
}

function applyHeaders(res: Response, policy: CachePolicy, etag: string, state: string): void {
  if (policy.clientMaxAgeSeconds > 0) {
    res.setHeader(
      "Cache-Control",
      `private, max-age=${policy.clientMaxAgeSeconds}, must-revalidate`,
    );
  } else {
    res.setHeader("Cache-Control", "private, no-cache, must-revalidate");
  }
  res.removeHeader("Pragma");
  res.removeHeader("Expires");
  res.setHeader("ETag", etag);
  res.setHeader("X-ERP-Cache", state);
  res.setHeader("X-ERP-Cache-Policy", policy.name);
  setVary(res, ["Cookie", "Accept-Encoding", "X-Client-Date"]);
}

function deleteEntry(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  cachedBytes -= entry.sizeBytes;
  cache.delete(key);
}

function pruneExpired(now = Date.now()): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) deleteEntry(key);
  }
}

function evictToBudget(): void {
  while (cache.size > MAX_CACHE_ENTRIES || cachedBytes > MAX_CACHE_BYTES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    deleteEntry(oldestKey);
    counters.evictions += 1;
  }
}

function storeEntry(key: string, entry: CacheEntry): void {
  deleteEntry(key);
  cache.set(key, entry);
  cachedBytes += entry.sizeBytes;
  counters.stores += 1;
  evictToBudget();
}

function createDeferredEntry(): DeferredEntry {
  let resolve!: (entry: CacheEntry | null) => void;
  const promise = new Promise<CacheEntry | null>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForEntry(promise: Promise<CacheEntry | null>): Promise<CacheEntry | null | undefined> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(undefined), COALESCE_WAIT_MS);
    promise.then((entry) => {
      clearTimeout(timeout);
      resolve(entry);
    });
  });
}

export function clearPrivateApiCache(): void {
  cache.clear();
  cachedBytes = 0;
  cacheGeneration += 1;
  counters.invalidations += 1;
}

export function resetPrivateApiCacheForTests(): void {
  cache.clear();
  inFlight.clear();
  cachedBytes = 0;
  cacheGeneration = 0;
  counters.hits = 0;
  counters.misses = 0;
  counters.revalidated = 0;
  counters.coalesced = 0;
  counters.stores = 0;
  counters.evictions = 0;
  counters.invalidations = 0;
}

export function getPrivateApiCacheStats(): CacheStats {
  pruneExpired();
  return {
    entries: cache.size,
    bytes: cachedBytes,
    ...counters,
  };
}

function isReadOnlyPost(req: Request): boolean {
  return req.method === "POST" && /^\/api\/factory\/payrolls\/preview\/?$/.test(req.path);
}

function isNonInvalidatingWrite(req: Request): boolean {
  return NON_INVALIDATING_WRITE_PATHS.some((pattern) => pattern.test(req.path));
}

function shouldForceRefresh(req: Request): boolean {
  if (req.query.__refresh === "1") return true;
  const requestCacheControl = String(req.get("cache-control") ?? "").toLowerCase();
  return requestCacheControl.includes("no-cache") || requestCacheControl.includes("no-store");
}

function invalidateAroundMutation(req: Request, res: Response, next: NextFunction): void {
  if (!req.path.startsWith("/api/")) return next();
  if (
    ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
    isReadOnlyPost(req) ||
    isNonInvalidatingWrite(req)
  ) {
    return next();
  }

  clearPrivateApiCache();
  res.once("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 400) clearPrivateApiCache();
  });
  next();
}

function serveEntry(
  req: Request,
  res: Response,
  policy: CachePolicy,
  entry: CacheEntry,
  state = "HIT",
): void {
  applyHeaders(res, policy, entry.etag, state);
  res.setHeader("Content-Type", entry.contentType);

  if (etagMatches(req.get("if-none-match"), entry.etag)) {
    counters.revalidated += 1;
    res.setHeader("X-ERP-Cache", "REVALIDATED");
    res.status(304).end();
    return;
  }

  counters.hits += 1;
  if (req.method === "HEAD") {
    res.status(200).end();
    return;
  }
  res.status(200).end(entry.body);
}

async function cacheReadResponse(req: Request, res: Response, next: NextFunction): Promise<void> {
  const policy = findPolicy(req.method, req.path);
  if (!policy) return next();

  const scope = sessionScope(req);
  if (!scope) return next();

  pruneExpired();
  const generation = cacheGeneration;
  const key = cacheKey(req, scope, generation);
  const existing = cache.get(key);
  const forceRefresh = shouldForceRefresh(req);

  if (existing && existing.expiresAt > Date.now() && !forceRefresh) {
    cache.delete(key);
    cache.set(key, existing);
    serveEntry(req, res, policy, existing);
    return;
  }

  if (existing) deleteEntry(key);

  const pending = inFlight.get(key);
  if (pending) {
    const completed = await waitForEntry(pending.promise);
    if (completed === undefined) {
      res.setHeader("X-ERP-Cache", "COALESCE-TIMEOUT");
      return next();
    }
    if (generation !== cacheGeneration) return cacheReadResponse(req, res, next);
    if (completed && completed.expiresAt > Date.now()) {
      counters.coalesced += 1;
      serveEntry(req, res, policy, completed, "COALESCED");
      return;
    }
  }

  counters.misses += 1;
  res.setHeader("X-ERP-Cache", forceRefresh ? "REFRESH" : "MISS");
  res.setHeader("X-ERP-Cache-Policy", policy.name);

  const deferred = createDeferredEntry();
  inFlight.set(key, deferred);
  let completedLeader = false;
  const completeLeader = (entry: CacheEntry | null) => {
    if (completedLeader) return;
    completedLeader = true;
    if (inFlight.get(key) === deferred) inFlight.delete(key);
    deferred.resolve(entry);
  };

  res.once("finish", () => completeLeader(null));
  res.once("close", () => completeLeader(null));

  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  (res as any).json = (payload: unknown) => {
    if (res.headersSent || res.statusCode !== 200) {
      completeLeader(null);
      return originalJson(payload);
    }

    const body = JSON.stringify(payload);
    if (body === undefined) {
      completeLeader(null);
      return originalJson(payload);
    }

    const sizeBytes = Buffer.byteLength(body);
    const maxBodyBytes = policy.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    if (sizeBytes > maxBodyBytes) {
      res.setHeader("X-ERP-Cache", "BYPASS-SIZE");
      completeLeader(null);
      return originalJson(payload);
    }

    const etag = makeEtag(body);
    const contentType = "application/json; charset=utf-8";
    applyHeaders(res, policy, etag, forceRefresh ? "REFRESH" : "MISS");
    res.setHeader("Content-Type", contentType);

    const entry: CacheEntry = {
      body,
      contentType,
      etag,
      expiresAt: Date.now() + policy.serverTtlMs,
      sizeBytes,
    };

    if (generation === cacheGeneration) {
      storeEntry(key, entry);
      completeLeader(entry);
    } else {
      completeLeader(null);
    }

    if (etagMatches(req.get("if-none-match"), etag)) {
      counters.revalidated += 1;
      res.setHeader("X-ERP-Cache", "REVALIDATED");
      res.status(304).end();
      return res;
    }

    if (req.method === "HEAD") {
      res.status(200).end();
      return res;
    }

    return originalSend(body);
  };

  next();
}

export function installPrivateApiCache(app: Express): void {
  if (app.locals.privateApiCacheInstalled) return;
  app.locals.privateApiCacheInstalled = true;

  app.use(invalidateAroundMutation);
  app.use(cacheReadResponse);
}
