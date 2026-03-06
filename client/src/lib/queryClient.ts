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
    throw error;
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  console.log(`[apiRequest] Starting ${method} ${url}`);
  
  // Add timeout to prevent infinite hanging
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.error(`[apiRequest] TIMEOUT after 30s for ${method} ${url}`);
    controller.abort();
  }, 30000);
  
  try {
    console.log(`[apiRequest] Preparing fetch for ${method} ${url}`);
    let body: string | undefined;
    if (data) {
      try {
        body = JSON.stringify(data);
        console.log(`[apiRequest] Body stringified successfully, length: ${body.length}`);
      } catch (jsonError) {
        console.error(`[apiRequest] JSON.stringify failed:`, jsonError);
        throw jsonError;
      }
    }
    
    console.log(`[apiRequest] Calling fetch...`);
    const res = await fetch(url, {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body,
      credentials: "include",
      signal: controller.signal,
    });
    console.log(`[apiRequest] Fetch completed, status: ${res.status}`);

    clearTimeout(timeoutId);
    await throwIfResNotOk(res);
    console.log(`[apiRequest] Response OK, returning`);
    return res;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error(`[apiRequest] Request aborted (timeout) for ${method} ${url}`);
      throw new Error(`Request timeout after 30 seconds for ${method} ${url}`);
    }
    if (error instanceof TypeError && isSafeToQueue(method, url)) {
      const description = getDescriptionForRequest(url);
      const body = data ? JSON.stringify(data) : "";
      enqueueRequest(url, method, body, description);
      const offlineError: any = new Error(`Saved offline — will sync when connected`);
      offlineError.name = "OfflineQueued";
      offlineError.description = description;
      throw offlineError;
    }
    console.error(`[apiRequest] Error in ${method} ${url}:`, error);
    throw error;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // The queryKey is expected to be a single URL string as the first element
    const url = queryKey[0] as string;
    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: true,
      staleTime: 2 * 60 * 1000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
