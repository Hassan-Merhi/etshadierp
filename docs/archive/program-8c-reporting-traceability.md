# Program 8C — Reporting and Traceability

## Status

Implementation-complete as a reporting and traceability contract, baseline, and static regression safeguard.

No accounting, inventory, costing, posting, or historical transaction behavior was changed.

## Objective

Program 8C defines the minimum evidence that must remain available when a user, accountant, administrator, or auditor needs to answer:

- What record changed?
- Which company owns it?
- Which business date and lifecycle state apply?
- Which workflow created or changed it?
- Which source document or reference connects it to the surrounding transaction chain?
- Do screen totals, paginated results, and exports represent the same filtered dataset?

The phase deliberately avoids a broad schema rewrite or a new reporting engine. Existing mature screens, reports, journal contracts, exports, and audit records remain the source of truth.

## Required traceability contract

High-risk records must retain stable record identity, company scope, business date, creation timestamp where available, actor or system source, source workflow, lifecycle status, and a document or reference number where the workflow has one.

A field may be represented by an existing equivalent rather than by one globally named column. For example, a voucher number, container number, batch number, transfer reference, repair token, or audit-event identifier can satisfy the reference requirement when it uniquely connects the record to its source workflow.

## Required reporting contract

Reports and trace screens must preserve:

- deterministic ordering;
- explicit date boundaries;
- company isolation;
- server-side filtering for large datasets;
- full-filter totals independent of pagination;
- export parity with the visible filters and report scope;
- privacy-safe diagnostics that do not log hidden record bodies, credentials, tokens, cookies, SQL text, or unrelated identifiers.

Full-filter totals means that pagination may reduce the rows returned to the browser, but it must not change balances, summary values, brought-forward amounts, closing balances, or report-level totals for the selected filter set.

Export parity means a CSV, Excel, PDF, or other export must use the same company, date range, status, account, supplier, location, and other active report filters as the visible report unless the export clearly declares a different scope.

## Covered workflow families

### Accounting journal and vouchers

Preserve debit/credit balance, brought-forward and closing-balance semantics, source references, status, company attribution, business date, and reversal history. Pagination must not alter totals or reconciliation.

### Inventory and stock movements

Preserve authoritative quantity, rate, value, item, source and destination location, company scope, business date, and movement reference. Reports must not reconstruct authoritative inventory values from incomplete browser pages.

### Factory costing and mix batches

Preserve supplier attribution, container and offload links, mix-batch identity, historical cost evidence, business date, and lifecycle state. This contract does not redefine FIFO, average-cost, landed-cost, or recalculation behavior.

### Container and offload lifecycle

Preserve original container identity and cost evidence, received-weight history, supplier attribution, offload status, post-offload adjustments, and references to downstream costing or voucher effects.

### Payroll and employee adjustments

Preserve employee, company, pay-period, business date, adjustment source, status, and actor/system attribution where the existing workflow records it.

### Administrative repairs and imports

Preserve dry-run evidence, confirmation scope, actor authorization, audit event, status, and idempotency or replay evidence. Sensitive payloads must not be copied into general logs merely to improve traceability.

## Machine-readable baseline

`scripts/program8c-reporting-traceability-baseline.json` records:

- accepted trace fields;
- required report properties;
- covered high-risk workflow families;
- risk classification;
- family-specific preservation boundaries.

The baseline is intentionally semantic. It protects business evidence and report behavior without forcing unrelated modules into one schema or one UI implementation.

## Regression safeguard

`scripts/verify-program8c-reporting-traceability.mjs` validates that:

- all mandatory traceability and reporting properties remain declared;
- required high-risk workflow families remain classified;
- critical and high-risk families retain stable identity, company scope, workflow attribution, deterministic ordering, and company isolation;
- unknown requirement names and duplicate family IDs are rejected;
- each family retains an explicit preservation contract;
- this audit and its safety boundaries remain present.

The verifier was added but was not executed, in accordance with the instruction not to run CI, builds, scripts, or runtime verification.

## Safe adoption boundary

Future feature work may improve individual screens or add missing trace fields, but it must be owned by the affected workflow and reconciled against existing records. Program 8C does not authorize:

- changing posted accounting values;
- recomputing inventory or costing history;
- rewriting historical business dates;
- changing company attribution;
- deleting or collapsing reversal and adjustment evidence;
- changing export scope silently;
- creating speculative audit records for historical actions where the actor cannot be proven.

## Completion result

Programs 7A–7D and 8A–8C now have documented shared contracts and static safeguards. The only remaining Programs 6–8 blocker is Program 6D's previously documented requirement for real-checkout scanner classification, database reconciliation, and production-like query-plan evidence before behavior-changing query or index work can be marked complete.
