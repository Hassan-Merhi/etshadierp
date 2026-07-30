# Phase 11 — Frontend Performance

## Scope

Phase 11 reduces initial authenticated bundle work and repeated browser rendering work without changing accounting, inventory quantities, factory costing, permissions, route destinations, export columns, or write behavior.

## Mode-specific application shells

`AuthenticatedApp` previously imported the ERP, Factory, Properties, and POS shells together. Every authenticated session therefore parsed every mode shell and its routing graph even though only one mode could render.

The four shells now use `React.lazy` behind a shared `Suspense` boundary. After authentication and company resolution, the browser loads only the active shell chunk:

- ERP users load the ERP shell;
- Factory users load the Factory shell;
- Properties users load the Properties shell;
- POS users load the POS shell.

The existing loading state, route guard, leave-confirmation flow, logout behavior, company selection, and access decisions remain unchanged.

## Context-only factory settings

Factory access still loads for non-POS users because the route guard needs to distinguish ERP-only, Factory-only, and dual-access accounts.

The broader Factory settings payload now loads only when the selected company is a Factory company or the requested path is under `/factory/`. Normal ERP and Properties bootstraps no longer request it.

## On-demand Daybook features

The ordinary Daybook transaction list no longer includes optional code until it is used:

- Edit and detail dialog modules load when their dialog opens;
- the audit-log module loads when the activity tab renders;
- the Excel runtime loads only after an export action.

Factory Daybook also defers its audit log and both Excel export paths. Agent Ledger defers its Excel runtime until export.

Existing export data, file names, date formatting, dialogs, and action permissions are preserved.

## Combined stock rendering

The all-location stock view previously filtered the entire result once for every stock group and reduced the entire result again for every location footer. It also applied text search synchronously for every keystroke.

Phase 11 now:

- defers search text with `useDeferredValue`;
- precomputes lowercase item search text once per data refresh;
- memoizes matrix detection and reference lists;
- builds group totals, location totals, total quantity, and total value in one summary pass;
- performs constant-time summary lookups while rendering group headers and the footer.

The displayed rows, filters, sorting, category badges, movement links, quantities, costs, and grand totals remain unchanged.

## Permanent boundaries

The phase includes:

- `scripts/verify-phase11-frontend-performance.mjs`;
- `tests/phase11-frontend-performance-contract.test.ts`;
- source line ceilings for the new performance wrappers and transform module;
- explicit rejection of static mode-shell imports and invalid lazy-import templates.

## Verification boundary

No CI, GitHub Actions, CircleCI, TypeScript compilation, formatting, lint, Vitest execution, production build, browser profiling, deployment, or runtime performance measurement was run for this phase, as requested.

The deterministic verifier can be run manually with:

```bash
node scripts/verify-phase11-frontend-performance.mjs
```
