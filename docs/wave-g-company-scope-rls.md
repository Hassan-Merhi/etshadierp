# Wave G — Company-Scope RLS Startup Cutover

`migrations/0016_company_scope_rls_readiness.sql` is now part of the runtime-authoritative startup path.

The migration is applied by `server/companyScopeRlsBridge.mjs`, which is imported by both the bundled database bootstrap (`server/db.ts`) and the existing production preload chain (`server/supplierCompanyScopeBridge.mjs`). A process-global symbol makes those two paths idempotent within one process.

The bridge runs the reviewed SQL inside a transaction, takes a transaction-scoped advisory lock so concurrent deployments serialize the DDL, applies bounded lock and statement timeouts, verifies the helper functions, RLS flags and policies, commits only after verification, and aborts startup on failure.

This is a readiness cutover, not FORCE RLS. Legacy connections with no `app.current_company_id` continue to see their prior data surface. Transactions that set a positive `app.current_company_id` are restricted to that company. Malformed or non-positive values fail closed. `FORCE ROW LEVEL SECURITY` remains a separate future cutover after every application transaction carries company scope.
