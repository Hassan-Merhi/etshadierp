# Programs 6–8 Completion Roadmap

Branch: `integration/programs-1-to-6-validation`

Safety rules:
- Never merge or push directly to `main` without explicit owner approval.
- Never deploy or apply production migrations automatically.
- Preserve accounting balances, inventory values, costing rules, and historical transactions.
- Audit existing implementations before changing behavior.

## Program 6 — Performance and bandwidth

- [ ] 6A — Measurement and endpoint ranking
  - Rank endpoints by response size, frequency, latency, memory, and database cost.
  - Retain the existing opt-in bandwidth logger, but extend measurement beyond responses above a fixed byte threshold.
  - Produce a reproducible ranking report without logging bodies, credentials, cookies, or tokens.
- [ ] 6B — Daybook, accounts, and reports
  - Paginate or summarize the heaviest accounting and reporting endpoints.
  - Preserve totals and reconciliation semantics independently of page size.
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
- An opt-in `BANDWIDTH_DEBUG` middleware logs very large responses.
- Earlier heavy-API pagination and memory-stabilization scripts exist.

Open gap:
The existing bandwidth audit does not provide the Program 6A multi-factor endpoint ranking. It primarily inventories likely heavy routes and logs responses above a size threshold. Program 6A therefore remains open pending aggregate measurements for request count, response bytes, latency, process-memory delta, and an explicit database-cost signal where available.
