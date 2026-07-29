# Phase 6 — Chat reporting domains

## Purpose

Separate chat report classification and domain ownership from the main chat orchestration path without changing any report SQL, formatting, query names, or response payloads.

## Architecture

`server/chatService.ts` continues to depend on the stable `runDataQuery` entry point from `server/chat/reports.ts`. The public report module is now a thin facade over a domain dispatcher.

Focused ownership modules cover:

- accounting and finance;
- customers and suppliers;
- inventory and stock movement;
- factory and workforce reporting;
- containers and arrivals;
- sales and profitability;
- general operations.

The original read-only execution engine is preserved at `server/chat/reports/legacyReportEngine.ts`. Domain handlers delegate to it so SQL, date handling, limits, labels, tables, stats, and no-data behavior remain unchanged. Unknown or historical query names also use the compatibility fallback.

## Guardrails

- `chatService.ts` may not regain a `switch (params.queryType)` report dispatcher.
- `server/chat/reports.ts` must remain a small facade.
- Each classified query type has one domain owner.
- The compatibility engine remains read-only and frozen for behavior preservation.
- New report names must be assigned to a focused domain before being added.

## Verification boundary

The static verifier and Vitest source-contract test were added but intentionally not executed. No TypeScript, lint, formatting, database, production build, browser, CI, or deployment result is claimed.
