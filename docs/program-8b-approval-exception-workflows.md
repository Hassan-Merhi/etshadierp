# Program 8B — Approval and Exception Workflows

## Scope

Program 8B defines the control model for high-risk ERP actions without changing existing runtime behavior.

The repository currently has **No universal approval engine**. Instead, protections are distributed across route authorization, business validation, explicit confirmation, dry-run or preview modes, database transactions, audit records, and replay protection. This phase records that distributed model as the supported baseline rather than introducing a speculative new workflow engine.

## Control contract

High-risk workflows are classified against seven control classes:

1. Authorization
2. Business validation
3. Preview or dry run where practical
4. Explicit confirmation for destructive or historical actions
5. Transactional writes
6. Audit trail
7. Idempotency or replay protection

The machine-readable baseline is stored in:

`./scripts/program8b-approval-exception-baseline.json`

The static verifier is stored in:

`./scripts/verify-program8b-approval-exceptions.mjs`

## Classified workflow families

- Voucher posting and reversal
- Stock movement, transfer, and adjustment
- Factory cost recalculation and historical repair
- Container offload and post-offload adjustment
- Opening-balance import and administrative data tools
- Payroll adjustments and bonuses
- Accounting-period or locked-record exceptions

These families are intentionally classified by risk and required safeguards. The baseline does not claim that every individual route already implements every ideal control; it establishes the review standard for future implementation and refactoring.

## Exception-handling rules

High-risk operations should **fail closed** when authorization, validation, confirmation, or required evidence is missing.

Exceptions must not silently bypass normal accounting, stock, costing, period-lock, or ownership rules. Any sanctioned override should be narrow, attributable to an actor, tied to an explicit scope, and leave durable evidence.

Bulk repair and historical correction paths should prefer preview-first execution, operation-bound confirmation, transaction boundaries, and idempotent application.

## Safety boundary

No runtime behavior was changed in Program 8B.

Specifically, this phase did not:

- add or remove approval requirements;
- change user roles or permissions;
- alter voucher posting, reversal, or deletion;
- alter stock transfers, adjustments, or negative-stock handling;
- alter factory costing, container offload, or mix-batch calculations;
- alter payroll posting;
- alter database schemas or API contracts;
- introduce a new universal approval engine.

## Follow-on

Program 8C covers reporting and traceability. It should use this control classification when defining what actor, scope, decision, exception, and outcome evidence must remain visible in reports and audit views.
