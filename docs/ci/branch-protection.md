# Branch Protection and Required Checks

This document defines the intended protection policy for the `main` branch of `Hassan-Merhi/etshadierp`.

## Required pull request checks

Configure the following GitHub Actions job names as required status checks before merging:

- `Check / Build / Lint / Test`
- `Dependency audit`
- `Secret scan`

These checks currently cover:

- TypeScript type checking
- Production build
- ESLint
- Prettier validation for changed TypeScript, TSX, and CSS files
- Test database schema preparation
- Application startup migrations
- Backend tests and backend coverage thresholds
- Frontend tests and frontend coverage thresholds
- Production dependency vulnerability auditing
- Repository secret scanning

## Recommended `main` protection settings

Enable a branch ruleset or classic branch protection rule for `main` with these settings:

1. Require a pull request before merging.
2. Require all configured status checks to pass.
3. Require branches to be up to date before merging.
4. Block force pushes.
5. Block branch deletion.
6. Require conversation resolution before merging.
7. Apply the rule to administrators as well, unless an emergency break-glass procedure is formally documented.
8. Do not allow direct pushes to `main` during normal development.
9. Allow squash or merge commits according to repository policy, but keep the selected method consistent.

## Review requirement

For routine low-risk maintenance performed by the repository owner, status checks may be the primary gate. For accounting, authorization, schema, migration, inventory, payroll, or concurrency changes, require at least one independent approving review when another qualified reviewer is available.

## Security workflow policy

- Critical production dependency vulnerabilities must block merging.
- Existing high-severity advisories are captured as CI artifacts and must be triaged and reduced deliberately.
- Verified or unknown secrets detected by the secret scanner must block merging and trigger credential rotation when applicable.
- Dependabot pull requests must pass the same CI and Security workflows as normal pull requests.

## Applying the settings

Repository administration access is required to enable branch rules. In GitHub:

1. Open repository **Settings**.
2. Open **Rules** and create a ruleset targeting the default branch, or use **Branches** and add a protection rule for `main`.
3. Add the required status-check names listed above exactly as GitHub reports them.
4. Enable pull-request, up-to-date branch, conversation-resolution, force-push, and deletion protections.
5. Save the rule and validate it with a small test pull request.

## Validation checklist

After enabling protection, confirm that:

- A direct push to `main` is rejected.
- A PR with a failing CI check cannot merge.
- A PR with a failing Security check cannot merge.
- A stale PR must update from `main` before merging.
- An unresolved review conversation blocks merging.
- A fully passing PR can merge normally.

## Emergency procedure

If an emergency production fix requires bypassing normal protection:

1. Record the incident and reason for bypass.
2. Keep the change narrowly scoped.
3. Run the full CI and Security workflows immediately afterward.
4. Restore normal protection without delay.
5. Document any follow-up work and review the bypass in the next production-readiness review.
