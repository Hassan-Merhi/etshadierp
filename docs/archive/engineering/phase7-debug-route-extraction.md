# Phase 7 — Debug Route Extraction

## Status

Complete.

This repository phase is Phase 2 in the current god-file reduction roadmap.

## Result

`server/routes/debugRoutes.ts` was reduced from approximately 1,567 lines to a composition-only facade. It now preserves the original registration sequence while delegating implementation ownership to focused modules under `server/routes/debug`.

## Extracted ownership

- `inventoryDebugRoutes.ts`
  - stock-item inventory inspection;
  - deleted and inactive location visibility;
  - active and all-record totals.
- `importCycleDiagnosticRoutes.ts`
  - authentication and response boundary for `/api/debug/import-cycle`.
- `importCycleDiagnosticFoundation.ts`
  - negative and orphaned inventory detection;
  - unbalanced voucher, stale-container, and duplicate-inventory detection;
  - account, supplier, bank, stock, expense, and liability balance collection;
  - canonical import-cycle balance calculation.
- `importCycleDiagnosticAnalysis.ts`
  - account-to-bucket reconciliation;
  - component variance analysis;
  - offloaded-container voucher audit;
  - final diagnostic response assembly.
- `orphanedChargeVoucherRoutes.ts`
  - orphaned charge-voucher diagnostics;
  - admin repair endpoint.
- `factoryOrderRepairRoutes.ts`
  - active factory customer-order total recalculation.

`registerOffloadRoutes(app)` remains in the same position in the public debug registrar, between orphaned-charge registration and factory-order repair registration.

## Behavior-preservation contract

- Endpoint paths are unchanged.
- Authentication and role requirements are unchanged.
- Registration order is unchanged.
- Company-context checks and HTTP error responses are unchanged.
- Diagnostic issue identifiers, thresholds, labels, guidance, reconciliation data, container audit data, and response keys are preserved.
- The import-cycle calculation still uses final-only two-decimal rounding.
- Offload route registration remains part of the same composition boundary.

## Permanent boundaries

- `server/routes/debugRoutes.ts` is capped at 20 lines and may not own HTTP handlers, database imports, Drizzle imports, or schema imports.
- Import-cycle data collection is capped at 650 lines.
- Import-cycle reconciliation and response assembly is capped at 700 lines.
- Every TypeScript module under `server/routes/debug` must remain below the repository's 900-line soft god-file boundary.
- Source-contract verification protects endpoint ownership, permission markers, registration order, and line ceilings.

## Verification boundary

No CircleCI, GitHub Actions, database execution, production build, browser verification, deployment, or runtime smoke checks were run. The phase includes a deterministic verifier, Vitest source contract, and repository god-file boundary updates.
