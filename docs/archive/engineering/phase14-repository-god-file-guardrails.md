# Phase 14 — Repository-Wide God-File Guardrails

## Status

Complete.

## Purpose

Phase 14 extends the existing god-file contract beyond a small set of known composition files. The audit now walks the active TypeScript and JavaScript source trees and reports oversized modules before they become new architectural bottlenecks.

## Policy

- Explicitly bounded high-risk files keep their strict, responsibility-specific limits.
- Active source under `server`, `client/src`, `shared`, `scripts`, and `tests` is scanned recursively.
- Files above 900 lines produce architecture warnings and should be considered for a focused split.
- Files above 3,000 lines fail the architecture audit.
- Generated output, dependencies, coverage, build artifacts, Git metadata, and migration directories are excluded.
- Exceptions must be named in configuration rather than silently skipped in code.

## Contract

The source audit returns:

- deleted legacy-file violations
- explicit file-boundary violations
- forbidden architecture patterns
- repository-wide oversized-file warnings
- repository-wide hard-limit failures
- scan totals and severity counts

`tests/god-file-boundaries.test.ts` now follows configuration version 14 and verifies both explicit boundaries and the repository scan. This also repairs the previous stale Phase 10 assertions.

## Change discipline

A warning is a refactoring signal, not a runtime failure. A hard-limit increase or a new exclusion requires an explicit architecture decision and a documented configuration change. New implementation logic must not be placed back into compatibility barrels or orchestration-only files.

## Verification boundary

The change was reviewed at source level for configuration, traversal, exclusions, severity calculation, and report shape. CI, TypeScript compilation, formatting, lint, tests, production build, database execution, browser checks, deployment, and runtime smoke checks were skipped per owner instruction.
