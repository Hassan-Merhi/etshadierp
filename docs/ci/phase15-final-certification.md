# Phase 15 — Final 100/100 Certification

Phase 15 is the closure gate for the 15-phase hardening programme. The `100/100` score means every programme category has met its declared acceptance gate on the exact certified repository head. It is not a claim that software can never contain an unknown defect.

## Merge contract

Phase 15 may merge only when all of the following are true on the exact final PR head:

1. The branch is current with protected `main` and is mergeable without conflicts.
2. All required GitHub Actions checks are successful, including CI, CodeQL, Dependency Review, Semgrep, Security, Security Readiness Parity, Release Governance, Browser E2E, Performance & Database Safety, I18n, action quality, mobile, RTL/accessibility, and the dedicated Phase 15 gate.
3. All five required CircleCI contexts are successful on the same head.
4. No unresolved review thread blocks merge.
5. The dedicated `phase15/final-100-certification` status is successful.
6. After merge, the new exact `main` head passes the authoritative exact-main certification and the required CircleCI contexts.

## Programme closure matrix

The dedicated Phase 15 workflow re-runs the machine-checkable contracts that represent the completed roadmap:

| Phase | Closure evidence |
| --- | --- |
| 1 — Main protection and release governance | Release Governance plus protected/current-main merge rules |
| 2 — Canonical stock movement evidence | write-route, write-evidence, and inventory contract audits |
| 3 — Universal tenant/RLS fail-closed | company-scope audit, PostgreSQL-backed regression, focused security gate |
| 4 — Remaining type safety | TypeScript, type-escape ratchet, lint ratchet |
| 5 — Backend coverage | backend verification and coverage ratchet |
| 6 — Frontend coverage | frontend regression and coverage ratchet |
| 7 — Transactional browser E2E | required Browser E2E workflow |
| 8 — Privileged endpoint abuse hardening | focused security gate and route coverage audits |
| 9 — Accounting/inventory convergence | backend accounting/inventory regression and smoke sweep |
| 10 — Performance/database deep audit | query-risk validation, production readiness, required DB safety workflow |
| 11 — Production SLOs/observability | observability and final-readiness verifiers |
| 12 — Disaster recovery | backup/restore rehearsal, critical-row parity, scheduler guard |
| 13 — Dependency/platform modernization | platform audit/tests, toolchain and production-dependency verification |
| 14 — Final security re-audit | focused security gate plus required CodeQL/Semgrep/dependency/secret checks |
| 15 — Final certification | this exact-head gate plus post-merge exact-main certification |

## Dedicated Phase 15 gate

`.github/workflows/phase15-final-certification.yml` certifies the exact PR head and publishes the status context:

`phase15/final-100-certification`

The gate runs:

- lockfile and production dependency verification;
- documentation, toolchain, script inventory, god-file, type-escape, write-route, write-evidence, company-scope, coverage, lint, inventory-contract, query-risk, and platform audits;
- platform tests;
- changed-file formatting, ESLint, TypeScript, production build, server-bundle and final-production-readiness checks;
- observability, Phase 11/12 DR contract verification, memory stabilization, mobile routing, bandwidth, accessibility and responsive checks;
- a disposable PostgreSQL schema plus application startup migrations;
- complete backend verification, backend coverage, and smoke sweep;
- frontend regression and frontend coverage;
- the focused security suite, dependency-audit verifier, and critical production dependency audit;
- a real pg_dump/pg_restore rehearsal with a 300-second recovery-time budget, critical-row count parity, restored-schema verification, and scheduler overlap guard.

All major sections are fail-closed. A failed, skipped-through-prerequisite, or incomplete section makes the final Phase 15 status fail.

## Final completion rule

The programme is **15/15 complete** only after the Phase 15 PR is merged and the resulting `main` head is independently green on the repository's exact-main certification and required status contexts.
