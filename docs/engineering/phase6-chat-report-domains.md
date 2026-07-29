# Phase 6 — Chat report domain extraction

## Status

Phase 6 is **in progress**.

The stable `server/chat/reports.ts` facade and semantic ownership boundaries are present, but the original report implementations remain consolidated in `server/chat/reports/legacyReportEngine.ts`. At approximately 3,704 lines, that compatibility engine is still an oversized file and must be removed before this phase can be called complete.

## Completed

- Kept `chatService.ts` dependent on the stable `runDataQuery` entry point.
- Reduced `server/chat/reports.ts` to a thin facade.
- Added shared report context and result contracts.
- Added ownership modules for accounting, customers/suppliers, inventory, factory, containers, sales, and operations.
- Added deterministic domain dispatch.
- Preserved existing SQL, query names, limits, labels, tables, statistics, and no-data behavior through the compatibility engine.
- Added a static verifier and source-contract test.

## Completion criteria

Phase 6 is complete only when all of the following are true:

1. Every report implementation is physically moved into bounded handler modules.
2. `server/chat/reports/legacyReportEngine.ts` is deleted.
3. No compatibility fallback delegates to one monolithic switch.
4. Every supported query type has exactly one owner and implementation.
5. `chatService.ts` contains no report SQL or query-type switch.
6. Existing query names and response shapes remain unchanged.

## Verification boundary

No CI, TypeScript, formatting, lint, tests, database execution, production build, browser verification, deployment, or runtime smoke checks have been run.
