# ERP Audit Repair Roadmap

## Operating rule

Complete one phase at a time. Do not merge a phase until its pull request is current, conflict-free, and every required GitHub Actions and CircleCI check is successful.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Freeze unsafe releases and restore green database/release gates | In progress on `agent/phase-0-release-gates` |
| 1 | Correct route-aware company context and page access | Not started |
| 2 | Reduce startup and remote-support load | Not started |
| 3 | Eliminate blank screens, endless loading, silent API failures, and false logouts | Not started |
| 4 | Align hosting/database capacity and runtime safeguards | Not started |
| 5 | Add browser regression coverage for roles, companies, pages, multi-tab behavior, and mobile | Not started |
| 6 | Complete or hide incomplete workflows and reduce high-risk route/file debt | Not started |

## Phase 0 completion gate

- Render Blueprint uses `autoDeployTrigger: checksPass`.
- Current PostgreSQL regression failure is identified and repaired rather than bypassed.
- Static build, PostgreSQL regression, security, and repository CI are green on the final phase head.
- The phase pull request is rebased on the latest `main` and mergeable.
- Any provider-only branch protection setting that cannot be changed through repository code is recorded explicitly for the owner rather than represented as complete.

## Safety boundaries

Phase 0 must not alter accounting calculations, costing, inventory quantities, historical records, company access behavior, or production database data.
