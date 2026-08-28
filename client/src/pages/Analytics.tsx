import { useEffect, useRef } from "react";
import AnalyticsLegacy from "./AnalyticsLegacy";

const PATCH_KEY = "__analyticsAccountsResponsePatch";

type FetchPatchState = {
  originalFetch: typeof window.fetch;
  users: number;
};

type AccountsResponse = {
  accounts?: unknown;
};

function isAccountsAllUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;

  try {
    return new URL(value, window.location.origin).pathname === "/api/accounts/all";
  } catch {
    return value.split("?")[0] === "/api/accounts/all";
  }
}

function isAnalyticsRoute(pathname: string): boolean {
  const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return normalizedPathname === "/analytics" || normalizedPathname.endsWith("/analytics");
}

function extractAccounts(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;

  const accounts = (payload as AccountsResponse).accounts;
  return Array.isArray(accounts) ? accounts : null;
}

function installAccountsResponsePatch(): () => void {
  const globalState = window as typeof window & { [PATCH_KEY]?: FetchPatchState };
  let state = globalState[PATCH_KEY];

  if (!state) {
    const originalFetch = window.fetch.bind(window);
    state = { originalFetch, users: 0 };
    globalState[PATCH_KEY] = state;

    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      // This is a compatibility shim for AnalyticsLegacy only. Capture the route
      // before awaiting so a same-tab navigation cannot make the next page's
      // /api/accounts/all request inherit Analytics' array response shape.
      const normalizeForAnalytics = isAccountsAllUrl(rawUrl) && isAnalyticsRoute(window.location.pathname);
      const response = await originalFetch(input, init);

      if (!normalizeForAnalytics) return response;

      try {
        const payload = await response.clone().json();
        const accounts = extractAccounts(payload);
        if (!accounts || payload === accounts) return response;

        const headers = new Headers(response.headers);
        headers.delete("content-length");
        return new Response(JSON.stringify(accounts), {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      } catch {
        return response;
      }
    }) as typeof window.fetch;
  }

  state.users += 1;
  return () => {
    const current = globalState[PATCH_KEY];
    if (!current) return;
    current.users -= 1;
    if (current.users <= 0) {
      window.fetch = current.originalFetch;
      delete globalState[PATCH_KEY];
    }
  };
}

export default function Analytics() {
  const cleanupRef = useRef<(() => void) | null>(null);
  if (!cleanupRef.current) {
    cleanupRef.current = installAccountsResponsePatch();
  }

  useEffect(
    () => () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    },
    []
  );

  return <AnalyticsLegacy />;
}
