# Phase 6 — Frontend Coverage Certification

Phase 6 locks the frontend global line-coverage floor at **20%**.

## Measured evidence

The Phase 6 pull-request coverage artifact measured:

- Lines: **20.98%**
- Statements: **19.83%**
- Functions: **13.24%**
- Branches: **14.32%**

The enforced frontend global line threshold in `config/coverage-thresholds.json` is **20**. The target is earned by the existing behavioral frontend suite; this phase does not add coverage exclusions, relax timeouts, lower per-file floors, or weaken another gate.

## Merge condition

Merge only after the exact merge candidate passes the required GitHub Actions and CircleCI checks with the 20% frontend line floor enabled.
