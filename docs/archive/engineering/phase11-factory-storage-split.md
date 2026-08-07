# Phase 11 — Factory Storage God-File Split

## Status

Complete.

## Purpose

Phase 11 removes the remaining factory storage god file while preserving the public `storage` API used by routes and services.

## Changes

- `server/storage/factory.ts` is now a compatibility barrel only.
- Bale persistence moved to `server/storage/factory/bales.ts`.
- Pending barcode persistence moved to `server/storage/factory/barcodes.ts`.
- Product, category, and label-print persistence moved to `server/storage/factory/products.ts`.
- Bale transfer persistence moved to `server/storage/factory/transfers.ts`.
- Production bale and mix-batch persistence moved to `server/storage/factory/production.ts`.
- Every previously exported function name remains exported through `server/storage/factory.ts`.
- `config/god-file-boundaries.json` now prevents database logic from returning to the compatibility barrel and limits it to ten lines.

## Behavior boundary

This phase is an ownership-only refactor. It does not intentionally change queries, company scoping, costing calculations, barcode generation, transfer behavior, schemas, migrations, routes, or response shapes.

## Verification boundary

The files were reviewed source-by-source for export preservation and direct query movement. CI, TypeScript compilation, formatting, lint, tests, database execution, production build, browser checks, deployment, and runtime smoke checks were skipped per owner instruction.
