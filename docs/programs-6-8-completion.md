# Programs 6–8 Completion Record

## Status

Repository implementation is complete for the 22-item Programs 6–8 queue tracked in issue #86.

This record consolidates the implementation and regression safeguards already present on `main` after the current-main Program 6 safe batch and Program 7 semantic completion were merged.

CI restoration was explicitly deferred by the owner before this phase. Therefore this record distinguishes repository implementation from runtime verification: it does not claim that GitHub Actions, TypeScript, builds, database rehearsals, or production smoke tests executed during this completion pass.

## Tier 1 — narrow API and query migrations

### 1. Bulk Rename light stock endpoint

`client/src/pages/settings/BulkRenameTab.tsx` uses `/api/stock-items/light` for selector data while retaining the existing bulk-rename mutation and invalidations.

### 2. Field-limited parent-group selector endpoint

`GET /api/ledger-accounts/parent-groups` is registered in `server/routes/ledgerRoutes.ts` before legacy ledger routes and delegates to `server/services/ledgerAccountOptionsService.ts` for an explicit field-limited select.

### 3. Accounts Parent Group migration

`client/src/pages/Accounts.tsx` routes the legacy parent-group-only request to `/api/ledger-accounts/parent-groups` while preserving the legacy Accounts screen and all non-parent-group requests.

### 4. Remaining stock-item caller review

The Program 6C audit and classification tooling remains in:

- `scripts/audit-program6c-stock-item-callers.mjs`
- `scripts/audit-program6c-inventory-payloads.mjs`
- `scripts/run-program6c-inventory-review.mjs`
- `scripts/validate-program6c-inventory-classifications.mjs`

Selector-only migrations are limited to confirmed field consumers. Full stock-item payloads remain where quantity, pricing, valuation, tax, alias, authorization, costing, or location data is required.

### 5. Query-key stability and duplicate-fetch reduction

The Factory Proforma stock-item query is scoped by selected company and disabled until a company is selected. Shared query-key and request-identity infrastructure remains in `client/src/lib/queryKeys.ts`, `client/src/lib/queryClient.ts`, and the accounting request guards.

### 6. Refetch and invalidation policy

Opening and closing historical-inventory snapshots no longer refetch on window focus or reconnect. Existing mutation invalidations and mount behavior remain intact.

## Tier 2 — bounded APIs and UI consistency

### 7. Location inventory bounds

`GET /api/locations/:locationId/inventory-rates` deduplicates positive stock-item IDs and rejects requests above 250 IDs. Company and POS-location authorization remain unchanged.

### 8. Stock movement and history bounds

Program 6D review confirms that stock movement summary is year-bounded and drill-down is month-bounded. Inventory lists and heavy history clients retain server-side filtering, deterministic ordering, and bounded pagination contracts.

### 9. Accounting and report pagination

Factory Daybook retains a maximum page size of 250, complete-filter counts, deterministic ordering, and pagination metadata. Accounts and report summaries preserve brought-forward, pre-period, closing, and full-filter total semantics. `scripts/verify-program6b-financial-pagination.mjs` protects these contracts.

### 10. Heavy import and route loading

The build includes the heavy-import lazy-loading plugin. Remaining large Excel and PDF libraries are loaded dynamically where safe, and the unused eager Excel helper import was removed from Login History.

### 11. Shared spacing, typography, cards, dialogs, forms, and tables

Current shared screen, state, dialog, form, card, table, and shell primitives provide the standard reusable contracts. Card titles now use heading semantics without changing their styles or API.

### 12. Financial-screen formatting and states

Shared financial screen and page-state primitives preserve consistent loading, empty, error, success, filtering, and action presentation without changing financial calculations.

### 13. Factory and inventory UI consistency

Factory and inventory modules use the current shared table, action, status, page-state, and navigation primitives. No stock quantity, costing, transfer, or factory workflow was changed by Program 7.

### 14. Accessibility and responsive behavior

The completed Program 7 batch provides:

- semantic EmptyState headings and descriptions;
- decorative icon and Skeleton handling;
- busy states for CompanyRow loading and saving;
- correct Alert element refs and attributes;
- decorative Progress indicator handling;
- semantic CardTitle headings; and
- inline Badge markup.

The newer shared `LoadingState` already provides status, live-region, busy, heading, description, and decorative-icon semantics.

## Tier 3 — database and resource controls

### 15. Query structure, N+1 review, parallel reads, and bounded search

Program 6D is recorded complete in `docs/program-6d-database-query-optimization.md`. All high-severity scanner findings were classified, independent reads were parallelized only where safe, and the net-profit endpoint replaced large entry materialization with grouped SQL.

### 16. Evidence-based indexes

No speculative index was added. Existing indexes were retained because query-plan evidence showed them sufficient. The Program 6D record documents the required evidence before any future index is added.

### 17. Export concurrency and memory protection

Current `main` includes:

- configurable heavy-export concurrency;
- bounded queues and wait timeouts;
- runtime soft and hard memory thresholds;
- endpoint-level export protection;
- controlled restart behavior;
- bounded Puppeteer concurrency and queue depth;
- user-readable queue-full and timeout failures; and
- stale-resource cleanup.

`scripts/verify-program6f-export-resource-controls.mjs` protects these invariants.

### 18. Safe large-export streaming

Workbook downloads spill to temporary files and stream with backpressure where consumers do not require an in-memory buffer. Disconnect and stale-file cleanup are retained. Buffered paths remain only where downstream attachment or provider workflows require complete bytes.

### 19. Voucher-entry and financial summary materialization

The evidence-backed net-profit conversion uses grouped SQL while preserving migrated-account, supplier, employee, mixed-FX, date, company, reversal, deletion, and status rules. Other complete reads remain only where response semantics require the complete filtered dataset.

## Tier 4 — workflow and traceability controls

### 20. Incomplete-workflow inventory

Program 8A classifies deliberate placeholders, unreachable legacy paths, dead props, structured server stubs, and deterministic mock sources in `scripts/program8a-incomplete-workflow-baseline.json`. `scripts/verify-program8a-incomplete-workflows.mjs` prevents new unclassified incomplete-workflow markers.

### 21. Approval, override, exception, reversal, and audit safeguards

Program 8B defines the required high-risk control classes:

- authorization;
- business validation;
- preview or dry run;
- explicit confirmation;
- transactional writes;
- audit trail; and
- idempotency or replay protection.

The baseline covers vouchers and reversals, stock movement and adjustments, factory recalculation and historical repair, container offload, administrative imports and repairs, payroll adjustments, and locked-period exceptions. Existing Program 3 operational permissions, route validation, confirmation adapters, audit services, and fail-closed replay controls remain the runtime enforcement model.

### 22. Reporting and source traceability

Program 8C defines stable identity, company scope, business date, source workflow, lifecycle state, and reference requirements across accounting, inventory, factory costing, containers, payroll, and administrative repair workflows. It also protects deterministic ordering, explicit date boundaries, company isolation, full-filter totals, and export parity.

## Superseded PR cleanup

The stale Program 6, Program 7, export-streaming, and all-at-once memory-hardening PRs were closed after their required changes were either reconciled onto current `main` or confirmed superseded by stronger current implementations.

## Completion boundary

Programs 6–8 repository work is complete. Remaining work belongs to later phases:

- CI and Security restoration;
- dependency cleanup;
- deployment and production smoke testing;
- database backup and controlled migration rehearsal; and
- final production verification.

Those items are not reopened as Programs 6–8 implementation tasks.
