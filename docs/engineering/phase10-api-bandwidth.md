# Phase 10 — API Performance and Bandwidth

## Status

Implementation complete. This phase reduces response size and request fan-out without changing accounting, stock quantities, factory costing, permissions, posting, deletion, or export contents.

## Inventory payloads

### Selected location

The primary location inventory screen now requests:

```text
GET /api/locations/:locationId/inventory?profile=compact
```

The response is an explicit projection containing only the fields used by the screen. Historical `asOfDate` reads and `includeZero` remain supported. POS users continue to receive quantity while cost and value are redacted.

### All-location matrix

The combined-stock screen now requests:

```text
GET /api/inventory?profile=matrix
```

PostgreSQL aggregates the response into one row per stock item, including quantities by location, total quantity, weighted average cost, total value, stock group, and category. The browser no longer requests a 5,000-row page and then downloads every remaining page in parallel.

Normal paginated inventory remains available, but the page-size ceiling is 250 rows.

## Proforma payloads

The broad legacy proforma response remains compatible. Focused consumers can use:

```text
GET /api/factory/customer-proformas?profile=summary&customerId=:customerId
GET /api/factory/customer-proformas/summary?customerId=:customerId
GET /api/factory/customer-proformas/:id/lines
```

Summary responses contain proforma identity, activity state where available, line count, and total quantity. Line details are fetched separately only when required. The summary query deliberately avoids depending on optional production columns.

## Factory selector payloads

Factory workflows that only require selection data can use:

```text
GET /api/factory/workers?profile=selector
GET /api/factory/bale-products?profile=selector
```

Worker selectors exclude addresses, identity documents, banking information, salary data, emergency contacts, notes, permits, photos, and timestamps.

Product selectors exclude descriptions, prices, label configuration, and timestamps. Search and bounded limits remain available.

## Export memory

Location inventory XLSX exports are written with `ExcelJS.stream.xlsx.WorkbookWriter` directly to the HTTP response. The route no longer builds both a complete workbook object and a complete output buffer in application memory.

The exported columns and values remain unchanged:

- Item Code
- Item Name
- Group Code
- Group Name
- UOM
- Quantity
- Cost/Unit
- Total Value

## Database indexes

Migration `20260730_001_phase10_bandwidth_indexes.sql` adds idempotent indexes for:

- inventory company, stock item, and location aggregation;
- customer proforma lookup and sorting;
- proforma line detail lookup;
- active factory-worker selectors;
- active factory-product selectors.

## Route ownership

Focused handlers register before broad factory and location handlers. Express therefore resolves summary, selector, compact, matrix, and streaming-export requests before legacy dynamic routes while preserving legacy URLs for unchanged callers.

## Source verification

The permanent source verifier is:

```bash
node scripts/verify-phase10-api-bandwidth.mjs
```

The contract test is:

```text
tests/phase10-api-bandwidth-contract.test.ts
```

These contracts protect payload profiles, route order, the 250-row limit, matrix aggregation, streamed XLSX output, lazy proforma lines, selector fields, and index presence.

## Verification boundary

No CI, GitHub Actions, CircleCI, TypeScript compilation, formatting, lint, test execution, database migration execution, production build, browser verification, deployment, or runtime bandwidth smoke checks were run as part of this phase.
