# Program 6C — Focused Security Test Evidence

Status: execution blocked; not passed and not complete.

## Attempted execution

Environment: ChatGPT container on 2026-07-18.

Actions attempted:

1. Checked local tooling.
   - `git` was available.
   - `gh` was not installed.
2. Attempted to clone `agent/program-6-security-verification-rollout`.
   - Failed because the container could not resolve `github.com`.
3. Queried GitHub Actions for head `5b1b68939360b2fb6b37fb7f65cab0aa31889374`.
   - No pull-request workflow runs existed.

These results are environmental execution failures, not application test failures.

## Canonical command

The repository now contains:

```bash
node scripts/run-program-6-focused-security-checks.mjs
```

The runner performs:

1. `npm run check`
2. Focused Vitest execution for:
   - named permission persistence and normalization
   - credential version behavior
   - explicit company context
   - legacy privileged writes
   - raw-stock sensitive input
   - stored-file protected access
   - Program 5 end-to-end security
   - Program 4 end-to-end enforcement
   - container-document protected downloads
   - security audit runtime

The runner stops at the first non-zero exit code.

## Gate state

- TypeScript compile gate: **not executed**
- Focused security tests: **not executed**
- Defect-repair loop: **not started because no executable failure output exists**
- Replit usage: **none**
- GitHub Actions minutes consumed by this phase: **none observed**

Phase 6C must remain open until the canonical command is executed in an environment with the repository checkout and installed dependencies, and all failures are repaired and rerun successfully.
