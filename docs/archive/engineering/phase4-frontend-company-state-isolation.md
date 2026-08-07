# Phase 4 — Frontend Company-State Isolation

Phase 4 prevents the browser from displaying, reusing, or repopulating data from a previous company after the active workspace changes. It changes frontend session and cache behavior only; backend accounting calculations, voucher posting, inventory rules, and database schemas are unchanged.

## Root cause

The previous online selector wrote the server session itself, saved local storage, and then reloaded the page. `CompanyContext` had a separate switching path that invalidated most queries but did not remove their cached data. With the global five-minute React Query stale window and `refetchOnMount: false`, an inactive cache could reopen after a switch without requesting the new company’s data.

The old split ownership also allowed two rapid company selections to reach the server concurrently. The response that finished last could determine the server session even when the browser had already saved a different company locally.

## Server-authoritative switch

All online company changes now go through `CompanyContext.selectCompany`. The context cancels old company requests, posts the company change to the server, and only then commits `selectedCompany` and local storage. If the server rejects or cannot complete the switch, the existing company remains active and its mounted queries are refreshed.

The selector no longer posts `/api/auth/set-company` directly and no longer calls `window.location.reload()`.

## Serialized company switching

A small promise queue serializes company-session writes. Rapid selections execute in order, failed switches do not block later requests, and the application remains in a switching state until the final queued request completes. This prevents an earlier or slower response from overwriting the session chosen by the latest completed switch.

## Cache eviction

The company query boundary maintains a narrow allow-list for genuinely global data such as `/api/auth/me` and `/api/user/companies`. Every other React Query entry—including custom keys such as account statements—is treated as company-session data.

Before a switch, active company requests are cancelled so late responses cannot refill the cache. After the server confirms the new company, previous company-session queries are removed rather than merely marked stale. Reference-data prefetch then uses company-scoped keys for the new workspace.

## Global workspace gate

`AuthenticatedApp` now renders the application loading state for every company type while the company session is synchronizing. ERP, Factory, Properties, Supplier Partner, and POS pages therefore unmount before cache eviction and do not remain visible with previous-company balances or inventory.

Shell-level settings, factory access, factory settings, and POS unread-message queries are also keyed by the selected company.

## Company-scoped query keys

The shared query-key module now includes factories for company-session data while preserving the real URL as the first key element required by the shared query function. The Company Transfer page uses these factories for:

- transfer history;
- source-company accounts;
- destination-company accounts;
- Properties, ERP, and Factory rental auto-transfer rules.

The active company and destination company are both represented where the response depends on both contexts.

## Offline workspace switch

An intentional offline switch follows the same serialized context boundary but does not attempt a live server write. It clears previous-company caches, changes the local workspace, and queues `/api/auth/set-company` for synchronization after reconnecting. The UI explicitly distinguishes this from a server-confirmed online switch.

## Compatibility retained

- Company names, roles, types, and navigation behavior remain unchanged.
- The user-company and authenticated-user caches remain available during switches.
- Existing query functions still fetch the URL stored in the first query-key element.
- Existing API endpoints and response shapes are unchanged.
- No production database migration is introduced.

## Verification boundary

The phase verifier rejects selector-owned server switching, page reloads, local-storage writes in the selector, invalidate-only cache handling, missing global workspace gating, and unscoped Company Transfer queries.

Focused tests cover:

- global versus company-session cache classification;
- removal of accounts, inventory, and custom statement caches while preserving authentication and company access;
- serialized rapid switches and recovery after a failed switch;
- company query-key construction;
- source-level wiring for the selector, context, application shell, and Company Transfer screen.

Run the focused verification with:

```bash
node scripts/verify-phase4-frontend-company-state-isolation.mjs
node node_modules/vitest/vitest.mjs run tests/ui/company-query-scope.test.ts tests/ui/company-switch-queue.test.ts tests/ui/company-state-isolation.test.ts tests/ui/queryKeys.test.ts
```

These checks were added but not executed through CI in this connected session. Formatting, lint, TypeScript, full frontend/backend tests, production build, and browser behavior remain subject to the owner’s complete CI run.

## Merge boundary

Phase 4 must remain a draft and must not be merged until Phase 3 is approved, the full CI suite passes, and the owner explicitly authorizes the merge.
