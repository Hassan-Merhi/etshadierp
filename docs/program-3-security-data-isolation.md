# Program 3 — Security, Authorization, and Data Isolation

Status: in progress. This branch is stacked on the completed, unmerged Program 2 branch and must remain unmerged until the owner approves the completed Program 3 package.

## Phase sequence

- [x] 3A — Security and authorization surface audit
- [x] 3B — Central authorization policy boundary
- [x] 3C — Company and tenant isolation enforcement
- [x] 3D — Privileged action and admin-operation controls
- [x] 3E — Session, authentication, and credential hardening
- [x] 3F — Input validation and unsafe-operation protection
- [ ] 3G — File, export, and attachment access controls
- [ ] 3H — Security audit logging and anomaly reporting
- [ ] 3I — Security regression suite and remediation report

Each phase must be completed and committed separately. Do not begin Program 4 on this branch.

## Phase 3A — Security and authorization surface audit

Status: complete.

- Classified authentication, route authorization, company isolation, privileged operations, validation, file access, and security-audit risks.
- Assigned remediation ownership across Phases 3B–3I.

## Phase 3B — Central authorization policy boundary

Status: complete.

- Added the canonical, pure authorization decision boundary.
- Enforced company isolation before role and permission evaluation.
- Added default-deny behavior and non-leaking authorization errors.

## Phase 3C — Company and tenant isolation enforcement

Status: complete.

- Added canonical storage-backed object ownership checks.
- Prevented privileged roles from bypassing cross-company isolation.
- Added company-filter validation for lists, reports, and exports.

## Phase 3D — Privileged action and admin-operation controls

Status: complete.

- Added fail-closed controls for repair, recalculation, migration, destructive, credential, permission, configuration, and diagnostic-write operations.
- Required same-company authorization, exact permission, reason, source identity, idempotency, confirmation, and recent password confirmation.

## Phase 3E — Session, authentication, and credential hardening

Status: complete.

- Added canonical fail-closed session validation.
- Added absolute and idle expiry, credential-version revocation, company context, and recent password confirmation controls.
- Preserved login throttling, session regeneration, CSRF issuance, and persisted session save.

## Phase 3F — Input validation and unsafe-operation protection

Status: complete.

### Completed work

- Added `server/services/security/unsafeOperationValidation.ts` as the canonical fail-closed validation boundary for security-sensitive mutations.
- Required plain-object payloads and rejected arrays, primitives, class instances, and polluted object prototypes at the request boundary.
- Added strict unknown-field denial by default so hidden or misspelled control fields cannot silently reach mutation logic.
- Added reusable rules for strings, safe integers, positive identifiers, finite numbers, six-decimal strings, booleans, dates, enums, objects, and arrays.
- Rejected non-finite numeric values, invalid identifiers, impossible calendar dates, and decimal values beyond six fractional digits.
- Added recursive denial of `__proto__`, `prototype`, and `constructor` keys to block prototype-pollution payloads.
- Added configurable limits for nesting depth, array size, and string size to constrain abusive payloads before service execution.
- Added mandatory mutation-provenance validation for actor reason, idempotency key, source type, and source ID.
- Returned a frozen shallow copy of accepted payloads so downstream adapters cannot mutate the validated top-level request object accidentally.
- Kept the policy pure and additive; existing route schemas remain in place and can migrate incrementally without losing current validation.

### Verification

- Added focused tests for valid strict payloads, unknown fields, invalid and non-finite identifiers, decimal precision, impossible dates, oversized arrays, prototype-pollution keys, and missing provenance.
- Confirmed invalid requests expose only `Invalid request` while retaining machine-readable issue codes and paths.
- Confirmed no accounting balances, stock quantities, costing, sessions, or historical business records were modified.
- Verification was limited to focused static inspection and test-contract review; no Replit checks or credits were used.

## Next phase

- Phase 3G — File, export, and attachment access controls

## Safety constraints

- Do not merge automatically.
- Do not push directly to `main`.
- Preserve every phase as a separate commit.
- Do not use Replit-hosted checks or consume Replit credits.
- Do not weaken an existing authorization check while centralizing policy.
- Do not modify accounting balances, stock values, or historical transactions as part of Program 3.
