# Programs 6–8 Completion Roadmap

Branch: `integration/programs-1-to-6-validation`

Safety rules:
- Never merge or push directly to `main` without explicit owner approval.
- Never deploy or apply production migrations automatically.
- Preserve accounting balances, inventory values, costing rules, and historical transactions.
- Audit existing implementations before changing behavior.

## Program 6 — Performance and bandwidth

- [x] 6A — Measurement and endpoint ranking
  - Rank endpoints by response size, frequency, latency, memory, and database cost.
  - Retain the existing opt-in bandwidth logger, but extend measurement beyond responses above a fixed byte threshold.
  - Produce a reproducible ranking report without logging bodies, credentials, cookies, tokens, SQL text, query parameters, or record identifiers.
  - Implemented aggregate per-route measurement for request count, errors, total/average/max response bytes, average/max latency, heap delta, PostgreSQL query count, and PostgreSQL duration.
  - Implemented normalized route grouping so numeric and UUID identifiers do not fragment rankings or expose identifiers.
  - Implemented request-scoped database attribution with AsyncLocalStorage and no database timing overhead outside an active profiled request.
  - Implemented periodic configurable top-N ranking events and focused regression coverage.
  - Operational procedure documented in `docs/program-6a-endpoint-ranking.md`.
- [x] 6B — Daybook, accounts, and reports
  - Factory Daybook retains bounded opt-in pagination, full-filter counts, and stable ordering.
  - Legacy ledger selectors retain their complete array contract and server-side type/search filters.
  - Added the field-limited `/api/ledger-accounts/parent-groups` contract for explicit and legacy parent groups.
  - Migrated the Accounts Parent Group request while preserving the original balance-aware Accounts implementation.
  - Preserved opening-balance side, pre-period net, brought-forward, running, and closing-balance semantics.
  - Confirmed net profit is a summary-only contract and must remain independent of pagination.
  - Transferred the evidence-backed voucher-entry SQL aggregation rewrite to Program 6D because migrated-account attribution requires query-plan and reconciliation validation.
  - Added static guards for page limits, full-filter counts, deterministic ordering, parent-group field limits, legacy compatibility, and report page-independence.
  - Final audit documented in `docs/program-6b-daybook-accounts-reports-audit.md`.
- [x] 6C — Stock and inventory APIs
  - Preserved the full stock-item compatibility and paginated management contracts for screens that require pricing, opening-balance, costing, alias, tax, and location-price fields.
  - Completed and registered the field-limited `/api/stock-items/light` identity/classification contract with company isolation and deterministic ordering.
  - Migrated the remaining confirmed selector-only direct caller, Bulk Rename, without changing its mutation or cache invalidation behavior.
  - Confirmed existing selector, voucher, transfer, proforma, reporting, purchase-order, credit-note, data-tool, detail lookup, and offline-preparation callers use lightweight query keys where safe.
  - Preserved `/api/inventory` server pagination, a 250-row maximum, independent counts, server filters, and authoritative quantity/rate/value fields.
  - Confirmed movement summaries are year/month bounded and drills require one explicit month while retaining full-period totals and historical opening-state calculations.
  - Added strict caller classification and completion guards in `scripts/audit-program6c-stock-item-callers.mjs` and `scripts/verify-program6c-stock-inventory-contracts.mjs`.
  - Final audit documented in `docs/program-6c-stock-inventory-api-audit.md`.
- [~] 6D — Database-query optimization
  - Added a deterministic static scanner for possible N+1 reads, broad selects, unbounded reads, and sequential-query candidates.
  - Added a reproducible JSON report runner and strict manual-classification validator.
  - Added `scripts/verify-program6d-query-safety.mjs` to preserve accounting attribution, supplier pure-side filtering, full-dataset totals, and the query-plan evidence rule.
  - Reviewed existing bounded/parallel implementations across Daybook, Accounts, Inventory, stock items, stock movement, and net-profit metadata reads.
  - Confirmed the net-profit materialized entry arrays are aggregation candidates, but preserving migrated-account versus voucher-company attribution requires before/after database reconciliation.
  - No speculative index was added because production-like `EXPLAIN (ANALYZE, BUFFERS)` evidence is not available.
  - Remaining completion gate: run the scanner in a real checkout, classify its exact high-severity findings, compare grouped net-profit SQL against current totals, and collect query plans before index changes.
  - Current review boundary documented in `docs/program-6d-database-query-optimization.md`.
- [x] 6E — Frontend bundle and caching
  - Confirmed broad route-level code splitting through centralized `React.lazy` imports across ERP, POS, Factory, and Supplier Partner pages.
  - Preserved dynamic Excel helper loading on heavy export screens so ExcelJS/XLSX work stays outside initial route bundles.
  - Confirmed shared heavy query-key factories normalize filters and use the real request URL as key element zero.
  - Preserved distinct full and lightweight stock-item cache prefixes so full-list invalidations cannot refetch selector payloads.
  - Preserved global suppression of polling, window-focus, mount, and reconnect refetches.
  - Preserved active-query-only invalidation helpers and parameterized-key prefix predicates.
  - Added `scripts/verify-program6e-frontend-bundle-caching.mjs` to prevent bundle and caching regressions.
  - Final audit documented in `docs/program-6e-frontend-bundle-caching.md`.
- [ ] 6F — Exports and resource limits
  - Stream where supported, queue Puppeteer work, enforce memory/download/concurrency limits, and fail safely.

## Program 7 — User interface consistency

- [ ] 7A — Design system
- [ ] 7B — Financial screens
- [ ] 7C — Factory and inventory screens
- [ ] 7D — Accessibility and responsive behavior

## Program 8 — Business functionality refinement

- [ ] 8A — Incomplete workflow audit
- [ ] 8B — Approval and exception workflows
- [ ] 8C — Reporting and traceability

## Current audit checkpoint

Existing performance work found:
- Compression is enabled for text and JSON responses.
- Hashed static assets use long-lived immutable caching.
- HTML and dynamic API responses avoid stale caching.
- Earlier heavy-API pagination and memory-stabilization scripts exist.

Programs 6A, 6B, 6C, and 6E are implementation-complete. Program 6D still requires real-checkout findings and database reconciliation evidence before behavior-changing query or index work can be marked complete. Program 6F and Programs 7–8 remain unfinished.
