# Phase 13 — Authenticated Application Orchestration

## Status

Complete.

## Purpose

Reduce `client/src/app/AuthenticatedApp.tsx` to authenticated-shell orchestration while preserving the existing role, company-mode, access, redirect, notification, and shell-selection behavior.

## Ownership boundaries

- `AuthenticatedApp.tsx` owns lifecycle wiring, top-level loading/authentication handling, route-decision rendering, and shell selection.
- `useAuthenticatedAppData.ts` owns company-scoped settings, factory access data, POS unread-message polling, notification behavior, and application timezone synchronization.
- `authenticatedAppRouteGuard.ts` owns properties, supplier-partner, factory, and ERP redirect decisions.
- Existing shell components continue to own their route trees and layouts.

## Compatibility

The refactor preserves the existing POS, properties, factory, supplier-partner, and ERP routing decisions. No intentional API, route path, query key, polling interval, permission, company-mode, or shell-prop behavior changed.

## Guardrail

`config/god-file-boundaries.json` limits `AuthenticatedApp.tsx` to 150 lines and prevents direct query ownership, direct API fetching, supplier-partner route catalog ownership, and factory guard computation from returning to the orchestration component.

## Verification boundary

The source was reviewed for responsibility movement and preserved call ordering. CI, TypeScript compilation, formatting, lint, tests, production build, browser checks, deployment, and runtime smoke checks were skipped per owner instruction.
