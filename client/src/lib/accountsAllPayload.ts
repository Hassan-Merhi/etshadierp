export type AccountsAllPayload<T> =
  | T[]
  | {
      accounts?: T[];
      asOfDate?: string;
    };

/**
 * /api/accounts/all has an envelope response ({ accounts, asOfDate }), but a
 * few older screens historically cached a bare account array under the same
 * TanStack Query key. During client-side navigation either shape can therefore
 * already be present in the shared cache before a page mounts.
 *
 * Keep the cache payload untouched and normalize only at the observer boundary
 * (via useQuery's `select`). That prevents `.filter is not a function` crashes
 * without changing the server contract or poisoning another screen's cache.
 */
export function selectAccountsArray<T>(payload: AccountsAllPayload<T> | null | undefined): T[] {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.accounts) ? payload.accounts : [];
}
