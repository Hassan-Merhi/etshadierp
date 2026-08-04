# Phase 9 — Type-Safety Contracts

Phase 9 hardens the frontend authentication and company-session boundary. Session responses are treated as unknown at the network boundary and must pass runtime validation before they can affect permissions, company selection, navigation, or company-scoped query identity.

## Runtime validation

Static TypeScript types do not validate server JSON. The session contracts use Zod and throw a structured `SessionContractError` containing the failed contract and normalized validation issues.

Covered responses:

- authenticated user from `/api/auth/me`;
- company assignments from `/api/user/companies`;
- session company from `/api/auth/session-company`.

Malformed data now produces an explicit contract failure instead of silently changing navigation, role checks, permissions, or company state.

## Shared session query contracts

`client/src/contracts/sessionQueryContracts.ts` owns the canonical query keys, fetch functions, JSON boundary checks, runtime parsers, retry behavior, stale times, and focus/reconnect behavior for authentication and company assignments.

This prevents pages from creating separate `useQuery<any>` interpretations of the same session endpoint. The shared authenticated-user key remains `/api/auth/me`, so existing cache invalidation continues to work.

## Authenticated user

`useAuthenticatedUser` consumes the shared typed query options and returns `AuthenticatedUser | null`. A `401` remains the valid unauthenticated state; malformed successful responses are contract errors.

The authenticated-user contract includes the current session values required by company-scoped screens:

- current role;
- current company;
- current location;
- current POS station;
- cash account;
- negative-stock permission;
- POS view-only permission;
- Daybook edit window;
- customer-access permission;
- record-deletion permission.

The `/api/auth/me` response now returns these additive session-authoritative fields without exposing the password or changing existing fields.

## Company assignments

`CompanyContext` consumes the shared `UserCompanyAssignment[]` query. Company IDs and optional location, station, account, edit-window, and permission fields are normalized before they reach application state.

Company IDs must be positive integers. Duplicate assignments are collapsed by company ID. Unknown historical company types retain the existing ERP fallback.

Reference-data prefetch uses the Phase 8 company-scoped query key and reference-data policy, preventing prefetch results from leaking between companies.

## Session company

Initial synchronization uses the shared `fetchSessionCompany()` contract. It accepts a positive company ID or `null`, preserving serialized server-authoritative switching, offline selection, cache cancellation, and retry behavior.

Saved company identifiers from local storage are accepted only when they are positive integers and still belong to the validated company-assignment list.

## Selector failure state

`CompanySelector` displays an explicit disabled error state when company-assignment data fails runtime validation or cannot load. It no longer remains indefinitely in a generic loading state after a contract failure.

All successful switching still flows through `CompanyContext`; no reload or direct session bypass was added.

## GIT integration

GIT Containers now consumes the same shared authenticated-user query contract as the application shell. It uses `CompanyContext.selectedCompany.id` for active-company cache identity instead of trusting an optional ad-hoc `companyId` field on the user response.

The duplicate local `AuthUser` interface and unsafe error casts were removed from the GIT path.

## Compatibility boundary

- Existing endpoint URLs remain unchanged.
- Existing response fields remain available; the `/api/auth/me` additions are backward compatible.
- Additional server fields remain available through passthrough schemas.
- Unknown company types keep the ERP fallback.
- Serialized switching, cache eviction, offline behavior, navigation, POS permissions, and company isolation remain unchanged.
- No accounting, costing, inventory, or database behavior is changed.

## Database changes

No SQL, schema migration, role backfill, or production data repair is required for Phase 9.

## Deferred verification

Focused contracts and the static verifier were expanded for structured validation errors, shared query options, additive session fields, company-assignment permissions, selector error handling, and GIT integration.

The verification commands are available but were not executed during this phase:

```bash
node scripts/verify-phase9-type-safety-contracts.mjs
node node_modules/vitest/vitest.mjs run tests/ui/session-contracts.test.ts tests/ui/phase9-type-safety-wiring.test.ts
```

TypeScript compilation, lint, unit tests, integration tests, build, browser testing, deployment checks, and CI remain deferred to the final all-phase verification pass.

## Merge order

Phase 9 is stacked after Phases 5–6 and 7–8. Merge the earlier stacked pull requests first, then integrate the Phase 9–10 pull request only after explicit owner authorization.
