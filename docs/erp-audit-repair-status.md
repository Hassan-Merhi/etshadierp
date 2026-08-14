# ERP Audit Repair Roadmap

This document records the repository-controlled release-safety gate for Audit Phase 0 and the rules that apply to later audit repair work.

## Rules

- Complete audit phases through isolated branches and pull requests.
- Do not merge a phase unless its pull request is current, conflict-free, and all required checks are green.
- Preserve accounting, costing, inventory quantities, historical data, permissions, and company isolation unless a phase explicitly repairs that behavior.
- Treat provider-side settings separately from source-controlled guarantees.

## Phase 0 — safe release gate

Phase 0 freezes unsafe automatic production releases without changing application business behavior.

It is complete only when:

1. `render.yaml` uses `autoDeployTrigger: checksPass` for the production web service.
2. A regression test prevents deploy-on-every-commit behavior from being reintroduced.
3. Static build, security, PostgreSQL regression, and relevant GitHub Actions checks are green.
4. The pull request is conflict-free and merged into `main` without bypassing a failing gate.
5. The resulting `main` commit remains green.

## Provider boundary

The repository Blueprint can request CI-gated deploys, but repository branch protection and the effective Render dashboard configuration must still be verified at the provider level.

Subsequent audit phases are tracked by their own pull requests. This document intentionally does not claim their current completion state so it cannot become a stale status source.
