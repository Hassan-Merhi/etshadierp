# Program 3 — Security Remediation Report

Date: 2026-07-18

Status: Program 3 policy and regression package complete on the dedicated draft branch. Not merged.

## Scope completed

Program 3 added focused, pure security boundaries for:

- central authorization decisions;
- storage-backed company and tenant isolation;
- privileged and destructive operation approval;
- session, authentication, and credential-version validation;
- strict validation for security-sensitive mutation payloads;
- protected file, attachment, and export access;
- normalized security audit records and anomaly classification.

The branch also contains focused tests for every boundary and a consolidated cross-boundary regression suite.

## Final remediation found during Phase 3I

The consolidation review identified one policy mismatch:

- The general authorization boundary intentionally allows Admin and Developer roles to bypass ordinary permission checks.
- The privileged-operation documentation and intended control model require Admin or Developer role **and** the exact named privileged permission.

Phase 3I corrected this by enforcing the exact permission directly in `privilegedOperationPolicy.ts` after same-company and privileged-role authorization. A regression test now confirms that an Admin without the declared privileged permission is denied with `PERMISSION_REQUIRED`.

## Verified invariants in the branch

- Cross-company access is evaluated before privileged role or permission handling.
- Admin and Developer cannot bypass company ownership checks.
- Privileged operations require same-company context, privileged role, exact permission, reason, source identity, idempotency key, confirmation where configured, and recent password confirmation.
- Security-sensitive mutation schemas reject unknown fields, unsafe identifiers, non-finite numbers, malformed dates, excessive structure, and prototype-pollution keys.
- Protected assets require canonical metadata lookup and safe storage keys before access is granted.
- Security audit metadata redacts credential and session material and supports bounded anomaly detection.
- Public errors remain non-leaking while machine-readable denial codes are retained.

## Regression inventory

Focused suites:

- `tests/authorization-policy.test.ts`
- `tests/company-isolation-policy.test.ts`
- `tests/privileged-operation-policy.test.ts`
- `tests/session-security-policy.test.ts`
- `tests/unsafe-operation-validation.test.ts`
- `tests/protected-asset-access-policy.test.ts`
- `tests/security-audit-policy.test.ts`

Consolidated suite:

- `tests/program-3-security-regression.test.ts`

## Important deployment limitation

The Program 3 boundaries are intentionally pure and additive. Existing route middleware was not broadly replaced in this program. Production protection therefore depends on route and service adapters calling these policies at each applicable endpoint.

Before treating Program 3 as fully deployed in production, complete a route-adoption pass that maps every sensitive endpoint to the appropriate boundary and verifies the adapter inside the request transaction. This is an integration requirement, not a reason to weaken or remove the policies added here.

## Verification status

- Repository files and PR patches were inspected directly on GitHub.
- The final permission-bypass mismatch was remediated and covered by tests.
- No Replit-hosted checks or Replit credits were used.
- The newly added tests were **not executed** in this phase because the requested workflow avoids Replit and no GitHub Actions run was initiated.
- No claim is made that runtime deployment verification has passed.

## Data-safety statement

Program 3 does not intentionally modify accounting balances, stock quantities, costing, vouchers, historical transactions, or other business records.

## Merge status

PR #79 must remain draft and unmerged until the owner explicitly approves merging the completed Program 3 package.
