# System quality program

This document is the current reference for the repository quality program that
covers **type safety**, **test breadth**, **documentation state**, and
**configuration coherence**. Historical phase notes belong under
`docs/archive/`; this file describes the rules that are enforced now.

The governing principle is the same as the god-file program: **measurement and
a falling ratchet come before cleanup**. A cleanup without a ratchet can refill
silently; a ratchet without a behavioural test can give a false sense of safety.

## Where things stand

Every bound figure below is checked by `npm run audit:doc-index` against its live
source. If one of these numbers changes without this document changing, the
audit fails instead of allowing the reference to drift.

| Signal | Now | Command |
|---|---|---|
| Type escapes (AST) | 11,398 total | `npm run audit:type-escapes` |
| Backend coverage floor (lines) | 18% | `config/coverage-thresholds.json` |
| Write routes with no test at all | 0 of 328 | `npm run audit:write-routes` |
| Write routes covered only by the guard sweep | 0 of 328 | `npm run audit:write-routes` |
| Registered routes | 1,891 | `config/route-manifest.json` |
| God-file backlog | 64 files, 33,920 excess lines | `npm run audit:god-files` |

The schema layer remains the type source of truth. New code is not allowed to
increase the type-escape ceiling, and sensitive write routes are not allowed to
fall back to anonymous-auth coverage only.

---

## Phase 0 — measurement foundation

Phase 0 created the instruments that make the rest of the program enforceable.
It is complete.

### Type-escape census

`scripts/audit-type-escapes.mjs` measures `: any`, `as any`, and TypeScript
suppression escapes per file. The committed baseline may only fall. New files
cannot add escapes without either fixing them or deliberately changing the
baseline in the same reviewed change.

```bash
npm run audit:type-escapes
```

### Money-endpoint characterization

`tests/report-endpoint-characterization.test.ts` pins the output of high-risk
money/report endpoints so refactors cannot silently change financial results.
The characterization set includes the purchase-order write path and factory raw
stock offload path in addition to the read/report endpoints.

### Documentation state index

`config/doc-index.json` classifies current reference documents and archived
records and binds important numerical claims to live configuration/audit
sources.

```bash
npm run audit:doc-index
```

---

## Phase 1 — type-safety ratchet

The type-safety foundation is complete and the long-term drawdown remains an
ownership rule: code that is touched should improve or preserve its local escape
count; untouched code cannot get worse.

`@typescript-eslint/no-explicit-any` is visible during development, while the
exact enforcement comes from `config/type-escape-boundaries.json`. Drizzle raw
result casts were reduced through typed helpers such as `resultRows()` and
`firstRow()` so raw SQL row shapes are declared next to the query rather than
forced through `any`.

The rule for future work is simple: **do not raise a frozen type-escape baseline
to make unrelated churn fit**. If formatting or file-size gates block a cleanup,
fix the structural blocker instead of creating headroom that can refill.

---

## Phase 2 — coverage breadth and sensitive writes

Phase 2 is complete at the ratchet level.

### Read-surface contract sweep

The API smoke sweep does more than check liveness. Stable read endpoints have a
pinned status/shape contract in `config/api-smoke-shapes.json`, so an endpoint
that silently starts refusing access or drops response structure is detected.

```bash
npm run test:smoke-sweep
```

### Sensitive write audit

`scripts/audit-write-route-coverage.mjs` classifies POST/PUT/PATCH/DELETE routes
whose owner files write money or stock-ledger tables such as `vouchers`,
`voucher_entries`, `inventory`, `sales_items`, `factory_raw_stock`,
`factory_bales`, and `ledger_accounts`.

There are two zero ceilings in `config/write-route-coverage.json`:

- **uncoveredSensitiveCeiling = 0** — every sensitive write must be covered by a
  test surface;
- **guardOnlySensitiveCeiling = 0** — authentication-only coverage is not enough.

The unauthenticated guard sweep remains important because it proves every
sensitive write rejects anonymous callers. It no longer receives credit as the
only behavioural evidence for any sensitive route.

### Authenticated write-safety sweep

`tests/write-route-authenticated-safety-sweep.test.ts` closes the broad gap for
routes that would otherwise have only the anonymous guard assertion. It derives
that exact pre-sweep set from the audit at runtime and invokes every route as an
authenticated Developer in the appropriate ERP, Factory, Properties, or
Supplier Partner company mode.

The sweep is intentionally **non-mutating**. It uses missing resource IDs and
poison/dry-run validation bodies and asserts that each call:

- does not 5xx;
- does not lose the authenticated session;
- does not change the selected company's voucher totals, ledger-account count,
  inventory quantity/value, raw-stock quantity, bale count, or sales-item count;
- leaves all non-optional vouchers balanced;
- does not touch sentinel accounting state in unrelated ERP, Factory,
  Properties, or Supplier Partner companies.

This is negative-path behavioural coverage, not a replacement for deep
positive-path tests. Exact accounting/stock behaviour continues to be pinned by
route/domain tests that assert journal direction, quantities, statuses,
reversals, and lifecycle transitions. Examples added during the drawdown include
purchase-order edits/deletes, factory reverse-offload, and container other-charge
posting/replacement.

`tests/write-route-authenticated-safety-audit.test.ts` protects the measurement
itself: with the authenticated sweep deliberately disabled, the audit must still
see the pre-sweep guard-only backlog; with it enabled, that same measured set
must fall to zero. The audit also requires the sweep's dynamic inventory,
sensitive fingerprint, voucher-balance assertion, and isolation sentinels to
remain present before it grants that coverage. A leftover marker comment is not
enough.

```bash
npm run audit:write-routes
```

**Phase 2 exit criteria:** no sensitive write route is uncovered; no sensitive
write route is covered only by the anonymous guard sweep; authenticated
negative-path atomicity and cross-company isolation are enforced across the
remaining surface; deep positive-path domain tests remain the source of truth
for the numbers written.

---

## Phase 3 — documentation state

Documentation-state enforcement is complete. Current references live under
`docs/`; completed phase/program records live under `docs/archive/`.
`config/doc-index.json` enforces that classification and binds live figures to
sources so reference documents fail when important numbers drift.

`docs/README.md` is the entry point for current documentation.

---

## Phase 4 — configuration coherence

Configuration coherence is complete and enforced rather than conventional.
Node/toolchain sources are audited for one supported version, script inventory
is classified and ratcheted, and active workflows are named for what they check
instead of old phase numbers.

Key checks include:

```bash
npm run audit:toolchain
npm run audit:scripts
```

A wired verification script is expected to run, not merely exist. Dead or
source-text-coupled checks should be removed or replaced with behavioural
assertions rather than carried indefinitely as misleading safety signals.

---

## Phase 5 — tighten ratchets

Tightening is the ongoing maintenance phase. When measured coverage or code
quality improves, the corresponding floor/ceiling must move in the same change
so the improvement cannot silently refill later.

Targets include:

- lower type-escape ceilings as domains are cleaned;
- raise coverage floors to track measured coverage with margin;
- lower god-file soft limits/backlog as files are split;
- keep sensitive-write uncovered and guard-only ceilings permanently at zero.

---

## Working rules

1. **Baseline changes travel with the implementation.** Do not leave headroom
   after reducing a backlog.
2. **Do not regenerate behavioural pins for an accidental change.** A changed
   pin is a behaviour change and must be reviewed as one.
3. **Negative-path sweeps do not replace positive-path accounting tests.** The
   broad sweep proves safety/atomicity; domain tests prove the numbers.
4. **Company isolation is part of correctness.** A route that writes the right
   amount to the wrong company is still a failed financial write.
5. **Final release verification happens after implementation phases.** Full
   backend/frontend suites, build, lint/format, audit gates, GitHub Actions and
   external CI are run together at the final verification phase so intermediate
   implementation work is not repeatedly blocked by the full matrix.
