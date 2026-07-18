# Program 5 — Security Rollout and Identity Hardening

Status: in progress on `agent/program-5-security-rollout-identity-hardening`.

This program expands the Program 3 policy package and Program 4 production proof points into a broader ERP rollout. It remains stacked on the completed, unmerged Program 4 branch.

## Phase sequence

- [x] 5A — Enterprise security adoption inventory and rollout map
- [x] 5B — Persistent named permissions and administration
- [ ] 5C — Persistent credential versions and session invalidation
- [ ] 5D — Explicit company-context enforcement and legacy fallback removal
- [ ] 5E — Privileged-operation rollout across repair, recalculation, import, configuration, and diagnostic writes
- [ ] 5F — Sensitive-input schema rollout across remaining mutations
- [ ] 5G — Protected asset, report, export, and attachment rollout
- [ ] 5H — Security-event coverage expansion, migration cleanup, and end-to-end report

## Phase 5A — Enterprise security adoption inventory and rollout map

Status: complete.

### Confirmed inherited security foundations

- Program 3 supplies canonical policies for authorization, company isolation, privileged operations, sessions, unsafe input, protected assets, and security audit records.
- Program 4 connects those policies to selected production boundaries and proves their middleware composition.
- Existing proof points include session enforcement, factory-insurance company isolation, inventory-rebuild privileged enforcement, exact mutation input validation, container-document download protection, security-event persistence, anomaly surfacing, and end-to-end regression coverage.

### Remaining enterprise rollout domains

1. **Identity and permissions**
   - Persist named permissions instead of relying on the temporary Admin/Developer compatibility bridge.
   - Provide an administration boundary for assigning and revoking permissions.
   - Preserve least privilege and exact-permission checks for privileged actions.

2. **Credential and session lifecycle**
   - Persist credential versions on user records.
   - Increment versions after password resets, password changes, credential recovery, or forced logout actions.
   - Reject sessions carrying stale credential versions.

3. **Company context**
   - Remove implicit factory-company fallback after explicit company selection is guaranteed.
   - Treat request-supplied company identifiers only as same-company assertions.
   - Expand non-leaking cross-company enforcement to additional high-risk reads and writes.

4. **Privileged writes**
   - Inventory repair and recalculation endpoints.
   - Data imports and migration-style writes.
   - Company and security configuration changes.
   - Diagnostic endpoints capable of mutation.
   - Destructive administrative operations.

5. **Sensitive input boundaries**
   - Add exact allow-list schemas before remaining privileged and high-impact mutations.
   - Reject unknown fields, prototype-pollution keys, excessive depth, invalid types, oversized values, and unsafe arrays before business logic.

6. **Protected assets and exports**
   - Additional attachments and uploaded-file folders.
   - Generated report and spreadsheet exports.
   - Temporary export archives.
   - Report-generation routes and download endpoints.

7. **Security audit coverage**
   - Persist decisions from authentication, session, company-isolation, input-validation, and protected-asset boundaries.
   - Expand anomaly summaries without exposing cross-company details or secrets.

### Rollout order

The phases intentionally begin with persistent identity primitives before broad route migration:

1. Named permissions.
2. Credential versions.
3. Explicit company context.
4. Privileged endpoint rollout.
5. Sensitive input rollout.
6. Protected asset and export rollout.
7. Audit expansion and cleanup.

This order removes temporary compatibility bridges before they are multiplied across more routes.

## Phase 5B — Persistent named permissions and administration

Status: complete.

- Added the company-scoped `user_security_permissions` model with a unique user/company/permission boundary.
- Added versioned migration `0003_user_security_permissions.sql` and registered it in the Drizzle migration journal.
- Seeded existing Admin and Developer memberships with the initial named grants required by the migrated security surfaces.
- Added a central permission catalog, normalization, membership validation, replacement, session hydration, and targeted session invalidation service.
- Added Admin/Developer management endpoints for permission catalogs, user grants, and grant replacement.
- Permission-management endpoints themselves require the persisted `security.permissions.manage` grant.
- Grant replacement is transactional, company-scoped, security-audited, and invalidates the affected user's sessions for that company.
- Privileged-operation enforcement now hydrates persisted named permissions and no longer fabricates the required permission from role alone.
- Added focused regression coverage for catalog validation, deduplication, company-switch hydration, replacement, and explicit-session compatibility.
- Tests were written but were not executed through Replit or GitHub Actions.
- Runtime migration and production database verification are not claimed.

## Next phase

Phase 5C — Persistent credential versions and session invalidation.

## Safety constraints

- Never merge automatically or push directly to `main`.
- Keep the Program 5 pull request draft until explicit owner approval.
- Preserve accounting balances, inventory values, costing, and historical transactions.
- Do not claim test, runtime, deployment, or database verification unless actually performed.
- Avoid Replit-hosted checks and Replit credit usage.
