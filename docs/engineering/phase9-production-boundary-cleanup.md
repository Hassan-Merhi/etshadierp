# Phase 9 — Production Module and Startup Boundary Cleanup

## Purpose

This phase closes production failures that survived the legacy-route architecture refactor. The active route graph had already moved to focused registrars, but two composition files still referenced retired compatibility modules and the Sales voucher editor rendered a form-context component outside its required provider.

This phase is the fourth implementation phase in the current stabilization stack and is built directly on Phase 8 accounting and multi-currency stabilization.

## Route composition cleanup

`server/routes/authRoutes.ts` now composes only the focused authentication registrars:

1. core authentication;
2. session management;
3. audit log;
4. user administration;
5. user access;
6. company access;
7. user presence;
8. exchange rates.

The retired `authRoutesLegacy.ts` import, call, and file are removed.

`server/routes/reportsRoutes.ts` now composes only the focused reporting registrars:

1. net-profit statements;
2. closing stock;
3. dashboard accounts;
4. container tracking;
5. ledger reports;
6. voucher detail.

The dangling `reportsRoutesLegacy.ts` import and call are removed. That target did not exist and could prevent the production server bundle from resolving its module graph.

## Physical retirement contract

The following paths must remain absent:

- `server/routesLegacy.ts`;
- `server/routes/reportsRoutesLegacy.ts`;
- `server/routes/authRoutesLegacy.ts`;
- `server/routes/customerRoutesLegacy.ts`.

The route composition tests, duplicate-ownership tests, backend-separation tests, architecture audit, and Phase 9 verifier now agree on physical deletion. They no longer require empty compatibility exports or calls to no-op registrars.

## Sales voucher edit crash

`SalesEditForm.tsx` previously rendered `FormLabel` for the display-only Location field outside a `FormField` render boundary. The shared `FormLabel` calls `useFormField`, so opening a Sales voucher could throw before the redirect or editor workflow completed.

The Location caption is now a semantic plain-text label styled to match the form. All actual controlled fields retain `FormLabel` inside `FormField`.

No sales amount, stock item, location, quantity, price, optional-voucher, save, or inventory behavior is changed.

## Repository relative-import audit

`scripts/audit-relative-imports.mjs` parses source files with the TypeScript syntax tree and inspects:

- static imports;
- `export ... from` declarations;
- import-equals external references;
- dynamic `import()` calls;
- CommonJS `require()` calls.

The audit scans `server`, `client/src`, `shared`, `scripts`, and `tests`. It resolves exact files, extensionless source modules, directory index modules, TypeScript sources referenced with JavaScript extensions, JSON, stylesheets, images, documents, SQL, WebAssembly, and other explicit assets.

It fails when:

- a relative import cannot be resolved;
- a source file imports one of the retired route registries.

Package aliases and third-party package names are outside this audit because their resolution belongs to TypeScript, Vite, or Node package configuration.

## Prebuild enforcement

The existing `scripts/verify-lockfile-registry.mjs` command remains the package `prebuild` entry point. It now performs both:

1. lockfile registry safety verification;
2. repository relative-import verification.

A missing production module therefore fails before Vite or esbuild begins instead of surfacing late during deployment.

## Contracts

Phase 9 adds or updates:

- `scripts/audit-relative-imports.mjs`;
- `scripts/verify-phase9-production-boundary.mjs`;
- `scripts/verify-lockfile-registry.mjs`;
- `tests/phase9-production-boundary-contract.test.ts`;
- auth and report route composition tests;
- duplicate route ownership tests;
- backend module separation tests and verifier.

## Scope isolation

The fixes were selected from the production issues represented in PR #320, but the unrelated container-report supplier grouping and multi-select changes carried in that branch were not included.

No Analytics report grouping, container filtering, supplier identity, report total, API payload, or container query behavior is modified by this phase.

## Verification boundary

No CI, GitHub Actions, CircleCI, TypeScript compilation, formatting, lint, Vitest execution, database execution, production build, browser verification, deployment, or runtime smoke check was run in this connected session.

The phase includes deterministic source contracts and a prebuild import audit, but their execution is not claimed.

## Merge boundary

This phase must remain stacked on Phase 8 until the earlier pull requests are integrated. Merge or retarget in stack order.
