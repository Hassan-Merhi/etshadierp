# Audit Framework

Phase 8A introduces the shared server-side foundation for subsequent audit coverage work.

## Scope

The framework provides:

- typed audit actors, actions, events, and change records;
- bounded, recursive sanitization before data reaches `audit_log`;
- automatic redaction of passwords, tokens, cookies, authorization values, API keys, session/CSRF values, private keys, and connection strings;
- deterministic before/after diff construction;
- normalized actor and record identifiers;
- transaction-compatible writes through an injectable database executor;
- structured failure logging that excludes audit payload values;
- focused regression tests for redaction, bounds, diff construction, persistence, and failure handling.

## Usage

Use `writeAuditEvent` for a completed business mutation. When the mutation already runs inside a database transaction, pass the transaction object as the executor so the business change and audit record commit or roll back together.

Use `buildAuditChanges` when a route or service has before/after snapshots. Pass an explicit field list when only selected business fields should be audited.

## Safety rules

- Do not include request or response bodies wholesale.
- Do not include credentials, session material, attachment contents, SQL, or connection strings.
- Use stable record identifiers that help investigation without exposing secrets.
- Prefer transaction-bound audit writes for financial and inventory mutations.
- Do not silently swallow audit-write failures for critical mutations unless the calling flow has an explicitly documented policy.
- Do not use audit events as a substitute for accounting or inventory invariants.

## Follow-on packages

- Phase 8B applies the framework to voucher and POS flows.
- Phase 8C applies it to inventory, transfers, and containers.
- Phase 8D applies it to payroll, accounts, users, roles, and migrations.

Those integrations are intentionally excluded from Phase 8A to keep the foundation independently reviewable and low risk.
