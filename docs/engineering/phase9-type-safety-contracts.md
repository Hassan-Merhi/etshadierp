# Phase 9 — Type-Safety Contracts

Phase 9 hardens the frontend session boundary. Authentication and company-session responses now use runtime validation instead of flowing through `any`.

## Runtime validation

Static TypeScript types do not validate server JSON. The new contracts treat payloads as unknown at the network boundary and validate them before application use.

Covered responses:

- authenticated user from `/api/auth/me`;
- company assignments from `/api/user/companies`;
- session company from `/api/auth/session-company`.

Malformed data now produces an explicit contract error rather than silently changing navigation or company state.

## Authenticated user

`useAuthenticatedUser` returns `AuthenticatedUser | null`. The schema requires a username, accepts the existing ID formats, preserves optional role and POS station values, and allows additional server fields.

Logout errors are handled as `unknown`.

## Company assignments

`CompanyContext` consumes `UserCompanyAssignment[]` and maps each assignment through a typed function. Company IDs must be positive integers and company types are restricted to supported modes.

Unknown historical company types retain the existing ERP fallback.

## Session company

The initial session-company response is parsed from `unknown`. It accepts a positive integer ID or `null`, preserving the serialized, server-authoritative synchronization behavior introduced earlier.

## Selector cleanup

`CompanySelector` uses shared `Company` and `CompanyType` contracts. It no longer contains `company: any`, `as any`, or `error: any` in the company-switching path, and it continues to route every switch through `CompanyContext`.

## Compatibility boundary

- Existing endpoints and response fields are unchanged.
- Additional response fields remain available.
- Unknown company types keep the ERP fallback.
- Serialized switching, cache eviction, offline behavior, and navigation remain unchanged.
- No database, accounting, costing, or inventory behavior is changed.

## Verification boundary

Focused tests cover authentication payloads, company assignments, company-type fallback, nullable session companies, and source wiring. The static verifier rejects untyped session queries and unsafe selector casts.

Suggested commands:

```bash
node scripts/verify-phase9-type-safety-contracts.mjs
node node_modules/vitest/vitest.mjs run tests/ui/session-contracts.test.ts tests/ui/phase9-type-safety-wiring.test.ts
```

These commands were added but not executed.

## Merge boundary

Phase 9 was integrated only after the earlier roadmap phases and explicit owner authorization. CI, TypeScript compilation, formatting, lint, tests, build, browser verification, and deployment verification were not run.
