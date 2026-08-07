# Bandwidth Phase 5 — diagnostics and final production verification

## Diagnostic warning contract

Every bandwidth ranking and budget warning now identifies the HTTP method and normalized endpoint, request count, total/average/largest response, `200` and `304` counts, cache hits, misses and revalidations, suspected polling loops, and bounded company/page contexts. Large-response warnings carry the same request context.

## Production acceptance targets

- API responses remain below **50 MB per five-minute window**.
- No single API endpoint exceeds **20 MB per five-minute window**.
- Customer-proforma list responses remain near or below **25 KB** under representative production data; full line details load only after an explicit user action.
- Hidden tabs do not poll.
- Reopening dialogs, tabs and pages reuses stable cached data where valid.
- Conditional requests produce visible `304`/revalidation evidence instead of retransferring unchanged JSON.

## Final regression matrix

Verify proforma list/detail and invoice creation, loading scans and Pending Loadings, dispatch batches and customer-order verification, container/tracking pages, accounting/daybook, English/Arabic/French, phone/tablet/desktop layouts, multiple browser tabs, and company switching. Confirm session/company isolation throughout.

No accounting, costing, stock quantity, permissions, schema, SQL migration, or production-data behavior changes in this phase.
