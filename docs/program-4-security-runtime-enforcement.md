# Program 4 — Security Integration and Runtime Enforcement

Status: in progress. This branch is stacked on the completed, unmerged Program 3 branch and must remain unmerged until the owner approves the completed Program 4 package.

## Goal

Connect the pure security policies created in Program 3 to real production routes and services without changing accounting formulas, inventory valuation, stock quantities, or historical business records.

## Phase sequence

- [x] 4A — Route and service adoption audit
- [ ] 4B — Authentication and session enforcement adapters
- [ ] 4C — Company isolation enforcement on high-risk reads and writes
- [ ] 4D — Privileged operation enforcement on repair and administrative endpoints
- [ ] 4E — Unsafe input validation on sensitive mutations
- [ ] 4F — Protected file, attachment, report, and export enforcement
- [ ] 4G — Security audit persistence and anomaly surfacing
- [ ] 4H — End-to-end enforcement tests and integration report

## Phase 4A — Route and service adoption audit

Status: complete.

### Verified finding

Program 3 added seven pure security policy modules and their focused tests, but PR #79 changed no existing production route or service files. Therefore broad runtime enforcement is not yet established.

### Adoption map

1. `sessionSecurityPolicy.ts`
   - Login/session middleware, session refresh, company switching, sensitive-action password confirmation.
2. `authorizationPolicy.ts` and `companyIsolationPolicy.ts`
   - Company-scoped reads and writes for accounting, inventory, factory, administration, reporting, exports, and attachments.
3. `privilegedOperationPolicy.ts`
   - Repair, recalculation, migration, destructive, credential reset, permission change, company configuration, and diagnostic-write endpoints.
4. `unsafeOperationValidation.ts`
   - Sensitive request bodies before service or transaction execution.
5. `protectedAssetAccessPolicy.ts`
   - Attachment downloads, uploaded files, generated exports, and report exports.
6. `securityAuditPolicy.ts`
   - Append-only persistence adapters and anomaly reporting surfaces.

### Sequencing rules

- Integrate one enforcement surface per phase.
- Preserve existing route authorization until the replacement is proven equivalent or stricter.
- Company ownership must come from canonical storage, not request parameters.
- Security failures must remain non-leaking.
- No direct pushes to `main` and no automatic merge.
- Avoid Replit-hosted checks and credit usage.
- Do not change accounting balances, stock values, costing rules, or historical transactions.

## Next phase

Phase 4B — Authentication and session enforcement adapters.
