/**
 * Browser-side protection against factory request storms.
 *
 * Multiple restored browser tabs used to mount at the same time and immediately
 * issue the same expensive factory GET requests. This wrapper:
 *  - defers heavy reads while the tab is hidden;
 *  - enforces a minimum interval between repeated heavy reads in one tab;
 *  - coalesces identical in-flight JSON reads when the response is small enough;
 *  - clears throttles after factory writes so user actions can refresh immediately.
 *
 * It never delays POST/PUT/PATCH/DELETE requests.
 */

const installedKey = "__erpBackgroundRequestGuardInstalled";
const MAX_COALESCED_RESPONSE_BYTES = 2 * 1024 * 1024;

interface RequestPolicy {
  name: string;
  minIntervalMs: number;
}

interface ResponseSnapshot {
  body: ArrayBuffer;
  status: number;
  statusText: string;
  headers: [string, string][];
}

const lastStartedAt = new Map<string, number>();
const inFlightSnapshots = new Map<string, Promise<ResponseSnapshot | null>>();

function resolveRequest(input: RequestInfo | URL, init?: RequestInit) {
  const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  const signal = init?.signal || (input instanceof Request ? input.signal : undefined);

  let url: URL | null = null;
  try {
    if (input instanceof URL) url = input;
    else if (input instanceof Request) url = new URL(input.url, window.location.origin);
    else url = new URL(input, window.location.origin);
  } catch {
    url = null;
  }

  return { method, signal, url };
}

function classify(pathname: string): RequestPolicy | null {
  if (/^\/api\/factory\/customer-orders\/\d+$/.test(pathname)) {
    return { name: "customer-order-detail", minIntervalMs: 30_000 };
  }

  if (pathname === "/api/factory/customer-orders") {
    return { name: "customer-orders-list", minIntervalMs: 30_000 };
  }

  if (pathname.startsWith("/api/factory/customer-orders/") && pathname.endsWith("/bale-removals")) {
    return { name: "customer-order-removals", minIntervalMs: 60_000 };
  }

  if (pathname === "/api/factory/bale-stock-count") {
    return { name: "bale-stock-count", minIntervalMs: 60_000 };
  }

  if (pathname === "/api/factory/raw-stock") {
    return { name: "raw-stock", minIntervalMs: 30_000 };
  }

  if (pathname === "/api/factory/bale-ledger") {
    return { name: "bale-ledger", minIntervalMs: 60_000 };
  }

  if (pathname === "/api/factory/net-position") {
    return { name: "net-position", minIntervalMs: 30_000 };
  }

  return null;
}

function abortError(): DOMException {
  return new DOMException("The request was aborted.", "AbortError");
}

function waitForEvent(
  eventName: "visibilitychange",
  delayMs: number | null,
  signal?: AbortSignal | null
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      document.removeEventListener(eventName, onEvent);
      signal?.removeEventListener("abort", onAbort);
      if (timer) clearTimeout(timer);
    };

    const finish = () => {
      cleanup();
      resolve();
    };

    const onEvent = () => {
      if (eventName === "visibilitychange" && document.visibilityState !== "visible") return;
      finish();
    };

    const onAbort = () => {
      cleanup();
      reject(abortError());
    };

    document.addEventListener(eventName, onEvent);
    signal?.addEventListener("abort", onAbort, { once: true });

    if (delayMs !== null) timer = setTimeout(finish, delayMs);
  });
}

async function waitUntilVisible(signal?: AbortSignal | null): Promise<void> {
  while (document.visibilityState !== "visible") {
    await waitForEvent("visibilitychange", null, signal);
  }
}

async function waitForThrottle(key: string, minIntervalMs: number, signal?: AbortSignal | null): Promise<void> {
  const last = lastStartedAt.get(key) || 0;
  const remaining = last + minIntervalMs - Date.now();
  if (remaining <= 0) return;

  await waitForEvent("visibilitychange", remaining, signal).catch((error) => {
    if (error?.name === "AbortError") throw error;
  });
}

function staggerDelay(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return 50 + Math.abs(hash % 300);
}

function responseFromSnapshot(snapshot: ResponseSnapshot): Response {
  return new Response(snapshot.body.slice(0), {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers,
  });
}

function clearFactoryReadThrottles(): void {
  lastStartedAt.clear();
}

if (typeof window !== "undefined" && !(window as any)[installedKey]) {
  (window as any)[installedKey] = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { method, signal, url } = resolveRequest(input, init);

    if (!url || url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
      return originalFetch(input, init);
    }

    if (method !== "GET" && method !== "HEAD") {
      if (url.pathname.startsWith("/api/factory/")) clearFactoryReadThrottles();
      return originalFetch(input, init);
    }

    const policy = classify(url.pathname);
    if (!policy || method === "HEAD") return originalFetch(input, init);

    await waitUntilVisible(signal);
    const key = `${policy.name}:${url.pathname}${url.search}`;

    const existingSnapshot = inFlightSnapshots.get(key);
    if (existingSnapshot) {
      const snapshot = await existingSnapshot;
      if (snapshot) return responseFromSnapshot(snapshot);
    }

    await waitForThrottle(key, policy.minIntervalMs, signal);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, staggerDelay(key));
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    });

    lastStartedAt.set(key, Date.now());

    let resolveSnapshot!: (snapshot: ResponseSnapshot | null) => void;
    const snapshotPromise = new Promise<ResponseSnapshot | null>((resolve) => {
      resolveSnapshot = resolve;
    });
    inFlightSnapshots.set(key, snapshotPromise);

    try {
      const response = await originalFetch(input, init);
      const contentType = response.headers.get("content-type") || "";
      const contentLength = Number(response.headers.get("content-length") || 0);

      if (
        response.ok &&
        contentType.includes("application/json") &&
        contentLength > 0 &&
        contentLength <= MAX_COALESCED_RESPONSE_BYTES
      ) {
        const clone = response.clone();
        clone
          .arrayBuffer()
          .then((body) =>
            resolveSnapshot({
              body,
              status: clone.status,
              statusText: clone.statusText,
              headers: Array.from(clone.headers.entries()),
            })
          )
          .catch(() => resolveSnapshot(null));
      } else {
        resolveSnapshot(null);
      }

      return response;
    } catch (error) {
      resolveSnapshot(null);
      throw error;
    } finally {
      snapshotPromise.finally(() => {
        if (inFlightSnapshots.get(key) === snapshotPromise) inFlightSnapshots.delete(key);
      });
    }
  };
}
