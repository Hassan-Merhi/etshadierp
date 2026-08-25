# Phase 13 — Dependency / Platform Modernization

Phase 13 closes compatibility debt without using a blanket major-version sweep.

## Changes landed

- Keep the production Tailwind stack on the supported v3 LTS line and remove the unused Tailwind v4 Vite plugin from the root dependency graph.
- Align `@types/node` to the production Node 24 runtime.
- Remove deprecated or obsolete stub type packages for `bcryptjs` and `pdf-parse`; both runtimes ship their own declarations.
- Migrate PO PDF extraction to the typed `pdf-parse` v2 API with deterministic parser cleanup.
- Apply same-major maintenance updates for Capacitor 8, Nodemailer 9, and React Day Picker 8.
- Realign Android to the Capacitor 8 native baseline: API 24 minimum, compile/target API 36, AGP 8.13.0, Gradle 8.14.3, current AndroidX values, and the `density` activity configuration change.
- Retain the existing iOS 16 deployment target, which is above Capacitor 8's iOS 15 minimum.
- Keep the desktop stack on Electron 43 / electron-builder 26 and the repository's canonical Node 24 toolchain.
- Add `npm run audit:platform` plus an isolated Node test contract so these compatibility boundaries fail closed without booting application/database startup hooks.

## Intentionally deferred breaking migrations

Vite 7/8, Tailwind 4, Recharts 3, and React Day Picker 9/10 require dedicated UI/build migrations and are intentionally excluded from this maintenance batch.

`@types/express` 5 was trialed against the existing Express 5 runtime and rejected by the Phase 13 TypeScript gate because its route-parameter typing change (`string` to `string | string[]`) creates a broad backend migration across hundreds of handlers. The repository therefore retains the currently green Express 4 type surface until that source migration is handled as a dedicated change rather than hidden inside dependency maintenance.
