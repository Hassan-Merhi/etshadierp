---
name: Golden Coast POS request identity
description: Idempotency boundary and retry behavior for the canonical Golden Coast Phase 6 POS sale.
---

The Golden Coast Phase 6 POS route must remain under the operational voucher request boundary. Its own handler-level clientRequestId identity is what supports replay through a fresh transport key; moving it into the generic deterministic-source guard changes replay semantics and can replay unrelated test or sale payloads.

**Why:** The outer guard and the Phase 6 handler serve different purposes. The outer guard protects transport retries, while the handler validates the sale digest and returns the canonical replay response. A deterministic outer key that ignores clientRequestId caused identical-looking independent sales to collide.

**How to apply:** Keep the canonical Phase 6 route on the operational matcher. In the POS client, retain the sale identity for identical retries, rotate it when the financial payload changes, and refresh it after a Golden Coast idempotency conflict so the cashier can retry without reloading.

Frontend POS contract tests run under the dedicated frontend Vitest config, and source-file assertions in that jsdom environment should resolve paths from the workspace rather than relying on `import.meta.url` being a file URL.

**Why:** The default backend-oriented Vitest config excludes `tests/ui/**`, while Vite transforms `import.meta.url` during frontend tests into a non-file URL.

**How to apply:** Use the frontend Vitest config for POS UI contracts and use `process.cwd()` plus workspace-relative paths for test-only source inspection.