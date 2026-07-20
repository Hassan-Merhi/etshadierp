import { useEffect, useRef } from "react";
import AnalyticsLegacy from "./AnalyticsLegacy";

const PATCH_KEY = "__analyticsAccountsResponsePatch";

type FetchPatchState = {
  originalFetch: typeof window.fetch;
  users: number;
};

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

      try {
        const parsed = new URL(rawUrl, window.location.origin);
        if (parsed.pathname !== "/api/accounts/all") return response;

        const payload = await response.clone().json();
        if (Array.isArray(payload)) return response;
        if (!payload || !Array.isArray(payload.accounts)) return response;

        const headers = new Headers(response.headers);
        headers.delete("content-length");
        return new Response(JSON.stringify(payload.accounts), {
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
  if (!cleanupRef.current) cleanupRef.current = installAccountsResponsePatch();

  useEffect(
    () => () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    },
    [],
  );

  return <AnalyticsLegacy />;
}
