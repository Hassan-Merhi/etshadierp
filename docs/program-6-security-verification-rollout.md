# Program 6 — Security Verification, Deployment Readiness, and Controlled Rollout

Status: in progress on `agent/program-6-security-verification-rollout`.

This program verifies and operationalizes the completed Program 5 security implementation without merging or deploying automatically. It is stacked on the completed, unmerged Program 5 branch.

## Phase sequence

- [x] 6A — Verification inventory, rollout gates, and evidence model
- [x] 6B — Static integration audit and compile-safety repair
- [ ] 6C — Focused security test execution and defect repair
- [ ] 6D — Migration dry-run and rollback validation
- [ ] 6E — Session, credential, permission, and company-context runtime verification
- [ ] 6F — Privileged repair and sensitive-input runtime verification
- [ ] 6G — Protected-file and security-audit runtime verification
- [ ] 6H — Deployment checklist, controlled rollout plan, and final readiness report

## Phase 6A — Verification inventory, rollout gates, and evidence model

Status: complete.

### Verification domains

1. **Build and integration safety**
   - TypeScript and import resolution for every Program 5 file.
   - Route-registration order and middleware composition.
   - No accidental behavior changes to accounting, costing, inventory, or historical transactions.
2. **Focused security regressions**
   - Named permissions and permission administration.
   - Credential versions and stale-session invalidation.
   - Explicit company context.
   - Privileged repair authorization.
   - Sensitive-input rejection.
   - Protected stored-file access.
   - Security-event persistence and anomaly loading.
3. **Migration safety**
   - Sequential application of migrations `0003` through `0006`.
   - Idempotency and existing-data compatibility.
   - Trigger behavior and session-table compatibility.
   - Documented rollback or forward-fix procedure for each migration.
4. **Runtime behavior**
   - Existing Admin/Developer access after permission backfill.
   - Non-privileged denial behavior.
   - Password-confirmation freshness UX.
   - Cross-company and stale-session rejection.
   - Repair preview versus confirmed apply behavior.
   - Stored-file download and preview compatibility.
5. **Operational readiness**
   - Deployment order and maintenance-window requirements.
   - Database backup and restore checkpoint.
   - Health checks, log signatures, and rollback triggers.
   - Explicit owner approval before merge or deployment.

### Evidence requirements

Every phase must record:

- Exact command or runtime action performed.
- Environment used.
- Pass/fail result.
- Relevant output or failure evidence.
- Code changes made in response.
- Remaining limitations.

A phase is not marked verified merely because tests exist. Runtime, database, deployment, and production claims require actual evidence from the corresponding environment.

### Release gates

Program 6 cannot be considered rollout-ready until all of the following are satisfied:

- Static integration checks pass.
- Focused security tests pass.
- Migrations apply in order on a disposable database copy.
- Rollback or forward-fix procedures are documented.
- Session and permission flows are verified against a real session store.
- Repair and file-access flows are verified without changing production data.
- Final readiness report identifies zero unresolved critical defects.

## Phase 6B — Static integration audit and compile-safety repair

Status: source-level audit complete; command-based compile verification remains pending.

- Repaired raw-stock sensitive-input route selection so mounted Express middleware uses the canonical path from `originalUrl` rather than a potentially rewritten `req.path`.
- Bound stored-file audit classification to the configured read/download action instead of inferring it from a mounted path.
- Changed container-document authorization to use authenticated `currentCompanyId` as the authoritative company and reject mismatched legacy factory context.
- Updated the asynchronous audit-backed raw-stock validation test harness and added a mounted-route regression.
- Added `docs/program-6-static-integration-audit.md` with findings, evidence, and limitations.
- No compiler, test runner, build, migration, runtime, deployment, or production command was executed; compile and test evidence is reserved for Phase 6C.

## Next phase

Phase 6C — Focused security test execution and defect repair.

## Safety constraints

- Never merge automatically or push directly to `main`.
- Keep the Program 6 pull request draft until explicit owner approval.
- Do not deploy or apply migrations to production.
- Avoid Replit-hosted checks and Replit credit usage.
- Preserve accounting balances, inventory values, costing, and historical transactions.
- Do not claim verification that was not actually performed.
