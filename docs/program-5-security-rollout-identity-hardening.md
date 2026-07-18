# Program 5 — Security Rollout and Identity Hardening

Status: in progress on `agent/program-5-security-rollout-identity-hardening`.

This program expands the Program 3 policy package and Program 4 production proof points into a broader ERP rollout. It remains stacked on the completed, unmerged Program 4 branch.

## Phase sequence

- [x] 5A — Enterprise security adoption inventory and rollout map
- [x] 5B — Persistent named permissions and administration
- [x] 5C — Persistent credential versions and session invalidation
- [x] 5D — Explicit company-context enforcement and legacy fallback removal
- [x] 5E — Privileged-operation rollout across high-risk repair and recalculation writes
- [x] 5F — Sensitive-input schema rollout across prioritized high-impact mutations
- [x] 5G — Protected asset, report, export, and attachment rollout
- [ ] 5H — Security-event coverage expansion, migration cleanup, and end-to-end report

## Phase 5A — Enterprise security adoption inventory and rollout map

Status: complete.

Program 3 supplies canonical policies for authorization, company isolation, privileged operations, sessions, unsafe input, protected assets, and security audit records. Program 4 connected selected production proof points. Program 5 rolls those controls out in dependency order: persistent permissions, credential versions, explicit company context, privileged writes, exact input schemas, protected assets, and final audit cleanup.

## Phase 5B — Persistent named permissions and administration

Status: complete.

- Added company-scoped `user_security_permissions` persistence and migration `0003_user_security_permissions.sql`.
- Added permission catalog validation, grant replacement, membership enforcement, session hydration, targeted invalidation, and security-audited administration endpoints.
- Removed the privileged-operation role compatibility bridge.
- Added focused regression tests; tests were not executed.

## Phase 5C — Persistent credential versions and session invalidation

Status: complete.

- Added `user_credential_versions` and migration `0004_user_credential_versions.sql`.
- Added password-change version rotation and session revocation.
- Added bounded version hydration to shared authentication middleware and stale-session rejection.
- Added focused regression tests; runtime migration and trigger behavior were not verified.

## Phase 5D — Explicit company-context enforcement and legacy fallback removal

Status: complete.

- Added one authoritative company source: authenticated `session.currentCompanyId`.
- Legacy factory and request-supplied company IDs are assertions only and must match.
- Applied the boundary to the active raw-stock production route group.
- Added focused regression tests; runtime factory-session behavior was not verified.

## Phase 5E — Privileged-operation rollout

Status: complete for the prioritized high-risk raw-material repair surface.

- Added persisted permission `factory.raw-stock.repair` and migration `0005_raw_stock_repair_permission.sql`, seeded for existing Admin/Developer company memberships.
- Added `legacyPrivilegedWriteGuard.ts` to compose existing signed domain confirmation flows with Program 3 controls.
- Confirmed apply routes keep their read-only preview behavior, while actual writes require the exact named permission, recent password confirmation, a reason, a bounded deterministic idempotency key, company alignment, and a security decision recorded before business mutation.
- Direct legacy repairs require the same controls on every call.
- Protected raw-stock cost recalc apply, zero-cost source repair, apply-all-safe, automatic FX correction, supplier locked-rate recompute, source mismatch repair, and destructive recalc undo.
- Existing signed repair tokens, user/company binding, stale-input fingerprints, row locks, transactional business audit records, and undo snapshots remain intact.
- Added focused regression coverage; tests were not executed.

## Phase 5F — Sensitive-input schema rollout

Status: complete for the prioritized high-impact raw-material repair surface.

- Added `rawStockSensitiveInputGuard.ts` and mounted it before privileged authorization and route business logic.
- Added exact top-level allow-list schemas for recalc apply, zero-cost source repair, apply-all-safe, automatic FX correction, supplier-rate recompute, source mismatch repair, and destructive undo.
- Rejected unknown fields, prototype-pollution keys, invalid object shapes, excessive nesting, oversized arrays and strings, malformed primitive types, and non-finite values.
- Required container and source identifier arrays to contain unique positive safe integers with a maximum of 500 entries.
- Restricted manual-rate maps to selected source IDs and bounded positive finite numeric values.
- Replaced `req.body` with the validated frozen payload before downstream middleware runs.
- Added focused regression coverage; tests were not executed.

## Phase 5G — Protected asset, report, export, and attachment rollout

Status: complete for the prioritized stored-file and inherited container-document surfaces.

- Preserved the Program 4 container-document protected download boundary.
- Added `storedFileAccessAdapter.ts` for `/api/files/:id/download` and `/api/files/:id/preview` before the legacy byte-stream handlers.
- Added persisted named permission `files.download` and migration `0006_stored_file_download_permission.sql`, seeded for existing Admin/Developer company memberships.
- Stored-file access now loads the canonical asset record, validates asset identifiers and metadata, enforces authenticated same-company scope, requires the exact permission unless the requester is the recorded owner, and returns non-leaking not-found responses on denial.
- Persisted allowed and denied protected-asset security decisions without exposing file contents or secrets.
- Added `X-Content-Type-Options: nosniff` and `Cache-Control: private, no-store` before legacy download and preview handlers respond.
- Reused canonical filename sanitization for traversal, control-character, and header-injection resistance.
- Added focused regression coverage for exact-permission access, role-only denial, cross-company denial, invalid assets, and filename sanitization.
- Tests were written but were not executed through Replit or GitHub Actions.
- Runtime migration, legacy client access, response streaming, deployment, and production behavior verification are not claimed.

## Next phase

Phase 5H — Security-event coverage expansion, migration cleanup, and end-to-end report.

## Safety constraints

- Never merge automatically or push directly to `main`.
- Keep the Program 5 pull request draft until explicit owner approval.
- Preserve accounting balances, inventory values, costing, and historical transactions.
- Do not claim test, runtime, deployment, or database verification unless actually performed.
- Avoid Replit-hosted checks and Replit credit usage.
