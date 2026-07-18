# Program 4 — Security Integration and Runtime Enforcement

Status: complete. This branch is stacked on the completed, unmerged Program 3 branch.

## Phase sequence

- [x] 4A — Route and service adoption audit
- [x] 4B — Authentication and session enforcement adapters
- [x] 4C — Company isolation enforcement on high-risk reads and writes
- [x] 4D — Privileged operation enforcement on repair and administrative endpoints
- [x] 4E — Unsafe input validation on sensitive mutations
- [x] 4F — Protected file, attachment, report, and export enforcement
- [x] 4G — Security audit persistence and anomaly surfacing
- [x] 4H — End-to-end enforcement tests and integration report

## Phase 4B

Status: complete.

Authentication and session enforcement is connected to production middleware through `sessionEnforcementAdapter.ts`.

## Phase 4C

Status: complete for the first production slice.

- Adopted the Program 3 company-isolation boundary in `server/routes/factory/factoryInsuranceRoutes.ts`.
- The operating company comes from authenticated session state.
- Request body or query `companyId` values are assertions only and must match the session company.
- Applied the boundary to member lists, member ledger reads, creation, updates, toggles, deletion, and monthly journal generation.
- Retained company predicates on insurance members, vouchers, and linked ledger cleanup.
- Cross-company attempts receive a non-leaking response.
- Added focused regression coverage showing privileged roles cannot bypass company isolation.
- Tests were added but not executed through Replit or GitHub Actions.

## Phase 4D

Status: complete for the first privileged production slice.

- Added `server/services/security/privilegedOperationEnforcementAdapter.ts`.
- Wired the Program 3 privileged-operation policy in front of `/api/admin/rebuild-inventory` through `server/routes/adminRoutes.ts`.
- Preserved the existing default dry-run behavior.
- Applying changes requires same-company context, the exact repair permission, reason, idempotency key, source identity, company-bound confirmation, and recent password confirmation.
- Added focused adapter regression coverage.
- Tests were added but not executed through Replit or GitHub Actions.

## Phase 4E

Status: complete for the first sensitive production mutation.

- Added `server/services/security/unsafeInputEnforcementAdapter.ts`.
- Wired the Program 3 fail-closed validation boundary before the privileged inventory-rebuild gate.
- The inventory rebuild request accepts only `dryRun`, `reason`, `confirmationToken`, `idempotencyKey`, and `sourceId`.
- Unknown fields, prototype-pollution keys, excessive nesting, oversized strings, and invalid field types are rejected before route logic.
- The validated payload is frozen and replaces `req.body`, preventing downstream code from consuming unapproved fields.
- Dry-run compatibility is preserved with `{ dryRun: true }` or an empty approved payload.
- Added focused regression coverage.
- Tests were added but not executed through Replit or GitHub Actions.

## Phase 4F

Status: complete for the first protected production asset surface.

- Added `server/services/security/protectedAssetDownloadAdapter.ts`.
- Intercepted factory container-document downloads before the legacy upload route.
- Canonical storage lookup now validates asset existence, company ownership, storage key, byte size, and filename before file access.
- Same-company access remains available to existing authenticated factory roles; cross-company access is non-leaking.
- Downloads are forced to attachment disposition with RFC 5987 filename encoding.
- Added `X-Content-Type-Options: nosniff` and private no-store caching headers.
- Disk cache and database-backed file fallback behavior are preserved.
- Added focused regression coverage for same-company access, cross-company denial, unsafe storage keys, invalid sizes, and header injection resistance.
- Tests were added but not executed through Replit or GitHub Actions.

## Phase 4G

Status: complete for the first production security-event slice.

- Added `server/services/security/securityAuditRuntime.ts` using the existing append-only `audit_log` table; no schema migration was introduced.
- Applied inventory-rebuild authorization attempts are persisted before mutation logic can run.
- Allowed and denied privileged-operation events include company, actor, action, target identity, reason code, IP address, user agent, and non-secret metadata.
- Program 3 metadata redaction prevents passwords, confirmation tokens, credentials, cookies, and authorization values from being persisted.
- Added `GET /api/admin/security-anomalies` for Admin/Developer users.
- The endpoint is strictly scoped to the active session company and the most recent 15-minute window.
- It surfaces repeated denials and privileged-operation failures through the Program 3 anomaly detector.
- Added focused regression coverage for append-only mapping, redaction, target identifiers, and anomaly classification.
- Tests were added but not executed through Replit or GitHub Actions.

## Phase 4H

Status: complete.

- Added `tests/program-4-end-to-end-enforcement.test.ts`.
- The suite exercises validation, frozen payload handoff, privileged permission enforcement, confirmation-token enforcement, password-confirmation enforcement, audit persistence, fail-closed persistence behavior, and anomaly classification as one chain.
- Unsafe fields and invalid idempotency keys are rejected before privileged authorization.
- Approved operations cannot reach route logic unless their security decision is persisted.
- Added `docs/program-4-security-integration-report.md` with production adoption, compatibility bridges, verification boundaries, and remaining incremental rollout.
- Tests were added but not executed through Replit or GitHub Actions.
- Runtime deployment verification is not claimed.

## Completion

Program 4 phases 4A through 4H are complete on this dedicated branch. Broader route-by-route adoption is documented as future incremental rollout rather than unfinished Program 4 scope.

## Safety constraints

- Never merge automatically or push directly to `main`.
- Preserve existing authorization until replacement enforcement is equivalent or stricter.
- Do not change accounting balances, stock values, costing rules, or historical transactions.
