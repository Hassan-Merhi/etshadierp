---
name: Transactional audit+repair atomicity pattern
description: How to make a financial write and its audit-log entry atomic instead of the audit call happening after the transaction commits.
---

Admin repair endpoints (FX rate resolution, raw-stock recalc) that write a
financial value AND log an audit entry must do both inside the SAME
transaction, with the audit insert last. If the audit insert fails, the
transaction rolls back the financial write too — never leave a financial
change committed without its audit trail.

**Why:** the original code called `logAudit(...)` (pool-level `db`, not the
transaction) AFTER the repair transaction had already committed. An audit
insert failure at that point would leave an untracked financial change.

**How to apply:** `logAudit()` in `server/routes/helpers/auditHelpers.ts`
accepts an optional second `dbConn` parameter (defaults to the pool-level
`db`); pass the transaction handle from inside an `onAudit(tx, result)`
callback that the repair service invokes just before returning from
`db.transaction(...)`. Combine with `pg_advisory_xact_lock` PLUS a
`SELECT ... FOR UPDATE` row lock on the target row so concurrent repairs on
the same row serialize instead of racing.
