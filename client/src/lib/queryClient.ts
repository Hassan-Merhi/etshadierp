import { QueryClient, QueryFunction, MutationCache } from "@tanstack/react-query";
import { isSafeToQueue, enqueueRequest, getDescriptionForRequest } from "./offlineQueue";
import { OFFLINE_MODE_ENABLED } from "@/lib/featureFlags";
import { toast } from "@/hooks/use-toast";

/* ── Timezone-aware date utility ───────────────────────────────────────────── */
// Stores the configured timezone for the current company.
// Defaults to the browser's local timezone so behaviour is unchanged until a
// company timezone is explicitly saved.
let _appTimezone: string | null = null;

/** Call this whenever company settings are loaded to configure the app timezone. */
export function setAppTimezone(tz: string | null | undefined) {
  _appTimezone = tz || null;
}

/* ── CSRF token plumbing ─────────────────────────────────────────────────── */
// Synchronizer-token CSRF protection. The token is fetched from the server
// once per session and attached to every state-changing request as
// X-CSRF-Token. Enforcement is on by default; set CSRF_ENFORCE=0 to
// switch to warn-only mode (logs mismatches but does not block requests).
let _csrfToken: string | null = null;
let _csrfFetchPromise: Promise<string | null> | null = null;

async function fetchCsrfToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/csrf-token", { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.csrfToken === "string" ? data.csrfToken : null;
  } catch {
    return null;
  }
}

async function ensureCsrfToken(): Promise<string | null> {
  if (_csrfToken) return _csrfToken;
  if (!_csrfFetchPromise) {
    _csrfFetchPromise = fetchCsrfToken().then((tok) => {
      _csrfToken = tok;
      _csrfFetchPromise = null;
      return tok;
    });
  }
  return _csrfFetchPromise;
}

/** Reset the cached CSRF token (call on logout or auth state change). */
export function resetCsrfToken() {
  _csrfToken = null;
  _csrfFetchPromise = null;
}

/* ── Capacitor API base URL ──────────────────────────────────────────────── */
// Set VITE_API_BASE_URL at Capacitor build time, e.g. "https://your-server.com".
// Empty string in all web builds — every code path below falls back unchanged.
const _CAPACITOR_API_BASE: string = ((import.meta as any).env?.VITE_API_BASE_URL as string) || "";

/* ── Global fetch interceptor ────────────────────────────────────────────── */
// Wraps window.fetch so that ALL state-changing requests to /api/* (including
// raw fetch() calls in legacy pages, hooks, sync engines, dialogs, etc.) get
// the X-CSRF-Token header automatically. This is the bridge between the new
// CSRF middleware and the ~350 raw fetch sites scattered across the codebase
// — without this, those sites would all need to be migrated to apiRequest()
// before CSRF_ENFORCE=1 could be flipped on. With this, the migration becomes
// invisible. The interceptor:
//   • Only acts on /api/* URLs (relative or same-origin absolute)
//   • Skips /api/csrf-token to avoid recursion
//   • Skips GET/HEAD/OPTIONS
//   • Never overrides an existing X-CSRF-Token header
//   • Falls through cleanly if the token cannot be fetched
//   • Auto-retries once on CSRF_TOKEN_MISMATCH (stale cached token after
//     server restart / session regeneration on Render)
if (typeof window !== "undefined" && !(window as any).__csrfFetchPatched) {
  (window as any).__csrfFetchPatched = true;
  const originalFetch = window.fetch.bind(window);

  async function fetchWithCsrf(input: RequestInfo | URL, init?: RequestInit, isRetry = false): Promise<Response> {
    try {
      // Capacitor: prefix relative /api/* paths with the remote server base URL.
      // No-op when VITE_API_BASE_URL is unset (all web builds — zero behavior change).
      if (_CAPACITOR_API_BASE && typeof input === "string" && input.startsWith("/")) {
        input = `${_CAPACITOR_API_BASE}${input}`;
      }

      // Resolve the URL pathname for /api/* matching
      let pathname: string | null = null;
      try {
        if (typeof input === "string") {
          pathname = input.startsWith("/") ? input.split("?")[0] : new URL(input, window.location.origin).pathname;
        } else if (input instanceof URL) {
          pathname = input.pathname;
        } else if (input instanceof Request) {
          pathname = new URL(input.url, window.location.origin).pathname;
        }
      } catch {
        /* opaque URL — skip */
      }

      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      const isStateChanging = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
      const isApi = !!pathname && pathname.startsWith("/api/") && pathname !== "/api/csrf-token";

      if (isStateChanging && isApi) {
        const existingHeaders = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
        if (!existingHeaders.has("x-csrf-token")) {
          const token = await ensureCsrfToken();
          if (token) {
            existingHeaders.set("X-CSRF-Token", token);
            const newInit: RequestInit = { ...init, headers: existingHeaders };
            if (newInit.credentials === undefined) newInit.credentials = "include";
            const res = await originalFetch(input, newInit);

            // If the server rejected our token (stale after restart/session regen),
            // clear the cache, fetch a fresh token, and retry exactly once.
            if (!isRetry && res.status === 403) {
              try {
                const clone = res.clone();
                const body = await clone.json();
                if (body?.code === "CSRF_TOKEN_MISMATCH") {
                  resetCsrfToken();
                  return fetchWithCsrf(input, init, true);
                }
              } catch {
                /* not JSON — not a CSRF error */
              }
            }
            return res;
          }
        }
      }
    } catch {
      // Never block a legitimate request because of interceptor errors
    }
    return originalFetch(input, init);
  }

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => fetchWithCsrf(input, init);
}

/**
 * Returns today's date string (YYYY-MM-DD) in the configured company timezone.
 * Falls back to the browser's local timezone if no company timezone is set.
 */
export function getAppDate(): string {
  const tz = _appTimezone;
  if (tz) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    } catch {
      // Invalid timezone string — fall through to browser local
    }
  }
  return new Date().toLocaleDateString("en-CA");
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = await res.text();
    let errorData;
    try {
      errorData = JSON.parse(text);
    } catch {
      // If the body is an HTML page (e.g. a Render/proxy 502 error page) don't
      // dump raw markup into the toast — show a clean status-code message instead.
      const isHtml = text.trimStart().startsWith("<");
      const fallback = isHtml
        ? `Server error (${res.status}${res.statusText ? ` – ${res.statusText}` : ""}). Please try again.`
        : text || res.statusText;
      errorData = { message: fallback };
    }

    // Create error with structured data for proper handling
    const error: any = new Error(errorData.message || res.statusText);
    error.status = res.status;
    error.requiresConfirmation = errorData.requiresConfirmation;
    error.employeeBalance = errorData.employeeBalance;
    error.ledgerBalance = errorData.ledgerBalance;
    error.notInProforma = errorData.notInProforma;
    error.overloaded = errorData.overloaded;
    throw error;
  }
}

function isNetworkError(error: any): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException && error.name === "NetworkError") return true;
  const msg: string = error?.message ?? "";
  return (
    msg.includes("Load failed") ||
    msg.includes("Failed to fetch") ||
    msg.includes("Network request failed") ||
    msg.includes("NetworkError") ||
    msg.includes("network error")
  );
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  _isRetry = false,
  timeoutMs = 300000
): Promise<Response> {
  const controller = new AbortController();
  let intentionalAbort = false;
  const timeoutId = setTimeout(() => {
    intentionalAbort = true;
    controller.abort();
  }, timeoutMs);

  try {
    let body: string | undefined;
    if (data) {
      body = JSON.stringify(data);
    }

    // Attach CSRF token for state-changing methods.
    const upMethod = method.toUpperCase();
    const isStateChanging = upMethod !== "GET" && upMethod !== "HEAD" && upMethod !== "OPTIONS";
    const csrfToken = isStateChanging ? await ensureCsrfToken() : null;

    // Capacitor: resolve to absolute URL when VITE_API_BASE_URL is set; no-op on web.
    const _apiUrl = _CAPACITOR_API_BASE && url.startsWith("/") ? `${_CAPACITOR_API_BASE}${url}` : url;
    const res = await fetch(_apiUrl, {
      method,
      headers: {
        ...(data ? { "Content-Type": "application/json" } : {}),
        "X-Client-Date": getAppDate(),
        ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      },
      body,
      credentials: "include",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // If the server rejected our CSRF token (stale after server restart /
    // session regeneration on Render), clear the cache and retry exactly once.
    if (!_isRetry && res.status === 403) {
      try {
        const clone = res.clone();
        const errBody = await clone.json();
        if (errBody?.code === "CSRF_TOKEN_MISMATCH") {
          resetCsrfToken();
          return apiRequest(method, url, data, true);
        }
      } catch {
        /* not JSON — fall through to normal error handling */
      }
    }

    await throwIfResNotOk(res);
    return res;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError" && intentionalAbort) {
      throw new Error(`Request timeout after ${Math.round(timeoutMs / 1000)} seconds for ${method} ${url}`, { cause: error });
    }
    const networkFail = error.name === "AbortError" ? true : isNetworkError(error);
    if (OFFLINE_MODE_ENABLED && networkFail && isSafeToQueue(method, url)) {
      const description = getDescriptionForRequest(url);
      const body = data ? JSON.stringify(data) : "";
      enqueueRequest(url, method, body, description, getAppDate());
      const offlineError: any = new Error(`Saved offline — will sync when connected`);
      offlineError.name = "OfflineQueued";
      offlineError.description = description;
      throw offlineError;
    }
    throw error;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: { on401: UnauthorizedBehavior }) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey, signal: querySignal }) => {
    // The queryKey is expected to be a single URL string as the first element
    const url = queryKey[0] as string;

    // Apply a 5-minute hard timeout so queries never hang indefinitely.
    // We race the caller's own signal (query cancellation) against our timeout.
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 300000);

    // Forward query-level cancellation (e.g. component unmount) into our controller
    querySignal?.addEventListener("abort", () => controller.abort(), { once: true });

    try {
      // Capacitor: resolve to absolute URL when VITE_API_BASE_URL is set; no-op on web.
      const _apiUrl = _CAPACITOR_API_BASE && url.startsWith("/") ? `${_CAPACITOR_API_BASE}${url}` : url;
      const res = await fetch(_apiUrl, {
        credentials: "include",
        signal: controller.signal,
        headers: { "X-Client-Date": getAppDate() },
      });

      clearTimeout(timeoutId);

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      return await res.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (timedOut && error?.name === "AbortError") {
        throw new Error(`Request timed out after 30 seconds: GET ${url}`, { cause: error });
      }
      throw error;
    }
  };

// Global mutation error handler — catches OfflineQueued for every mutation
// so individual pages don't need to duplicate the offline toast logic.
// Pages that need extra offline behaviour (BaleStockEntry, Vouchers) still
// run their own onError AFTER this; they should skip another toast by checking
// error._handledGlobally.
const globalMutationCache = new MutationCache({
  onError: (error: any) => {
    if (error?.name === "OfflineQueued") {
      error._handledGlobally = true;
      const label = error.description ? `${error.description} saved` : "Action saved";
      toast({
        title: "Saved offline",
        description: `${label} — will sync automatically when connected`,
      });
    }
  },
});

/**
 * Returns a TanStack Query predicate that matches any query whose first key
 * starts with the given prefix string.  Use this when the query key is a
 * URL-with-params (e.g. "/api/factory/customer-orders?status=LOADING") because
 * a bare prefix key like ["/api/factory/customer-orders"] does NOT match such
 * keys in TanStack Query v5.
 *
 * Usage:
 *   queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customer-orders") });
 */
export function keyStartsWith(prefix: string) {
  return (query: { queryKey: readonly unknown[] }) =>
    typeof query.queryKey[0] === "string" && (query.queryKey[0] as string).startsWith(prefix);
}

/**
 * Invalidate every query that depends on a customer's balance.
 *
 * Use this in any `useMutation.onSuccess` that creates / edits / deletes a
 * voucher, voucher entry, customer order, charge, finalize/un-finalize, or
 * any factory customer write.  It guarantees the Customers list, Accounts
 * page, ledger card, ledger transactions list, pre-period block, and the
 * customer statement all refresh together — eliminating the "balance updates
 * here but not there" UX.
 *
 * Pass the `customerId` only when known; without it we still invalidate
 * the broad list keys.
 */
export function invalidateCustomerBalances(customerId?: number | string) {
  // Customers list (factory + ERP)
  queryClient.invalidateQueries({ predicate: keyStartsWith("/api/factory/customers") });
  queryClient.invalidateQueries({ predicate: keyStartsWith("/api/customers") });
  // Accounts list / ledger balance / pre-period
  queryClient.invalidateQueries({ predicate: keyStartsWith("/api/accounts") });
  // Voucher list (caller may also invalidate detail key directly)
  queryClient.invalidateQueries({ predicate: keyStartsWith("/api/vouchers") });
  if (customerId !== undefined && customerId !== null) {
    queryClient.invalidateQueries({
      queryKey: ["/api/factory/customers", customerId, "statement"],
    });
  }
}

export const queryClient = new QueryClient({
  mutationCache: globalMutationCache,
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
