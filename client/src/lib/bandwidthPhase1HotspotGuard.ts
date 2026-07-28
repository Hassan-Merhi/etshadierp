type HotspotCacheRule = {
  pattern: RegExp;
  ttlMs: number;
  maxResponseBytes?: number;
};

type CachedHotspotResponse = {
  response: Response;
  expiresAt: number;
  lastUsedAt: number;
};

const DEFAULT_MAX_RESPONSE_BYTES = 1_500_000;
const MAX_CACHE_ENTRIES = 32;

// These routes are the highest recurring API consumers in the July 28 production
// bandwidth snapshots. The snapshots are deliberately short-lived and every
// state-changing request clears them before and after the write.
const HOTSPOT_RULES: HotspotCacheRule[] = [
  { pattern: /^\/api\/containers\/otw-items$/, ttlMs: 30_000, maxResponseBytes: 4_000_000 },
  { pattern: /^\/api\/inventory$/, ttlMs: 30_000 },
  { pattern: /^\/api\/containers$/, ttlMs: 30_000 },
  { pattern: /^\/api\/location-summary$/, ttlMs: 30_000 },
  { pattern: /^\/api\/locations\/\d+\/inventory$/, ttlMs: 30_000 },
  { pattern: /^\/api\/factory\/location-inventory\/\d+$/, ttlMs: 30_000 },
  { pattern: /^\/api\/ledger-accounts$/, ttlMs: 60_000 },
  { pattern: /^\/api\/factory\/containers$/, ttlMs: 45_000 },
  { pattern: /^\/api\/git\/containers$/, ttlMs: 30_000 },
  { pattern: /^\/api\/factory\/bale-products$/, ttlMs: 2 * 60_000 },
  { pattern: /^\/api\/factory\/workers$/, ttlMs: 60_000 },
  { pattern: /^\/api\/factory\/workers\/attendance-report$/, ttlMs: 30_000 },
  { pattern: /^\/api\/factory\/monthly-salary-summary$/, ttlMs: 60_000 },
  { pattern: /^\/api\/factory\/production-value-report$/, ttlMs: 30_000 },
  { pattern: /^\/api\/factory\/bale-ledger$/, ttlMs: 30_000 },
  { pattern: /^\/api\/factory\/raw-stock\/available-containers$/, ttlMs: 30_000 },
  { pattern: /^\/api\/factory\/raw-stock$/, ttlMs: 30_000 },
  { pattern: /^\/api\/factory\/raw-stock\/history\/\d+$/, ttlMs: 30_000 },
  { pattern: /^\/api\/factory\/mix-batches$/, ttlMs: 30_000 },
  { pattern: /^\/api\/factory\/ground-scan-items$/, ttlMs: 30_000 },
  { pattern: /^\/api\/factory\/daily-bale-scans(?:\/produced)?$/, ttlMs: 15_000 },
  { pattern: /^\/api\/factory\/suppliers$/, ttlMs: 2 * 60_000 },
  { pattern: /^\/api\/factory\/suppliers\/with-balances$/, ttlMs: 30_000 },
  { pattern: /^\/api\/factory\/suppliers\/\d+\/broker-statement$/, ttlMs: 30_000 },
  { pattern: /^\/api\/factory\/categories$/, ttlMs: 5 * 60_000 },
  { pattern: /^\/api\/accounts\/all$/, ttlMs: 30_000 },
  { pattern: /^\/api\/accounts\/voucher-sidebar$/, ttlMs: 30_000 },
  { pattern: /^\/api\/employees$/, ttlMs: 60_000 },
  { pattern: /^\/api\/factory\/users$/, ttlMs: 60_000 },
  { pattern: /^\/api\/factory\/(?:rental\/)?cash-accounts$/, ttlMs: 60_000 },
  { pattern: /^\/api\/stock-items\/light$/, ttlMs: 5 * 60_000 },
  { pattern: /^\/api\/factory\/customer-price-lists\/\d+$/, ttlMs: 60_000 },
  { pattern: /^\/api\/factory\/daybook$/, ttlMs: 15_000 },
  { pattern: /^\/api\/reports\/stock-movement$/, ttlMs: 30_000 },
  { pattern: /^\/api\/user\/companies$/, ttlMs: 5 * 60_000 },
  { pattern: /^\/api\/user-preferences$/, ttlMs: 5 * 60_000 },
  { pattern: /^\/api\/factory\/label-design-colors$/, ttlMs: 5 * 60_000 },
  { pattern: /^\/api\/barcode\/[^/]+$/, ttlMs: 10_000 },
];

const responseCache = new Map<string, CachedHotspotResponse>();
const inFlightRequests = new Map<string, Promise<Response>>();
let writeGeneration = 0;

function resolveUrl(input: RequestInfo | URL): URL | null {
  try {
    if (typeof input === "string") return new URL(input, window.location.origin);
    if (input instanceof URL) return new URL(input.toString(), window.location.origin);
    if (input instanceof Request) return new URL(input.url, window.location.origin);
  } catch {
    return null;
  }
  return null;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  return new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
}

function requestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | null | undefined {
  return init?.signal || (input instanceof Request ? input.signal : undefined);
}

function findRule(pathname: string): HotspotCacheRule | undefined {
  return HOTSPOT_RULES.find(({ pattern }) => pattern.test(pathname));
}

function shouldBypass(input: RequestInfo | URL, init: RequestInit | undefined, headers: Headers): boolean {
  const cacheMode = init?.cache || (input instanceof Request ? input.cache : undefined);
  const cacheControl = headers.get("cache-control") || "";
  return (
    headers.has("range") ||
    headers.has("x-bypass-request-storm-guard") ||
    cacheMode === "no-store" ||
    cacheMode === "reload" ||
    cacheControl.includes("no-store") ||
    cacheControl.includes("no-cache")
  );
}

function buildCacheKey(url: URL, headers: Headers): string {
  const varyHeaders = [
    "accept",
    "x-client-date",
    "x-company-id",
    "x-factory-company-id",
    "x-selected-company-id",
    "x-erp-company-id",
  ]
    .map((name) => `${name}=${headers.get(name) || ""}`)
    .join("|");
  return `${url.toString()}|${varyHeaders}`;
}

function clearCache(): void {
  responseCache.clear();
}

function trimCache(): void {
  if (responseCache.size <= MAX_CACHE_ENTRIES) return;
  const oldest = [...responseCache.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
  while (responseCache.size > MAX_CACHE_ENTRIES && oldest.length > 0) {
    const entry = oldest.shift();
    if (entry) responseCache.delete(entry[0]);
  }
}

function getCachedResponse(key: string): Response | null {
  const cached = responseCache.get(key);
  if (!cached) return null;
  const now = Date.now();
  if (now > cached.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  cached.lastUsedAt = now;
  return cached.response.clone();
}

function cacheResponse(
  key: string,
  response: Response,
  rule: HotspotCacheRule,
  generationAtStart: number,
): void {
  if (!response.ok || generationAtStart !== writeGeneration) return;
  const rawLength = response.headers.get("content-length");
  const responseBytes = rawLength ? Number(rawLength) : 0;
  const maxResponseBytes = rule.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (Number.isFinite(responseBytes) && responseBytes > maxResponseBytes) return;

  const now = Date.now();
  responseCache.set(key, {
    response: response.clone(),
    expiresAt: now + rule.ttlMs,
    lastUsedAt: now,
  });
  trimCache();
}

function waitUntilVisible(signal?: AbortSignal | null): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState !== "hidden") return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      signal?.removeEventListener("abort", onAbort);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") return;
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function cloneSharedResponse(
  request: Promise<Response>,
  signal?: AbortSignal | null,
): Promise<Response> {
  if (!signal) return (await request).clone();
  if (signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");

  return new Promise<Response>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    request.then(
      (response) => {
        signal.removeEventListener("abort", onAbort);
        resolve(response.clone());
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function installBandwidthPhase1HotspotGuard(): void {
  if (typeof window === "undefined" || (window as any).__bandwidthPhase1HotspotGuardInstalled) return;
  (window as any).__bandwidthPhase1HotspotGuardInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = requestMethod(input, init);
    const url = resolveUrl(input);
    if (!url || !url.pathname.startsWith("/api/")) return originalFetch(input, init);

    if (method !== "GET") {
      if (method === "HEAD" || method === "OPTIONS") return originalFetch(input, init);
      writeGeneration += 1;
      clearCache();
      try {
        const response = await originalFetch(input, init);
        writeGeneration += 1;
        clearCache();
        return response;
      } catch (error) {
        writeGeneration += 1;
        clearCache();
        throw error;
      }
    }

    const rule = findRule(url.pathname);
    if (!rule) return originalFetch(input, init);

    const headers = requestHeaders(input, init);
    if (shouldBypass(input, init, headers)) return originalFetch(input, init);

    const key = buildCacheKey(url, headers);
    const cached = getCachedResponse(key);
    if (cached) return cached;

    const signal = requestSignal(input, init);
    const existing = inFlightRequests.get(key);
    if (existing) return cloneSharedResponse(existing, signal);

    const generationAtStart = writeGeneration;
    const request = (async () => {
      await waitUntilVisible(signal);
      const response = await originalFetch(input, init);
      cacheResponse(key, response, rule, generationAtStart);
      return response;
    })().finally(() => {
      inFlightRequests.delete(key);
    });

    inFlightRequests.set(key, request);
    return cloneSharedResponse(request, signal);
  };
}

installBandwidthPhase1HotspotGuard();
