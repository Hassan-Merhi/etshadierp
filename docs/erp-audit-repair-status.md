# ERP Audit Repair Roadmap

This file is the source of truth for the repository-controlled audit repair program.

## Rules

- Complete one phase at a time, in order.
- Use an isolated branch and pull request for each phase.
- Do not merge unless the pull request is current, conflict-free, and every required check is green.
- Preserve accounting, costing, inventory quantities, historical data, permissions, and company isolation unless a phase explicitly repairs the relevant behavior.
- Provider-side plan upgrades or dashboard-only settings must be reported separately and are not represented as completed repository work.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Freeze unsafe releases and restore green database/release gates | In progress |
| 1 | Correct route-aware company context and page access | Merged in PR #507; final roadmap verification pending Phase 0 |
| 2 | Reduce startup and remote-support load | Entry-bundle repair merged; runtime-network hardening remains |
| 3 | Eliminate blank screens, endless loading, silent API failures, and false logouts | Not started |
| 4 | Align Render/database capacity and runtime safeguards | Not started |
| 5 | Add browser regression coverage | Not started |
| 6 | Complete or hide incomplete workflows and reduce high-risk debt | Not started |

## Phase 0 completion gate

Phase 0 is complete only when:

1. `render.yaml` uses `autoDeployTrigger: checksPass` for the production web service.
2. A regression test prevents reintroduction of deploy-on-every-commit behavior.
3. The current pull request passes static build, security, PostgreSQL regression, and relevant GitHub Actions checks.
4. The pull request is merged into `main` without bypassing a failing gate.
5. The resulting `main` commit remains green.

Repository branch protection and Render dashboard state should also be reviewed by the repository owner because those provider settings cannot be fully proven from source code alone.
