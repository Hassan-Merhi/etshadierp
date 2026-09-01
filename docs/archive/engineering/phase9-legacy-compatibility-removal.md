# Phase 9 — Legacy compatibility removal

`server/routes.ts` now composes `registerApplicationRoutes` directly. The application and report compatibility files were removed, and the auth and customer compatibility exports were retired. The legacy boundary inventory is now empty.

All HTTP ownership remains in focused route registrars. CI and runtime checks were skipped per owner instruction.
