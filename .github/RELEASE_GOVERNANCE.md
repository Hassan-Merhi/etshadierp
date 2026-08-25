# Release Governance

This document is the authoritative repository policy for protecting `main` and for deciding which commit may be released.

## Main branch policy

`main` must be protected by a GitHub ruleset or branch-protection rule with no routine bypass path.

Required settings:

- All changes reach `main` through a pull request. Direct pushes are not permitted.
- Force pushes are blocked.
- Branch deletion is blocked.
- Pull-request branches must contain the latest `main` commit before merge.
- Required status checks must pass before merge. A pending, cancelled, skipped-required, or failed required check blocks merge.
- Administrators follow the same release rule; emergency bypass is not part of the normal release process.
- Review conversations must be resolved before merge when GitHub exposes that control.

The repository does not require an arbitrary approval count solely to satisfy this policy. The safety requirement is a reviewable PR plus the full automated gate set.

## Required pre-merge gates

The exact PR head must pass every applicable permanent gate. The current release matrix includes:

### GitHub Actions

- CI
- Security
- CodeQL
- Semgrep
- Dependency Review when dependency changes make it applicable
- I18n Audit
- RTL and Accessibility
- Mobile Responsiveness
- GitHub Actions Quality
- Browser E2E when triggered by the change
- Performance & Database Safety when triggered by the change
- Release Verification and resilience checks when triggered by the change
- Release Governance

### CircleCI

- `ci/circleci: static-build`
- `ci/circleci: postgres-regression`
- `ci/circleci: backend-core-regression`
- `ci/circleci: frontend-regression`
- `ci/circleci: security-readiness`

A check from an older SHA never satisfies the gate for a newer PR head.

## Permanent governance audit

`.github/workflows/release-governance.yml` independently verifies the repository-level contract:

- `main` reports as protected through the GitHub API;
- PR heads targeting `main` are not behind current `main`;
- a force push to `main` fails the audit;
- a new `main` SHA without an associated merged pull request fails the audit.

This workflow is defense in depth. It does not replace GitHub branch protection: branch protection prevents the prohibited write, while the workflow detects governance drift and prevents an ungoverned commit from being treated as release-ready.

## Exact-main release certification

A green PR is necessary but is not the final deployment authority. After the PR merges, the exact resulting `main` SHA must pass the post-merge certification status:

`phase3/exact-main-certification`

That certification independently reruns static/build contracts, disposable PostgreSQL setup, backend and frontend regression/coverage, security, and backup/restore rehearsal on the commit that actually exists on `main`.

Render is configured to deploy from `main` only after checks pass. Therefore a release is valid only when both conditions are true:

1. the change entered protected `main` through a current, green pull request; and
2. the exact merged `main` SHA passed its post-merge certification.

## Emergency changes

An emergency does not convert a direct push into an acceptable release path. Use a narrowly scoped pull request, keep the branch current with `main`, run the required gates, merge normally, and certify the resulting `main` SHA. If GitHub itself is unavailable, record the incident and restore the normal protection policy before the repository is considered release-ready again.
