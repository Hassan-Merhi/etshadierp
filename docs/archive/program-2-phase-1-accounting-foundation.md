# Program 2 — Phase 1: Accounting convergence foundation

Status: complete

Branch: `agent/program-2-phase-1-accounting-foundation`

## Purpose

Program 2 converges accounting writes onto one explicit, transaction-owned posting model without changing historical totals, exchange-rate conventions, inventory quantities, party balances, deletion semantics, or workflow-specific compatibility effects.

Phase 1 establishes the authoritative contract and route inventory required before any production cutover. It does not migrate or reinterpret a live posting flow.

## Non-negotiable invariants

Every later Program 2 posting cutover must prove all of the following before it can be considered complete:

1. **Balanced decimal posting** — debits and credits balance using decimal arithmetic at the precision required by the source workflow.
2. **One transaction owner** — the source document, voucher, entries, mandatory inventory effects, party-balance effects, idempotency marker, and posting audit are committed or rolled back together.
3. **Company ownership** — every company-scoped target is validated against the active company before the first write.
4. **Deterministic source identity** — retries use a stable source identity plus a payload fingerprint; changed content cannot reuse an old identity silently.
5. **Replay safety** — a replay returns the original result and skips employee, inventory, daybook, WhatsApp, notification, audit-detail, and other compatibility effects that must not run twice.
6. **Historical currency preservation** — transaction currency, base currency, exchange-rate direction, original base totals, and rounding behavior remain unchanged.
7. **Exact lifecycle reversal** — edit and deletion reverse the original effects exactly once before applying replacements or completing deletion.
8. **Period-lock enforcement** — dated business writes must check the accounting period in the same transaction before their first write.
9. **Read-only migrated records** — migrated or historical records that are already protected remain protected.
10. **Explicit compatibility boundary** — unsupported drafts, advanced currency payloads, specialized deletion flows, and high-risk workflows remain on their current path until migrated separately.
11. **No production repair** — route convergence cannot silently repair historical data or rewrite balances.
12. **Focused regression evidence** — each route cutover documents preserved behavior, passthrough cases, replay behavior, rollback behavior, and exact reversal.

## Authoritative accounting service boundary

`server/services/accounting/index.ts` is the public boundary for strict Program 2 accounting services. It exposes:

- `postBalancedVoucherTx` and central posting validation;
- database-backed ownership, idempotency, replay, and audit dependencies;
- manual journal, generic voucher, and Payment/Receipt request builders;
- customer linked-ledger validation;
- atomic employee-balance application and reversal;
- voucher replacement and reversal lifecycle services;
- party reconciliation;
- accounting-period locks; and
- controlled reconciliation reporting and approved repair execution.

New or migrated accounting writes must use the strict boundary rather than importing low-level persistence helpers directly, unless a documented compatibility adapter owns the transaction and proves the same invariants.

## Posting-path classification

The machine-readable source of truth is `docs/program-2-posting-path-inventory.json`.

Each path is assigned one of four states:

- `centralized` — the supported active subset posts through the strict accounting boundary;
- `hybrid` — a protected subset is centralized while unsupported compatibility cases intentionally pass through;
- `legacy-isolated` — unchanged until a later route-specific phase because mandatory non-accounting effects require separate ownership work;
- `read-only-or-repair` — does not represent ordinary live posting and must remain explicitly controlled.

## Phase 1 deliverables

- Authoritative accounting invariants documented.
- Machine-readable domain and posting-path inventory added.
- Existing centralized, hybrid, and intentionally deferred boundaries classified.
- High-risk workflows ordered for separate migration rather than broad replacement.
- Static verifier added at `scripts/verify-program2-phase1-accounting-foundation.mjs`.
- Verifier checks required services, inventory completeness, allowed classifications, required invariants, and dangerous scope changes.
- No runtime route, database schema, posting calculation, balance, inventory, costing, permission, or UI behavior changed.

## Verification command

```bash
node scripts/verify-program2-phase1-accounting-foundation.mjs
```

The verifier is source-level evidence only. It does not prove a TypeScript build, database-backed tests, migration rehearsal, or production execution.

## Completion boundary

Phase 1 is complete when this contract and inventory are present and the verifier succeeds. Production route migration begins only in later phases, one workflow at a time.
