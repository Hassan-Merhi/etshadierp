# Program 4 — Security Integration and Runtime Enforcement

Status: in progress. This branch is stacked on the completed, unmerged Program 3 branch.

## Phase sequence

- [x] 4A — Route and service adoption audit
- [x] 4B — Authentication and session enforcement adapters
- [ ] 4C — Company isolation enforcement on high-risk reads and writes
- [ ] 4D — Privileged operation enforcement on repair and administrative endpoints
- [ ] 4E — Unsafe input validation on sensitive mutations
- [ ] 4F — Protected file, attachment, report, and export enforcement
- [ ] 4G — Security audit persistence and anomaly surfacing
- [ ] 4H — End-to-end enforcement tests and integration report

## Phase 4B — Authentication and session enforcement adapters

Status: complete.

- Added `server/services/security/sessionEnforcementAdapter.ts`.
- Wired it into production `requireLogin`, `requireAuth`, and `requirePasswordConfirmation` middleware in `server/auth.ts`.
- Preserved the zero-database-call authentication path.
- Enforced idle timeout, absolute lifetime, company context, recent password confirmation, and credential version checks.
- Invalid, expired, or revoked sessions are denied and destroyed when appropriate.
- Existing authenticated sessions receive a one-time bounded timestamp upgrade to avoid a forced mass logout.
- Credential version zero remains the compatibility baseline until persistent per-user credential versions are integrated.
- Existing role, location, delete, date, POS, and View Only controls remain in place.
- Added focused tests for valid, legacy, expired, company-free, company-required, revoked, and password-confirmation cases.
- Tests were added but not executed through Replit or GitHub Actions.
- No Replit credits were used.

## Next phase

Phase 4C — Company isolation enforcement on high-risk reads and writes.

## Safety constraints

- Never merge automatically or push directly to `main`.
- Preserve existing authorization until replacement enforcement is equivalent or stricter.
- Do not change accounting balances, stock values, costing rules, or historical transactions.
