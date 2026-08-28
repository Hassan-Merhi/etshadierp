import { useEffect, useRef } from "react";
import { FactoryWorkerDetailView } from "./factoryworkerdetail/FactoryWorkerDetailView";
import { useFactoryWorkerDetailModel } from "./factoryworkerdetail/useFactoryWorkerDetailModel";

const PATCH_KEY = "__factoryWorkerBalesProfilePatch";

type FetchPatchState = {
  originalFetch: typeof window.fetch;
  users: number;
};

function installWorkerBalesProfilePatch(): () => void {
  const globalState = window as typeof window & { [PATCH_KEY]?: FetchPatchState };
  let state = globalState[PATCH_KEY];

  if (!state) {
    const originalFetch = window.fetch.bind(window);
    state = { originalFetch, users: 0 };
    globalState[PATCH_KEY] = state;

    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      try {
        const parsed = new URL(rawUrl, window.location.origin);
        if (/^\/api\/factory\/workers\/\d+\/bales$/.test(parsed.pathname)) {
          parsed.searchParams.set("profile", "worker-bales-summary");
          const profiledUrl = rawUrl.startsWith("http") ? parsed.toString() : `${parsed.pathname}${parsed.search}`;
          const requestInput = input instanceof Request ? new Request(profiledUrl, input) : profiledUrl;
          return originalFetch(requestInput, init);
        }
      } catch {
        // Preserve native fetch behavior for malformed or non-URL inputs.
      }
      return originalFetch(input, init);
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

export default function FactoryWorkerDetail() {
  const cleanupRef = useRef<(() => void) | null>(null);
  if (!cleanupRef.current) cleanupRef.current = installWorkerBalesProfilePatch();

  const model = useFactoryWorkerDetailModel();

  useEffect(
    () => () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    },
    []
  );

  return <FactoryWorkerDetailView model={model} />;
}
