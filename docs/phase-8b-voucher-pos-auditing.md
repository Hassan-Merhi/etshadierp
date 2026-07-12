# Phase 8B — Voucher and POS Auditing

Phase 8B connects the existing voucher and POS audit call sites to the shared Phase 8A audit framework.

## Coverage

The compatibility `logAudit` API remains unchanged for existing callers, including:

- POS sale creation and edit flows;
- voucher create, update, payment, transfer, journal, purchase, and sales flows;
- related approval and reversal paths that already emit voucher audit events.

All calls imported through `server/routes/_helpers.ts` now use `writeAuditEvent` from the shared audit service.

## Improvements

- recursive sensitive-value redaction;
- bounded audit payload size and depth;
- normalized actor and record identifiers;
- structured, payload-safe audit failure logging;
- consistent persistence behavior across voucher and POS routes;
- no changes to accounting, inventory, voucher numbering, or transaction business rules.

## Compatibility

Existing callers retain their current error-handling policy. Callers that intentionally treat audit writes as non-fatal may continue to catch failures; critical callers continue to receive propagated failures.

Transaction-bound audit writes remain available through the shared framework for future targeted conversions where the business mutation already exposes a transaction executor.
