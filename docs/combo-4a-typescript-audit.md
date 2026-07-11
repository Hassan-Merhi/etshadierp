# Combo 4A — Safe TypeScript UI/report cleanup

Status: in progress.

## Guardrails

This branch is limited to behavior-preserving TypeScript fixes in UI, report/export, request-shape, response-shape, and display-only code.

Explicitly excluded:

- accounting formulas and net-position calculations
- inventory quantities, values, allocation, and negative-stock behavior
- voucher posting and POS calculations
- container accounting and tracking business logic
- database schema and migrations
- payroll and non-stock accounting types reserved for Combo 4B

No broad `any`, `@ts-ignore`, `@ts-nocheck`, or TypeScript configuration weakening is permitted.

## Baseline

The previously verified CI baseline was 163 diagnostics across 34 files. A fresh CI run from the latest `main` is being used to verify the current baseline before fixes.
