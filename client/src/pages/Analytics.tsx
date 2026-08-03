import { useEffect, useRef } from "react";
import { queryClient } from "@/lib/queryClient";
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

function extractAccounts(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;

  const accounts = (payload as AccountsResponse).accounts;
  return Array.isArray(accounts) ? accounts : null;
}

function normalizeCachedAccountsResponses(): void {
  const cachedQueries = queryClient.getQueriesData({
    predicate: (query) => isAccountsAllUrl(query.queryKey[0]),
  });

  for (const [queryKey, cachedValue] of cachedQueries) {
    const accounts = extractAccounts(cachedValue);
    if (accounts && cachedValue !== accounts) {
      queryClient.setQueryData(queryKey, accounts);
    }
  }
}

function installAccountsResponsePatch(): () => void {
  const globalState = window as typeof window & { [PATCH_KEY]?: FetchPatchState };
  let state = globalState[PATCH_KEY];

  if (!state) {
    const originalFetch = window.fetch.bind(window);
    state = { originalFetch, users: 0 };
    globalState[PATCH_KEY] = state;

    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (!isAccountsAllUrl(rawUrl)) return response;

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
    normalizeCachedAccountsResponses();
    cleanupRef.current = installAccountsResponsePatch();
  }

  useEffect(
    () => () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    },
    [],
  );

  return <AnalyticsLegacy />;
}
