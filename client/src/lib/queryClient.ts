import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { isSafeToQueue, enqueueRequest, getDescriptionForRequest } from "./offlineQueue";

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
      headers: data ? { "Content-Type": "application/json" } : {},
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
      enqueueRequest(url, method, body, description);
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

export const queryClient = new QueryClient({
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
