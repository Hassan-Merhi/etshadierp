type CachedApiResponse = {
  response: Response;
  expiresAt: number;
  staleUntil: number;
  lastUsedAt: number;
};

type QueueEntry = {
  resolve: (release: () => void) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal | null;
  onAbort?: () => void;
};

const MAX_CONCURRENT_API_GETS = 6;
const MAX_CACHE_ENTRIES = 32;
const MAX_CACHEABLE_RESPONSE_BYTES = 1_500_000;
const HIDDEN_TAB_STALE_MS = 10 * 60_000;

const responseCache = new Map<string, CachedApiResponse>();
const inFlightGets = new Map<string, Promise<Response>>();
const getQueue: QueueEntry[] = [];
let activeGets = 0;

const BYPASS_PATHS = [
  /\/export(?:\/|$)/i,
  /\/download(?:\/|$)/i,
  /\/attachment(?:\/|$)/i,
  /\/documents?(?:\/|$)/i,
  /\/pdf(?:\/|$)/i,
  /\/xlsx(?:\/|$)/i,
  /\/health(?:\/|$)/i,
  /^\/api\/boot$/i,
  /^\/api\/csrf-token$/i,
];

const CACHE_TTLS: Array<{ pattern: RegExp; ttlMs: number }> = [
  { pattern: /^\/api\/factory\/customer-orders\/\d+$/, ttlMs: 45_000 },
  { pattern: /^\/api\/factory\/customer-orders\/\d+\/bale-removals$/, ttlMs: 5 * 60_000 },
  { pattern: /^\/api\/factory\/bale-stock-count$/, ttlMs: 60_000 },
  { pattern: /^\/api\/factory\/customer-orders$/, ttlMs: 30_000 },
  { pattern: /^\/api\/factory\/customer-proformas$/, ttlMs: 2 * 60_000 },
  { pattern: /^\/api\/factory\/customers$/, ttlMs: 2 * 60_000 },
  { pattern: /^\/api\/factory\/my-access$/, ttlMs: 5 * 60_000 },
  { pattern: /^\/api\/factory\/settings$/, ttlMs: 5 * 60_000 },
  { pattern: /^\/api\/company-settings$/, ttlMs: 5 * 60_000 },
  { pattern: /^\/api\/companies\/\d+$/, ttlMs: 5 * 60_000 },
  { pattern: /^\/api\/chat\/unread-count$/, ttlMs: 15_000 },
  { pattern: /^\/api\/chatbot\/status$/, ttlMs: 2 * 60_000 },
];

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
}

function requestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | null | undefined {
  return init?.signal || (input instanceof Request ? input.signal : undefined);
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  return new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
}

function resolveRequestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (typeof input === "string") return new URL(input, window.location.origin);
    if (input instanceof URL) return new URL(input.toString(), window.location.origin);
    if (input instanceof Request) return new URL(input.url, window.location.origin);
  } catch {
    return null;
  }
  return null;
}

function cacheTtlFor(pathname: string): number {
  return CACHE_TTLS.find(({ pattern }) => pattern.test(pathname))?.ttlMs ?? 0;
}

function shouldBypass(pathname: string, headers: Headers): boolean {
  if (headers.has("range")) return true;
  return BYPASS_PATHS.some((pattern) => pattern.test(pathname));
}

function buildRequestKey(url: URL, headers: Headers): string {
  const clientDate = headers.get("x-client-date") || "";
  const accept = headers.get("accept") || "";
  return `${url.toString()}|date=${clientDate}|accept=${accept}`;
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
  const mayUseStale = typeof document !== "undefined" && document.visibilityState === "hidden";
  const validUntil = mayUseStale ? cached.staleUntil : cached.expiresAt;

  if (now > validUntil) {
    responseCache.delete(key);
    return null;
  }

  cached.lastUsedAt = now;
  return cached.response.clone();
}

function cacheResponse(key: string, response: Response, ttlMs: number): void {
  if (ttlMs <= 0 || !response.ok) return;

  const rawLength = response.headers.get("content-length");
  const responseBytes = rawLength ? Number(rawLength) : 0;
  if (Number.isFinite(responseBytes) && responseBytes > MAX_CACHEABLE_RESPONSE_BYTES) return;

  const now = Date.now();
  responseCache.set(key, {
    response: response.clone(),
    expiresAt: now + ttlMs,
    staleUntil: now + Math.max(ttlMs, HIDDEN_TAB_STALE_MS),
    lastUsedAt: now,
  });
  trimCache();
}

function clearReadCache(): void {
  responseCache.clear();
}

function drainQueue(): void {
  while (activeGets < MAX_CONCURRENT_API_GETS && getQueue.length > 0) {
    const entry = getQueue.shift();
    if (!entry) return;

    if (entry.signal?.aborted) {
      entry.reject(new DOMException("The operation was aborted.", "AbortError"));
      continue;
    }

    if (entry.onAbort && entry.signal) entry.signal.removeEventListener("abort", entry.onAbort);
    activeGets += 1;
    let released = false;
    entry.resolve(() => {
      if (released) return;
      released = true;
      activeGets = Math.max(0, activeGets - 1);
      drainQueue();
    });
  }
}

function acquireGetSlot(signal?: AbortSignal | null): Promise<() => void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
  }

  if (activeGets < MAX_CONCURRENT_API_GETS) {
    activeGets += 1;
    let released = false;
    return Promise.resolve(() => {
      if (released) return;
      released = true;
      activeGets = Math.max(0, activeGets - 1);
      drainQueue();
    });
  }

  return new Promise<() => void>((resolve, reject) => {
    const entry: QueueEntry = { resolve, reject, signal };
    if (signal) {
      entry.onAbort = () => {
        const index = getQueue.indexOf(entry);
        if (index >= 0) getQueue.splice(index, 1);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      signal.addEventListener("abort", entry.onAbort, { once: true });
    }
    getQueue.push(entry);
  });
}

async function waitForSharedResponse(promise: Promise<Response>, signal?: AbortSignal | null): Promise<Response> {
  if (!signal) return (await promise).clone();
  if (signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");

  return new Promise<Response>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (response) => {
        signal.removeEventListener("abort", onAbort);
        resolve(response.clone());
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

export function installRequestStormGuard(): void {
  if (typeof window === "undefined" || (window as any).__requestStormGuardInstalled) return;
  (window as any).__requestStormGuardInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = requestMethod(input, init);
    const url = resolveRequestUrl(input);

    if (!url || !url.pathname.startsWith("/api/")) {
      return originalFetch(input, init);
    }

    if (method !== "GET") {
      // Any successful write can change balances, stock, orders, settings or access.
      // Clear all short-lived read snapshots before it runs so the mutation's normal
      // TanStack invalidations always receive fresh server data immediately.
      clearReadCache();
      return originalFetch(input, init);
    }

    const headers = requestHeaders(input, init);
    if (shouldBypass(url.pathname, headers)) return originalFetch(input, init);

    const key = buildRequestKey(url, headers);
    const cached = getCachedResponse(key);
    if (cached) return cached;

    const existing = inFlightGets.get(key);
    if (existing) return waitForSharedResponse(existing, requestSignal(input, init));

    const ttlMs = cacheTtlFor(url.pathname);
    const signal = requestSignal(input, init);
    const requestPromise = (async () => {
      const release = await acquireGetSlot(signal);
      try {
        const response = await originalFetch(input, init);
        cacheResponse(key, response, ttlMs);
        return response;
      } finally {
        release();
      }
    })().finally(() => {
      inFlightGets.delete(key);
    });

    inFlightGets.set(key, requestPromise);
    return waitForSharedResponse(requestPromise, signal);
  };
}

installRequestStormGuard();
