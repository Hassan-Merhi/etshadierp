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
- [~] 6B — Daybook, accounts, and reports
  - Paginate or summarize the heaviest accounting and reporting endpoints.
  - Preserve totals and reconciliation semantics independently of page size.
  - Confirmed the factory Daybook already has bounded opt-in pagination with full-filter counts and stable ordering.
  - Confirmed ledger account type/search filters are already pushed into SQL.
  - Identified the remaining unbounded no-filter ledger-account path and documented the compatibility-safe migration approach.
  - Added `server/lib/boundedPagination.ts`, a shared opt-in pagination parser that preserves legacy response shapes while enforcing conservative page-size limits for migrated callers.
  - Added focused Program 6B unit coverage for legacy opt-in compatibility, endpoint-specific bounds, `pageSize` aliasing, oversized limits, and invalid/negative inputs.
  - Confirmed the net-profit statement already has a 30-second company/date keyed cache and parallel independent reads, but still materializes full period and all-time voucher-entry sets; SQL summary migration remains.
  - Added `scripts/verify-program6b-financial-pagination.mjs` to protect full-filter counts, deterministic ordering, brought-forward balances, and server-side account filtering.
  - Confirmed the main Accounts screen uses the balance-aware `/api/accounts/all` contract; the unbounded `/api/ledger-accounts` call on that screen is limited to parent-group options and should be narrowed rather than replacing the primary balance source.
  - Audit and acceptance criteria documented in `docs/program-6b-daybook-accounts-reports-audit.md`.
- [ ] 6C — Stock and inventory APIs
  - Return only required fields, add bounded server-side filtering, and eliminate duplicate requests.
  - Preserve stock quantities, values, precision, and company isolation.
- [ ] 6D — Database-query optimization
  - Review query plans, add evidence-backed indexes, remove N+1 queries, parallelize independent reads, and bound searches.
- [ ] 6E — Frontend bundle and caching
  - Lazy-load Excel/PDF dependencies, stabilize React Query keys, and constrain invalidation/refetch behavior.
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

Program 6A is implementation-complete. Program 6B is in progress. The shared bounded-pagination primitive, focused compatibility tests, and financial-pagination guard are committed; next work is wiring opt-in pagination into selected ledger/report routes, adding full-filter count/summary queries, and narrowing the Accounts parent-group lookup without changing legacy selectors or financial totals.
