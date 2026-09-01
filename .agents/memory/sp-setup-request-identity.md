---
name: Supplier Partner setup request identity
description: Browser Supplier Partner setup mutations must satisfy the accounting request guard.
---

Supplier Partner setup mutations need `clientRequestId` in the JSON body or `X-Idempotency-Key` on the request. A body-only `idempotencyKey` is not recognized by the shared accounting boundary.

**Why:** The shared voucher-path retry guard runs before the setup route and intentionally accepts only its canonical request-identity inputs; otherwise the UI receives `ACCOUNTING_REQUEST_ID_REQUIRED` before provisioning starts.

**How to apply:** When adding or changing browser mutations under `/api/sp/`, pass a stable client request ID in the format already accepted by the boundary and keep it stable for retries.