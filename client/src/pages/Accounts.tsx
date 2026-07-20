import { useEffect, useRef } from "react";
import AccountsLegacy from "./AccountsLegacy";
import { CashBankRevaluationPanel } from "./accounts/CashBankRevaluationPanel";

const PATCH_KEY = "__program6bAccountsParentGroupFetchPatch";

type FetchPatchState = {
  originalFetch: typeof window.fetch;
  users: number;
};

function installParentGroupFetchPatch(): () => void {
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
        const isParentGroupRequest =
          parsed.pathname === "/api/ledger-accounts" &&
          parsed.searchParams.has("companyId") &&
          !parsed.searchParams.has("accountType") &&
          !parsed.searchParams.has("search") &&
          !parsed.searchParams.has("includeHidden");

        if (isParentGroupRequest) {
          parsed.pathname = "/api/ledger-accounts/parent-groups";
          const rewritten = rawUrl.startsWith("http") ? parsed.toString() : `${parsed.pathname}${parsed.search}`;
          return originalFetch(rewritten, init);
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

export default function Accounts() {
  const cleanupRef = useRef<(() => void) | null>(null);
  if (!cleanupRef.current) cleanupRef.current = installParentGroupFetchPatch();

  useEffect(() => () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  return (
    <div className="space-y-4">
      <CashBankRevaluationPanel />
      <AccountsLegacy />
    </div>
  );
}
