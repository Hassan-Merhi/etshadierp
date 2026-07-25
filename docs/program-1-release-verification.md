# Program 1 — Release Verification

Baseline branch: `main`

Baseline commit: `3872e2eaf16be020ca7a4d16234830604582af0e`

Started: 2026-07-25

## Safety boundary

Program 1 is verification-first. This branch must not change accounting totals, inventory quantities or valuation, historical transactions, company data, production migrations, permissions, or user-facing workflows while the baseline is being established.

No production database actions, deployments, repairs, backfills, or destructive commands are part of Program 1.

## Phase 1A — Current-main verification

The goal is to establish current evidence for the exact baseline commit rather than relying on older test-count documentation.

### Required checks

- Dependency installation from the committed lockfile
- TypeScript type check
- Production frontend and server build
- ESLint
- Changed-file formatting check
- Test database schema preparation
- Application startup and startup-migration readiness against the temporary CI database
- Backend tests
- Backend coverage thresholds
- Frontend tests
- Frontend coverage thresholds

### Workflow evidence

Opening draft PR #193 triggered the repository's existing workflows for head commit `5bd7022a0b7aa23ba94470f7606a65a157a276db`.

- CI run `1113` (`30163274267`) concluded `failure`.
- Security run `661` (`30163274252`) concluded `failure`.
- The CI job and both Security jobs reported zero executable steps.
- GitHub exposed no job logs; the log download returned a missing-blob response.

Because no checkout, installation, build, test, audit, or scan step started, these workflow conclusions are classified as **Actions infrastructure / repository execution blocked**, not as application failures.

### Static wiring review

The repository configuration was inspected without changing application code:

- `package.json` defines direct scripts for TypeScript, production build, lint, backend tests, frontend tests, and coverage.
- The TypeScript command is explicitly `tsc --noEmit` and the project has `strict: true`.
- The production build runs the Vite frontend build, server bundling, and server-bundle verification.
- CI is configured for Node.js 20 and a temporary PostgreSQL 15 service.
- CI is configured to prepare the temporary schema, start the built application, and wait for `/api/health/db` before backend tests.
- Backend and frontend Vitest configurations and coverage thresholds are present.
- Security is configured for production dependency auditing and TruffleHog secret scanning.

This proves the intended verification path is wired. It does **not** prove the current baseline passes because the runner never executed a step.

### Evidence status

| Check | Status | Evidence |
|---|---|---|
| Dependency installation | Blocked | CI job ended before checkout or installation |
| TypeScript | Blocked | Command is configured; no step executed |
| Production build | Blocked | Command is configured; no step executed |
| ESLint | Blocked | Command is configured; no step executed |
| Formatting | Blocked | Changed-file check is configured; no step executed |
| Temporary database schema | Blocked | PostgreSQL and schema step are configured; no step executed |
| Startup migrations | Blocked | `/api/health/db` readiness step is configured; no step executed |
| Backend tests | Blocked | Vitest command is configured; no step executed |
| Backend coverage | Blocked | Coverage command is configured; no step executed |
| Frontend tests | Blocked | jsdom/Vitest command is configured; no step executed |
| Frontend coverage | Blocked | Coverage command is configured; no step executed |
| Dependency security audit | Blocked | Security job ended before steps |
| Secret scan | Blocked | Security job ended before steps |

## Phase 1B — Financial regression baseline

### Audit method

Phase 1B reviewed the exact test and source files present on the isolated branch. No test was represented as passing because the Actions runner did not execute. The statuses below describe the **presence and strength of regression coverage**, not current execution results.

### Coverage matrix

| Financial area | Existing regression evidence | Static assessment |
|---|---|---|
| Central posting validation | `tests/central-posting-engine.test.ts` rejects unbalanced entries, multiple accounting targets, declared-total mismatch, and duplicate idempotent posting | Strong service-level validation; production-route adoption is not proven |
| Manual journals | `tests/workflow.test.ts`, `tests/accounting.test.ts`, and `tests/vouchers.test.ts` cover balanced creation, edit, soft deletion, and ledger effects | Strong for ordinary USD ledger journals |
| Payments and receipts | Workflow tests cover balance changes, deletion reversal, balanced receipt entries, retrieval, and list visibility | Strong for generic ledger-to-ledger payments; party and FX variants need more coverage |
| POS accounting and inventory | Workflow tests cover exact cash-ledger movement, voucher DR=CR, inventory deduction, and exact delete reversal | Strong standard ERP coverage |
| Supplier Partner sales | `tests/sp-sales-accounting.test.ts` protects exact sale-price posting, prevents COGS double-counting, validates bank/cash targets, rejects missing payment account, and preserves final unit cost for profit reporting | Strong targeted SP sale coverage |
| Stock transfer creation | Workflow and inventory-hardening tests cover source/destination quantities, balanced voucher entries when present, `inventoryApplied`, invalid quantity rejection, same-location rejection, and negative-source conservation | Strong creation coverage; edit/delete reversal remains a gap |
| SP container lifecycle | `tests/factory-container-lifecycle.test.ts` covers setup idempotency, Goods OTW voucher balance, offload status, inventory quantity/value/rate, offload voucher balance, and double-offload rejection | Strong create/offload coverage; reverse/re-offload and partial charges are not executable tests |
| Factory supplier costing | `tests/factory-mix-batch-stable-cost.test.ts` protects event-driven moving-average cost, no drift through consumption/create/edit/top-up/delete, no double deduction, and supplier isolation | Strong targeted costing coverage |
| Cost-cascade precision | `tests/issue-fixes-regression.test.ts` covers per-container source weight and Decimal-based batch/bale cascade precision | Strong targeted regression coverage |
| Negative-stock costing | `tests/inventory-hardening.test.ts` protects zero on-hand value, preserved non-negative cost memory, exact reversal to zero, repeated receive/reversal stability, and positive-stock value equation | Strong coverage for the current intentional cost-memory policy |
| Reports | Workflow tests compare ledger API balance with DB entries, assert exact simple-case P&L income, verify known cash balance, and reject NaN/undefined report values | Good basic USD evidence; complex report and FX scenarios remain unproven |
| Multi-currency storage rules | `tests/multi-currency-integration.test.ts` covers CFA normalization, historical base values, opening-balance currency rules, migration presence, unresolved-history guards, and cash/bank revaluation source rules | Strong pure/static rule coverage; limited route-and-database integration evidence |
| Company isolation | Workflow tests protect voucher lists, cross-company account balance access, and location inventory from another company | Good core coverage; broader financial/report/export domains need expansion |
| Party reconciliation | `tests/party-reconciliation-service.test.ts` covers exact match/mismatch calculation, currency mismatch rejection, batch summaries, and duplicate target rejection | Strong service-level unit coverage; customer/supplier route lifecycle is not proven |

### Confirmed coverage gaps

These are evidence gaps, not confirmed production bugs.

1. **ERP/factory container end-to-end lifecycle**
   - The current lifecycle integration test exercises `sp_containers`, not the separate `factory_containers` / `factory_raw_stock` workflow.
   - Factory container create, offload, own-account freight, other charges, reversal, and re-offload need a route-level integration suite.

2. **Own-account freight full chain**
   - Recent code fixes changed freight account selection, voucher posting, reverse-offload posting, supplier balance exclusion, and supplier statement totals.
   - Existing issue regression coverage protects partial PATCH preservation of `freightSupplierId`, but does not prove the complete accounting chain.
   - Required future assertions: supplier balance unchanged, selected own account credited, freight expense debited, statement excludes freight, reversal restores both accounts, and reposting is idempotent.

3. **Stock-transfer edit and deletion reversal**
   - Creation and rejection behavior are protected.
   - There is no clearly identified end-to-end assertion that deleting or editing a completed transfer restores both locations exactly once and reverses all accounting records.

4. **Customer and supplier balance lifecycle**
   - Reconciliation arithmetic is unit-tested, but there is no complete route-level matrix for create, edit, delete, opening balance, payment/receipt, foreign currency, and report/statement agreement.

5. **Multi-currency report execution**
   - Historical amount normalization and guard source behavior are well covered.
   - A temporary-database workflow should seed USD and CFA historical entries, change the current rate, and prove that sales, expenses, balances, Net Position, and protected reports retain the correct historical/current-translation separation.

6. **Broader company isolation**
   - Current integration coverage proves vouchers, one account-balance endpoint, and inventory.
   - Supplier/customer statements, payroll, factory costing, SP records, backup/export endpoints, and analytics/report routes still need cross-company negative tests.

7. **Central posting engine adoption**
   - The central engine is validated in isolation.
   - The main production posting routes still require a separate adoption audit; service tests alone do not prove that journals, payments, POS, containers, payroll, rentals, and SP all pass through the same boundary.

8. **SP reverse/re-offload and partial charges**
   - The lifecycle test still contains three `it.todo` cases for route-level reverse/re-offload and prepaid/paid/unpaid charge combinations.
   - The TODO explanation about zeroing `averageRate` conflicts with the newer intentional cost-memory tests and must not drive a production change.

### Phase 1B conclusion

The system has substantial financial regression coverage, especially around ordinary vouchers, POS, SP sales, stock-transfer creation, SP offload, factory supplier costing, negative-stock cost memory, and basic company isolation.

The baseline is **not fully verified** because the runner did not execute.

## Phase 1C — Documentation and test alignment

### Conflict resolved

The audit confirmed that current production logic and active `tests/inventory-hardening.test.ts` intentionally preserve the last non-negative `averageRate` as cost memory while forcing `totalValue = 0` when quantity is zero or negative.

Older skipped-test and TODO descriptions incorrectly prescribe forcing both value and rate to zero. Following those stale descriptions would change the established negative-stock costing policy.

### Authoritative policy added

`docs/inventory-cost-memory-policy.md` now records the current rule:

```text
quantity <= 0  =>  totalValue = 0 and averageRate >= 0
```

The document identifies the stale references, explains why cost memory is preserved, lists route-level scenarios that remain unverified, and prohibits changing `inventoryHelper.ts` merely to satisfy the obsolete `rate = 0` expectation.

### Deferred test-file cleanup

No test was unskipped and no large test file was rewritten while CI is unavailable. When an executable runner is restored, the stale skipped-test titles and SP lifecycle TODO descriptions should be updated together with route-level reversal coverage, then the full backend suite must run before any unskip is accepted.

### Phase 1C result

- Current inventory policy is explicitly documented.
- A dangerous contradictory “fix path” is now blocked by authoritative documentation.
- No costing, inventory, accounting, schema, route, or user-facing behavior changed.
- Program 1 has completed its safe static audit and documentation alignment.

## Branch integrity

At this evidence point the branch differs from `main` only by:

- `docs/program-1-release-verification.md`
- `docs/inventory-cost-memory-policy.md`

No application, schema, migration, workflow, dependency, test, accounting, inventory, or frontend source file has been changed.

## Merge rule

This branch remains isolated and unmerged until the owner explicitly approves a merge. A verification failure is evidence to investigate, not permission to make a broad repair.
