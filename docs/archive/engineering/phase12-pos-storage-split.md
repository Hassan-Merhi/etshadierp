# Phase 12 — POS Storage Split

## Status

Complete.

## Purpose

Phase 12 continues the repository-wide god-file cleanup by separating POS draft persistence from POS shift persistence while preserving the existing public storage surface.

## Changes

- `server/storage/pos.ts` is now a compatibility barrel only.
- Draft POS sale queries and mutations live in `server/storage/pos/drafts.ts`.
- POS shift queries and mutations live in `server/storage/pos/shifts.ts`.
- Existing exported function names remain unchanged, so `storage.*` callers require no migration.
- The god-file boundary configuration now caps `server/storage/pos.ts` at ten lines and forbids direct database implementation in the barrel.

## Behavior boundary

This phase intentionally does not change SQL, query scoping, POS totals, shift-closing calculations, response shapes, routes, schemas, or database migrations.

## Verification boundary

Source-only review was used to preserve the export surface and move the existing implementation. CI, TypeScript compilation, formatting, lint, tests, database execution, production build, browser checks, deployment, and runtime smoke checks were skipped per owner instruction.
