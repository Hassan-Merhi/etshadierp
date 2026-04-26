import { QueryClient, QueryFunction, MutationCache } from "@tanstack/react-query";
import { isSafeToQueue, enqueueRequest, getDescriptionForRequest } from "./offlineQueue";
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
      errorData = { message: text || res.statusText };
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
): Promise<Response> {
  const controller = new AbortController();
  let intentionalAbort = false;
  const timeoutId = setTimeout(() => {
    intentionalAbort = true;
    controller.abort();
  }, 30000);
  
  try {
    let body: string | undefined;
    if (data) {
      body = JSON.stringify(data);
    }
    
    const res = await fetch(url, {
      method,
      headers: {
        ...(data ? { "Content-Type": "application/json" } : {}),
        "X-Client-Date": getAppDate(),
      },
      body,
      credentials: "include",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    await throwIfResNotOk(res);
    return res;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError" && intentionalAbort) {
      throw new Error(`Request timeout after 30 seconds for ${method} ${url}`);
    }
    const networkFail = error.name === "AbortError"
      ? true
      : isNetworkError(error);
    if (networkFail && isSafeToQueue(method, url)) {
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
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey, signal: querySignal }) => {
    // The queryKey is expected to be a single URL string as the first element
    const url = queryKey[0] as string;

    // Apply a 30-second hard timeout so queries never hang indefinitely.
    // We race the caller's own signal (query cancellation) against our timeout.
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 30000);

    // Forward query-level cancellation (e.g. component unmount) into our controller
    querySignal?.addEventListener("abort", () => controller.abort(), { once: true });

    try {
      const res = await fetch(url, {
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
        throw new Error(`Request timed out after 30 seconds: GET ${url}`);
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
    typeof query.queryKey[0] === "string" &&
    (query.queryKey[0] as string).startsWith(prefix);
}

export const queryClient = new QueryClient({
  mutationCache: globalMutationCache,
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
